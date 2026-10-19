import { Injectable, inject } from '@angular/core';
import { ApiService } from '../api.service';
import type { Mode, Params } from './exercises/contract';
import type { MasteryItem, Result, Status } from './revisions';

/** Le programme d'un enfant pour un exercice, tel que le serveur le rend. */
export interface RevisionsProgram {
  id: number; exerciseId: string; params: Params; questions: number;
  secondsAllowed: number | null; fastSeconds: number | null; dailyGoal: number; setBy: string | null; setAt: string;
}
export interface Matiere { id: string; label: string; }
/** Ce qu'il faut pour s'entraîner à un exercice : programme, paramètres en vigueur, temps accordé, maîtrise. */
export interface ExerciseOverview {
  exerciseId: string; program: RevisionsProgram | null; params: Params;
  timing: { allowedMs: number; fastMs: number; source: 'programme' | 'bareme' | 'sans-age'; age: number | null };
  mastery: MasteryItem[];
}
export interface RevisionsSession {
  id: string; exerciseId: string; mode: Mode; params: Params; startedAt: string; endedAt: string; aborted: boolean;
  questions: number; good: number; slow: number; wrong: number; avgMs: number | null; programId: number | null; via: string | null;
}
/** Ce que l'appareil envoie à la fin d'une session (voir POST /api/revisions/sessions). */
export interface SessionPayload {
  id: string; memberId: string; exerciseId: string; programId: number | null; mode: Mode; params: Params;
  startedAt: string; endedAt: string; aborted: boolean; allowedMs: number; fastMs: number; tactile: boolean;
  answers: { question: unknown; given: string | null; ms: number; askedAt: string }[];
}
export interface SessionReceipt {
  duplicate: boolean; session: RevisionsSession;
  changes: { key: string; label: string; before: Status; after: Status; level: number | null }[];
}
export interface ItemHistory {
  key: string; label: string;
  answers: { text: string; expected: string; given: string | null; ms: number; result: Result; askedAt: string; mode: Mode }[];
}

const m = (id: string): string => `revisions/members/${encodeURIComponent(id)}`;

@Injectable({ providedIn: 'root' })
export class RevisionsApi {
  private api = inject(ApiService);
  matieres(): Promise<{ matieres: Matiere[] }> { return this.api.request('revisions/exercises'); }
  exercise(member: string, ex: string): Promise<ExerciseOverview> { return this.api.request(`${m(member)}/exercises/${encodeURIComponent(ex)}`); }
  history(member: string, ex: string, key: string): Promise<ItemHistory> {
    return this.api.request(`${m(member)}/exercises/${encodeURIComponent(ex)}/items/${encodeURIComponent(key)}`);
  }
  sessions(member: string, since: string): Promise<{ sessions: RevisionsSession[] }> {
    return this.api.request(`${m(member)}/sessions?since=${encodeURIComponent(since)}&limit=200`);
  }
  send(s: SessionPayload): Promise<SessionReceipt> { return this.api.post('revisions/sessions', s); }
}
