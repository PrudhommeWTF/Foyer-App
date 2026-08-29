// Domain models for the Foyer household state.

export type Recur = 'none' | 'daily' | 'weekday' | 'weekly' | 'monthly';
export type Prio = 'low' | 'med' | 'high';
export type SchedType = 'ecole' | 'travail' | 'sport' | 'loisir' | 'sante' | 'repas' | 'autre';
export type ContactCat = 'Urgences' | 'Santé' | 'École' | 'Famille' | 'Maison' | 'Autre';
export type FileType = 'PDF' | 'IMG' | 'DOC' | 'XLS' | 'AUTRE';

/**
 * `allerg` et `refuse` portent les contraintes alimentaires : allergènes de la
 * liste européenne, et clés d'articles du référentiel qu'on ne veut pas voir
 * arriver. Les deux sont confrontés au contenu des recettes (voir diet.ts).
 */
export interface Member { id: string; name: string; role: string; color: string; ini: string; admin?: boolean; email?: string; birthday?: string | null;
  allerg?: string[]; refuse?: string[];
  /**
   * Semaine type : créneaux où le membre ne mange **pas** à la maison, en clés
   * « 1-midi » (lundi = 1). Ce sont les absences qui sont notées, pas les
   * présences : une case vide veut dire « comme d'habitude » (voir presence.ts).
   */
  absent?: string[]; }
export interface EventItem { id: string; date: string; time: string; title: string; who: string; recur: Recur; end?: string | null;
  /**
   * Créneau de repas à l'origine de l'événement (« 2026-08-21-soir »). Il évite
   * d'en créer un second pour le même repas, et fait disparaître l'événement
   * quand le repas est retiré : sans lui, l'agenda garderait un dîner annulé.
   */
  mealKey?: string | null;
}
/**
 * Un rayon du magasin. `kind` est facultatif : il relie un rayon du foyer à un
 * type connu du référentiel d'articles, pour que « farine » aille à l'épicerie
 * même si le rayon a été renommé « Sec & conserves ». Sans lui, le nom du rayon
 * sert de repli.
 */
export type Rayon = 'legumes' | 'viande' | 'frais' | 'surgele' | 'boulangerie' | 'epicerie' | 'boisson' | 'entretien';
export interface Aisle { id: string; name: string; color: string; position: number; kind?: Rayon | null; }
/**
 * Article du référentiel propre au foyer. La base intégrée à l'application en
 * connaît déjà quelques centaines : `articles` ne contient que ce qu'elle
 * ignore ou nomme mal, et gagne toujours contre elle. C'est ce qu'écrit l'écran
 * de reprise des ingrédients non reconnus.
 */
export interface Article {
  key: string; name: string; syn: string[]; rayon: Rayon;
  /** Denrée de fond de placard : proposée, mais exclue de la liste par défaut. */
  pantry?: boolean;
  allerg?: string[];
}
export interface ShopList { id: string; name: string; color: string; icon: string; }
/**
 * Un article de courses. `state` a trois valeurs plutôt qu'un booléen : en
 * magasin, « je ne l'ai pas trouvé » n'est ni « à prendre » ni « pris ».
 * `by` et `at` disent qui a coché et quand, ce qui rend lisible ce que l'autre
 * téléphone vient de faire.
 */
export type ShopState = 'a-prendre' | 'panier' | 'indisponible';
export interface ShopItem {
  id: string; name: string; qty: string; aisleId: string;
  state: ShopState; listId: string; by?: string | null; at?: string | null;
  /**
   * Provenance. `art` porte la clé d'article, `gen` marque ce que la génération
   * depuis les repas a écrit : une régénération ne peut ainsi remplacer que ce
   * qu'elle a elle-même produit, et ne touche jamais un ajout fait à la main.
   */
  art?: string | null; gen?: boolean | null;
}
export interface TaskList { id: string; name: string; color: string; icon: string; }
export interface TaskItem { id: string; text: string; who: string; due: string; done: boolean; listId: string; prio: Prio; planned?: string | null;
  /**
   * Liste de courses que cette tâche ouvre. La tâche reste entièrement à
   * l'utilisateur (il la coche, la déplace, la supprime) : le lien n'est qu'un
   * raccourci, et le compte des articles restants, une information de plus.
   */
  shopListId?: string | null; }
export interface Message { who: string; text: string; time: string; }
export interface Contact { id: string; name: string; role: string; phone: string; email: string; cat: ContactCat; color: string; urgent: boolean; birthday?: string | null; }
export interface Folder { id: string; name: string; color: string; }
// `fileId` désigne un fichier servi par /api/files : comme les photos de
// recettes, les octets ne sont plus dans le document d'état.
export interface FileItem { id: string; name: string; folderId: string; type: FileType; date: string; fileId?: number | null; }
/**
 * Un créneau du planning porte plusieurs plats : une entrée, un plat, un dessert
 * se choisissent séparément. Chacun est soit une recette du carnet, soit un
 * texte libre (« restes », « pizza », « chez les parents »).
 *
 * L'enveloppe `MealValue` existe pour ce qu'elle accueillera ensuite sans
 * changer de forme une seconde fois : le nombre de couverts réel et les convives
 * absents, prévus au modèle cible.
 */
export interface MealItem { rid?: string; text?: string; }
export interface MealValue {
  items: MealItem[];
  /** Couverts posés à la main. Priment sur le décompte des présents. */
  pax?: number | null;
  /** Membres exceptionnellement absents de ce créneau, en dérogation à la semaine type. */
  away?: string[];
}
// `photoId` désigne un fichier servi par /api/files : les octets ne sont plus
// dans le document, qui repartait en entier à chaque enregistrement.
export interface Recipe {
  id: string; name: string; level: string; color: string;
  photoId?: number | null;
  /**
   * Portions de la recette d'origine, et temps séparés. Le champ `time` en texte
   * libre qui les précédait était ambigu et inexploitable : la mise à l'échelle
   * des courses (recette pour 4, planning à 6) a besoin d'un nombre.
   */
  portions?: number | null;
  prepMin?: number | null;
  cookMin?: number | null;
  /** Page d'origine quand la recette vient d'un import. */
  source?: string | null;
  ingr: string[]; steps: string[];
}
export interface SchedSlot { id: string; who: string; day: string; start: string; end: string; label: string; k: SchedType; }
export interface Notif { id: string; title: string; desc: string; time: string; read: boolean; kind: string; }
export interface Profile { name: string; role: string; email: string; phone: string; color: string; memberId: string; }
export interface Settings {
  dateFmt: string;
  dark: boolean; prefNotifs: boolean;
  academie?: string;
  /** Show the breakfast row in the meal planner. Off by default: rarely planned. */
  showBreakfast?: boolean;
}

export interface HouseholdState {
  familyName: string;
  members: Member[];
  events: EventItem[];
  aisles: Aisle[];
  articles: Article[];
  shopLists: ShopList[];
  shop: ShopItem[];
  taskLists: TaskList[];
  tasks: TaskItem[];
  msgs: Message[];
  contacts: Contact[];
  folders: Folder[];
  files: FileItem[];
  meals: Record<string, MealValue>;
  recipes: Recipe[];
  sched: SchedSlot[];
  profile: Profile;
  settings: Settings;
}
