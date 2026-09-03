/**
 * Ce que l'accueil met en avant, et pourquoi.
 *
 * Le principe, et la seule chose à retenir : **le contexte réordonne et replie,
 * il ne masque jamais**. Une tuile déclassée descend ou se referme sur son
 * titre ; elle reste sur la page, à un défilement de là.
 *
 * La stabilité l'emporte sur la finesse. Un écran dont le contenu bouge sans
 * raison compréhensible est un écran qu'on cesse de regarder, et c'est pire que
 * pas de contexte du tout. D'où trois garde-fous :
 *
 *   1. L'ordre ne dépend **que** du jour et du moment de la journée. Il ne
 *      bouge donc qu'au franchissement d'une frontière, jamais à l'arrivée d'une
 *      donnée ni au fil d'un rendu.
 *   2. Toute tuile remontée porte **la raison, en toutes lettres**. Sans elle,
 *      l'écran a l'air arbitraire.
 *   3. Une tuile en panne n'est jamais ni repliée ni reléguée : ce qui est cassé
 *      doit se voir, quelle que soit l'heure.
 *
 * Les règles elles-mêmes ne sont pas ici : elles sont des données, servies par
 * `GET /api/home/rules` et lues dans `<données>/accueil.json`. Voir
 * docs/accueil-contexte.md.
 */
import { SchedSlot } from './models';
import { weekdayOf } from './helpers';

export interface Moment { id: string; label: string; from: string }
export type DayWhen = 'ferie' | 'vacances' | 'semaine' | 'emploiDuTemps';
export interface DayKind { id: string; label: string; quand: DayWhen; jours?: number[]; type?: string }
export interface Rule { tuile: string; moments?: string[]; jours?: string[]; poids: number; raison?: string }
export interface HomeRules { moments: Moment[]; typesDeJour: DayKind[]; regles: Rule[]; seuilRepli: number }
export interface RulesOutcome { rules: HomeRules; source: 'defaut' | 'fichier'; errors: string[] }

/** Ce qu'on sait du jour, une fois pour toutes, au moment où on le fige. */
export interface DayFacts {
  /** Date ISO du jour du foyer. */
  today: string;
  holiday: boolean;
  schoolHoliday: boolean;
  /**
   * Les créneaux **qui ont lieu aujourd'hui**, occurrence résolue. Pas la semaine
   * type brute : un mardi de vacances ne doit pas être classé « jour d'école »
   * parce qu'un créneau d'école existe le mardi en général.
   */
  schedToday: SchedSlot[];
}

/** Le contexte figé qui décide de l'ordre. Rien d'autre n'y entre. */
export interface HomeContext {
  moment: Moment | null;
  days: DayKind[];
  /** « Fin d'après-midi · jour d'école », pour que l'écran s'explique tout seul. */
  label: string;
}

/**
 * Le moment actif : le dernier dont l'heure de début est déjà passée.
 *
 * Avant le premier moment de la liste, c'est le **dernier** qui vaut : à trois
 * heures du matin, on est encore dans la soirée de la veille, pas dans un
 * néant sans règle.
 */
export function momentAt(moments: Moment[], hhmm: string): Moment | null {
  if (!moments.length) return null;
  const ordered = moments.slice().sort((a, b) => a.from.localeCompare(b.from));
  let found: Moment | null = null;
  for (const m of ordered) if (m.from <= hhmm) found = m;
  return found ?? ordered[ordered.length - 1];
}

/** Les types de jour qui s'appliquent aujourd'hui, dans l'ordre déclaré. */
export function dayKindsOf(kinds: DayKind[], f: DayFacts): DayKind[] {
  const weekday = weekdayOf(f.today);
  return kinds.filter((k) => {
    switch (k.quand) {
      case 'ferie': return f.holiday;
      case 'vacances': return f.schoolHoliday;
      case 'semaine': return (k.jours || []).includes(weekday);
      case 'emploiDuTemps': return f.schedToday.some((s) => s.k === k.type);
      default: return false;
    }
  });
}

export function contextOf(rules: HomeRules, f: DayFacts, hhmm: string): HomeContext {
  const moment = momentAt(rules.moments, hhmm);
  const days = dayKindsOf(rules.typesDeJour, f);
  const label = [moment?.label, ...days.map((d) => d.label.toLowerCase())].filter(Boolean).join(' · ');
  return { moment, days, label };
}

export interface RankedTile {
  id: string;
  score: number;
  /** La raison de la règle la plus lourde qui a remonté cette tuile. */
  raison: string;
  /** En dessous du seuil : la tuile se referme sur son titre, elle ne part pas. */
  folded: boolean;
}

/**
 * Classe les tuiles pour le contexte donné.
 *
 * `ids` est l'ordre du registre, qui reste la référence : il départage les
 * scores égaux, et c'est lui qu'on retrouve quand aucune règle ne s'applique.
 *
 * `pinned` sont les tuiles à ne pas toucher : celles qui sont en panne. Une
 * tuile cassée doit se voir, quelle que soit l'heure.
 */
export function rankTiles(rules: HomeRules, ids: readonly string[], ctx: HomeContext, pinned: readonly string[] = []): RankedTile[] {
  const jours = new Set(ctx.days.map((d) => d.id));
  const applies = (r: Rule): boolean =>
    (!r.moments?.length || (!!ctx.moment && r.moments.includes(ctx.moment.id)))
    && (!r.jours?.length || r.jours.some((j) => jours.has(j)));

  const ranked = ids.map((id, rang) => {
    if (pinned.includes(id)) return { id, rang, score: 0, raison: '', folded: false };
    const matched = rules.regles.filter((r) => r.tuile === id && applies(r));
    const score = matched.reduce((a, r) => a + r.poids, 0);
    // La raison affichée est celle de la règle qui pèse le plus lourd : en citer
    // trois ferait une tuile qui se justifie au lieu d'informer.
    const forte = matched.filter((r) => r.poids > 0 && r.raison).sort((a, b) => b.poids - a.poids)[0];
    return { id, rang, score, raison: score > 0 && forte?.raison ? forte.raison : '', folded: score <= rules.seuilRepli };
  });

  return ranked
    .sort((a, b) => b.score - a.score || a.rang - b.rang)
    .map(({ id, score, raison, folded }) => ({ id, score, raison, folded }));
}
