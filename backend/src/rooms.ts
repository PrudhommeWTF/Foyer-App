// Les pièces de la maison : un socle commun du document (`rooms`), hors de
// tout module. Entretien y range ses gestes (`maintenance.roomId`), Équipements
// ses appareils (`eqp_items.room`) ; une seule liste à tenir, toujours là quels
// que soient les modules allumés, et sauvegardée avec le document.
//
// Elles s'écrivent par l'enregistrement du document, comme les listes de
// tâches. Ce fichier tient la forme admise et les pièces de départ.
import type { Room } from './models';

/** Les icônes admises, liste fermée. Une icône inconnue devient « autre » plutôt que de faire échouer l'enregistrement. */
export const ROOM_ICONS = ['cuisine', 'salon', 'bain', 'chambre', 'bureau', 'buanderie', 'garage', 'cave', 'exterieur', 'autre'] as const;

/**
 * Les pièces posées à la création du foyer. Ce sont des données : on les
 * renomme, les réordonne ou les archive. Identifiants fixes, pour que la reprise
 * des pièces d'Équipements les retrouve par leur nom sans les doubler.
 */
export const STARTER_ROOMS = (): Room[] => ([
  ['p-cuisine', 'Cuisine', 'cuisine'], ['p-salon', 'Salon', 'salon'], ['p-bain', 'Salle de bain', 'bain'],
  ['p-chambre-1', 'Chambre 1', 'chambre'], ['p-chambre-2', 'Chambre 2', 'chambre'], ['p-bureau', 'Bureau', 'bureau'],
  ['p-buanderie', 'Buanderie', 'buanderie'], ['p-garage', 'Garage', 'garage'], ['p-cave', 'Cave', 'cave'],
  ['p-exterieur', 'Extérieur', 'exterieur'],
] as const).map(([id, name, icon], position) => ({ id, name, icon, position }));

/** Un nom de pièce comparable : casse, accents et espaces ne distinguent pas deux pièces. */
export const roomKey = (name: string): string => name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

type Doc = Record<string, any>;

/**
 * Les pièces d'un document reçu, remises en forme. Un client d'une version
 * antérieure, qui ne connaît pas `rooms`, l'enverrait absent : on garde alors
 * celles du serveur, plutôt que d'effacer le rangement de chaque geste et de
 * chaque appareil. Une entrée sans identifiant ni nom est écartée, une icône
 * inconnue devient « autre ».
 */
export function preserveRooms(incoming: Doc, current: Doc): void {
  const src: unknown[] = Array.isArray(incoming['rooms']) ? incoming['rooms'] : Array.isArray(current['rooms']) ? current['rooms'] : [];
  const out: Room[] = [];
  for (const raw of src) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = typeof r['id'] === 'string' ? r['id'].trim().slice(0, 80) : '';
    const name = typeof r['name'] === 'string' ? r['name'].trim().slice(0, 60) : '';
    if (!id || !name || out.some((x) => x.id === id)) continue;
    const icon = (ROOM_ICONS as readonly string[]).includes(String(r['icon'])) ? String(r['icon']) : 'autre';
    out.push({ id, name, icon, position: typeof r['position'] === 'number' ? r['position'] : out.length, ...(r['archived'] === true ? { archived: true } : {}) });
  }
  incoming['rooms'] = out;
}

/** Les pièces du document, par identifiant. */
export const roomsById = (doc: Doc): Map<string, Room> => new Map((Array.isArray(doc['rooms']) ? doc['rooms'] as Room[] : []).map((r) => [r.id, r]));
