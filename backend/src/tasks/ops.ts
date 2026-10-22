// Mutations granulaires des tâches.
//
// Même dispositif que pour la liste de courses (voir shopping/ops.ts), pour la
// même raison : deux personnes cochent en même temps, et une écriture du
// document entier partie d'un téléphone périmé décochait ce que l'autre venait
// de cocher. Le rejeu des mutations sur la version du serveur n'y changeait
// rien, parce que « cocher » était écrit comme une bascule.
//
// D'où ces opérations, qui disent une **intention** et jamais une bascule :
// « cette tâche est faite » rejouée deux fois laisse la tâche faite. Chacune
// porte un identifiant que le serveur retient, pour qu'un « ajouter » rejoué
// après une coupure ne ressuscite pas une tâche supprimée entre-temps.
//
// Ce fichier ne touche ni au disque ni au réseau : c'est ce qui permet de le
// tester sur les cas tordus (rejeu, ordre inversé, liste supprimée sous les pieds).

import { endKey, keyForMove, startKey } from './ordering';
import { isSeasonDay, nextOccurrence } from './recurrence';

/**
 * Comment une tâche revient. Deux modes, et c'est le choix de fond du module :
 * `base: 'due'` à date fixe (les poubelles du mardi), `base: 'done'` à partir
 * de la réalisation (le test de la piscine, une semaine après l'avoir fait,
 * qu'il ait été fait samedi ou dimanche). `grace` est la tolérance en jours
 * avant d'être en retard : l'ouverture de la piscine se fait « vers le 15
 * avril », pas le 15 à midi. Le calcul de l'occurrence suivante vit côté
 * client (frontend recurrence.ts), qui l'envoie avec la coche.
 */
export interface TaskRec {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  every: number;
  days?: number[];
  base: 'due' | 'done';
  grace?: number;
  until?: string | null;
  /** La saison, bornes comprises en MM-JJ : la série ne tombe que de `from` à `to` (voir recurrence.ts). */
  season?: { from: string; to: string } | null;
}
/** Le réglage de rappel d'une tâche. Aucun par défaut ; voir notify/reminders.ts pour l'heure qui en découle. */
export type Remind = 'at' | '1h' | 'eve' | 'morning';
export const REMINDS: Remind[] = ['at', '1h', 'eve', 'morning'];
/**
 * Une réalisation passée d'une série : quand, par qui, et l'échéance qu'elle
 * soldait. `used` : ce qu'un geste d'entretien a pris dans son stock, pour que
 * l'annulation le rende.
 */
export interface TaskDone { at: string; by: string | null; due: string | null; used?: number; via?: string; }

/**
 * Le consommable d'un geste d'entretien : la cartouche de la carafe, le filtre
 * de la hotte, les piles des détecteurs. `use` est ce qu'un geste consomme (un
 * test des quatre détecteurs prend quatre piles), `countedAt` le jour du
 * dernier changement connu de la quantité, pour afficher « Stock au … ».
 */
export interface MaintenanceStock {
  qty: number; unit: string; use: number; threshold: number; article: string; countedAt: string;
  /**
   * Posé par le serveur au passage sous le seuil, retiré quand le stock remonte
   * au-dessus : c'est ce qui fait qu'un article ne part aux courses qu'une fois
   * par passage, pas à chaque geste fait sous le seuil.
   */
  alerted?: boolean;
}
/**
 * Ce qu'une tâche de la liste Entretien porte en plus (voir docs/entretien.md).
 * Lu seulement par Entretien : pour le reste de l'application, c'est une tâche.
 */
export interface Maintenance {
  /** Pièce du socle Maison (`rooms`). */
  roomId?: string;
  /** Le détail du geste : « l'indicateur du couvercle le rappelle ». */
  howto?: string;
  stock?: MaintenanceStock;
  /** En pause jusqu'à ce jour (absence, panne ; une saison annuelle passe par rec.season) : l'échéance y est posée, le geste revient seul. */
  pausedUntil?: string;
  /** Le geste type du catalogue dont celui-ci est une copie. */
  catalogId?: string;
  /** L'appareil du module Équipements concerné (eqp_items.id). */
  equipmentId?: number;
}
/** Une modification des champs d'entretien : une clé absente n'est pas touchée, une clé à null est retirée. */
export interface MaintenancePatch {
  roomId?: string | null; howto?: string | null; pausedUntil?: string | null; catalogId?: string | null; equipmentId?: number | null;
  stock?: (Omit<MaintenanceStock, 'countedAt' | 'alerted'> & { countedAt?: string }) | null;
}

export interface TaskItem {
  id: string;
  listId: string;
  text: string;
  note?: string;
  /** Catégorie libre : « maison », « administratif »… Sert à organiser, pas à filtrer le jour. */
  cat?: string;
  /** Membres affectés. Vide veut dire « le premier qui passe », et c'est licite. */
  who: string[];
  /** Échéance, AAAA-MM-JJ. Null : aucun jour en particulier. */
  due: string | null;
  /** Heure de l'échéance, HH:MM. Ignorée sans `due`. */
  time?: string | null;
  done: boolean;
  /** Qui a coché, et quand. Sert à l'afficher, pas à arbitrer. */
  doneAt?: string | null;
  doneBy?: string | null;
  /** Auteur et date de création. */
  by?: string | null;
  at?: string | null;
  /**
   * Nom du jeton d'accès quand la tâche a été créée par un assistant (« Claude
   * iPhone »), sinon absent. Renseigné uniquement par le serveur MCP : le fil
   * d'activité affiche alors « (via un assistant) » sur la création.
   */
  via?: string | null;
  /** Dernier auteur d'une modification, et sa date. Absents tant qu'aucune retouche n'a eu lieu depuis la création. */
  upBy?: string | null;
  upAt?: string | null;
  /**
   * Liste de courses que cette tâche ouvre. La tâche reste entièrement à
   * l'utilisateur (il la coche, la déplace, la supprime) : le lien n'est qu'un
   * raccourci, et le compte des articles restants, une information de plus.
   */
  shopListId?: string | null;
  /** Une série : la tâche porte son échéance courante, et l'historique de ses réalisations. */
  rec?: TaskRec | null;
  history?: TaskDone[];
  /** Rappel avant l'échéance. Sans échéance, il n'a pas de sens et n'est pas gardé. */
  remind?: Remind | null;
  /**
   * Contrat du module Finances dont la tâche découle (échéance ou piste
   * d'économie). Comme la liste de courses, c'est un raccourci : la tâche
   * reste au foyer. Les contrats vivent dans leurs propres tables, hors du
   * document ; le serveur vérifie la forme, et l'écran dit si le contrat a
   * disparu entre-temps.
   */
  contractId?: number | null;
  /**
   * Devoir ÉcoleDirecte dont la tâche est la projection (ligne de `ed_homework`).
   * Posé par le serveur seul (opérations de confiance) : le module École tient
   * la tâche à jour, et la coche de l'un est la coche de l'autre.
   */
  edId?: number | null;
  /**
   * Exercice du module Révisions dont la tâche est l'entraînement du jour, dans
   * la liste « Devoirs de … ». Posé par le serveur seul, comme `edId` : la
   * tâche se coche d'elle-même quand l'objectif du jour est atteint.
   */
  revEx?: string | null;
  /**
   * Tâche parente, pour une sous-tâche. **Un seul niveau** : une sous-tâche ne
   * peut pas en avoir elle-même, et une tâche qui a des sous-tâches ne peut pas
   * en devenir une. Une sous-tâche est un détail du parent (intitulé, membres,
   * coche) : elle ne porte ni date, ni récurrence, ni rappel, qui sont l'affaire
   * du parent.
   */
  parentId?: string | null;
  /**
   * Clé d'ordre manuel dans la liste, en indexation fractionnaire (voir
   * ordering.ts). Insérer entre deux tâches fabrique une clé entre leurs deux
   * clés : une seule tâche est touchée à chaque déplacement. Absente, la tâche
   * passe en fin de liste. Le tri se fait sur (ord, id), jamais sur `ord` seul.
   */
  ord?: string;
  /** Geste d'entretien : pièce, détail, stock, pause. Seulement dans la liste Entretien. */
  maintenance?: Maintenance;
}

/** Les champs qu'une modification peut viser. `who` est remplacé, jamais fusionné. */
export interface TaskFields {
  listId?: string; text?: string; note?: string; cat?: string; who?: string[];
  due?: string | null; time?: string | null; shopListId?: string | null; rec?: TaskRec | null; remind?: Remind | null;
  contractId?: number | null; parentId?: string | null; ord?: string | null; edId?: number | null; revEx?: string | null;
}

interface Base { opId: string; by?: string | null; at?: string | null; via?: string | null; }
export type TaskOp =
  /** `done` et compagnie sont acceptés à l'ajout : c'est ce qui permet d'annuler une suppression. `position` crée en tête ou en fin ; `ord` restitue une clé connue (annulation d'une suppression). */
  | (Base & TaskFields & { op: 'add'; id: string; listId: string; text: string; done?: boolean; doneAt?: string | null; doneBy?: string | null; position?: 'debut' | 'fin'; maintenance?: MaintenancePatch | null })
  | (Base & TaskFields & { op: 'edit'; id: string; maintenance?: MaintenancePatch | null })
  /**
   * Range une tâche dans sa liste, par rapport à une autre : « avant » ou
   * « après » une tâche de référence, ou aux extrémités (« début » / « fin »).
   * Le client ne fournit jamais de clé : le serveur relit les voisins réels et
   * calcule la nouvelle clé lui-même (voir ordering.ts). C'est ce qui rend le
   * rangement sûr quand deux appareils réorganisent la même liste en même temps.
   */
  | (Base & { op: 'move'; id: string; avant?: string | null; apres?: string | null; position?: 'debut' | 'fin' | null })
  /**
   * Sur une série, `occ` est l'échéance que la coche solde et `next` la
   * suivante, calculée par le client. Une coche dont `occ` n'est plus
   * l'échéance courante arrive après que l'autre appareil a coché la même
   * occurrence : elle est sans objet, et surtout pas une seconde avance.
   */
  | (Base & { op: 'done'; id: string; occ?: string; next?: string | null })
  /**
   * Le stock d'un geste d'entretien, dit comme une intention : `add` (« j'en ai
   * racheté 6 ») ou `set` (« j'en compte 4 »), jamais les deux. Une quantité
   * absolue calculée sur un téléphone écraserait le geste noté au même moment
   * sur l'autre ; `add` se compose avec lui. `on` : le jour du comptage.
   */
  | (Base & { op: 'stock'; id: string; add?: number; set?: number; on?: string })
  /** Passer une occurrence sans la faire : la série avance, sans ligne d'historique. */
  | (Base & { op: 'skip'; id: string; occ: string; next: string | null })
  /** Sur une série, `occ` est l'échéance à rétablir : celle de la dernière réalisation. */
  | (Base & { op: 'reopen'; id: string; occ?: string })
  | (Base & { op: 'remove'; id: string })
  /**
   * Remise à zéro d'une liste de **préparation** : `id` est la liste. Toutes ses
   * tâches redeviennent à préparer (les articles restent, les coches s'effacent).
   * Refusée sur une liste d'un autre type, qui garde sa sémantique.
   */
  | (Base & { op: 'reset'; id: string });

export interface OpsContext {
  /** Listes existantes. Une tâche ne peut pas atterrir dans une liste inconnue. */
  listIds: Set<string>;
  /** Type d'une liste, pour n'autoriser `reset` que sur une liste de préparation. */
  listKind: (listId: string) => string | undefined;
  /** Membres existants. Un membre inconnu est retiré de l'affectation, sans faire échouer l'opération. */
  memberIds: Set<string>;
  /** Listes de courses existantes, pour le lien. */
  shopListIds: Set<string>;
  /** Vrai quand cette opération a déjà été appliquée (rejeu après coupure réseau). */
  alreadyApplied: (opId: string) => boolean;
  /**
   * Opérations écrites par le serveur lui-même (projection des devoirs
   * ÉcoleDirecte, entraînement du jour des Révisions) : elles seules posent
   * `edId` ou `revEx` et écrivent dans une liste `devoirs`. Jamais vrai pour ce qui vient d'un téléphone ou d'un assistant.
   */
  trusted?: boolean;
}

export interface SkippedOp { opId: string; reason: string }
export interface ApplyResult {
  items: TaskItem[];
  /** Identifiants retenus : l'appelant les inscrit au journal et le client les retire de sa file. */
  applied: string[];
  /**
   * Opérations écartées, avec la raison. Elles sont définitivement écartées, pas
   * différées : un client qui les garderait en file les rejouerait sans fin.
   */
  skipped: SkippedOp[];
  /**
   * Listes remises à zéro par une opération `reset` : l'appelant y pose
   * `lastResetAt` sur la liste (qui vit dans le document, hors des tâches).
   */
  listResets: { listId: string; at: string }[];
  /**
   * Gestes d'entretien dont le stock vient de passer sous son seuil dans ce
   * lot : l'appelant peut en mettre l'article aux courses (réglage
   * entretienCoursesAuto). Une fois par passage, grâce à `stock.alerted`.
   */
  stockAlerts: string[];
}

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const HHMM = /^\d{2}:\d{2}$/;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const trimmed = (v: unknown, max: number): string => str(v).trim().slice(0, max);
const TEXT_MAX = 300;
const NOTE_MAX = 2000;
const CAT_MAX = 40;
const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
export const HISTORY_MAX = 200;
const HOWTO_MAX = 2000;
const STOCK_MAX = 9999;

const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Le jour, heure de Paris, d'un instant ISO : c'est le jour où le foyer dit avoir fait le geste. */
export function parisDay(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso.slice(0, 10) : PARIS_DAY.format(new Date(t));
}
const frDay = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Lit une règle de récurrence. Null pour « aucune », une raison si elle est illisible. */
function readRec(v: unknown): { rec: TaskRec | null } | { reason: string } {
  if (v === null || v === undefined || v === '') return { rec: null };
  if (typeof v !== 'object') return { reason: 'Récurrence illisible.' };
  const o = v as Record<string, unknown>;
  const freq = str(o['freq']);
  if (!FREQS.includes(freq)) return { reason: 'Fréquence de récurrence inconnue : ' + freq };
  const every = typeof o['every'] === 'number' && Number.isInteger(o['every']) && o['every'] >= 1 && o['every'] <= 99 ? o['every'] : 1;
  const base = o['base'] === 'done' ? 'done' : 'due';
  const rec: TaskRec = { freq: freq as TaskRec['freq'], every, base };
  if (Array.isArray(o['days'])) {
    const days = [...new Set(o['days'].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))] as number[];
    if (days.length) rec.days = days.sort((a, b) => a - b);
  }
  if (typeof o['grace'] === 'number' && Number.isInteger(o['grace']) && o['grace'] > 0 && o['grace'] <= 365) rec.grace = o['grace'];
  if (typeof o['until'] === 'string' && o['until']) {
    if (!ISO_DAY.test(o['until'])) return { reason: 'Fin de récurrence illisible : ' + o['until'] };
    rec.until = o['until'];
  }
  if (o['season'] !== undefined && o['season'] !== null) {
    const se = o['season'] as Record<string, unknown>;
    if (!se || typeof se !== 'object' || !isSeasonDay(se['from']) || !isSeasonDay(se['to'])) return { reason: 'Saison illisible : attendu { from: "MM-JJ", to: "MM-JJ" }.' };
    rec.season = { from: se['from'], to: se['to'] };
  }
  return { rec };
}

/** Un tableau d'identifiants de membres connus, dans l'ordre reçu, sans doublon. */
function whoOf(v: unknown, members: Set<string>): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const m of v) { const id = trimmed(m, 80); if (id && members.has(id) && !out.includes(id)) out.push(id); }
  return out;
}

/**
 * Lit les champs d'une tâche depuis une opération. Rend la raison du refus, ou
 * les champs présents. Un champ absent de l'opération n'est pas touché.
 */
function readFields(o: Record<string, unknown>, ctx: OpsContext): { fields: TaskFields } | { reason: string } {
  const f: TaskFields = {};
  if (o['text'] !== undefined) {
    const text = trimmed(o['text'], TEXT_MAX);
    if (!text) return { reason: 'Tâche sans intitulé.' };
    f.text = text;
  }
  if (o['listId'] !== undefined) {
    const listId = trimmed(o['listId'], 80);
    if (!ctx.listIds.has(listId)) return { reason: 'La liste visée n’existe plus.' };
    f.listId = listId;
  }
  if (o['due'] !== undefined) {
    if (o['due'] === null || o['due'] === '') f.due = null;
    else if (ISO_DAY.test(str(o['due']))) f.due = str(o['due']);
    else return { reason: 'Date d’échéance illisible : ' + str(o['due']) };
  }
  if (o['time'] !== undefined) {
    if (o['time'] === null || o['time'] === '') f.time = null;
    else if (HHMM.test(str(o['time']))) f.time = str(o['time']);
    else return { reason: 'Heure illisible : ' + str(o['time']) };
  }
  if (o['note'] !== undefined) f.note = trimmed(o['note'], NOTE_MAX);
  if (o['cat'] !== undefined) f.cat = trimmed(o['cat'], CAT_MAX);
  if (o['who'] !== undefined) f.who = whoOf(o['who'], ctx.memberIds);
  if (o['rec'] !== undefined) {
    const r = readRec(o['rec']);
    if ('reason' in r) return { reason: r.reason };
    f.rec = r.rec;
  }
  if (o['remind'] !== undefined) {
    if (o['remind'] === null || o['remind'] === '') f.remind = null;
    else if (REMINDS.includes(o['remind'] as Remind)) f.remind = o['remind'] as Remind;
    else return { reason: 'Réglage de rappel inconnu : ' + str(o['remind']) };
  }
  if (o['shopListId'] !== undefined) {
    const id = trimmed(o['shopListId'], 80);
    // Une liste de courses disparue ne fait pas échouer la tâche : le lien tombe.
    f.shopListId = id && ctx.shopListIds.has(id) ? id : null;
  }
  if (o['ord'] !== undefined) {
    const v = o['ord'];
    if (v === null || v === '') f.ord = null;
    // Une clé d'ordre est base 62 (voir ordering.ts). Ce champ ne sert qu'à
    // restituer une clé connue (annulation) : un déplacement passe par l'op `move`,
    // qui calcule la clé côté serveur.
    else if (typeof v === 'string' && /^[0-9A-Za-z]{1,200}$/.test(v)) f.ord = v;
    else return { reason: 'Clé d’ordre illisible : ' + str(v) };
  }
  if (o['edId'] !== undefined && ctx.trusted) {
    const v = o['edId'];
    f.edId = typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
  }
  if (o['revEx'] !== undefined && ctx.trusted) {
    const v = o['revEx'];
    f.revEx = typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? v : null;
  }
  if (o['contractId'] !== undefined) {
    const v = o['contractId'];
    if (v === null || v === '') f.contractId = null;
    else if (typeof v === 'number' && Number.isInteger(v) && v > 0) f.contractId = v;
    else return { reason: 'Contrat illisible : ' + str(v) };
  }
  return { fields: f };
}

/**
 * Lit les champs d'entretien d'une opération. Null : tout retirer. Ce qui n'a
 * pas de sens (identifiant de pièce ou de catalogue mal formé) tombe sans
 * faire échouer le geste ; ce qui serait une erreur de saisie (date, quantité)
 * est refusé et nommé.
 */
function readMaintenance(v: unknown): { patch: MaintenancePatch | null } | { reason: string } {
  if (v === null || v === '') return { patch: null };
  if (typeof v !== 'object' || Array.isArray(v)) return { reason: 'Détails d’entretien illisibles.' };
  const o = v as Record<string, unknown>;
  const p: MaintenancePatch = {};
  // Une pièce n'est pas vérifiée contre `rooms` : une pièce créée en même
  // temps que le geste part par l'enregistrement du document, qui peut
  // arriver après lui (hors ligne, ou simplement plus lent). Une pièce qui
  // n'arrive jamais est retirée par la réconciliation du document (reconcile).
  if (o['roomId'] !== undefined) {
    const id = trimmed(o['roomId'], 80);
    p.roomId = /^[\w-]+$/.test(id) ? id : null;
  }
  if (o['howto'] !== undefined) p.howto = trimmed(o['howto'], HOWTO_MAX) || null;
  if (o['equipmentId'] !== undefined) {
    const v = o['equipmentId'];
    if (v === null || v === '') p.equipmentId = null;
    else if (isInt(v, 1, Number.MAX_SAFE_INTEGER)) p.equipmentId = v;
    else return { reason: 'Équipement illisible : ' + str(v) };
  }
  if (o['catalogId'] !== undefined) {
    const id = trimmed(o['catalogId'], 80);
    p.catalogId = /^[a-z0-9-]+$/.test(id) ? id : null;
  }
  if (o['pausedUntil'] !== undefined) {
    if (o['pausedUntil'] === null || o['pausedUntil'] === '') p.pausedUntil = null;
    else if (ISO_DAY.test(str(o['pausedUntil']))) p.pausedUntil = str(o['pausedUntil']);
    else return { reason: 'Date de reprise illisible : ' + str(o['pausedUntil']) };
  }
  if (o['stock'] !== undefined) {
    const st = o['stock'];
    if (st === null || st === '') p.stock = null;
    else if (typeof st !== 'object' || Array.isArray(st)) return { reason: 'Stock illisible.' };
    else {
      const so = st as Record<string, unknown>;
      const article = trimmed(so['article'], 120);
      if (!article) return { reason: 'Un stock dit ce qu’il compte : l’article est vide.' };
      for (const [k, min, max] of [['qty', 0, STOCK_MAX], ['use', 1, 99], ['threshold', 0, STOCK_MAX]] as const) {
        if (so[k] !== undefined && !isInt(so[k], min, max)) return { reason: `Stock : « ${k} » doit être un nombre entier entre ${min} et ${max}.` };
      }
      if (so['countedAt'] !== undefined && so['countedAt'] !== null && !ISO_DAY.test(str(so['countedAt']))) return { reason: 'Date de comptage illisible : ' + str(so['countedAt']) };
      p.stock = {
        article, unit: trimmed(so['unit'], 30),
        qty: isInt(so['qty'], 0, STOCK_MAX) ? so['qty'] : 0,
        use: isInt(so['use'], 1, 99) ? so['use'] : 1,
        threshold: isInt(so['threshold'], 0, STOCK_MAX) ? so['threshold'] : 0,
        ...(ISO_DAY.test(str(so['countedAt'])) ? { countedAt: str(so['countedAt']) } : {}),
      };
    }
  }
  return { patch: p };
}

/**
 * Pose une modification des champs d'entretien sur ceux d'une tâche. La
 * quantité d'un stock **déjà là** n'est jamais réécrite ici : elle ne bouge
 * que par un geste fait ou par l'opération `stock`, qui disent une intention.
 * Sinon un formulaire ouvert sur un téléphone remettrait la quantité d'avant
 * le geste noté entre-temps par l'autre.
 */
function mergeMaintenance(cur: Maintenance | undefined, patch: MaintenancePatch | null, day: string): Maintenance | undefined {
  if (patch === null) return undefined;
  const next: Maintenance = { ...(cur || {}) };
  for (const k of ['roomId', 'howto', 'pausedUntil', 'catalogId'] as const) {
    if (patch[k] === undefined) continue;
    if (patch[k] === null) delete next[k]; else next[k] = patch[k] as string;
  }
  if (patch.equipmentId === null) delete next.equipmentId; else if (patch.equipmentId !== undefined) next.equipmentId = patch.equipmentId;
  if (patch.stock === null) delete next.stock;
  else if (patch.stock) {
    const { countedAt, ...conf } = patch.stock;
    next.stock = cur?.stock
      ? { ...conf, qty: cur.stock.qty, countedAt: cur.stock.countedAt, ...(cur.stock.alerted ? { alerted: true } : {}) }
      : { ...conf, countedAt: countedAt || day };
  }
  return Object.keys(next).length ? next : undefined;
}

/** Les champs d'entretien ne valent que dans la liste Entretien, seule à les lire. */
const MAINT_REFUS = 'Les détails d’entretien (pièce, stock, pause) ne valent que dans la liste Entretien.';
const isEntretien = (listId: string, ctx: OpsContext): boolean => ctx.listKind(listId) === 'entretien';

/**
 * Une liste « Devoirs de … » n'accueille que ce que le serveur y projette (les devoirs
 * ÉcoleDirecte, l'entraînement du jour des Révisions) : ni ajout ni déplacement vers
 * elle depuis un téléphone ou un assistant.
 */
const DEVOIRS_REFUS = 'Les devoirs viennent d’ÉcoleDirecte : une tâche maison va dans une autre liste.';
const intoDevoirs = (listId: string | undefined, from: string | null, ctx: OpsContext): boolean =>
  !!listId && listId !== from && !ctx.trusted && ctx.listKind(listId) === 'devoirs';

/** Pose les champs lus sur une tâche, en retirant les clés vides plutôt que de les laisser à « ». */
function assign(t: TaskItem, f: TaskFields): TaskItem {
  // `ord` sort du lot : une tâche stockée porte une clé texte ou rien, jamais
  // null, et c'est ainsi que « retirer l'ordre manuel » s'écrit sans forcer une
  // conversion.
  const { ord, ...rest } = { ...t, ...f };
  const next: TaskItem = { ...rest, ...(typeof ord === 'string' && ord ? { ord } : {}) };
  if (!next.note) delete next.note;
  if (!next.cat) delete next.cat;
  if (next.shopListId === null || next.shopListId === undefined) delete next.shopListId;
  if (next.contractId === null || next.contractId === undefined) delete next.contractId;
  if (next.edId === null || next.edId === undefined) delete next.edId;
  if (!next.revEx) delete next.revEx;
  if (next.parentId === null || next.parentId === undefined) delete next.parentId;
  if (!next.maintenance) delete next.maintenance;
  // Une sous-tâche est un détail du parent : la date, la récurrence et le rappel
  // sont l'affaire de celui-ci. Les poser ici ferait sonner un rappel pour une
  // ligne que l'écran ne montre jamais seule.
  if (next.parentId) { next.due = null; delete next.time; delete next.rec; delete next.remind; }
  if (next.time === null || next.time === undefined) delete next.time;
  if (!next.rec) { delete next.rec; }
  // Une série garde son rappel sans échéance : un geste d'entretien jamais
  // noté n'a pas encore de date, et le rappel choisi part dès la première
  // réalisation (fireAt, lui, ne sonne jamais sans date).
  if (!next.remind || (!next.due && !next.rec)) delete next.remind;
  return next;
}

/**
 * Lit la tâche parente d'une sous-tâche. Un seul niveau, dans une seule liste :
 * ce sont les deux règles qui empêchent l'arborescence que le module refuse.
 */
function readParent(v: unknown, items: TaskItem[], self: TaskItem): { parentId: string | null } | { reason: string } {
  if (v === undefined) return { parentId: self.parentId ?? null };
  const id = trimmed(v, 80);
  if (!id) return { parentId: null };
  if (id === self.id) return { reason: 'Une tâche ne peut pas être sa propre sous-tâche.' };
  const parent = items.find((t) => t.id === id);
  if (!parent) return { reason: 'La tâche parente n’existe plus.' };
  if (parent.parentId) return { reason: 'Une sous-tâche ne peut pas en avoir elle-même.' };
  if (parent.listId !== self.listId) return { reason: 'Une sous-tâche vit dans la liste de son parent.' };
  if (items.some((t) => t.parentId === self.id)) return { reason: 'Une tâche qui a des sous-tâches ne peut pas en devenir une.' };
  return { parentId: id };
}

/** Les réalisations passées d'une série, telles qu'un ajout peut les restituer. Ce qui n'a pas la forme est ignoré. */
function readHistory(v: unknown): TaskDone[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
    .map((h): TaskDone => ({ at: trimmed(h['at'], 40), by: trimmed(h['by'], 80) || null, due: ISO_DAY.test(str(h['due'])) ? str(h['due']) : null, ...(isInt(h['used'], 1, STOCK_MAX) ? { used: h['used'] } : {}), ...(trimmed(h['via'], 80) ? { via: trimmed(h['via'], 80) } : {}) }))
    .filter((h) => !!h.at)
    .slice(-HISTORY_MAX);
}

/** L'échéance suivante d'une coche ou d'un saut : une date, ou null quand la série s'arrête là. */
function readNext(v: unknown): { next: string | null } | { reason: string } {
  if (v === null || v === undefined || v === '') return { next: null };
  if (ISO_DAY.test(str(v))) return { next: str(v) };
  return { reason: 'Échéance suivante illisible : ' + str(v) };
}

/**
 * Noter un geste d'entretien fait : la coche d'une tâche de la liste Entretien.
 *
 * C'est la même opération `done` que partout, cochée depuis Entretien, depuis
 * Tâches ou par un assistant, avec trois règles de plus :
 *
 *   - **Une fois par jour.** Deux téléphones à jour qui notent le même geste le
 *     même jour (heure de Paris) font une seule réalisation : la seconde est
 *     acquittée sans effet, ni ligne d'historique ni stock repris. Le cas du
 *     téléphone périmé, lui, est déjà couvert par `occ`.
 *   - **La date suivante est calculée ici**, par le moteur partagé, à partir du
 *     jour du geste : un geste noté par un assistant n'a personne pour la
 *     calculer, et un geste noté en retard ne traîne pas ce retard.
 *   - **Le stock est repris dans la même opération**, donc dans la même
 *     transaction et le même rejeu : un geste fait est un consommable en moins,
 *     jamais deux.
 *
 * Rend la tâche après coup, `task: null` quand le geste est sans objet, ou la
 * raison d'un refus.
 */
function maintain(t: TaskItem, occ: string, at: string, by: string | null, via: string | null): { task: TaskItem | null } | { reason: string } {
  // Un autre appareil a déjà soldé cette occurrence : sans objet.
  if (occ !== (t.due || '')) return { task: null };
  const day = parisDay(at);
  const last = t.history?.length ? t.history[t.history.length - 1] : null;
  const lastDay = last ? parisDay(last.at) : '';
  if (lastDay === day) return { task: null };
  if (lastDay > day) return { reason: `Une réalisation plus récente est déjà notée, le ${frDay(lastDay)}.` };
  const next = nextOccurrence(t.rec!, t.due || day, day);
  const st = t.maintenance?.stock;
  const used = st ? Math.min(st.use, st.qty) : 0;
  // `via` : noté par un assistant (« Claude iPhone »), pour que l'historique le dise.
  const history = [...(t.history || []), { at, by, due: t.due, ...(used ? { used } : {}), ...(via ? { via } : {}) }].slice(-HISTORY_MAX);
  // Fait pendant une pause : la pause est finie, le geste a eu lieu.
  const { pausedUntil: _p, ...rest } = t.maintenance || {};
  void _p;
  const m: Maintenance = { ...rest, ...(st && used ? { stock: { ...st, qty: st.qty - used, countedAt: day } } : {}) };
  const base: TaskItem = { ...t, history };
  if (Object.keys(m).length) base.maintenance = m; else delete base.maintenance;
  return { task: next ? { ...base, due: next } : { ...base, done: true, doneAt: at, doneBy: by } };
}

/**
 * Applique un lot d'opérations. Chaque opération est indépendante : l'une est
 * écartée sans faire tomber les autres, parce qu'un lot vient d'une file
 * d'attente hors ligne et qu'une tâche périmée ne doit pas bloquer les neuf
 * autres coches faites dans la journée.
 */
export function applyOps(items: TaskItem[], ops: unknown, ctx: OpsContext): ApplyResult {
  const out: TaskItem[] = items.map((i) => ({ ...i }));
  const applied: string[] = [];
  const skipped: SkippedOp[] = [];
  const listResets: { listId: string; at: string }[] = [];
  const seen = new Set<string>();

  if (!Array.isArray(ops)) return { items: out, applied, skipped: [{ opId: '', reason: 'Lot d’opérations illisible.' }], listResets, stockAlerts: [] };

  for (const raw of ops) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const opId = trimmed(o['opId'], 80);
    if (!opId) { skipped.push({ opId: '', reason: 'Opération sans identifiant.' }); continue; }
    // Doublon dans le lot lui-même : déjà traité, et déjà acquitté une fois.
    if (seen.has(opId)) continue;
    seen.add(opId);
    // Déjà appliquée lors d'un envoi précédent : acquittée sans être rejouée.
    if (ctx.alreadyApplied(opId)) { applied.push(opId); continue; }

    const id = trimmed(o['id'], 80);
    if (!id) { skipped.push({ opId, reason: 'Opération sans tâche visée.' }); continue; }
    const at = trimmed(o['at'], 40) || new Date().toISOString();
    const by = trimmed(o['by'], 80) || null;
    const idx = out.findIndex((i) => i.id === id);

    switch (o['op']) {
      case 'add': {
        // Rejeu d'un ajout déjà passé sous un autre identifiant d'opération :
        // la tâche existe, il n'y a rien à faire et ce n'est pas une erreur.
        if (idx >= 0) { applied.push(opId); break; }
        const read = readFields(o, ctx);
        if ('reason' in read) { skipped.push({ opId, reason: read.reason }); break; }
        const f = read.fields;
        if (!f.text) { skipped.push({ opId, reason: 'Tâche sans intitulé.' }); break; }
        if (!f.listId) { skipped.push({ opId, reason: 'La liste visée n’existe plus.' }); break; }
        if (intoDevoirs(f.listId, null, ctx)) { skipped.push({ opId, reason: DEVOIRS_REFUS }); break; }
        let maintenance: Maintenance | undefined;
        if (o['maintenance'] !== undefined) {
          const m = readMaintenance(o['maintenance']);
          if ('reason' in m) { skipped.push({ opId, reason: m.reason }); break; }
          if (m.patch && !isEntretien(f.listId, ctx)) { skipped.push({ opId, reason: MAINT_REFUS }); break; }
          maintenance = mergeMaintenance(undefined, m.patch, parisDay(at));
        }
        const done = o['done'] === true;
        const history = readHistory(o['history']);
        const via = trimmed(o['via'], 80) || null;
        const bare: TaskItem = {
          id, listId: f.listId, text: f.text, who: f.who ?? [], due: f.due ?? null, done, by, at,
          ...(via ? { via } : {}),
          ...(done ? { doneAt: trimmed(o['doneAt'], 40) || at, doneBy: trimmed(o['doneBy'], 80) || by } : {}),
          ...(history.length ? { history } : {}),
          ...(maintenance ? { maintenance } : {}),
        };
        // Le parent est décidé avant de poser les champs : c'est lui qui dit si
        // la date et le rappel ont un sens, et une seule passe évite qu'un ordre
        // d'application les laisse traîner.
        const parent = readParent(o['parentId'], out, bare);
        if ('reason' in parent) { skipped.push({ opId, reason: parent.reason }); break; }
        // Toute tâche naît classée : une clé restituée (annulation d'une
        // suppression), sinon une clé calculée pour la tête ou la fin de liste.
        // Sans clé, elle tomberait en fin de tri, ce qu'on ne veut qu'en dernier
        // recours (client d'une version antérieure).
        const ord = typeof f.ord === 'string' && f.ord ? f.ord : (o['position'] === 'debut' ? startKey(out) : endKey(out));
        out.push(assign(bare, { ...f, parentId: parent.parentId, ord }));
        applied.push(opId);
        break;
      }
      case 'edit': {
        // Une tâche disparue n'est pas une erreur du client : quelqu'un l'a
        // supprimée pendant qu'il était hors ligne. L'opération est sans objet.
        if (idx < 0) { applied.push(opId); break; }
        const read = readFields(o, ctx);
        if ('reason' in read) { skipped.push({ opId, reason: read.reason }); break; }
        if (intoDevoirs(read.fields.listId, out[idx].listId, ctx)) { skipped.push({ opId, reason: DEVOIRS_REFUS }); break; }
        let maintenance = out[idx].maintenance;
        if (o['maintenance'] !== undefined) {
          const m = readMaintenance(o['maintenance']);
          if ('reason' in m) { skipped.push({ opId, reason: m.reason }); break; }
          if (m.patch && !isEntretien(read.fields.listId ?? out[idx].listId, ctx)) { skipped.push({ opId, reason: MAINT_REFUS }); break; }
          maintenance = mergeMaintenance(out[idx].maintenance, m.patch, parisDay(at));
        }
        // Le parent est validé contre la liste d'arrivée (déplacer une tâche et
        // la ranger sous un parent d'une autre liste ne veut rien dire), et posé
        // dans la même passe que les autres champs : sans quoi une sous-tâche
        // promue au premier niveau perdrait la date donnée par la même opération.
        const cible: TaskItem = { ...out[idx], listId: read.fields.listId ?? out[idx].listId };
        const p = o['parentId'] !== undefined ? readParent(o['parentId'], out, cible) : { parentId: out[idx].parentId ?? null };
        if ('reason' in p) { skipped.push({ opId, reason: p.reason }); break; }
        const next = assign({ ...out[idx], maintenance }, { ...read.fields, parentId: p.parentId });
        // Toute retouche estampille « modifié », sauf un simple réordonnancement (clé d'ordre seule).
        const changed = [...Object.keys(read.fields), ...(o['parentId'] !== undefined ? ['parentId'] : []), ...(o['maintenance'] !== undefined ? ['maintenance'] : [])];
        out[idx] = changed.some((k) => k !== 'ord') ? { ...next, upBy: by, upAt: at } : next;
        applied.push(opId);
        break;
      }
      case 'move': {
        // Une tâche disparue (supprimée par l'autre appareil pendant la coupure)
        // n'est pas une erreur : le déplacement est sans objet.
        if (idx < 0) { applied.push(opId); break; }
        const res = keyForMove(out, id, { avant: trimmed(o['avant'], 80) || null, apres: trimmed(o['apres'], 80) || null, position: o['position'] === 'debut' ? 'debut' : o['position'] === 'fin' ? 'fin' : null });
        if ('reason' in res) { skipped.push({ opId, reason: res.reason }); break; }
        // Déjà à cette place : neutre, on acquitte sans rien écrire ni estamper « modifié ».
        if ('noop' in res) { applied.push(opId); break; }
        out[idx] = { ...out[idx], ord: res.key };
        applied.push(opId);
        break;
      }
      case 'done': {
        if (idx < 0) { applied.push(opId); break; }
        const t = out[idx];
        if (t.rec && !t.done && isEntretien(t.listId, ctx)) {
          const r = maintain(t, trimmed(o['occ'], 40), at, by, trimmed(o['via'], 80) || null);
          if ('reason' in r) skipped.push({ opId, reason: r.reason });
          else { if (r.task) out[idx] = r.task; applied.push(opId); }
          break;
        }
        if (t.rec && !t.done) {
          // Une série : la coche solde l'occurrence courante et fait avancer
          // l'échéance. Une coche pour une autre occurrence est sans objet.
          const occ = trimmed(o['occ'], 40);
          if (occ !== (t.due || '')) { applied.push(opId); break; }
          const n = readNext(o['next']);
          if ('reason' in n) { skipped.push({ opId, reason: n.reason }); break; }
          const history = [...(t.history || []), { at, by, due: t.due }].slice(-HISTORY_MAX);
          out[idx] = n.next ? { ...t, due: n.next, history } : { ...t, done: true, doneAt: at, doneBy: by, history };
          applied.push(opId);
          break;
        }
        // Déjà faite : on garde qui l'a faite en premier, c'est l'information vraie.
        if (!t.done) out[idx] = { ...t, done: true, doneAt: at, doneBy: by };
        applied.push(opId);
        break;
      }
      case 'skip': {
        if (idx < 0) { applied.push(opId); break; }
        const t = out[idx];
        if (!t.rec || t.done || trimmed(o['occ'], 40) !== (t.due || '')) { applied.push(opId); break; }
        const n = readNext(o['next']);
        if ('reason' in n) { skipped.push({ opId, reason: n.reason }); break; }
        out[idx] = n.next ? { ...t, due: n.next } : { ...t, done: true, doneAt: at, doneBy: by };
        applied.push(opId);
        break;
      }
      case 'stock': {
        if (idx < 0) { applied.push(opId); break; }
        const t = out[idx];
        const st = t.maintenance?.stock;
        if (!st) { skipped.push({ opId, reason: 'Ce geste n’a pas de stock à compter.' }); break; }
        let qty: number;
        if (o['set'] !== undefined && o['add'] === undefined && isInt(o['set'], 0, STOCK_MAX)) qty = o['set'];
        else if (o['add'] !== undefined && o['set'] === undefined && isInt(o['add'], -STOCK_MAX, STOCK_MAX)) qty = Math.max(0, Math.min(STOCK_MAX, st.qty + o['add']));
        else { skipped.push({ opId, reason: 'Quantité de stock illisible : un nombre entier, ajouté (« add ») ou compté (« set »).' }); break; }
        if (o['on'] !== undefined && o['on'] !== null && o['on'] !== '' && !ISO_DAY.test(str(o['on']))) { skipped.push({ opId, reason: 'Date de comptage illisible : ' + str(o['on']) }); break; }
        const on = ISO_DAY.test(str(o['on'])) ? str(o['on']) : parisDay(at);
        out[idx] = { ...t, maintenance: { ...t.maintenance, stock: { ...st, qty, countedAt: on } }, upBy: by, upAt: at };
        applied.push(opId);
        break;
      }
      case 'reopen': {
        if (idx < 0) { applied.push(opId); break; }
        const t = out[idx];
        const occ = trimmed(o['occ'], 40);
        const last = t.rec && t.history?.length ? t.history[t.history.length - 1] : null;
        // `occ` vide est une vraie valeur : la première réalisation d'un geste
        // d'entretien jamais noté soldait une échéance vide, et c'est elle que
        // l'annulation rétablit.
        if (last && o['occ'] !== undefined && o['occ'] !== null && (last.due || '') === occ) {
          // Défaire la dernière coche d'une série : l'échéance qu'elle soldait revient,
          // et le stock repris par un geste d'entretien avec elle.
          const back: TaskItem = { ...t, done: false, doneAt: null, doneBy: null, due: last.due, history: t.history!.slice(0, -1) };
          const st = t.maintenance?.stock;
          if (st && last.used) back.maintenance = { ...t.maintenance, stock: { ...st, qty: Math.min(STOCK_MAX, st.qty + last.used) } };
          out[idx] = back;
        } else if (t.done) {
          out[idx] = { ...t, done: false, doneAt: null, doneBy: null };
        }
        applied.push(opId);
        break;
      }
      case 'remove': {
        if (idx >= 0) {
          out.splice(idx, 1);
          // Une sous-tâche restée sans parent remonte au premier niveau plutôt
          // que de disparaître : l'écran qui supprime un parent envoie ses
          // sous-tâches dans le même lot, et ce qu'un autre appareil vient
          // d'ajouter se voit au lieu de se perdre.
          for (let i = 0; i < out.length; i++) if (out[i].parentId === id) out[i] = assign(out[i], { parentId: null });
        }
        applied.push(opId);
        break;
      }
      case 'reset': {
        // `id` est la liste. La remise à zéro ne vaut que pour une liste de
        // préparation : les autres gardent leurs coches, qui portent un sens.
        const kind = ctx.listKind(id);
        if (kind === undefined) { skipped.push({ opId, reason: 'La liste visée n’existe plus.' }); break; }
        if (kind !== 'preparation') { skipped.push({ opId, reason: 'Seule une liste de préparation se remet à zéro.' }); break; }
        for (let i = 0; i < out.length; i++) {
          const t = out[i];
          if (t.listId === id && (t.done || t.doneAt || t.doneBy)) out[i] = { ...t, done: false, doneAt: null, doneBy: null };
        }
        listResets.push({ listId: id, at });
        applied.push(opId);
        break;
      }
      default:
        skipped.push({ opId, reason: 'Opération inconnue : ' + str(o['op']) });
    }
  }

  // Le passage sous le seuil se constate après le lot, sur les seuls stocks qui
  // ont bougé (quantité ou seuil) : un stock déjà bas qu'aucune opération ne
  // touche ne déclenche rien. Remonté au-dessus, il pourra alerter de nouveau.
  const stockAlerts: string[] = [];
  const before = new Map(items.map((t) => [t.id, t.maintenance?.stock]));
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    const st = t.maintenance?.stock;
    if (!st || !isEntretien(t.listId, ctx)) continue;
    const b = before.get(t.id);
    if (b && b.qty === st.qty && b.threshold === st.threshold) continue;
    const low = st.qty <= st.threshold;
    if (low && !st.alerted) { out[i] = { ...t, maintenance: { ...t.maintenance, stock: { ...st, alerted: true } } }; stockAlerts.push(t.id); }
    else if (!low && st.alerted) { const { alerted: _a, ...rest } = st; void _a; out[i] = { ...t, maintenance: { ...t.maintenance, stock: rest } }; }
  }
  return { items: out, applied, skipped, listResets, stockAlerts };
}

export interface ReconcileReport {
  items: TaskItem[];
  /** Tâches parties avec leur liste : c'est ce que l'écran annonce en supprimant une liste. */
  dropped: number;
  /** Affectations à un membre qui n'existe plus. */
  unassigned: number;
  /** Liens vers une liste de courses ou un document disparus. */
  unlinked: number;
  /** Sous-tâches remontées au premier niveau, leur parent ayant disparu ou changé de liste. */
  orphaned: number;
}

/**
 * Rattrape ce que l'édition des listes, des membres, des listes de courses et
 * des documents implique pour les tâches. Ces quatre-là s'éditent par
 * l'enregistrement du document complet, dans lequel les tâches ne voyagent
 * plus : il faut donc appliquer ici les conséquences.
 */
export function reconcile(items: TaskItem[], listIds: Set<string>, memberIds: Set<string>, shopListIds: Set<string>, roomIds?: Set<string>): ReconcileReport {
  const kept = items.filter((t) => listIds.has(t.listId));
  const byId = new Map(kept.map((t) => [t.id, t]));
  let unassigned = 0;
  let unlinked = 0;
  let orphaned = 0;
  const out = kept.map((t) => {
    let next = t;
    const who = (t.who || []).filter((m) => memberIds.has(m));
    if (who.length !== (t.who || []).length) { unassigned++; next = { ...next, who }; }
    if (t.shopListId && !shopListIds.has(t.shopListId)) { unlinked++; next = { ...next }; delete next.shopListId; }
    // Une pièce supprimée : le geste passe « Sans pièce », il ne disparaît pas.
    if (roomIds && t.maintenance?.roomId && !roomIds.has(t.maintenance.roomId)) {
      unlinked++;
      const { roomId: _r, ...m } = t.maintenance;
      void _r;
      next = { ...next };
      if (Object.keys(m).length) next.maintenance = m; else delete next.maintenance;
    }
    // Un parent parti avec sa liste laisserait une sous-tâche invisible : elle
    // remonte au premier niveau, où elle se voit et se traite.
    const parent = t.parentId ? byId.get(t.parentId) : null;
    if (t.parentId && (!parent || parent.listId !== t.listId || parent.parentId)) { orphaned++; next = { ...next }; delete next.parentId; }
    return next;
  });
  return { items: out, dropped: items.length - kept.length, unassigned, unlinked, orphaned };
}
