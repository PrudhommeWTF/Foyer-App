// Le canal Web Push : clés VAPID, abonnements des appareils, envoi, et le
// journal de ce qui est parti.
//
// Ce qu'il faut savoir avant de lire la suite : le push est **muet quand il
// casse**. Le service push d'Apple ou de Google répond « accepté » et ne rend
// aucun compte de ce que le téléphone en fait ; un abonnement peut mourir sans
// que personne ne le sache (icône supprimée de l'écran d'accueil, autorisation
// retirée). Tout ce que ce module peut faire, il le fait : retirer les
// abonnements que le service déclare morts (404, 410), garder la date du
// dernier envoi accepté et la dernière erreur par appareil, et journaliser
// chaque envoi. C'est ce que l'écran Paramètres montre.
import type { Database } from 'better-sqlite3';
import webpush from 'web-push';

export interface PushDevice {
  id: number; memberId: string; endpoint: string; p256dh: string; auth: string;
  ua: string; createdAt: string; lastOkAt: string | null; lastError: string | null;
}

export interface PushPayload {
  kind: 'reminder' | 'assigned' | 'test';
  title: string;
  body: string;
  /** Adresse ouverte au tap. Vide : la racine de l'application. */
  url?: string;
  taskId?: string;
  /** Regroupe les notifications d'une même tâche : la dernière remplace la précédente. */
  tag?: string;
}

/** Ce qu'un envoi à un appareil a donné. `statusCode` vient du service push. */
export type Sender = (device: PushDevice, payload: PushPayload) => Promise<void>;

export type SendStatus = 'sent' | 'no-device' | 'failed' | 'missed' | 'skipped';
export interface MemberReport { memberId: string; status: SendStatus; devices: number; error: string | null; }
export interface SendReport { key: string; members: MemberReport[]; }

let database: Database;
let sender: Sender = async (d, p) => {
  await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, JSON.stringify(p), { TTL: 6 * 3600 });
};
let keys = { publicKey: '', privateKey: '' };

/** Remplace l'envoi réel, pour les tests. */
export function setSender(s: Sender): void { sender = s; }

/**
 * Prépare le canal : les clés VAPID sont générées une fois et gardées en base
 * (`hh_meta`), parce qu'en changer invalide tous les abonnements. Une paire
 * fournie par l'environnement l'emporte, pour qui veut la tenir ailleurs.
 */
export function initPush(db: Database, env: { publicKey?: string; privateKey?: string; subject?: string } = {}): { publicKey: string; generated: boolean } {
  database = db;
  const read = (k: string): string => (db.prepare('SELECT value FROM hh_meta WHERE key = ?').get(k) as { value: string } | undefined)?.value || '';
  let generated = false;
  if (env.publicKey && env.privateKey) {
    keys = { publicKey: env.publicKey, privateKey: env.privateKey };
  } else {
    keys = { publicKey: read('vapid_public'), privateKey: read('vapid_private') };
    if (!keys.publicKey || !keys.privateKey) {
      keys = webpush.generateVAPIDKeys();
      const put = db.prepare("INSERT INTO hh_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
      put.run('vapid_public', keys.publicKey);
      put.run('vapid_private', keys.privateKey);
      generated = true;
    }
  }
  // Le sujet est le contact que le service push peut joindre en cas d'abus. Une
  // adresse réelle vaut mieux, mais une adresse locale ne bloque pas l'envoi.
  webpush.setVapidDetails(env.subject || 'mailto:foyer@localhost', keys.publicKey, keys.privateKey);
  return { publicKey: keys.publicKey, generated };
}

export function publicKey(): string { return keys.publicKey; }

const rowToDevice = (r: Record<string, unknown>): PushDevice => ({
  id: r['id'] as number, memberId: r['member_id'] as string, endpoint: r['endpoint'] as string,
  p256dh: r['p256dh'] as string, auth: r['auth'] as string, ua: (r['ua'] as string) || '',
  createdAt: r['created_at'] as string, lastOkAt: (r['last_ok_at'] as string) || null, lastError: (r['last_error'] as string) || null,
});

export function listDevices(memberId?: string): PushDevice[] {
  const rows = memberId
    ? database.prepare('SELECT * FROM hh_push_subs WHERE member_id = ? ORDER BY id').all(memberId)
    : database.prepare('SELECT * FROM hh_push_subs ORDER BY id').all();
  return (rows as Record<string, unknown>[]).map(rowToDevice);
}

/** Enregistre un appareil. Un même abonnement ré-envoyé (rechargement de la page) ne fait pas de doublon. */
export function addDevice(memberId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, ua: string): PushDevice {
  database.prepare(`INSERT INTO hh_push_subs (member_id, endpoint, p256dh, auth, ua) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, ua = excluded.ua`)
    .run(memberId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, ua.slice(0, 200));
  return rowToDevice(database.prepare('SELECT * FROM hh_push_subs WHERE endpoint = ?').get(sub.endpoint) as Record<string, unknown>);
}

/** Retire un appareil. Un membre ne retire que les siens. */
export function removeDevice(memberId: string, id: number): boolean {
  return database.prepare('DELETE FROM hh_push_subs WHERE id = ? AND member_id = ?').run(id, memberId).changes > 0;
}
/** Retire l'abonnement de ce navigateur, qu'il désigne par son adresse. */
export function removeDeviceByEndpoint(memberId: string, endpoint: string): boolean {
  return database.prepare('DELETE FROM hh_push_subs WHERE endpoint = ? AND member_id = ?').run(endpoint, memberId).changes > 0;
}

/** La forme minimale d'un abonnement tel que le navigateur le rend. */
export function isSubscription(v: unknown): v is { endpoint: string; keys: { p256dh: string; auth: string } } {
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  return !!s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && !!s.keys
    && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';
}

export interface SentRow { key: string; memberId: string; kind: string; taskId: string | null; title: string; status: SendStatus; error: string | null; sentAt: string; }

/** Les derniers envois, tous membres confondus : c'est l'écran d'état. */
export function recentSends(limit = 30): SentRow[] {
  return (database.prepare('SELECT * FROM hh_notif_sent ORDER BY sent_at DESC, rowid DESC LIMIT ?').all(limit) as Record<string, unknown>[]).map((r) => ({
    key: r['key'] as string, memberId: r['member_id'] as string, kind: r['kind'] as string, taskId: (r['task_id'] as string) || null,
    title: r['title'] as string, status: r['status'] as SendStatus, error: (r['error'] as string) || null, sentAt: r['sent_at'] as string,
  }));
}

function alreadySent(key: string, memberId: string): boolean {
  return !!database.prepare('SELECT 1 FROM hh_notif_sent WHERE key = ? AND member_id = ?').get(key, memberId);
}

function record(key: string, memberId: string, payload: PushPayload, status: SendStatus, error: string | null): void {
  database.prepare(`INSERT INTO hh_notif_sent (key, member_id, kind, task_id, title, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key, member_id) DO UPDATE SET status = excluded.status, error = excluded.error, sent_at = datetime('now')`)
    .run(key, memberId, payload.kind, payload.taskId ?? null, payload.title, status, error);
  // Une mémoire courte : le journal de démarrage et l'écran d'état lisent les derniers, pas l'histoire.
  database.prepare('DELETE FROM hh_notif_sent WHERE rowid NOT IN (SELECT rowid FROM hh_notif_sent ORDER BY sent_at DESC, rowid DESC LIMIT 2000)').run();
}

/** Note un rappel manqué (service arrêté trop longtemps), sans l'envoyer. Une fois. */
export function recordMissed(key: string, memberIds: string[], payload: PushPayload): number {
  let n = 0;
  for (const m of memberIds) { if (alreadySent(key, m)) continue; record(key, m, payload, 'missed', 'Service arrêté au moment du rappel.'); n++; }
  return n;
}

/**
 * Envoie à chaque membre, sur tous ses appareils. Idempotent par clé et
 * membre : rejouée après un redémarrage, elle ne renvoie rien. Un appareil que
 * le service push déclare mort est retiré, et ça se voit dans le journal.
 */
export async function notify(key: string, memberIds: string[], payload: PushPayload): Promise<SendReport> {
  const members: MemberReport[] = [];
  for (const memberId of [...new Set(memberIds)]) {
    if (alreadySent(key, memberId)) { members.push({ memberId, status: 'skipped', devices: 0, error: null }); continue; }
    const devices = listDevices(memberId);
    if (!devices.length) { record(key, memberId, payload, 'no-device', null); members.push({ memberId, status: 'no-device', devices: 0, error: null }); continue; }
    let ok = 0;
    let lastError: string | null = null;
    for (const d of devices) {
      try {
        await sender(d, payload);
        ok++;
        database.prepare("UPDATE hh_push_subs SET last_ok_at = datetime('now'), last_error = NULL WHERE id = ?").run(d.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        const msg = code ? `HTTP ${code}` : (e as Error).message;
        lastError = msg;
        if (code === 404 || code === 410) {
          // Abonnement mort : l'icône a été retirée, ou l'autorisation révoquée.
          database.prepare('DELETE FROM hh_push_subs WHERE id = ?').run(d.id);
          lastError = `abonnement expiré (${msg}), appareil retiré`;
        } else {
          database.prepare('UPDATE hh_push_subs SET last_error = ? WHERE id = ?').run(msg, d.id);
        }
      }
    }
    const status: SendStatus = ok ? 'sent' : 'failed';
    record(key, memberId, payload, status, ok ? null : lastError);
    members.push({ memberId, status, devices: ok, error: ok ? null : lastError });
  }
  return { key, members };
}
