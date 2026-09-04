// Household domain model (backend). Mirrors the frontend models; new optional
// fields (planned/birthday/academie) are additive and backward-compatible.
import type { ShopItem } from './shopping/ops';
import type { TaskItem } from './tasks/ops';
import type { HouseholdSettings } from './settings/registry';

// `allerg` et `refuse` portent les contraintes alimentaires du membre : voir
// frontend/src/app/core/diet.ts pour ce qui en est dérivé.
export interface Member { id: string; name: string; role: string; color: string; ini: string; admin?: boolean; email?: string; birthday?: string | null;
  allerg?: string[]; refuse?: string[]; }
export interface EventItem { id: string; date: string; time: string; title: string; who: string; recur: string; end?: string | null;
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
/**
 * Type d'une liste de tâches. Seules les listes `taches` sont l'affaire du
 * jour : elles comptent dans « Toutes » et sur l'accueil. Une liste de corvées
 * ou une checklist (valise, fournitures, idées) vit dans son propre onglet.
 */
export type ListKind = 'taches' | 'corvees' | 'checklist';
export interface TaskList {
  id: string; name: string; color: string; icon: string;
  kind: ListKind;
  /** 'shared', ou l'identifiant du membre pour une liste privée (cachée aux autres, pas chiffrée). */
  scope: string;
  position: number;
  archived?: boolean;
}
/** Un modèle de liste : un nom, un type, des intitulés. On en fait une liste en un geste. */
export interface TaskTemplate { id: string; name: string; kind: ListKind; color: string; icon: string; items: string[]; }
// La forme d'une tâche et celle de ses mutations vivent avec le moteur qui les
// écrit réellement, tâche par tâche (voir tasks/ops.ts).
export type { TaskItem } from './tasks/ops';
export interface Message { who: string; text: string; time: string; }
export interface Contact { id: string; name: string; role: string; phone: string; email: string; cat: string; color: string; urgent: boolean; birthday?: string | null; }
export interface Folder { id: string; name: string; color: string; }
// `fileId` désigne un fichier servi par /api/files : les octets ne sont plus
// dans le document (voir state/migrations.ts, migration 5).
export interface FileItem { id: string; name: string; folderId: string; type: string; date: string; fileId?: number | null; }
/**
 * Un créneau du planning porte plusieurs plats : une entrée, un plat, un dessert
 * se choisissent séparément. Chacun est soit une recette du carnet, soit un
 * texte libre (« restes », « pizza », « chez les parents »).
 */
export interface MealItem { rid?: string; text?: string; }
export interface MealValue {
  items: MealItem[];
  /** Couverts posés à la main. Priment sur le décompte des présents. */
  pax?: number | null;
  /** Membres exceptionnellement absents de ce créneau (voir frontend presence.ts). */
  away?: string[];
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
  /** Étiquettes libres du foyer, et note de la famille de 1 à 5. */
  tags?: string[];
  rating?: number | null;
  ingr: string[]; steps: string[];
}
/**
 * Un créneau de la semaine type. `who` porte **plusieurs** membres : la messe du
 * dimanche ou un trajet en voiture concernent tout le monde, et les recopier une
 * fois par personne était une régression, pas une solution. `dow` numérote le
 * jour (lundi = 1, dimanche = 7), comme partout ailleurs dans l'application.
 */
export interface SchedSlot {
  id: string; who: string[]; dow: number; start: string; end: string; label: string; k: string;
  /** Le créneau se passe hors du foyer : c'est de là que vient le compte des couverts. */
  away?: boolean;
  /** 'weekly' ou 'once'. Voir docs/emploi-du-temps.md pour le modèle complet. */
  rec: string;
  date?: string;
  from?: string;
  until?: string | null;
  when?: string;
  skip?: string[];
  srcId?: string;
}
export interface Profile { name: string; role: string; email: string; phone: string; color: string; memberId: string; }
/**
 * Les réglages du foyer. Leur forme est **dérivée du registre** : un réglage se
 * déclare dans settings/registry.ts et nulle part ailleurs, et se lit avec
 * `setting('cle', doc)`. Tout est facultatif, la valeur par défaut prend le
 * relais, ce qui rend un document ancien lisible sans migration.
 */
export type Settings = HouseholdSettings;

export interface HouseholdState {
  familyName: string;
  members: Member[];
  events: EventItem[];
  aisles: Aisle[];
  articles: Article[];
  /** « J'ai déjà ça » : clé d'article vers la date du geste. Voir frontend shopping-plan.ts. */
  stock?: Record<string, string>;
  shopLists: ShopList[];
  shop: ShopItem[];
  taskLists: TaskList[];
  taskTemplates: TaskTemplate[];
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
