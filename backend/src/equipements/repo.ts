// Accès aux données du module « Équipements ». Écritures granulaires, une fiche
// à la fois : deux téléphones qui complètent deux fiches n'ont rien à fusionner.
// Rien n'est supprimé, ni une fiche (statut daté puis archivage), ni une pièce
// de la maison (archivage), ni un événement d'historique (archivage). Seuls les
// rattachements de fichiers se retirent pour de bon : une photo ratée n'a pas à
// rester, et le fichier quitte le disque quand plus rien ne le cite.
import type { Database } from 'better-sqlite3';
import { initBackup } from './backup';
import { Invalid } from './http';
import { Condition } from './warranty';

let database: Database;
export function initEquipementsRepo(db: Database): void {
  database = db;
  initBackup(db);
}

// Les listes fermées. Stockées en texte libre (pas de contrainte SQL) : ajouter
// une valeur ne demande aucune migration. Les routes refusent l'inconnu.
export const ROOM_ICONS = ['cuisine', 'salon', 'bain', 'chambre', 'bureau', 'buanderie', 'garage', 'cave', 'exterieur', 'autre'] as const;
export const CATEGORIES = ['electromenager', 'multimedia', 'chauffage_clim', 'securite', 'jardin_piscine', 'informatique', 'mobilier', 'autre'] as const;
export type Category = typeof CATEGORIES[number];
export const STATUSES = ['en_service', 'en_panne', 'remplace', 'donne_vendu', 'jete'] as const;
export type Status = typeof STATUSES[number];
export const ATTACHMENT_KINDS = ['facture', 'plaque', 'notice', 'photo', 'autre'] as const;
export type AttachmentKind = typeof ATTACHMENT_KINDS[number];
export const EVENT_KINDS = ['achat', 'panne', 'reparation', 'sav', 'remplacement', 'note'] as const;
export type EventKind = typeof EVENT_KINDS[number];

export interface Room { id: number; name: string; icon: string; position: number; archivedAt: string | null; items: number; }
export interface Item {
  id: number; roomId: number | null; assetId: number | null; name: string; category: Category;
  brand: string; model: string; serial: string; purchasedOn: string | null; purchasePrice: number | null;
  vendor: string; condition: Condition; warrantyMonths: number | null; warrantyUntil: string | null;
  warrantyNote: string; notes: string; status: Status; statusOn: string | null; replacedBy: number | null;
  createdBy: string | null; createdVia: string | null; createdAt: string; updatedBy: string | null; updatedAt: string | null;
  archivedAt: string | null;
}
export interface Attachment {
  id: number; itemId: number; kind: AttachmentKind; fileId: number; label: string; addedBy: string | null; addedAt: string;
  name: string; mime: string; size: number;
}
export interface EventRow {
  id: number; itemId: number; at: string; kind: EventKind; text: string; cost: number | null;
  createdBy: string | null; createdVia: string | null; createdAt: string;
}

type R = Record<string, unknown>;
const str = (v: unknown): string => (v as string) ?? '';
const nul = <T>(v: unknown): T | null => (v === undefined || v === null ? null : v as T);

const roomOf = (r: R): Room => ({
  id: r['id'] as number, name: str(r['name']), icon: str(r['icon']), position: r['position'] as number,
  archivedAt: nul(r['archived_at']), items: (r['items'] as number) ?? 0,
});
const itemOf = (r: R): Item => ({
  id: r['id'] as number, roomId: nul(r['room_id']), assetId: nul(r['asset_id']), name: str(r['name']),
  category: r['category'] as Category, brand: str(r['brand']), model: str(r['model']), serial: str(r['serial']),
  purchasedOn: nul(r['purchased_on']), purchasePrice: nul(r['purchase_price']), vendor: str(r['vendor']),
  condition: r['condition'] as Condition, warrantyMonths: nul(r['warranty_months']), warrantyUntil: nul(r['warranty_until']),
  warrantyNote: str(r['warranty_note']), notes: str(r['notes']), status: r['status'] as Status, statusOn: nul(r['status_on']),
  replacedBy: nul(r['replaced_by']), createdBy: nul(r['created_by']), createdVia: nul(r['created_via']),
  createdAt: str(r['created_at']), updatedBy: nul(r['updated_by']), updatedAt: nul(r['updated_at']), archivedAt: nul(r['archived_at']),
});
const attachmentOf = (r: R): Attachment => ({
  id: r['id'] as number, itemId: r['item_id'] as number, kind: r['kind'] as AttachmentKind, fileId: r['file_id'] as number,
  label: str(r['label']), addedBy: nul(r['added_by']), addedAt: str(r['added_at']),
  name: str(r['name']), mime: str(r['mime']), size: (r['size'] as number) ?? 0,
});
const eventOf = (r: R): EventRow => ({
  id: r['id'] as number, itemId: r['item_id'] as number, at: str(r['at']), kind: r['kind'] as EventKind, text: str(r['text']),
  cost: nul(r['cost']), createdBy: nul(r['created_by']), createdVia: nul(r['created_via']), createdAt: str(r['created_at']),
});

// ---- Pièces ---------------------------------------------------------------

export function listRooms(includeArchived = false): Room[] {
  return (database.prepare(`
    SELECT r.*, (SELECT COUNT(*) FROM eqp_items i WHERE i.room_id = r.id AND i.archived_at IS NULL) AS items
    FROM eqp_rooms r ${includeArchived ? '' : 'WHERE r.archived_at IS NULL'} ORDER BY r.position, r.id
  `).all() as R[]).map(roomOf);
}
export const getRoom = (id: number): Room | null => listRooms(true).find((r) => r.id === id) ?? null;

export function createRoom(name: string, icon: string): Room {
  const pos = (database.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM eqp_rooms').get() as { p: number }).p;
  const info = database.prepare('INSERT INTO eqp_rooms (name, icon, position) VALUES (?, ?, ?)').run(name, icon, pos);
  return getRoom(Number(info.lastInsertRowid))!;
}
export function editRoom(id: number, patch: { name?: string; icon?: string }): Room | null {
  const cur = getRoom(id); if (!cur) return null;
  database.prepare('UPDATE eqp_rooms SET name = ?, icon = ? WHERE id = ?').run(patch.name ?? cur.name, patch.icon ?? cur.icon, id);
  return getRoom(id);
}
/** Nouvel ordre : les identifiants donnés passent en tête, dans cet ordre ; les autres suivent. */
export function reorderRooms(ids: number[]): Room[] {
  const all = listRooms(true).map((r) => r.id);
  const order = [...ids.filter((id) => all.includes(id)), ...all.filter((id) => !ids.includes(id))];
  const upd = database.prepare('UPDATE eqp_rooms SET position = ? WHERE id = ?');
  database.transaction(() => order.forEach((id, i) => upd.run(i, id)))();
  return listRooms();
}
/** Une pièce qui contient encore des appareils ne s'archive pas : ils perdraient leur place sans le dire. */
export function archiveRoom(id: number): Room {
  const r = getRoom(id);
  if (!r) throw new Invalid('Pièce introuvable.');
  if (r.items) throw new Invalid(`La pièce « ${r.name} » contient encore ${r.items} équipement${r.items > 1 ? 's' : ''} : déplacez-les d’abord.`);
  database.prepare("UPDATE eqp_rooms SET archived_at = datetime('now') WHERE id = ?").run(id);
  return getRoom(id)!;
}
export function unarchiveRoom(id: number): Room | null {
  database.prepare('UPDATE eqp_rooms SET archived_at = NULL WHERE id = ?').run(id);
  return getRoom(id);
}

// ---- Fiches ---------------------------------------------------------------

export function listItems(includeArchived = false): Item[] {
  return (database.prepare(`SELECT * FROM eqp_items ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY name COLLATE NOCASE, id`)
    .all() as R[]).map(itemOf);
}
export function getItem(id: number): Item | null {
  const r = database.prepare('SELECT * FROM eqp_items WHERE id = ?').get(id) as R | undefined;
  return r ? itemOf(r) : null;
}
/** Les fiches que celle-ci a remplacées (« remplace … ») : le lien inverse de `replaced_by`. */
export function replacedItems(id: number): { id: number; name: string }[] {
  return database.prepare('SELECT id, name FROM eqp_items WHERE replaced_by = ? ORDER BY id').all(id) as { id: number; name: string }[];
}

/** Les champs modifiables d'une fiche, en noms de colonnes. */
export interface ItemFields {
  room_id?: number | null; asset_id?: number | null; name?: string; category?: Category;
  brand?: string; model?: string; serial?: string; purchased_on?: string | null; purchase_price?: number | null;
  vendor?: string; condition?: Condition; warranty_months?: number | null; warranty_until?: string | null;
  warranty_note?: string; notes?: string; status?: Status; status_on?: string | null;
}
const COLUMNS: (keyof ItemFields)[] = ['room_id', 'asset_id', 'name', 'category', 'brand', 'model', 'serial', 'purchased_on',
  'purchase_price', 'vendor', 'condition', 'warranty_months', 'warranty_until', 'warranty_note', 'notes', 'status', 'status_on'];

export function createItem(f: ItemFields & { name: string }, by: string | null, via: string | null): Item {
  const cols = COLUMNS.filter((c) => f[c] !== undefined);
  const info = database.prepare(`INSERT INTO eqp_items (${[...cols, 'created_by', 'created_via'].join(', ')}) VALUES (${[...cols, 'b', 'v'].map(() => '?').join(', ')})`)
    .run(...cols.map((c) => f[c] ?? null), by, via);
  return getItem(Number(info.lastInsertRowid))!;
}
export function editItem(id: number, f: ItemFields, by: string | null): Item | null {
  const cols = COLUMNS.filter((c) => f[c] !== undefined);
  if (cols.length) {
    database.prepare(`UPDATE eqp_items SET ${cols.map((c) => c + ' = ?').join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(...cols.map((c) => f[c] ?? null), by, id);
  }
  return getItem(id);
}
export function setArchived(id: number, archived: boolean, by: string | null): Item | null {
  database.prepare(`UPDATE eqp_items SET archived_at = ${archived ? "datetime('now')" : 'NULL'}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).run(by, id);
  return getItem(id);
}
/** L'ancien appareil passe « remplacé », daté, et pointe vers le nouveau. Il reste consultable. */
export function replaceItem(oldId: number, newId: number, day: string, by: string | null): Item | null {
  database.prepare(`UPDATE eqp_items SET status = 'remplace', status_on = ?, replaced_by = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(day, newId, by, oldId);
  return getItem(oldId);
}

// ---- Pièces jointes -------------------------------------------------------

const ATT_SELECT = `SELECT a.*, f.name, f.mime, f.size FROM eqp_attachments a JOIN hh_attachments f ON f.id = a.file_id`;
export function attachmentsOf(itemId: number): Attachment[] {
  return (database.prepare(`${ATT_SELECT} WHERE a.item_id = ? ORDER BY a.added_at, a.id`).all(itemId) as R[]).map(attachmentOf);
}
/** Combien de pièces de chaque genre par fiche, pour les cartes de la liste. */
export function attachmentCounts(): Map<number, Partial<Record<AttachmentKind, number>>> {
  const out = new Map<number, Partial<Record<AttachmentKind, number>>>();
  for (const r of database.prepare('SELECT item_id, kind, COUNT(*) AS n FROM eqp_attachments GROUP BY item_id, kind').all() as { item_id: number; kind: AttachmentKind; n: number }[]) {
    const c = out.get(r.item_id) ?? {}; c[r.kind] = r.n; out.set(r.item_id, c);
  }
  return out;
}
export function getAttachment(id: number): Attachment | null {
  const r = database.prepare(`${ATT_SELECT} WHERE a.id = ?`).get(id) as R | undefined;
  return r ? attachmentOf(r) : null;
}
/** Rattache un fichier à une fiche. Déjà rattaché : la ligne existante est rendue, rien n'est doublé. */
export function attach(itemId: number, kind: AttachmentKind, fileId: number, label: string, by: string | null): { attachment: Attachment; existed: boolean } {
  const cur = database.prepare('SELECT id FROM eqp_attachments WHERE item_id = ? AND file_id = ?').get(itemId, fileId) as { id: number } | undefined;
  if (cur) return { attachment: getAttachment(cur.id)!, existed: true };
  const info = database.prepare('INSERT INTO eqp_attachments (item_id, kind, file_id, label, added_by) VALUES (?, ?, ?, ?, ?)')
    .run(itemId, kind, fileId, label, by);
  return { attachment: getAttachment(Number(info.lastInsertRowid))!, existed: false };
}
export function editAttachment(id: number, patch: { kind?: AttachmentKind; label?: string }): Attachment | null {
  const cur = getAttachment(id); if (!cur) return null;
  database.prepare('UPDATE eqp_attachments SET kind = ?, label = ? WHERE id = ?').run(patch.kind ?? cur.kind, patch.label ?? cur.label, id);
  return getAttachment(id);
}
/** Retire le rattachement. Rend l'identifiant du fichier quand plus aucune fiche ne le cite (à effacer). */
export function detach(id: number): { fileId: number; orphan: boolean } | null {
  const cur = getAttachment(id); if (!cur) return null;
  database.prepare('DELETE FROM eqp_attachments WHERE id = ?').run(id);
  const left = (database.prepare('SELECT COUNT(*) AS n FROM eqp_attachments WHERE file_id = ?').get(cur.fileId) as { n: number }).n;
  return { fileId: cur.fileId, orphan: left === 0 };
}
/** Tous les fichiers cités par une fiche : le ménage du démarrage ne doit pas y toucher. */
export function referencedFileIds(): number[] {
  return (database.prepare('SELECT DISTINCT file_id FROM eqp_attachments').all() as { file_id: number }[]).map((r) => r.file_id);
}

// ---- Historique -----------------------------------------------------------

export function eventsOf(itemId: number): EventRow[] {
  return (database.prepare('SELECT * FROM eqp_events WHERE item_id = ? AND archived_at IS NULL ORDER BY at DESC, id DESC').all(itemId) as R[]).map(eventOf);
}
export function getEvent(id: number): (EventRow & { archivedAt: string | null }) | null {
  const r = database.prepare('SELECT * FROM eqp_events WHERE id = ?').get(id) as R | undefined;
  return r ? { ...eventOf(r), archivedAt: nul(r['archived_at']) } : null;
}
/**
 * Note un événement. Une panne fait passer l'appareil « en panne » ; une
 * réparation d'un appareil en panne le remet « en service ». Le statut suit
 * ainsi ce qu'on raconte, sans geste de plus.
 */
export function addEvent(itemId: number, at: string, kind: EventKind, text: string, cost: number | null, by: string | null, via: string | null): { event: EventRow; item: Item } {
  return database.transaction(() => {
    const info = database.prepare('INSERT INTO eqp_events (item_id, at, kind, text, cost, created_by, created_via) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(itemId, at, kind, text, cost, by, via);
    const item = getItem(itemId)!;
    if (kind === 'panne' && item.status === 'en_service') editItem(itemId, { status: 'en_panne', status_on: at }, by);
    if (kind === 'reparation' && item.status === 'en_panne') editItem(itemId, { status: 'en_service', status_on: at }, by);
    return { event: eventOf(database.prepare('SELECT * FROM eqp_events WHERE id = ?').get(Number(info.lastInsertRowid)) as R), item: getItem(itemId)! };
  })();
}
export function archiveEvent(id: number): void {
  database.prepare("UPDATE eqp_events SET archived_at = datetime('now') WHERE id = ?").run(id);
}

// ---- Liens vers Finances --------------------------------------------------

/**
 * Les biens immobiliers du module Finances, quand il y en a plusieurs : c'est
 * seulement là qu'une fiche a besoin de dire « dans quelle maison ». Un seul
 * bien, ou aucun : liste vide, le champ reste caché.
 */
export function realEstateAssets(): { id: number; name: string }[] {
  try {
    const rows = database.prepare("SELECT id, name FROM fin_assets WHERE kind = 'immobilier' AND status != 'vendu' ORDER BY position, id").all() as { id: number; name: string }[];
    return rows.length > 1 ? rows : [];
  } catch { return []; }
}
export const assetExists = (id: number): boolean => {
  try { return !!database.prepare('SELECT 1 FROM fin_assets WHERE id = ?').get(id); } catch { return false; }
};
