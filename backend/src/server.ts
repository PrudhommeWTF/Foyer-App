import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { cacheControlFor } from './static-cache';
import fs from 'fs';
import path from 'path';
import {
  getHousehold,
  db,
  listMemberAccounts,
  saveHousehold,
} from './db';
import { HouseholdState } from './seed';
import { financesRouter } from './finances/routes';
import { calendarRouter } from './calendar/routes';
import { filesRouter } from './storage/routes';
import { shoppingRouter } from './shopping/routes';
import { recipesRouter } from './recipes/routes';
import { preserveShopping, shopItemsOf } from './shopping/repo';
import { tasksRouter } from './tasks/routes';
import { onAssigned, preserveTasks, taskItemsOf } from './tasks/repo';
import { pushRouter } from './notify/routes';
import { initPush, notify } from './notify/push';
import { startScheduler } from './notify/scheduler';
import { suggestPlaces } from './places';
import { searchLogos } from './logos';
import { conflictOf, isUpToDate } from './state/concurrency';
import { StateInvalide, validateState } from './state/validate';
import { settingsRouter } from './settings/routes';
import { deploymentView, effectiveSetting, envOverrides, foreignPrefsChanged, settingsChanged } from './settings/repo';
import { setting } from './settings/registry';
import { LogLevel, log, setLogLevelSource } from './log';
import { currentVersion } from './system/version';
import { systemRouter } from './system/routes';
import { AuthedRequest, auth, currentMember, motDePasseBon, requireAdmin, requireAdulte, requireMember, route } from './auth/session';
import { authRouter } from './auth/routes';

const DATA_DIR = process.env.FOYER_DATA_DIR || path.join(__dirname, '..', 'data');
const PORT = parseInt(process.env.PORT || '8099', 10);

// Le niveau de journalisation est un réglage du foyer, relu à chaque ligne :
// « journalctl -f -u foyer » change de verbosité pendant qu'on le regarde, sans
// redémarrer le service. Le repli sur « info » couvre le démarrage, avant que la
// base ne soit ouverte.
setLogLevelSource(() => {
  try { return effectiveSetting('logLevel') as LogLevel; } catch { return 'info'; }
});
// The frontend uses a relative base href, so a single build works served at the
// root or behind a reverse proxy on a sub-path.
const STATIC_DIR = process.env.FOYER_STATIC_DIR || path.join(__dirname, '..', 'public');


const app = express();

/**
 * À qui l'on fait confiance pour dire d'où vient une requête.
 *
 * `X-Forwarded-For` est un en-tête que **l'appelant** écrit. Le croire n'a de
 * sens que si un proxy l'a réécrit avant nous. Derrière NGINX Proxy Manager
 * configuré comme le décrit docs/mise-en-ligne-checklist.md, c'est le cas, et
 * `1` est la bonne valeur : le dernier maillon est le proxy.
 *
 * Joignable directement, en revanche, l'attaquant EST le maillon, et son en-tête
 * est cru : mesuré, dix tentatives avec « X-Forwarded-For » différent à chaque
 * coup repartaient toutes à zéro, et la temporisation ne servait plus à rien.
 * Deux réponses, complémentaires :
 *
 *   - `FOYER_BIND=127.0.0.1` : le service n'est joignable que par un proxy local,
 *     personne d'autre ne peut être le maillon ;
 *   - `FOYER_TRUST_PROXY=false` : aucun en-tête n'est cru, l'adresse vue est celle
 *     de la connexion. C'est la bonne valeur quand l'application est exposée
 *     directement sur le réseau, sans proxy devant.
 */
const trustProxy = ((): number | boolean => {
  const brut = (process.env.FOYER_TRUST_PROXY || '').trim();
  if (!brut) return 1;
  if (/^(0|false|no|off)$/i.test(brut)) return false;
  const n = parseInt(brut, 10);
  return Number.isInteger(n) && n >= 0 ? n : 1;
})();
app.set('trust proxy', trustProxy);

/** L'interface d'écoute. Voir FOYER_TRUST_PROXY ci-dessus pour le rapport entre les deux. */
const BIND = process.env.FOYER_BIND || '0.0.0.0';

// Security headers. The frontend is a self-hosted SPA that inlines styles and loads
// Google fonts; images come as data:/blob: URLs. upgrade-insecure-requests is disabled
// so plain-HTTP LAN installs (e.g. http://10.x:8099) keep working.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      // Angular pose des styles en ligne ; les polices, elles, sont servies par
      // le foyer depuis que fonts.googleapis.com a été retiré (voir index.html).
      'style-src': ["'self'", "'unsafe-inline'"],
      'font-src': ["'self'", 'data:'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'upgrade-insecure-requests': null,
    },
  },
  crossOriginEmbedderPolicy: false,
  // Un an, avec les sous-domaines. `preload` n'est pas posé : l'inscription sur
  // la liste des navigateurs est difficile à défaire, et ce domaine peut servir
  // à autre chose un jour. L'en-tête ne part que sur HTTPS, les installations
  // locales en clair ne sont pas gênées.
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
}));

/**
 * Ce que la page n'a aucune raison de demander au navigateur.
 *
 * Foyer n'utilise ni la position, ni la caméra, ni le micro, ni le paiement, ni
 * l'USB. Le dire fermement retire ces capacités à tout ce qui s'exécuterait dans
 * la page, y compris à un script qui aurait trouvé le moyen d'y entrer. Helmet
 * ne pose pas cet en-tête, d'où cette ligne.
 */
const PERMISSIONS = [
  'accelerometer=()', 'autoplay=()', 'camera=()', 'display-capture=()', 'encrypted-media=()',
  'fullscreen=(self)', 'geolocation=()', 'gyroscope=()', 'magnetometer=()', 'microphone=()',
  'midi=()', 'payment=()', 'picture-in-picture=()', 'publickey-credentials-get=()',
  'screen-wake-lock=()', 'usb=()', 'xr-spatial-tracking=()',
].join(', ');
app.use((_req, res, next) => { res.setHeader('Permissions-Policy', PERMISSIONS); next(); });

// CORS: same-origin by default (the API serves its own SPA). Extra origins can be
// allow-listed via FOYER_CORS_ORIGINS (comma-separated) for split deployments.
const corsOrigins = (process.env.FOYER_CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : false, // false → no cross-origin; same-origin requests are unaffected
  credentials: true,
}));

// Depuis la migration 5 du document d'état, ni les photos de recettes ni les
// pièces du module Documents ne voyagent dans l'état : les octets vivent sur le
// disque et sont servis par /api/files. Le plafond peut donc redescendre à ce
// que pèse réellement un foyer, texte compris, au lieu des 15 Mo qu'il fallait
// pour un état bourré de data-URL.
// Le corps JSON est parsé PAR ROUTE (et par sous-routeur), chacun avec sa propre
// limite, plutôt que par un parseur global. Monté globalement, body-parser
// marque la requête (`req._body`) dès le premier passage, et tous les parseurs
// posés ensuite, plus fins, étaient sans effet : les limites des sous-routeurs
// (courses, tâches, rappels, recettes, réglages) ne bornaient rien, et à
// l'inverse /finances/restore, qui veut 64 Mo, était plafonné à la limite
// globale de 4 Mo. `jsonDoc` porte le document du foyer (gros), `jsonSmall` le
// reste des routes de server.ts (identifiants, réglages ponctuels).
const jsonDoc = express.json({ limit: '4mb' });
const jsonSmall = express.json({ limit: '256kb' });

/** Le flux ICS, servi sans session : borné pour ne pas devenir un robinet. */
const icsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes sur le flux de calendrier.' },
});

/**
 * L'autocomplétion de lieu tape un service public externe à chaque frappe
 * (débattue côté client) : un plafond poli, par adresse, évite d'en faire un
 * relais de requêtes.
 */
const placesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de recherches de lieu, réessayez dans un instant.' },
});

// La recherche de logo va chercher plusieurs images dehors : plus lourde qu'une
// suggestion de lieu, donc plus économe.
const logosLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de recherches de logo, réessayez dans un instant.' },
});

const api = express.Router();

api.get('/health', (_req, res) => res.json({ ok: true }));

// ---- Comptes, sessions et second facteur (voir auth/routes.ts) ----
// Onboarding, connexion (un ou deux temps), déconnexion, le compte courant et ses
// identifiants, l'enrôlement du second facteur, et la gestion des accès des membres.
api.use(authRouter());

api.get('/state', auth, requireMember, (_req, res) => {
  res.json(getHousehold());
});

api.put('/state', auth, requireMember, jsonDoc, (req: AuthedRequest, res: Response) => {
  // La charpente est vérifiée avant tout le reste, et le refus nomme le champ :
  // sans cela, un tableau remplacé par un nombre s'enregistrait sans un mot et
  // rendait l'écran illisible pour toute la famille. Voir state/validate.ts.
  try {
    validateState(req.body?.state);
  } catch (e) {
    if (e instanceof StateInvalide) {
      log.attention(`État refusé (${req.user?.email || 'compte inconnu'}) : ${e.message}`);
      res.status(400).json({ error: 'Enregistrement refusé : ' + e.message });
      return;
    }
    throw e;
  }
  const state = req.body.state as HouseholdState;

  // Écriture concurrente : le client annonce la version sur laquelle il a
  // travaillé, et n'écrit pas par-dessus plus récent que lui. Voir
  // state/concurrency.ts pour ce que ce refus évite de perdre.
  const currentState = getHousehold();
  if (!isUpToDate(req.body?.version, currentState.version)) {
    res.status(409).json(conflictOf(currentState));
    return;
  }

  // Les réglages ne s'écrivent plus par ici : ils passent par PATCH
  // /api/settings, clé par clé et sous contrôle de portée. Ce qu'un client
  // envoie dans `settings` et `prefs` est donc ignoré, quel que soit son rôle,
  // ce qui ferme la porte que masquer un onglet laissait grande ouverte.
  const me = currentMember(req);
  const avant = currentState.state as HouseholdState;
  if (!me?.admin && settingsChanged(avant.settings, state.settings)) {
    res.status(403).json({ error: 'Seul un administrateur du foyer peut modifier les réglages.' });
    return;
  }
  // Les préférences d'un autre membre ne se modifient pas, même par un
  // administrateur : c'est le pendant de la règle sur la fiche de membre. Un
  // enfant, lui, n'en écrit aucune, pas même les siennes.
  if (me?.enfant && foreignPrefsChanged(avant.prefs, state.prefs, null)) {
    res.status(403).json({ error: 'Les réglages du foyer ne sont pas accessibles depuis ce compte.' });
    return;
  }
  if (foreignPrefsChanged(avant.prefs, state.prefs, me?.id ?? null)) {
    res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres préférences.' });
    return;
  }
  state.settings = avant.settings;
  state.prefs = avant.prefs;

  // Non-admins may edit shared household data, but must not tamper with the member
  // roster: no adding/removing members, no changing anyone's admin flag, and no
  // editing a member other than themselves (which would include self-promotion).
  if (!me?.admin) {
    const current = avant.members || [];
    const next = Array.isArray(state.members) ? state.members : [];
    const byId = (arr: HouseholdState['members']): Map<string, HouseholdState['members'][number]> =>
      new Map(arr.map((m) => [m.id, m]));
    const curMap = byId(current);
    const nextMap = byId(next);

    const sameRoster = current.length === next.length && current.every((m) => nextMap.has(m.id));
    if (!sameRoster) {
      res.status(403).json({ error: 'Seul un administrateur peut ajouter ou retirer un membre' });
      return;
    }
    for (const m of next) {
      const before = curMap.get(m.id)!;
      if (!!before.admin !== !!m.admin) {
        res.status(403).json({ error: 'Seul un administrateur peut modifier les droits d’administration' });
        return;
      }
      // A non-admin may only alter their own member entry.
      if (m.id !== me?.id && JSON.stringify(before) !== JSON.stringify(m)) {
        res.status(403).json({ error: 'Vous ne pouvez modifier que votre propre profil de membre' });
        return;
      }
    }
  }

  // The shopping list never travels in a whole-document save: whatever this
  // client believes about it is discarded in favour of what the server holds.
  // That is what makes an overwrite structurally impossible, however stale the
  // client is. Aisles and lists, on the other hand, ARE edited here, so their
  // consequences for the items are applied server-side.
  const kept = preserveShopping(state as unknown as Record<string, unknown>, avant as unknown as Record<string, unknown>);
  if (kept.movedToFallback || kept.dropped) {
    log.info(
      `Courses : ${kept.movedToFallback} article(s) déplacé(s) vers « À trier » ` +
      `et ${kept.dropped} retiré(s) avec leur liste, à la suite d'une édition des rayons ou des listes.`,
    );
  }

  // Same rule for the tasks: written op by op, never by whole-document PUT.
  const tasks = preserveTasks(state as unknown as Record<string, unknown>, avant as unknown as Record<string, unknown>);
  if (tasks.dropped || tasks.unassigned || tasks.unlinked || tasks.orphaned) {
    log.info(
      `Tâches : ${tasks.dropped} tâche(s) retirée(s) avec leur liste, ${tasks.unassigned} affectation(s) ` +
      `à un membre disparu retirée(s), ${tasks.unlinked} lien(s) vers une liste de courses ou un document disparus retiré(s), ` +
      `${tasks.orphaned} sous-tâche(s) remontée(s) au premier niveau.`,
    );
  }

  const result = saveHousehold(state);
  res.json(result);
});

/**
 * Instantané des sous-arbres qui s'écrivent par opérations : courses et tâches.
 * `since` évite de les renvoyer quand rien n'a bougé : les écrans sondent toutes
 * les cinq secondes tant qu'ils sont visibles, autant que la réponse tienne en
 * trois lignes le reste du temps.
 */
api.get('/live', auth, requireMember, (req: Request, res: Response) => {
  // Courses et tâches vivent dans le même document : un seul parse pour les deux,
  // plutôt qu'un par sous-arbre. Cet endpoint est sondé toutes les cinq secondes
  // par chaque écran ouvert, c'est le plus chaud du service.
  const { state, version } = getHousehold();
  const doc = state as unknown as Record<string, unknown>;
  const since = parseInt(String(req.query['since'] ?? ''), 10);
  if (Number.isInteger(since) && since === version) {
    res.json({ version, unchanged: true });
    return;
  }
  res.json({ version, shop: shopItemsOf(doc), tasks: taskItemsOf(doc) });
});

// ---- Finances (relational tables, granular operations) ----
// Kept out of /api/state on purpose: thousands of transactions must not be
// reloaded and rewritten every time another module saves.
api.use('/finances', auth, requireAdulte, financesRouter(requireAdmin));

// Réglages du foyer : déclarés dans settings/registry.ts, écrits clé par clé
// plutôt que par enregistrement du document entier, pour que deux
// administrateurs qui règlent deux choses ne s'écrasent pas.
api.use('/settings', auth, requireMember, settingsRouter({
  memberId: (req) => currentMember(req as AuthedRequest)?.id ?? null,
  isAdmin: (req) => !!currentMember(req as AuthedRequest)?.admin,
  isChild: (req) => !!currentMember(req as AuthedRequest)?.enfant,
  overrides: () => envOverrides(),
  deployment: () => deploymentView(),
  appVersion: currentVersion,
}));

// Recipe photos and other household files: bytes on disk, never in the state
// document (a data-URL there was re-sent in full on every single save).
api.use('/files', auth, requireMember, filesRouter(
  () => Number(effectiveSetting('maxUploadMb')) * 1024 * 1024,
));

// The shopping list writes item by item rather than by whole-document PUT.
// See shopping/ops.ts for why: two phones ticking at once is the common case.
api.use('/shopping', auth, requireMember, shoppingRouter());

// Tâches : même dispositif, même raison. Voir tasks/ops.ts.
api.use('/tasks', auth, requireMember, tasksRouter());

// Rappels par Web Push : abonnement des appareils, état, test. Voir notify/push.ts.
//
// L'adresse ouverte au tap vient du réglage « Adresse publique de Foyer », que
// `FOYER_PUBLIC_URL` verrouille. Vide, c'est le navigateur qui décide, avec
// l'adresse par laquelle il s'était abonné : elle échoue depuis l'extérieur
// quand c'était une adresse locale, d'où l'intérêt de pouvoir la poser sans
// éditer un fichier sur le serveur.
const appUrl = (): string => String(effectiveSetting('publicUrl') || '');
api.use('/push', auth, requireMember, pushRouter((req) => currentMember(req as AuthedRequest)?.id ?? null, appUrl));

// La seule sortie réseau du module Cuisine : l'import d'une recette depuis une
// URL, déclenché par l'utilisateur, journalisé, coupable par FOYER_RECIPE_IMPORT.
api.use('/recipes', auth, requireMember, recipesRouter(() => effectiveSetting('recipeImport') === true));

// ---- Calendrier partagé (vacances scolaires, lien et flux ICS) : voir calendar/routes.ts ----
api.use('/calendar', calendarRouter({ auth, requireMember, requireAdmin, icsLimiter, route }));

// Autocomplétion du lieu d'un événement, relayée vers la Base Adresse Nationale.
// Coupable par le réglage `placeSuggest` : éteint, la route ne sort pas et rend
// une liste vide (le champ reste une saisie libre). Voir places.ts.
api.get('/places/suggest', auth, requireMember, placesLimiter, async (req: Request, res: Response) => {
  if (effectiveSetting('placeSuggest') !== true) { res.json({ suggestions: [] }); return; }
  res.json({ suggestions: await suggestPlaces(String(req.query['q'] || '')) });
});

// Logos proposés pour une carte de fidélité, à partir de son nom. Coupable par le
// réglage `cardLogoSearch` : éteint, la route rend une liste vide (le monogramme
// tient lieu de logo). Voir logos.ts.
api.get('/cards/logos', auth, requireMember, logosLimiter, async (req: Request, res: Response) => {
  if (effectiveSetting('cardLogoSearch') !== true) { res.json({ logos: [] }); return; }
  res.json({ logos: await searchLogos(String(req.query['name'] || '')) });
});

// ---- System / self-update / exploitation (voir system/routes.ts) ----
api.use('/system', auth, systemRouter({ requireAdmin, requireMember, jsonSmall, route, motDePasseBon, currentMember, dataDir: DATA_DIR }));

app.use('/api', api);

// Un corps trop gros ressortait en page HTML d'Express, sans dire pourquoi ni
// quoi faire. Ce gestionnaire d'erreur est monté APRÈS l'API : les parseurs
// vivant désormais dans les routes, c'est ici que leur erreur « entity.too.large »
// remonte. Le message vise le cas de loin le plus courant, le document du foyer
// (jsonDoc, 4 Mo) : s'il déborde, c'est presque toujours qu'une pièce n'a pas su
// être décodée à la migration et pèse encore dans l'état, que le journal nomme.
app.use((err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type !== 'entity.too.large') { next(err); return; }
  res.status(413).json({
    error: 'Enregistrement refusé : le document du foyer dépasse la taille maximale (4 Mo). '
      + 'Les fichiers et les photos sont rangés sur le disque, pas dans l’état : un état de cette taille '
      + 'signale qu’il en reste, en général une pièce que la migration n’a pas su décoder. '
      + 'Le journal de démarrage (journalctl -u foyer) nomme les fiches concernées.',
  });
});

// ---- Static frontend (single-container deployment) ----
if (fs.existsSync(STATIC_DIR)) {
  // `index: false` laisse la route ci-dessous servir index.html, pour que la
  // racine et une adresse profonde reçoivent exactement les mêmes en-têtes.
  app.use(express.static(STATIC_DIR, {
    index: false,
    setHeaders: (res, filePath) => res.setHeader('Cache-Control', cacheControlFor(filePath)),
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    // Une adresse qui ressemble à un fichier et qui n'existe pas est une
    // absence, pas une route de l'application. Répondre index.html avec un 200
    // faisait conclure à un scanner que /.git/config, /.env et /wp-login.php
    // existaient tous : rien ne fuyait, mais les journaux du proxy devenaient
    // illisibles et chaque sonde repartait avec une réponse encourageante.
    const segments = req.path.split('/').filter(Boolean);
    const dernier = segments[segments.length - 1] ?? '';
    // Un segment caché (« /.git/config ») compte autant qu'une extension au
    // bout : c'est le répertoire qui porte le point, et c'est le chemin que
    // sondent le plus les robots.
    if (dernier.includes('.') || segments.some((seg) => seg.startsWith('.'))) {
      res.status(404).type('text/plain').send('Introuvable');
      return;
    }
    // Jamais de cache sur le document : c'est lui qui nomme les fichiers de
    // l'application, donc le garder revient à garder la version d'avant.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });
}

export { app };

/**
 * Ce que le service fait en plus de répondre : les rappels et l'écoute réseau.
 *
 * Séparé du montage des routes pour une raison précise : les tests de sécurité
 * doivent pouvoir monter **les vraies routes, avec leurs vrais gardes**, sans
 * ouvrir de port ni démarrer un planificateur qui enverrait des notifications
 * pendant la CI. Un garde éprouvé sur une application reconstruite pour le test
 * n'éprouve que la copie.
 */
export function start(): void {
  // ---- Rappels : clés VAPID, affectations, planificateur ----
  // Les clés sont générées une fois et gardées en base : en changer invaliderait
  // tous les abonnements. FOYER_VAPID_PUBLIC / FOYER_VAPID_PRIVATE les remplacent.
  const vapid = initPush(
    db,
    { publicKey: process.env.FOYER_VAPID_PUBLIC, privateKey: process.env.FOYER_VAPID_PRIVATE, subject: process.env.FOYER_VAPID_SUBJECT },
    () => String(effectiveSetting('publicUrl') || ''),
  );
  log.info(`Notifications : Web Push prêt (${vapid.generated ? 'clés VAPID générées et gardées en base' : 'clés VAPID existantes'}), `
    + `contact déclaré aux services push : ${vapid.subject.subject}`);
  if (vapid.subject.rejected) {
    // Le dire au démarrage, pas au premier rappel raté : un refus d'Apple se
    // présente comme un « HTTP 403 » et n'apprend rien à qui le lit.
    log.attention(`Notifications : le contact « ${vapid.subject.rejected.value} » a été écarté (${vapid.subject.rejected.reason}). `
      + `Posez FOYER_VAPID_SUBJECT, ou renseignez l’adresse publique du foyer dans Paramètres, section « Notifications ».`);
  }

  const notifLog = (line: string): void => log.info(line);

  /**
   * Ce membre veut-il ce genre de rappel sur son téléphone ?
   *
   * La préférence est personnelle : chacun coupe les siennes sans rien imposer
   * aux autres. Le foyer, lui, peut tout suspendre d'un geste (`pushPaused`).
   */
  const memberWants = (memberId: string, kind: 'reminder' | 'assigned'): boolean => {
    const state = getHousehold().state as HouseholdState;
    // Les deux clés sont écrites en toutes lettres : une clé calculée ne dit rien
    // au garde-fou de la CI, qui ne saurait plus si ces réglages servent.
    return kind === 'reminder'
      ? setting('pushReminders', state, memberId)
      : setting('pushAssigned', state, memberId);
  };

  // Quelqu'un d'autre vient de m'affecter une tâche : tout de suite, pas à la minute.
  onAssigned((memberId, task, opId) => {
    // Le foyer a suspendu les rappels, ou ce membre ne veut pas être prévenu des
    // affectations : rien ne part, et rien n'est noté comme manqué.
    if (effectiveSetting('pushPaused') === true || !memberWants(memberId, 'assigned')) return;
    const by = task.by ? (getHousehold().state as HouseholdState).members.find((m) => m.id === task.by)?.name : '';
    void notify(`assign|${opId}|${memberId}`, [memberId], {
      kind: 'assigned', title: task.text, body: (by ? by + ' vous a affecté cette tâche' : 'Une tâche vous a été affectée') + (task.due ? ' · ' + task.due.split('-').reverse().join('/') : ''),
      url: appUrl(), taskId: task.id, tag: 'task-' + task.id,
    }).then((r) => {
      const m = r.members[0];
      if (m && m.status !== 'skipped') notifLog(`Notifications : affectation « ${task.text} » → ${memberId} : ${m.status}${m.error ? ' (' + m.error + ')' : ''}`);
    }).catch((e) => notifLog('Notifications : affectation non envoyée : ' + (e as Error).message));
  });

  startScheduler({
    tasks: () => (getHousehold().state as HouseholdState).tasks || [],
    lists: () => (getHousehold().state as HouseholdState).taskLists || [],
    members: () => {
      const accts = new Set(listMemberAccounts().map((a) => a.memberId));
      return (getHousehold().state as HouseholdState).members.map((m) => ({ id: m.id, name: m.name, adult: !m.enfant, hasAccount: accts.has(m.id) }));
    },
    accounts: () => listMemberAccounts().map((a) => a.memberId),
    url: appUrl,
    rules: () => ({
      paused: effectiveSetting('pushPaused') === true,
      quiet: { from: String(effectiveSetting('quietFrom')), to: String(effectiveSetting('quietTo')) },
    }),
    wants: memberWants,
    log: notifLog,
  });

  // Le dire au démarrage plutôt qu'au premier bourrage : cru sur une interface
  // ouverte, X-Forwarded-For rend la temporisation contournable par quiconque
  // joint le port directement.
  if (trustProxy !== false && BIND === '0.0.0.0') {
    log.attention(
      'Sécurité : le service écoute sur toutes les interfaces ET fait confiance à X-Forwarded-For. '
      + 'Quiconque joint le port directement peut donc se faire passer pour l’adresse de son choix, et contourner '
      + 'la temporisation des tentatives de connexion. Posez FOYER_BIND=127.0.0.1 si un proxy tourne sur la même '
      + 'machine, filtrez le port au pare-feu sinon, ou posez FOYER_TRUST_PROXY=false s’il n’y a aucun proxy devant.',
    );
  }

  app.listen(PORT, BIND, () => {
    log.info(`API + app disponibles sur http://${BIND}:${PORT}`);
  });
}

// Lancé comme service : on démarre. Importé par un test : on ne démarre pas.
if (require.main === module) start();
