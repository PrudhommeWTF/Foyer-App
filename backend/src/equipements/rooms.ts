// Reprise des pièces d'Équipements dans le socle Maison partagé.
//
// La première version du module rangeait ses pièces dans sa propre table
// (`eqp_rooms`), alors qu'Entretien venait de poser une liste commune dans le
// document du foyer (`rooms`). Deux listes pour une même maison, c'était deux
// vérités : on garde la commune. Cette reprise s'exécute au démarrage, une seule
// fois (drapeau `rooms_adopted` dans eqp_meta) :
//
//   - socle vide : les pièces d'Équipements y sont recopiées, dans leur ordre
//     (ce sont les pièces de départ, éventuellement renommées) ;
//   - chaque fiche rattachée à une pièce reçoit l'identifiant de la pièce du
//     socle qui porte le même nom (casse et accents ignorés), créée au besoin.
//
// Rien n'est effacé : eqp_rooms et room_id restent en base, inutilisés.
import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { norm } from './search';
import { log } from '../log';

interface SharedRoom { id: string; name: string; position: number; }

export const roomId = (): string => 'p' + crypto.randomBytes(5).toString('hex');

export function adoptSharedRooms(db: Database): void {
  const done = db.prepare("SELECT value FROM eqp_meta WHERE key = 'rooms_adopted'").get();
  if (done) return;
  const row = db.prepare('SELECT state FROM household WHERE id = 1').get() as { state: string } | undefined;
  // Pas encore de foyer : il naîtra avec ses pièces de départ, rien à reprendre.
  if (!row) return;
  const doc = JSON.parse(row.state) as { rooms?: SharedRoom[] };
  const rooms: SharedRoom[] = Array.isArray(doc.rooms) ? doc.rooms : [];
  const old = db.prepare('SELECT id, name, archived_at FROM eqp_rooms ORDER BY position, id').all() as { id: number; name: string; archived_at: string | null }[];
  let changed = false;
  const byName = new Map(rooms.map((r) => [norm(r.name), r.id]));
  const add = (name: string): string => {
    const r = { id: roomId(), name, position: rooms.reduce((m, x) => Math.max(m, (x.position ?? 0) + 1), 0) };
    rooms.push(r); byName.set(norm(name), r.id); changed = true;
    return r.id;
  };
  const copied = !rooms.length;
  if (copied) for (const r of old) if (!r.archived_at) add(r.name);

  const items = db.prepare('SELECT i.id, r.name FROM eqp_items i JOIN eqp_rooms r ON r.id = i.room_id WHERE i.room_ref IS NULL').all() as { id: number; name: string }[];
  const upd = db.prepare('UPDATE eqp_items SET room_ref = ? WHERE id = ?');
  db.transaction(() => {
    for (const it of items) upd.run(byName.get(norm(it.name)) ?? add(it.name), it.id);
    if (changed) {
      doc.rooms = rooms;
      db.prepare("UPDATE household SET state = ?, version = version + 1, updated_at = datetime('now') WHERE id = 1").run(JSON.stringify(doc));
    }
    db.prepare("INSERT OR REPLACE INTO eqp_meta (key, value) VALUES ('rooms_adopted', datetime('now'))").run();
  })();
  if (copied || items.length) {
    log.info(`Équipements : pièces reprises dans la liste partagée du foyer (${copied ? old.filter((r) => !r.archived_at).length + ' pièce(s) recopiée(s), ' : ''}${items.length} fiche(s) rattachée(s)).`);
  }
}
