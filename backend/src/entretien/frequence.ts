// Une fréquence dite en français, vers une règle de récurrence : ce que
// l'assistant reçoit (« tous les 6 mois ») quand il crée un geste. Pur, sans
// base ni réseau : c'est ce qui permet de le tester à part.

const norm = (s: string): string => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Une fréquence dite en français, vers une règle « à partir du geste ». Rend
 * null sur ce qu'on ne sait pas lire, plutôt qu'une cadence inventée.
 * « toutes les 4 semaines », « tous les 6 mois », « 1 fois par an »,
 * « chaque année », « tous les 5 ans », « hebdomadaire », « tous les 10 jours ».
 */
export function parseFrequence(v: string): { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; every: number } | null {
  const s = norm(v).replace(/[’']/g, ' ');
  const unit = (u: string): 'daily' | 'weekly' | 'monthly' | 'yearly' | null =>
    /^jours?$/.test(u) ? 'daily' : /^semaines?$/.test(u) ? 'weekly' : /^mois$/.test(u) ? 'monthly' : /^(ans?|annees?)$/.test(u) ? 'yearly' : null;
  let m = /^(?:tou(?:te)?s les|chaque|toutes les|tous les)\s+(\d{1,2})\s+(\w+)$/.exec(s);
  if (m) { const f = unit(m[2]); const n = +m[1]; return f && n >= 1 && n <= 99 ? { freq: f, every: n } : null; }
  m = /^(?:chaque|tou(?:te)?s les)\s+(\w+)$/.exec(s);
  if (m) { const f = unit(m[1]); return f ? { freq: f, every: 1 } : null; }
  m = /^(?:1|une) fois par (\w+)$/.exec(s);
  if (m) { const f = unit(m[1]); return f ? { freq: f, every: 1 } : null; }
  const adj: Record<string, 'daily' | 'weekly' | 'monthly' | 'yearly'> = { quotidien: 'daily', quotidienne: 'daily', hebdomadaire: 'weekly', mensuel: 'monthly', mensuelle: 'monthly', annuel: 'yearly', annuelle: 'yearly' };
  return adj[s] ? { freq: adj[s], every: 1 } : null;
}

const MOIS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const pad2 = (n: number): string => String(n).padStart(2, '0');
/** Le dernier jour d'un mois, le 29 février compris : une saison « jusqu'à février » couvre aussi les années bissextiles. */
const lastDay = (m: number): number => new Date(Date.UTC(2024, m, 0)).getUTCDate();

/**
 * Une saison dite en français, vers ses bornes MM-JJ. Null sur ce qu'on ne sait
 * pas lire. « de mai à septembre », « d'octobre à mars », « du 15 avril au
 * 30 septembre », « en octobre », « mai-septembre ».
 */
export function parseSaison(v: string): { from: string; to: string } | null {
  const s = norm(v).replace(/[’']/g, ' ').replace(/\b1er\b/g, '1');
  const month = (w: string): number => MOIS.indexOf(w) + 1;
  const bound = (day: string | undefined, w: string, end: boolean): string | null => {
    const m = month(w); if (!m) return null;
    const d = day ? +day : end ? lastDay(m) : 1;
    return d >= 1 && d <= lastDay(m) ? `${pad2(m)}-${pad2(d)}` : null;
  };
  let m = /^(?:du |de |d )?(?:(\d{1,2}) )?(\p{L}+)\s*(?:au|a|jusqu au|-)\s*(?:(\d{1,2}) )?(\p{L}+)$/u.exec(s);
  if (m) { const from = bound(m[1], m[2], false); const to = bound(m[3], m[4], true); return from && to ? { from, to } : null; }
  m = /^(?:en )?(\p{L}+)$/u.exec(s);
  if (m) { const from = bound(undefined, m[1], false); const to = bound(undefined, m[1], true); return from && to ? { from, to } : null; }
  return null;
}
