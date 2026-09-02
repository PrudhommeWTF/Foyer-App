/**
 * Les règles de contexte de l'accueil.
 *
 * L'écran d'accueil met en avant ce qui compte au moment où on l'ouvre. Ce qui
 * compte n'est pas une affaire de code : c'est le rythme d'une maison, et il
 * change. Les enfants changent d'école, les horaires bougent, quelqu'un se met à
 * travailler le samedi. Ces règles sont donc **des données**, lues dans un
 * fichier, modifiables avec un éditeur de texte et sans recompiler quoi que ce
 * soit.
 *
 *   <données>/accueil.json
 *
 * Sans ce fichier, les règles par défaut ci-dessous s'appliquent, et l'accueil
 * le dit. Avec un fichier illisible, **les défauts s'appliquent aussi, et
 * l'accueil le dit avec la raison** : appliquer à moitié un jeu de règles
 * donnerait un écran que personne ne saurait expliquer, ce qui est exactement
 * ce qu'on cherche à éviter.
 *
 * Le format est documenté dans docs/accueil-contexte.md.
 */
import fs from 'fs';
import path from 'path';

/** Un moment de la journée. `from` est l'heure à partir de laquelle il commence. */
export interface Moment {
  id: string;
  label: string;
  /** HH:MM, heure du foyer. */
  from: string;
}

/**
 * Un type de jour. `quand` dit d'où vient la réponse :
 *
 *   - `ferie`          : jour férié français, calculé.
 *   - `vacances`       : vacances scolaires de l'académie configurée.
 *   - `semaine`        : jours de la semaine listés dans `jours` (lundi = 1).
 *   - `emploiDuTemps`  : il existe aujourd'hui un créneau du type `type`
 *                        (« ecole », « travail », « sport »…) dans l'emploi du
 *                        temps du foyer.
 */
export type DayWhen = 'ferie' | 'vacances' | 'semaine' | 'emploiDuTemps';
export interface DayKind {
  id: string;
  label: string;
  quand: DayWhen;
  /** Pour `semaine` : les jours concernés, lundi = 1, dimanche = 7. */
  jours?: number[];
  /** Pour `emploiDuTemps` : le type de créneau cherché. */
  type?: string;
}

/**
 * Une règle de mise en avant.
 *
 * `poids` est positif pour remonter une tuile, négatif pour la reléguer. Les
 * poids des règles qui s'appliquent s'additionnent. `raison` est affichée sur la
 * tuile remontée : sans elle, l'écran bouge sans qu'on sache pourquoi, et un
 * écran comme celui-là est un écran qu'on cesse de regarder.
 */
export interface Rule {
  tuile: string;
  /** Moments concernés. Absent = tous. */
  moments?: string[];
  /** Types de jour concernés. Absent = tous. */
  jours?: string[];
  poids: number;
  raison?: string;
}

export interface HomeRules {
  moments: Moment[];
  typesDeJour: DayKind[];
  regles: Rule[];
  /**
   * En dessous de ce score, une tuile est **repliée** : son titre reste, son
   * contenu se déplie d'un tap. Elle n'est jamais retirée de la page.
   */
  seuilRepli: number;
}

export interface RulesOutcome {
  rules: HomeRules;
  /** « defaut » ou « fichier » : l'accueil le dit, pour qu'on sache ce qui s'applique. */
  source: 'defaut' | 'fichier';
  /** Ce qui a empêché de lire le fichier. Vide quand tout va bien. */
  errors: string[];
}

/**
 * Les règles par défaut, qui reprennent les usages d'un foyer avec enfants
 * scolarisés. Elles ne sont pas la vérité : elles sont un point de départ
 * lisible, à recopier dans `accueil.json` et à modifier.
 */
export const DEFAULT_RULES: HomeRules = {
  moments: [
    { id: 'tot', label: 'Tôt le matin', from: '05:00' },
    { id: 'matinee', label: 'Matinée', from: '09:00' },
    { id: 'midi', label: 'Midi', from: '11:30' },
    { id: 'apresmidi', label: 'Après-midi', from: '14:00' },
    { id: 'finjournee', label: 'Fin d’après-midi', from: '17:00' },
    { id: 'soiree', label: 'Soirée', from: '19:30' },
    { id: 'tard', label: 'Tard le soir', from: '22:00' },
  ],
  typesDeJour: [
    { id: 'ferie', label: 'Jour férié', quand: 'ferie' },
    { id: 'vacances', label: 'Vacances scolaires', quand: 'vacances' },
    { id: 'weekend', label: 'Week-end', quand: 'semaine', jours: [6, 7] },
    { id: 'ecole', label: 'Jour d’école', quand: 'emploiDuTemps', type: 'ecole' },
    { id: 'travail', label: 'Jour de travail', quand: 'emploiDuTemps', type: 'travail' },
  ],
  regles: [
    // Le matin : la journée qui commence, et ce qui doit partir avec les enfants.
    { tuile: 'agenda', moments: ['tot', 'matinee'], poids: 30, raison: 'Le matin, la journée d’abord' },
    { tuile: 'planning', moments: ['tot', 'matinee'], jours: ['ecole'], poids: 30, raison: 'Jour d’école : ce qui part ce matin' },
    { tuile: 'economies', moments: ['tot', 'matinee'], poids: -25 },
    { tuile: 'echeances', moments: ['tot'], poids: -15 },

    // Midi et après-midi : rien de particulier, l'ordre du registre suffit.
    { tuile: 'repas', moments: ['midi'], poids: 15, raison: 'C’est l’heure' },

    // Fin d'après-midi : le repas du soir et ce qu'il manque pour le faire.
    { tuile: 'repas', moments: ['finjournee'], poids: 35, raison: 'On mange dans deux heures' },
    { tuile: 'courses', moments: ['finjournee'], poids: 30, raison: 'Avant de rentrer' },
    { tuile: 'economies', moments: ['finjournee'], poids: -25 },

    // Le soir : ce qui compte est demain, pas la journée écoulée.
    { tuile: 'agenda', moments: ['soiree', 'tard'], poids: 25, raison: 'Ce soir, c’est demain qui compte' },
    { tuile: 'planning', moments: ['soiree'], jours: ['ecole'], poids: 20, raison: 'Préparer demain' },
    { tuile: 'repas', moments: ['soiree', 'tard'], poids: -20 },
    { tuile: 'taches', moments: ['tard'], poids: -25 },
    { tuile: 'courses', moments: ['tard'], poids: -25 },
    { tuile: 'finances', moments: ['tard'], poids: -25 },
    { tuile: 'echeances', moments: ['tard'], poids: -25 },
    { tuile: 'economies', moments: ['soiree', 'tard'], poids: -25 },
    { tuile: 'energie', moments: ['tard'], poids: -25 },

    // Le week-end : la maison et l'administratif prennent la place du travail.
    { tuile: 'taches', jours: ['weekend'], poids: 25, raison: 'Week-end : la maison' },
    { tuile: 'echeances', jours: ['weekend'], poids: 20, raison: 'Week-end : le temps de s’en occuper' },
    { tuile: 'economies', jours: ['weekend'], poids: 15, raison: 'Week-end : le temps de s’en occuper' },
    { tuile: 'planning', jours: ['weekend'], poids: -30 },

    // Vacances et fériés : plus d'école, plus de rythme scolaire.
    { tuile: 'planning', jours: ['vacances', 'ferie'], poids: -30 },
    { tuile: 'repas', jours: ['vacances', 'ferie'], poids: 10, raison: 'Tout le monde à la maison' },
    { tuile: 'finances', jours: ['ferie'], poids: -20 },
  ],
  seuilRepli: -20,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Contrôle du fichier. Un message par défaut : il sera lu par qui l'a écrit. */
export function validate(raw: unknown): { rules: HomeRules | null; errors: string[] } {
  const errors: string[] = [];
  const fail = (m: string): null => { errors.push(m); return null; };
  if (!raw || typeof raw !== 'object') return { rules: fail('Le fichier ne contient pas un objet JSON.'), errors };
  const o = raw as Record<string, unknown>;

  const moments: Moment[] = [];
  for (const [i, m] of (Array.isArray(o['moments']) ? o['moments'] : []).entries()) {
    const x = m as Partial<Moment>;
    if (!x.id || !x.label || typeof x.from !== 'string' || !HHMM.test(x.from)) {
      errors.push(`moments[${i}] : « id », « label » et « from » (HH:MM) sont requis.`);
      continue;
    }
    moments.push({ id: String(x.id), label: String(x.label), from: x.from });
  }
  if (!moments.length) errors.push('Aucun moment de la journée valide : il en faut au moins un.');

  const typesDeJour: DayKind[] = [];
  for (const [i, d] of (Array.isArray(o['typesDeJour']) ? o['typesDeJour'] : []).entries()) {
    const x = d as Partial<DayKind>;
    const quand = x.quand as DayWhen;
    if (!x.id || !x.label || !['ferie', 'vacances', 'semaine', 'emploiDuTemps'].includes(quand)) {
      errors.push(`typesDeJour[${i}] : « quand » doit valoir ferie, vacances, semaine ou emploiDuTemps.`);
      continue;
    }
    if (quand === 'semaine' && !(Array.isArray(x.jours) && x.jours.every((j) => j >= 1 && j <= 7))) {
      errors.push(`typesDeJour[${i}] : « jours » doit lister des nombres de 1 (lundi) à 7 (dimanche).`);
      continue;
    }
    if (quand === 'emploiDuTemps' && !x.type) {
      errors.push(`typesDeJour[${i}] : « type » est requis (ecole, travail, sport…).`);
      continue;
    }
    typesDeJour.push({ id: String(x.id), label: String(x.label), quand, jours: x.jours, type: x.type });
  }

  const ids = new Set(moments.map((m) => m.id));
  const jourIds = new Set(typesDeJour.map((d) => d.id));
  const regles: Rule[] = [];
  for (const [i, r] of (Array.isArray(o['regles']) ? o['regles'] : []).entries()) {
    const x = r as Partial<Rule>;
    if (!x.tuile || typeof x.poids !== 'number') {
      errors.push(`regles[${i}] : « tuile » et « poids » (nombre) sont requis.`);
      continue;
    }
    const inconnus = [
      ...(x.moments || []).filter((m) => !ids.has(m)).map((m) => `moment « ${m} »`),
      ...(x.jours || []).filter((j) => !jourIds.has(j)).map((j) => `type de jour « ${j} »`),
    ];
    if (inconnus.length) {
      errors.push(`regles[${i}] (tuile « ${x.tuile} ») : ${inconnus.join(', ')} inconnu(s).`);
      continue;
    }
    regles.push({ tuile: String(x.tuile), moments: x.moments, jours: x.jours, poids: x.poids, raison: x.raison });
  }

  const seuil = typeof o['seuilRepli'] === 'number' ? (o['seuilRepli'] as number) : DEFAULT_RULES.seuilRepli;
  if (errors.length) return { rules: null, errors };
  return { rules: { moments, typesDeJour, regles, seuilRepli: seuil }, errors };
}

/** Chemin du fichier de règles, dans le répertoire de données du foyer. */
export const rulesPath = (dataDir: string): string => path.join(dataDir, 'accueil.json');

/**
 * Lit les règles. Jamais d'exception : un fichier cassé ne doit pas empêcher
 * l'accueil de s'afficher, il doit se voir.
 */
export function loadRules(dataDir: string): RulesOutcome {
  const file = rulesPath(dataDir);
  if (!fs.existsSync(file)) return { rules: DEFAULT_RULES, source: 'defaut', errors: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { rules: DEFAULT_RULES, source: 'defaut', errors: [`JSON illisible : ${(e as Error).message}`] };
  }
  const { rules, errors } = validate(raw);
  if (!rules) return { rules: DEFAULT_RULES, source: 'defaut', errors };
  return { rules, source: 'fichier', errors: [] };
}
