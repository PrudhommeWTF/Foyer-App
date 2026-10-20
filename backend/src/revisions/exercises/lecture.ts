// Exercice « Lecture » : un petit texte à lire, une question, des réponses à
// toucher (« Léo mange une pomme. », « Que mange Léo ? »). La compréhension,
// pas le déchiffrage à voix haute : l'enfant lit seul, sans voix ni clavier.
// Les textes viennent d'une liste du contenu de l'exercice, une ligne par
// question : le texte, la question, puis les réponses, séparés par « | », la
// bonne réponse d'abord et les pièges après des « / » (« Léo mange une pomme.
// | Que mange Léo ? | une pomme / une poire / un gâteau »). Celles livrées en
// configuration (backend/config/revisions/lecture/), ou celles qu'un parent
// saisit. Aucun texte ni aucune question n'est ici.
//
// Un item est une question ; la clé est la ligne entière, ce qui permet au
// serveur de vérifier qu'une question vient de la liste et que la bonne
// réponse est bien la sienne. Plusieurs questions sur un même texte se
// regroupent au suivi. L'ordre des boutons est tiré à chaque question.
import { Checked, ExerciseContext, ExerciseDef, Params, listOf } from './contract';

export interface LectureQuestion { passage: string; question: string; options: string[]; shown: string[]; }
type Line = Omit<LectureQuestion, 'shown'>;

const clean = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/’/g, '\'');
const fold = (s: string): string => clean(s).toLocaleLowerCase('fr');
const KEY = 'lect:';
const OPTION = /^[\p{L}\p{N}'][\p{L}\p{N}' ,.-]{0,29}$/u;
/** Une ligne de liste (« texte | question | bonne / piège »), ou null si elle n'a pas cette forme : de deux à quatre réponses distinctes. */
export function readLine(line: string): Line | null {
  const parts = clean(line).split('|').map(clean);
  if (parts.length !== 3 || !parts[0] || !parts[1] || /[{}/]/.test(parts[0] + parts[1])) return null;
  const options = parts[2].split('/').map(clean);
  if (options.length < 2 || options.length > 4 || !options.every((o) => OPTION.test(o)) || new Set(options.map(fold)).size !== options.length) return null;
  return { passage: parts[0], question: parts[1], options };
}
const lineOf = (q: Line): string => `${q.passage} | ${q.question} | ${q.options.join(' / ')}`;
const keyOf = (q: Line): string => KEY + lineOf(q);
const fromKey = (key: string): Line | null => readLine(key.slice(KEY.length));
const listFor = (p: Params, ctx: ExerciseContext) => listOf(ctx, p['liste']);
const linesOf = (p: Params, ctx: ExerciseContext): Line[] => {
  const seen = new Set<string>();
  return (listFor(p, ctx)?.items ?? []).map(readLine).filter((q): q is Line => !!q && !seen.has(keyOf(q)) && !!seen.add(keyOf(q)));
};
const shuffle = <T>(xs: T[], rand: () => number): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
/** Le début du texte, pour nommer un groupe au suivi. */
const short = (s: string): string => (s.length > 30 ? s.slice(0, 29).trimEnd() + '…' : s);

export const LECTURE: ExerciseDef<LectureQuestion> = {
  id: 'lecture',
  label: 'Lecture',
  matiere: 'francais',
  icon: 'recettes',
  ageMin: 6,
  desc: 'Un petit texte à lire, une question, la bonne réponse à toucher (« Léo mange une pomme. Que mange Léo ? »). La compréhension, en lisant seul. Des textes livrés, ou ceux qu’un parent écrit.',
  input: 'choix',
  prompt: 'passage',
  view: 'liste',
  params: [
    { key: 'liste', type: 'content', label: 'Liste de textes', item: 'question', items: 'questions', default: '', lines: true,
      format: 'Une question par ligne : le texte, la question, puis les réponses, séparés par « | » ; la bonne réponse d’abord, les pièges après des « / ». Par exemple : Léo mange une pomme. | Que mange Léo ? | une pomme / une poire / un gâteau' },
  ],

  universe: (p, ctx) => linesOf(p, ctx).map(keyOf),
  question(key, _p, rand) {
    const q = fromKey(key) ?? { passage: '', question: '', options: ['', ''] };
    return { ...q, shown: shuffle(q.options, rand) };
  },
  parse(raw) {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (typeof o['passage'] !== 'string' || typeof o['question'] !== 'string' || !Array.isArray(o['options']) || !Array.isArray(o['shown'])) return null;
    const q = readLine(`${o['passage']} | ${o['question']} | ${(o['options'] as unknown[]).map(String).join(' / ')}`);
    const shown = (o['shown'] as unknown[]).map((x) => clean(String(x)));
    return q && shown.length === q.options.length && [...shown].sort().join('/') === [...q.options].sort().join('/') ? { ...q, shown } : null;
  },
  itemKey: keyOf,
  itemLabel(key) { const q = fromKey(key); return q ? `${q.question} ${q.options[0]}` : key; },
  text: (q) => `${q.passage} ${q.question}`,
  passage: (q) => q.passage,
  ask: (q) => ({ before: q.question, after: '' }),
  choices: (q) => q.shown,
  /** Le texte : les questions posées sur un même texte vont ensemble. */
  groups(key) { const q = fromKey(key); return q ? [short(q.passage)] : []; },

  check: (q, given): Checked => ({ ok: fold(given) === fold(q.options[0]), expected: q.options[0] }),

  summary(p, ctx) {
    const l = listFor(p, ctx); const n = linesOf(p, ctx).length;
    return l ? `La liste « ${l.label} » (${n} question${n > 1 ? 's' : ''})` : 'Aucune liste de textes';
  },
};
