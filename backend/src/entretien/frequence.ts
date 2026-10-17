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
