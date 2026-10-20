// Exercice « Orthographe » : une phrase à trou et des mots qui se prononcent
// pareil (a / à, son / sont) ; l'enfant touche le bon. Les phrases viennent
// d'une liste du contenu de l'exercice, une ligne par phrase : le trou entre
// accolades, le bon mot d'abord, puis les pièges (« Il {a/à} un chat. »).
// Celles livrées en configuration (backend/config/revisions/orthographe/), ou
// celles qu'un parent saisit. Aucune phrase ni aucune règle n'est ici.
//
// Un item est une phrase ; la clé est la ligne entière, ce qui permet au
// serveur de vérifier qu'une question vient de la liste et que le bon mot est
// bien le sien. L'ordre des boutons est tiré à chaque question.
import { Checked, ExerciseContext, ExerciseDef, Params, listOf } from './contract';

export interface OrthographeQuestion { before: string; after: string; options: string[]; shown: string[]; }

const clean = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/’/g, '\'');
const fold = (s: string): string => clean(s).toLocaleLowerCase('fr');
const KEY = 'orth:';
const OPTION = /^[\p{L}'][\p{L}' -]{0,19}$/u;
/** Une ligne de liste (« Il {a/à} un chat. »), ou null si elle n'a pas cette forme : un seul trou, de deux à quatre mots distincts. */
export function readLine(line: string): Omit<OrthographeQuestion, 'shown'> | null {
  const m = /^([^{}]*)\{([^{}]+)\}([^{}]*)$/.exec(clean(line));
  if (!m || !(m[1] + m[3]).trim()) return null;
  const options = m[2].split('/').map(clean);
  if (options.length < 2 || options.length > 4 || !options.every((o) => OPTION.test(o)) || new Set(options.map(fold)).size !== options.length) return null;
  return { before: m[1].trimEnd(), after: m[3].trimStart(), options };
}
/** Recoller trois morceaux de phrase : sans espace après une apostrophe (« C'est ») ni devant un point, une virgule ou une parenthèse fermante ; « ? » et « ! » gardent leur espace, à la française. */
const glue = (...parts: string[]): string => parts.filter(Boolean).reduce((a, b) => (/'$/.test(a) || /^[.,)]/.test(b) ? a + b : `${a} ${b}`));
const lineOf = (q: Pick<OrthographeQuestion, 'before' | 'after' | 'options'>): string => clean(glue(q.before, `{${q.options.join('/')}}`, q.after));
const keyOf = (q: Pick<OrthographeQuestion, 'before' | 'after' | 'options'>): string => KEY + lineOf(q);
const sentence = (q: Pick<OrthographeQuestion, 'before' | 'after' | 'options'>, word: string): string => clean(glue(q.before, word, q.after));
const listFor = (p: Params, ctx: ExerciseContext) => listOf(ctx, p['liste']);
const linesOf = (p: Params, ctx: ExerciseContext) => {
  const seen = new Set<string>();
  return (listFor(p, ctx)?.items ?? []).map(readLine).filter((q): q is NonNullable<typeof q> => !!q && !seen.has(keyOf(q)) && !!seen.add(keyOf(q)));
};
const shuffle = <T>(xs: T[], rand: () => number): T[] => {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};

export const ORTHOGRAPHE: ExerciseDef<OrthographeQuestion> = {
  id: 'orthographe',
  label: 'Orthographe',
  matiere: 'francais',
  icon: 'check',
  ageMin: 7,
  desc: 'Une phrase à trou et des mots qui se prononcent pareil (« a » ou « à », « son » ou « sont ») : l’enfant touche le bon. Une liste livrée, ou celle donnée par la maîtresse.',
  input: 'choix',
  prompt: 'texte',
  view: 'liste',
  params: [
    { key: 'liste', type: 'content', label: 'Liste de phrases', item: 'phrase', items: 'phrases', default: '' },
  ],

  universe: (p, ctx) => linesOf(p, ctx).map(keyOf),
  question(key, _p, rand) {
    const q = readLine(key.slice(KEY.length)) ?? { before: '', after: '', options: ['', ''] };
    return { ...q, shown: shuffle(q.options, rand) };
  },
  parse(raw) {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (typeof o['before'] !== 'string' || typeof o['after'] !== 'string' || !Array.isArray(o['options']) || !Array.isArray(o['shown'])) return null;
    const q = readLine(glue(String(o['before']), `{${(o['options'] as unknown[]).map(String).join('/')}}`, String(o['after'])));
    const shown = (o['shown'] as unknown[]).map((x) => clean(String(x)));
    return q && shown.length === q.options.length && [...shown].sort().join('/') === [...q.options].sort().join('/') ? { ...q, shown } : null;
  },
  itemKey: keyOf,
  itemLabel(key) { const q = readLine(key.slice(KEY.length)); return q ? sentence(q, q.options[0]) : key; },
  text: (q) => sentence(q, q.options[0]),
  ask: (q) => ({ before: q.before, after: q.after }),
  choices: (q) => q.shown,
  /** Les mots qui se confondent (« a / à »), en minuscules et dans l'ordre alphabétique : la même paire d'une phrase à l'autre, majuscule ou non. */
  groups(key) { const q = readLine(key.slice(KEY.length)); return q ? [q.options.map(fold).sort((x, y) => x.localeCompare(y, 'fr')).join(' / ')] : []; },

  check: (q, given): Checked => ({ ok: fold(given) === fold(q.options[0]), expected: q.options[0] }),

  /** Les phrases de la liste, justes, dans l'ordre. */
  learn: (p, ctx) => linesOf(p, ctx).map((q) => ({ ...q, shown: q.options })),
  spoken: (q) => sentence(q, q.options[0]),
  summary(p, ctx) {
    const l = listFor(p, ctx); const n = linesOf(p, ctx).length;
    return l ? `La liste « ${l.label} » (${n} phrase${n > 1 ? 's' : ''})` : 'Aucune liste de phrases';
  },
};
