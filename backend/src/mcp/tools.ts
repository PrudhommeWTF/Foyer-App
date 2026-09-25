// La logique des outils MCP, à part du transport et de l'enregistrement (voir
// server.ts). Chaque outil rend un texte français court, lisible tel quel par
// l'assistant, avec les identifiants entre crochets quand un geste ultérieur en
// a besoin. Les dates sont en AAAA-MM-JJ, l'heure de Paris.
//
// Un outil rend « ce qui est demandé, pas le document » : il n'existe aucun
// outil « tout l'état ». Les écritures passent par les mêmes chemins que l'app
// (opérations de courses et de tâches, transaction sur le document pour les
// événements), portent l'auteur (`by` = membre) et la provenance (`via` = nom
// du jeton), et respectent la portée et le rôle du membre.
import { getHousehold, db, saveHousehold } from '../db';
import { HouseholdState, EventItem, Recipe, SchedSlot, MealValue, MealItem, ShopList, TaskList, ListKind } from '../models';
import { applyShoppingOps, preserveShopping } from '../shopping/repo';
import { applyTaskOps, preserveTasks } from '../tasks/repo';
import { TaskItem } from '../tasks/ops';
import { byOrd, orderedOf } from '../tasks/ordering';
import { FALLBACK_AISLE_NAMES } from '../shopping/ops';
import { addDaysIso, publishedSlotOccurrences } from '../schedule';
import { effectiveSetting } from '../settings/repo';
import { fetchPublic } from '../recipes/fetch';
import { FetchError } from '../recipes/fetch';
import { ImportError, parseRecipePage } from '../recipes/schema-org';

/** Qui agit, et par quel jeton. Construit à chaque requête depuis req.user/req.apiToken. */
export interface McpCtx { memberId: string; enfant: boolean; scope: 'read' | 'write'; via: string; }

const MEAL_SLOTS: { key: string; label: string }[] = [
  { key: 'matin', label: 'Petit-déjeuner' }, { key: 'midi', label: 'Midi' }, { key: 'soir', label: 'Soir' },
];

const state = (): HouseholdState => getHousehold().state as HouseholdState;
const norm = (s: string): string => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const genId = (p: string): string => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Aujourd'hui à l'heure de Paris, AAAA-MM-JJ (le fuseau du foyer est fixe). */
export function todayParis(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}
/** Une date AAAA-MM-JJ écrite JJ/MM (l'année n'est rappelée que si elle diffère). */
function frDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-');
  return withYear ? `${d}/${m}/${y}` : `${d}/${m}`;
}

const memberName = (s: HouseholdState, id: string): string => s.members.find((m) => m.id === id)?.name || id;

/** Les listes de tâches visibles pour ce membre : partagées, ou privées lui appartenant. */
function visibleTaskLists(s: HouseholdState, ctx: McpCtx) {
  return (s.taskLists || []).filter((l) => !l.archived && (l.scope === 'shared' || l.scope === ctx.memberId));
}

/**
 * Résout une tâche désignée par identifiant OU par intitulé, avec correspondance
 * approchée : à la voix, on ne dicte jamais un identifiant. On cherche, dans les
 * listes visibles et parmi les tâches ouvertes (pas les sous-tâches), l'identifiant
 * exact, puis l'intitulé exact, puis l'intitulé qui contient les mots dictés. En
 * cas d'ambiguïté, on rend les candidats et on ne devine pas.
 */
type TaskResolution = { id: string } | { candidates: TaskItem[] } | { none: true };
function resolveTask(s: HouseholdState, ctx: McpCtx, query: string): TaskResolution {
  const q = norm(query);
  if (!q) return { none: true };
  const listIds = new Set(visibleTaskLists(s, ctx).map((l) => l.id));
  const open = (s.tasks || []).filter((t) => listIds.has(t.listId) && !t.done && !t.parentId);
  const byId = open.find((t) => t.id === query.trim());
  if (byId) return { id: byId.id };
  const exact = open.filter((t) => norm(t.text) === q);
  if (exact.length === 1) return { id: exact[0].id };
  if (exact.length > 1) return { candidates: exact };
  const approx = open.filter((t) => norm(t.text).includes(q));
  if (approx.length === 1) return { id: approx[0].id };
  if (approx.length > 1) return { candidates: approx };
  return { none: true };
}

/** Le texte d'ambiguïté : la liste des candidats avec leur identifiant, pour que l'assistant précise. */
function candidatsTexte(s: HouseholdState, query: string, candidates: TaskItem[]): string {
  const lignes = candidates.slice(0, 8).map((t) => `- ${t.text} [${t.id}] (${s.taskLists?.find((l) => l.id === t.listId)?.name || 'Tâches'})`);
  return `Plusieurs tâches correspondent à « ${query} ». Précisez laquelle (par son identifiant) :\n${lignes.join('\n')}`;
}

/** Résout des prénoms en identifiants de membres. Rend les inconnus pour le dire à l'assistant. */
function resolveMembers(s: HouseholdState, names: string[]): { ids: string[]; unknown: string[] } {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const n = norm(raw);
    const m = s.members.find((x) => norm(x.name) === n);
    if (m) { if (!ids.includes(m.id)) ids.push(m.id); } else unknown.push(raw);
  }
  return { ids, unknown };
}

const mainShopList = (s: HouseholdState) => (s.shopLists || [])[0] || null;
function resolveShopList(s: HouseholdState, name?: string) {
  if (!name) return mainShopList(s);
  const n = norm(name);
  return (s.shopLists || []).find((l) => norm(l.name) === n) || null;
}
/** Le rayon de repli (« Non classé »), sinon le premier rayon : un article atterrit toujours quelque part. */
function fallbackAisle(s: HouseholdState) {
  return (s.aisles || []).find((a) => FALLBACK_AISLE_NAMES.includes(a.name)) || (s.aisles || [])[0] || null;
}
function resolveAisle(s: HouseholdState, rayon?: string) {
  if (rayon) { const n = norm(rayon); const a = (s.aisles || []).find((x) => norm(x.name) === n); if (a) return a; }
  return fallbackAisle(s);
}

// ---- Résolveurs et constantes partagés pour le CRUD -----------------------

const RECUR_VALUES = ['none', 'daily', 'weekday', 'weekly', 'biweekly', 'monthly'] as const;
const RECUR_LABEL: Record<string, string> = { daily: 'chaque jour', weekday: 'en semaine', weekly: 'chaque semaine', biweekly: 'une semaine sur deux', monthly: 'chaque mois' };
const SCHED_TYPES = ['ecole', 'travail', 'sport', 'loisir', 'sante', 'repas', 'autre'] as const;
const SCHED_WHEN = ['always', 'school', 'holidays'] as const;
const WHEN_LABEL: Record<string, string> = { always: 'toujours', school: 'période scolaire', holidays: 'vacances' };
const MEAL_KEY_BY_NAME: Record<string, string> = { matin: 'matin', 'petit-dejeuner': 'matin', 'petit dejeuner': 'matin', midi: 'midi', dejeuner: 'midi', soir: 'soir', diner: 'soir', souper: 'soir' };
const MEAL_LABEL: Record<string, string> = { matin: 'Petit-déjeuner', midi: 'Midi', soir: 'Soir' };
const DOW_BY_NAME: Record<string, number> = { lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 7 };
const DOW_LABEL = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const isDate = (v?: string): boolean => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v?: string): boolean => !!v && /^\d{2}:\d{2}$/.test(v);
/** Jour de la semaine d'une date ISO, lundi = 1 à dimanche = 7 (comme `dow`). */
function dowOf(iso: string): number { const [y, m, d] = iso.split('-').map(Number); const j = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1)).getUTCDay(); return j === 0 ? 7 : j; }
/** Un nom de jour (« lundi ») ou un numéro (1..7) vers un `dow`. */
function resolveDow(v: string | number | undefined): number | null {
  if (typeof v === 'number') return v >= 1 && v <= 7 ? v : null;
  const n = norm(String(v || '')); if (!n) return null;
  if (DOW_BY_NAME[n]) return DOW_BY_NAME[n];
  const num = Number(n); return Number.isInteger(num) && num >= 1 && num <= 7 ? num : null;
}
/** Le créneau de repas (« matin », « déjeuner »…) ramené à sa clé matin/midi/soir. */
function resolveMealKey(v: string): string | null { return MEAL_KEY_BY_NAME[norm(v)] || null; }

const resolveEvent = (s: HouseholdState, id: string): EventItem | null => (s.events || []).find((e) => e.id === id) || null;
/** Une recette par identifiant, puis par nom exact, puis par nom contenant les mots. */
function resolveRecipe(s: HouseholdState, q: string): Recipe | null {
  const byId = (s.recipes || []).find((r) => r.id === q.trim()); if (byId) return byId;
  const n = norm(q); if (!n) return null;
  return (s.recipes || []).find((r) => norm(r.name) === n) || (s.recipes || []).find((r) => norm(r.name).includes(n)) || null;
}
const resolveSlot = (s: HouseholdState, id: string) => (s.sched || []).find((x) => x.id === id) || null;

/**
 * Résout une tâche ouverte OU terminée, par identifiant ou intitulé. Sert aux
 * gestes qui peuvent viser l'une comme l'autre (modifier, rouvrir, supprimer).
 */
function resolveTaskAny(s: HouseholdState, ctx: McpCtx, query: string): TaskResolution {
  const q = norm(query);
  if (!q) return { none: true };
  const listIds = new Set(visibleTaskLists(s, ctx).map((l) => l.id));
  const byId = (s.tasks || []).find((t) => t.id === query.trim() && listIds.has(t.listId));
  if (byId) return { id: byId.id };
  const roots = (s.tasks || []).filter((t) => listIds.has(t.listId) && !t.parentId);
  const exact = roots.filter((t) => norm(t.text) === q);
  if (exact.length === 1) return { id: exact[0].id };
  if (exact.length > 1) return { candidates: exact };
  const approx = roots.filter((t) => norm(t.text).includes(q));
  if (approx.length === 1) return { id: approx[0].id };
  if (approx.length > 1) return { candidates: approx };
  return { none: true };
}

// ---- Lecture -------------------------------------------------------------

export function aujourdhui(ctx: McpCtx): string {
  const s = state();
  const today = todayParis();
  const tomorrow = addDaysIso(today, 1);
  const lines: string[] = [`Aujourd'hui, ${frDate(today, true)}.`];

  const evToday = eventsBetween(s, today, today);
  const evTomorrow = eventsBetween(s, tomorrow, tomorrow);
  lines.push(evToday.length ? 'Événements aujourd’hui : ' + evToday.map((e) => e.line).join(' ; ') : 'Aucun événement aujourd’hui.');
  if (evTomorrow.length) lines.push('Demain : ' + evTomorrow.map((e) => e.line).join(' ; '));

  const lists = visibleTaskLists(s, ctx);
  const listIds = new Set(lists.map((l) => l.id));
  const mine = (s.tasks || []).filter((t) => listIds.has(t.listId) && !t.done && !t.parentId && t.due === today
    && (t.who.length === 0 || t.who.includes(ctx.memberId)));
  lines.push(mine.length ? `Tâches à faire aujourd’hui (${mine.length}) : ` + mine.map((t) => t.text).join(', ') : 'Aucune tâche datée pour aujourd’hui.');

  const meals = mealsOfDay(s, today);
  if (meals.length) lines.push('Repas du jour : ' + meals.join(' ; '));

  const list = mainShopList(s);
  const toBuy = list ? (s.shop || []).filter((i) => i.listId === list.id && i.state === 'a-prendre').length : 0;
  lines.push(`Courses à prendre : ${toBuy} article(s).`);
  return lines.join('\n');
}

export function coursesListe(ctx: McpCtx, listName?: string): string {
  const s = state();
  const list = resolveShopList(s, listName);
  if (!list) {
    const noms = (s.shopLists || []).map((l) => l.name).join(', ');
    return listName ? `Liste « ${listName} » inconnue. Listes disponibles : ${noms || 'aucune'}.` : 'Aucune liste de courses.';
  }
  void ctx;
  const items = (s.shop || []).filter((i) => i.listId === list.id && i.state === 'a-prendre');
  if (!items.length) return `Rien à prendre dans « ${list.name} ».`;
  const aisleName = (id: string): string => (s.aisles || []).find((a) => a.id === id)?.name || 'Divers';
  const aislePos = (id: string): number => (s.aisles || []).find((a) => a.id === id)?.position ?? 999;
  const byAisle = new Map<string, string[]>();
  for (const it of items.sort((a, b) => aislePos(a.aisleId) - aislePos(b.aisleId))) {
    const key = aisleName(it.aisleId);
    (byAisle.get(key) ?? byAisle.set(key, []).get(key)!).push(`${it.name}${it.qty ? ' (' + it.qty + ')' : ''} [${it.id}]`);
  }
  const out = [`Courses à prendre dans « ${list.name} » (${items.length}) :`];
  for (const [rayon, arts] of byAisle) out.push(`- ${rayon} : ${arts.join(', ')}`);
  return out.join('\n');
}

export function tachesListe(ctx: McpCtx, quand: 'aujourdhui' | 'semaine' | 'retard' | 'toutes' | 'terminees' = 'toutes', listName?: string): string {
  const s = state();
  const today = todayParis();
  const weekEnd = addDaysIso(today, 7);
  let lists = visibleTaskLists(s, ctx);
  if (listName) {
    const n = norm(listName);
    lists = lists.filter((l) => norm(l.name) === n);
    if (!lists.length) return `Liste « ${listName} » inconnue ou privée.`;
  }
  const listIds = new Set(lists.map((l) => l.id));
  const listName2 = (id: string): string => lists.find((l) => l.id === id)?.name || 'Tâches';
  // Les terminées, les plus récentes d'abord : de quoi en rouvrir ou en supprimer une.
  if (quand === 'terminees') {
    const fini = (s.tasks || []).filter((t) => listIds.has(t.listId) && t.done && !t.parentId)
      .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 20);
    if (!fini.length) return 'Aucune tâche terminée.';
    return `Tâches terminées (${fini.length} récentes) :\n` + fini.map((t) => `- ${t.text} [${t.id}] (${listName2(t.listId)})`).join('\n');
  }
  // Le rang de chaque tâche dans l'ordre manuel de sa liste (racines ouvertes),
  // pour que l'assistant puisse dire « elle est en troisième position » et
  // raisonner sur un déplacement relatif.
  const rang = new Map<string, { r: number; t: number }>();
  for (const l of lists) {
    const ordered = orderedOf(s.tasks || [], l.id).filter((t) => !t.done && !t.parentId);
    ordered.forEach((t, i) => rang.set(t.id, { r: i + 1, t: ordered.length }));
  }
  let tasks = (s.tasks || []).filter((t) => listIds.has(t.listId) && !t.done && !t.parentId);
  if (quand === 'aujourdhui') tasks = tasks.filter((t) => t.due === today);
  else if (quand === 'semaine') tasks = tasks.filter((t) => t.due && t.due >= today && t.due <= weekEnd);
  else if (quand === 'retard') tasks = tasks.filter((t) => t.due && t.due < today);
  if (!tasks.length) return 'Aucune tâche ouverte pour ce filtre.';
  // « retard » et « aujourd'hui » répondent à une question de temps : elles
  // restent chronologiques. « Toutes » sort dans l'ordre manuel du foyer.
  if (quand === 'retard' || quand === 'aujourdhui' || quand === 'semaine') {
    tasks = tasks.slice().sort((a, b) => (a.due || '').localeCompare(b.due || '') || (a.time || '99').localeCompare(b.time || '99'));
  } else {
    tasks = tasks.slice().sort(byOrd);
  }
  const line = (t: (typeof tasks)[number]): string => {
    const who = t.who.length ? ' · ' + t.who.map((id) => memberName(s, id)).join(', ') : '';
    const due = t.due ? ' · échéance ' + frDate(t.due, t.due < today || t.due.slice(0, 4) !== today.slice(0, 4)) + (t.time ? ' ' + t.time : '') : '';
    const serie = t.rec ? ' · série' : '';
    const rg = rang.get(t.id);
    const pos = rg ? `${rg.r}/${rg.t} ` : '';
    return `- ${pos}${t.text} [${t.id}] (${listName2(t.listId)})${due}${who}${serie}`;
  };
  return `Tâches (${tasks.length}), rang sur total dans l’ordre du foyer :\n` + tasks.map(line).join('\n');
}

/** Occurrences d'un événement (récurrence simple) entre deux dates, en lignes prêtes à afficher. */
function eventsBetween(s: HouseholdState, from: string, to: string): { date: string; line: string }[] {
  const out: { date: string; line: string }[] = [];
  const who = (e: EventItem): string => (e.who || []).map((id) => memberName(s, id)).filter(Boolean).join(', ');
  for (const e of s.events || []) {
    for (const date of eventOccurrences(e, from, to)) {
      const heure = e.allDay || !e.time || e.time === '—' ? 'journée' : e.time + (e.endTime ? '-' + e.endTime : '');
      const w = who(e);
      out.push({ date, line: `${frDate(date)} ${heure} ${e.title}${e.place ? ' @ ' + e.place : ''}${w ? ' (' + w + ')' : ''} [${e.id}]` });
    }
  }
  // Créneaux d'emploi du temps publiés à l'agenda.
  for (const occ of publishedSlotOccurrences(s.sched || [], from, to)) {
    const w = occ.who.map((id) => memberName(s, id)).filter(Boolean).join(', ');
    out.push({ date: occ.date, line: `${frDate(occ.date)} ${occ.start}${occ.end ? '-' + occ.end : ''} ${occ.label}${w ? ' (' + w + ')' : ''} [créneau]` });
  }
  return out.sort((a, b) => (a.date + a.line).localeCompare(b.date + b.line));
}

/** Les dates où un événement tombe dans [from,to]. Récurrence simple, bornée par la fenêtre. */
function eventOccurrences(e: EventItem, from: string, to: string): string[] {
  if (!e.date) return [];
  const dates: string[] = [];
  const step = (d: string): string | null => {
    switch (e.recur) {
      case 'daily': return addDaysIso(d, 1);
      case 'weekday': { let n = addDaysIso(d, 1); while ([0, 6].includes(new Date(n + 'T00:00:00Z').getUTCDay())) n = addDaysIso(n, 1); return n; }
      case 'weekly': return addDaysIso(d, 7);
      case 'biweekly': return addDaysIso(d, 14);
      case 'monthly': { const [y, m, day] = d.split('-').map(Number); const nm = m === 12 ? 1 : m + 1; const ny = m === 12 ? y + 1 : y; return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
      default: return null;
    }
  };
  let cur = e.date;
  let guard = 0;
  while (cur <= to && guard++ < 800) {
    if (cur >= from) {
      // Un événement multi-jours non récurrent couvre sa plage : on le rattache à
      // la première date visible de la fenêtre.
      dates.push(cur < from ? from : cur);
    }
    const next = step(cur);
    if (!next) {
      // Non récurrent : couvre-t-il la fenêtre par sa plage `end` ?
      if (!dates.length && e.end && e.end >= from && e.date <= to) dates.push(e.date < from ? from : e.date);
      break;
    }
    cur = next;
  }
  return dates;
}

export function agenda(_ctx: McpCtx, du?: string, au?: string): string {
  const s = state();
  const from = du && /^\d{4}-\d{2}-\d{2}$/.test(du) ? du : todayParis();
  const to = au && /^\d{4}-\d{2}-\d{2}$/.test(au) ? au : addDaysIso(from, 7);
  const items = eventsBetween(s, from, to);
  if (!items.length) return `Rien à l’agenda du ${frDate(from, true)} au ${frDate(to, true)}.`;
  return `Agenda du ${frDate(from, true)} au ${frDate(to, true)} :\n` + items.map((i) => '- ' + i.line).join('\n');
}

function mealsOfDay(s: HouseholdState, date: string): string[] {
  const out: string[] = [];
  for (const slot of MEAL_SLOTS) {
    const v = s.meals?.[`${date}-${slot.key}`];
    if (!v?.items?.length) continue;
    const parts = v.items.map((it) => it.rid ? (s.recipes || []).find((r) => r.id === it.rid)?.name || 'recette' : (it.text || '')).filter(Boolean);
    if (parts.length) out.push(`${slot.label} : ${parts.join(', ')}`);
  }
  return out;
}

export function repasSemaine(_ctx: McpCtx, semaine?: string): string {
  const s = state();
  const start = semaine && /^\d{4}-\d{2}-\d{2}$/.test(semaine) ? semaine : todayParis();
  const out: string[] = [`Repas du ${frDate(start, true)} au ${frDate(addDaysIso(start, 6), true)} :`];
  let any = false;
  for (let i = 0; i < 7; i++) {
    const day = addDaysIso(start, i);
    const meals = mealsOfDay(s, day);
    if (meals.length) { any = true; out.push(`- ${frDate(day)} : ${meals.join(' ; ')}`); }
  }
  return any ? out.join('\n') : `Aucun repas planifié du ${frDate(start, true)} au ${frDate(addDaysIso(start, 6), true)}.`;
}

export function recettesChercher(_ctx: McpCtx, q: string): string {
  const s = state();
  const n = norm(q);
  if (!n) return 'Précisez ce que vous cherchez.';
  const hits = (s.recipes || []).filter((r) => norm(r.name).includes(n) || (r.ingr || []).some((i) => norm(i).includes(n))).slice(0, 20);
  if (!hits.length) return `Aucune recette ne correspond à « ${q} ».`;
  const line = (r: Recipe): string => {
    const t = [r.prepMin ? `prépa ${r.prepMin} min` : '', r.cookMin ? `cuisson ${r.cookMin} min` : '', r.portions ? `${r.portions} pers.` : ''].filter(Boolean).join(', ');
    return `- ${r.name} [${r.id}]${t ? ' (' + t + ')' : ''}`;
  };
  return `Recettes (${hits.length}) :\n` + hits.map(line).join('\n');
}

export function recetteDetail(_ctx: McpCtx, id: string): string {
  const s = state();
  const r = (s.recipes || []).find((x) => x.id === id);
  if (!r) return 'Recette introuvable.';
  const meta = [r.portions ? `${r.portions} personnes` : '', r.prepMin ? `préparation ${r.prepMin} min` : '', r.cookMin ? `cuisson ${r.cookMin} min` : ''].filter(Boolean).join(', ');
  const out = [`${r.name}${meta ? ' — ' + meta : ''}`];
  out.push('Ingrédients :', ...(r.ingr || []).map((i) => '- ' + i));
  out.push('Étapes :', ...(r.steps || []).map((st, i) => `${i + 1}. ${st}`));
  return out.join('\n');
}

export function membres(_ctx: McpCtx): string {
  const s = state();
  // Jamais les emails : seulement prénoms, identifiants et rôle.
  const line = (m: HouseholdState['members'][number]): string =>
    `- ${m.name} [${m.id}]${m.admin ? ' · admin' : ''}${m.enfant ? ' · enfant' : m.role ? ' · ' + m.role : ''}`;
  return 'Membres du foyer :\n' + s.members.map(line).join('\n');
}

// ---- Écriture ------------------------------------------------------------

export function coursesAjouter(ctx: McpCtx, articles: { nom: string; qte?: string; rayon?: string }[], listName?: string): string {
  const s = state();
  const list = resolveShopList(s, listName);
  if (!list) return listName ? `Liste « ${listName} » inconnue.` : 'Aucune liste de courses où ajouter.';
  const existing = new Set((s.shop || []).filter((i) => i.listId === list.id && i.state === 'a-prendre').map((i) => norm(i.name)));
  const at = new Date().toISOString();
  const ops: unknown[] = [];
  const ajoutes: string[] = [];
  const deja: string[] = [];
  for (const a of articles) {
    const nom = (a.nom || '').trim();
    if (!nom) continue;
    if (existing.has(norm(nom))) { deja.push(nom); continue; }
    existing.add(norm(nom));
    const aisle = resolveAisle(s, a.rayon);
    if (!aisle) return 'Aucun rayon disponible pour ranger l’article.';
    ops.push({ op: 'add', opId: genId('op'), id: genId('it'), name: nom, qty: (a.qte || '').trim(), aisleId: aisle.id, listId: list.id, by: ctx.memberId, via: ctx.via, at });
    ajoutes.push(nom + (a.qte ? ' (' + a.qte + ')' : ''));
  }
  if (ops.length) applyShoppingOps(ops);
  const parts: string[] = [];
  parts.push(ajoutes.length ? `Ajouté à « ${list.name} » : ${ajoutes.join(', ')}.` : 'Rien ajouté.');
  if (deja.length) parts.push(`Déjà présent (non ajouté) : ${deja.join(', ')}.`);
  return parts.join(' ');
}

export function coursesCocher(ctx: McpCtx, ids: string[]): string {
  const s = state();
  const known = new Set((s.shop || []).map((i) => i.id));
  const at = new Date().toISOString();
  const cible = ids.filter((id) => known.has(id));
  const inconnus = ids.filter((id) => !known.has(id));
  if (cible.length) applyShoppingOps(cible.map((id) => ({ op: 'set-state', opId: genId('op'), id, state: 'panier', by: ctx.memberId, via: ctx.via, at })));
  const parts = [`${cible.length} article(s) mis au panier.`];
  if (inconnus.length) parts.push(`Identifiants inconnus : ${inconnus.join(', ')}.`);
  return parts.join(' ');
}

export function tacheCreer(ctx: McpCtx, args: { texte: string; liste?: string; echeance?: string; heure?: string; pour?: string[]; note?: string; position?: 'debut' | 'fin' }): string {
  const s = state();
  const texte = (args.texte || '').trim();
  if (!texte) return 'Donnez l’intitulé de la tâche.';
  const lists = visibleTaskLists(s, ctx);
  let list = args.liste ? lists.find((l) => norm(l.name) === norm(args.liste!)) : lists.find((l) => l.kind === 'taches' && l.scope === 'shared') || lists.find((l) => l.kind === 'taches');
  if (!list) return args.liste ? `Liste « ${args.liste} » inconnue ou privée.` : 'Aucune liste de tâches disponible.';
  if (args.echeance && !/^\d{4}-\d{2}-\d{2}$/.test(args.echeance)) return 'Échéance illisible (attendu AAAA-MM-JJ).';
  if (args.heure && !/^\d{2}:\d{2}$/.test(args.heure)) return 'Heure illisible (attendu HH:MM).';
  const { ids, unknown } = resolveMembers(s, args.pour || []);
  const at = new Date().toISOString();
  const id = genId('t');
  const position = args.position === 'debut' ? 'debut' : 'fin';
  applyTaskOps([{
    op: 'add', opId: genId('op'), id, listId: list.id, text: texte,
    who: ids, due: args.echeance || null, time: args.heure || null, note: (args.note || '').trim() || undefined,
    position, by: ctx.memberId, via: ctx.via, at,
  }]);
  const ou = position === 'debut' ? ' en tête de liste' : '';
  const parts = [`Tâche créée dans « ${list.name} »${ou} : « ${texte} » [${id}]${args.echeance ? ' pour le ' + frDate(args.echeance, true) : ''}.`];
  if (unknown.length) parts.push(`Prénoms non reconnus (non affectés) : ${unknown.join(', ')}.`);
  return parts.join(' ');
}

export function tacheTerminer(ctx: McpCtx, id: string): string {
  const s = state();
  const t = (s.tasks || []).find((x) => x.id === id);
  if (!t) return 'Tâche introuvable.';
  if (t.rec) return 'Cette tâche revient régulièrement ; cochez-la dans Foyer, qui calcule la prochaine échéance.';
  if (t.done) return 'Cette tâche est déjà terminée.';
  applyTaskOps([{ op: 'done', opId: genId('op'), id, by: ctx.memberId, via: ctx.via, at: new Date().toISOString() }]);
  return `Tâche « ${t.text} » marquée terminée.`;
}

/**
 * Range une tâche par rapport à une autre, sans toucher à son échéance. La tâche
 * à déplacer et la référence se désignent par intitulé (à la voix) ou par
 * identifiant. En cas d'ambiguïté, on rend les candidats plutôt que de deviner.
 */
export function tacheDeplacer(ctx: McpCtx, args: { tache: string; avant?: string; apres?: string; position?: 'debut' | 'fin' }): string {
  const s = state();
  const moved = resolveTask(s, ctx, args.tache || '');
  if ('none' in moved) return `Aucune tâche ouverte ne correspond à « ${args.tache} ».`;
  if ('candidates' in moved) return candidatsTexte(s, args.tache, moved.candidates);

  let target: { avant?: string; apres?: string; position?: 'debut' | 'fin' };
  if (args.position === 'debut' || args.position === 'fin') {
    target = { position: args.position };
  } else if ((args.avant && args.avant.trim()) || (args.apres && args.apres.trim())) {
    const refQuery = (args.avant || args.apres)!.trim();
    const ref = resolveTask(s, ctx, refQuery);
    if ('none' in ref) return `Aucune tâche de référence ne correspond à « ${refQuery} ».`;
    if ('candidates' in ref) return candidatsTexte(s, refQuery, ref.candidates);
    if (ref.id === moved.id) return 'La tâche à déplacer et la référence sont la même : rien à faire.';
    target = args.avant ? { avant: ref.id } : { apres: ref.id };
  } else {
    return 'Précisez où ranger la tâche : « avant » ou « après » une autre tâche, ou une position (« début » ou « fin »).';
  }

  const res = applyTaskOps([{ op: 'move', opId: genId('op'), id: moved.id, ...target, by: ctx.memberId, via: ctx.via, at: new Date().toISOString() }]);
  if (res.skipped.length) return res.skipped[0].reason;

  // Le rang après coup, dans l'ordre manuel de la liste.
  const after = state();
  const t = (after.tasks || []).find((x) => x.id === moved.id)!;
  const ordered = orderedOf(after.tasks || [], t.listId).filter((x) => !x.done && !x.parentId);
  const r = ordered.findIndex((x) => x.id === t.id) + 1;
  const listName = after.taskLists?.find((l) => l.id === t.listId)?.name || 'Tâches';
  return `Tâche « ${t.text} » rangée : ${r} sur ${ordered.length} dans « ${listName} » (échéance inchangée).`;
}

export function evenementCreer(ctx: McpCtx, args: { titre: string; date: string; heure?: string; fin?: string; lieu?: string; pour?: string[]; recurrence?: string }): string {
  const titre = (args.titre || '').trim();
  if (!titre) return 'Donnez le titre de l’événement.';
  if (!isDate(args.date)) return 'Date illisible (attendu AAAA-MM-JJ).';
  if (args.heure && !isTime(args.heure)) return 'Heure illisible (attendu HH:MM).';
  if (args.fin && !isTime(args.fin)) return 'Heure de fin illisible (attendu HH:MM).';
  const recur = args.recurrence && args.recurrence !== 'none' ? args.recurrence : '';
  if (recur && !RECUR_VALUES.includes(recur as (typeof RECUR_VALUES)[number])) return `Récurrence inconnue. Valeurs : ${RECUR_VALUES.join(', ')}.`;
  const id = genId('e');
  // Les événements n'ont pas d'opérations ciblées : on écrit dans le document, en
  // une transaction (better-sqlite3 est synchrone, aucune écriture ne s'y glisse).
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const { ids, unknown } = resolveMembers(s, args.pour || []);
    const ev: EventItem = {
      id, date: args.date, time: args.heure || '', title: titre, who: ids, recur,
      end: null, endTime: args.fin || null, place: (args.lieu || '').trim() || null,
      allDay: !args.heure, by: ctx.memberId, at: new Date().toISOString(),
    };
    s.events = [...(s.events || []), ev];
    saveHousehold(s);
    return unknown.length ? ` Prénoms non reconnus : ${unknown.join(', ')}.` : '';
  })();
  const rl = recur ? ', ' + (RECUR_LABEL[recur] || recur) : '';
  return `Événement créé : « ${titre} » le ${frDate(args.date, true)}${args.heure ? ' à ' + args.heure : ''}${rl} [${id}].${out}`;
}

export function evenementModifier(ctx: McpCtx, args: { id: string; titre?: string; date?: string; heure?: string; fin?: string; lieu?: string; pour?: string[]; recurrence?: string }): string {
  if (args.date !== undefined && !isDate(args.date)) return 'Date illisible (attendu AAAA-MM-JJ).';
  if (args.heure && !isTime(args.heure)) return 'Heure illisible (attendu HH:MM).';
  if (args.fin && !isTime(args.fin)) return 'Heure de fin illisible (attendu HH:MM).';
  if (args.recurrence && args.recurrence !== 'none' && !RECUR_VALUES.includes(args.recurrence as (typeof RECUR_VALUES)[number])) return `Récurrence inconnue. Valeurs : ${RECUR_VALUES.join(', ')}.`;
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const ev = resolveEvent(s, args.id);
    if (!ev) return 'INTROUVABLE';
    let extra = '';
    if (args.titre !== undefined) { const t = args.titre.trim(); if (!t) return 'VIDE'; ev.title = t; }
    if (args.date !== undefined) ev.date = args.date;
    // L'heure : une chaîne vide bascule en journée entière, une heure la repose.
    if (args.heure !== undefined) { ev.time = args.heure; ev.allDay = !args.heure; }
    if (args.fin !== undefined) ev.endTime = args.fin || null;
    if (args.lieu !== undefined) ev.place = args.lieu.trim() || null;
    if (args.recurrence !== undefined) ev.recur = args.recurrence === 'none' ? '' : args.recurrence;
    if (args.pour !== undefined) { const { ids, unknown } = resolveMembers(s, args.pour); ev.who = ids; if (unknown.length) extra = ` Prénoms non reconnus : ${unknown.join(', ')}.`; }
    ev.upBy = ctx.memberId; ev.upAt = new Date().toISOString();
    saveHousehold(s);
    return `« ${ev.title} » le ${frDate(ev.date, true)}${extra}`;
  })();
  if (out === 'INTROUVABLE') return 'Événement introuvable (identifiant).';
  if (out === 'VIDE') return 'Le titre ne peut pas être vide.';
  return `Événement modifié : ${out}`;
}

export function evenementSupprimer(_ctx: McpCtx, id: string): string {
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const ev = resolveEvent(s, id);
    if (!ev) return 'INTROUVABLE';
    s.events = (s.events || []).filter((e) => e.id !== id);
    saveHousehold(s);
    return ev.title;
  })();
  return out === 'INTROUVABLE' ? 'Événement introuvable (identifiant).' : `Événement supprimé : « ${out} ».`;
}

export async function recetteImporter(ctx: McpCtx, url: string): Promise<string> {
  if (effectiveSetting('recipeImport') !== true) return 'L’import de recette est désactivé dans les réglages du foyer.';
  const cible = (url || '').trim();
  if (!cible) return 'Donnez l’adresse de la page de la recette.';
  try {
    const page = await fetchPublic(cible, 'text/html,application/xhtml+xml');
    if (page.contentType && !/html|xml/.test(page.contentType)) return 'Ce lien ne pointe pas sur une page web.';
    const { recipe, warnings } = parseRecipePage(page.body.toString('utf8'), page.url);
    const id = genId('r');
    db.transaction(() => {
      const s = getHousehold().state as HouseholdState;
      const r: Recipe = {
        id, name: recipe.name, level: '', color: '#E56B4E',
        portions: recipe.portions, prepMin: recipe.prepMin, cookMin: recipe.cookMin,
        source: recipe.source, ingr: recipe.ingr, steps: recipe.steps,
      };
      s.recipes = [...(s.recipes || []), r];
      saveHousehold(s);
    })();
    void ctx;
    const warn = warnings.length ? ' Remarques : ' + warnings.join(' ') : '';
    return `Recette importée : « ${recipe.name} » [${id}] (${recipe.ingr.length} ingrédients, ${recipe.steps.length} étapes). La photo n’est pas importée par cette voie.${warn}`;
  } catch (e) {
    if (e instanceof FetchError || e instanceof ImportError) return 'Import refusé : ' + (e as Error).message;
    return 'Erreur pendant l’import : ' + (e as Error).message;
  }
}

// ---- Courses : état, modification, retrait, listes -----------------------

const SHOP_STATE_LABEL: Record<string, string> = { 'a-prendre': 'remis à prendre', panier: 'mis au panier', indisponible: 'marqués introuvables' };

/** Change l'état d'articles : à prendre, au panier, ou introuvable. */
export function coursesEtat(ctx: McpCtx, ids: string[], etat: string): string {
  if (!SHOP_STATE_LABEL[etat]) return 'État inconnu (valeurs : a-prendre, panier, indisponible).';
  const s = state();
  const known = new Set((s.shop || []).map((i) => i.id));
  const cible = ids.filter((id) => known.has(id));
  const inconnus = ids.filter((id) => !known.has(id));
  const at = new Date().toISOString();
  if (cible.length) applyShoppingOps(cible.map((id) => ({ op: 'set-state', opId: genId('op'), id, state: etat, by: ctx.memberId, via: ctx.via, at })));
  const parts = [`${cible.length} article(s) ${SHOP_STATE_LABEL[etat]}.`];
  if (inconnus.length) parts.push(`Identifiants inconnus : ${inconnus.join(', ')}.`);
  return parts.join(' ');
}

/** Modifie un article : nom, quantité, rayon, ou liste. */
export function coursesModifier(ctx: McpCtx, args: { id: string; nom?: string; qte?: string; rayon?: string; liste?: string }): string {
  const s = state();
  const it = (s.shop || []).find((i) => i.id === args.id);
  if (!it) return 'Article introuvable (identifiant).';
  const op: Record<string, unknown> = { op: 'edit', opId: genId('op'), id: args.id, by: ctx.memberId, via: ctx.via, at: new Date().toISOString() };
  if (args.nom !== undefined) { const n = args.nom.trim(); if (!n) return 'Le nom ne peut pas être vide.'; op['name'] = n; }
  if (args.qte !== undefined) op['qty'] = args.qte.trim();
  if (args.rayon !== undefined) { const a = resolveAisle(s, args.rayon); if (!a) return 'Rayon introuvable.'; op['aisleId'] = a.id; }
  if (args.liste !== undefined) { const l = resolveShopList(s, args.liste); if (!l) return `Liste « ${args.liste} » inconnue.`; op['listId'] = l.id; }
  const res = applyShoppingOps([op]);
  if (res.skipped.length) return res.skipped[0].reason;
  return `Article « ${(op['name'] as string) || it.name} » modifié.`;
}

/** Retire des articles d'une liste de courses, par identifiants. */
export function coursesRetirer(ctx: McpCtx, ids: string[]): string {
  const s = state();
  const known = new Map((s.shop || []).map((i) => [i.id, i.name]));
  const cible = ids.filter((id) => known.has(id));
  const inconnus = ids.filter((id) => !known.has(id));
  const at = new Date().toISOString();
  if (cible.length) applyShoppingOps(cible.map((id) => ({ op: 'remove', opId: genId('op'), id, by: ctx.memberId, via: ctx.via, at })));
  const noms = cible.map((id) => known.get(id)).filter(Boolean);
  const parts = [`${cible.length} article(s) retiré(s)${noms.length ? ' : ' + noms.join(', ') : ''}.`];
  if (inconnus.length) parts.push(`Identifiants inconnus : ${inconnus.join(', ')}.`);
  return parts.join(' ');
}

export function rayons(_ctx: McpCtx): string {
  const s = state();
  const a = (s.aisles || []).slice().sort((x, y) => (x.position ?? 999) - (y.position ?? 999));
  if (!a.length) return 'Aucun rayon.';
  return 'Rayons du magasin (pour ranger un article) :\n' + a.map((x) => '- ' + x.name).join('\n');
}

export function listeCoursesCreer(_ctx: McpCtx, args: { nom: string; couleur?: string; icone?: string }): string {
  const nom = (args.nom || '').trim();
  if (!nom) return 'Donnez le nom de la liste.';
  const id = genId('cl');
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    if ((s.shopLists || []).some((l) => norm(l.name) === norm(nom))) return 'DOUBLON';
    const list: ShopList = { id, name: nom, color: (args.couleur || '#7A9B76'), icon: (args.icone || 'panier') };
    s.shopLists = [...(s.shopLists || []), list];
    saveHousehold(s);
    return '';
  })();
  return out === 'DOUBLON' ? `Une liste de courses « ${nom} » existe déjà.` : `Liste de courses créée : « ${nom} » [${id}].`;
}

export function listeCoursesRenommer(_ctx: McpCtx, args: { liste: string; nom: string }): string {
  const nom = (args.nom || '').trim();
  if (!nom) return 'Donnez le nouveau nom.';
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const l = args.liste ? (s.shopLists || []).find((x) => norm(x.name) === norm(args.liste)) : null;
    if (!l) return 'INTROUVABLE';
    const old = l.name; l.name = nom;
    saveHousehold(s);
    return old;
  })();
  return out === 'INTROUVABLE' ? `Liste « ${args.liste} » inconnue.` : `Liste de courses renommée : « ${out} » vers « ${nom} ».`;
}

export function listeCoursesSupprimer(_ctx: McpCtx, liste: string): string {
  const out = db.transaction((): { r: string; dropped?: number } => {
    const before = getHousehold().state as HouseholdState;
    const l = liste ? (before.shopLists || []).find((x) => norm(x.name) === norm(liste)) : null;
    if (!l) return { r: 'INTROUVABLE' };
    const next = structuredClone(before) as HouseholdState;
    next.shopLists = (next.shopLists || []).filter((x) => x.id !== l.id);
    const rec = preserveShopping(next as unknown as Record<string, unknown>, before as unknown as Record<string, unknown>);
    saveHousehold(next);
    return { r: l.name, dropped: rec.dropped };
  })();
  if (out.r === 'INTROUVABLE') return `Liste « ${liste} » inconnue.`;
  return `Liste de courses supprimée : « ${out.r} »${out.dropped ? ` (avec ${out.dropped} article(s))` : ''}.`;
}

// ---- Tâches : modifier, rouvrir, supprimer, listes -----------------------

export function tacheModifier(ctx: McpCtx, args: { tache: string; texte?: string; echeance?: string; heure?: string; pour?: string[]; note?: string; liste?: string }): string {
  const s = state();
  const r = resolveTaskAny(s, ctx, args.tache || '');
  if ('none' in r) return `Aucune tâche ne correspond à « ${args.tache} ».`;
  if ('candidates' in r) return candidatsTexte(s, args.tache, r.candidates);
  if (args.echeance && !isDate(args.echeance)) return 'Échéance illisible (attendu AAAA-MM-JJ, ou vide pour l’enlever).';
  if (args.heure && !isTime(args.heure)) return 'Heure illisible (attendu HH:MM).';
  const op: Record<string, unknown> = { op: 'edit', opId: genId('op'), id: r.id, by: ctx.memberId, via: ctx.via, at: new Date().toISOString() };
  let extra = '';
  if (args.texte !== undefined) { const t = args.texte.trim(); if (!t) return 'L’intitulé ne peut pas être vide.'; op['text'] = t; }
  if (args.echeance !== undefined) op['due'] = args.echeance ? args.echeance : null;
  if (args.heure !== undefined) op['time'] = args.heure ? args.heure : null;
  if (args.note !== undefined) op['note'] = args.note.trim();
  if (args.pour !== undefined) { const { ids, unknown } = resolveMembers(s, args.pour); op['who'] = ids; if (unknown.length) extra = ` Prénoms non reconnus : ${unknown.join(', ')}.`; }
  if (args.liste !== undefined) { const l = visibleTaskLists(s, ctx).find((x) => norm(x.name) === norm(args.liste!)); if (!l) return `Liste « ${args.liste} » inconnue ou privée.`; op['listId'] = l.id; }
  const res = applyTaskOps([op]);
  if (res.skipped.length) return res.skipped[0].reason;
  const t = (state().tasks || []).find((x) => x.id === r.id)!;
  return `Tâche modifiée : « ${t.text} » [${t.id}]${t.due ? ', échéance ' + frDate(t.due, true) : ''}.${extra}`;
}

export function tacheRouvrir(ctx: McpCtx, tache: string): string {
  const s = state();
  const r = resolveTaskAny(s, ctx, tache || '');
  if ('none' in r) return `Aucune tâche ne correspond à « ${tache} ».`;
  if ('candidates' in r) return candidatsTexte(s, tache, r.candidates);
  const t = (s.tasks || []).find((x) => x.id === r.id)!;
  if (!t.done) return 'Cette tâche est déjà ouverte.';
  const res = applyTaskOps([{ op: 'reopen', opId: genId('op'), id: r.id, ...(t.rec && t.due ? { occ: t.due } : {}), by: ctx.memberId, via: ctx.via, at: new Date().toISOString() }]);
  if (res.skipped.length) return res.skipped[0].reason;
  return `Tâche rouverte : « ${t.text} ».`;
}

export function tacheSupprimer(ctx: McpCtx, tache: string): string {
  const s = state();
  const r = resolveTaskAny(s, ctx, tache || '');
  if ('none' in r) return `Aucune tâche ne correspond à « ${tache} ».`;
  if ('candidates' in r) return candidatsTexte(s, tache, r.candidates);
  const t = (s.tasks || []).find((x) => x.id === r.id)!;
  const subs = (s.tasks || []).filter((x) => x.parentId === r.id);
  const at = new Date().toISOString();
  const ops = [...subs, t].map((x) => ({ op: 'remove', opId: genId('op'), id: x.id, by: ctx.memberId, via: ctx.via, at }));
  const res = applyTaskOps(ops);
  if (res.skipped.length) return res.skipped[0].reason;
  return `Tâche supprimée : « ${t.text} »${subs.length ? ` (avec ${subs.length} sous-tâche(s))` : ''}.`;
}

const LIST_KINDS = ['taches', 'corvees', 'checklist', 'preparation'] as const;

export function listeTachesCreer(ctx: McpCtx, args: { nom: string; type?: string; couleur?: string; icone?: string; prive?: boolean }): string {
  const nom = (args.nom || '').trim();
  if (!nom) return 'Donnez le nom de la liste.';
  const kind = (args.type && (LIST_KINDS as readonly string[]).includes(args.type) ? args.type : 'taches') as ListKind;
  const id = genId('l');
  db.transaction((): void => {
    const s = getHousehold().state as HouseholdState;
    const list: TaskList = { id, name: nom, color: (args.couleur || '#E56B4E'), icon: (args.icone || 'checklist'), kind, scope: args.prive ? ctx.memberId : 'shared', position: (s.taskLists || []).length };
    s.taskLists = [...(s.taskLists || []), list];
    saveHousehold(s);
  })();
  return `Liste de tâches créée : « ${nom} »${args.prive ? ' (privée)' : ''} [${id}].`;
}

export function listeTachesRenommer(ctx: McpCtx, args: { liste: string; nom: string }): string {
  const nom = (args.nom || '').trim();
  if (!nom) return 'Donnez le nouveau nom.';
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const l = (s.taskLists || []).find((x) => norm(x.name) === norm(args.liste) && (x.scope === 'shared' || x.scope === ctx.memberId));
    if (!l) return 'INTROUVABLE';
    const old = l.name; l.name = nom;
    saveHousehold(s);
    return old;
  })();
  return out === 'INTROUVABLE' ? `Liste « ${args.liste} » inconnue ou privée.` : `Liste de tâches renommée : « ${out} » vers « ${nom} ».`;
}

export function listeTachesArchiver(ctx: McpCtx, args: { liste: string; archivee: boolean }): string {
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const l = (s.taskLists || []).find((x) => norm(x.name) === norm(args.liste) && (x.scope === 'shared' || x.scope === ctx.memberId));
    if (!l) return 'INTROUVABLE';
    l.archived = args.archivee;
    saveHousehold(s);
    return l.name;
  })();
  return out === 'INTROUVABLE' ? `Liste « ${args.liste} » inconnue ou privée.` : `Liste « ${out} » ${args.archivee ? 'archivée' : 'restaurée'}.`;
}

export function listeTachesSupprimer(ctx: McpCtx, liste: string): string {
  const out = db.transaction((): { r: string; dropped?: number } => {
    const before = getHousehold().state as HouseholdState;
    const l = (before.taskLists || []).find((x) => norm(x.name) === norm(liste) && (x.scope === 'shared' || x.scope === ctx.memberId));
    if (!l) return { r: 'INTROUVABLE' };
    const next = structuredClone(before) as HouseholdState;
    next.taskLists = (next.taskLists || []).filter((x) => x.id !== l.id);
    const rec = preserveTasks(next as unknown as Record<string, unknown>, before as unknown as Record<string, unknown>);
    saveHousehold(next);
    return { r: l.name, dropped: rec.dropped };
  })();
  if (out.r === 'INTROUVABLE') return `Liste « ${liste} » inconnue ou privée.`;
  return `Liste de tâches supprimée : « ${out.r} »${out.dropped ? ` (avec ${out.dropped} tâche(s))` : ''}.`;
}

// ---- Repas ----------------------------------------------------------------

export function repasDefinir(_ctx: McpCtx, args: { date: string; creneau: string; recettes?: string[]; texte?: string[]; couverts?: number; absents?: string[] }): string {
  if (!isDate(args.date)) return 'Date illisible (attendu AAAA-MM-JJ).';
  const key = resolveMealKey(args.creneau || '');
  if (!key) return 'Créneau inconnu (matin, midi ou soir).';
  const s = state();
  const items: MealItem[] = [];
  const inconnues: string[] = [];
  for (const q of args.recettes || []) { const r = resolveRecipe(s, q); if (r) items.push({ rid: r.id }); else inconnues.push(q); }
  for (const line of args.texte || []) { const t = (line || '').trim(); if (t) items.push({ text: t }); }
  if (!items.length) return inconnues.length ? `Aucune recette reconnue (${inconnues.join(', ')}).` : 'Donnez au moins une recette ou un plat en texte.';
  const { ids: away, unknown } = resolveMembers(s, args.absents || []);
  const pax = typeof args.couverts === 'number' && args.couverts > 0 ? Math.floor(args.couverts) : null;
  db.transaction((): void => {
    const st = getHousehold().state as HouseholdState;
    const v: MealValue = { items, ...(pax ? { pax } : {}), ...(away.length ? { away } : {}) };
    st.meals = { ...(st.meals || {}), [`${args.date}-${key}`]: v };
    saveHousehold(st);
  })();
  const noms = items.map((it) => it.rid ? (s.recipes || []).find((r) => r.id === it.rid)?.name || 'recette' : it.text).join(', ');
  const parts = [`${MEAL_LABEL[key]} du ${frDate(args.date, true)} : ${noms}${pax ? `, ${pax} couverts` : ''}.`];
  if (inconnues.length) parts.push(`Recettes non trouvées : ${inconnues.join(', ')}.`);
  if (unknown.length) parts.push(`Absents non reconnus : ${unknown.join(', ')}.`);
  return parts.join(' ');
}

export function repasVider(_ctx: McpCtx, args: { date: string; creneau: string }): string {
  if (!isDate(args.date)) return 'Date illisible (attendu AAAA-MM-JJ).';
  const key = resolveMealKey(args.creneau || '');
  if (!key) return 'Créneau inconnu (matin, midi ou soir).';
  const mealKey = `${args.date}-${key}`;
  const out = db.transaction((): string => {
    const st = getHousehold().state as HouseholdState;
    if (!st.meals || !st.meals[mealKey]) return 'VIDE';
    const next = { ...st.meals }; delete next[mealKey]; st.meals = next;
    // L'événement d'agenda éventuellement posé pour ce repas part avec lui.
    st.events = (st.events || []).filter((e) => e.mealKey !== mealKey);
    saveHousehold(st);
    return 'OK';
  })();
  return out === 'VIDE' ? `Rien de prévu pour ${MEAL_LABEL[key]} du ${frDate(args.date, true)}.` : `${MEAL_LABEL[key]} du ${frDate(args.date, true)} vidé.`;
}

// ---- Recettes : créer, modifier, supprimer -------------------------------

const posInt = (v?: number): number | null => (typeof v === 'number' && v > 0 ? Math.floor(v) : null);

export function recetteCreer(_ctx: McpCtx, args: { nom: string; ingredients?: string[]; etapes?: string[]; portions?: number; prepMin?: number; cookMin?: number; source?: string }): string {
  const nom = (args.nom || '').trim();
  if (!nom) return 'Donnez le nom de la recette.';
  const ingr = (args.ingredients || []).map((x) => (x || '').trim()).filter(Boolean);
  const steps = (args.etapes || []).map((x) => (x || '').trim()).filter(Boolean);
  const id = genId('r');
  db.transaction((): void => {
    const s = getHousehold().state as HouseholdState;
    const r: Recipe = { id, name: nom, level: '', color: '#E56B4E', ingr, steps, portions: posInt(args.portions), prepMin: posInt(args.prepMin), cookMin: posInt(args.cookMin), source: (args.source || '').trim() || null };
    s.recipes = [...(s.recipes || []), r];
    saveHousehold(s);
  })();
  return `Recette créée : « ${nom} » [${id}] (${ingr.length} ingrédient(s), ${steps.length} étape(s)).`;
}

export function recetteModifier(_ctx: McpCtx, args: { id: string; nom?: string; ingredients?: string[]; etapes?: string[]; portions?: number; prepMin?: number; cookMin?: number; source?: string }): string {
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const r = resolveRecipe(s, args.id || '');
    if (!r) return 'INTROUVABLE';
    if (args.nom !== undefined) { const n = args.nom.trim(); if (!n) return 'VIDE'; r.name = n; }
    if (args.ingredients !== undefined) r.ingr = args.ingredients.map((x) => (x || '').trim()).filter(Boolean);
    if (args.etapes !== undefined) r.steps = args.etapes.map((x) => (x || '').trim()).filter(Boolean);
    if (args.portions !== undefined) r.portions = posInt(args.portions);
    if (args.prepMin !== undefined) r.prepMin = posInt(args.prepMin);
    if (args.cookMin !== undefined) r.cookMin = posInt(args.cookMin);
    if (args.source !== undefined) r.source = args.source.trim() || null;
    saveHousehold(s);
    return r.name;
  })();
  if (out === 'INTROUVABLE') return 'Recette introuvable.';
  if (out === 'VIDE') return 'Le nom ne peut pas être vide.';
  return `Recette modifiée : « ${out} ».`;
}

export function recetteSupprimer(_ctx: McpCtx, id: string): string {
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const r = resolveRecipe(s, id || '');
    if (!r) return 'INTROUVABLE';
    s.recipes = (s.recipes || []).filter((x) => x.id !== r.id);
    saveHousehold(s);
    return r.name;
  })();
  return out === 'INTROUVABLE' ? 'Recette introuvable.' : `Recette supprimée : « ${out} ».`;
}

// ---- Emploi du temps ------------------------------------------------------

export function emploiDuTemps(_ctx: McpCtx, args: { membre?: string; jour?: string }): string {
  const s = state();
  let slots = (s.sched || []).slice();
  if (args.membre) { const m = s.members.find((x) => norm(x.name) === norm(args.membre!)); if (!m) return `Membre « ${args.membre} » inconnu.`; slots = slots.filter((sl) => sl.who.includes(m.id)); }
  let dow: number | null = null;
  if (args.jour) { dow = resolveDow(args.jour); if (!dow) return 'Jour inconnu (lundi..dimanche, ou 1..7).'; slots = slots.filter((sl) => sl.dow === dow); }
  if (!slots.length) return 'Aucun créneau à l’emploi du temps pour ce filtre.';
  slots.sort((a, b) => a.dow - b.dow || a.start.localeCompare(b.start));
  const line = (sl: SchedSlot): string => {
    const w = sl.who.map((id) => memberName(s, id)).filter(Boolean).join(', ');
    const quand = sl.rec === 'once' ? `ponctuel${sl.date ? ' le ' + frDate(sl.date, true) : ''}` : `chaque ${DOW_LABEL[sl.dow]}${(sl.interval || 1) > 1 ? ` (une semaine sur ${sl.interval})` : ''}`;
    const when = sl.when && sl.when !== 'always' ? ` · ${WHEN_LABEL[sl.when] || sl.when}` : '';
    const flags = `${sl.away ? ' · hors foyer' : ''}${sl.sync ? ' · publié à l’agenda' : ''}`;
    return `- ${DOW_LABEL[sl.dow]} ${sl.start}${sl.end ? '-' + sl.end : ''} ${sl.label} [${sl.id}]${w ? ' (' + w + ')' : ''} · ${sl.k} · ${quand}${when}${flags}`;
  };
  return `Emploi du temps (${slots.length} créneau(x)) :\n` + slots.map(line).join('\n');
}

export function creneauCreer(_ctx: McpCtx, args: { label: string; pour: string[]; jour?: string; debut: string; fin?: string; type?: string; recurrence?: string; date?: string; unesur?: number; du?: string; au?: string; quand?: string; hors_foyer?: boolean; publier?: boolean }): string {
  const label = (args.label || '').trim();
  if (!label) return 'Donnez l’intitulé du créneau.';
  if (!isTime(args.debut)) return 'Heure de début illisible (attendu HH:MM).';
  if (args.fin && !isTime(args.fin)) return 'Heure de fin illisible (attendu HH:MM).';
  const rec = args.recurrence === 'once' ? 'once' : 'weekly';
  let dow: number | null;
  let date: string | undefined;
  if (rec === 'once') {
    if (!isDate(args.date)) return 'Pour un créneau ponctuel, donnez la date (AAAA-MM-JJ).';
    date = args.date; dow = dowOf(args.date!);
  } else {
    dow = resolveDow(args.jour); if (!dow) return 'Jour inconnu (lundi..dimanche, ou 1..7).';
  }
  const k = args.type && (SCHED_TYPES as readonly string[]).includes(args.type) ? args.type : 'autre';
  const when = args.quand && (SCHED_WHEN as readonly string[]).includes(args.quand) ? args.quand : 'always';
  if (args.du && !isDate(args.du)) return 'Début de période illisible (AAAA-MM-JJ).';
  if (args.au && !isDate(args.au)) return 'Fin de période illisible (AAAA-MM-JJ).';
  const s0 = state();
  const { ids, unknown } = resolveMembers(s0, args.pour || []);
  if (!ids.length) return 'Précisez au moins un membre (prénom) pour le créneau.' + (unknown.length ? ` Non reconnus : ${unknown.join(', ')}.` : '');
  const id = genId('s');
  db.transaction((): void => {
    const s = getHousehold().state as HouseholdState;
    const slot: SchedSlot = {
      id, who: ids, dow: dow!, start: args.debut, end: args.fin || '', label, k, rec,
      ...(rec === 'once' && date ? { date } : {}),
      ...(args.unesur && args.unesur > 1 ? { interval: Math.floor(args.unesur) } : {}),
      ...(args.du ? { from: args.du } : {}),
      ...(args.au ? { until: args.au } : {}),
      ...(when !== 'always' ? { when } : {}),
      ...(args.hors_foyer ? { away: true } : {}),
      ...(args.publier ? { sync: true } : {}),
    };
    s.sched = [...(s.sched || []), slot];
    saveHousehold(s);
  })();
  const quand = rec === 'once' ? `le ${frDate(date!, true)}` : `chaque ${DOW_LABEL[dow!]}`;
  const parts = [`Créneau créé : « ${label} » ${quand} ${args.debut}${args.fin ? '-' + args.fin : ''}${args.publier ? ', publié à l’agenda' : ''} [${id}].`];
  if (unknown.length) parts.push(`Prénoms non reconnus : ${unknown.join(', ')}.`);
  return parts.join(' ');
}

export function creneauModifier(_ctx: McpCtx, args: { id: string; label?: string; pour?: string[]; jour?: string; debut?: string; fin?: string; type?: string; date?: string; unesur?: number; du?: string; au?: string; quand?: string; hors_foyer?: boolean; publier?: boolean }): string {
  if (args.debut && !isTime(args.debut)) return 'Heure de début illisible (HH:MM).';
  if (args.fin && !isTime(args.fin)) return 'Heure de fin illisible (HH:MM).';
  if (args.date && !isDate(args.date)) return 'Date illisible (AAAA-MM-JJ).';
  if (args.du && !isDate(args.du)) return 'Début de période illisible (AAAA-MM-JJ).';
  if (args.au && !isDate(args.au)) return 'Fin de période illisible (AAAA-MM-JJ).';
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const sl = resolveSlot(s, args.id);
    if (!sl) return 'INTROUVABLE';
    let extra = '';
    if (args.label !== undefined) { const l = args.label.trim(); if (!l) return 'VIDE'; sl.label = l; }
    if (args.debut !== undefined) sl.start = args.debut;
    if (args.fin !== undefined) sl.end = args.fin || '';
    if (args.type !== undefined && (SCHED_TYPES as readonly string[]).includes(args.type)) sl.k = args.type;
    if (args.jour !== undefined) { const d = resolveDow(args.jour); if (!d) return 'JOUR'; sl.dow = d; }
    if (args.date !== undefined && args.date) { sl.date = args.date; sl.dow = dowOf(args.date); sl.rec = 'once'; }
    if (args.unesur !== undefined) sl.interval = args.unesur > 1 ? Math.floor(args.unesur) : undefined;
    if (args.du !== undefined) sl.from = args.du || undefined;
    if (args.au !== undefined) sl.until = args.au || null;
    if (args.quand !== undefined) sl.when = (SCHED_WHEN as readonly string[]).includes(args.quand) ? args.quand : 'always';
    if (args.hors_foyer !== undefined) sl.away = !!args.hors_foyer;
    if (args.publier !== undefined) sl.sync = !!args.publier;
    if (args.pour !== undefined) { const { ids, unknown } = resolveMembers(s, args.pour); if (!ids.length) return 'AUCUN'; sl.who = ids; if (unknown.length) extra = ` Prénoms non reconnus : ${unknown.join(', ')}.`; }
    saveHousehold(s);
    return `${sl.label}\u0001${extra}`;
  })();
  if (out === 'INTROUVABLE') return 'Créneau introuvable (identifiant).';
  if (out === 'VIDE') return 'L’intitulé ne peut pas être vide.';
  if (out === 'JOUR') return 'Jour inconnu (lundi..dimanche, ou 1..7).';
  if (out === 'AUCUN') return 'Le créneau doit garder au moins un membre.';
  const [lab, extra] = out.split('\u0001');
  return `Créneau modifié : « ${lab} ».${extra || ''}`;
}

export function creneauSupprimer(_ctx: McpCtx, id: string): string {
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const sl = resolveSlot(s, id);
    if (!sl) return 'INTROUVABLE';
    s.sched = (s.sched || []).filter((x) => x.id !== id);
    saveHousehold(s);
    return sl.label;
  })();
  return out === 'INTROUVABLE' ? 'Créneau introuvable (identifiant).' : `Créneau supprimé : « ${out} ».`;
}
