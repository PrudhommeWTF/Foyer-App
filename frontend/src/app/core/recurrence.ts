// Le moteur de récurrence des tâches : quand revient une tâche qu'on vient de
// faire.
//
// **Ce fichier existe en deux copies identiques octet pour octet :**
//
//   frontend/src/app/core/recurrence.ts
//   backend/src/tasks/recurrence.ts
//
// Le navigateur calcule l'occurrence suivante d'une coche et l'envoie avec
// elle ; le serveur se sert de la même règle là où personne ne la lui envoie
// (un geste d'entretien, noté depuis l'écran ou par un assistant). Un seul
// moteur, donc, et la CI échoue à la moindre différence entre les deux copies
// (backend/test/recurrence-copy.test.ts), comme pour le registre des réglages.
// C'est aussi pourquoi ce fichier n'importe rien : il doit rester copiable tel
// quel, et ses calculs de dates se font en UTC pour ne dépendre ni du fuseau du
// navigateur ni de celui du serveur.
//
// Deux modes, explicites, et c'est ce qui compte vraiment chez nous :
//
//   - **À date fixe** (`base: 'due'`) : les poubelles du mardi. La suivante est
//     la première date de la règle **strictement après** la plus tardive des
//     deux, échéance ou réalisation. Faite avec trois semaines de retard, la
//     série ne rattrape pas les occurrences manquées : elles ne sont plus à
//     faire, et l'accumuler serait un reproche.
//   - **Après la réalisation** (`base: 'done'`) : le test de l'eau de la piscine,
//     toutes les semaines à partir du moment où il a été fait. Fait le dimanche
//     avec deux jours de retard, la suivante tombe le dimanche d'après, pas le
//     samedi. Les jours de la semaine n'ont pas de sens ici : la cadence part
//     du geste.
//
// Et une option, la **saison** (`season`, de MM-JJ à MM-JJ) : la série ne tombe
// que pendant cette partie de l'année. Le pH de la piscine chaque semaine, de
// mai à septembre : l'occurrence qui tomberait en octobre saute au 1er mai
// suivant. Une saison peut passer le 31 décembre (de novembre à mars).

/** La règle d'une série, telle que la portent les tâches (RecRule des deux côtés). */
export interface RecRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  every: number;
  days?: number[];
  base: 'due' | 'done';
  grace?: number;
  until?: string | null;
  season?: Season | null;
}
/** Une partie de l'année, bornes comprises, en MM-JJ : `{ from: '05-01', to: '09-30' }`. */
export interface Season { from: string; to: string; }
/** Ce que le calendrier lit d'une tâche pour savoir si elle tombe un jour donné. */
export interface RecTask { due: string | null; rec?: RecRule | null; }

const pad2 = (n: number): string => String(n).padStart(2, '0');
const utc = (iso: string): number => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y || 1970, (m || 1) - 1, d || 1); };
const isoOf = (t: number): string => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
const addDaysIso = (iso: string, n: number): string => isoOf(utc(iso) + n * 86400000);
/** Lundi = 1 … dimanche = 7. */
const weekdayOf = (iso: string): number => { const j = new Date(utc(iso)).getUTCDay(); return j === 0 ? 7 : j; };

/** Au-delà, on cesse de chercher : une règle qui ne tombe sur rien en cinq ans est vide. */
const HORIZON_DAYS = 366 * 5;

const daysBetween = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / 86400000);
const dom = (iso: string): number => parseInt(iso.slice(8, 10), 10);
const month = (iso: string): number => parseInt(iso.slice(5, 7), 10);
const year = (iso: string): number => parseInt(iso.slice(0, 4), 10);
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Le lundi de la semaine d'une date. */
const mondayOf = (iso: string): string => addDaysIso(iso, 1 - weekdayOf(iso));

/** Ajoute des mois en gardant le jour du mois, borné à la fin du mois d'arrivée (le 31 janvier + 1 mois = le 28 février). */
export function addMonthsClamped(iso: string, n: number): string {
  const y = year(iso); const m = month(iso); const d = dom(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12); const nm = (total % 12) + 1;
  return `${ny}-${pad2(nm)}-${pad2(Math.min(d, daysInMonth(ny, nm)))}`;
}

/** Une borne de saison bien formée : MM-JJ d'un jour qui existe (le 29 février compris). */
export const isSeasonDay = (md: unknown): md is string => typeof md === 'string' && /^\d{2}-\d{2}$/.test(md)
  && +md.slice(0, 2) >= 1 && +md.slice(0, 2) <= 12 && +md.slice(3) >= 1 && +md.slice(3) <= daysInMonth(2024, +md.slice(0, 2));

/** Le jour est-il dans la saison ? Sans saison, toujours. Une saison qui passe le 31 décembre se lit à cheval. */
export function inSeason(season: Season | null | undefined, iso: string): boolean {
  if (!season) return true;
  const md = iso.slice(5, 10);
  return season.from <= season.to ? md >= season.from && md <= season.to : md >= season.from || md <= season.to;
}

/** Le jour lui-même s'il est dans la saison, sinon le prochain début de saison (le 29 février tombe le 28 les autres années). */
export function seasonStart(season: Season | null | undefined, iso: string): string {
  if (!season || inSeason(season, iso)) return iso;
  const at = (y: number): string => { const m = +season.from.slice(0, 2); return `${y}-${pad2(m)}-${pad2(Math.min(+season.from.slice(3), daysInMonth(y, m)))}`; };
  const here = at(year(iso));
  return here > iso ? here : at(year(iso) + 1);
}

/**
 * La fenêtre annuelle en cours ou à venir d'une saison, comme une échéance et
 * une souplesse : ramoner entre le 1er septembre et le 31 octobre, c'est une
 * échéance au 1er septembre et 60 jours de souplesse, sur une règle annuelle à
 * date fixe. Dans la fenêtre, c'est celle qui court (le geste n'est pas encore
 * en retard) ; après, la suivante.
 */
export function seasonWindow(s: Season, today: string): { due: string; grace: number } {
  const at = (y: number, md: string): string => { const m = +md.slice(0, 2); return `${y}-${md.slice(0, 2)}-${pad2(Math.min(+md.slice(3), daysInMonth(y, m)))}`; };
  const y = year(today);
  const due = !inSeason(s, today) ? seasonStart(s, today) : at(y, s.from) <= today ? at(y, s.from) : at(y - 1, s.from);
  const end = at(year(due), s.to) >= due ? at(year(due), s.to) : at(year(due) + 1, s.to);
  return { due, grace: Math.min(365, daysBetween(due, end)) };
}

/** La règle tombe-t-elle ce jour-là, la série étant ancrée sur `origin` ? */
function matches(rec: RecRule, origin: string, day: string): boolean {
  const every = Math.max(1, rec.every || 1);
  switch (rec.freq) {
    case 'daily': return daysBetween(origin, day) % every === 0;
    case 'weekly': {
      const days = rec.days?.length ? rec.days : [weekdayOf(origin)];
      if (!days.includes(weekdayOf(day))) return false;
      const weeks = Math.round(daysBetween(mondayOf(origin), mondayOf(day)) / 7);
      return weeks % every === 0;
    }
    case 'monthly': {
      const months = (year(day) - year(origin)) * 12 + (month(day) - month(origin));
      return months % every === 0 && dom(day) === Math.min(dom(origin), daysInMonth(year(day), month(day)));
    }
    case 'yearly':
      return (year(day) - year(origin)) % every === 0 && month(day) === month(origin)
        && dom(day) === Math.min(dom(origin), daysInMonth(year(day), month(day)));
  }
}

/** La première date de la règle strictement après `after`, ou null au-delà de l'horizon. */
function firstMatchAfter(rec: RecRule, origin: string, after: string): string | null {
  let day = addDaysIso(after, 1);
  for (let i = 0; i < HORIZON_DAYS; i++, day = addDaysIso(day, 1)) if (inSeason(rec.season, day) && matches(rec, origin, day)) return day;
  return null;
}

/** Un pas de la cadence à partir d'une date : N jours, N semaines, N mois, N ans. */
function stepFrom(iso: string, rec: RecRule): string {
  const n = Math.max(1, rec.every || 1);
  switch (rec.freq) {
    case 'daily': return addDaysIso(iso, n);
    case 'weekly': return addDaysIso(iso, 7 * n);
    case 'monthly': return addMonthsClamped(iso, n);
    case 'yearly': return addMonthsClamped(iso, 12 * n);
  }
}

/**
 * L'échéance suivante d'une série dont on vient de solder l'occurrence `due`,
 * le jour `doneOn`. Null quand la série s'arrête (fin dépassée).
 */
export function nextOccurrence(rec: RecRule, due: string, doneOn: string): string | null {
  const next = rec.base === 'done'
    ? seasonStart(rec.season, stepFrom(doneOn, rec))
    : firstMatchAfter(rec, due, due > doneOn ? due : doneOn);
  if (!next) return null;
  if (rec.until && next > rec.until) return null;
  return next;
}

/** L'échéance courante d'une série, décalée d'une occurrence sans la faire. */
export function skipOccurrence(rec: RecRule, due: string, today: string): string | null {
  return nextOccurrence(rec, due, rec.base === 'done' ? (due > today ? due : today) : due);
}

/**
 * Combien de fois une série revient en moyenne par an : ce qui chiffre un
 * coût annuel prévu. Par la cadence quand elle suffit (toutes les 4 semaines :
 * 13 ; tous les 2 ans : 0,5) ; sinon, avec une saison ou plusieurs jours de la
 * semaine, en déroulant la règle sur quatre ans à partir de `from` (la piscine
 * chaque semaine de mai à septembre revient 22 fois, pas 52). En mode « après
 * la réalisation », chaque occurrence est supposée faite le jour même.
 */
export function occurrencesPerYear(rec: RecRule, from: string): number {
  const n = Math.max(1, rec.every || 1);
  // Sans saison ni jours choisis, la cadence suffit : « toutes les 4 semaines », 13 fois.
  if (!rec.season && !(rec.freq === 'weekly' && rec.base === 'due' && (rec.days?.length || 0) > 1)) {
    return { daily: 365, weekly: 52, monthly: 12, yearly: 1 }[rec.freq] / n;
  }
  const end = addDaysIso(from, 4 * 365 + 1);
  let count = 0;
  let due: string | null = rec.base === 'due' ? (inSeason(rec.season, from) && matches(rec, from, from) ? from : firstMatchAfter(rec, from, from)) : seasonStart(rec.season, from);
  while (due && due < end && count < 4 * 366) { count++; due = nextOccurrence({ ...rec, until: null }, due, due); }
  return count / 4;
}

/** Dernier jour où une occurrence n'est pas encore en retard : l'échéance, plus la tolérance. */
export function windowEnd(due: string, rec: RecRule | null | undefined): string {
  return rec?.grace ? addDaysIso(due, rec.grace) : due;
}

/** Un pas de cadence EN ARRIÈRE : l'occurrence précédente, une cadence avant `iso`. Miroir de stepFrom. */
function stepBack(iso: string, rec: RecRule): string {
  const n = Math.max(1, rec.every || 1);
  switch (rec.freq) {
    case 'daily': return addDaysIso(iso, -n);
    case 'weekly': return addDaysIso(iso, -7 * n);
    case 'monthly': return addMonthsClamped(iso, -n);
    case 'yearly': return addMonthsClamped(iso, -12 * n);
  }
}

/**
 * Où en est le cycle courant d'une série, entre l'occurrence précédente (0) et
 * l'échéance à venir (1). Sert à remplir une barre le long de la tâche à mesure
 * que l'occurrence approche : vide au lendemain de la précédente, pleine à
 * l'échéance et au-delà.
 */
export function occurrenceProgress(rec: RecRule, due: string, today: string): number {
  if (today >= due) return 1;
  const start = stepBack(due, rec);
  // Hors saison, rien ne court : la barre reste vide jusqu'à la reprise.
  if (today <= start || !inSeason(rec.season, start)) return 0;
  const total = daysBetween(start, due);
  return total <= 0 ? 1 : Math.max(0, Math.min(1, daysBetween(start, today) / total));
}

/**
 * Une tâche a-t-elle une occurrence ce jour-là, pour l'affichage au calendrier ?
 *
 * Sans récurrence, la tâche ne tombe qu'à son échéance. Avec, on **projette la
 * règle vers l'avant** à partir de l'échéance courante : rien avant elle (les
 * occurrences passées sont soldées ou sautées, elles ne sont plus dues), rien
 * après la fin de série. Le mode « après la réalisation » ne se projette pas :
 * l'occurrence suivante dépend du jour où l'on fait la tâche, pas d'un calendrier
 * connu d'avance, donc on ne montre que l'échéance courante plutôt que d'inventer
 * des dates.
 */
export function taskOccursOn(task: RecTask, date: string): boolean {
  if (!task.due) return false;
  if (!task.rec) return task.due === date;
  if (date < task.due) return false;
  if (task.rec.until && date > task.rec.until) return false;
  if (task.rec.base === 'done') return date === task.due;
  return inSeason(task.rec.season, date) && matches(task.rec, task.due, date);
}

export const DOW_SHORT = ['', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
export const FREQ_LABELS: Record<RecRule['freq'], string> = { daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois', yearly: 'Chaque année' };
const EVERY_LABELS: Record<RecRule['freq'], (n: number) => string> = {
  daily: (n) => `Tous les ${n} jours`,
  weekly: (n) => `Toutes les ${n} semaines`,
  monthly: (n) => `Tous les ${n} mois`,
  yearly: (n) => `Tous les ${n} ans`,
};

const MONTHS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dayLabel = (md: string): string => { const d = +md.slice(3); return `${d === 1 ? '1er' : d} ${MONTHS[+md.slice(0, 2)]}`; };
/** Une saison en mois entiers : du 1er au dernier jour (le 29 février compte pour la fin de février). */
const wholeMonths = (s: Season): boolean => s.from.endsWith('-01') && +s.to.slice(3) === daysInMonth(2024, +s.to.slice(0, 2));

/** « de mai à septembre », « d'octobre à mars », « du 15 avril au 30 septembre ». */
export function seasonLabel(s: Season): string {
  if (!wholeMonths(s)) return `du ${dayLabel(s.from)} au ${dayLabel(s.to)}`;
  const a = MONTHS[+s.from.slice(0, 2)]; const b = MONTHS[+s.to.slice(0, 2)];
  if (a === b) return `en ${a}`;
  return `${/^[aeiouy]/.test(a) ? "d'" : 'de '}${a} à ${b}`;
}

/** « Toutes les 2 semaines (lun., jeu.) », « Chaque semaine après la réalisation, souplesse 3 j ». */
export function recLabel(rec: RecRule, fmt?: (iso: string) => string): string {
  const n = Math.max(1, rec.every || 1);
  let s = n === 1 ? FREQ_LABELS[rec.freq] : EVERY_LABELS[rec.freq](n);
  if (rec.freq === 'weekly' && rec.base === 'due' && rec.days?.length) s += ' (' + rec.days.map((d) => DOW_SHORT[d]).join(', ') + ')';
  if (rec.base === 'done') s += ' après la réalisation';
  if (rec.season) s += ', ' + seasonLabel(rec.season);
  if (rec.grace) s += `, souplesse ${rec.grace} j`;
  if (rec.until && fmt) s += `, jusqu'au ${fmt(rec.until)}`;
  return s;
}
