// Le contrat d'un exercice du module Révisions.
//
// Le socle (sessions, réponses, maîtrise, programmes, bilan, suivi, hors ligne)
// ne connaît aucune matière : tout ce qui est propre à un exercice passe par une
// définition qui respecte ce contrat, déclarée dans le registre (index.ts).
// Ajouter un exercice = un fichier dans ce dossier, une ligne dans le registre,
// et son contenu éventuel en configuration. Ni nouvelle table, ni nouvelle route.
//
// Ce dossier est pur (aucune dépendance hors de lui) parce qu'il vit en deux
// copies identiques : ici, où le serveur refait la correction et calcule les
// clés de maîtrise, et dans l'application, où l'exercice tourne hors ligne.
// Un test vérifie que les deux copies ne divergent pas. Voir docs/revisions.md.

/** Apprendre (la matière sous les yeux, rien ne compte), s'entraîner (correction affichée), test (sans). */
export type Mode = 'apprendre' | 'entrainer' | 'test';
export const MODES: readonly Mode[] = ['apprendre', 'entrainer', 'test'];

/** Comment l'enfant répond : le pavé numérique maison, le clavier, un choix parmi plusieurs. */
export type InputKind = 'pave' | 'clavier' | 'choix';
/** Comment la question est posée : un texte, une voix, un cadran, un texte à lire puis une question, des pièces et des billets. */
export type PromptKind = 'texte' | 'audio' | 'horloge' | 'passage' | 'monnaie';
/** Comment la maîtrise se montre : une grille à deux entrées, ou une liste. */
export type ViewKind = 'grille' | 'liste';
/** Ce que l'appareil doit savoir faire pour que l'exercice soit proposé. */
export type Capability = 'voix';

/**
 * Les types de paramètre qu'un programme sait porter, et donc que le
 * formulaire du programme sait afficher. Un test refuse une définition qui en
 * déclare un autre : le formulaire est engendré, jamais écrit par exercice.
 */
export const PARAM_TYPES = ['int', 'bool', 'enum', 'range', 'content'] as const;
export type ParamType = typeof PARAM_TYPES[number];

interface ParamBase { key: string; label: string; desc?: string; }
export type ParamDecl =
  | (ParamBase & { type: 'int'; default: number; min: number; max: number })
  | (ParamBase & { type: 'bool'; default: boolean })
  | (ParamBase & { type: 'enum'; default: string; options: { value: string; label: string }[] })
  /** Deux bornes « de … à … », la première jamais après la seconde. `maxFrom` : la clé d'un paramètre `int` qui borne le haut. */
  | (ParamBase & { type: 'range'; default: [number, number]; min: number; max: number; maxFrom?: string })
  /**
   * Une liste du contenu de l'exercice (livrée en configuration, ou saisie par
   * le foyer), par son identifiant. `default` vide : la première liste. `item`
   * et `items` nomment un élément pour le formulaire (« mot », « mots »).
   * `lines` : des éléments longs, un par ligne (virgules permises), de
   * LONG_ITEM_MAX caractères au plus, au lieu de mots de SHORT_ITEM_MAX.
   * `format` : la forme d'un élément, rappelée sous le champ de saisie.
   */
  | (ParamBase & { type: 'content'; default: string; item: string; items: string; lines?: boolean; format?: string });

/** La longueur d'un élément de liste du foyer : un mot, ou une ligne (paramètre `lines`). */
export const SHORT_ITEM_MAX = 40;
export const LONG_ITEM_MAX = 240;
/** Les éléments de l'exercice sont-ils des lignes longues ? */
export const longItems = (d: { params: readonly ParamDecl[] }): boolean => d.params.some((p) => p.type === 'content' && !!p.lines);
/** Couper un texte saisi en éléments : aux retours à la ligne pour des lignes, aussi aux virgules et points-virgules pour des mots. */
export const splitItems = (text: string, lines: boolean): string[] =>
  [...new Set(text.split(lines ? /\n+/ : /[\n,;]+/).map((x) => x.trim()).filter(Boolean))];

export type ParamValue = number | boolean | string | [number, number];
export type Params = Record<string, ParamValue>;

/** Une liste de contenu : des listes de mots livrées, ou celle de la semaine saisie par un parent. */
export interface ContentList { id: string; label: string; items: string[]; source: 'livre' | 'foyer'; archived?: boolean; }
/**
 * Ce que l'exercice peut lire en plus de ses paramètres : ses listes de
 * contenu. Le socle le construit (configuration et base côté serveur, copie
 * locale côté appareil) ; un exercice sans contenu l'ignore.
 */
export interface ExerciseContext { lists: readonly ContentList[]; }
export const NO_CONTEXT: ExerciseContext = { lists: [] };
/** La liste désignée par un paramètre `content`, s'il en existe une. */
export const listOf = (ctx: ExerciseContext, id: unknown): ContentList | undefined => ctx.lists.find((l) => l.id === id);

/** La correction d'une réponse : juste ou non, et la bonne réponse telle qu'on l'affiche. */
export interface Checked { ok: boolean; expected: string; }

/** Une case de la vue « grille » : une ligne, une colonne, la clé d'item qu'elle montre. */
export interface GridShape { rows: string[]; cols: string[]; corner: string; keyAt(row: number, col: number): string; }

export interface ExerciseDef<Q = unknown> {
  id: string;
  label: string;
  /** La matière, telle que la déclare la configuration (`maths`, `francais`…). */
  matiere: string;
  icon: string;
  /** Âge indicatif, en années : pour aider le parent, jamais pour interdire. */
  ageMin?: number;
  /** Pour le parent : ce que travaille l'exercice. */
  desc: string;
  input: InputKind;
  prompt: PromptKind;
  view: ViewKind;
  requires?: Capability[];
  params: ParamDecl[];
  /** Tous les items que le programme peut poser, par leur clé de maîtrise. */
  universe(p: Params, ctx: ExerciseContext): string[];
  /** Une question pour cet item, dans une forme choisie (le sens de 6 × 7, par exemple). */
  question(key: string, p: Params, rand: () => number): Q;
  /** Relit une question reçue de l'appareil ; null si elle n'est pas de cet exercice ou sort des bornes. */
  parse(raw: unknown, p: Params): Q | null;
  /** La clé stable de l'item pour la maîtrise (« mult:6x7 », commutatif pour les tables). */
  itemKey(q: Q): string;
  /** L'item en clair, pour le suivi et le bilan (« 6 × 7 »). */
  itemLabel(key: string): string;
  /** L'énoncé tel qu'il s'affiche (« 7 × 6 »). */
  text(q: Q): string;
  /**
   * L'énoncé autour de la case de réponse, à l'écran : « 6 × 7 = » puis la
   * case, ou « ? × 7 = 42 » avec la case à la place du point d'interrogation.
   * Absent : l'énoncé, « = », puis la case.
   */
  ask?(q: Q): { before: string; after: string };
  /**
   * L'item qu'il faut avoir acquis avant que celui-ci soit posé (« ? × 7 = 42 »
   * après « 6 × 7 »), ou null. Le socle l'applique au tirage ; le serveur ne
   * refuse pas une réponse pour autant (c'est une progression, pas un droit).
   */
  prerequisite?(key: string): string | null;
  /** Les regroupements de l'item pour le suivi (« Table de 6 », « Table de 7 »). */
  groups(key: string, p: Params, ctx: ExerciseContext): string[];
  /** La correction : la même ici et sur l'appareil. */
  check(q: Q, given: string): Checked;
  /** Le mode Apprendre : la matière à recopier, dans l'ordre. Absent : pas de mode Apprendre. */
  learn?(p: Params, ctx: ExerciseContext): Q[];
  /** Ce que la voix de l'appareil lit en mode Apprendre (« 7 fois 3, 21 »). */
  spoken?(q: Q): string;
  /** L'heure que dessine un énoncé « horloge » (heures de 1 à 12, minutes). Obligatoire pour cet énoncé. */
  clock?(q: Q): { h: number; m: number };
  /** Le texte à lire d'un énoncé « passage », au-dessus de la question (`ask`). Obligatoire pour cet énoncé. */
  passage?(q: Q): string;
  /** Les réponses proposées d'une saisie « choix », dans l'ordre de l'écran. Obligatoire pour cette saisie. */
  choices?(q: Q): string[];
  /** Les pièces et billets d'un énoncé « monnaie », en centimes. Obligatoire pour cet énoncé. */
  coins?(q: Q): number[];
  /** La saisie telle qu'elle s'affiche pendant qu'on tape (« 745 » devient « 7 h 45 », « 340 » devient « 3,40 € » selon la question). Absent : les chiffres tels quels. */
  display?(typed: string, q: Q): string;
  /** La forme de la vue « grille ». */
  grid?(p: Params): GridShape;
  /** Un résumé du programme en une ligne (« Les tables de 6 à 9, multiplication »). */
  summary(p: Params, ctx: ExerciseContext): string;
}

/** Les paramètres par défaut d'un exercice. */
export function defaults(def: ExerciseDef, ctx: ExerciseContext = NO_CONTEXT): Params {
  return Object.fromEntries(def.params.map((d) => [d.key,
    d.type === 'content' ? (listOf(ctx, d.default) ?? ctx.lists.find((l) => !l.archived))?.id ?? d.default
    : Array.isArray(d.default) ? [...d.default] as [number, number] : d.default]));
}

/**
 * Valide des paramètres reçus contre leur déclaration, et rend les valeurs
 * propres (les manquants prennent leur défaut). Lève avec un message en
 * français qui nomme le paramètre. Le même code sur l'appareil et sur le serveur.
 */
export function readParams(def: ExerciseDef, raw: unknown, ctx: ExerciseContext = NO_CONTEXT): Params {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Params = {};
  const base = defaults(def, ctx);
  const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  for (const d of def.params) {
    const v = src[d.key] === undefined ? base[d.key] : src[d.key];
    switch (d.type) {
      case 'int':
        if (!isInt(v, d.min, d.max)) throw new Error(`« ${d.label} » : un nombre entier de ${d.min} à ${d.max}.`);
        out[d.key] = v; break;
      case 'bool':
        if (typeof v !== 'boolean') throw new Error(`« ${d.label} » : oui ou non.`);
        out[d.key] = v; break;
      case 'enum':
        if (!d.options.some((o) => o.value === v)) throw new Error(`« ${d.label} » : ${d.options.map((o) => o.label).join(', ')}.`);
        out[d.key] = v as string; break;
      case 'range': {
        const top = d.maxFrom !== undefined && typeof out[d.maxFrom] === 'number' ? out[d.maxFrom] as number : d.max;
        if (!Array.isArray(v) || v.length !== 2 || !isInt(v[0], d.min, top) || !isInt(v[1], d.min, top) || v[0] > v[1]) {
          throw new Error(`« ${d.label} » : de ${d.min} à ${top}, la première borne avant la seconde.`);
        }
        out[d.key] = [v[0], v[1]]; break;
      }
      case 'content':
        // Une liste archivée reste lisible : un programme ou une session qui la désigne ne casse pas.
        if (!listOf(ctx, v)) throw new Error(ctx.lists.length ? `« ${d.label} » : cette liste n’existe pas.` : `« ${d.label} » : aucune liste disponible pour cet exercice.`);
        out[d.key] = v as string; break;
    }
  }
  return out;
}
