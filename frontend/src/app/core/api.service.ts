import { Injectable } from '@angular/core';
import { HouseholdState } from './models';

export interface AuthUser { email: string; name: string; memberId: string | null; }
export interface LoginResult { token: string; user: AuthUser; }

const TOKEN_KEY = 'foyer.token';

/**
 * Thin API client. Base URL is anchored on the document base href so a single
 * build works standalone, behind a reverse proxy, and behind Home Assistant ingress.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = new URL('api/', document.baseURI).href;

  get token(): string | null { return localStorage.getItem(TOKEN_KEY); }
  set token(v: string | null) {
    if (v) localStorage.setItem(TOKEN_KEY, v);
    else localStorage.removeItem(TOKEN_KEY);
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

  login(email: string, password: string): Promise<LoginResult> {
    return this.req<LoginResult>('auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  register(email: string, password: string, name: string): Promise<LoginResult> {
    return this.req<LoginResult>('auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) });
  }

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
