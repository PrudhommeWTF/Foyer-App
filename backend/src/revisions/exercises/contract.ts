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
/** Comment la question est posée : un texte, une voix, un cadran. */
export type PromptKind = 'texte' | 'audio' | 'horloge';
/** Comment la maîtrise se montre : une grille à deux entrées, ou une liste. */
export type ViewKind = 'grille' | 'liste';
/** Ce que l'appareil doit savoir faire pour que l'exercice soit proposé. */
export type Capability = 'voix';

/**
 * Les types de paramètre qu'un programme sait porter, et donc que le
 * formulaire du programme sait afficher. Un test refuse une définition qui en
 * déclare un autre : le formulaire est engendré, jamais écrit par exercice.
 */
export const PARAM_TYPES = ['int', 'bool', 'enum', 'range'] as const;
export type ParamType = typeof PARAM_TYPES[number];

interface ParamBase { key: string; label: string; desc?: string; }
export type ParamDecl =
  | (ParamBase & { type: 'int'; default: number; min: number; max: number })
  | (ParamBase & { type: 'bool'; default: boolean })
  | (ParamBase & { type: 'enum'; default: string; options: { value: string; label: string }[] })
  /** Deux bornes « de … à … », la première jamais après la seconde. `maxFrom` : la clé d'un paramètre `int` qui borne le haut. */
  | (ParamBase & { type: 'range'; default: [number, number]; min: number; max: number; maxFrom?: string });

export type ParamValue = number | boolean | string | [number, number];
export type Params = Record<string, ParamValue>;

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
  universe(p: Params): string[];
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
  /** Les regroupements de l'item pour le suivi (« Table de 6 », « Table de 7 »). */
  groups(key: string, p: Params): string[];
  /** La correction : la même ici et sur l'appareil. */
  check(q: Q, given: string): Checked;
  /** Le mode Apprendre : la matière à recopier, dans l'ordre. Absent : pas de mode Apprendre. */
  learn?(p: Params): Q[];
  /** Ce que la voix de l'appareil lit en mode Apprendre (« 7 fois 3, 21 »). */
  spoken?(q: Q): string;
  /** La forme de la vue « grille ». */
  grid?(p: Params): GridShape;
  /** Un résumé du programme en une ligne (« Les tables de 6 à 9, multiplication »). */
  summary(p: Params): string;
}

/** Les paramètres par défaut d'un exercice. */
export function defaults(def: ExerciseDef): Params {
  return Object.fromEntries(def.params.map((d) => [d.key, Array.isArray(d.default) ? [...d.default] as [number, number] : d.default]));
}

/**
 * Valide des paramètres reçus contre leur déclaration, et rend les valeurs
 * propres (les manquants prennent leur défaut). Lève avec un message en
 * français qui nomme le paramètre. Le même code sur l'appareil et sur le serveur.
 */
export function readParams(def: ExerciseDef, raw: unknown): Params {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Params = {};
  const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  for (const d of def.params) {
    const v = src[d.key] === undefined ? d.default : src[d.key];
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
    }
  }
  return out;
}
