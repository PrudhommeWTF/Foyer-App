// L'entraînement du jour dans « Devoirs de … » : le jour d'école, les décisions
// de la projection sur cas fixés, puis le parcours sur les vraies routes avec un
// élève associé à ÉcoleDirecte (posé directement en base : aucun réseau).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
// Rien ici n'ouvre la base : demarrer() la pose dans un dossier temporaire, et le reste s'importe après.
import { calendarFacts, NO_CALENDAR } from '../src/schedule';
import { dayTaskId, isSchoolDay, planDayTasks } from '../src/revisions/day-tasks';

describe('le jour d’école', () => {
  const vacances = calendarFacts([{ start: '2026-10-17', end: '2026-11-01' }]);
  it('d’après l’emploi du temps quand la semaine en a un : un cours qui n’est pas annulé', () => {
    const semaine = [{ day: '2026-10-12', cancelled: false }, { day: '2026-10-14', cancelled: true }];
    assert.equal(isSchoolDay('2026-10-12', semaine, NO_CALENDAR), true);
    assert.equal(isSchoolDay('2026-10-14', semaine, NO_CALENDAR), false, 'tous les cours du mercredi annulés');
    assert.equal(isSchoolDay('2026-10-13', semaine, NO_CALENDAR), false, 'pas de cours ce jour-là');
  });
  it('sinon le calendrier : en semaine, hors fériés et vacances', () => {
    assert.equal(isSchoolDay('2026-10-13', null, NO_CALENDAR), true);
    assert.equal(isSchoolDay('2026-10-14', [], NO_CALENDAR), true, 'mercredi compris, sans emploi du temps');
    assert.equal(isSchoolDay('2026-10-18', null, NO_CALENDAR), false, 'dimanche');
    assert.equal(isSchoolDay('2026-11-11', null, calendarFacts([])), false, '11 novembre, même vacances inconnues');
    assert.equal(isSchoolDay('2026-10-20', null, vacances), false, 'vacances de la Toussaint');
    assert.equal(isSchoolDay('2026-11-02', null, vacances), true, 'la rentrée');
  });
});

describe('les décisions de la projection', () => {
  const kid = (extra: Partial<Parameters<typeof planDayTasks>[1][number]> = {}) => ({
    memberId: 'lena', listId: 'tl-ed-1', schoolDay: true, programs: [{ exerciseId: 'tables', label: 'Tables', goal: 2, done: 0 }], ...extra,
  });
  const today = '2026-10-13';
  it('ajoute la tâche du jour, faite d’emblée si l’objectif l’est déjà', () => {
    const [op] = planDayTasks(today, [kid()], [], new Set());
    assert.deepEqual(op, { op: 'add', id: 'rev-lena-tables-2026-10-13', member: 'lena', exercise: 'tables', listId: 'tl-ed-1', text: 'Tables : entraînement du jour',
      note: 'Objectif : 2 sessions dans Révisions. La tâche se coche toute seule une fois l’objectif atteint.', done: false });
    assert.equal((planDayTasks(today, [kid({ programs: [{ exerciseId: 'tables', label: 'Tables', goal: 1, done: 3 }] })], [], new Set())[0] as { done: boolean }).done, true);
  });
  it('rien sans liste, ni un jour sans école ; la tâche d’hier s’en va, faite ou non', () => {
    assert.deepEqual(planDayTasks(today, [kid({ listId: null })], [], new Set()), []);
    assert.deepEqual(planDayTasks(today, [kid({ schoolDay: false })], [], new Set()), []);
    const hier = { id: dayTaskId('lena', 'tables', '2026-10-12'), revEx: 'tables', due: '2026-10-12', done: true };
    const ops = planDayTasks(today, [kid()], [hier, { id: 'autre', due: '2026-10-12', done: false }], new Set());
    assert.deepEqual(ops.map((o) => o.op + ' ' + o.id), ['remove rev-lena-tables-2026-10-12', 'add rev-lena-tables-2026-10-13'], 'une tâche ordinaire reste');
  });
  it('déjà là : rien ; supprimée à la main aujourd’hui : pas recréée ; plus demandée : retirée', () => {
    const t = { id: dayTaskId('lena', 'tables', today), revEx: 'tables', due: today, done: false };
    assert.deepEqual(planDayTasks(today, [kid()], [t], new Set(['lena|tables'])), []);
    assert.deepEqual(planDayTasks(today, [kid()], [], new Set(['lena|tables'])), []);
    assert.deepEqual(planDayTasks(today, [], [t], new Set()), [{ op: 'remove', id: t.id }]);
  });
});

describe('le parcours, avec un élève associé', () => {
  let ctx: Contexte;
  let lena = '', liste = '';
  const parisDay = (d = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
  const today = parisDay();
  const tacheId = () => dayTaskId(lena, 'tables', today);
  const taches = async () => (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin)).json.state.tasks as { id: string; listId: string; text: string; done: boolean; revEx?: string; who: string[]; due: string }[];
  const tache = async () => (await taches()).find((t) => t.id === tacheId());
  const programme = (extra: Record<string, unknown>) => appel(ctx.base, 'PUT', `/revisions/members/${lena}/exercises/tables/program`,
    { params: { operation: 'mult', tables: [2, 5] }, questions: 5, dailyGoal: 2, dailyTask: true, ...extra }, ctx.jetons.admin);
  const s = (mode = 'entrainer') => ({
    id: crypto.randomUUID(), exerciseId: 'tables', mode, params: { operation: 'mult', tables: [2, 5] },
    startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), aborted: false,
    answers: [{ question: { op: 'mult', a: 2, b: 3 }, given: '6', ms: 1500, askedAt: new Date().toISOString() }],
  });

  before(async () => {
    ctx = await demarrer();
    const ms = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin)).json.state.members as { id: string; name: string }[];
    lena = ms.find((m) => m.name === 'Lena')!.id;
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modEcole: true } }, ctx.jetons.admin)).status, 200);
    const ed = await import('../src/ecole/repo');
    const { ensureDevoirsList, mondayOf, addDays } = await import('../src/ecole/sync');
    const now = new Date().toISOString();
    const acc = ed.createAccount('Compte de test', 'x', 'y', now);
    const st = ed.upsertSeenStudent(acc, { edStudentId: 7, idLogin: 7, firstName: 'Lena', lastName: 'Test', className: 'CE2', schoolName: 'École', modules: [] }, now);
    ed.setLink(st.id, lena, 'manuel', 'confirme');
    liste = ensureDevoirsList(ed.getStudent(st.id)!, 'Lena');
    // Un cours aujourd'hui : c'est un jour d'école, quel que soit le jour où le test tourne.
    const lundi = mondayOf(today);
    ed.syncLessons(st.id, [{ edId: 1, day: today, start: '08:30', end: '09:30', subject: 'Maths', teacher: '', room: '', kind: '', cancelled: false, modified: false }], lundi, addDays(lundi, 6), now);
  });
  after(async () => { await arreter(ctx); });

  it('le programme dit où ira la tâche ; sans objectif, ou mal dite, elle est refusée', async () => {
    const v = (await appel(ctx.base, 'GET', `/revisions/members/${lena}/exercises/tables`, undefined, ctx.jetons.admin)).json;
    assert.equal(v.devoirsList, 'Devoirs de Lena');
    const r = await programme({ dailyGoal: 0 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /objectif d’au moins une session/);
    assert.equal((await programme({ dailyTask: 'oui' })).status, 400);
  });

  it('demandée : la tâche apparaît aujourd’hui dans « Devoirs de Lena », pour Lena', async () => {
    const r = await programme({});
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.program.dailyTask, true);
    const t = await tache();
    assert.ok(t, 'tâche projetée');
    assert.deepEqual([t!.listId, t!.text, t!.done, t!.revEx, t!.who, t!.due], [liste, 'Tables : entraînement du jour', false, 'tables', [lena], today]);
  });

  it('se coche quand l’objectif du jour est atteint, pas avant, et le mode Apprendre ne compte pas', async () => {
    assert.equal((await poster(s('apprendre'))).status, 201);
    assert.equal((await poster(s())).status, 201);
    assert.equal((await tache())!.done, false, '1 session sur 2');
    assert.equal((await poster(s())).status, 201);
    assert.equal((await tache())!.done, true, '2 sur 2');
  });

  const remettre = async () => {
    const { applyTaskOps } = await import('../src/tasks/repo');
    applyTaskOps([{ op: 'add', opId: 'remet-' + crypto.randomUUID(), id: tacheId(), listId: liste, text: 'Tables : entraînement du jour', who: [lena], due: today, revEx: 'tables' }], { trusted: true });
  };
  const sync = async (d?: Date) => (await import('../src/revisions/devoirs')).syncDayTasks(d);

  it('un nouveau programme qui ne dit rien garde la tâche', async () => {
    assert.equal((await programme({ dailyTask: undefined, questions: 10 })).json.program.dailyTask, true);
    assert.ok(await tache());
  });

  it('supprimée à la main, elle ne revient pas le même jour', async () => {
    assert.equal((await appel(ctx.base, 'POST', '/tasks/ops', { ops: [{ op: 'remove', opId: 'rm-rev', id: tacheId() }] }, ctx.jetons.admin)).status, 200);
    await sync();
    assert.equal((await programme({})).status, 200);
    assert.equal(await tache(), undefined);
  });

  it('décochée dans le programme, elle s’en va', async () => {
    await remettre();
    await sync();
    assert.ok(await tache(), 'toujours demandée : elle reste');
    assert.equal((await programme({ dailyTask: false })).status, 200);
    assert.equal(await tache(), undefined);
  });

  it('le lendemain, celle d’aujourd’hui s’en va', async () => {
    await programme({});
    await remettre();
    await sync(new Date(Date.now() + 24 * 3600_000));
    assert.equal(await tache(), undefined);
  });

  it('un téléphone ne fabrique pas de tâche d’entraînement', async () => {
    const autre = ((await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin)).json.state.taskLists as { id: string; kind: string }[]).find((l) => l.kind === 'taches')!;
    const r = await appel(ctx.base, 'POST', '/tasks/ops', { ops: [{ op: 'add', opId: 'faux', id: 'x1', listId: autre.id, text: 'Faux', revEx: 'tables' }] }, ctx.jetons.admin);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const x = (await taches()).find((t) => t.id === 'x1');
    assert.ok(x);
    assert.equal(x!.revEx, undefined, 'le champ est ignoré');
  });

  it('module École éteint : plus de liste, la tâche s’en va et ne se demande plus', async () => {
    await remettre();
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modEcole: false } }, ctx.jetons.admin)).status, 200);
    await sync();
    assert.equal(await tache(), undefined);
    assert.equal((await appel(ctx.base, 'GET', `/revisions/members/${lena}/exercises/tables`, undefined, ctx.jetons.admin)).json.devoirsList, null);
    const r = await programme({});
    assert.equal(r.status, 400);
    assert.match(r.json.error, /demande le module École et Lena associé à ÉcoleDirecte/);
    assert.equal((await programme({ dailyTask: undefined })).json.program.dailyTask, true, 'le choix déjà fait reste, pour la réactivation');
  });

  const poster = (body: unknown) => appel(ctx.base, 'POST', '/revisions/sessions', body, ctx.jetons.enfant);
});
