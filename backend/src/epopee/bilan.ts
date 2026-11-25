// Le bilan d'une semaine d'Épopée, pour le conseil de famille du dimanche :
// ce qui a été gagné et comment, les routines menées au bout, les mots des
// parents, les trésors. Pur : les données lui sont données (voir repo.weekData),
// il ne lit ni la base ni l'horloge.
//
// Le ton est celui du module : on compte ce qui a été fait, jamais ce qui a
// manqué. Une semaine sans écu est une semaine calme, pas une faute.
import { DocBlock, documentPdf } from '../export/pdf';
import { addDays, periodLabel, weekDue } from '../revisions/bilan';
import type { Kind } from './rules';

export interface BilanEntry { kind: Kind; delta: number; note: string | null; cancelled: boolean; }
export interface BilanInput {
  member: { id: string; name: string }; from: string; to: string;
  /** Les écritures de la semaine (jours de Paris). */
  entries: BilanEntry[];
  /** Routines menées au bout, et combien pouvaient l'être (routines actives × jours écoulés depuis l'enrôlement). */
  routinesDone: number; routinesPossible: number;
  stepsSkipped: number; pauses: number;
  /** Trésors échangés et moments vécus dans la semaine, et la quête en cours à la fin. */
  won: string[]; lived: string[]; quest: { title: string; cost: number } | null;
  balance: number;
}
export interface Bilan {
  member: { id: string; name: string }; from: string; to: string; label: string;
  /** Les écus gagnés dans la semaine, hors amorce, et d'où ils viennent. */
  earned: number; etapes: number; exploits: number; bravos: number;
  routinesDone: number; routinesPossible: number; stepsSkipped: number; pauses: number;
  /** Les exploits de la semaine, du plus fréquent au moins fréquent, et les mots des bravos. */
  feats: { title: string; times: number }[]; words: string[];
  won: string[]; lived: string[]; quest: { title: string; cost: number; missing: number } | null;
  balance: number;
}

const n = (k: number, one: string, many: string): string => `${k} ${k > 1 ? many : one}`;

export function computeBilan(i: BilanInput): Bilan {
  const live = i.entries.filter((e) => !e.cancelled);
  const sum = (kind: Kind): number => live.filter((e) => e.kind === kind).reduce((s, e) => s + e.delta, 0);
  const etapes = sum('etape'), exploits = sum('exploit'), bravos = sum('bravo');
  const times = new Map<string, number>();
  for (const e of live) if (e.kind === 'exploit' && e.note) times.set(e.note, (times.get(e.note) ?? 0) + 1);
  return {
    member: i.member, from: i.from, to: i.to, label: periodLabel(i.from, i.to),
    earned: etapes + exploits + bravos, etapes, exploits, bravos,
    routinesDone: i.routinesDone, routinesPossible: i.routinesPossible, stepsSkipped: i.stepsSkipped, pauses: i.pauses,
    feats: [...times].map(([title, t]) => ({ title, times: t })).sort((a, b) => b.times - a.times || a.title.localeCompare(b.title, 'fr')),
    words: live.filter((e) => e.kind === 'bravo' && e.note).map((e) => e.note!),
    won: i.won, lived: i.lived, quest: i.quest ? { ...i.quest, missing: Math.max(0, i.quest.cost - i.balance) } : null,
    balance: i.balance,
  };
}

/** La semaine a-t-elle quelque chose à raconter ? */
export const eventful = (b: Bilan): boolean => !!(b.earned || b.routinesDone || b.won.length || b.lived.length || b.pauses);

/**
 * La phrase de la notification du dimanche : « Raphaël cette semaine : 23 écus
 * gagnés, 9 routines menées au bout sur 14, trésor gagné : Soirée cinéma. »
 * Une semaine sans rien le dit sans reproche.
 */
export function weekLine(b: Bilan): string {
  if (!eventful(b)) return `${b.member.name} cette semaine : une semaine calme, sans écu gagné. Demain est une nouvelle quête.`;
  const parts = [n(b.earned, 'écu gagné', 'écus gagnés')];
  if (b.routinesPossible) parts.push(`${n(b.routinesDone, 'routine menée', 'routines menées')} au bout sur ${b.routinesPossible}`);
  if (b.pauses) parts.push(n(b.pauses, 'pause grain de sable', 'pauses grain de sable'));
  if (b.won.length) parts.push(`${b.won.length > 1 ? 'trésors gagnés' : 'trésor gagné'} : ${b.won.join(', ')}`);
  else if (b.quest) parts.push(b.quest.missing ? `encore ${n(b.quest.missing, 'écu', 'écus')} pour « ${b.quest.title} »` : `« ${b.quest.title} » est à portée`);
  return `${b.member.name} cette semaine : ${parts.join(', ')}.`;
}

/** Les lignes du bilan d'un enfant, telles que l'écran et le PDF les montrent. */
export function lines(b: Bilan): string[] {
  if (!eventful(b)) return ['Une semaine calme, sans écu gagné. Ce n’est pas un reproche : on regarde ensemble ce qui aiderait.'];
  const out = [`${n(b.earned, 'écu gagné', 'écus gagnés')} : ${b.etapes} par les routines, ${b.exploits} par les exploits, ${b.bravos} par les bravos.`];
  if (b.routinesPossible) out.push(`${n(b.routinesDone, 'routine menée', 'routines menées')} au bout sur ${b.routinesPossible} possibles.`);
  const stops = [b.pauses ? n(b.pauses, 'pause grain de sable', 'pauses grain de sable') : '', b.stepsSkipped ? n(b.stepsSkipped, 'étape passée', 'étapes passées') : ''].filter(Boolean);
  if (stops.length) out.push(`${stops.join(', ')} : autant de fois où ça coinçait et où l’on a su s’arrêter.`);
  if (b.feats.length) out.push(`Exploits : ${b.feats.map((f) => (f.times > 1 ? `${f.title} (${f.times} fois)` : f.title)).join(', ')}.`);
  if (b.won.length) out.push(`${b.won.length > 1 ? 'Trésors gagnés' : 'Trésor gagné'} : ${b.won.join(', ')}.`);
  if (b.lived.length) out.push(`${b.lived.length > 1 ? 'Moments vécus' : 'Moment vécu'} : ${b.lived.join(', ')}.`);
  if (b.quest) out.push(b.quest.missing ? `Quête en cours : ${b.quest.title}, encore ${n(b.quest.missing, 'écu', 'écus')}.` : `Quête en cours : ${b.quest.title}, les écus sont là.`);
  out.push(`Besace en fin de semaine : ${n(b.balance, 'écu', 'écus')}.`);
  return out;
}

/** Les trois temps du conseil de famille, rappelés à l'écran et sur le PDF. */
export const RITUEL: { title: string; text: string }[] = [
  { title: 'Le tour des mercis', text: 'Chacun, enfants et parents, dit merci à un autre pour un geste de la semaine.' },
  { title: 'Ce qui a été gagné', text: 'On regarde les écus et les trésors, sans comparer les enfants entre eux.' },
  { title: 'Ce qu’on ajuste', text: 'Si une étape coince, on la simplifie ou on la déplace. On ne revient pas sur ce qui a manqué.' },
];

const frDate = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** Le bilan de la semaine en PDF, pour le conseil de famille : un bloc par enfant, puis les notes du conseil. */
export function councilPdf(bilans: Bilan[], from: string, notes: string, today: string): Buffer {
  const blocks: DocBlock[] = [];
  for (const b of bilans) {
    blocks.push({ h2: b.member.name });
    for (const l of lines(b)) blocks.push({ p: l });
    if (b.words.length) { blocks.push({ h3: 'Les mots de la semaine' }); for (const w of b.words) blocks.push({ p: `« ${w} »` }); }
  }
  if (!bilans.length) blocks.push({ p: 'Aucun enfant n’est enrôlé dans l’Épopée.' });
  blocks.push({ h2: 'Le conseil de famille' });
  for (const r of RITUEL) blocks.push({ p: `${r.title}. ${r.text}` });
  blocks.push({ h3: 'Ce qu’on a décidé' });
  blocks.push(notes.trim() ? { p: notes.trim() } : { p: 'Rien de noté pour cette semaine.', muted: true });
  return documentPdf({ title: 'Le bilan de la semaine', subtitle: periodLabel(from, addDays(from, 6)), blocks, footer: `Établi par Foyer le ${frDate(today)}.` });
}

/** Une notification de bilan à envoyer : la forme des rappels du planificateur (notify/reminders.ts). */
export interface WeeklyHit { key: string; taskId: string; memberIds: string[]; title: string; body: string; fireAt: string; }

/**
 * Les bilans du dimanche à envoyer maintenant : un par enfant enrôlé, aux
 * adultes donnés. La clé porte l'enfant et le lundi : une seule notification
 * par enfant et par semaine, même si le service redémarre ou que l'heure change.
 */
export function weeklyHits(kids: { id: string; name: string }[], adults: string[], nowWall: string, heure: string,
  bilanOf: (kid: { id: string; name: string }, from: string, to: string) => Bilan): WeeklyHit[] {
  const w = weekDue(nowWall, heure);
  if (!w || !adults.length) return [];
  return kids.map((k) => ({
    key: `epopee-hebdo|${k.id}|${w.from}`, taskId: k.id, memberIds: [...adults],
    title: `L’Épopée de ${k.name}`, body: weekLine(bilanOf(k, w.from, w.to)), fireAt: `${w.to}T${heure}`,
  }));
}
