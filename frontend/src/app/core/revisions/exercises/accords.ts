// Exercice « Féminin et pluriel » : « un cheval → des … », l'enfant écrit
// « chevaux » au clavier. Les mots viennent d'une liste du contenu de
// l'exercice, une ligne par mot : le mot de départ, « > », le mot attendu avec
// son déterminant (« un cheval > des chevaux », « un lion > une lionne »,
// « petit > petite »). Celles livrées en configuration
// (backend/config/revisions/accords/), ou celles qu'un parent saisit. Aucun mot
// ni aucune règle d'accord n'est ici.
//
// Un item est une ligne ; la clé la porte, mot attendu compris. Le déterminant
// du mot attendu (« des », « une ») est donné à l'écran, l'enfant écrit le mot ;
// l'écrire avec son déterminant est juste aussi. La correction suit la
// dictée : les accents comptent, pas les majuscules.
import { Checked, ExerciseContext, ExerciseDef, Params, listOf } from './contract';

export interface AccordQuestion { from: string; hint: string; word: string; }

const clean = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/’/g, '\'');
const fold = (s: string): string => clean(s).toLocaleLowerCase('fr');
const PART = /^[\p{L}][\p{L}' -]{0,38}$/u;
const KEY = 'acc:';
/** Le mot attendu coupé en déterminant donné (« des », « l' ») et mot à écrire. */
const splitTarget = (t: string): { hint: string; word: string } => {
  const m = /^(.*(?:\s|'))([^\s']+)$/u.exec(t);
  return m ? { hint: m[1], word: m[2] } : { hint: '', word: t };
};
/** Une ligne de liste (« un cheval > des chevaux »), ou null si elle n'a pas cette forme. */
export function readLine(line: string): AccordQuestion | null {
  const parts = clean(line).split('>').map(clean);
  if (parts.length !== 2 || !parts.every((x) => PART.test(x))) return null;
  const { hint, word } = splitTarget(parts[1]);
  return fold(parts[0]) === fold(parts[1]) ? null : { from: parts[0], hint, word };
}
const target = (q: AccordQuestion): string => q.hint + q.word;
const lineOf = (q: AccordQuestion): string => `${q.from} > ${target(q)}`;
const keyOf = (q: AccordQuestion): string => KEY + lineOf(q);
const fromKey = (key: string): AccordQuestion | null => (key.startsWith(KEY) ? readLine(key.slice(KEY.length)) : null);
const listFor = (p: Params, ctx: ExerciseContext) => listOf(ctx, p['liste']);
const wordsOf = (p: Params, ctx: ExerciseContext): AccordQuestion[] => {
  const seen = new Set<string>();
  return (listFor(p, ctx)?.items ?? []).map(readLine).filter((q): q is AccordQuestion => !!q && !seen.has(keyOf(q)) && !!seen.add(keyOf(q)));
};

export const ACCORDS: ExerciseDef<AccordQuestion> = {
  id: 'accords',
  label: 'Féminin et pluriel',
  matiere: 'francais',
  icon: 'users',
  ageMin: 7,
  desc: 'Un mot et le déterminant de sa nouvelle forme (« un cheval → des … », « un lion → une … ») : l’enfant écrit le mot au clavier. Les accents comptent, pas les majuscules. Des listes livrées (féminin des noms, pluriels en -s et en -x, adjectifs), ou celle donnée par la maîtresse.',
  input: 'clavier',
  prompt: 'texte',
  view: 'liste',
  params: [
    { key: 'liste', type: 'content', label: 'Liste de mots', item: 'mot', items: 'mots', default: '',
      format: 'Un mot par ligne : le mot de départ, « > », puis le mot attendu avec son déterminant. Par exemple : un cheval > des chevaux' },
  ],

  universe: (p, ctx) => wordsOf(p, ctx).map(keyOf),
  question: (key) => fromKey(key) ?? { from: '', hint: '', word: '' },
  parse(raw) {
    const o = (raw ?? {}) as Record<string, unknown>;
    if (typeof o['from'] !== 'string' || typeof o['hint'] !== 'string' || typeof o['word'] !== 'string') return null;
    return readLine(`${o['from']} > ${o['hint']}${o['word']}`);
  },
  itemKey: keyOf,
  itemLabel(key) { const q = fromKey(key); return q ? `${q.from} → ${target(q)}` : key; },
  text: (q) => `${q.from} → ${target(q)}`,
  ask: (q) => ({ before: `${q.from} → ${q.hint.trimEnd()}`, after: '' }),
  /** Le déterminant demandé (« des … », « une … ») : il dit ce qui change. Sans déterminant, l'adjectif. */
  groups(key) { const q = fromKey(key); return q ? [q.hint ? `${fold(q.hint).trim()} …` : 'Sans déterminant'] : []; },

  /** Le mot, ou le mot avec son déterminant. */
  check(q, given): Checked {
    const g = fold(given);
    return { ok: !!g && (g === fold(q.word) || g === fold(target(q))), expected: q.word };
  },

  learn: wordsOf,
  spoken: (q) => `${q.from}, ${target(q)}`,
  summary(p, ctx) {
    const l = listFor(p, ctx); const n = wordsOf(p, ctx).length;
    return l ? `La liste « ${l.label} » (${n} mot${n > 1 ? 's' : ''})` : 'Aucune liste de mots';
  },
};
