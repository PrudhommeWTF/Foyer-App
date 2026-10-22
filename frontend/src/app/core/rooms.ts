// Les pièces de la maison (socle Maison) : une seule liste pour tout le foyer,
// dans le document, que rangent Entretien (ses gestes) et Équipements (ses
// appareils). Ce fichier porte ce qui se décide sans Angular : le nom
// accepté, et ce qu'une pièce contient, pour dire avant de la supprimer ce qui
// passera « Sans pièce ».
import type { Room } from './models';
import { normText } from './helpers';

/** Ce qu'une pièce contient, module par module (un module éteint compte 0). */
export interface RoomUsage { equipements: number; gestes: number; }

/** Le décompte par pièce : appareils non archivés, gestes non terminés. */
export function roomUsage(rooms: Room[], equipements: { roomId: string | null; archivedAt?: string | null }[], gestes: { done?: boolean; maintenance?: { roomId?: string | null } | null }[]): Map<string, RoomUsage> {
  const out = new Map(rooms.map((r) => [r.id, { equipements: 0, gestes: 0 }]));
  for (const e of equipements) if (e.roomId && !e.archivedAt) { const u = out.get(e.roomId); if (u) u.equipements++; }
  for (const g of gestes) { const id = g.maintenance?.roomId; if (id && !g.done) { const u = out.get(id); if (u) u.gestes++; } }
  return out;
}

/** « 3 appareils et 1 geste », ou '' quand la pièce est vide. */
export function usageLabel(u: RoomUsage | undefined): string {
  if (!u) return '';
  const parts = [
    u.equipements ? `${u.equipements} appareil${u.equipements > 1 ? 's' : ''}` : '',
    u.gestes ? `${u.gestes} geste${u.gestes > 1 ? 's' : ''} d’entretien` : '',
  ].filter(Boolean);
  return parts.join(' et ');
}

/**
 * Le nom accepté pour une pièce, ou la raison du refus. Deux pièces du même nom
 * (casse et accents ignorés) feraient deux regroupements qu'on ne distingue
 * plus : refusé, à la création comme au renommage. `except` : la pièce renommée.
 */
export function roomNameCheck(rooms: Room[], name: string, except?: string): { ok: true; name: string } | { ok: false; error: string } {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) return { ok: false, error: 'Donnez un nom à la pièce.' };
  if (n.length > 60) return { ok: false, error: 'Un nom de pièce tient en 60 caractères.' };
  const twin = rooms.find((r) => r.id !== except && normText(r.name) === normText(n));
  if (twin) return { ok: false, error: `La pièce « ${twin.name} » existe déjà.` };
  return { ok: true, name: n };
}
