// Surface HTTP du module « École », montée sur /api/ecole derrière le drapeau
// de module (403 désactivé). Cette première tranche ne porte que la
// configuration : comptes, question de sécurité, association des élèves,
// journal. Tout est réservé aux administrateurs.
//
// Aucune réponse ne contient d'identifiant, de mot de passe, de jeton, ni le
// couple cn / cv : seulement « enregistrés le … » et « connu depuis le … ».
import express, { Request, Response, Router } from 'express';
import * as repo from './repo';
import * as svc from './service';
import * as backup from './backup';
import { edConfig } from './config';
import { inQuietWindow, nextRunAt } from './cadence';
import { Invalid, fail, id } from '../employes/http';
import { keyState, open } from '../storage/secret-box';
import { parisWall } from '../notify/reminders';
import { log } from '../log';

type Guard = (req: Request, res: Response, next: express.NextFunction) => void;

/** Comme le `makeHandler` d'Employés, pour des handlers asynchrones. */
const handler = (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response): void => {
    Promise.resolve().then(() => fn(req, res)).catch((e) => {
      if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
      log.erreur('École : erreur inattendue', e);
      res.status(500).json({ error: 'Erreur du module École : ' + (e as Error).message });
    });
  };

const text = (v: unknown, field: string, max: number, required = true): string => {
  const s = String(v ?? '').trim();
  if (!s && required) fail(`Le champ « ${field} » est requis.`);
  if (s.length > max) fail(`Le champ « ${field} » dépasse ${max} caractères.`);
  return s;
};

/** Un mot de passe n'est jamais rogné : une espace en bout peut en faire partie. */
const password = (v: unknown): string => {
  const s = String(v ?? '');
  if (!s) fail('Le champ « mot de passe » est requis.');
  if (s.length > 200) fail('Le mot de passe dépasse 200 caractères.');
  return s;
};

export type AccountState = 'ok' | 'jamais' | 'erreur' | 'qcm' | 'identifiants' | 'version' | 'cle' | 'pause' | 'pause-auto';

/** L'état affiché d'un compte. Une clé changée se voit tout de suite, sans attendre une connexion. */
function stateOf(a: repo.Account, now: Date): AccountState {
  if (a.blocked) return a.blocked;
  if (open(a.loginEnc) === null || open(a.passwordEnc) === null) return 'cle';
  if (!a.enabled) return 'pause';
  if (a.pausedUntil && Date.parse(a.pausedUntil) > now.getTime()) return 'pause-auto';
  if (a.lastSyncOk === null) return 'jamais';
  return a.lastSyncOk ? 'ok' : 'erreur';
}

function accountView(a: repo.Account, students: repo.Student[], now: Date) {
  const state = stateOf(a, now);
  return {
    id: a.id, label: a.label, accountType: a.accountType, state,
    credsSetAt: a.credsSetAt,
    trustedSince: a.trustedCnEnc && a.trustedCvEnc ? a.trustedAt : null,
    pendingQcm: a.pendingQcm,
    enabled: a.enabled,
    lastSyncAt: a.lastSyncAt, lastOkAt: a.lastOkAt,
    lastError: a.lastErrorAt ? { at: a.lastErrorAt, code: a.lastErrorCode, kind: a.lastErrorKind, message: a.lastErrorMessage } : null,
    consecutiveFailures: a.consecutiveFailures, pausedUntil: a.pausedUntil,
    /** Les administrateurs ont été prévenus de l'incident en cours, à cette date. */
    alertedAt: a.alertSentAt,
    nextRunAt: state === 'cle' ? null : nextRunAt(a, now, svc.cadence()),
    students: students.filter((s) => s.accountId === a.id).map((s) => ({
      id: s.id, firstName: s.firstName, lastName: s.lastName, className: s.className, schoolName: s.schoolName,
      memberId: s.memberId, matchSource: s.matchSource, linkState: s.linkState,
    })),
  };
}

const account = (raw: unknown): repo.Account => {
  const a = repo.getAccount(id(raw, 'compte'));
  if (!a || a.archivedAt) fail('Compte ÉcoleDirecte introuvable.');
  return a!;
};

export function ecoleRouter(requireAdmin: Guard, memberIds: () => string[]): Router {
  const r = express.Router();
  r.use(requireAdmin);

  // Avant l'analyseur commun, borné à 64 Ko : une sauvegarde est plus grosse.
  r.post('/restore', express.json({ limit: '20mb' }), handler((req, res) => {
    const b = req.body as Record<string, unknown>;
    if (b['confirm'] !== 'REMPLACER') { res.status(400).json({ error: 'Confirmation requise : renvoyez confirm="REMPLACER".' }); return; }
    try {
      const report = backup.restoreModule(b['backup']);
      log.info('École : module restauré depuis une sauvegarde.');
      res.json(report);
    } catch (e) {
      if (e instanceof backup.RestoreRefused) { res.status(400).json({ error: e.message }); return; }
      throw e;
    }
  }));

  r.use(express.json({ limit: '64kb' }));

  const view = (a: repo.Account) => accountView(repo.getAccount(a.id)!, repo.listStudents(), new Date());

  r.get('/etat', handler((_req, res) => {
    const now = new Date();
    const students = repo.listStudents();
    const cfg = edConfig();
    res.json({
      keyState: keyState(),
      apiBase: cfg.base, apiVersion: cfg.version,
      inPause: inQuietWindow(parisWall(now), svc.cadence()),
      accounts: repo.listAccounts().map((a) => accountView(a, students, now)),
      journal: repo.listLog(40),
    });
  }));

  r.post('/comptes', handler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    if (keyState() !== 'ok') fail('Impossible d’enregistrer des identifiants : la clé de chiffrement FOYER_SECRET_KEY est ' + (keyState() === 'absente' ? 'absente' : 'trop courte') + '. Voir docs/ecole.md.');
    const out = await svc.createAccount(text(b['label'], 'libellé', 80), text(b['identifiant'], 'identifiant', 120), password(b['motdepasse']));
    res.status(201).json({ result: out.result, account: view(repo.getAccount(out.id)!) });
  }));

  r.put('/comptes/:id', handler(async (req, res) => {
    const a = account(req.params['id']);
    const b = req.body as Record<string, unknown>;
    const label = b['label'] !== undefined ? text(b['label'], 'libellé', 80) : null;
    const withCreds = b['identifiant'] !== undefined || b['motdepasse'] !== undefined;
    if (withCreds && keyState() !== 'ok') fail('Impossible d’enregistrer des identifiants : la clé de chiffrement FOYER_SECRET_KEY est absente ou trop courte.');
    svc.updateAccount(a.id, label, withCreds ? text(b['identifiant'], 'identifiant', 120) : null, withCreds ? password(b['motdepasse']) : null);
    // De nouveaux identifiants s'essaient tout de suite : c'est la réponse qu'on attend en les saisissant.
    const result = withCreds && repo.getAccount(a.id)!.enabled ? await svc.connect(a.id) : null;
    res.json({ result, account: view(a) });
  }));

  r.post('/comptes/:id/connexion', handler(async (req, res) => {
    const a = svc.releaseBlocks(account(req.params['id']));
    if (a.blocked === 'qcm') fail('Répondez d’abord à la question de sécurité.');
    if (a.blocked === 'identifiants') fail('ÉcoleDirecte a refusé ces identifiants : ressaisissez-les avant de réessayer.');
    if (a.blocked === 'cle' || stateOf(a, new Date()) === 'cle') fail('Identifiants à ressaisir : la clé de chiffrement a changé.');
    // Le bouton reste un geste humain, mais pas un marteau : une tentative par minute.
    if (a.lastSyncAt && Date.now() - Date.parse(a.lastSyncAt) < 60_000) { res.status(429).json({ error: 'Une connexion vient d’avoir lieu : patientez une minute avant de réessayer.' }); return; }
    const result = await svc.connect(a.id);
    res.json({ result, account: view(a) });
  }));

  r.post('/comptes/:id/qcm', handler(async (req, res) => {
    const a = account(req.params['id']);
    const choix = Number((req.body as Record<string, unknown>)['choix']);
    if (!Number.isInteger(choix) || choix < 0) fail('Choisissez une des propositions.');
    const result = await svc.answerQcm(a.id, choix);
    res.json({ result, account: view(a) });
  }));

  r.post('/comptes/:id/pause', handler((req, res) => {
    const a = account(req.params['id']);
    svc.setPaused(a.id, (req.body as Record<string, unknown>)['pause'] === true);
    res.json({ account: view(a) });
  }));

  r.delete('/comptes/:id', handler((req, res) => {
    const a = account(req.params['id']);
    repo.archiveAccount(a.id, new Date().toISOString());
    log.info(`École : compte ${a.id} « ${a.label} » retiré, identifiants effacés.`);
    res.json({ ok: true });
  }));

  // Association d'un élève à un membre : confirmer la proposition, choisir à la
  // main, ignorer l'élève, ou défaire.
  r.put('/eleves/:id', handler((req, res) => {
    const s = repo.getStudent(id(req.params['id'], 'élève'));
    if (!s || s.archivedAt) fail('Élève introuvable.');
    const b = req.body as Record<string, unknown>;
    const action = String(b['action'] ?? '');
    if (action === 'confirmer') {
      if (s!.linkState !== 'propose' || !s!.memberId) fail('Aucune association proposée à confirmer.');
      repo.setLink(s!.id, s!.memberId, s!.matchSource, 'confirme');
    } else if (action === 'associer') {
      const memberId = text(b['memberId'], 'membre', 64);
      if (!memberIds().includes(memberId)) fail('Membre du foyer introuvable.');
      repo.setLink(s!.id, memberId, s!.memberId === memberId && s!.matchSource === 'prenom' ? 'prenom' : 'manuel', 'confirme');
    } else if (action === 'ignorer') {
      repo.setLink(s!.id, null, null, 'ignore');
    } else if (action === 'dissocier') {
      repo.setLink(s!.id, null, null, 'aucun');
    } else fail('Action inconnue : confirmer, associer, ignorer ou dissocier.');
    const after = repo.getStudent(s!.id)!;
    log.info(`École : élève ${after.id} (compte ${after.accountId}) : ${action}${after.memberId ? ' → membre ' + after.memberId : ''}.`);
    res.json({ account: view(repo.getAccount(after.accountId)!) });
  }));

  r.get('/export.json', handler((_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="foyer-ecole-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(backup.exportModule());
  }));

  return r;
}
