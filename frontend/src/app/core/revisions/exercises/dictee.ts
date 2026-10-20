// Exercice « Dictée de mots » : la voix de l'appareil lit un mot, l'enfant
// l'écrit au clavier. Les mots viennent d'une liste du contenu de l'exercice :
// celles livrées en configuration (backend/config/revisions/dictee/), ou celle
// de la semaine saisie par un parent. Rien du contenu n'est ici.
//
// Un item est un mot, quelle que soit la liste qui le porte : « oiseau » su
// dans la liste de la semaine reste su dans la suivante. La correction tient
// compte des accents (c'est ce qu'on apprend), pas de la casse, des espaces en
// trop ni de la forme de l'apostrophe.
import { Checked, ExerciseContext, ExerciseDef, Params, listOf } from './contract';

export interface DicteeQuestion { mot: string; }

/** Un mot de liste : des lettres (accents compris), et au plus des tirets, apostrophes ou espaces entre elles. */
export const WORD = /^[\p{L}](?:[\p{L}'’ -]{0,38}[\p{L}])?$/u;
const clean = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/’/g, '\'');
const fold = (s: string): string => clean(s).toLocaleLowerCase('fr');
const KEY = 'mot:';
const listFor = (p: Params, ctx: ExerciseContext) => listOf(ctx, p['liste']);
const wordsOf = (p: Params, ctx: ExerciseContext): string[] => [...new Set((listFor(p, ctx)?.items ?? []).map(clean).filter((w) => WORD.test(w)))];

export const DICTEE: ExerciseDef<DicteeQuestion> = {
  id: 'dictee',
  label: 'Dictée de mots',
  matiere: 'francais',
  icon: 'edit',
  ageMin: 6,
  desc: 'La voix de l’appareil lit un mot, l’enfant l’écrit au clavier. Les accents comptent, pas les majuscules. Une liste livrée, ou celle de la semaine donnée par la maîtresse.',
  input: 'clavier',
  prompt: 'audio',
  view: 'liste',
  requires: ['voix'],
  params: [
    { key: 'liste', type: 'content', label: 'Liste de mots', item: 'mot', items: 'mots', default: '' },
  ],

  universe: (p, ctx) => wordsOf(p, ctx).map((w) => KEY + w),
  question: (key) => ({ mot: key.slice(KEY.length) }),
  parse(raw) {
    const m = (raw ?? {}) as Record<string, unknown>;
    return typeof m['mot'] === 'string' && WORD.test(clean(m['mot'])) ? { mot: clean(m['mot']) } : null;
  },
  itemKey: (q) => KEY + clean(q.mot),
  itemLabel: (key) => key.slice(KEY.length),
  text: (q) => q.mot,
  groups(_key, p, ctx) { const l = listFor(p, ctx); return l ? [`Liste « ${l.label} »`] : []; },
  check: (q, given): Checked => ({ ok: fold(given) === fold(q.mot), expected: q.mot }),
  /** La liste dans l'ordre, chaque mot lu puis recopié. */
  learn: (p, ctx) => wordsOf(p, ctx).map((mot) => ({ mot })),
  spoken: (q) => q.mot,
  summary(p, ctx) {
    const l = listFor(p, ctx); const n = wordsOf(p, ctx).length;
    return l ? `La liste « ${l.label} » (${n} mot${n > 1 ? 's' : ''})` : 'Aucune liste de mots';
  },
};
