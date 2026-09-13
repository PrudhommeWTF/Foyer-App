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
import { HouseholdState, EventItem, Recipe } from '../models';
import { applyShoppingOps } from '../shopping/repo';
import { applyTaskOps } from '../tasks/repo';
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

export function tachesListe(ctx: McpCtx, quand: 'aujourdhui' | 'semaine' | 'retard' | 'toutes' = 'toutes', listName?: string): string {
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
  let tasks = (s.tasks || []).filter((t) => listIds.has(t.listId) && !t.done && !t.parentId);
  if (quand === 'aujourdhui') tasks = tasks.filter((t) => t.due === today);
  else if (quand === 'semaine') tasks = tasks.filter((t) => t.due && t.due >= today && t.due <= weekEnd);
  else if (quand === 'retard') tasks = tasks.filter((t) => t.due && t.due < today);
  if (!tasks.length) return 'Aucune tâche ouverte pour ce filtre.';
  const line = (t: (typeof tasks)[number]): string => {
    const who = t.who.length ? ' · ' + t.who.map((id) => memberName(s, id)).join(', ') : '';
    const due = t.due ? ' · échéance ' + frDate(t.due, t.due < today || t.due.slice(0, 4) !== today.slice(0, 4)) + (t.time ? ' ' + t.time : '') : '';
    const serie = t.rec ? ' · série' : '';
    return `- ${t.text} [${t.id}] (${listName2(t.listId)})${due}${who}${serie}`;
  };
  return `Tâches (${tasks.length}) :\n` + tasks.map(line).join('\n');
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

export function tacheCreer(ctx: McpCtx, args: { texte: string; liste?: string; echeance?: string; heure?: string; pour?: string[]; note?: string }): string {
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
  applyTaskOps([{
    op: 'add', opId: genId('op'), id, listId: list.id, text: texte,
    who: ids, due: args.echeance || null, time: args.heure || null, note: (args.note || '').trim() || undefined,
    by: ctx.memberId, via: ctx.via, at,
  }]);
  const parts = [`Tâche créée dans « ${list.name} » : « ${texte} » [${id}]${args.echeance ? ' pour le ' + frDate(args.echeance, true) : ''}.`];
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

export function evenementCreer(ctx: McpCtx, args: { titre: string; date: string; heure?: string; fin?: string; lieu?: string; pour?: string[] }): string {
  const titre = (args.titre || '').trim();
  if (!titre) return 'Donnez le titre de l’événement.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date || '')) return 'Date illisible (attendu AAAA-MM-JJ).';
  if (args.heure && !/^\d{2}:\d{2}$/.test(args.heure)) return 'Heure illisible (attendu HH:MM).';
  if (args.fin && !/^\d{2}:\d{2}$/.test(args.fin)) return 'Heure de fin illisible (attendu HH:MM).';
  const id = genId('e');
  // Les événements n'ont pas d'opérations ciblées : on écrit dans le document, en
  // une transaction (better-sqlite3 est synchrone, aucune écriture ne s'y glisse).
  const out = db.transaction((): string => {
    const s = getHousehold().state as HouseholdState;
    const { ids, unknown } = resolveMembers(s, args.pour || []);
    const ev: EventItem = {
      id, date: args.date, time: args.heure || '', title: titre, who: ids, recur: '',
      end: null, endTime: args.fin || null, place: (args.lieu || '').trim() || null,
      allDay: !args.heure, by: ctx.memberId, at: new Date().toISOString(),
    };
    s.events = [...(s.events || []), ev];
    saveHousehold(s);
    return unknown.length ? ` Prénoms non reconnus : ${unknown.join(', ')}.` : '';
  })();
  return `Événement créé : « ${titre} » le ${frDate(args.date, true)}${args.heure ? ' à ' + args.heure : ''} [${id}].${out}`;
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
