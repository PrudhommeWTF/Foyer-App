// Les outils d'assistant du module Épopée. Même règle de visibilité que les
// routes : un enfant ne lit que sa besace (en demander une autre est refusé en
// clair), un adulte lit celles de tous les enfants. Les écritures sont réservées
// aux adultes et à un jeton `write` (marquées dans server.ts), et se limitent à
// ce qu'un parent fait d'un geste : donner un bravo, créditer un exploit
// convenu, répondre à un exploit signalé, noter une décision du conseil.
//
// Ce que l'assistant ne fait pas, exprès : enrôler un enfant (c'est l'alliance,
// qui se fait côte à côte), sceller un pacte, échanger un trésor, régler une
// routine, annuler une écriture. Ce sont des décisions à prendre avec l'enfant,
// devant l'écran. Les montants sont ceux du serveur, jamais ceux de la phrase.
import crypto from 'node:crypto';
import { getHousehold } from '../db';
import { HouseholdState, Member } from '../models';
import { log } from '../log';
import { addDays, mondayOf, parisDay, periodLabel } from '../revisions/bilan';
import { computeBilan, lines } from '../epopee/bilan';
import * as repo from '../epopee/repo';
import { BRAVO_MAX, NOTE_MAX, bravoEcus } from '../epopee/rules';
import type { McpCtx } from './tools';

const members = (): Member[] => (getHousehold().state as HouseholdState).members;
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const today = (): string => parisDay(new Date().toISOString());
const ecus = (n: number): string => `${n} écu${Math.abs(n) > 1 ? 's' : ''}`;
const nameOf = (id: string | null): string => members().find((m) => m.id === id)?.name ?? 'quelqu’un';
const KIND: Record<string, string> = { amorce: 'écus d’amorce', bravo: 'bravo', etape: 'étape de routine', exploit: 'exploit', echange: 'trésor échangé', annulation: 'annulation' };
const MOMENT: Record<string, string> = { matin: 'matin', journee: 'journée', soir: 'soir' };
const COUNCIL_MAX = 2000;

/**
 * Les enfants visés : `enfant` par son prénom (sans accents ni casse, début
 * accepté), sinon soi pour un enfant et les enfants du foyer pour un adulte.
 * Un enfant qui en demande un autre reçoit un refus explicite.
 */
function pick(ctx: McpCtx, enfant?: string): Member[] | string {
  const kids = members().filter((m) => m.enfant);
  if (!enfant?.trim()) {
    if (ctx.enfant) { const me = kids.find((m) => m.id === ctx.memberId); return me ? [me] : 'Membre introuvable.'; }
    return kids.length ? kids : 'Aucun enfant dans le foyer : l’Épopée est pour les enfants.';
  }
  const q = norm(enfant);
  const hits = kids.filter((m) => norm(m.name) === q || norm(m.name).startsWith(q));
  if (!hits.length) return `Aucun enfant ne s’appelle « ${enfant} » dans le foyer. Enfants : ${kids.map((m) => m.name).join(', ') || 'aucun'}.`;
  if (ctx.enfant && !hits.some((m) => m.id === ctx.memberId)) return 'Refusé : ce compte ne donne accès qu’à ce qui vous concerne.';
  return ctx.enfant ? hits.filter((m) => m.id === ctx.memberId) : hits;
}
/** Un seul enfant, enrôlé : ce qu'il faut pour écrire. */
function pickEnrolled(ctx: McpCtx, enfant?: string): Member | string {
  const who = pick(ctx, enfant);
  if (typeof who === 'string') return who;
  if (who.length !== 1) return `Plusieurs enfants possibles (${who.map((m) => m.name).join(', ')}) : précisez \`enfant\`.`;
  return repo.activeProfile(who[0].id) ? who[0] : `${who[0].name} n’est pas enrôlé dans l’Épopée. L’enrôlement se fait dans l’application, côte à côte avec lui (l’alliance), pas par l’assistant.`;
}
const notEnrolled = (m: Member): string => `${m.name} : pas enrôlé dans l’Épopée.`;

/** Les routines d'un enfant aujourd'hui : « Les préparatifs du matin (7 h 20) : 3 étapes sur 5, 1 pause ». */
function routineLines(memberId: string, detail: boolean): string[] {
  const day = today(), marks = new Map(repo.marksOf(memberId, day).map((x) => [x.step_id, x.status]));
  return repo.routinesOf(memberId).flatMap((r) => {
    const steps = repo.stepsOf(r.id), done = steps.filter((s) => marks.has(s.id)).length, d = repo.routineDay(r.id, day);
    const etat = d?.ended_at ? 'menée au bout aujourd’hui' : done ? `${done} étape${done > 1 ? 's' : ''} sur ${steps.length} aujourd’hui` : 'pas commencée aujourd’hui';
    const head = `- ${r.title} (${MOMENT[r.kind] ?? r.kind}, ${r.time.replace(':', ' h ')}) : ${etat}${d?.pauses ? `, ${d.pauses} pause${d.pauses > 1 ? 's' : ''} grain de sable` : ''}`;
    if (!detail) return [head];
    return [head, ...steps.map((s) => `    ${marks.get(s.id) === 'fait' ? '[fait]' : marks.get(s.id) === 'saute' ? '[passée]' : '[à faire]'} ${s.title} (${Math.max(1, Math.round(s.seconds / 60))} min, ${ecus(s.ecus)})`)];
  });
}

/** La besace d'un enfant : solde, plancher, quête, routines du jour, exploits qui attendent, dernières écritures. */
export function epopeeBesace(ctx: McpCtx, a: { enfant?: string }): string {
  const who = pick(ctx, a.enfant);
  if (typeof who === 'string') return who;
  return who.map((m) => {
    const p = repo.activeProfile(m.id);
    if (!p) return notEnrolled(m);
    const bal = repo.balanceOf(m.id), day = today();
    const quests = repo.openQuests(m.id), q = quests.find((x) => x.status === 'proposee' || x.status === 'active');
    const out = [`${m.name} : ${ecus(bal)} dans sa besace (dont ${p.floor} d’amorce, qui ne se reprennent pas).`];
    if (q) out.push(q.status === 'proposee' ? `Trésor visé, pacte à sceller dans l’application : « ${q.title} » (${ecus(q.cost)}).`
      : bal >= q.cost ? `Quête : « ${q.title} » (${ecus(q.cost)}), les écus sont là, il peut l’échanger.` : `Quête : « ${q.title} », encore ${ecus(q.cost - bal)} sur ${q.cost}${q.pact_date ? `, prévu le ${q.pact_date}` : ''}.`);
    for (const t of quests.filter((x) => x.status === 'atteinte')) out.push(`Trésor gagné, à vivre : « ${t.title} »${t.pact_date ? ` (prévu le ${t.pact_date})` : ''}.`);
    const pending = repo.requestsOf(m.id, day).filter((r) => r.status === 'attente');
    for (const r of pending) { const e = repo.getExploit(r.exploit_id); out.push(`Exploit signalé, en attente d’une réponse : « ${e?.title ?? '?'} » (+${ecus(e?.ecus ?? 0)}).`); }
    const routines = routineLines(m.id, false);
    if (routines.length) out.push('Routines :', ...routines);
    const all = repo.entriesOf(m.id), cancelled = new Set(all.map((e) => e.ref).filter(Boolean));
    const recent = all.filter((e) => e.kind !== 'annulation' && !cancelled.has(e.id)).slice(0, 8);
    if (recent.length) out.push('Dernières écritures :', ...recent.map((e) => `- ${parisDay(e.at)} : ${e.delta > 0 ? '+' : ''}${e.delta}, ${KIND[e.kind] ?? e.kind}${e.note ? ` « ${e.note} »` : ''}${e.by_member && e.by_member !== m.id ? ` (${nameOf(e.by_member)})` : ''}`));
    return out.join('\n');
  }).join('\n\n');
}

/** Les routines d'un enfant, étape par étape, avec ce qui est fait aujourd'hui. */
export function epopeeRoutines(ctx: McpCtx, a: { enfant?: string }): string {
  const who = pick(ctx, a.enfant);
  if (typeof who === 'string') return who;
  return who.map((m) => {
    if (!repo.activeProfile(m.id)) return notEnrolled(m);
    const l = routineLines(m.id, true);
    return l.length ? `${m.name}, ses routines :\n${l.join('\n')}` : `${m.name} : aucune routine. Elles se créent dans l’application.`;
  }).join('\n\n');
}

/** Ce que le foyer a convenu : les exploits et leur valeur, les récompenses et leur prix. */
export function epopeeCatalogue(): string {
  const ex = repo.exploits(), rw = repo.rewards();
  if (!ex.length && !rw.length) return 'Aucun exploit ni récompense pour l’instant : ils arrivent quand un premier enfant est enrôlé.';
  return [
    ex.length ? 'Exploits convenus (ce qu’un parent crédite, ce qu’un enfant signale) :\n' + ex.map((e) => `- ${e.title} : +${ecus(e.ecus)}`).join('\n') : 'Aucun exploit convenu.',
    rw.length ? 'Récompenses de l’Armurerie :\n' + rw.map((r) => `- ${r.title} : ${ecus(r.cost)}${r.description ? ` (${r.description})` : ''}`).join('\n') : 'Aucune récompense.',
  ].join('\n\n');
}

/** Le bilan d'une semaine, pour le conseil de famille : celui de l'écran, mêmes phrases. */
export function epopeeBilan(ctx: McpCtx, a: { enfant?: string; semaine?: string }): string {
  const who = pick(ctx, a.enfant);
  if (typeof who === 'string') return who;
  const from = a.semaine === 'semaine-derniere' ? addDays(mondayOf(today()), -7) : mondayOf(today()), to = addDays(from, 6);
  const enrolled = who.filter((m) => repo.activeProfile(m.id));
  if (!enrolled.length) return 'Aucun enfant enrôlé dans l’Épopée.';
  const notes = repo.council(from)?.notes.trim();
  return [periodLabel(from, to) + '.', ...enrolled.map((m) => {
    const b = computeBilan(repo.weekData({ id: m.id, name: m.name }, from, to, today()));
    return [`${m.name} :`, ...lines(b).map((l) => '- ' + l), ...b.words.map((w) => `- Mot de la semaine : « ${w} »`)].join('\n');
  }), notes ? `Ce que le conseil de famille a décidé : ${notes}` : 'Rien de noté par le conseil de famille pour cette semaine.'].join('\n\n');
}

const who = (ctx: McpCtx): string => nameOf(ctx.memberId);

/** Un bravo spontané : 1 à 3 écus, avec quelques mots. */
export function epopeeBravo(ctx: McpCtx, a: { enfant?: string; ecus?: number; mot?: string }): string {
  const m = pickEnrolled(ctx, a.enfant);
  if (typeof m === 'string') return m;
  const n = bravoEcus(a.ecus ?? 1);
  if (n === null) return `Refusé : un bravo vaut de 1 à ${BRAVO_MAX} écus.`;
  const mot = (a.mot ?? '').trim();
  if (mot.length > NOTE_MAX) return `Refusé : le mot du bravo fait ${NOTE_MAX} caractères au plus.`;
  const done = repo.bravo(crypto.randomUUID(), m.id, n, mot || null, ctx.memberId);
  if (!done) return 'Le bravo n’a pas pu être enregistré.';
  log.info(`Épopée : bravo de ${who(ctx)} à ${m.name}, +${ecus(n)}${mot ? ` (« ${mot} »)` : ''}, par l’assistant (${ctx.via}).`);
  return `Bravo donné à ${m.name} : +${ecus(n)}${mot ? `, « ${mot} »` : ''}. Sa besace : ${ecus(repo.balanceOf(m.id))}. Il se reprend depuis le journal de l’application si c’était une erreur.`;
}

/** L'exploit convenu que nomme `exploit` (nom exact, début, ou fragment s'il n'y en a qu'un). */
function pickExploit(name?: string): repo.ExploitRow | string {
  const all = repo.exploits();
  if (!all.length) return 'Aucun exploit convenu dans le foyer : ils se créent dans l’application.';
  const list = all.map((e) => `${e.title} (+${e.ecus})`).join(', ');
  if (!name?.trim()) return `Précisez \`exploit\` : ${list}.`;
  const q = norm(name);
  const exact = all.filter((e) => norm(e.title) === q);
  const hits = exact.length ? exact : all.filter((e) => norm(e.title).startsWith(q)).length ? all.filter((e) => norm(e.title).startsWith(q)) : all.filter((e) => norm(e.title).includes(q));
  if (!hits.length) return `Aucun exploit convenu ne correspond à « ${name} ». Exploits : ${list}. Pour autre chose, epopee_bravo.`;
  return hits.length === 1 ? hits[0] : `Plusieurs exploits correspondent (${hits.map((e) => e.title).join(', ')}) : précisez.`;
}

/** Crédit express : un exploit convenu, à son montant convenu. */
export function epopeeExploitCrediter(ctx: McpCtx, a: { enfant?: string; exploit?: string }): string {
  const m = pickEnrolled(ctx, a.enfant);
  if (typeof m === 'string') return m;
  const e = pickExploit(a.exploit);
  if (typeof e === 'string') return e;
  if (!repo.creditExploit(crypto.randomUUID(), m.id, e, ctx.memberId)) return 'L’exploit n’a pas pu être crédité.';
  log.info(`Épopée : ${who(ctx)} crédite « ${e.title} » à ${m.name}, +${ecus(e.ecus)}, par l’assistant (${ctx.via}).`);
  return `« ${e.title} » crédité à ${m.name} : +${ecus(e.ecus)}. Sa besace : ${ecus(repo.balanceOf(m.id))}.`;
}

/** Répondre à un exploit signalé par un enfant : validé (l'écu est versé) ou « pas tout à fait » (rien n'est retiré). */
export function epopeeDemandeRepondre(ctx: McpCtx, a: { enfant?: string; exploit?: string; valider?: boolean }): string {
  const m = pickEnrolled(ctx, a.enfant);
  if (typeof m === 'string') return m;
  if (typeof a.valider !== 'boolean') return 'Précisez `valider` : true pour valider l’exploit, false pour « pas tout à fait ».';
  const pending = repo.requestsOf(m.id, today()).filter((r) => r.status === 'attente').map((r) => ({ r, e: repo.getExploit(r.exploit_id) })).filter((x): x is { r: repo.RequestRow; e: repo.ExploitRow } => !!x.e);
  if (!pending.length) return `${m.name} n’a signalé aucun exploit qui attende une réponse.`;
  const q = a.exploit?.trim() ? norm(a.exploit) : '';
  const hits = q ? pending.filter((x) => norm(x.e.title) === q || norm(x.e.title).includes(q)) : pending;
  if (hits.length !== 1) return `${hits.length ? 'Plusieurs exploits attendent' : 'Aucun exploit en attente ne correspond'} : ${pending.map((x) => x.e.title).join(', ')}. Précisez \`exploit\`.`;
  const { r, e } = hits[0];
  if (!repo.decideRequest(r, e, a.valider, ctx.memberId)) return 'Cette demande a déjà reçu sa réponse.';
  log.info(`Épopée : ${who(ctx)} ${a.valider ? `valide « ${e.title} » de ${m.name}, +${ecus(e.ecus)}` : `répond « pas tout à fait » à « ${e.title} » de ${m.name}`}, par l’assistant (${ctx.via}).`);
  return a.valider ? `« ${e.title} » validé pour ${m.name} : +${ecus(e.ecus)}. Sa besace : ${ecus(repo.balanceOf(m.id))}.`
    : `Réponse donnée à ${m.name} pour « ${e.title} » : pas tout à fait. Rien n’est retiré, il peut réessayer.`;
}

/** Une décision du conseil de famille, ajoutée aux notes de la semaine en cours (ou qui les remplace). */
export function epopeeConseilNoter(ctx: McpCtx, a: { note?: string; remplacer?: boolean }): string {
  const note = (a.note ?? '').trim();
  if (!note) return 'Précisez `note` : ce que la famille a décidé.';
  const week = mondayOf(today()), before = repo.council(week)?.notes.trim() ?? '';
  const next = a.remplacer || !before ? note : `${before}\n${note}`;
  if (next.length > COUNCIL_MAX) return `Refusé : les notes du conseil font ${COUNCIL_MAX} caractères au plus (${next.length} avec cet ajout). \`remplacer\` : true les réécrit.`;
  repo.setCouncil(week, next, ctx.memberId);
  log.info(`Épopée : notes du conseil de famille (semaine du ${week}) ${a.remplacer && before ? 'réécrites' : 'complétées'} par ${who(ctx)}, par l’assistant (${ctx.via}).`);
  return `Noté pour le conseil de famille de la ${periodLabel(week, addDays(week, 6)).replace(/^S/, 's')} :\n${next}`;
}
