// Le fil d'activité de l'accueil : « ce qui a récemment changé » dans le foyer.
//
// Il ne se dérive que des mutations réellement horodatées et attribuées :
// tâches (création via `at`/`by`, achèvement via `doneAt`/`doneBy` ou l'historique
// d'une tâche récurrente), articles de courses (`at`/`by`, l'état donnant le
// verbe), événements de l'agenda (création via `at`/`by`, modification via
// `upAt`/`upBy`), repas planifiés (`at`/`by` posés à l'enregistrement) et recettes
// (`at`/`by` posés à l'ajout au carnet). Un geste sans auteur ni date (un repas
// d'une ancienne version, un événement importé de longue date) n'y figure pas :
// on reflète le geste, on ne l'invente pas. Contacts, cartes de fidélité, lieux
// et les modules hors document (Finances, Employé, Équipements) n'y sont pas
// encore : ils n'ont pas de date de changement attribuée (ou vivent hors du
// document que ce fil parcourt).
import { HouseholdState } from './models';

export interface ActivityEntry {
  /** Instant du changement, ISO complet : c'est la clé de tri. */
  at: string;
  /** Auteur (identifiant de membre), ou null si le geste n'en portait pas. */
  by: string | null;
  /** Nom du jeton d'accès quand le geste vient d'un assistant, « ÉcoleDirecte » pour la synchronisation École, sinon null. */
  via?: string | null;
  /** Auteur hors foyer, à afficher à la place d'un membre : le professeur qui a donné un devoir. */
  author?: string;
  /** Verbe nommant le type d'item : « a ajouté la tâche », « a programmé l'évènement », « a mis au panier l'article »... */
  verb: string;
  /** Ce qui a changé : l'intitulé de la tâche, de l'événement ou de l'article. */
  what: string;
  /** La liste d'origine, pour situer d'un coup d'oeil. */
  where: string;
  /** Couleur de cette liste, comme accent. */
  color: string;
  /** Type d'item, pour ouvrir le bon écran au clic sur le nom. */
  kind: 'task' | 'event' | 'shop' | 'meal' | 'recipe';
  /** Cible du lien : l'identifiant de la tâche, de l'événement ou de la recette, la liste pour un article, la clé du créneau pour un repas. */
  ref: string;
}

// Verbe par état d'un article, nommant l'item. Un lien sur le nom mène à sa liste.
const SHOP_VERB: Record<string, string> = {
  'a-prendre': 'a ajouté aux courses l’article',
  panier: 'a coché l’article',
  indisponible: 'a noté introuvable l’article',
};

const ED = 'ÉcoleDirecte';

// Verbe par moment du repas : un lien sur le nom du plat ouvre le créneau.
const MEAL_VERB: Record<string, string> = {
  matin: 'a prévu le petit-déjeuner',
  midi: 'a prévu le déjeuner',
  soir: 'a prévu le dîner',
};

/**
 * Le professeur d'un devoir, tiré de la note que la synchronisation écrit
 * (« Donné par Mme Martin le 09/10/2026. »), ou null.
 */
export function teacherOf(note: string | undefined): string | null {
  const m = /(?:^|\n)Donné par (.+?)(?: le \d{2}\/\d{2}\/\d{4})?\.\s*$/.exec(note || '');
  return m ? m[1].trim() : null;
}

/**
 * Les `limit` changements les plus récents, du plus récent au plus ancien. Une
 * tâche récurrente laisse une ligne par achèvement (son historique), parce que
 * « sortir les poubelles » chaque semaine est bien une activité chaque semaine.
 */
export function recentActivity(state: HouseholdState, limit = 12): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const tList = (id: string) => (state.taskLists || []).find((l) => l.id === id);
  for (const t of state.tasks || []) {
    const l = tList(t.listId);
    const where = l?.name || 'Tâches';
    const color = l?.color || '#7A9B76';
    if (t.edId) {
      // Un devoir importé d'ÉcoleDirecte : donné par son professeur, et coché soit
      // dans Foyer (par un membre), soit sur ÉcoleDirecte (par l'élève, sans auteur).
      const base = { what: t.text, where, color, kind: 'task' as const, ref: t.id };
      if (t.at) out.push({ ...base, at: t.at, by: null, via: ED, author: teacherOf(t.note) || ED, verb: 'a donné le devoir' });
      if (t.done && t.doneAt) out.push({ ...base, at: t.doneAt, by: t.doneBy ?? t.who[0] ?? null, via: t.doneBy ? null : ED, verb: 'a terminé le devoir' });
      continue;
    }
    if (t.revEx) {
      // L'entraînement du jour : posé chaque jour d'école par le serveur, ce n'est pas une nouvelle. Fait, c'est l'enfant qui l'a fait.
      if (t.done && t.doneAt) out.push({ at: t.doneAt, by: t.doneBy ?? t.who[0] ?? null, verb: 'a terminé la tâche', what: t.text, where, color, kind: 'task', ref: t.id });
      continue;
    }
    if (t.at) out.push({ at: t.at, by: t.by ?? null, via: t.via ?? null, verb: 'a ajouté la tâche', what: t.text, where, color, kind: 'task', ref: t.id });
    if (t.history?.length) {
      for (const h of t.history) if (h.at) out.push({ at: h.at, by: h.by, verb: 'a terminé la tâche', what: t.text, where, color, kind: 'task', ref: t.id });
    } else if (t.done && t.doneAt) {
      out.push({ at: t.doneAt, by: t.doneBy ?? null, verb: 'a terminé la tâche', what: t.text, where, color, kind: 'task', ref: t.id });
    }
  }
  const sList = (id: string) => (state.shopLists || []).find((l) => l.id === id);
  for (const s of state.shop || []) {
    if (!s.at) continue;
    const l = sList(s.listId);
    out.push({ at: s.at, by: s.by ?? null, via: s.via ?? null, verb: SHOP_VERB[s.state] || 'a modifié l’article', what: s.name, where: l?.name || 'Courses', color: l?.color || '#4E93B8', kind: 'shop', ref: s.listId });
  }
  // Événements de l'agenda : programmation (at/by) et retouche (upAt/upBy). Le
  // verbe nomme le type et le badge « Agenda » situe ; le nom ouvre la fiche.
  for (const ev of state.events || []) {
    if (ev.at) out.push({ at: ev.at, by: ev.by ?? null, verb: 'a programmé l’évènement', what: ev.title, where: 'Agenda', color: '#E56B4E', kind: 'event', ref: ev.id });
    if (ev.upAt) out.push({ at: ev.upAt, by: ev.upBy ?? null, verb: 'a modifié l’évènement', what: ev.title, where: 'Agenda', color: '#E56B4E', kind: 'event', ref: ev.id });
  }
  // Repas planifiés : le moment donne le verbe, le plat (texte libre ou recette)
  // nomme le geste, la clé du créneau ouvre la fiche au clic.
  const recName = new Map((state.recipes || []).map((r) => [r.id, r.name] as const));
  for (const [key, v] of Object.entries(state.meals || {})) {
    if (!v?.at) continue;
    const dish = (v.items || []).map((it) => it.text || recName.get(it.rid || '') || '').filter(Boolean).join(', ');
    out.push({ at: v.at, by: v.by ?? null, verb: MEAL_VERB[key.slice(11)] || 'a prévu le repas', what: dish || 'un repas', where: 'Repas', color: '#4E93B8', kind: 'meal', ref: key });
  }
  // Recettes ajoutées au carnet.
  for (const r of state.recipes || []) {
    if (r.at) out.push({ at: r.at, by: r.by ?? null, verb: 'a ajouté la recette', what: r.name, where: 'Recettes', color: r.color || '#E56B4E', kind: 'recipe', ref: r.id });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** « à l'instant », « il y a 3 min », « hier », puis une date courte au-delà d'un mois. */
export function relTime(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return 'à l’instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j === 1) return 'hier';
  if (j < 7) return `il y a ${j} j`;
  const sem = Math.floor(j / 7);
  if (sem < 5) return `il y a ${sem} sem`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/**
 * Un groupe du fil : une entrée seule, ou plusieurs gestes de même nature
 * fusionnés (« Thomas a ajouté 9 évènements au calendrier »). Seul, `bold` est
 * le nom de l'élément ; groupé, le compte (« 9 évènements ») et `titles` donne
 * les premiers noms pour la sous-ligne.
 */
export interface ActivityGroup {
  /** Instant du geste le plus récent du groupe. */
  at: string;
  first: ActivityEntry;
  count: number;
  verb: string;
  bold: string;
  tail: string;
  titles: string[];
}

// La forme groupée de chaque verbe : la même clé fusionne (même verbe de base,
// même module), le pluriel nomme le compte, la fin situe.
const GROUP: Record<string, { key: string; verb: string; many: string; tail: string }> = {
  'a ajouté la tâche': { key: 'task-add', verb: 'a ajouté', many: 'tâches', tail: '' },
  'a terminé la tâche': { key: 'task-done', verb: 'a terminé', many: 'tâches', tail: '' },
  'a donné le devoir': { key: 'hw-add', verb: 'a donné', many: 'devoirs', tail: '' },
  'a terminé le devoir': { key: 'hw-done', verb: 'a terminé', many: 'devoirs', tail: '' },
  [SHOP_VERB['a-prendre']]: { key: 'shop-add', verb: 'a ajouté', many: 'articles', tail: ' aux courses' },
  [SHOP_VERB['panier']]: { key: 'shop-check', verb: 'a coché', many: 'articles', tail: '' },
  [SHOP_VERB['indisponible']]: { key: 'shop-missing', verb: 'a noté introuvables', many: 'articles', tail: '' },
  'a modifié l’article': { key: 'shop-edit', verb: 'a modifié', many: 'articles', tail: '' },
  'a programmé l’évènement': { key: 'event-add', verb: 'a ajouté', many: 'évènements', tail: ' au calendrier' },
  'a modifié l’évènement': { key: 'event-edit', verb: 'a modifié', many: 'évènements', tail: '' },
  ...Object.fromEntries(['a prévu le repas', ...Object.values(MEAL_VERB)].map((v) => [v, { key: 'meal-plan', verb: 'a prévu', many: 'repas', tail: '' }])),
  'a ajouté la recette': { key: 'recipe-add', verb: 'a ajouté', many: 'recettes', tail: ' au carnet' },
};

/** Écart maximal entre deux gestes consécutifs d'un même groupe. */
const GROUP_WINDOW_MS = 30 * 60_000;

/**
 * Fusionne les entrées consécutives (le fil est trié du plus récent au plus
 * ancien) qui ont le même auteur, le même verbe de base et le même module, à
 * 30 minutes au plus l'une de l'autre.
 */
export function groupActivity(entries: ActivityEntry[]): ActivityGroup[] {
  const out: { key: string | null; last: number; items: ActivityEntry[] }[] = [];
  for (const e of entries) {
    const key = GROUP[e.verb]?.key ?? null;
    const t = new Date(e.at).getTime();
    const g = out[out.length - 1];
    const f = g?.items[0];
    if (g && key && g.key === key && f.by === e.by && (f.via ?? null) === (e.via ?? null) && f.author === e.author && g.last - t <= GROUP_WINDOW_MS) {
      g.items.push(e); g.last = t;
    } else out.push({ key, last: t, items: [e] });
  }
  return out.map(({ items }) => {
    const first = items[0];
    if (items.length === 1) return { at: first.at, first, count: 1, verb: first.verb, bold: first.what, tail: '', titles: [] };
    const p = GROUP[first.verb];
    return { at: first.at, first, count: items.length, verb: p.verb, bold: `${items.length} ${p.many}`, tail: p.tail, titles: [...new Set(items.map((x) => x.what))] };
  });
}
