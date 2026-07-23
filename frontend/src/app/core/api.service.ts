import { Injectable } from '@angular/core';
import { HouseholdState } from './models';

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

export interface SetupPayload {
  household: { name: string; weekStart: string; currency: string; theme: 'light' | 'dark'; academie?: string };
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

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(this.base + path, { ...init, headers });
    if (!res.ok) {
      let msg = `Erreur ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  setupStatus(): Promise<{ needsSetup: boolean; allowSignup: boolean }> {
    return this.req('setup/status');
  }

  setup(payload: SetupPayload): Promise<LoginResult> {
    return this.req<LoginResult>('setup', { method: 'POST', body: JSON.stringify(payload) });
  }

  login(email: string, password: string): Promise<LoginResult> {
    return this.req<LoginResult>('auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  register(email: string, password: string, name: string): Promise<LoginResult> {
    return this.req<LoginResult>('auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) });
  }

  me(): Promise<{ email: string; name: string; memberId: string | null; admin: boolean }> {
    return this.req('me');
  }

  memberAccounts(): Promise<{ accounts: { memberId: string; email: string }[] }> {
    return this.req('members/accounts');
  }

  createMemberAccount(memberId: string, email: string, password: string): Promise<{ memberId: string; email: string }> {
    return this.req(`members/${encodeURIComponent(memberId)}/account`, { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  updateMemberAccount(memberId: string, email?: string, password?: string): Promise<{ memberId: string; email: string }> {
    return this.req(`members/${encodeURIComponent(memberId)}/account`, { method: 'PUT', body: JSON.stringify({ email, password }) });
  }

  deleteMemberAccount(memberId: string): Promise<{ ok: boolean }> {
    return this.req(`members/${encodeURIComponent(memberId)}/account`, { method: 'DELETE' });
  }

  schoolHolidays(academie: string): Promise<{ holidays: { name: string; start: string; end: string; zone: string }[]; academie: string; error?: string }> {
    return this.req('calendar/school-holidays?academie=' + encodeURIComponent(academie));
  }
  icsInfo(): Promise<{ token: string }> { return this.req('calendar/ics'); }
  icsRegenerate(): Promise<{ token: string }> { return this.req('calendar/ics/regenerate', { method: 'POST' }); }

  updateCheck(): Promise<UpdateInfo> { return this.req('system/update-check'); }
  startSystemUpdate(): Promise<{ started?: boolean; error?: string }> { return this.req('system/update', { method: 'POST' }); }
  updateStatus(): Promise<{ state: string; message?: string; current: string }> { return this.req('system/update-status'); }

  getState(): Promise<{ state: HouseholdState; version: number }> {
    return this.req('state');
  }

  putState(state: HouseholdState): Promise<{ version: number }> {
    return this.req('state', { method: 'PUT', body: JSON.stringify({ state }) });
  }

  resetState(): Promise<{ state: HouseholdState; version: number }> {
    return this.req('state/reset', { method: 'POST' });
  }
}
