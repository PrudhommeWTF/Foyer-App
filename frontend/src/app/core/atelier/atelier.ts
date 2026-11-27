// Atelier code, côté Foyer : ce que l'accueil et l'écran lisent du module, sans
// rien connaître des éditeurs. Pur : aucune dépendance à Angular ni au réseau.

export type Niveau = 'petits' | 'grands';
export interface Projet {
  id: string; memberId: string; level: Niveau; name: string; rev: number; thumbnail: { pagecount: number; md5: string } | null;
  updatedAt: string; archivedAt: string | null; shared: boolean; memberName?: string;
}
/** What an adult reads about another member's workshop. */
export interface Resume { id: string; name: string; enfant: boolean; projets: number; corbeille: number; recents: number; octets: number; niveaux: Niveau[]; }
/** A guided challenge of the 'Grands codeurs' level, as shipped with its editor. */
/** `camera`: the challenge needs the camera, so it is not offered when the household turned it off. */
export interface Defi { id: string; name: string; desc: string; camera?: boolean; }

export const NIVEAU: Record<Niveau, string> = { petits: 'Petits codeurs', grands: 'Grands codeurs' };
export const NIVEAUX: readonly Niveau[] = ['petits', 'grands'];

/** « Petits codeurs », « Grands codeurs », or « Les deux niveaux » : what a parent opened to a child. */
export function levelsLine(levels: readonly Niveau[]): string {
  return levels.length === 1 ? NIVEAU[levels[0]] : 'Les deux niveaux';
}

/** The tile of a child: the project to pick up, or nothing to say. */
export function resumeLine(last: Pick<Projet, 'name'> | null): string {
  return last ? `Reprendre : ${last.name}` : '';
}

/**
 * The tile of an adult: who worked on what this week. Only those who did are
 * named: a week without a project is never held against a child.
 */
export function weekLine(members: readonly Pick<Resume, 'name' | 'recents'>[]): string {
  return members.filter((m) => m.recents > 0)
    .map((m) => `${m.name} a travaillé sur ${m.recents} projet${m.recents > 1 ? 's' : ''} cette semaine`).join(', ');
}

/** « 12,4 Mo sur 500 » : the room a member uses, against the limit of the household. */
export function roomLine(octets: number, quotaMo: number): string {
  const mo = octets / 1048576;
  return `${mo < 10 ? mo.toFixed(1).replace('.', ',') : Math.round(mo)} Mo sur ${quotaMo}`;
}
