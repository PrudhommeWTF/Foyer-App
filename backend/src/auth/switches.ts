// Le journal des sessions d'enfant ouvertes depuis la session d'un parent.
//
// Une ligne par bascule : elle est ouverte au moment où le parent ouvre la
// session de l'enfant, et refermée au retour du parent (« retour »), à la
// déconnexion depuis la session de l'enfant (« deconnexion »), ou quand un
// adulte la ferme à distance depuis la fiche de l'enfant (« fermee »). Le jeton
// basculé porte l'identifiant de sa ligne : tant qu'elle est ouverte, la session
// vaut ; refermée, elle ne vaut plus nulle part. Voir auth/session.ts.
import { db } from '../db';

export type EndReason = 'retour' | 'deconnexion' | 'fermee';

export interface SwitchRow {
  id: number;
  parent_user_id: number;
  parent_member_id: string | null;
  child_member_id: string;
  device: string;
  from_screen: string | null;
  remember: number;
  started_at: string;
  expires_at: string;
  ended_at: string | null;
  end_reason: EndReason | null;
  ended_by_member_id: string | null;
}

export function openSwitch(s: {
  parentUserId: number; parentMemberId: string | null; childMemberId: string;
  device: string; fromScreen: string | null; remember: boolean; startedAt: string; expiresAt: string;
}): number {
  return Number(db.prepare(`INSERT INTO auth_switches
    (parent_user_id, parent_member_id, child_member_id, device, from_screen, remember, started_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(s.parentUserId, s.parentMemberId, s.childMemberId, s.device, s.fromScreen, s.remember ? 1 : 0, s.startedAt, s.expiresAt)
    .lastInsertRowid);
}

export function getSwitch(id: number): SwitchRow | undefined {
  return db.prepare('SELECT * FROM auth_switches WHERE id = ?').get(id) as SwitchRow | undefined;
}

/** Referme une ligne encore ouverte. Faux si elle l'était déjà : rien ne se referme deux fois. */
export function closeSwitch(id: number, reason: EndReason, byMemberId: string | null, at = new Date().toISOString()): boolean {
  return db.prepare('UPDATE auth_switches SET ended_at = ?, end_reason = ?, ended_by_member_id = ? WHERE id = ? AND ended_at IS NULL')
    .run(at, reason, byMemberId, id).changes > 0;
}

/** Le jeton a été renouvelé à mi-vie : la ligne suit, sinon elle se croirait expirée trop tôt. */
export function extendSwitch(id: number, expiresAt: string): void {
  db.prepare('UPDATE auth_switches SET expires_at = ? WHERE id = ? AND ended_at IS NULL').run(expiresAt, id);
}

/** Les dernières bascules vers cet enfant, les plus récentes d'abord. */
export function listSwitches(childMemberId: string, limit = 20): SwitchRow[] {
  return db.prepare('SELECT * FROM auth_switches WHERE child_member_id = ? ORDER BY started_at DESC, id DESC LIMIT ?')
    .all(childMemberId, limit) as SwitchRow[];
}

/**
 * Le nom court de l'appareil, pour le journal (« sur iPad »).
 *
 * Seul le User-Agent est connu du serveur, et il ment sur un point qui compte
 * ici : Safari sur iPad se présente par défaut comme un Mac. L'application
 * envoie donc `tactile` (écran tactile détecté) ; un « Mac » tactile est un
 * iPad. L'indice ne sert qu'à l'affichage, il ne décide d'aucun droit.
 */
export function appareil(ua: string, tactile: boolean): string {
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'téléphone Android' : 'tablette Android';
  if (/Macintosh|Mac OS X/.test(ua)) return tactile ? 'iPad' : 'Mac';
  if (/Windows/.test(ua)) return 'PC Windows';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'ordinateur Linux';
  return 'appareil inconnu';
}
