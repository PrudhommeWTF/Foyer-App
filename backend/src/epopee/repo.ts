// Accès aux données du module « Épopée ». Chaque fonction prend le membre
// concerné : ce sont les routes qui décident qui a le droit de le nommer.
import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { AMORCE, Entry, Kind, cancelRefusal } from './rules';

let database: Database;
export function initEpopeeRepo(db: Database): void { database = db; }

export interface ProfileRow { member_id: string; floor: number; enrolled_at: string; enrolled_by: string | null; retired_at: string | null; }
export interface LedgerRow extends Entry { member_id: string; kind: Kind; note: string | null; by_member: string | null; at: string; }

const now = (): string => new Date().toISOString();

export function profileOf(memberId: string): ProfileRow | null {
  return (database.prepare('SELECT * FROM epo_profiles WHERE member_id = ?').get(memberId) as ProfileRow | undefined) ?? null;
}
/** Le profil d'un enfant en cours d'Épopée, ou null (jamais enrôlé, ou retiré). */
export function activeProfile(memberId: string): ProfileRow | null {
  const p = profileOf(memberId);
  return p && !p.retired_at ? p : null;
}
export function entriesOf(memberId: string): LedgerRow[] {
  return database.prepare('SELECT * FROM epo_ledger WHERE member_id = ? ORDER BY at DESC, rowid DESC').all(memberId) as LedgerRow[];
}
export function balanceOf(memberId: string): number {
  return (database.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM epo_ledger WHERE member_id = ?').get(memberId) as { n: number }).n;
}
export function getEntry(id: string): LedgerRow | null {
  return (database.prepare('SELECT * FROM epo_ledger WHERE id = ?').get(id) as LedgerRow | undefined) ?? null;
}
const write = (id: string, memberId: string, kind: Kind, delta: number, note: string | null, ref: string | null, by: string | null): void => {
  database.prepare('INSERT INTO epo_ledger (id, member_id, kind, delta, note, ref, by_member, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, memberId, kind, delta, note, ref, by, now());
};

/**
 * Enrôle un enfant : son profil et ses écus d'amorce, d'un seul geste. Un enfant
 * retiré puis réenrôlé retrouve sa besace telle quelle, sans seconde amorce.
 * `created` dit si l'amorce vient d'être versée.
 */
export function enrol(memberId: string, by: string | null): { profile: ProfileRow; created: boolean } {
  return database.transaction(() => {
    const known = profileOf(memberId);
    if (known) {
      if (known.retired_at) database.prepare('UPDATE epo_profiles SET retired_at = NULL WHERE member_id = ?').run(memberId);
      return { profile: profileOf(memberId)!, created: false };
    }
    database.prepare('INSERT INTO epo_profiles (member_id, floor, enrolled_at, enrolled_by) VALUES (?, ?, ?, ?)').run(memberId, AMORCE, now(), by);
    write(crypto.randomUUID(), memberId, 'amorce', AMORCE, null, null, by);
    return { profile: profileOf(memberId)!, created: true };
  })();
}
export function retire(memberId: string): void {
  database.prepare('UPDATE epo_profiles SET retired_at = ? WHERE member_id = ? AND retired_at IS NULL').run(now(), memberId);
}

/** Verse un bravo. Le même identifiant reçu deux fois ne compte qu'une fois (`duplicate`). */
export function bravo(id: string, memberId: string, ecus: number, note: string | null, by: string | null): { entry: LedgerRow; duplicate: boolean } | null {
  return database.transaction(() => {
    const known = getEntry(id);
    if (known) return known.member_id === memberId && known.kind === 'bravo' ? { entry: known, duplicate: true } : null;
    write(id, memberId, 'bravo', ecus, note, null, by);
    return { entry: getEntry(id)!, duplicate: false };
  })();
}

/** Annule une écriture par sa contre-écriture, ou rend la raison du refus. */
export function cancel(entry: LedgerRow, by: string | null): { entry: LedgerRow } | { refusal: string } {
  return database.transaction(() => {
    const refusal = cancelRefusal(entry, entriesOf(entry.member_id), profileOf(entry.member_id)?.floor ?? AMORCE);
    if (refusal) return { refusal };
    const id = crypto.randomUUID();
    write(id, entry.member_id, 'annulation', -entry.delta, null, entry.id, by);
    return { entry: getEntry(id)! };
  })();
}

// ---- Module -----------------------------------------------------------------

export function moduleCounts(): { enfants: number; ecritures: number } {
  const n = (sql: string): number => (database.prepare(sql).get() as { n: number }).n;
  return { enfants: n('SELECT COUNT(*) AS n FROM epo_profiles'), ecritures: n('SELECT COUNT(*) AS n FROM epo_ledger') };
}
/** Remise à zéro du module : profils et grand livre. */
export function resetModule(): void {
  database.transaction(() => { for (const t of ['epo_profiles', 'epo_ledger']) database.exec(`DELETE FROM ${t}`); })();
}
