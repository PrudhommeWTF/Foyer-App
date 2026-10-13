// Le service du module « École » : il appelle le client ÉcoleDirecte et écrit
// ce qui en sort dans les tables ed_*. C'est le seul fichier, avec la sonde, qui
// importe le client ; routes, écrans et planificateur ne lisent que les tables.
//
// Règles de conduite envers le serveur ÉcoleDirecte, qui bloque les comptes
// trop insistants :
//   - un seul échange à la fois dans tout le service (`exclusive`) ;
//   - une seule tentative de connexion par passage, jamais de nouvel essai
//     immédiat ;
//   - question de sécurité (250), identifiants refusés (505), version refusée
//     (517), clé de chiffrement perdue : le compte se bloque et attend un geste
//     humain, sans plus rien envoyer ;
//   - erreurs passagères (réseau, 5xx, 535) : au troisième échec de suite,
//     pause automatique de six heures ;
//   - chaque incident prévient les administrateurs une fois, pas à chaque passage.
//
// Le journal (`log.*`) dit le compte, le périmètre, la durée et le code
// ÉcoleDirecte. Jamais l'identifiant, le mot de passe, le jeton, cn ni cv.
import { EdClient, EdError, EdSession, LoginOutcome, Trusted } from './client';
import * as repo from './repo';
import { MemberLite, propose } from './match';
import { edConfig } from './config';
import { Cadence, inQuietWindow, isDue, mayRun } from './cadence';
import { open, seal } from '../storage/secret-box';
import { effectiveSetting } from '../settings/repo';
import { parisWall } from '../notify/reminders';
import { log } from '../log';

export interface EcoleDeps {
  members: () => MemberLite[];
  /** Prévient les administrateurs (Web Push). Branché au démarrage du service, inerte en test. */
  alertAdmins: (key: string, title: string, body: string) => void;
}
let deps: EcoleDeps = { members: () => [], alertAdmins: () => undefined };
export function setEcoleDeps(d: Partial<EcoleDeps>): void { deps = { ...deps, ...d }; }

export type ConnectResult =
  | { kind: 'ok'; students: number }
  | { kind: 'qcm'; question: string; propositions: string[]; changed?: boolean }
  | { kind: 'erreur'; errorKind: string; code: number | null; message: string };

/** Pause automatique après ce nombre d'échecs passagers de suite. */
export const MAX_FAILURES = 3;
export const AUTO_PAUSE_MS = 6 * 3600_000;
/** Une question de sécurité gardée en mémoire au-delà ne sert plus : on repart d'une connexion. */
const CHALLENGE_TTL_MS = 10 * 60_000;

// Un seul échange avec ÉcoleDirecte à la fois : planificateur et boutons
// « Synchroniser maintenant » passent tous par cette file.
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}

/** La session ouverte par un code 250, pour répondre sans se reconnecter si l'administrateur est rapide. */
const challenges = new Map<number, { session: EdSession; question: string; at: number }>();

/** La cadence telle que les réglages du foyer la fixent. */
export function cadence(): Cadence {
  return {
    refreshMin: Number(effectiveSetting('ecoleRefreshMin')) || 30,
    pauseFrom: String(effectiveSetting('ecolePauseDebut')),
    pauseTo: String(effectiveSetting('ecolePauseFin')),
    sundayFrom: String(effectiveSetting('ecoleDimancheDebut')),
  };
}

const client = (): EdClient => new EdClient(edConfig());
const tag = (a: repo.Account): string => `compte ${a.id} « ${a.label} »`;
const ms = (t0: number): number => Date.now() - t0;

/** Les identifiants en clair, ou null si la clé ne permet pas de les rouvrir. Jamais journalisés. */
function credentials(a: repo.Account): { login: string; password: string; trusted: Trusted | null } | null {
  const login = open(a.loginEnc), password = open(a.passwordEnc);
  if (login === null || password === null) return null;
  const cn = open(a.trustedCnEnc), cv = open(a.trustedCvEnc);
  return { login, password, trusted: cn && cv ? { cn, cv } : null };
}

/** Une alerte par incident : effacée au prochain succès ou à la ressaisie des identifiants. */
function alertOnce(a: repo.Account, reason: string, body: string): void {
  if (a.alertSentAt) return;
  const now = new Date().toISOString();
  repo.patchAccount(a.id, { alertSentAt: now });
  log.info(`École : ${tag(a)} : administrateurs prévenus (${reason}).`);
  deps.alertAdmins(`ecole|${a.id}|${reason}|${now}`, 'ÉcoleDirecte : ' + a.label, body);
}

function blockForKey(a: repo.Account): ConnectResult {
  const message = 'Identifiants à ressaisir : la clé de chiffrement FOYER_SECRET_KEY manque ou a changé depuis leur enregistrement.';
  repo.patchAccount(a.id, { blocked: 'cle', lastSyncOk: false, lastErrorAt: new Date().toISOString(), lastErrorKind: 'cle', lastErrorCode: null, lastErrorMessage: message });
  repo.addLog({ accountId: a.id, scope: 'connexion', ok: false, httpStatus: null, edCode: null, message, durationMs: 0 });
  log.attention(`École : ${tag(a)} : ${message}`);
  alertOnce(a, 'cle', 'Identifiants ÉcoleDirecte à ressaisir dans Paramètres, section École.');
  return { kind: 'erreur', errorKind: 'cle', code: null, message };
}

function onSuccess(a: repo.Account, out: Extract<LoginOutcome, { kind: 'ok' }>, t0: number): ConnectResult {
  const now = new Date().toISOString();
  const members = deps.members();
  const infos = out.accounts.flatMap((acc) => acc.students);
  const unique = [...new Map(infos.map((e) => [e.edId, e])).values()];
  const main = out.accounts.find((x) => x.main) || out.accounts.find((x) => x.type !== 'autre') || out.accounts[0];
  let proposed = 0;
  const prior = repo.listStudents(true);
  for (const e of unique) {
    const st = repo.upsertSeenStudent(a.id, { edStudentId: e.edId, idLogin: e.idLogin, firstName: e.firstName, lastName: e.lastName, className: e.className, schoolName: e.schoolName, modules: e.modules }, now);
    if (st.linkState !== 'aucun') continue;
    const p = propose(st.firstName, st.lastName, members, prior.filter((x) => x.id !== st.id));
    if (p) { repo.setLink(st.id, p.memberId, p.matchSource, 'propose'); proposed++; }
  }
  const archived = repo.archiveMissingStudents(a.id, unique.map((e) => e.edId), now);
  repo.patchAccount(a.id, {
    accountType: main?.type === 'famille' || main?.type === 'eleve' ? main.type : null, edUserId: main?.edUserId ?? null,
    lastSyncAt: now, lastSyncOk: true, lastOkAt: now, consecutiveFailures: 0, pausedUntil: null,
    blocked: null, blockedDetail: null, pendingQcm: null, alertSentAt: null,
  });
  challenges.delete(a.id);
  const message = `Connexion réussie : ${unique.length} élève${unique.length > 1 ? 's' : ''}`
    + (proposed ? `, ${proposed} association${proposed > 1 ? 's' : ''} proposée${proposed > 1 ? 's' : ''}` : '')
    + (archived ? `, ${archived} élève${archived > 1 ? 's' : ''} archivé${archived > 1 ? 's' : ''}` : '') + '.';
  repo.addLog({ accountId: a.id, scope: 'connexion', ok: true, httpStatus: 200, edCode: 200, message, durationMs: ms(t0) });
  log.info(`École : ${tag(a)} : connexion : ${message} (${ms(t0)} ms, code 200)`);
  return { kind: 'ok', students: unique.length };
}

function onQcm(a: repo.Account, out: Extract<LoginOutcome, { kind: 'qcm' }>, hadTrusted: boolean, t0: number, changed = false): ConnectResult {
  const now = new Date().toISOString();
  challenges.set(a.id, { session: out.challenge, question: out.question, at: Date.now() });
  repo.patchAccount(a.id, {
    pendingQcm: { question: out.question, propositions: out.propositions, askedAt: now },
    blocked: 'qcm', lastSyncAt: now, lastSyncOk: false,
    // Un appareil de confiance que le serveur ne reconnaît plus ne sert plus à rien.
    ...(hadTrusted ? { trustedCnEnc: null, trustedCvEnc: null, trustedAt: null } : {}),
  });
  const message = (changed ? 'La question de sécurité a changé depuis son affichage' : 'Question de sécurité demandée')
    + (hadTrusted ? ' (l’appareil de confiance n’est plus reconnu)' : '') + ' : en attente de réponse dans Paramètres.';
  repo.addLog({ accountId: a.id, scope: 'connexion', ok: false, httpStatus: 200, edCode: 250, message, durationMs: ms(t0) });
  log.attention(`École : ${tag(a)} : ${message} (${ms(t0)} ms, code 250). Aucune nouvelle connexion avant la réponse.`);
  alertOnce(a, 'qcm', 'Question de sécurité ÉcoleDirecte à répondre dans Paramètres, section École.');
  return { kind: 'qcm', question: out.question, propositions: out.propositions, changed };
}

function onFailure(a: repo.Account, e: unknown, scope: string, t0: number): ConnectResult {
  const err = e instanceof EdError ? e : new EdError('inattendu', 'Erreur inattendue : ' + (e as Error).message);
  const now = new Date().toISOString();
  const patch: repo.AccountPatch = { lastSyncAt: now, lastSyncOk: false, lastErrorAt: now, lastErrorCode: err.code, lastErrorKind: err.kind, lastErrorMessage: err.message };
  let suite = '';
  if (err.kind === 'identifiants') {
    patch.blocked = 'identifiants';
    suite = ' Compte bloqué jusqu’à la ressaisie des identifiants.';
  } else if (err.kind === 'version') {
    patch.blocked = 'version'; patch.blockedDetail = edConfig().version;
    suite = ' Compte bloqué jusqu’au changement de FOYER_ED_API_VERSION.';
  } else {
    const n = a.consecutiveFailures + 1;
    patch.consecutiveFailures = n;
    if (n >= MAX_FAILURES) {
      patch.pausedUntil = new Date(Date.now() + AUTO_PAUSE_MS).toISOString();
      suite = ` ${n} échecs de suite : pause automatique de 6 h.`;
    }
  }
  repo.patchAccount(a.id, patch);
  repo.addLog({ accountId: a.id, scope, ok: false, httpStatus: err.httpStatus, edCode: err.code, message: err.message + suite, durationMs: ms(t0) });
  log.attention(`École : ${tag(a)} : ${scope} : ${err.message}${suite} (${ms(t0)} ms, code ${err.code ?? '-'}, HTTP ${err.httpStatus ?? '-'})`);
  if (patch.blocked || patch.pausedUntil) alertOnce(a, String(patch.blocked || 'pause'), err.message + suite);
  return { kind: 'erreur', errorKind: err.kind, code: err.code, message: err.message + suite };
}

async function connectNow(id: number): Promise<ConnectResult> {
  const a = repo.getAccount(id);
  if (!a || a.archivedAt) return { kind: 'erreur', errorKind: 'inattendu', code: null, message: 'Compte introuvable.' };
  const creds = credentials(a);
  if (!creds) return blockForKey(a);
  const t0 = Date.now();
  try {
    const out = await client().login(creds.login, creds.password, creds.trusted);
    return out.kind === 'ok' ? onSuccess(a, out, t0) : onQcm(a, out, !!creds.trusted, t0);
  } catch (e) { return onFailure(a, e, 'connexion', t0); }
}

/** Une connexion, à la file. Le planificateur et le bouton « Synchroniser maintenant » passent par ici. */
export function connect(id: number): Promise<ConnectResult> { return exclusive(() => connectNow(id)); }

/**
 * Répond à la question de sécurité par le numéro d'une proposition. Si la
 * session du 250 a expiré, une connexion neuve la redemande ; si la question a
 * changé entre-temps, on affiche la nouvelle au lieu de répondre à l'aveugle.
 */
export function answerQcm(id: number, index: number): Promise<ConnectResult> {
  return exclusive(async () => {
    const a = repo.getAccount(id);
    if (!a || a.archivedAt) return { kind: 'erreur', errorKind: 'inattendu', code: null, message: 'Compte introuvable.' };
    const q = a.pendingQcm;
    const choice = q?.propositions[index];
    if (!q || choice === undefined) return { kind: 'erreur', errorKind: 'inattendu', code: null, message: 'Aucune question de sécurité en attente, ou proposition inconnue.' };
    const creds = credentials(a);
    if (!creds) return blockForKey(a);
    const c = client();
    const t0 = Date.now();
    let cached = challenges.get(id);
    if (cached && (Date.now() - cached.at > CHALLENGE_TTL_MS || cached.question !== q.question)) cached = undefined;
    let trusted: Trusted | null = null;
    for (let attempt = 0; attempt < 2 && !trusted; attempt++) {
      try {
        let session = cached?.session;
        if (!session) {
          // Sans l'appareil de confiance : c'est justement lui qu'on vient chercher.
          const out = await c.login(creds.login, creds.password, null);
          if (out.kind === 'ok') return onSuccess(a, out, t0);
          if (out.question !== q.question || !out.propositions.includes(choice)) return onQcm(a, out, false, t0, true);
          session = out.challenge;
        }
        trusted = await c.answerQcm(session, choice);
      } catch (e) {
        // Session du 250 expirée pendant l'attente : une fois, on repart d'une connexion neuve.
        if (cached && e instanceof EdError && e.kind === 'jeton') { cached = undefined; continue; }
        challenges.delete(id);
        const err = e instanceof EdError ? e : new EdError('inattendu', (e as Error).message);
        const message = 'Réponse à la question de sécurité refusée : ' + err.message + ' La question reste affichée ; une mauvaise réponse compte comme une tentative.';
        repo.patchAccount(id, { lastErrorAt: new Date().toISOString(), lastErrorCode: err.code, lastErrorKind: err.kind, lastErrorMessage: message });
        repo.addLog({ accountId: id, scope: 'qcm', ok: false, httpStatus: err.httpStatus, edCode: err.code, message, durationMs: ms(t0) });
        log.attention(`École : ${tag(a)} : qcm : ${message} (${ms(t0)} ms, code ${err.code ?? '-'})`);
        return { kind: 'erreur', errorKind: err.kind, code: err.code, message };
      }
    }
    challenges.delete(id);
    if (!trusted) return { kind: 'erreur', errorKind: 'jeton', code: null, message: 'Session ÉcoleDirecte expirée : réessayez.' };
    const now = new Date().toISOString();
    repo.patchAccount(id, { trustedCnEnc: seal(trusted.cn), trustedCvEnc: seal(trusted.cv), trustedAt: now, pendingQcm: null, blocked: null });
    repo.addLog({ accountId: id, scope: 'qcm', ok: true, httpStatus: 200, edCode: 200, message: 'Question de sécurité répondue : appareil de confiance enregistré.', durationMs: ms(t0) });
    log.info(`École : ${tag(a)} : qcm : appareil de confiance enregistré (${ms(t0)} ms). Reconnexion avec lui.`);
    return connectNow(id);
  });
}

/** Nouveau compte : identifiants chiffrés (refus explicite si la clé manque), puis première connexion. */
export async function createAccount(label: string, login: string, password: string): Promise<{ id: number; result: ConnectResult }> {
  const now = new Date().toISOString();
  const id = repo.createAccount(label, seal(login), seal(password), now);
  log.info(`École : compte ${id} « ${label} » ajouté.`);
  return { id, result: await connect(id) };
}

/**
 * Libellé et identifiants. Ressaisir les identifiants lève les blocages qui en
 * dépendent (505, clé perdue) et efface l'alerte en cours ; l'appareil de
 * confiance est gardé s'il se rouvre encore.
 */
export function updateAccount(id: number, label: string | null, login: string | null, password: string | null): void {
  const a = repo.getAccount(id);
  if (!a) return;
  const patch: repo.AccountPatch = {};
  if (label) patch.label = label;
  if (login !== null && password !== null) {
    Object.assign(patch, { loginEnc: seal(login), passwordEnc: seal(password), credsSetAt: new Date().toISOString(), alertSentAt: null, consecutiveFailures: 0, pausedUntil: null });
    if (a.blocked === 'identifiants' || a.blocked === 'cle') patch.blocked = null;
    if (open(a.trustedCnEnc) === null || open(a.trustedCvEnc) === null) Object.assign(patch, { trustedCnEnc: null, trustedCvEnc: null, trustedAt: null });
    log.info(`École : ${tag(a)} : identifiants ressaisis.`);
  }
  repo.patchAccount(id, patch);
}

/** Pause à la main, ou reprise (qui efface aussi la pause automatique). */
export function setPaused(id: number, paused: boolean): void {
  repo.patchAccount(id, paused ? { enabled: false } : { enabled: true, pausedUntil: null, consecutiveFailures: 0, alertSentAt: null });
  const a = repo.getAccount(id);
  if (a) log.info(`École : ${tag(a)} : ${paused ? 'mis en pause' : 'repris'}.`);
}

/**
 * Les blocages qui se lèvent d'eux-mêmes quand leur cause a disparu : une autre
 * version d'API configurée (517), ou la bonne clé de chiffrement remise en place.
 */
export function releaseBlocks(a: repo.Account): repo.Account {
  if (a.blocked === 'version' && a.blockedDetail !== edConfig().version) {
    repo.patchAccount(a.id, { blocked: null, blockedDetail: null, alertSentAt: null });
    log.info(`École : ${tag(a)} : version d’API changée (${a.blockedDetail} → ${edConfig().version}), le compte reprend.`);
  } else if (a.blocked === 'cle' && credentials(a)) {
    repo.patchAccount(a.id, { blocked: null, alertSentAt: null });
    log.info(`École : ${tag(a)} : la clé de chiffrement rouvre de nouveau les identifiants, le compte reprend.`);
  } else return a;
  return repo.getAccount(a.id)!;
}

let ticking = false;

/**
 * Un passage du planificateur : chaque compte dû, l'un après l'autre. Rien si le
 * module est désactivé ou si l'on est dans une pause : ni connexion, ni requête.
 */
export async function ecoleTick(now = new Date()): Promise<number> {
  if (ticking || effectiveSetting('modEcole') !== true) return 0;
  const c = cadence();
  if (inQuietWindow(parisWall(now), c)) return 0;
  ticking = true;
  let n = 0;
  try {
    for (const raw of repo.listAccounts()) {
      const a = releaseBlocks(raw);
      if (!mayRun(a, now) || !isDue(a.lastSyncAt, now, c)) continue;
      await connect(a.id);
      n++;
    }
  } finally { ticking = false; }
  return n;
}

/** Démarre le planificateur du module : un passage par minute, décalé de celui des rappels. */
export function startEcoleScheduler(): void {
  const run = (): void => { void ecoleTick().catch((e) => log.erreur('École : passage du planificateur en échec', e)); };
  setTimeout(run, 45_000).unref();
  setInterval(run, 60_000).unref();
}
