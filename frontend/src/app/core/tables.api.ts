import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';
import { MasteryCell, Mode, Operation, Result, Status } from './tables';

/** Le programme d'un enfant, tel que le serveur le rend. */
export interface TablesProgram {
  id: number; operation: Operation; from: number; to: number; questions: number;
  secondsAllowed: number | null; fastSeconds: number | null; dailyGoal: number; bothDirections: boolean;
  setBy: string | null; setAt: string;
}
export type ProgramFields = Omit<TablesProgram, 'id' | 'setBy' | 'setAt'>;

export interface TablesOverview {
  member: { id: string; name: string; enfant: boolean; birthday: string | null };
  tablesMax: number; operation: Operation; program: TablesProgram | null;
  timing: { allowedMs: number; fastMs: number; source: 'programme' | 'bareme' | 'sans-age'; age: number | null };
  mastery: MasteryCell[];
}
export interface TablesConfig {
  tablesMax: number;
  maitrise: { espacementJours: number[]; descenteSiFaux: number; niveauAcquis: number; bonnesMin: number };
  ages: { jusqua: number; accorde: number; rapide: number }[]; adulte: { accorde: number; rapide: number }; sansAge: { accorde: number; rapide: number };
}
export interface TablesSession {
  id: string; mode: Mode; operation: Operation; from: number; to: number; startedAt: string; endedAt: string; aborted: boolean;
  questions: number; good: number; slow: number; wrong: number; avgMs: number | null; programId: number | null; via: string | null;
}
export interface TablesStats {
  operation: Operation; since: string;
  days: { day: string; sessions: number; questions: number; good: number }[];
  tables: { table: number; questions: number; correct: number; fast: number }[];
}
/** Ce que l'appareil envoie à la fin d'une session (voir POST /api/tables/sessions). */
export interface SessionPayload {
  id: string; memberId: string; programId: number | null; mode: Mode; operation: Operation; from: number; to: number;
  startedAt: string; endedAt: string; aborted: boolean; allowedMs: number; fastMs: number; tactile: boolean;
  answers: { a: number; b: number; given: number | null; ms: number; askedAt: string }[];
}
export interface SessionReceipt {
  duplicate: boolean; session: TablesSession;
  changes: { a: number; b: number; before: Status; after: Status; level: number | null }[];
}
export interface PairHistory { a: number; b: number; answers: { a: number; b: number; given: number | null; ms: number; result: Result; asked_at: string; mode: Mode }[]; }

@Injectable({ providedIn: 'root' })
export class TablesApi {
  private api = inject(ApiService);
  config(): Promise<TablesConfig> { return this.api.request('tables/config'); }
  overview(member: string, op?: Operation): Promise<TablesOverview> {
    return this.api.request(`tables/members/${encodeURIComponent(member)}` + (op ? `?operation=${op}` : ''));
  }
  stats(member: string, op?: Operation): Promise<TablesStats> {
    return this.api.request(`tables/members/${encodeURIComponent(member)}/stats` + (op ? `?operation=${op}` : ''));
  }
  history(member: string, op: Operation, a: number, b: number): Promise<PairHistory> {
    return this.api.request(`tables/members/${encodeURIComponent(member)}/pairs/${op}/${a}/${b}`);
  }
  setProgram(member: string, p: ProgramFields): Promise<{ program: TablesProgram }> {
    return this.api.put(`tables/members/${encodeURIComponent(member)}/program`, p);
  }
  send(s: SessionPayload): Promise<SessionReceipt> { return this.api.post('tables/sessions', s); }
}
