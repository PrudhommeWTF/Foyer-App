// Exercice « Conjugaison » : « être (présent) : nous … », l'enfant écrit la forme
// au clavier. Les formes viennent d'une liste du contenu de l'exercice, une
// ligne par forme (« être (présent) : nous sommes ») : celles livrées en
// configuration (backend/config/revisions/conjugaison/), ou celle qu'un parent
// saisit. Aucun verbe ni aucune règle de conjugaison n'est ici.
//
// Un item est une forme : verbe, temps, personne et la forme elle-même (la
// clé la porte, ce qui permet au serveur de vérifier qu'une question vient bien
// de la liste). La correction suit celle de la dictée : les accents comptent,
// pas la casse, les espaces en trop ni la forme de l'apostrophe ; écrire le
// pronom avec (« nous sommes ») est juste aussi.
import { Checked, ExerciseContext, ExerciseDef, Params, listOf } from './contract';

export interface ConjugaisonQuestion { verbe: string; temps: string; pronom: string; forme: string; }

const clean = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/’/g, '\'');
const fold = (s: string): string => clean(s).toLocaleLowerCase('fr');
const PART = /^[\p{L}][\p{L}'/ -]{0,30}$/u;
const KEY = 'conj:';
/** Une ligne de liste (« être (présent) : nous sommes », « avoir (présent) : j'ai »), ou null si elle n'a pas cette forme. */
export function readLine(line: string): ConjugaisonQuestion | null {
  const m = /^(.+?)\s*\((.+?)\)\s*:\s*(.+)$/.exec(clean(line));
  if (!m) return null;
  const phrase = m[3];
  const j = /^(j')\s*(.+)$/i.exec(phrase);
  const [pronom, forme] = j ? [j[1].toLowerCase(), j[2]] : [phrase.split(' ')[0], phrase.split(' ').slice(1).join(' ')];
  const q = { verbe: m[1].toLowerCase(), temps: m[2].toLowerCase(), pronom, forme };
  return [q.verbe, q.temps, q.pronom, q.forme].every((x) => PART.test(x)) ? q : null;
}
const keyOf = (q: ConjugaisonQuestion): string => KEY + [q.verbe, q.temps, q.pronom, q.forme].map(clean).join(':');
const fromKey = (key: string): ConjugaisonQuestion | null => {
  const [verbe, temps, pronom, forme] = key.slice(KEY.length).split(':');
  return key.startsWith(KEY) && forme ? { verbe, temps, pronom, forme } : null;
};
const phraseOf = (q: ConjugaisonQuestion): string => (q.pronom === 'j\'' ? `j’${q.forme}` : `${q.pronom} ${q.forme}`);
const lineOf = (q: ConjugaisonQuestion): string => `${q.verbe} (${q.temps}) : ${phraseOf(q)}`;
const listFor = (p: Params, ctx: ExerciseContext) => listOf(ctx, p['liste']);
const formsOf = (p: Params, ctx: ExerciseContext): ConjugaisonQuestion[] => {
  const seen = new Set<string>();
  return (listFor(p, ctx)?.items ?? []).map(readLine).filter((q): q is ConjugaisonQuestion => !!q && !seen.has(keyOf(q)) && !!seen.add(keyOf(q)));
};

export const CONJUGAISON: ExerciseDef<ConjugaisonQuestion> = {
  id: 'conjugaison',
  label: 'Conjugaison',
  matiere: 'francais',
  icon: 'edit',
  ageMin: 7,
  desc: 'Un verbe, un temps et une personne (« être, au présent : nous … ») : l’enfant écrit la forme au clavier. Les accents comptent, pas les majuscules. Une liste livrée (être et avoir, les verbes en -er…), ou celle donnée par la maîtresse.',
  input: 'clavier',
  prompt: 'texte',
  view: 'liste',
  params: [
    { key: 'liste', type: 'content', label: 'Liste de formes', item: 'forme', items: 'formes', default: '' },
  ],

  universe: (p, ctx) => formsOf(p, ctx).map(keyOf),
  question: (key) => fromKey(key) ?? { verbe: '', temps: '', pronom: '', forme: '' },
  parse(raw) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const parts = ['verbe', 'temps', 'pronom', 'forme'].map((k) => (typeof o[k] === 'string' ? clean(o[k] as string) : ''));
    return parts.every((x) => PART.test(x)) ? { verbe: parts[0], temps: parts[1], pronom: parts[2], forme: parts[3] } : null;
  },
  itemKey: keyOf,
  itemLabel(key) { const q = fromKey(key); return q ? lineOf(q) : key; },
  text: lineOf,
  ask: (q) => ({ before: `${q.verbe} (${q.temps}) : ${q.pronom === 'j\'' ? 'j’' : q.pronom}`, after: '' }),
  groups(key) { const q = fromKey(key); return q ? [`${q.verbe} (${q.temps})`] : []; },

  /** La forme, ou la forme avec son pronom. */
  check(q, given): Checked {
    const g = fold(given);
    return { ok: !!g && (g === fold(q.forme) || g === fold(phraseOf(q)) || g === fold(`${q.pronom} ${q.forme}`)), expected: q.forme };
  },

  /** La liste dans l'ordre, chaque forme lue puis recopiée. */
  learn: formsOf,
  spoken: phraseOf,
  summary(p, ctx) {
    const l = listFor(p, ctx); const n = formsOf(p, ctx).length;
    return l ? `La liste « ${l.label} » (${n} forme${n > 1 ? 's' : ''})` : 'Aucune liste de formes';
  },
};
