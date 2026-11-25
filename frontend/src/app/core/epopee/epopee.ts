// Épopée : what the screen and the runner compute, pure. No clock of its own
// (callers pass `now`), no storage, no network. Amounts are never decided here:
// a step's écus are the server's, this only adds up what it was told.

export type StepStatus = 'fait' | 'saute';
export interface Step { id: string; title: string; hint: string; icon: string; seconds: number; ecus: number; status: StepStatus | null; }
export interface Routine { id: string; kind: 'matin' | 'soir'; title: string; time: string; startedAt: string | null; endedAt: string | null; pauses: number; steps: Step[]; }
export interface Entry { id: string; kind: 'amorce' | 'bravo' | 'etape' | 'exploit' | 'echange' | 'annulation'; delta: number; note: string | null; ref: string | null; by: string | null; at: string; cancelled: boolean; }
/** An agreed feat of the household: what a parent credits in one tap, what a child may report. */
export interface Exploit { id: string; title: string; ecus: number; }
/** A feat reported by a child: waiting for a parent, granted, or "not quite" (nothing is taken away). */
export interface Demande { id: string; exploitId: string; title: string; ecus: number; status: 'attente' | 'validee' | 'refusee'; createdAt: string; decidedBy: string | null; }
export interface Besace {
  memberId: string; enrolled: boolean; floor: number | null; balance: number | null; enrolledAt: string | null;
  /** How the pouch shows to the child: the number and the coins, or the coins alone. */
  display: 'nombre' | 'pieces' | null; timer: boolean | null;
  /** The oath of the alliance: when it was sealed, and with which adult. */
  swornAt: string | null; swornBy: string | null;
  day?: string; routines?: Routine[]; demandes?: Demande[]; quetes?: Quest[]; souvenirs?: Quest[]; journal?: Entry[];
}
/** A pouch joined to its member (name, colour), as the screen shows it. */
export interface Kid extends Besace { name: string; ini: string; color: string; }
/** A real-life reward of the household's armoury, at a fixed, known price. */
export interface Reward { id: string; title: string; description: string; cost: number; category: 'duo' | 'privilege' | 'petit'; }
/** A child aiming at a reward: proposed, sealed by a pact, reached (to be lived), then a memory. */
export interface Quest {
  id: string; rewardId: string; title: string; cost: number; status: 'proposee' | 'active' | 'atteinte' | 'honoree' | 'abandonnee'; proposedBy: string | null; createdAt: string;
  pact: { date: string | null; items: string; rule: string; note: string; by: string | null } | null;
  reachedAt: string | null; honoredAt: string | null; memory: { child: string; parent: string; by: string | null } | null;
}
export const CATEGORY_LABEL: Record<Reward['category'], string> = { duo: 'À deux', privilege: 'Privilège', petit: 'Petit plaisir' };
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

/** The pictograms a parent may give a step, with the word that names each in the editor. */
export const STEP_ICONS: { name: string; label: string }[] = [
  { name: 'tshirt', label: 'Habits' }, { name: 'repas', label: 'Repas' }, { name: 'dent', label: 'Dents' }, { name: 'chaussure', label: 'Chaussures' },
  { name: 'ecole', label: 'Cartable' }, { name: 'goutte', label: 'Douche' }, { name: 'moon', label: 'Coucher' }, { name: 'sun', label: 'Lever' },
  { name: 'home', label: 'Maison' }, { name: 'recettes', label: 'Lecture' }, { name: 'suitcase', label: 'Affaires' }, { name: 'taches', label: 'Rangement' }, { name: 'clock', label: 'Autre' },
];
/** A step as the editor holds it: minutes rather than seconds, no id until the server names it. */
export interface StepDraft { id: string | null; title: string; hint: string; icon: string; minutes: number; ecus: number; }
export const toDraft = (s: Step): StepDraft => ({ id: s.id, title: s.title, hint: s.hint, icon: s.icon, minutes: Math.max(1, Math.round(s.seconds / 60)), ecus: s.ecus });
export const newDraft = (): StepDraft => ({ id: null, title: '', hint: '', icon: 'clock', minutes: 3, ecus: 1 });
/** The list with the step at `i` moved one place up (-1) or down (+1); unchanged at the edges. */
export function moved<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return list;
  const out = [...list]; [out[i], out[j]] = [out[j], out[i]];
  return out;
}
/** Why the drafts cannot be saved, or '' when they can. The server checks again. */
export function draftsError(title: string, time: string, steps: StepDraft[]): string {
  if (!title.trim()) return 'Donnez un nom à la routine.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return 'Indiquez une heure.';
  if (!steps.length) return 'Une routine a au moins une étape.';
  const i = steps.findIndex((s) => !s.title.trim());
  if (i >= 0) return `Donnez un nom à l’étape ${i + 1}.`;
  const j = steps.findIndex((s) => !Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > 60);
  return j >= 0 ? `Étape ${j + 1} : une durée de 1 à 60 minutes.` : '';
}
/** The écus a child can earn in a day with these routines: what a parent weighs rewards against. */
export const dailyEcus = (routines: Routine[]): number => routines.reduce((n, r) => n + r.steps.reduce((m, s) => m + s.ecus, 0), 0);

/** The écus still missing for a price; never negative. */
export const missing = (cost: number, bal: number): number => Math.max(0, cost - bal);
/**
 * How far a reward is, in days, if the routines are done: what lets a child
 * picture the wait, and a parent see a price is out of reach. 0 when the écus
 * are already there, null when nothing is earned per day (no routine).
 */
export function daysToReach(cost: number, bal: number, perDay: number): number | null {
  const m = missing(cost, bal);
  return !m ? 0 : perDay > 0 ? Math.ceil(m / perDay) : null;
}
/** The sentence that goes with it. `child` speaks to the child. */
export function reachLine(cost: number, bal: number, perDay: number, child: boolean): string {
  const m = missing(cost, bal), d = daysToReach(cost, bal, perDay);
  if (!m) return child ? 'Tu as assez d’écus !' : 'Les écus sont là.';
  const still = `Encore ${m} écu${m > 1 ? 's' : ''}`;
  return d === null ? still : `${still}, environ ${d} jour${d > 1 ? 's' : ''} de routines`;
}
/** '2026-12-05' → 'samedi 5 décembre'. */
export const longDay = (day: string): string => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(day + 'T12:00:00Z'));
/** The quest a child is on (chosen or sealed), if any. */
export const currentQuest = (quests: Quest[]): Quest | null => quests.find((q) => q.status === 'proposee' || q.status === 'active') ?? null;

// ---- The alliance: what parent and child agree on before the first écu ----

/** The three laws of the household's Épopée, read together at the start. */
export const LOIS: { icon: string; title: string; text: string }[] = [
  { icon: 'users', title: 'On décide ensemble', text: 'Les routines, les exploits et les trésors se choisissent à deux. Personne ne les change tout seul dans son coin.' },
  { icon: 'bouclier', title: 'Ce qui est gagné est gagné', text: 'Les écus d’amorce sont à toi pour toujours. Un effort récompensé ne se reprend pas parce qu’une journée a mal tourné.' },
  { icon: 'clock', title: 'Quand ça coince, on s’aide', text: 'Un grain de sable, ça arrive à tout le monde. On fait une pause, on respire, et on repart ensemble.' },
];
/** What each side promises: the oath is reciprocal. */
export const SERMENT: { child: string[]; parent: string[] } = {
  child: ['Je fais mes routines du mieux que je peux.', 'Je dis quand ça coince, plutôt que de me fâcher tout seul.', 'Je choisis mes trésors avec mes parents.'],
  parent: ['Je remarque tes efforts, et je te le dis tout de suite.', 'Je tiens les pactes que je scelle.', 'Je ne me sers jamais des écus pour te punir.'],
};
/** How long a tapped seal stays set: time to reach the other one with a mouse, or with one hand. */
export const SEAL_LATCH_MS = 4000;
/** One seal: held down right now, or tapped recently enough to still count. */
export interface SealPress { down: boolean; tappedAt: number; }
export const sealSet = (s: SealPress, now: number): boolean => s.down || (s.tappedAt > 0 && now - s.tappedAt < SEAL_LATCH_MS);
/** The oath is sealed when both seals are set at the same moment: two thumbs together, or one after the other in time. */
export const bothSealed = (a: SealPress, b: SealPress, now: number): boolean => sealSet(a, now) && sealSet(b, now);
