// À quel membre du foyer rattacher un élève ÉcoleDirecte. Pur, testé à part.
//
// Rien n'est jamais associé sans confirmation : ce qui sort d'ici est une
// proposition, qu'un administrateur confirme d'un tap ou corrige.
//
//   1. Un élève déjà associé à la main (ou confirmé) sous le même prénom et le
//      même nom, dans n'importe quel compte, même archivé : on reprend ce choix.
//      C'est le cas de la rentrée, quand ÉcoleDirecte change l'identifiant.
//   2. Sinon, le prénom, sans accents ni casse, comparé au nom du membre ou à
//      son premier mot. Un seul membre doit correspondre ; à égalité, on
//      préfère un enfant ; toujours ambigu, on ne propose rien.
//   « Nolan-Pierre » ne correspond pas à « Nolan » : un prénom composé ne se
//   devine pas, il se choisit.

export interface MemberLite { id: string; name: string; enfant?: boolean; }
export interface PriorLink { firstName: string; lastName: string; memberId: string | null; matchSource: 'prenom' | 'manuel' | null; linkState: string; }
export interface Proposal { memberId: string; matchSource: 'prenom' | 'manuel'; }

/** Minuscules, sans accents, espaces resserrés. */
export const normName = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function propose(firstName: string, lastName: string, members: MemberLite[], prior: PriorLink[]): Proposal | null {
  const fn = normName(firstName), ln = normName(lastName);
  if (!fn) return null;
  const known = new Set(members.map((m) => m.id));
  const before = prior.find((p) => p.linkState === 'confirme' && p.memberId && known.has(p.memberId)
    && normName(p.firstName) === fn && normName(p.lastName) === ln);
  if (before) return { memberId: before.memberId!, matchSource: before.matchSource === 'manuel' ? 'manuel' : 'prenom' };

  let hits = members.filter((m) => { const n = normName(m.name); return n === fn || n.split(' ')[0] === fn; });
  if (hits.length > 1) hits = hits.filter((m) => m.enfant);
  return hits.length === 1 ? { memberId: hits[0].id, matchSource: 'prenom' } : null;
}
