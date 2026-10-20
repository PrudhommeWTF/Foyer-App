// Les outils d'assistant du module Révisions. Comme les écrans, ils ne
// connaissent aucun exercice : tout passe par les définitions du registre
// (revisions/exercises/), dont `revisions_exercices` décrit les paramètres pour
// que l'assistant sache ce qu'il peut régler. Même règle de visibilité que les
// routes : un enfant ne voit que lui (en demander un autre est refusé en
// clair), un adulte voit tout le monde, le bilan et le réglage d'un programme
// sont réservés aux adultes (marqués `adultes` dans server.ts).
import { getHousehold } from '../db';
import { HouseholdState, Member } from '../models';
import { log } from '../log';
import { Bareme, timingFor } from '../revisions/bareme';
import { addDays, bilanFor, mondayOf, parisDay } from '../revisions/bilan';
import { EXERCISES, exerciseById } from '../revisions/exercises';
import { ExerciseContext, ExerciseDef, ParamDecl, Params, defaults, readParams } from '../revisions/exercises/contract';
import { Status, status } from '../revisions/mastery';
import { Matiere, matiereLabel } from '../revisions/matieres';
import { activeProgram, countedAnswers, masteryRows, sessionsOf, setProgram, stopProgram, toMastery } from '../revisions/repo';
import { syncDayTasks } from '../revisions/devoirs';
import type { McpCtx } from './tools';

let deps: { bareme: (exercise?: string) => Bareme; matieres: () => Matiere[]; context: (exercise: string) => ExerciseContext } | null = null;
/** Le barème, les matières et le contenu des exercices en vigueur, lus dans le dossier de données et la base (posés par server.ts). */
export function setRevisionsToolsDeps(d: NonNullable<typeof deps>): void { deps = d; }
const bareme = (ex?: string): Bareme => deps!.bareme(ex);
const contextOf = (ex: string): ExerciseContext => deps!.context(ex);

const members = (): Member[] => (getHousehold().state as HouseholdState).members;
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const STATUS: Record<Status, string> = { jamais: 'pas encore vus', peu: 'pas assez de réponses', 'en-cours': 'en cours', acquise: 'acquis' };
const MODE: Record<string, string> = { apprendre: 'apprendre', entrainer: 's’entraîner', test: 'test' };
const today = (): string => parisDay(new Date().toISOString());
const fr = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

/**
 * Le membre visé par `enfant` (prénom, sans accents ni casse, début accepté),
 * ou, sans `enfant`, soi-même pour un enfant et les enfants du foyer pour un
 * adulte. Un enfant qui en demande un autre reçoit un refus explicite.
 */
function pick(ctx: McpCtx, enfant?: string): Member[] | string {
  const me = members().find((m) => m.id === ctx.memberId);
  if (!enfant?.trim()) {
    if (ctx.enfant) return me ? [me] : 'Membre introuvable.';
    const kids = members().filter((m) => m.enfant);
    return kids.length ? kids : 'Aucun enfant dans le foyer. Précisez `enfant` pour le suivi d’un adulte.';
  }
  const q = norm(enfant);
  const hits = members().filter((m) => norm(m.name) === q || norm(m.name).startsWith(q));
  if (!hits.length) return `Personne ne s’appelle « ${enfant} » dans le foyer. Membres : ${members().map((m) => m.name).join(', ')}.`;
  if (ctx.enfant && !hits.some((m) => m.id === ctx.memberId)) return 'Refusé : ce compte ne donne accès qu’à ce qui vous concerne.';
  return ctx.enfant ? hits.filter((m) => m.id === ctx.memberId) : hits;
}
function pickOne(ctx: McpCtx, enfant?: string): Member | string {
  const who = pick(ctx, enfant);
  if (typeof who === 'string') return who;
  return who.length === 1 ? who[0] : `Plusieurs personnes possibles (${who.map((m) => m.name).join(', ')}) : précisez \`enfant\`.`;
}
function pickExercise(id?: string): ExerciseDef | string {
  if (!id?.trim()) return EXERCISES.length === 1 ? EXERCISES[0] : `Précisez \`exercice\` : ${EXERCISES.map((e) => e.id).join(', ')}.`;
  return exerciseById(id.trim()) ?? `Exercice inconnu : « ${id} ». Exercices : ${EXERCISES.map((e) => e.id).join(', ')} (voir revisions_exercices).`;
}

const paramLine = (d: ParamDecl, ctx: ExerciseContext): string => {
  const bornes = d.type === 'int' ? `entier de ${d.min} à ${d.max}` : d.type === 'bool' ? 'oui (true) ou non (false)'
    : d.type === 'enum' ? d.options.map((o) => `${o.value} (${o.label})`).join(', ')
    : d.type === 'range' ? `deux entiers [de, à] entre ${d.min} et ${d.max}${d.maxFrom ? `, à au plus ${d.maxFrom}` : ''}`
    : `l’identifiant d’une liste : ${ctx.lists.filter((l) => !l.archived).map((l) => `${l.id} (« ${l.label} », ${l.items.length} ${d.items})`).join(', ') || 'aucune pour l’instant'}`;
  return `  - \`${d.key}\` : ${d.label}, ${bornes} ; défaut ${JSON.stringify(d.default)}${d.desc ? '. ' + d.desc : ''}`;
};

/** Les exercices disponibles et leurs paramètres : ce qu'un programme peut régler. */
export function revisionsExercices(): string {
  const mat = deps!.matieres();
  return EXERCISES.map((e) => [
    `${e.label} [${e.id}] (${matiereLabel(mat, e.matiere)}${e.ageMin ? `, dès ${e.ageMin} ans environ` : ''}) : ${e.desc}`,
    `  Modes : ${e.learn ? 'apprendre, ' : ''}s’entraîner, test. Paramètres du programme :`,
    ...e.params.map((d) => paramLine(d, contextOf(e.id))),
  ].join('\n')).join('\n\n') + '\n\nUn programme règle aussi `questions` (5 à 100 par session), `objectif_jour` (0 à 10 sessions) et le temps par réponse (`secondes`, ou rien pour le barème selon l’âge).';
}

/** Où en est un membre pour un exercice : programme, temps accordé, maîtrise résumée, ce qui reste fragile, réussite sur 4 semaines. */
function progressionOf(m: Member, def: ExerciseDef): string {
  const program = activeProgram(m.id, def.id);
  const cx = contextOf(def.id);
  let p: Params;
  try { p = program ? readParams(def, JSON.parse(program.params_json), cx) : defaults(def, cx); } catch { p = defaults(def, cx); }
  const b = bareme(def.id);
  const t = timingFor(b, m, today(), program && { secondsAllowed: program.seconds_allowed, fastSeconds: program.fast_seconds });
  const universe = new Set(def.universe(p, cx));
  const rows = masteryRows(m.id, def.id).filter((r) => universe.has(r.item_key));
  const counts: Record<Status, number> = { jamais: 0, peu: 0, 'en-cours': 0, acquise: 0 };
  for (const r of rows) counts[status(toMastery(r), b.maitrise)]++;
  counts.jamais += universe.size - rows.length;
  const frag = rows.map((r) => ({ r, m: toMastery(r) })).filter(({ m: x }) => status(x, b.maitrise) !== 'acquise' && (x.wrong > 0 || x.lastResult !== 'bon'))
    .sort((x, y) => x.m.level - y.m.level || y.m.wrong - x.m.wrong).slice(0, 8).map(({ r }) => def.itemLabel(r.item_key));
  const since = new Date(Date.now() - 28 * 86400_000).toISOString();
  const groups = new Map<string, { q: number; ok: number }>();
  for (const a of countedAnswers(m.id, def.id, since)) for (const g of def.groups(a.item_key, p, cx)) {
    const e = groups.get(g) ?? { q: 0, ok: 0 }; e.q++; if (a.result === 'bon' || a.result === 'lent') e.ok++; groups.set(g, e);
  }
  const s = (ms: number): string => String(ms / 1000).replace('.', ',');
  return [
    `${m.name}, ${def.label} : ${program ? `programme « ${def.summary(p, cx)} », ${program.questions} questions, objectif ${program.daily_goal} session(s) par jour` : `pas de programme (réglages par défaut : ${def.summary(p, cx)})`}.`,
    `Temps par réponse : ${s(t.allowedMs)} s, rapide sous ${s(t.fastMs)} s (${t.source === 'programme' ? 'fixé par le programme' : t.source === 'sans-age' ? 'barème, sans date de naissance' : `barème à ${t.age ?? '?'} ans`}).`,
    `Sur ${universe.size} items : ${(['acquise', 'en-cours', 'peu', 'jamais'] as Status[]).map((k) => `${counts[k]} ${STATUS[k]}`).join(', ')}.`,
    frag.length ? `Encore fragiles : ${frag.join(', ')}.` : 'Rien de fragile pour l’instant.',
    groups.size ? `Réussite sur 4 semaines : ${[...groups.entries()].sort(([x], [y]) => x.localeCompare(y, 'fr', { numeric: true })).map(([g, e]) => `${g} ${Math.round((e.ok / e.q) * 100)} % (${e.q})`).join(', ')}.` : 'Pas de réponse ces 4 dernières semaines.',
  ].join('\n');
}

export function revisionsProgression(ctx: McpCtx, a: { enfant?: string; exercice?: string }): string {
  const who = pick(ctx, a.enfant);
  if (typeof who === 'string') return who;
  const defs = a.exercice ? pickExercise(a.exercice) : null;
  if (typeof defs === 'string') return defs;
  return who.flatMap((m) => (defs ? [defs] : EXERCISES).map((d) => progressionOf(m, d))).join('\n\n');
}

export function revisionsSessions(ctx: McpCtx, a: { enfant?: string; depuis?: string }): string {
  const who = pick(ctx, a.enfant);
  if (typeof who === 'string') return who;
  if (a.depuis !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(a.depuis)) return 'Précisez `depuis` au format AAAA-MM-JJ.';
  const since = (a.depuis ? addDays(a.depuis, -1) : addDays(today(), -8)) + 'T00:00:00.000Z';
  const from = a.depuis ?? addDays(today(), -7);
  return who.map((m) => {
    const ss = sessionsOf(m.id, null, since, 200).filter((s) => parisDay(s.started_at) >= from);
    if (!ss.length) return `${m.name} : pas de session depuis le ${fr(from)}.`;
    return `${m.name}, ${ss.length} session(s) depuis le ${fr(from)} :\n` + ss.map((s) => {
      const d = exerciseById(s.exercise_id);
      let what = '';
      try { const cx = d && contextOf(d.id); what = d && cx ? d.summary(readParams(d, JSON.parse(s.params_json), cx), cx) : ''; } catch { /* réglages illisibles */ }
      const w = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(s.started_at));
      return `- ${w}, ${d?.label ?? s.exercise_id} (${MODE[s.mode] ?? s.mode}${what ? ', ' + what : ''}) : ${s.good} bonnes, ${s.slow} lentes, ${s.wrong} fausses${s.aborted ? ', arrêtée' : ''}`;
    }).join('\n');
  }).join('\n\n');
}

const PERIODES = ['semaine', 'semaine-derniere', 'mois', 'mois-dernier'] as const;
export function revisionsBilan(ctx: McpCtx, a: { enfant?: string; periode?: string }): string {
  const who = pick(ctx, a.enfant);
  if (typeof who === 'string') return who;
  const kids = who.filter((m) => m.enfant);
  if (!kids.length) return 'Un bilan se fait pour un enfant. Un adulte s’entraîne librement, sans bilan (voir revisions_progression).';
  const per = (PERIODES as readonly string[]).includes(a.periode ?? '') ? a.periode! : 'semaine';
  const t = today(), monday = mondayOf(t), first = t.slice(0, 8) + '01', lastPrev = addDays(first, -1);
  const range = per === 'semaine' ? [monday, t] : per === 'semaine-derniere' ? [addDays(monday, -7), addDays(monday, -1)]
    : per === 'mois' ? [first, t] : [lastPrev.slice(0, 8) + '01', lastPrev];
  return kids.map((m) => {
    const b = bilanFor({ id: m.id, name: m.name }, range[0], range[1], deps!.matieres(), (ex) => bareme(ex).maitrise, contextOf);
    if (!b.matieres.length) return `${m.name}, ${b.label.toLowerCase()} : pas de session de révisions.`;
    const lines = [`${m.name}, ${b.label.charAt(0).toLowerCase() + b.label.slice(1)} : ${b.totals.sessions} session(s), ${b.totals.questions} questions, ${b.totals.pct} % de réponses justes${b.prev ? ` (${b.prev.pct} % la période précédente)` : ''}.`];
    for (const mt of b.matieres) for (const e of mt.exercises) {
      lines.push(`${mt.label}, ${e.label} : ${e.summary}. ${e.totals.sessions ? `${e.totals.sessions} session(s), ${e.totals.pct} % justes.` : 'Pas de session.'}`);
      if (e.groups.length) lines.push('  ' + e.groups.map((g) => `${g.group} ${g.pct} %${g.prevPct !== null ? ` (avant ${g.prevPct} %)` : ''}`).join(', '));
      lines.push(e.fragiles.length ? `  Encore fragiles : ${e.fragiles.map((f) => f.label).join(', ')}.` : '  Rien de fragile.');
    }
    return lines.join('\n');
  }).join('\n\n') + '\n\nLe PDF « Pour la maîtresse » se télécharge depuis l’écran Révisions, onglet Suivi.';
}

/** Règle (ou retire) le programme d'un enfant pour un exercice. Les paramètres donnés s'ajoutent à ceux du programme en cours. */
export function revisionsProgrammeDefinir(ctx: McpCtx, a: {
  enfant?: string; exercice?: string; params?: Record<string, unknown>; questions?: number; objectif_jour?: number; secondes?: number | null; retirer?: boolean;
}): string {
  const m = pickOne(ctx, a.enfant);
  if (typeof m === 'string') return m;
  if (!m.enfant) return 'Un programme se règle pour un enfant. Un adulte s’entraîne librement.';
  const def = pickExercise(a.exercice);
  if (typeof def === 'string') return def;
  const me = members().find((x) => x.id === ctx.memberId);
  if (a.retirer) {
    if (!stopProgram(m.id, def.id)) return `${m.name} n’a pas de programme ${def.label} actif.`;
    log.info(`Révisions : ${me?.name ?? ctx.memberId} a retiré le programme ${def.label} de ${m.name} (assistant ${ctx.via}).`);
    dayTasks();
    return `Programme ${def.label} de ${m.name} retiré. Son historique reste ; il s’entraîne désormais aux réglages par défaut.`;
  }
  const cur = activeProgram(m.id, def.id), cx = contextOf(def.id);
  let base: Params;
  try { base = cur ? readParams(def, JSON.parse(cur.params_json), cx) : defaults(def, cx); } catch { base = defaults(def, cx); }
  let params: Params;
  try { params = readParams(def, { ...base, ...(a.params ?? {}) }, cx); } catch (e) { return `Refusé : ${(e as Error).message} (voir revisions_exercices).`; }
  const int = (v: number | undefined, d: number, min: number, max: number, what: string): number | string =>
    v === undefined ? d : Number.isInteger(v) && v >= min && v <= max ? v : `Refusé : ${what} entre ${min} et ${max}.`;
  const questions = int(a.questions, cur?.questions ?? 20, 5, 100, '`questions`');
  const goal = int(a.objectif_jour, cur?.daily_goal ?? 1, 0, 10, '`objectif_jour`');
  if (typeof questions === 'string') return questions;
  if (typeof goal === 'string') return goal;
  const secs = a.secondes === undefined ? cur?.seconds_allowed ?? null : a.secondes;
  if (secs !== null && !(typeof secs === 'number' && secs >= 1 && secs <= 120)) return 'Refusé : `secondes` entre 1 et 120, ou null pour le barème selon l’âge.';
  const p = setProgram({
    memberId: m.id, exerciseId: def.id, params, questions, dailyGoal: goal, setBy: ctx.memberId,
    secondsAllowed: secs === null ? null : Math.round(secs * 10) / 10,
    // Un temps fixé par l'assistant garde le seuil rapide du programme s'il tient dedans, sinon la moitié.
    fastSeconds: secs === null ? null : Math.min(cur?.fast_seconds ?? secs / 2, secs),
  });
  log.info(`Révisions : ${me?.name ?? ctx.memberId} a réglé le programme ${def.label} de ${m.name} par l’assistant (${ctx.via}) : ${def.summary(params, cx)}, ${p.questions} questions, objectif ${p.daily_goal} par jour.`);
  dayTasks();
  // La tâche du jour dans « Devoirs de … » se règle à l'écran ; l'assistant garde le choix du programme remplacé.
  const task = p.daily_task ? ` La tâche du jour reste dans « Devoirs de ${m.name} »${p.daily_goal ? '' : ', mais sans objectif elle n’apparaît plus'}.` : '';
  return `Programme ${def.label} de ${m.name} enregistré : ${def.summary(params, cx)}, ${p.questions} questions par session, objectif ${p.daily_goal} session(s) par jour, ${secs === null ? 'temps selon le barème de l’âge' : `${String(secs).replace('.', ',')} s par réponse`}.${task} L’ancien programme reste dans l’historique.`;
}

/** Les tâches du jour suivent le programme ; un échec n'empêche pas de l'enregistrer, le passage suivant rattrape. */
function dayTasks(): void {
  try { syncDayTasks(); } catch (e) { log.erreur('Révisions : tâches du jour en échec', e); }
}
