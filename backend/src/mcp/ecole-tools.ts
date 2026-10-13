// Les outils d'assistant du module École. Comme les écrans, ils ne lisent que
// les tables ed_* (jamais ÉcoleDirecte directement) et appliquent la même règle
// de visibilité : un adulte voit tous les élèves associés, un enfant seulement
// lui-même. Demander un autre enfant avec un jeton d'enfant est refusé en
// clair, pas ignoré.
//
// Les textes rendus sont courts, en français, avec les identifiants entre
// crochets quand un geste ultérieur en a besoin (« [12] » pour cocher un devoir).
import * as repo from '../ecole/repo';
import { docTasks, setHomeworkDone } from '../ecole/actions';
import { addDays, localDone, parisToday } from '../ecole/sync';
import { subjectLabel } from '../ecole/html';
import { normName } from '../ecole/match';
import { getHousehold } from '../db';
import { HouseholdState } from '../models';
import { effectiveSetting } from '../settings/repo';
import { parisWall } from '../notify/reminders';
import type { McpCtx } from './tools';

const state = (): HouseholdState => getHousehold().state as HouseholdState;
const memberName = (id: string | null): string => state().members.find((m) => m.id === id)?.name || '';
const fr = (day: string | null): string => (day ? day.split('-').reverse().slice(0, 2).join('/') : '');
const DOW = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const dayLabel = (day: string, today: string): string => {
  if (day === today) return 'aujourd’hui';
  if (day === addDays(today, 1)) return 'demain';
  if (day === addDays(today, -1)) return 'hier';
  return `${DOW[new Date(day + 'T12:00:00Z').getUTCDay()]} ${fr(day)}`;
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** « 13/10 à 18:02 », à l'heure de Paris. */
const when = (iso: string): string => { const w = parisWall(new Date(iso)); return `${fr(w.slice(0, 10))} à ${w.slice(11, 16)}`; };

/** Les élèves que ce jeton peut voir. */
function visible(ctx: McpCtx): repo.Student[] {
  const linked = repo.listStudents().filter((s) => s.linkState === 'confirme' && s.memberId);
  return ctx.enfant ? linked.filter((s) => s.memberId === ctx.memberId) : linked;
}

/**
 * Les élèves visés par `enfant` (prénom du membre ou prénom à l'école, sans
 * accents ni casse, début de mot accepté), ou tous les visibles. Un enfant qui
 * en demande un autre reçoit un refus explicite.
 */
function pick(ctx: McpCtx, enfant?: string): repo.Student[] | string {
  const all = repo.listStudents().filter((s) => s.linkState === 'confirme' && s.memberId);
  const mine = visible(ctx);
  if (!all.length) return 'Aucun élève associé à ÉcoleDirecte. Un administrateur les associe dans Paramètres, section École.';
  if (!enfant?.trim()) return mine.length ? mine : 'Aucun élève associé à votre compte.';
  const q = normName(enfant);
  const hits = all.filter((s) => [memberName(s.memberId), s.firstName].some((n) => normName(n) === q || normName(n).startsWith(q)));
  if (!hits.length) return `Aucun élève ne correspond à « ${enfant} ». Élèves connus : ${mine.map((s) => memberName(s.memberId) || s.firstName).join(', ') || 'aucun'}.`;
  const allowed = hits.filter((s) => mine.some((m) => m.id === s.id));
  if (!allowed.length) return 'Refusé : ce compte ne donne accès qu’à ce qui vous concerne.';
  return allowed;
}

/** La ligne d'état d'un élève, ajoutée quand les données ne sont pas fraîches : jamais une donnée périmée présentée comme à jour. */
function staleness(s: repo.Student): string {
  const a = repo.getAccount(s.accountId);
  if (s.dataError) return ` (attention : dernière synchronisation en échec, ${s.dataError}${s.dataOkAt ? ' ; données du ' + when(s.dataOkAt) : ''})`;
  if (a && (a.blocked || (a.lastSyncOk === false))) return ` (attention : ÉcoleDirecte en échec${a.lastOkAt ? ', dernière réussite le ' + when(a.lastOkAt) : ''})`;
  return '';
}
const nameOf = (s: repo.Student): string => memberName(s.memberId) || s.firstName;

/** « maths » retrouve « MATHEMATIQUES » (code MATHS) : sans accents, sans pluriel, dans le nom ou le code. */
const subjectMatches = (query: string) => {
  const q = normName(query).replace(/s$/, '');
  return (subject: string, code: string): boolean => normName(subject).includes(q) || normName(code).includes(q);
};

export function ecoleDevoirs(ctx: McpCtx, args: { enfant?: string; quand?: string; date?: string }): string {
  const who = pick(ctx, args.enfant);
  if (typeof who === 'string') return who;
  const today = parisToday();
  let from = addDays(today, 1), to = from, titre = 'pour demain';
  if (args.quand === 'semaine') { from = today; to = addDays(today, 7); titre = 'des 7 prochains jours'; }
  else if (args.quand === 'date' || (args.date && ISO.test(args.date))) {
    if (!args.date || !ISO.test(args.date)) return 'Précisez `date` au format AAAA-MM-JJ.';
    from = to = args.date; titre = 'pour le ' + fr(args.date);
  }
  const tasks = docTasks();
  return who.map((s) => {
    const rows = repo.listHomework([s.id], from, to);
    const head = `${nameOf(s)} : devoirs ${titre}${staleness(s)}`;
    if (!rows.length) return head + '\n- rien.';
    return head + '\n' + rows.map((h) => {
      const done = localDone(h, h.taskId ? tasks.get(h.taskId) : undefined);
      const synced = h.doneSynced ?? h.doneEd;
      const quand = from === to ? '' : dayLabel(h.due, today) + ' · ';
      const texte = h.contentText.split('\n').filter(Boolean).join(' ').slice(0, 300) || 'énoncé pas encore récupéré';
      return `- [${h.id}] ${quand}${subjectLabel(h.subject)}${h.isTest ? ' (interrogation)' : ''} : ${texte} · ${done ? 'fait' : 'à faire'}${done !== synced ? ' (pas encore transmis à ÉcoleDirecte)' : ''}`;
    }).join('\n');
  }).join('\n\n');
}

export function ecoleDevoirFait(ctx: McpCtx, args: { id: string; fait?: boolean }): string {
  const h = repo.getHomework(Number(args.id));
  if (!h) return `Devoir [${args.id}] introuvable. Utilisez ecole_devoirs pour voir les identifiants.`;
  const s = visible(ctx).find((x) => x.id === h.studentId);
  if (!s) return 'Refusé : ce devoir ne vous est pas accessible.';
  const fait = args.fait !== false;
  setHomeworkDone(h, fait, { id: ctx.memberId, name: memberName(ctx.memberId) || 'un membre' }, ctx.via);
  return `${subjectLabel(h.subject)} pour ${dayLabel(h.due, parisToday())} (${nameOf(s)}) : marqué ${fait ? 'fait' : 'à faire'}. ÉcoleDirecte l’apprendra à la prochaine synchronisation.`;
}

export function ecoleEmploiDuTemps(ctx: McpCtx, args: { enfant?: string; date?: string }): string {
  const who = pick(ctx, args.enfant);
  if (typeof who === 'string') return who;
  const today = parisToday();
  const day = args.date && ISO.test(args.date) ? args.date : today;
  return who.map((s) => {
    const lessons = repo.listLessons([s.id], day, day);
    const head = `${nameOf(s)} : cours ${dayLabel(day, today)}${staleness(s)}`;
    if (!lessons.length) return head + '\n- aucun cours importé ce jour-là (vacances, week-end, ou au-delà de la période synchronisée).';
    const out = lessons.filter((l) => !l.cancelled);
    const sortie = out.length ? ` Sortie à ${out[out.length - 1].end}.` : ' Tous les cours sont annulés.';
    return head + '\n' + lessons.map((l) => `- ${l.start}-${l.end} ${subjectLabel(l.subject)}${l.room ? ' (' + l.room + ')' : ''}${l.cancelled ? ' : ANNULÉ' : l.modified ? ' : modifié' : ''}`).join('\n') + '\n' + sortie.trim();
  }).join('\n\n');
}

export function ecoleNotes(ctx: McpCtx, args: { enfant?: string; matiere?: string; depuis?: string }): string {
  const who = pick(ctx, args.enfant);
  if (typeof who === 'string') return who;
  const max = Number(effectiveSetting('ecoleNotesMax')) || 15;
  return who.map((s) => {
    let grades = repo.listGrades(s.id, 500);
    const match = args.matiere ? subjectMatches(args.matiere) : null;
    if (match) grades = grades.filter((g) => match(g.subject, g.subjectCode));
    if (args.depuis && ISO.test(args.depuis)) grades = grades.filter((g) => !g.date || g.date >= args.depuis!);
    grades = grades.slice(0, max);
    const avg = repo.listAverages(s.id);
    const today = parisToday();
    const codes = [...new Set(avg.map((a) => a.periodCode))];
    const current = codes.find((c) => { const p = avg.find((a) => a.periodCode === c)!; return !!p.periodFrom && !!p.periodTo && p.periodFrom <= today && today <= p.periodTo; }) ?? codes[codes.length - 1];
    const rows = avg.filter((a) => a.periodCode === current && (!match || a.subjectCode === '_GENERALE' || match(a.subject, a.subjectCode)));
    const lines = [`${nameOf(s)} : notes${staleness(s)}`];
    lines.push(...(grades.length ? grades.map((g) => `- ${fr(g.date)} ${subjectLabel(g.subject)} : ${g.valueRaw}${g.valueNum !== null && g.outOf ? '/' + g.outOf : ''}${g.coefficient && g.coefficient !== '1' ? ' (coef. ' + g.coefficient + ')' : ''}${g.label ? ', ' + g.label : ''}${g.classAverage ? ', moyenne de la classe ' + g.classAverage : ''}${g.notSignificant ? ', non significative' : ''}`) : ['- aucune note.']));
    if (rows.length) {
      lines.push(`Moyennes (${rows[0].periodLabel || current}, telles que calculées par l’établissement) :`);
      lines.push(...rows.map((a) => `- ${a.subjectCode === '_GENERALE' ? 'Moyenne générale' : subjectLabel(a.subject)} : ${a.average || 'non calculée'}${a.classAverage ? ' (classe ' + a.classAverage + ')' : ''}`));
    }
    return lines.join('\n');
  }).join('\n\n');
}

const LIFE = { absence: 'Absence', retard: 'Retard', sanction: 'Sanction', encouragement: 'Encouragement' } as const;

export function ecoleVieScolaire(ctx: McpCtx, args: { enfant?: string; depuis?: string }): string {
  const who = pick(ctx, args.enfant);
  if (typeof who === 'string') return who;
  const today = parisToday();
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const from = args.depuis && ISO.test(args.depuis) ? args.depuis : `${m >= 8 ? y : y - 1}-08-01`;
  return who.map((s) => {
    const items = repo.listLife(s.id, from);
    const head = `${nameOf(s)} : vie scolaire depuis le ${fr(from)}${staleness(s)}`;
    if (!items.length) return head + '\n- rien d’enregistré.';
    return head + '\n' + items.map((e) => `- ${fr(e.date)} ${LIFE[e.kind]}${e.justified === null || (e.kind !== 'absence' && e.kind !== 'retard') ? '' : e.justified ? ' (justifié)' : ' (non justifié)'}${e.label ? ' : ' + e.label : ''}${e.reason ? ', ' + e.reason : ''}`).join('\n');
  }).join('\n\n');
}

export function ecoleEtat(ctx: McpCtx): string {
  const mine = visible(ctx);
  const accounts = repo.listAccounts().filter((a) => ctx.enfant ? mine.some((s) => s.accountId === a.id) : true);
  if (!accounts.length) return 'Aucun compte ÉcoleDirecte configuré.';
  const out: string[] = [];
  for (const a of accounts) {
    const etat = a.blocked === 'qcm' ? 'question de sécurité à répondre dans Paramètres'
      : a.blocked === 'identifiants' ? 'identifiants refusés, à ressaisir'
      : a.blocked === 'version' ? 'version d’API refusée (FOYER_ED_API_VERSION à mettre à jour)'
      : a.blocked === 'cle' ? 'identifiants à ressaisir (clé de chiffrement changée)'
      : !a.enabled ? 'en pause'
      : a.pausedUntil && Date.parse(a.pausedUntil) > Date.now() ? 'en pause automatique après plusieurs échecs'
      : a.lastSyncOk === false ? 'dernière tentative en échec' : a.lastSyncOk ? 'connecté' : 'jamais connecté';
    out.push(`Compte « ${a.label} » : ${etat}. Dernière réussite : ${a.lastOkAt ? 'le ' + when(a.lastOkAt) : 'jamais'}.${a.lastErrorMessage && a.lastSyncOk === false ? ' Dernière erreur : ' + a.lastErrorMessage : ''}`);
    for (const s of mine.filter((x) => x.accountId === a.id)) {
      out.push(`- ${nameOf(s)} : ${s.dataError ? 'données en échec (' + s.dataError + ')' : s.dataOkAt ? 'données à jour du ' + when(s.dataOkAt) : 'pas encore synchronisé'}`);
    }
  }
  return out.join('\n');
}
