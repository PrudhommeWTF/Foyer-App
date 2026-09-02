import { Injectable } from '@angular/core';
import { HouseholdState, ShopItem } from './models';
import type { RulesOutcome } from './home-context';

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
export interface LoginResult { token: string; user: AuthUser; }

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

/** Instantané de la liste. `unchanged` évite de renvoyer les articles pour rien. */
export interface ShoppingSnapshot { version: number; items?: ShopItem[]; unchanged?: boolean; }

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

export interface ShoppingApplied {
  version: number;
  items: ShopItem[];
  applied: string[];
  /** Écartées définitivement, avec la raison : le client les retire de sa file. */
  skipped: { opId: string; reason: string }[];
}

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

export interface SetupPayload {
  household: { name: string; theme: 'light' | 'dark'; academie?: string };
  admin: { name: string; role: string; color: string; email: string; password: string; birthday?: string };
  members: { name: string; role: string; color: string; email?: string; password?: string; birthday?: string }[];
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

  /** Un appel réseau dont l'échec de transport devient une ApiError de statut 0. */
  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch {
      throw new ApiError('Le serveur ne répond pas. Vérifiez que le service Foyer est démarré.', 0);
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

  setupStatus(): Promise<{ needsSetup: boolean; allowSignup: boolean }> {
    return this.request('setup/status');
  }

  setup(payload: SetupPayload): Promise<LoginResult> {
    return this.request<LoginResult>('setup', { method: 'POST', body: JSON.stringify(payload) });
  }

  login(email: string, password: string): Promise<LoginResult> {
    return this.request<LoginResult>('auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  register(email: string, password: string, name: string): Promise<LoginResult> {
    return this.request<LoginResult>('auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) });
  }

  me(): Promise<{ email: string; name: string; memberId: string | null; admin: boolean }> {
    return this.request('me');
  }

  memberAccounts(): Promise<{ accounts: { memberId: string; email: string }[] }> {
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

  schoolHolidays(academie: string): Promise<{ holidays: { name: string; start: string; end: string; zone: string }[]; academie: string; error?: string }> {
    return this.request('calendar/school-holidays?academie=' + encodeURIComponent(academie));
  }
  icsInfo(): Promise<{ token: string }> { return this.request('calendar/ics'); }
  icsRegenerate(): Promise<{ token: string }> { return this.request('calendar/ics/regenerate', { method: 'POST' }); }

  /** Version que le serveur exécute. Sans appel sortant, contrairement à updateCheck. */
  /** Les règles de contexte de l'accueil, telles qu'elles s'appliquent réellement. */
  homeRules(): Promise<RulesOutcome> { return this.request('home/rules'); }

  systemVersion(): Promise<{ current: string; selfUpdate: boolean; repo: string }> { return this.request('system/version'); }
  updateCheck(): Promise<UpdateInfo> { return this.request('system/update-check'); }
  startSystemUpdate(): Promise<{ started?: boolean; error?: string }> { return this.request('system/update', { method: 'POST' }); }
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

  // ---- liste de courses --------------------------------------------------
  // Elle ne voyage pas dans `putState` : le serveur ignore ce que ce client
  // croit savoir de la liste et n'accepte que des opérations ciblées.
  shopping(since?: number): Promise<ShoppingSnapshot> {
    return this.request('shopping' + (since != null ? '?since=' + since : ''));
  }

  shoppingOps(ops: ShopOp[]): Promise<ShoppingApplied> {
    return this.request('shopping/ops', { method: 'POST', body: JSON.stringify({ ops }) });
  }

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
