// L'entraînement du jour dans la liste « Devoirs de … » de l'enfant. Quand un
// parent le demande dans le programme d'un exercice, une tâche « Tables :
// entraînement du jour » y apparaît les jours d'école, et se coche d'elle-même
// quand l'objectif de sessions du jour est atteint.
//
// La liste est celle du module École : elle n'existe que si ce module est
// activé et l'enfant associé à ÉcoleDirecte. Sans elle, pas de tâche : on
// n'invente pas une seconde liste.
//
// Une tâche par enfant, exercice et jour (`rev-<membre>-<exercice>-<jour>`) :
// celle de la veille s'en va le lendemain, faite ou non (pas de retard à
// reprocher), une tâche supprimée à la main n'est pas recréée le même jour
// (rev_day_tasks s'en souvient). Les décisions sont pures (day-tasks.ts) ;
// ici, on lit les tables et on écrit par les opérations de tâches du serveur.
import crypto from 'node:crypto';
import { applyTaskOps } from '../tasks/repo';
import { readDoc } from '../state/doc';
import { effectiveSetting } from '../settings/repo';
import { getSchoolHolidaysCache } from '../db';
import { CalendarFacts, calendarFacts } from '../schedule';
import { DayTaskInput, ExistingTask, dayTaskId, isSchoolDay, planDayTasks } from './day-tasks';
import * as ed from '../ecole/repo';
import { exerciseById } from './exercises';
import { dailyTaskPrograms, dayTasks, recordDayTask, sessionsOnDay } from './repo';
import { addDays, mondayOf, parisDay } from './bilan';
import { log } from '../log';

/** La liste « Devoirs de … » d'un enfant, si le module École est activé et l'enfant associé. */
export function devoirsListOf(memberId: string): { id: string; name: string } | null {
  if (effectiveSetting('modEcole') !== true) return null;
  const st = ed.listStudents().find((s) => s.memberId === memberId && s.linkState === 'confirme' && s.taskListId);
  if (!st) return null;
  const lists: { id: string; name: string; kind?: string; archived?: boolean }[] = readDoc().doc['taskLists'] ?? [];
  const l = lists.find((x) => x.id === st.taskListId && x.kind === 'devoirs' && !x.archived);
  return l ? { id: l.id, name: l.name } : null;
}

/** Le calendrier du foyer : jours fériés, et vacances de l'académie si elles sont en cache. */
function householdCalendar(): CalendarFacts {
  const academie = effectiveSetting('academie');
  const cache = typeof academie === 'string' && academie ? getSchoolHolidaysCache(academie) : null;
  return calendarFacts((cache?.data as { start: string; end: string }[] | undefined) ?? []);
}

/** Les cours ÉcoleDirecte de la semaine d'un jour pour cet enfant, ou null sans élève associé. */
function weekLessons(memberId: string, day: string): ed.Lesson[] | null {
  const st = ed.listStudents().find((s) => s.memberId === memberId && s.linkState === 'confirme');
  if (!st) return null;
  const from = mondayOf(day);
  return ed.listLessons([st.id], from, addDays(from, 6));
}

const opId = (kind: string): string => `rev-${kind}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const BASE = { by: null, via: 'Révisions' };

/**
 * Met les tâches du jour d'aplomb : au démarrage, chaque minute (le jour change
 * à minuit), et dès qu'un programme change. Rien à écrire : rien n'est écrit.
 * Module Révisions éteint, les tâches d'entraînement s'en vont (elles mènent à
 * un écran masqué) ; les sessions et les programmes, eux, restent.
 */
export function syncDayTasks(now = new Date()): number {
  const today = parisDay(now.toISOString());
  const on = effectiveSetting('modRevisions') === true;
  const byKid = new Map<string, DayTaskInput>();
  if (on) {
    const cal = householdCalendar();
    for (const p of dailyTaskPrograms()) {
      const d = exerciseById(p.exercise_id);
      if (!d) continue;
      let k = byKid.get(p.member_id);
      if (!k) {
        const list = devoirsListOf(p.member_id);
        k = { memberId: p.member_id, listId: list?.id ?? null, schoolDay: !!list && isSchoolDay(today, weekLessons(p.member_id, today), cal), programs: [] };
        byKid.set(p.member_id, k);
      }
      if (k.listId && k.schoolDay) k.programs.push({ exerciseId: d.id, label: d.label, goal: p.daily_goal, done: sessionsOnDay(p.member_id, d.id, today) });
    }
  }
  const tasks: ExistingTask[] = readDoc().doc['tasks'] ?? [];
  const plan = planDayTasks(today, [...byKid.values()], tasks, dayTasks(today));
  if (!plan.length) return 0;
  const at = now.toISOString();
  const ops = plan.map((o) => o.op === 'remove'
    ? { op: 'remove', opId: opId('remove'), id: o.id, ...BASE, at }
    : { op: 'add', opId: opId('add'), id: o.id, listId: o.listId, text: o.text, note: o.note, who: [o.member], due: today, done: o.done, revEx: o.exercise, position: 'fin', ...BASE, at });
  const out = applyTaskOps(ops, { trusted: true });
  plan.forEach((o, i) => { if (o.op === 'add' && out.applied.includes(ops[i].opId)) recordDayTask(o.member, o.exercise, today, o.id, at); });
  if (out.skipped.length) log.attention(`Révisions : ${out.skipped.length} tâche(s) du jour écartée(s) : ${out.skipped[0].reason}`);
  const added = plan.filter((o) => o.op === 'add').length;
  log.info(`Révisions : tâches du jour : ${added} ajoutée(s), ${plan.length - added} retirée(s).`);
  return out.applied.length;
}

/**
 * Une session vient d'arriver : si elle atteint l'objectif du jour, la tâche
 * du jour se coche. Une session d'un autre jour (rejouée hors ligne) ne touche
 * pas à la tâche d'aujourd'hui ; une tâche décochée à la main se recoche à la
 * session suivante, pas avant.
 */
export function tickDayTask(memberId: string, exerciseId: string, startedAt: string, goal: number, now = new Date()): boolean {
  const today = parisDay(now.toISOString());
  if (goal < 1 || parisDay(startedAt) !== today) return false;
  const id = dayTaskId(memberId, exerciseId, today);
  const task = (readDoc().doc['tasks'] as ExistingTask[] | undefined)?.find((t) => t.id === id);
  if (!task || task.done || sessionsOnDay(memberId, exerciseId, today) < goal) return false;
  return applyTaskOps([{ op: 'done', opId: opId('done'), id, ...BASE, at: now.toISOString() }], { trusted: true }).applied.length > 0;
}

/** Le planificateur : un passage par minute, décalé des autres. */
export function startDayTasksScheduler(): void {
  const run = (): void => { try { syncDayTasks(); } catch (e) { log.erreur('Révisions : tâches du jour en échec', e); } };
  setTimeout(run, 20_000).unref();
  setInterval(run, 60_000).unref();
}
