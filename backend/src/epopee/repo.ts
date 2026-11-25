// Accès aux données du module « Épopée ». Chaque fonction prend le membre
// concerné : ce sont les routes qui décident qui a le droit de le nommer.
import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { ExploitTpl, RoutineTpl } from './gabarit';
import { AMORCE, Display, Entry, Kind, QuestStatus, RewardCategory, RewardInput, RoutineKind, StepInput, StepStatus, canExchange, cancelRefusal, exchangeEntryId, pactTopUp, stepEntryId } from './rules';

let database: Database;
export function initEpopeeRepo(db: Database): void { database = db; }

export interface ProfileRow { member_id: string; floor: number; enrolled_at: string; enrolled_by: string | null; retired_at: string | null; display: Display; timer: number; sworn_at: string | null; sworn_by: string | null; }
export interface LedgerRow extends Entry { member_id: string; kind: Kind; note: string | null; by_member: string | null; at: string; }

const now = (): string => new Date().toISOString();

export function profileOf(memberId: string): ProfileRow | null {
  return (database.prepare('SELECT * FROM epo_profiles WHERE member_id = ?').get(memberId) as ProfileRow | undefined) ?? null;
}
/** Le profil d'un enfant en cours d'Épopée, ou null (jamais enrôlé, ou retiré). */
export function activeProfile(memberId: string): ProfileRow | null {
  const p = profileOf(memberId);
  return p && !p.retired_at ? p : null;
}
export function entriesOf(memberId: string): LedgerRow[] {
  return database.prepare('SELECT * FROM epo_ledger WHERE member_id = ? ORDER BY at DESC, rowid DESC').all(memberId) as LedgerRow[];
}
export function balanceOf(memberId: string): number {
  return (database.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM epo_ledger WHERE member_id = ?').get(memberId) as { n: number }).n;
}
export function getEntry(id: string): LedgerRow | null {
  return (database.prepare('SELECT * FROM epo_ledger WHERE id = ?').get(id) as LedgerRow | undefined) ?? null;
}
const write = (id: string, memberId: string, kind: Kind, delta: number, note: string | null, ref: string | null, by: string | null): void => {
  database.prepare('INSERT INTO epo_ledger (id, member_id, kind, delta, note, ref, by_member, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, memberId, kind, delta, note, ref, by, now());
};

/**
 * Enrôle un enfant : son profil et ses écus d'amorce, d'un seul geste. Un enfant
 * retiré puis réenrôlé retrouve sa besace telle quelle, sans seconde amorce.
 * `created` dit si l'amorce vient d'être versée.
 */
export function enrol(memberId: string, by: string | null): { profile: ProfileRow; created: boolean } {
  return database.transaction(() => {
    const known = profileOf(memberId);
    if (known) {
      if (known.retired_at) database.prepare('UPDATE epo_profiles SET retired_at = NULL WHERE member_id = ?').run(memberId);
      return { profile: profileOf(memberId)!, created: false };
    }
    database.prepare('INSERT INTO epo_profiles (member_id, floor, enrolled_at, enrolled_by) VALUES (?, ?, ?, ?)').run(memberId, AMORCE, now(), by);
    write(crypto.randomUUID(), memberId, 'amorce', AMORCE, null, null, by);
    return { profile: profileOf(memberId)!, created: true };
  })();
}
export function retire(memberId: string): void {
  database.prepare('UPDATE epo_profiles SET retired_at = ? WHERE member_id = ? AND retired_at IS NULL').run(now(), memberId);
}

export function setSettings(memberId: string, s: { display: Display; timer: boolean }): void {
  database.prepare('UPDATE epo_profiles SET display = ?, timer = ? WHERE member_id = ?').run(s.display, s.timer ? 1 : 0, memberId);
}

/** Scelle le serment de l'alliance. Rend false s'il l'était déjà : la date du premier serment reste. */
export function swear(memberId: string, by: string | null): boolean {
  return !!database.prepare('UPDATE epo_profiles SET sworn_at = ?, sworn_by = ? WHERE member_id = ? AND sworn_at IS NULL').run(now(), by, memberId).changes;
}

/** Verse un bravo. Le même identifiant reçu deux fois ne compte qu'une fois (`duplicate`). */
export function bravo(id: string, memberId: string, ecus: number, note: string | null, by: string | null): { entry: LedgerRow; duplicate: boolean } | null {
  return database.transaction(() => {
    const known = getEntry(id);
    if (known) return known.member_id === memberId && known.kind === 'bravo' ? { entry: known, duplicate: true } : null;
    write(id, memberId, 'bravo', ecus, note, null, by);
    return { entry: getEntry(id)!, duplicate: false };
  })();
}

/** Annule une écriture par sa contre-écriture, ou rend la raison du refus. */
export function cancel(entry: LedgerRow, by: string | null): { entry: LedgerRow } | { refusal: string } {
  return database.transaction(() => {
    const refusal = cancelRefusal(entry, entriesOf(entry.member_id), profileOf(entry.member_id)?.floor ?? AMORCE);
    if (refusal) return { refusal };
    const id = crypto.randomUUID();
    write(id, entry.member_id, 'annulation', -entry.delta, null, entry.id, by);
    return { entry: getEntry(id)! };
  })();
}

// ---- Routines ---------------------------------------------------------------

export interface RoutineRow { id: string; member_id: string; kind: RoutineKind; title: string; time: string; created_at: string; archived_at: string | null; }
export interface StepRow { id: string; routine_id: string; pos: number; title: string; hint: string; icon: string; seconds: number; ecus: number; archived_at: string | null; }
export interface MarkRow { step_id: string; day: string; member_id: string; status: StepStatus; by_member: string | null; at: string; }
export interface RoutineDayRow { routine_id: string; day: string; member_id: string; started_at: string | null; ended_at: string | null; pauses: number; }

export function routinesOf(memberId: string): RoutineRow[] {
  return database.prepare('SELECT * FROM epo_routines WHERE member_id = ? AND archived_at IS NULL ORDER BY time, created_at').all(memberId) as RoutineRow[];
}
export function getRoutine(id: string): RoutineRow | null {
  return (database.prepare('SELECT * FROM epo_routines WHERE id = ? AND archived_at IS NULL').get(id) as RoutineRow | undefined) ?? null;
}
export function stepsOf(routineId: string): StepRow[] {
  return database.prepare('SELECT * FROM epo_steps WHERE routine_id = ? AND archived_at IS NULL ORDER BY pos').all(routineId) as StepRow[];
}
export function getStep(id: string): StepRow | null {
  return (database.prepare('SELECT * FROM epo_steps WHERE id = ? AND archived_at IS NULL').get(id) as StepRow | undefined) ?? null;
}
export function marksOf(memberId: string, day: string): MarkRow[] {
  return database.prepare('SELECT * FROM epo_step_marks WHERE member_id = ? AND day = ?').all(memberId, day) as MarkRow[];
}
export function routineDay(routineId: string, day: string): RoutineDayRow | null {
  return (database.prepare('SELECT * FROM epo_routine_days WHERE routine_id = ? AND day = ?').get(routineId, day) as RoutineDayRow | undefined) ?? null;
}

/** Pose les routines du gabarit à un enfant qui n'en a aucune. Rend le nombre de routines créées. */
export function installGabarit(memberId: string, gabarit: RoutineTpl[]): number {
  return database.transaction(() => {
    if (routinesOf(memberId).length) return 0;
    for (const r of gabarit) {
      const id = crypto.randomUUID();
      database.prepare('INSERT INTO epo_routines (id, member_id, kind, title, time, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, memberId, r.kind, r.title, r.time, now());
      r.steps.forEach((s, pos) => database.prepare('INSERT INTO epo_steps (id, routine_id, pos, title, hint, icon, seconds, ecus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), id, pos, s.title, s.hint, s.icon, s.seconds, s.ecus));
    }
    return gabarit.length;
  })();
}

const touchDay = (r: RoutineRow, day: string): void => {
  database.prepare('INSERT INTO epo_routine_days (routine_id, day, member_id, started_at) VALUES (?, ?, ?, ?) ON CONFLICT (routine_id, day) DO UPDATE SET started_at = COALESCE(started_at, excluded.started_at)')
    .run(r.id, day, r.member_id, now());
};

/**
 * Note une étape pour un jour : faite (son écu est écrit au grand livre, dans la
 * même transaction) ou passée. Une étape ne se note qu'une fois par jour : la
 * seconde fois ne change rien (`duplicate`). `routineDone` dit si la routine du
 * jour est allée au bout.
 */
export function markStep(step: StepRow, routine: RoutineRow, day: string, status: StepStatus, by: string | null): { duplicate: boolean; ecus: number; routineDone: boolean } {
  return database.transaction(() => {
    const done = (): boolean => !!routineDay(routine.id, day)?.ended_at;
    const known = database.prepare('SELECT status FROM epo_step_marks WHERE step_id = ? AND day = ?').get(step.id, day) as { status: StepStatus } | undefined;
    if (known) return { duplicate: true, ecus: known.status === 'fait' ? step.ecus : 0, routineDone: done() };
    database.prepare('INSERT INTO epo_step_marks (step_id, day, member_id, status, by_member, at) VALUES (?, ?, ?, ?, ?, ?)').run(step.id, day, routine.member_id, status, by, now());
    const ecus = status === 'fait' ? step.ecus : 0;
    if (ecus) write(stepEntryId(step.id, day), routine.member_id, 'etape', ecus, step.title, null, by);
    touchDay(routine, day);
    const marked = new Set(marksOf(routine.member_id, day).map((m) => m.step_id));
    if (stepsOf(routine.id).every((s) => marked.has(s.id))) database.prepare('UPDATE epo_routine_days SET ended_at = ? WHERE routine_id = ? AND day = ? AND ended_at IS NULL').run(now(), routine.id, day);
    return { duplicate: false, ecus, routineDone: done() };
  })();
}

/** Une pause « grain de sable » de plus dans la routine du jour. Rend leur nombre. */
export function addPause(routine: RoutineRow, day: string): number {
  return database.transaction(() => {
    touchDay(routine, day);
    database.prepare('UPDATE epo_routine_days SET pauses = pauses + 1 WHERE routine_id = ? AND day = ?').run(routine.id, day);
    return routineDay(routine.id, day)!.pauses;
  })();
}

/** Règle le titre et l'heure d'une routine. */
export function updateRoutine(id: string, title: string, time: string): void {
  database.prepare('UPDATE epo_routines SET title = ?, time = ? WHERE id = ?').run(title, time, id);
}
/**
 * Remplace les étapes d'une routine par la liste donnée, dans son ordre : une
 * étape citée par son identifiant est mise à jour, une étape sans identifiant
 * est créée, une étape absente est archivée (ses coches passées restent). Rend
 * false si un identifiant cité n'est pas une étape de cette routine.
 */
export function replaceSteps(routineId: string, steps: StepInput[]): boolean {
  return database.transaction(() => {
    const known = new Set(stepsOf(routineId).map((s) => s.id));
    if (steps.some((s) => s.id && !known.has(s.id))) return false;
    const kept = new Set(steps.map((s) => s.id).filter((x): x is string => !!x));
    for (const id of known) if (!kept.has(id)) database.prepare('UPDATE epo_steps SET archived_at = ? WHERE id = ?').run(now(), id);
    steps.forEach((s, pos) => {
      if (s.id) database.prepare('UPDATE epo_steps SET pos = ?, title = ?, hint = ?, icon = ?, seconds = ?, ecus = ? WHERE id = ?').run(pos, s.title, s.hint, s.icon, s.seconds, s.ecus, s.id);
      else database.prepare('INSERT INTO epo_steps (id, routine_id, pos, title, hint, icon, seconds, ecus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(crypto.randomUUID(), routineId, pos, s.title, s.hint, s.icon, s.seconds, s.ecus);
    });
    return true;
  })();
}
/** Revient aux routines du gabarit : celles de l'enfant sont archivées, leurs coches restent. */
export function resetRoutines(memberId: string, gabarit: RoutineTpl[]): void {
  database.transaction(() => {
    database.prepare('UPDATE epo_routines SET archived_at = ? WHERE member_id = ? AND archived_at IS NULL').run(now(), memberId);
    installGabarit(memberId, gabarit);
  })();
}

// ---- Exploits convenus et demandes ------------------------------------------

export interface ExploitRow { id: string; title: string; ecus: number; pos: number; created_at: string; archived_at: string | null; }
export interface RequestRow { id: string; member_id: string; exploit_id: string; status: 'attente' | 'validee' | 'refusee'; created_at: string; decided_at: string | null; decided_by: string | null; }

export function exploits(): ExploitRow[] {
  return database.prepare('SELECT * FROM epo_exploits WHERE archived_at IS NULL ORDER BY pos, created_at').all() as ExploitRow[];
}
/** Un exploit, archivé ou non : une demande ancienne garde son titre. */
export function getExploit(id: string): ExploitRow | null {
  return (database.prepare('SELECT * FROM epo_exploits WHERE id = ?').get(id) as ExploitRow | undefined) ?? null;
}
export function addExploit(e: ExploitTpl): ExploitRow {
  const id = crypto.randomUUID();
  const pos = (database.prepare('SELECT COALESCE(MAX(pos), -1) + 1 AS n FROM epo_exploits').get() as { n: number }).n;
  database.prepare('INSERT INTO epo_exploits (id, title, ecus, pos, created_at) VALUES (?, ?, ?, ?, ?)').run(id, e.title, e.ecus, pos, now());
  return getExploit(id)!;
}
export function updateExploit(id: string, e: ExploitTpl): void {
  database.prepare('UPDATE epo_exploits SET title = ?, ecus = ? WHERE id = ?').run(e.title, e.ecus, id);
}
export function archiveExploit(id: string): void {
  database.transaction(() => {
    database.prepare('UPDATE epo_exploits SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(now(), id);
    // A request for an exploit that no longer exists has nothing left to wait for.
    database.prepare("UPDATE epo_requests SET status = 'refusee', decided_at = ? WHERE exploit_id = ? AND status = 'attente'").run(now(), id);
  })();
}
/** Pose les exploits proposés du gabarit dans un foyer qui n'en a jamais eu. */
export function installExploits(list: ExploitTpl[]): void {
  database.transaction(() => {
    if ((database.prepare('SELECT COUNT(*) AS n FROM epo_exploits').get() as { n: number }).n) return;
    list.forEach((e) => addExploit(e));
  })();
}

/** Verse un exploit convenu. Le même identifiant reçu deux fois ne compte qu'une fois. */
export function creditExploit(id: string, memberId: string, e: ExploitRow, by: string | null): { entry: LedgerRow; duplicate: boolean } | null {
  return database.transaction(() => {
    const known = getEntry(id);
    if (known) return known.member_id === memberId && known.kind === 'exploit' ? { entry: known, duplicate: true } : null;
    write(id, memberId, 'exploit', e.ecus, e.title, null, by);
    return { entry: getEntry(id)!, duplicate: false };
  })();
}

export function getRequest(id: string): RequestRow | null {
  return (database.prepare('SELECT * FROM epo_requests WHERE id = ?').get(id) as RequestRow | undefined) ?? null;
}
/** Les demandes en attente d'un enfant, et celles tranchées depuis `since` (pour qu'il voie la réponse). */
export function requestsOf(memberId: string, since: string): RequestRow[] {
  return database.prepare("SELECT * FROM epo_requests WHERE member_id = ? AND (status = 'attente' OR decided_at >= ?) ORDER BY created_at DESC").all(memberId, since) as RequestRow[];
}
/** Signale un exploit. Rend la demande déjà en attente pour cet exploit s'il y en a une (`duplicate`). */
export function addRequest(id: string, memberId: string, exploitId: string): { request: RequestRow; duplicate: boolean } | null {
  return database.transaction(() => {
    const same = getRequest(id);
    if (same) return same.member_id === memberId && same.exploit_id === exploitId ? { request: same, duplicate: true } : null;
    const pending = database.prepare("SELECT * FROM epo_requests WHERE member_id = ? AND exploit_id = ? AND status = 'attente'").get(memberId, exploitId) as RequestRow | undefined;
    if (pending) return { request: pending, duplicate: true };
    database.prepare("INSERT INTO epo_requests (id, member_id, exploit_id, status, created_at) VALUES (?, ?, ?, 'attente', ?)").run(id, memberId, exploitId, now());
    return { request: getRequest(id)!, duplicate: false };
  })();
}
/**
 * Tranche une demande en attente : validée (l'écu est écrit dans la même
 * transaction, sous l'identifiant de la demande) ou « pas tout à fait » (rien
 * n'est retiré). Rend null si elle n'attendait plus.
 */
export function decideRequest(r: RequestRow, e: ExploitRow, accept: boolean, by: string | null): RequestRow | null {
  return database.transaction(() => {
    const info = database.prepare("UPDATE epo_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'attente'").run(accept ? 'validee' : 'refusee', now(), by, r.id);
    if (!info.changes) return null;
    if (accept) write(r.id, r.member_id, 'exploit', e.ecus, e.title, null, by);
    return getRequest(r.id)!;
  })();
}

// ---- Armurerie : récompenses et quêtes ----------------------------------------

export interface RewardRow { id: string; title: string; description: string; cost: number; category: RewardCategory; pos: number; created_at: string; archived_at: string | null; }
export interface QuestRow {
  id: string; member_id: string; reward_id: string; title: string; cost: number; status: QuestStatus; proposed_by: string | null; created_at: string;
  pact_date: string | null; pact_items: string; pact_rule: string; pact_note: string; sealed_by: string | null; sealed_at: string | null;
  reached_at: string | null; honored_at: string | null; honored_by: string | null; memory_child: string; memory_parent: string; closed_at: string | null;
}
export interface Pact { date: string | null; items: string; rule: string; note: string; }

export function rewards(): RewardRow[] {
  return database.prepare('SELECT * FROM epo_rewards WHERE archived_at IS NULL ORDER BY cost, pos').all() as RewardRow[];
}
export function getReward(id: string): RewardRow | null {
  return (database.prepare('SELECT * FROM epo_rewards WHERE id = ?').get(id) as RewardRow | undefined) ?? null;
}
export function addReward(r: RewardInput): RewardRow {
  const id = crypto.randomUUID();
  const pos = (database.prepare('SELECT COALESCE(MAX(pos), -1) + 1 AS n FROM epo_rewards').get() as { n: number }).n;
  database.prepare('INSERT INTO epo_rewards (id, title, description, cost, category, pos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, r.title, r.description, r.cost, r.category, pos, now());
  return getReward(id)!;
}
export function updateReward(id: string, r: RewardInput): void {
  database.prepare('UPDATE epo_rewards SET title = ?, description = ?, cost = ?, category = ? WHERE id = ?').run(r.title, r.description, r.cost, r.category, id);
}
/** Retire une récompense du catalogue. Les quêtes qui la visent déjà continuent : elles portent leur titre et leur coût. */
export function archiveReward(id: string): void {
  database.prepare('UPDATE epo_rewards SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(now(), id);
}
/** Pose les récompenses proposées du gabarit dans un foyer qui n'en a jamais eu. */
export function installRewards(list: RewardInput[]): void {
  database.transaction(() => {
    if ((database.prepare('SELECT COUNT(*) AS n FROM epo_rewards').get() as { n: number }).n) return;
    list.forEach((r) => addReward(r));
  })();
}

export function getQuest(id: string): QuestRow | null {
  return (database.prepare('SELECT * FROM epo_quests WHERE id = ?').get(id) as QuestRow | undefined) ?? null;
}
/** Les quêtes vivantes d'un enfant : celle en cours (proposée ou active), et les trésors atteints qui restent à vivre. */
export function openQuests(memberId: string): QuestRow[] {
  return database.prepare("SELECT * FROM epo_quests WHERE member_id = ? AND status IN ('proposee', 'active', 'atteinte') ORDER BY created_at").all(memberId) as QuestRow[];
}
/** Les souvenirs : les quêtes honorées, la plus récente d'abord. */
export function memories(memberId: string, limit: number): QuestRow[] {
  return database.prepare("SELECT * FROM epo_quests WHERE member_id = ? AND status = 'honoree' ORDER BY honored_at DESC LIMIT ?").all(memberId, limit) as QuestRow[];
}
/** Propose une quête. Rend null si l'enfant en a déjà une en cours ; le même identifiant reçu deux fois rend la même quête. */
export function proposeQuest(id: string, memberId: string, r: RewardRow, by: string | null): { quest: QuestRow; duplicate: boolean } | null {
  return database.transaction(() => {
    const same = getQuest(id);
    if (same) return same.member_id === memberId ? { quest: same, duplicate: true } : null;
    if (database.prepare("SELECT 1 FROM epo_quests WHERE member_id = ? AND status IN ('proposee', 'active')").get(memberId)) return null;
    database.prepare("INSERT INTO epo_quests (id, member_id, reward_id, title, cost, status, proposed_by, created_at) VALUES (?, ?, ?, ?, ?, 'proposee', ?, ?)").run(id, memberId, r.id, r.title, r.cost, by, now());
    return { quest: getQuest(id)!, duplicate: false };
  })();
}
/**
 * Scelle le pacte d'une quête proposée : elle devient active, et la besace est
 * ramenée à son plancher si un échange l'avait vidée (une quête ne commence
 * jamais sous l'amorce). Rend null si la quête n'attendait plus.
 */
export function sealQuest(q: QuestRow, pact: Pact, by: string | null): { quest: QuestRow; topUp: number } | null {
  return database.transaction(() => {
    const info = database.prepare("UPDATE epo_quests SET status = 'active', pact_date = ?, pact_items = ?, pact_rule = ?, pact_note = ?, sealed_by = ?, sealed_at = ? WHERE id = ? AND status = 'proposee'")
      .run(pact.date, pact.items, pact.rule, pact.note, by, now(), q.id);
    if (!info.changes) return null;
    const topUp = pactTopUp(balanceOf(q.member_id), profileOf(q.member_id)?.floor ?? AMORCE);
    if (topUp) write(crypto.randomUUID(), q.member_id, 'amorce', topUp, q.title, null, by);
    return { quest: getQuest(q.id)!, topUp };
  })();
}
/** Abandonne une quête en cours (proposée ou active) : rien n'est retiré de la besace. */
export function abandonQuest(q: QuestRow): boolean {
  return !!database.prepare("UPDATE epo_quests SET status = 'abandonnee', closed_at = ? WHERE id = ? AND status IN ('proposee', 'active')").run(now(), q.id).changes;
}
/**
 * Échange les écus contre le trésor d'une quête active : le coût entier est
 * dépensé, dans la même transaction que le changement d'état. Rend la raison du
 * refus quand les écus manquent ou que la quête n'est plus active.
 */
export function exchangeQuest(q: QuestRow, by: string | null): { quest: QuestRow } | { refusal: string } {
  return database.transaction(() => {
    const fresh = getQuest(q.id)!;
    if (fresh.status !== 'active') return { refusal: 'Cette quête n’est pas en cours.' };
    const missing = fresh.cost - balanceOf(fresh.member_id);
    if (!canExchange(balanceOf(fresh.member_id), fresh.cost)) return { refusal: `Il manque encore ${missing} écu${missing > 1 ? 's' : ''}.` };
    write(exchangeEntryId(fresh.id), fresh.member_id, 'echange', -fresh.cost, fresh.title, null, by);
    database.prepare("UPDATE epo_quests SET status = 'atteinte', reached_at = ? WHERE id = ?").run(now(), fresh.id);
    return { quest: getQuest(fresh.id)! };
  })();
}
/** Le moment a été vécu : la quête atteinte devient un souvenir. */
export function honorQuest(q: QuestRow, day: string, child: string, parent: string, by: string | null): QuestRow | null {
  const info = database.prepare("UPDATE epo_quests SET status = 'honoree', honored_at = ?, honored_by = ?, memory_child = ?, memory_parent = ?, closed_at = ? WHERE id = ? AND status = 'atteinte'").run(day, by, child, parent, now(), q.id);
  return info.changes ? getQuest(q.id) : null;
}

// ---- Module -----------------------------------------------------------------

export function moduleCounts(): { enfants: number; ecritures: number } {
  const n = (sql: string): number => (database.prepare(sql).get() as { n: number }).n;
  return { enfants: n('SELECT COUNT(*) AS n FROM epo_profiles'), ecritures: n('SELECT COUNT(*) AS n FROM epo_ledger') };
}
/** Remise à zéro du module : quêtes, récompenses, exploits, demandes, routines, profils et grand livre. */
export function resetModule(): void {
  database.transaction(() => { for (const t of ['epo_quests', 'epo_rewards', 'epo_requests', 'epo_exploits', 'epo_step_marks', 'epo_routine_days', 'epo_steps', 'epo_routines', 'epo_profiles', 'epo_ledger']) database.exec(`DELETE FROM ${t}`); })();
}
