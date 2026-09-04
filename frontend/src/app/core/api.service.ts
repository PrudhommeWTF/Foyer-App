import { Injectable } from '@angular/core';
import { HouseholdState, ShopItem, TaskItem } from './models';
import type { TaskOp } from './task-ops';
import type { RulesOutcome } from './home-context';
import { SettingDecl, SettingSection } from './settings/registry';

/**
 * Erreur d'appel qui porte le code HTTP. `status` vaut 0 quand le serveur n'a
 * pas répondu du tout : réseau coupé, service arrêté, conteneur en train de
 * redémarrer. C'est ce qui sépare « votre session a expiré » de « le serveur ne
 * répond pas », et donc ce qui évite de déconnecter quelqu'un parce que le
 * backend redémarre.
 */
export class ApiError extends Error {
  /** Corps JSON de la réponse, quand il y en a un. Un 409 y porte le document du serveur. */
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Vrai quand le serveur n'a pas répondu, par opposition à un refus de sa part. */
export const isOffline = (e: unknown): boolean => e instanceof ApiError && e.status === 0;

export interface AuthUser { email: string; name: string; memberId: string | null; }
/**
 * Ce que rend le premier temps de la connexion.
 *
 * Avec un second facteur posé, le mot de passe ne rend **pas** de jeton : il
 * rend un défi, qui ne vaut que pour le second temps et n'ouvre rien par
 * lui-même. Les deux formes sont donc facultatives, et l'appelant regarde
 * laquelle est là.
 */
export interface LoginResult {
  token?: string;
  user?: AuthUser;
  totpRequired?: boolean;
  challenge?: string;
}

export interface UpdateInfo {
  current: string;
  latest?: string;
  latestTag?: string;
  name?: string;
  notes?: string;
  url?: string;
  publishedAt?: string;
  updateAvailable?: boolean;
  selfUpdate: boolean;
  error?: string;
}

export interface StoredFile { id: number; name: string; mime: string; size: number; createdAt: string; }

/**
 * Instantané des sous-arbres qui s'écrivent par opérations : courses et tâches.
 * `unchanged` évite de les renvoyer pour rien.
 */
export interface LiveSnapshot { version: number; shop?: ShopItem[]; tasks?: TaskItem[]; unchanged?: boolean; }

interface OpBase { opId: string; by?: string | null; at?: string; }
export type ShopOp =
  | (OpBase & { op: 'add'; id: string; name: string; qty?: string; aisleId: string; listId: string; art?: string; gen?: boolean })
  | (OpBase & { op: 'set-state'; id: string; state: ShopItem['state'] })
  | (OpBase & { op: 'edit'; id: string; name?: string; qty?: string; aisleId?: string; listId?: string })
  | (OpBase & { op: 'remove'; id: string });

/**
 * Une opération avant qu'on ne l'estampille. Le conditionnel distribue sur
 * l'union : un `Omit` direct la réduirait à ses seules clés communes, et le
 * compilateur laisserait passer un « ajouter » sans nom.
 */
export type ShopOpDraft = ShopOp extends infer T ? (T extends ShopOp ? Omit<T, 'opId' | 'by' | 'at'> : never) : never;

/** Ce que le serveur rend d'un lot : l'état résultant, et le sort de chaque opération. */
export interface OpsApplied<T> {
  version: number;
  items: T[];
  applied: string[];
  /** Écartées définitivement, avec la raison : le client les retire de sa file. */
  skipped: { opId: string; reason: string }[];
}
export type ShoppingApplied = OpsApplied<ShopItem>;
export type TasksApplied = OpsApplied<TaskItem>;

/** Recette lue sur une page externe, prête à remplir le formulaire. */
export interface ImportedRecipe {
  name: string; source: string;
  portions: number | null; prepMin: number | null; cookMin: number | null;
  ingr: string[]; steps: string[];
}
export interface RecipeImportResult {
  recipe: ImportedRecipe;
  /** Photo déjà rangée sur le serveur, quand la page en publiait une. */
  photoId: number | null;
  /** Ce que le lecteur n'a pas su lire. Affiché tel quel à l'utilisateur. */
  warnings: string[];
}

/** Un appareil abonné aux rappels, tel que le serveur le connaît. */
export interface PushDevice { id: number; ua: string; createdAt: string; lastOkAt: string | null; lastError: string | null; }
/**
 * `partial` : une partie des appareils a répondu, pas tous. Sans lui, un envoi
 * qui n'atteint qu'un téléphone sur deux se présentait comme un envoi réussi.
 */
export type PushSendStatus = 'sent' | 'partial' | 'no-device' | 'failed' | 'missed' | 'skipped';
export interface PushSend { key: string; memberId: string; kind: string; taskId: string | null; title: string; status: PushSendStatus; error: string | null; sentAt: string; }
export interface PushStatus { publicKey: string; devices: PushDevice[]; subscribed: string[]; sends: PushSend[]; }
export interface PushTestResult { memberId: string; status: PushSendStatus; devices: number; total: number; error: string | null; }

export interface SetupPayload {
  household: { name: string; theme: 'light' | 'dark'; academie?: string };
  admin: { name: string; role: string; color: string; email: string; password: string; birthday?: string };
  members: { name: string; role: string; color: string; email?: string; password?: string; birthday?: string }[];
}

/** Une modification de réglage, telle que le serveur la retient. */
export interface SettingsLogLine {
  id: number; key: string; label: string;
  before: boolean | number | string | null;
  after: boolean | number | string;
  memberId: string | null;
  at: string;
}

/** Tout ce qu'il faut pour engendrer la page Paramètres, valeurs comprises. */
export interface SettingsPayload {
  sections: SettingSection[];
  registry: SettingDecl[];
  values: Record<string, boolean | number | string>;
  /** Les clés que le document porte réellement ; les autres viennent du défaut. */
  stored: string[];
  /** Clé de réglage vers la valeur imposée par une variable d'environnement. */
  overrides: Record<string, string>;
  /** Les réglages fixés par la machine. `value` est vide pour un secret : il ne se relit jamais. */
  deployment: { key: string; value: string; set: boolean }[];
  version: number;
  canEdit: boolean;
  log: SettingsLogLine[];
}

/** Ce qu'un import de configuration a rétabli, et ce qu'il a dû écarter. */
export interface ConfigImportReport {
  applied: string[];
  ecartes: { key: string; member?: string; reason: string }[];
  household: string;
  generatedAt: string;
}

/** Un instantané de la base, écrit dans le dossier de données. */
export interface Snapshot { name: string; bytes: number; at: string; }

/** L'état du service, tel que la section Exploitation le montre. */
export interface SystemStatus {
  version: string;
  uptime: number;
  nodeVersion: string;
  dataDir: string;
  dbBytes: number;
  dataBytes: number;
  /** Null quand la plateforme ne sait pas le dire : l'écran l'annonce plutôt que d'afficher zéro. */
  disk: { free: number; total: number } | null;
  /** Le contact déclaré aux services push : c'est lui qu'Apple refuse quand un envoi rend 403. */
  pushSubject: string;
  snapshots: Snapshot[];
  counts: { members: number; events: number; tasks: number; recipes: number; files: number };
}

export interface SettingsWriteResult {
  changed: string[];
  refused: { key: string; error: string }[];
  values: Record<string, boolean | number | string>;
  version: number;
}

const TOKEN_KEY = 'foyer.token';

/**
 * Thin API client. Base URL is anchored on the document base href so a single
 * build works served at the root or behind a reverse proxy on a sub-path.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = new URL('api/', document.baseURI).href;

  // "Remember me": when true the session token lives in localStorage (survives a
  // browser restart); when false it lives in sessionStorage (cleared on close).
  private remember = true;
  setRemember(v: boolean): void { this.remember = v; }

  get token(): string | null { return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY); }
  set token(v: string | null) {
    // Always clear both stores first so the token lives in exactly one place.
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (v) (this.remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, v);
  }

  /** Absolute URL of an API path (base href aware). */
  absolute(path: string): string { return this.base + path; }

  /**
   * Un appel réseau dont l'échec de transport devient une ApiError de statut 0.
   *
   * Le message distingue les deux causes, parce qu'elles n'appellent pas le même
   * geste : sans réseau, il n'y a rien à vérifier côté serveur, et envoyer
   * quelqu'un redémarrer un service qui tourne très bien est une fausse piste.
   * Depuis que l'application s'ouvre hors ligne (voir docs/hors-ligne.md), le
   * cas est devenu courant.
   */
  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch {
      throw new ApiError(navigator.onLine
        ? 'Le serveur ne répond pas. Vérifiez que le service Foyer est démarré.'
        : 'Pas de réseau. Ce qui est affiché date de la dernière connexion.', 0);
    }
  }

  /** Convertit une réponse en échec, en relayant le message du serveur tel quel. */
  private async fail(res: Response): Promise<never> {
    let msg = `Erreur ${res.status}`;
    let body: unknown;
    try { body = await res.json(); msg = (body as { error?: string })?.error || msg; }
    catch { /* corps illisible : le code suffit */ }
    throw new ApiError(msg, res.status, body);
  }

  /**
   * Fetch a file endpoint with the session token and hand back a blob. Used for
   * the finances CSV export: a plain <a href> would not carry the Authorization
   * header, and putting the token in the URL would leak it into browser history.
   */
  async download(path: string): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await this.send(this.base + path, { headers });
    if (!res.ok) await this.fail(res);
    return res.blob();
  }

  /**
   * POST a file as a raw body. Avoids both a multipart dependency on the server
   * and the 33% inflation of base64 in a JSON payload.
   */
  async upload<T>(path: string, file: File): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await this.send(this.base + path, { method: 'POST', headers, body: file });
    if (!res.ok) await this.fail(res);
    return res.json() as Promise<T>;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await this.send(this.base + path, { ...init, headers });
    if (!res.ok) await this.fail(res);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  setupStatus(): Promise<{ needsSetup: boolean }> {
    return this.request('setup/status');
  }

  /**
   * L'assistant rend toujours un jeton : un foyer qui vient de naître n'a pas de
   * second facteur, et il n'y a pas de second temps à attendre.
   */
  setup(payload: SetupPayload): Promise<{ token: string; user: AuthUser }> {
    return this.request('setup', { method: 'POST', body: JSON.stringify(payload) });
  }

  login(email: string, password: string): Promise<LoginResult> {
    return this.request<LoginResult>('auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  /** Second temps : le code du téléphone, ou un code de secours. */
  loginTotp(challenge: string, code: string): Promise<LoginResult> {
    return this.request<LoginResult>('auth/login/totp', { method: 'POST', body: JSON.stringify({ challenge, code }) });
  }

  // ---- second facteur, pour son propre compte ----
  totpStart(password: string): Promise<{ secret: string; secretLisible: string; uri: string }> {
    return this.request('me/totp/start', { method: 'POST', body: JSON.stringify({ password }) });
  }

  totpEnable(code: string): Promise<{ enabled: boolean; recovery: string[] }> {
    return this.request('me/totp/enable', { method: 'POST', body: JSON.stringify({ code }) });
  }

  totpDisable(password: string, code: string): Promise<{ enabled: boolean }> {
    return this.request('me/totp/disable', { method: 'POST', body: JSON.stringify({ password, code }) });
  }

  totpNewRecovery(password: string, code: string): Promise<{ recovery: string[] }> {
    return this.request('me/totp/recovery', { method: 'POST', body: JSON.stringify({ password, code }) });
  }

  /** Le téléphone d'un membre est perdu : un administrateur retire son second facteur. */
  totpReset(memberId: string, password: string): Promise<{ enabled: boolean }> {
    return this.request(`members/${encodeURIComponent(memberId)}/totp/reset`, { method: 'POST', body: JSON.stringify({ password }) });
  }

  /** `token` n'est présent que lorsque le serveur en a rendu un neuf. Voir aRenouveler côté serveur. */
  me(): Promise<{
    email: string; name: string; memberId: string | null; admin: boolean; enfant: boolean; token?: string;
    totp: boolean; totpRecoveryLeft: number | null;
  }> {
    return this.request('me');
  }

  memberAccounts(): Promise<{ accounts: { memberId: string; email: string; totp: boolean }[] }> {
    return this.request('members/accounts');
  }

  createMemberAccount(memberId: string, email: string, password: string): Promise<{ memberId: string; email: string }> {
    return this.request(`members/${encodeURIComponent(memberId)}/account`, { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  updateMemberAccount(memberId: string, email?: string, password?: string): Promise<{ memberId: string; email: string }> {
    return this.request(`members/${encodeURIComponent(memberId)}/account`, { method: 'PUT', body: JSON.stringify({ email, password }) });
  }

  deleteMemberAccount(memberId: string): Promise<{ ok: boolean }> {
    return this.request(`members/${encodeURIComponent(memberId)}/account`, { method: 'DELETE' });
  }

  // ---- réglages du foyer ----
  //
  // Ils s'écrivent clé par clé plutôt que par enregistrement du document entier :
  // deux administrateurs qui règlent deux choses à la même seconde ne s'écrasent
  // donc pas. Le serveur refuse l'écriture à un non-administrateur.

  settings(): Promise<SettingsPayload> { return this.request('settings'); }

  patchSettings(changes: Record<string, boolean | number | string>): Promise<SettingsWriteResult> {
    return this.request('settings', { method: 'PATCH', body: JSON.stringify({ changes }) });
  }

  /** Ses propres identifiants. Le mot de passe actuel est exigé, et un jeton neuf revient. */
  updateMyCredentials(currentPassword: string, email?: string, password?: string): Promise<{ email: string; token: string; othersLoggedOut: boolean }> {
    return this.request('me/credentials', { method: 'PUT', body: JSON.stringify({ currentPassword, email, password }) });
  }

  exportSettings(): Promise<Blob> { return this.download('settings/export'); }

  importSettings(config: unknown): Promise<ConfigImportReport> {
    return this.request('settings/import', { method: 'POST', body: JSON.stringify({ config }) });
  }

  schoolHolidays(academie: string): Promise<{ holidays: { name: string; start: string; end: string; zone: string }[]; academie: string; error?: string }> {
    return this.request('calendar/school-holidays?academie=' + encodeURIComponent(academie));
  }
  icsInfo(): Promise<{ token: string }> { return this.request('calendar/ics'); }
  icsRegenerate(): Promise<{ token: string }> { return this.request('calendar/ics/regenerate', { method: 'POST' }); }

  /** Version que le serveur exécute. Sans appel sortant, contrairement à updateCheck. */
  /** Les règles de contexte de l'accueil, telles qu'elles s'appliquent réellement. */
  homeRules(): Promise<RulesOutcome> { return this.request('home/rules'); }

  systemVersion(): Promise<{ current: string; selfUpdate: boolean; repo: string }> { return this.request('system/version'); }

  // ---- exploitation ----
  systemStatus(): Promise<SystemStatus> { return this.request('system/status'); }
  makeBackup(): Promise<{ snapshot: Snapshot; deleted: string[] }> { return this.request('system/backup', { method: 'POST' }); }
  deleteBackup(name: string): Promise<{ ok: boolean }> {
    return this.request('system/backup/' + encodeURIComponent(name), { method: 'DELETE' });
  }
  backupUrl(name: string): string { return this.absolute('system/backup/' + encodeURIComponent(name)); }
  downloadBackup(name: string): Promise<Blob> { return this.download('system/backup/' + encodeURIComponent(name)); }
  updateCheck(): Promise<UpdateInfo> { return this.request('system/update-check'); }
  /**
   * Lance la mise à jour. Le mot de passe est exigé par le serveur : ce bouton
   * fait exécuter du code en root sur la machine, un jeton dérobé sur un
   * téléphone déverrouillé ne doit pas suffire.
   */
  startSystemUpdate(password: string): Promise<{ started?: boolean; error?: string }> {
    return this.request('system/update', { method: 'POST', body: JSON.stringify({ password }) });
  }
  updateStatus(): Promise<{ state: string; message?: string; current: string }> { return this.request('system/update-status'); }

  getState(): Promise<{ state: HouseholdState; version: number }> {
    return this.request('state');
  }

  /**
   * Enregistre le document. `version` est celle sur laquelle ce client a
   * travaillé : le serveur refuse (409) d'écrire par-dessus plus récent, et
   * renvoie alors son document pour que l'appelant rejoue dessus.
   */
  putState(state: HouseholdState, version?: number): Promise<{ version: number }> {
    return this.request('state', { method: 'PUT', body: JSON.stringify({ state, version }) });
  }

  // ---- courses et tâches --------------------------------------------------
  // Ni la liste ni les tâches ne voyagent dans `putState` : le serveur ignore ce
  // que ce client croit en savoir et n'accepte que des opérations ciblées.
  live(since?: number): Promise<LiveSnapshot> {
    return this.request('live' + (since != null ? '?since=' + since : ''));
  }

  shoppingOps(ops: ShopOp[]): Promise<ShoppingApplied> {
    return this.request('shopping/ops', { method: 'POST', body: JSON.stringify({ ops }) });
  }

  taskOps(ops: TaskOp[]): Promise<TasksApplied> {
    return this.request('tasks/ops', { method: 'POST', body: JSON.stringify({ ops }) });
  }

  // ---- rappels par Web Push ----------------------------------------------
  pushStatus(): Promise<PushStatus> { return this.request('push/status'); }
  pushSubscribe(subscription: PushSubscriptionJSON, ua: string): Promise<PushDevice> {
    return this.request('push/subscribe', { method: 'POST', body: JSON.stringify({ subscription, ua }) });
  }
  pushUnsubscribe(endpoint: string): Promise<{ removed: boolean }> {
    return this.request('push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
  }
  pushRemoveDevice(id: number): Promise<{ ok: boolean }> { return this.request('push/subscribe/' + id, { method: 'DELETE' }); }
  pushTest(): Promise<PushTestResult> { return this.request('push/test', { method: 'POST' }); }

  // ---- import de recette --------------------------------------------------
  // Seule sortie réseau du module, faite par le serveur : le navigateur ne peut
  // pas appeler un site tiers (la politique de sécurité du contenu l'interdit,
  // et le partage d'origine du site le refuserait de toute façon).
  importRecipe(url: string, recipeId: string): Promise<RecipeImportResult> {
    return this.request('recipes/import', { method: 'POST', body: JSON.stringify({ url, recipeId }) });
  }

  // ---- fichiers ----------------------------------------------------------
  uploadFile(owner: 'recipe' | 'document', ownerId: string, file: File): Promise<{ file: StoredFile; deduplicated: boolean }> {
    const q = `files?owner=${owner}&id=${encodeURIComponent(ownerId)}&filename=${encodeURIComponent(file.name)}`;
    return this.upload(q, file);
  }

  /**
   * Rend les octets au serveur. Appelé quand une fiche est supprimée : le ménage
   * du démarrage rattraperait l'oubli, mais laisserait la copie d'une pièce
   * d'identité sur le disque jusqu'au prochain redémarrage.
   */
  deleteFile(id: number): Promise<void> {
    return this.request('files/' + id, { method: 'DELETE' });
  }

}
