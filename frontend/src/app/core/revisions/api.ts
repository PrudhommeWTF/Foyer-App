import { Injectable, inject } from '@angular/core';
import { ApiService } from '../api.service';
import type { ContentList, Mode, Params } from './exercises/contract';
import type { MasteryItem, Result, Status } from './revisions';

/** Le programme d'un enfant pour un exercice, tel que le serveur le rend. */
export interface RevisionsProgram {
  id: number; exerciseId: string; params: Params; questions: number;
  secondsAllowed: number | null; fastSeconds: number | null; dailyGoal: number; dailyTask: boolean; setBy: string | null; setAt: string;
}
export interface Matiere { id: string; label: string; }
/** Ce qu'il faut pour s'entraîner à un exercice : programme, paramètres en vigueur, temps accordé, maîtrise. */
export interface ExerciseOverview {
  exerciseId: string; program: RevisionsProgram | null; params: Params;
  timing: { allowedMs: number; fastMs: number; source: 'programme' | 'bareme' | 'sans-age'; age: number | null };
  /** La liste « Devoirs de … » où peut aller la tâche du jour ; null sans module École ni association à ÉcoleDirecte. */
  devoirsList: string | null;
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
/** Le suivi d'un exercice depuis une date : sessions par jour (heure de Paris), réussite par groupe d'items. */
export interface ExerciseStats {
  exerciseId: string; since: string;
  days: { day: string; sessions: number; questions: number; good: number }[];
  groups: { group: string; questions: number; correct: number; fast: number }[];
}
/** Les règles de maîtrise et le barème d'un exercice, pour l'aide. */
export interface RevisionsConfig {
  maitrise: { espacementJours: number[]; descenteSiFaux: number; niveauAcquis: number; bonnesMin: number };
  ages: { jusqua: number; accorde: number; rapide: number }[]; adulte: { accorde: number; rapide: number }; sansAge: { accorde: number; rapide: number };
}
/** Ce qu'un adulte règle pour un enfant : les paramètres de l'exercice, et ce que le socle porte pour tous. */
export interface ProgramFields { params: Params; questions: number; secondsAllowed: number | null; fastSeconds: number | null; dailyGoal: number; dailyTask?: boolean; }
/** Le bilan d'une période, tel que le serveur le calcule (backend/src/revisions/bilan.ts). */
export interface BilanTotals { sessions: number; questions: number; good: number; slow: number; wrong: number; pct: number; }
export interface Bilan {
  member: { id: string; name: string }; from: string; to: string; label: string;
  totals: BilanTotals; prev: BilanTotals | null;
  matieres: { id: string; label: string; exercises: {
    id: string; label: string; summary: string; totals: BilanTotals; prev: BilanTotals | null;
    groups: { group: string; questions: number; pct: number; fastPct: number; prevPct: number | null }[];
    fragiles: { label: string; status: Status }[];
  }[] }[];
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
  /** L'historique d'un item, pour soi ou, pour un adulte, pour un enfant suivi. */
  history(member: string, ex: string, key: string): Promise<ItemHistory> {
    return this.api.request(`${m(member)}/exercises/${encodeURIComponent(ex)}/items/${encodeURIComponent(key)}`);
  }
  sessions(member: string, since: string): Promise<{ sessions: RevisionsSession[] }> {
    return this.api.request(`${m(member)}/sessions?since=${encodeURIComponent(since)}&limit=200`);
  }
  stats(member: string, ex: string): Promise<ExerciseStats> { return this.api.request(`${m(member)}/exercises/${encodeURIComponent(ex)}/stats`); }
  config(ex: string): Promise<RevisionsConfig> { return this.api.request(`revisions/config?exercise=${encodeURIComponent(ex)}`); }
  setProgram(member: string, ex: string, p: ProgramFields): Promise<{ program: RevisionsProgram }> {
    return this.api.put(`${m(member)}/exercises/${encodeURIComponent(ex)}/program`, p);
  }
  stopProgram(member: string, ex: string): Promise<{ ok: boolean }> { return this.api.del(`${m(member)}/exercises/${encodeURIComponent(ex)}/program`); }
  bilan(member: string, from: string, to: string): Promise<Bilan> { return this.api.request(`${m(member)}/bilan?from=${from}&to=${to}`); }
  bilanPdf(member: string, from: string, to: string): Promise<Blob> { return this.api.download(`${m(member)}/bilan.pdf?from=${from}&to=${to}`); }
  sessionsCsv(member: string, from: string, to: string): Promise<Blob> { return this.api.download(`${m(member)}/sessions.csv?from=${from}&to=${to}`); }
  /** Les listes d'un exercice à contenu (livrées et du foyer). */
  content(ex: string): Promise<{ lists: ContentList[] }> { return this.api.request(`revisions/exercises/${encodeURIComponent(ex)}/content`); }
  createList(ex: string, label: string, items: string[]): Promise<{ list: ContentList }> {
    return this.api.post(`revisions/exercises/${encodeURIComponent(ex)}/content`, { label, items });
  }
  updateList(ex: string, id: string, change: { label?: string; items?: string[]; archived?: boolean }): Promise<{ list: ContentList }> {
    return this.api.request(`revisions/exercises/${encodeURIComponent(ex)}/content/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(change) });
  }
  send(s: SessionPayload): Promise<SessionReceipt> { return this.api.post('revisions/sessions', s); }
}
