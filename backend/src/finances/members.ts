// Les personnes rattachées à une ligne (un compte, un contrat), dans une table
// de liaison. Comptes et contrats tenaient la même paire lire/écrire à la table
// et à la colonne près ; une seule version ici, paramétrée.
//
// `table` et `col` sont des constantes du code (jamais une saisie), d'où
// l'interpolation directe dans le SQL.
import type { Database } from 'better-sqlite3';

/** Les membres de chaque ligne, indexés par identifiant, dans l'ordre posé. */
export function readMembers(db: Database, table: string, col: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const r of db.prepare(
    `SELECT ${col} AS id, member_id AS m FROM ${table} ORDER BY ${col}, position, member_id`,
  ).all() as { id: number; m: string }[]) {
    const list = out.get(r.id);
    if (list) list.push(r.m); else out.set(r.id, [r.m]);
  }
  return out;
}

/** Remplace les membres d'une ligne, l'ordre de la liste faisant la position. */
export function writeMembers(db: Database, table: string, col: string, id: number, memberIds: string[]): void {
  db.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(id);
  const stmt = db.prepare(`INSERT INTO ${table} (${col}, member_id, position) VALUES (?, ?, ?)`);
  memberIds.forEach((m, i) => stmt.run(id, m, i));
}
