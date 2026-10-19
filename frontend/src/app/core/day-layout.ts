// Le placement des éléments horaires d'une journée dans une grille : partagé par
// le Calendrier (vues Semaine et 3 jours) et l'Emploi du temps.

/** Ce qu'on pose : un élément quelconque, son heure de début et (peut-être) de fin. */
export interface TimedInput<T> { item: T; start: string; end?: string | null; }

/** Un élément posé : début et fin en minutes depuis minuit, sa colonne et le nombre de colonnes de sa grappe. */
export interface Placed<T> { item: T; s: number; e: number; col: number; cols: number; }

/** Minutes depuis minuit d'une heure « HH:MM », 0 si illisible. */
export function toMinutes(t: string | null | undefined): number {
  const m = /^(\d\d):(\d\d)/.exec(t || '');
  return m ? (+m[1]) * 60 + (+m[2]) : 0;
}

/**
 * Pose les éléments horaires d'une journée : chacun de son début à sa fin (un
 * élément sans fin, ou dont la fin précède le début, dure `minDur` minutes), les
 * chevauchements répartis en colonnes côte à côte.
 *
 * Le partage se fait **par grappe** : des éléments qui se recouvrent, de proche
 * en proche, se partagent la largeur ; un élément seul dans sa grappe la prend
 * tout entière, même si la journée en compte d'autres à d'autres heures.
 */
export function layoutTimed<T>(items: TimedInput<T>[], opts: { minDur?: number } = {}): Placed<T>[] {
  const minDur = opts.minDur ?? 30;
  const evs = items
    .map((x) => {
      const s = Math.max(0, Math.min(1439, toMinutes(x.start)));
      let e = x.end ? toMinutes(x.end) : s + minDur;
      if (e <= s) e = Math.min(1440, s + minDur);
      return { item: x.item, s, e, col: 0, cols: 1 };
    })
    .sort((a, b) => a.s - b.s || a.e - b.e);
  const placed: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let clusterEnd = -1;
  const flush = (): void => {
    const cols = Math.max(...cluster.map((p) => p.col)) + 1;
    for (const p of cluster) p.cols = cols;
    placed.push(...cluster);
    cluster = [];
  };
  for (const ev of evs) {
    if (cluster.length && ev.s >= clusterEnd) { flush(); clusterEnd = -1; }
    // Première colonne libre : celle dont le dernier élément s'achève avant celui-ci.
    const colEnd: number[] = [];
    for (const p of cluster) colEnd[p.col] = Math.max(colEnd[p.col] ?? -1, p.e);
    let col = 0;
    while (colEnd[col] !== undefined && colEnd[col] > ev.s) col++;
    ev.col = col;
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.e);
  }
  if (cluster.length) flush();
  return placed;
}

/** Un créneau couvre-t-il toute la journée (00:00 → 23:59 ou plus) ? Il va alors au bandeau « journée », pas dans la grille. */
export function isWholeDay(start: string, end: string | null | undefined): boolean {
  return toMinutes(start) === 0 && toMinutes(end) >= 23 * 60 + 59;
}

/**
 * La plage d'heures pleines à montrer : de l'heure pleine qui précède le premier
 * début à celle qui suit la dernière fin, bornée à [lo, hi]. Sans élément, la
 * plage par défaut.
 */
export function hourRange(placed: { s: number; e: number }[], dflt: [number, number] = [7, 19], lo = 6, hi = 22): [number, number] {
  if (!placed.length) return dflt;
  const first = Math.min(...placed.map((p) => p.s));
  const last = Math.max(...placed.map((p) => p.e));
  const from = Math.max(lo, Math.floor(first / 60));
  const to = Math.min(hi, Math.max(from + 1, Math.ceil(last / 60)));
  return [from, to];
}
