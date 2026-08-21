// Household domain model (backend). Mirrors the frontend models; new optional
// fields (planned/birthday/academie) are additive and backward-compatible.
import type { ShopItem } from './shopping/ops';

export interface Member { id: string; name: string; role: string; color: string; ini: string; admin?: boolean; email?: string; birthday?: string | null; }
export interface EventItem { id: string; date: string; time: string; title: string; who: string; recur: string; end?: string | null; }
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
 * ignore ou nomme mal, et gagne toujours contre elle.
 */
export interface Article {
  key: string; name: string; syn: string[]; rayon: Rayon;
  /** Denrée de fond de placard : proposée, mais exclue de la liste par défaut. */
  pantry?: boolean;
  allerg?: string[];
}
export interface ShopList { id: string; name: string; color: string; icon: string; }
// La forme d'un article et celle de ses mutations vivent avec le moteur qui les
// écrit réellement, article par article (voir shopping/ops.ts).
export type { ShopItem, ShopState } from './shopping/ops';
export interface TaskList { id: string; name: string; color: string; icon: string; }
export interface TaskItem { id: string; text: string; who: string; due: string; done: boolean; listId: string; prio: string; planned?: string | null; }
export interface Message { who: string; text: string; time: string; }
export interface Contact { id: string; name: string; role: string; phone: string; email: string; cat: string; color: string; urgent: boolean; birthday?: string | null; }
export interface Folder { id: string; name: string; color: string; }
export interface FileItem { id: string; name: string; folderId: string; type: string; date: string; data?: string | null; }
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
  /** Couverts réellement prévus, quand ils diffèrent de la taille du foyer. */
  pax?: number | null;
}
// `photoId` désigne une ligne de hh_attachments : les octets ne sont plus dans
// le document, qui repartait en entier à chaque enregistrement.
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
export interface SchedSlot { id: string; who: string; day: string; start: string; end: string; label: string; k: string; }
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
