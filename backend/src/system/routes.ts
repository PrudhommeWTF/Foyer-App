// Surface HTTP de l'exploitation, montée sous /api/system : version exécutée,
// disponibilité et déclenchement d'une mise à jour, état du service et
// sauvegardes de la base. Sortie de server.ts pour rejoindre le sous-système
// « system » (backup.ts, releases.ts, self-update.ts, status.ts, version.ts).
//
// Le module importe directement sa logique métier ; server.ts ne lui passe que
// ce qui lui est propre : les gardes, l'enveloppe async, la confirmation par mot
// de passe, le membre courant et le dossier de données.
import express, { Request, RequestHandler, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import { HouseholdState } from '../models';
import { UserRow, db, getHousehold, getUserById } from '../db';
import { effectiveSetting } from '../settings/repo';
import { resolveVapidSubject } from '../notify/push';
import { log } from '../log';
import { freshStatus } from '../update-status';
import { semverCmp } from './releases';
import { BackupRefused, makeSnapshot, removeSnapshot, snapshotPath } from './backup';
import { buildStatus } from './status';
import { GITHUB_REPO, canalCourant, chercherRelease, currentVersion, selfUpdateCapacite } from './version';

interface AuthedRequest extends Request {
  user?: { id: number; email: string; tv: number; rm?: boolean; iat?: number; exp?: number };
}

/** Ce que server.ts fournit : gardes, enveloppe async, confirmation par mot de passe, membre courant, dossier de données. */
export interface SystemDeps {
  requireAdmin: RequestHandler;
  requireMember: RequestHandler;
  jsonSmall: RequestHandler;
  route: (fn: (req: AuthedRequest, res: Response) => Promise<void>) => RequestHandler;
  motDePasseBon: (req: Request, user: UserRow) => Promise<boolean>;
  currentMember: (req: Request) => HouseholdState['members'][number] | null;
  dataDir: string;
}

export function systemRouter(deps: SystemDeps): Router {
  const { requireAdmin, requireMember, jsonSmall, route, motDePasseBon, currentMember, dataDir } = deps;
  const r = express.Router();

  r.get('/version', requireMember, (_req, res) => {
    const cap = selfUpdateCapacite();
    res.json({ current: currentVersion(), selfUpdate: cap.possible, selfUpdateReason: cap.raison, repo: GITHUB_REPO });
  });

  // Savoir qu'une version existe et pouvoir l'installer sont deux choses
  // différentes : la disponibilité s'affiche partout, y compris en Docker, où
  // c'est l'exploitant qui tire l'image. Seul le bouton dépend de la capacité.
  r.get('/update-check', requireMember, route(async (_req, res) => {
    const current = currentVersion();
    const cap = selfUpdateCapacite();
    const socle = { current, selfUpdate: cap.possible, selfUpdateReason: cap.raison, channel: canalCourant() };
    try {
      const rel = await chercherRelease();
      const latest = rel.tag.replace(/^v/, '');
      res.json({
        ...socle, latest, latestTag: rel.tag, name: rel.name,
        notes: rel.body.slice(0, 2000), url: rel.url, publishedAt: rel.publishedAt,
        prerelease: rel.prerelease,
        updateAvailable: semverCmp(latest, current) > 0,
      });
    } catch (e) {
      res.json({ ...socle, error: 'Vérification impossible : ' + (e as Error).message });
    }
  }));

  // Trigger a self-update. The backend only drops a trigger file; a root-owned
  // systemd path unit (installed alongside the helper) performs the actual
  // download/build/restart, so the service keeps its hardening (no sudo).
  r.post('/update', requireAdmin, jsonSmall, route(async (req, res) => {
    const cap = selfUpdateCapacite();
    if (!cap.possible) {
      res.status(400).json({
        error: cap.raison === 'coupee'
          ? 'Mise à jour depuis l’interface refusée sur ce serveur (FOYER_SELF_UPDATE). Mettez à jour depuis la machine.'
          : 'Ce serveur n’a pas le dispositif de mise à jour en un clic. Mettez à jour depuis la machine : « bash deploy/lxc/update.sh » en LXC, « docker compose pull && docker compose up -d » en Docker.',
      });
      return;
    }
    // Le mot de passe, redemandé ici et nulle part ailleurs.
    //
    // Ce bouton fait exécuter du code en root sur la machine : le service dépose
    // un fichier, une unité systemd root télécharge la dernière version et la
    // compile. Le dispositif est bien conçu (le service ne détient aucun droit
    // supplémentaire), mais il fait de « compte administrateur volé » un
    // « root sur l'hyperviseur invité ». Un jeton dérobé sur un téléphone
    // déverrouillé ne doit pas suffire : il faut aussi savoir le mot de passe.
    const moi = req.user ? getUserById(req.user.id) : undefined;
    if (!moi || !await motDePasseBon(req, moi)) {
      log.attention(`Mise à jour refusée : mot de passe incorrect (${req.user?.email || 'compte inconnu'}, depuis ${req.ip}).`);
      res.status(403).json({ error: 'Mot de passe incorrect. Cette mise à jour installe et exécute du code sur le serveur : elle se confirme par votre mot de passe.' });
      return;
    }
    // Quelle version, exactement ?
    //
    // Le helper root sait trouver « la dernière release » tout seul, et
    // /releases/latest ignore les préversions : sur le canal « préversions », il
    // installerait donc la stable pendant que l'écran annonce une rc. On lui
    // nomme la version, il n'a plus à choisir. Une résolution ratée reste sans
    // conséquence sur le canal stable (le helper retombe sur son propre calcul,
    // à l'identique), mais elle est bloquante sur le canal préversion : mieux
    // vaut ne rien installer qu'installer autre chose que ce qui est affiché.
    const canal = canalCourant();
    let cible = '';
    try { cible = (await chercherRelease()).tag; }
    catch (e) {
      if (canal === 'prerelease') {
        res.status(502).json({ error: 'Version à installer indéterminable : ' + (e as Error).message });
        return;
      }
    }
    log.info(`Mise à jour lancée par ${moi.email} depuis ${req.ip}${cible ? ` (${cible})` : ''}.`);
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(path.join(dataDir, 'update-status.json'), JSON.stringify({ state: 'running', message: 'Mise à jour lancée…', ts: Date.now() }));
      // Le contenu de ce fichier est lu par un script qui tourne EN ROOT : rien
      // n'y passe qui ne soit un tag de version, et le helper le revalide de son
      // côté. Sans tag reconnaissable (ancien helper, résolution ratée), il
      // retrouve son comportement d'avant, ce qui garde les deux compatibles.
      const declencheur = /^v?\d[\w.+-]*$/.test(cible) ? `tag=${cible}\n` : String(Date.now());
      fs.writeFileSync(path.join(dataDir, '.update-trigger'), declencheur);
      res.json({ started: true, tag: cible || undefined });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  }));

  /**
   * L'état du service : version, place restante, poids des données, sauvegardes.
   * Réservé aux administrateurs : c'est de l'exploitation, et le chemin des
   * données n'a pas à circuler plus loin que nécessaire.
   */
  r.get('/status', requireAdmin, (_req, res) => {
    const state = getHousehold().state as HouseholdState;
    res.json(buildStatus({
      version: currentVersion(),
      dataDir,
      pushSubject: resolveVapidSubject({ env: process.env.FOYER_VAPID_SUBJECT, publicUrl: String(effectiveSetting('publicUrl') || '') }).subject,
      dbPath: process.env.FOYER_DB_PATH || path.join(dataDir, 'foyer.db'),
      counts: {
        members: (state.members || []).length,
        events: (state.events || []).length,
        tasks: (state.tasks || []).length,
        recipes: (state.recipes || []).length,
      },
    }));
  });

  /**
   * Un instantané cohérent de la base, sans arrêter le service (VACUUM INTO).
   * Il n'emporte ni les fichiers ni les photos : l'écran le dit et donne la
   * commande d'archive complète.
   */
  r.post('/backup', requireAdmin, (req: Request, res: Response) => {
    try {
      const keep = Number(effectiveSetting('backupKeep')) || 7;
      const out = makeSnapshot(db, dataDir, keep);
      log.info(`Sauvegarde : ${out.snapshot.name} (${Math.round(out.snapshot.bytes / 1024)} Ko) écrite par ${currentMember(req)?.id || '(membre inconnu)'}`
        + (out.deleted.length ? `, ${out.deleted.length} ancienne(s) effacée(s)` : '') + '.');
      res.json(out);
    } catch (e) {
      if (e instanceof BackupRefused) { res.status(409).json({ error: e.message }); return; }
      log.erreur('Sauvegarde impossible', e);
      res.status(500).json({ error: 'Sauvegarde impossible : ' + (e as Error).message });
    }
  });

  r.get('/backup/:name', requireAdmin, (req: AuthedRequest, res: Response) => {
    const p = snapshotPath(dataDir, String(req.params.name));
    if (!p) { res.status(404).json({ error: 'Sauvegarde introuvable.' }); return; }
    // Une base entière quitte la machine : c'est le genre de geste qu'on veut
    // pouvoir dater après coup, pas reconstituer de mémoire.
    log.info(`Sauvegarde ${req.params.name} téléchargée par ${req.user?.email || '(compte inconnu)'}.`);
    res.download(p);
  });

  r.delete('/backup/:name', requireAdmin, (req: Request, res: Response) => {
    if (!removeSnapshot(dataDir, String(req.params.name))) { res.status(404).json({ error: 'Sauvegarde introuvable.' }); return; }
    log.info(`Sauvegarde ${req.params.name} effacée.`);
    res.json({ ok: true });
  });

  r.get('/update-status', requireMember, (_req, res) => {
    try {
      const p = path.join(dataDir, 'update-status.json');
      if (fs.existsSync(p)) {
        // Une mise à jour interrompue laissait ce fichier sur « running » pour
        // toujours, et l'interface bloquée sur « Mise à jour en cours… », sans
        // aucun bouton. Voir update-status.ts.
        const status = freshStatus(JSON.parse(fs.readFileSync(p, 'utf-8')), Date.now(), path.join(dataDir, 'update.log'));
        res.json({ ...status, current: currentVersion() });
        return;
      }
    } catch { /* fichier illisible : on repart d'un état neutre plutôt que de bloquer */ }
    res.json({ state: 'idle', current: currentVersion() });
  });

  return r;
}
