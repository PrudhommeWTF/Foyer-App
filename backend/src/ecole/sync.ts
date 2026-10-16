// La synchronisation des données d'un compte, une fois connecté : pour chaque
// élève associé, le cahier de textes, l'envoi des « fait », l'emploi du temps,
// puis la projection des devoirs en tâches.
//
// Une requête à la fois, dans l'ordre ; une erreur sur un élève est notée sur
// cet élève et n'empêche pas les autres (« données partielles »). Jamais de
// nouvelle connexion ici : un jeton refusé en cours de route attend le passage
// suivant.
import crypto from 'node:crypto';
import { EdClient, EdError, EdSession } from './client';
import * as repo from './repo';
import { cleanHtml, homeworkTitle, htmlToText } from './html';
import { CurrentTask, KEEP_DAYS, WantedTask, decideDone, planTask } from './projection';
import { applyTaskOps } from '../tasks/repo';
import { docDb, readDoc, writeDoc } from '../state/doc';
import { parisWall } from '../notify/reminders';
import { effectiveSetting } from '../settings/repo';
import { log } from '../log';
import type { MemberLite } from './match';

/** Le détail d'un jour (énoncés) est relu au plus tard après ce délai, sauf pour les prochains jours. */
const DETAIL_TTL_MS = 6 * 3600_000;

export const parisToday = (now = new Date()): string => parisWall(now).slice(0, 10);
export const addDays = (day: string, n: number): string => {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Le lundi de la semaine d'un jour. */
export const mondayOf = (day: string): string => {
  const dow = new Date(day + 'T12:00:00Z').getUTCDay();
  return addDays(day, dow === 0 ? -6 : 1 - dow);
};

const opId = (kind: string, id: number): string => `ed-${kind}-${id}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
export const taskIdOf = (homeworkId: number): string => `ed-devoir-${homeworkId}`;

/** La note de la tâche : l'énoncé en texte, puis qui l'a donné et quand. */
function noteOf(h: repo.Homework): string {
  const fr = (d: string | null): string => (d ? d.split('-').reverse().join('/') : '');
  const meta = [h.teacher ? 'Donné par ' + h.teacher : '', h.givenOn ? 'le ' + fr(h.givenOn) : ''].filter(Boolean).join(' ');
  return [h.contentText, meta ? meta + '.' : ''].filter(Boolean).join('\n\n').slice(0, 2000);
}

/**
 * La liste « Devoirs de <prénom> » de l'élève, créée au besoin, renommée si le
 * membre a changé, désarchivée. Écrite dans le document seulement si quelque
 * chose change.
 */
export function ensureDevoirsList(st: repo.Student, memberName: string): string {
  const name = 'Devoirs de ' + memberName;
  const id = st.taskListId || `tl-ed-${st.id}`;
  docDb().transaction(() => {
    const { doc } = readDoc();
    const lists: Record<string, unknown>[] = Array.isArray(doc['taskLists']) ? doc['taskLists'] : (doc['taskLists'] = []);
    const l = lists.find((x) => x['id'] === id);
    if (!l) {
      const position = lists.reduce((m, x) => Math.max(m, typeof x['position'] === 'number' ? x['position'] : 0), -1) + 1;
      lists.push({ id, name, color: '#4E93B8', icon: 'ecole', kind: 'devoirs', scope: 'shared', position });
      writeDoc(doc);
      log.info(`École : liste « ${name} » créée.`);
    } else if (l['name'] !== name || l['kind'] !== 'devoirs' || l['archived'] || l['scope'] !== 'shared') {
      Object.assign(l, { name, kind: 'devoirs', scope: 'shared' });
      delete l['archived'];
      writeDoc(doc);
    }
  })();
  if (st.taskListId !== id) repo.patchStudent(st.id, { taskListId: id });
  return id;
}

/** Les tâches du document, par identifiant. */
function tasksById(): Map<string, CurrentTask & { edId?: number }> {
  const { doc } = readDoc();
  return new Map((Array.isArray(doc['tasks']) ? doc['tasks'] : []).map((t: CurrentTask) => [t.id, t]));
}

/** Ce que Foyer dit de « fait » pour ce devoir : la coche de sa tâche, sinon la valeur locale, sinon l'accord. */
export function localDone(h: repo.Homework, task: { done: boolean } | undefined): boolean {
  if (task) return task.done;
  return h.doneLocal ?? h.doneSynced ?? h.doneEd;
}

export interface StudentReport {
  homework: number; created: number; modified: number; sent: number; lessons: number; tasks: number; grades: number; life: number;
  /** Ce qui est apparu depuis la première lecture, à annoncer. */
  fresh: { homework: repo.Homework[]; grades: repo.Grade[]; life: repo.LifeItem[] };
}

/** L'année scolaire en cours, au format d'ÉcoleDirecte : « 2026-2027 », qui bascule en août. */
export const schoolYear = (today: string): string => {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
};

/** Le module ÉcoleDirecte est-il ouvert pour cet élève ? Sans liste connue, on essaie. */
const allows = (st: repo.Student, code: string): boolean => !st.modules.length || st.modules.includes(code);

async function syncStudent(c: EdClient, s: EdSession, st: repo.Student, member: MemberLite): Promise<StudentReport> {
  const now = new Date().toISOString();
  const today = parisToday();
  const horizon = addDays(today, Number(effectiveSetting('ecoleDevoirsJours')) || 14);
  const keepFrom = addDays(today, -KEEP_DAYS);
  const rep: StudentReport = { homework: 0, created: 0, modified: 0, sent: 0, lessons: 0, tasks: 0, grades: 0, life: 0, fresh: { homework: [], grades: [], life: [] } };

  // 1. Cahier de textes : la liste, puis le détail des jours qui le méritent.
  const list = (await c.homeworkList(s, st.edStudentId)).filter((h) => h.due >= today && h.due <= horizon);
  const touched = new Set<string>();
  const created: number[] = [];
  for (const h of list) {
    const { row, created: isNew } = repo.upsertHomework(st.id, h, now);
    if (isNew) { rep.created++; touched.add(h.due); created.push(row.id); }
    if (!row.detailAt || Date.now() - Date.parse(row.detailAt) > DETAIL_TTL_MS || h.due <= addDays(today, 2)) touched.add(h.due);
  }
  repo.archiveMissingHomework(st.id, list.map((h) => h.edId), today, horizon, now);
  rep.homework = list.length;
  // Première lecture des devoirs de cet élève : muette, comme les notes.
  if (!st.homeworkBaselineAt) { repo.markNotified('ed_homework', created, now); repo.patchStudent(st.id, { homeworkBaselineAt: now }); }
  for (const day of [...touched].sort()) {
    for (const d of await c.homeworkDay(s, st.edStudentId, day)) {
      const row = repo.listHomework([st.id], day, day, true).find((x) => x.edId === d.edId);
      if (!row) continue;
      const html = cleanHtml(d.html);
      const hash = crypto.createHash('sha1').update(html).digest('hex');
      const modified = !!row.contentHash && row.contentHash !== hash;
      if (modified) rep.modified++;
      repo.patchHomework(row.id, {
        teacher: d.teacher, contentHtml: html, contentText: htmlToText(html), contentHash: hash, detailAt: now,
        ...(modified ? { modifiedAt: now } : {}),
      });
    }
  }

  // 2. « Fait » dans les deux sens, puis l'envoi groupé à ÉcoleDirecte.
  const rows = repo.listHomework([st.id], keepFrom, '9999-12-31', true);
  let tasks = tasksById();
  const decisions = new Map(rows.map((h) => {
    const task = h.taskId ? tasks.get(h.taskId) : undefined;
    return [h.id, decideDone({ ed: h.doneEd, synced: h.doneSynced, local: localDone(h, task) })];
  }));
  for (const h of rows) {
    const d = decisions.get(h.id)!;
    // Sans tâche, c'est la coche locale qui suit ÉcoleDirecte ; une tâche suit plus bas.
    const follow = d.follow !== null && !(h.taskId && tasks.get(h.taskId)) && h.doneLocal !== null && h.doneLocal !== d.follow;
    if (d.synced !== h.doneSynced || follow) repo.patchHomework(h.id, { doneSynced: d.synced, ...(follow ? { doneLocal: d.follow } : {}) });
  }
  const toSend = rows.filter((h) => decisions.get(h.id)!.send !== null && !h.archivedAt);
  if (toSend.length) {
    const done = toSend.filter((h) => decisions.get(h.id)!.send).map((h) => h.edId);
    const notDone = toSend.filter((h) => !decisions.get(h.id)!.send).map((h) => h.edId);
    try {
      await c.setHomeworkDone(s, st.edStudentId, done, notDone);
      for (const h of toSend) repo.patchHomework(h.id, { doneSynced: decisions.get(h.id)!.send, doneSentAt: now, doneError: null });
      rep.sent = toSend.length;
    } catch (e) {
      // La coche reste, marquée « non transmis » ; elle repartira au passage suivant.
      const msg = e instanceof EdError ? e.message : (e as Error).message;
      for (const h of toSend) repo.patchHomework(h.id, { doneError: msg });
      log.attention(`École : élève ${st.id} : envoi de ${toSend.length} « fait » refusé : ${msg}`);
      if (e instanceof EdError && e.kind === 'jeton') throw e;
    }
  }

  // 3. Projection en tâches, dans la liste « Devoirs de … ».
  const listId = ensureDevoirsList(st, member.name);
  tasks = tasksById();
  const ops: Record<string, unknown>[] = [];
  const after: { id: number; patch: repo.HomeworkPatch }[] = [];
  // Tout ce qui a encore une tâche (à retirer peut-être), et ce qui est récent.
  for (const h of repo.listHomework([st.id], '0000-01-01', '9999-12-31', true).filter((x) => x.taskId || x.due >= keepFrom)) {
    const task = h.taskId ? tasks.get(h.taskId) : undefined;
    const fresh = repo.getHomework(h.id)!;
    const want: WantedTask = {
      id: h.taskId || taskIdOf(h.id), listId, text: homeworkTitle(h.subject, fresh.contentText, h.isTest), note: noteOf(fresh),
      who: [member.id], due: h.due, done: fresh.doneSynced ?? fresh.doneEd,
    };
    const plan = planTask({ taskId: h.taskId, taskDroppedAt: h.taskDroppedAt, due: h.due, archived: !!h.archivedAt }, task, want, today, keepFrom);
    const base = { by: null, at: now, via: 'ÉcoleDirecte' };
    if (plan.kind === 'add') {
      // Une interrogation porte le rappel de la veille (18 h), comme une tâche datée ordinaire.
      ops.push({ op: 'add', opId: opId('add', h.id), id: want.id, listId, text: want.text, note: want.note, who: want.who, due: want.due, done: want.done, edId: h.id, ...(h.isTest ? { remind: 'eve' } : {}), ...base });
      after.push({ id: h.id, patch: { taskId: want.id } });
    } else if (plan.kind === 'edit') {
      ops.push({ op: 'edit', opId: opId('edit', h.id), id: task!.id, ...plan.fields, ...base });
    } else if (plan.kind === 'remove') {
      ops.push({ op: 'remove', opId: opId('remove', h.id), id: task!.id, ...base });
      // La valeur de la coche survit à la tâche, pour l'écran École.
      after.push({ id: h.id, patch: { taskId: null, doneLocal: decisions.get(h.id)?.follow ?? task!.done } });
    } else if (plan.kind === 'dropped') {
      after.push({ id: h.id, patch: { taskDroppedAt: now, doneLocal: fresh.doneSynced ?? fresh.doneEd } });
    }
    const follow = decisions.get(h.id)?.follow ?? null;
    if (task && plan.kind !== 'remove' && follow !== null && task.done !== follow) {
      ops.push({ op: follow ? 'done' : 'reopen', opId: opId(follow ? 'done' : 'reopen', h.id), id: task.id, ...base });
    }
  }
  if (ops.length) {
    const out = applyTaskOps(ops, { trusted: true });
    if (out.skipped.length) log.attention(`École : élève ${st.id} : ${out.skipped.length} opération(s) de tâche écartée(s) : ${out.skipped[0].reason}`);
    rep.tasks = out.applied.length;
  }
  for (const a of after) repo.patchHomework(a.id, a.patch);

  // 4. Emploi du temps, de lundi de cette semaine à la fin de la période réglée.
  const from = mondayOf(today);
  const to = addDays(from, 7 * (Number(effectiveSetting('ecoleEdtSemaines')) || 2) - 1);
  rep.lessons = repo.syncLessons(st.id, await c.timetable(s, st.edStudentId, from, to), from, to, now).upserted;

  // 5. Notes et moyennes de l'année, si l'établissement les publie pour cet élève.
  if (allows(st, 'NOTES')) {
    const { grades, averages } = await c.grades(s, st.edStudentId, schoolYear(today));
    rep.fresh.grades = repo.upsertGrades(st.id, grades, schoolYear(today), now, !st.gradesBaselineAt);
    repo.saveAverages(st.id, averages, now);
    if (!st.gradesBaselineAt) repo.patchStudent(st.id, { gradesBaselineAt: now });
    rep.grades = grades.length;
  }

  // 6. Vie scolaire.
  if (allows(st, 'VIE_SCOLAIRE')) {
    const life = await c.schoolLife(s, st.edStudentId);
    rep.fresh.life = repo.upsertLife(st.id, life, now, !st.lifeBaselineAt);
    if (!st.lifeBaselineAt) repo.patchStudent(st.id, { lifeBaselineAt: now });
    rep.life = life.length;
  }

  rep.fresh.homework = st.homeworkBaselineAt ? created.map((id) => repo.getHomework(id)!).filter((h) => !h.notifiedAt) : [];
  return rep;
}

/** Annonce ce qui vient d'apparaître pour un élève. Fourni par le service, qui sait à qui et comment l'envoyer. */
export type Announce = (st: repo.Student, member: MemberLite, fresh: StudentReport['fresh']) => Promise<void>;

/**
 * Les données de tous les élèves associés d'un compte, après une connexion
 * réussie. Rend le résumé à journaliser.
 */
export async function syncAccountData(a: repo.Account, c: EdClient, s: EdSession, mainIdLogin: number, members: MemberLite[], announce: Announce): Promise<{ ok: number; failed: number; summary: string }> {
  const students = repo.listStudents().filter((x) => x.accountId === a.id && x.linkState === 'confirme' && x.memberId);
  let current = mainIdLogin;
  let ok = 0, failed = 0;
  const parts: string[] = [];
  for (const st of students) {
    const member = members.find((m) => m.id === st.memberId);
    if (!member) continue;
    const t0 = Date.now();
    try {
      if (st.idLogin && st.idLogin !== current) { await c.switchAccount(s, st.idLogin); current = st.idLogin; }
      const r = await syncStudent(c, s, st, member);
      repo.patchStudent(st.id, { dataOkAt: new Date().toISOString(), dataError: null, dataErrorAt: null });
      ok++;
      const line = `${member.name} : ${r.homework} devoir(s) dont ${r.created} nouveau(x)${r.modified ? `, ${r.modified} modifié(s)` : ''}${r.sent ? `, ${r.sent} « fait » transmis` : ''}, ${r.lessons} cours, ${r.grades} note(s) dont ${r.fresh.grades.length} nouvelle(s), ${r.life} ligne(s) de vie scolaire dont ${r.fresh.life.length} nouvelle(s)`;
      // L'annonce ne doit jamais faire échouer la synchronisation : les lignes restent, l'envoi se journalise.
      await announce(st, member, r.fresh).catch((e) => log.attention(`École : annonce pour ${member.name} non envoyée : ${(e as Error).message}`));
      parts.push(line);
      log.info(`École : compte ${a.id} « ${a.label} » : données : ${line} (${Date.now() - t0} ms)`);
    } catch (e) {
      failed++;
      const msg = e instanceof EdError ? e.message : 'Erreur inattendue : ' + (e as Error).message;
      repo.patchStudent(st.id, { dataError: msg, dataErrorAt: new Date().toISOString() });
      parts.push(`${member.name} : échec (${msg})`);
      log.attention(`École : compte ${a.id} « ${a.label} » : données de ${member.name} : ${msg} (${Date.now() - t0} ms, code ${e instanceof EdError ? e.code ?? '-' : '-'})`);
      // Un jeton refusé vaut pour tout le compte : les élèves suivants attendront le passage suivant.
      if (e instanceof EdError && e.kind === 'jeton') break;
    }
  }
  return { ok, failed, summary: parts.join(' ; ') };
}

/**
 * Le verrou côté `PUT /state` : une liste « Devoirs de … » d'un élève associé
 * ne se supprime, ne se renomme ni ne change de type depuis un téléphone. Le
 * serveur remet la sienne. À l'inverse, un client ne fabrique pas de liste
 * `devoirs` : elle redevient une liste de tâches ordinaire.
 *
 * À appeler avant `preserveTasks`, qui retire les tâches d'une liste disparue.
 */
export function preserveDevoirsLists(incoming: Record<string, any>, current: Record<string, any>): number {
  const protectedIds = new Set(repo.listStudents().filter((s) => s.linkState === 'confirme' && s.taskListId).map((s) => s.taskListId!));
  const before: Record<string, any>[] = Array.isArray(current['taskLists']) ? current['taskLists'] : [];
  const next: Record<string, any>[] = Array.isArray(incoming['taskLists']) ? incoming['taskLists'] : (incoming['taskLists'] = []);
  let restored = 0;
  for (const l of next) {
    if (l?.kind === 'devoirs' && !protectedIds.has(l.id) && !before.some((b) => b.id === l.id && b.kind === 'devoirs')) l.kind = 'taches';
  }
  for (const id of protectedIds) {
    const mine = before.find((l) => l.id === id);
    if (!mine) continue;
    const i = next.findIndex((l) => l?.id === id);
    if (i < 0) { next.push(mine); restored++; continue; }
    if (next[i].name !== mine.name || next[i].kind !== mine.kind || next[i].scope !== mine.scope || !!next[i].archived !== !!mine.archived) {
      next[i] = { ...next[i], name: mine.name, kind: mine.kind, scope: mine.scope, archived: mine.archived };
      if (!mine.archived) delete next[i].archived;
      restored++;
    }
  }
  return restored;
}
