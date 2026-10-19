// Le modèle de maîtrise du module Tables : ce que Foyer sait, opération par
// opération, de ce qu'un enfant connaît. Pur, sans base ni horloge : c'est ce
// qu'on teste. Voir docs/tables.md.
//
// Une boîte de Leitner par couple (a, b), commutatif : 6 × 7 et 7 × 6 comptent
// ensemble (la question, elle, est posée dans les deux sens). Niveau de 0 à 5 :
//
//   - une bonne réponse **rapide** fait monter d'un niveau, mais seulement si le
//     couple était **dû** (sa date de révision est passée). Sans cette règle, le
//     même couple posé trois fois dans une session l'amènerait au niveau 3 en
//     dix minutes, et « acquise » mentirait ;
//   - une bonne réponse **lente** ne bouge pas le niveau ;
//   - une réponse **fausse** (ou passée) fait descendre (de deux par défaut) et
//     rend le couple dû tout de suite.
//
// Le niveau fixe la prochaine révision (1, 3, 7, 14, 30 jours). « Acquise » :
// niveau au moins N, au moins M bonnes réponses, et la dernière rapide (N et M
// dans le barème). Le résultat d'une réponse (bon, lent, faux) est figé quand
// elle arrive : recalculer repart des résultats stockés, jamais des durées, si
// bien que changer le barème ne réécrit pas le passé.

export type Operation = 'multiplication' | 'addition';
export const OPERATIONS: readonly Operation[] = ['multiplication', 'addition'];
export type Result = 'bon' | 'lent' | 'faux' | 'passe';
export type Mode = 'apprendre' | 'entrainer' | 'test';
export const MODES: readonly Mode[] = ['apprendre', 'entrainer', 'test'];

export interface MasteryCfg {
  /** Jours avant la prochaine révision, par niveau (l'indice est le niveau). */
  espacementJours: number[];
  descenteSiFaux: number;
  niveauAcquis: number;
  bonnesMin: number;
}

export interface Mastery {
  level: number;
  good: number;
  wrong: number;
  lastResult: Result;
  lastAt: string;
  /** ISO. Avant cette date, une bonne réponse ne fait pas monter. */
  nextAt: string;
}

/** Les quatre états qu'on affiche. « jamais » n'est pas « non sue » : on ne sait rien. */
export type Status = 'jamais' | 'peu' | 'en-cours' | 'acquise';

export const expectedOf = (op: Operation, a: number, b: number): number => (op === 'multiplication' ? a * b : a + b);

/** Le couple commutatif, petit nombre d'abord. */
export const pairOf = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

const addDays = (iso: string, days: number): string => new Date(Date.parse(iso) + days * 86400_000).toISOString();

/**
 * Le résultat d'une réponse : fausse si elle n'est pas juste (ou pas donnée),
 * lente au-delà du seuil rapide, bonne sinon. Une réponse après la barre de
 * temps n'est pas refusée : elle est lente.
 */
export function classify(expected: number, given: number | null, ms: number, fastMs: number): Result {
  if (given === null) return 'passe';
  if (given !== expected) return 'faux';
  return ms <= fastMs ? 'bon' : 'lent';
}

/** Une réponse de plus sur ce couple. `at` : ISO, l'instant de la question. */
export function step(m: Mastery | undefined, result: Result, at: string, cfg: MasteryCfg): Mastery {
  const top = cfg.espacementJours.length - 1;
  const cur: Mastery = m ?? { level: 0, good: 0, wrong: 0, lastResult: result, lastAt: at, nextAt: at };
  const due = at >= cur.nextAt;
  if (result === 'faux' || result === 'passe') {
    return { level: Math.max(0, cur.level - cfg.descenteSiFaux), good: cur.good, wrong: cur.wrong + 1, lastResult: result, lastAt: at, nextAt: at };
  }
  if (result === 'lent') return { ...cur, good: cur.good + 1, lastResult: result, lastAt: at };
  if (!due) return { ...cur, good: cur.good + 1, lastResult: result, lastAt: at };
  const level = Math.min(top, cur.level + 1);
  return { level, good: cur.good + 1, wrong: cur.wrong, lastResult: result, lastAt: at, nextAt: addDays(at, cfg.espacementJours[level]) };
}

/** Rejoue toutes les réponses d'un couple, dans l'ordre où elles ont été données. */
export function replay(answers: readonly { result: Result; at: string }[], cfg: MasteryCfg): Mastery | undefined {
  let m: Mastery | undefined;
  for (const a of [...answers].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0))) m = step(m, a.result, a.at, cfg);
  return m;
}

export function status(m: Mastery | undefined, cfg: MasteryCfg): Status {
  if (!m) return 'jamais';
  if (m.level >= cfg.niveauAcquis && m.good >= cfg.bonnesMin && m.lastResult === 'bon') return 'acquise';
  if (m.good + m.wrong < cfg.bonnesMin) return 'peu';
  return 'en-cours';
}
