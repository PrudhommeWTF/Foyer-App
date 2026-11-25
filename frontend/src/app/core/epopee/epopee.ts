// Épopée : what the screen and the runner compute, pure. No clock of its own
// (callers pass `now`), no storage, no network. Amounts are never decided here:
// a step's écus are the server's, this only adds up what it was told.

export type StepStatus = 'fait' | 'saute';
export interface Step { id: string; title: string; hint: string; icon: string; seconds: number; ecus: number; status: StepStatus | null; }
export interface Routine { id: string; kind: 'matin' | 'soir'; title: string; time: string; startedAt: string | null; endedAt: string | null; pauses: number; steps: Step[]; }
export interface Entry { id: string; kind: 'amorce' | 'bravo' | 'etape' | 'annulation'; delta: number; note: string | null; ref: string | null; by: string | null; at: string; cancelled: boolean; }
export interface Besace { memberId: string; enrolled: boolean; floor: number | null; balance: number | null; enrolledAt: string | null; day?: string; routines?: Routine[]; journal?: Entry[]; }
/** A step marked on this device and not yet acknowledged by the server. */
export interface Pending { stepId: string; status: StepStatus; day: string; }

/** The index of the step to do now, or -1 when the routine is over for the day. */
export const nextStep = (r: Routine): number => r.steps.findIndex((s) => !s.status);
export const earned = (r: Routine): number => r.steps.reduce((n, s) => n + (s.status === 'fait' ? s.ecus : 0), 0);
export const doneCount = (r: Routine): number => r.steps.filter((s) => s.status).length;

/**
 * The routines as the child sees them: what the server knows, plus what this
 * device marked and has not sent yet. Only marks of the day shown count, and a
 * step the server already knows keeps the server's word.
 */
export function withPending(routines: Routine[], pending: Pending[], day: string): Routine[] {
  const mine = new Map(pending.filter((p) => p.day === day).map((p) => [p.stepId, p.status]));
  if (!mine.size) return routines;
  return routines.map((r) => ({ ...r, steps: r.steps.map((s) => (s.status ? s : { ...s, status: mine.get(s.id) ?? null })) }));
}
/** The écus of the steps marked done on this device that the server's balance does not count yet. */
export function pendingEcus(routines: Routine[], pending: Pending[], day: string): number {
  const steps = new Map(routines.flatMap((r) => r.steps).map((s) => [s.id, s]));
  return pending.reduce((n, p) => { const s = steps.get(p.stepId); return n + (p.day === day && p.status === 'fait' && s && !s.status ? s.ecus : 0); }, 0);
}

/**
 * Seconds left on a step's hourglass. Computed from timestamps, so it survives
 * a tablet going to sleep; time spent in a pause does not count. Never below 0:
 * past the end there is no debt, only "take your time".
 */
export function remaining(seconds: number, startedMs: number, pausedMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil(seconds - (nowMs - startedMs - pausedMs) / 1000));
}
export const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** '07:20' → '7 h 20', '19:00' → '19 h'. */
export const hourLabel = (hhmm: string): string => { const [h, m] = hhmm.split(':'); return `${Number(h)} h${m === '00' ? '' : ' ' + m}`; };

/** The calm breathing of a pause: in for 4 s, hold for 2 s, out for 4 s, and again. */
export const BREATH = [{ label: 'Inspire', seconds: 4 }, { label: 'Garde', seconds: 2 }, { label: 'Souffle', seconds: 4 }] as const;
export function breath(elapsedMs: number): { phase: number; label: string; left: number } {
  let t = (Math.max(0, elapsedMs) / 1000) % BREATH.reduce((n, b) => n + b.seconds, 0);
  for (let i = 0; i < BREATH.length; i++) {
    if (t < BREATH[i].seconds) return { phase: i, label: BREATH[i].label, left: Math.ceil(BREATH[i].seconds - t) };
    t -= BREATH[i].seconds;
  }
  return { phase: 0, label: BREATH[0].label, left: BREATH[0].seconds };
}
