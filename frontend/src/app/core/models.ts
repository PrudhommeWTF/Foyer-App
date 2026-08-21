// Domain models for the Foyer household state.

export type Recur = 'none' | 'daily' | 'weekday' | 'weekly' | 'monthly';
export type Prio = 'low' | 'med' | 'high';
export type SchedType = 'ecole' | 'travail' | 'sport' | 'loisir' | 'sante' | 'repas' | 'autre';
export type ContactCat = 'Urgences' | 'Santé' | 'École' | 'Famille' | 'Maison' | 'Autre';
export type FileType = 'PDF' | 'IMG' | 'DOC' | 'XLS' | 'AUTRE';

export interface Member { id: string; name: string; role: string; color: string; ini: string; admin?: boolean; email?: string; birthday?: string | null; }
export interface EventItem { id: string; date: string; time: string; title: string; who: string; recur: Recur; end?: string | null; }
export interface Aisle { id: string; name: string; color: string; position: number; }
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
}
export interface TaskList { id: string; name: string; color: string; icon: string; }
export interface TaskItem { id: string; text: string; who: string; due: string; done: boolean; listId: string; prio: Prio; planned?: string | null; }
export interface Message { who: string; text: string; time: string; }
export interface Contact { id: string; name: string; role: string; phone: string; email: string; cat: ContactCat; color: string; urgent: boolean; birthday?: string | null; }
export interface Folder { id: string; name: string; color: string; }
export interface FileItem { id: string; name: string; folderId: string; type: FileType; date: string; data?: string | null; }
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
export interface MealValue { items: MealItem[]; }
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
