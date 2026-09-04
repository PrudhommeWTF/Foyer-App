// Domain models for the Foyer household state.

export type Recur = 'none' | 'daily' | 'weekday' | 'weekly' | 'monthly';
export type SchedType = 'ecole' | 'travail' | 'sport' | 'loisir' | 'sante' | 'repas' | 'autre';
export type ContactCat = 'Urgences' | 'Santé' | 'École' | 'Famille' | 'Maison' | 'Autre';
export type FileType = 'PDF' | 'IMG' | 'DOC' | 'XLS' | 'AUTRE';

/**
 * `allerg` et `refuse` portent les contraintes alimentaires : allergènes de la
 * liste européenne, et clés d'articles du référentiel qu'on ne veut pas voir
 * arriver. Les deux sont confrontés au contenu des recettes (voir diet.ts).
 */
export interface Member { id: string; name: string; role: string; color: string; ini: string; admin?: boolean; email?: string; birthday?: string | null;
  allerg?: string[]; refuse?: string[]; }
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
/**
 * Type d'une liste de tâches. Seules les listes `taches` sont l'affaire du
 * jour : elles comptent dans « Toutes » et sur l'accueil. Une liste de corvées
 * ou une checklist (valise, fournitures, idées) vit dans son propre onglet,
 * sans peser sur la journée. C'est ce qui range « la tâche qui n'aurait jamais
 * dû en être une » : une liste d'idées est une checklist, hors du quotidien.
 */
export type ListKind = 'taches' | 'corvees' | 'checklist';
export interface TaskList {
  id: string; name: string; color: string; icon: string;
  kind: ListKind;
  /**
   * 'shared', ou l'identifiant du membre pour une liste privée. Privée veut
   * dire **cachée** aux autres membres, pas chiffrée : le document du foyer est
   * lu en entier par tout compte authentifié.
   */
  scope: string;
  position: number;
  archived?: boolean;
}
/** Un modèle de liste : un nom, un type, des intitulés. On en fait une liste en un geste. */
export interface TaskTemplate { id: string; name: string; kind: ListKind; color: string; icon: string; items: string[]; }
/**
 * Comment une tâche revient. Deux modes, et c'est le choix de fond du module :
 * `base: 'due'` à date fixe (les poubelles du mardi), `base: 'done'` à partir
 * de la réalisation (le test de la piscine, une semaine après l'avoir fait,
 * qu'il ait été fait samedi ou dimanche : sans cela l'application accumule un
 * retard fictif et devient un reproche). `grace` est la tolérance en jours
 * avant d'être en retard, pour ce qui se fait « vers le 15 avril ». Le calcul
 * de l'occurrence suivante vit dans recurrence.ts.
 */
export interface TaskRec {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Toutes les N unités. 1 par défaut. */
  every: number;
  /** Hebdomadaire à date fixe : les jours, lundi = 1 … dimanche = 7. */
  days?: number[];
  base: 'due' | 'done';
  grace?: number;
  until?: string | null;
}
/**
 * Le réglage de rappel d'une tâche. Aucun par défaut, réglé tâche par tâche.
 * L'heure qui en découle est calculée par le serveur (backend notify/reminders.ts) :
 * à l'heure de la tâche (9 h sans heure), une heure avant, la veille à 18 h, le matin à 9 h.
 */
export type Remind = 'at' | '1h' | 'eve' | 'morning';
/** Une réalisation passée d'une série : quand, par qui, et l'échéance qu'elle soldait. */
export interface TaskDone { at: string; by: string | null; due: string | null; }
/**
 * Une tâche. Elle ne voyage plus dans l'enregistrement du document : chaque
 * geste est une opération ciblée (voir task-ops.ts), ce qui rend impossible
 * qu'un téléphone périmé décoche ce que l'autre vient de cocher.
 */
export interface TaskItem {
  id: string; listId: string; text: string;
  note?: string;
  /** Catégorie libre : « Maison », « Administratif »… Sert à organiser, pas à filtrer le jour. */
  cat?: string;
  /** Membres affectés. Vide veut dire « le premier qui passe », et c'est licite. */
  who: string[];
  /** Échéance, AAAA-MM-JJ. Null : aucun jour en particulier. */
  due: string | null;
  /** Heure de l'échéance, HH:MM. Ignorée sans `due`. */
  time?: string | null;
  done: boolean;
  /** Qui a coché, et quand. Sert à l'afficher, pas à arbitrer. */
  doneAt?: string | null; doneBy?: string | null;
  /** Auteur et date de création. */
  by?: string | null; at?: string | null;
  /**
   * Liste de courses que cette tâche ouvre. La tâche reste entièrement à
   * l'utilisateur (il la coche, la déplace, la supprime) : le lien n'est qu'un
   * raccourci, et le compte des articles restants, une information de plus.
   */
  shopListId?: string | null;
  /**
   * Une série : la tâche porte son échéance **courante**. La cocher inscrit une
   * ligne dans `history` et avance `due`. Il n'y a pas une tâche par
   * occurrence, donc rien qui s'accumule et rien à purger.
   */
  rec?: TaskRec | null;
  history?: TaskDone[];
  /** Rappel avant l'échéance. Sans échéance, il n'a pas de sens et n'est pas gardé. */
  remind?: Remind | null;
  /**
   * Contrat du module Finances dont la tâche découle (échéance, piste
   * d'économie). Un raccourci, comme la liste de courses : la tâche reste au
   * foyer. Les contrats ne vivent pas dans le document ; si celui-ci a disparu,
   * c'est l'écran Finances qui le dit.
   */
  contractId?: number | null;
  /** Document du foyer (FileItem.id) que la tâche ouvre. Tombe avec le document. */
  docId?: string | null;
}
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
  /** Étiquettes libres du foyer : « végétarien », « du dimanche », « des enfants ». */
  tags?: string[];
  /**
   * Note de la famille, de 1 à 5. Elle sert à retrouver ce qu'on a aimé et pèse
   * dans les suggestions, en dernier critère : une bonne note ne doit pas
   * l'emporter sur « pas fait depuis trois semaines », sinon on mangerait
   * toujours la même chose.
   */
  rating?: number | null;
  ingr: string[]; steps: string[];
}
/**
 * Un créneau de la semaine type.
 *
 * `who` porte **plusieurs** membres, et c'est le choix de fond du module : un
 * emploi du temps de foyer n'est pas quatre agendas côte à côte, c'est un
 * agenda partagé où chaque créneau porte une ou plusieurs personnes. La messe
 * du dimanche, un trajet en voiture, un repas de famille sont une ligne, pas
 * quatre. Une liste vide est licite et se lit « sans membre » : c'est ce que
 * deviennent les créneaux dont le membre a été supprimé, plutôt que de partir
 * avec lui.
 *
 * `dow` numérote le jour, lundi = 1 et dimanche = 7, comme `weekdayOf` et la
 * semaine type des repas (voir presence.ts).
 */
/**
 * Quand un créneau vaut. Trois concepts, pas plus, inspirés d'iCalendar réduit à
 * ce qu'un foyer utilise : une règle hebdomadaire, une fenêtre de validité, une
 * liste d'occurrences annulées. Voir docs/emploi-du-temps.md.
 */
export type SchedRec = 'weekly' | 'once';
/** Filtre calendaire : toujours, seulement en période scolaire, seulement en vacances. */
export type SchedWhen = 'always' | 'school' | 'holidays';

export interface SchedSlot {
  id: string; who: string[]; dow: number; start: string; end: string; label: string; k: SchedType;
  /**
   * Le créneau se passe **hors du foyer**. C'est de là que vient le nombre de
   * couverts : personne n'est attendu à table pendant un créneau marqué ainsi
   * (voir presence.ts). Un créneau à la maison, lui, ne dit rien de plus que
   * ce qu'il est.
   */
  away?: boolean;
  /** Toutes les semaines (le cas majoritaire) ou une seule fois. */
  rec: SchedRec;
  /** Pour `once` : la date de l'unique occurrence. Ignoré sinon. */
  date?: string;
  /**
   * Période de validité d'une règle hebdomadaire, bornes incluses. Sans elle,
   * l'emploi du temps de l'an dernier pollue celui de cette année : les
   * activités démarrent en septembre et s'arrêtent en juin.
   */
  from?: string;
  until?: string | null;
  when?: SchedWhen;
  /** Occurrences annulées, en dates ISO. C'est l'EXDATE d'iCalendar. */
  skip?: string[];
  /** Occurrence détachée : la série dont elle vient, pour pouvoir la retrouver. */
  srcId?: string;
}
export interface Notif { id: string; title: string; desc: string; time: string; read: boolean; kind: string; }
export interface Profile { name: string; role: string; email: string; phone: string; color: string; memberId: string; }
export interface Settings {
  dateFmt: string;
  dark: boolean; prefNotifs: boolean;
  academie?: string;
  /** Show the breakfast row in the meal planner. Off by default: rarely planned. */
  showBreakfast?: boolean;
  /** Include open dated tasks in the shared ICS feed. Off by default: the feed is the family calendar. */
  icsTasks?: boolean;
}

export interface HouseholdState {
  familyName: string;
  members: Member[];
  events: EventItem[];
  aisles: Aisle[];
  articles: Article[];
  /**
   * « J'ai déjà ça » : clé d'article (ou nom normalisé si non reconnu) vers la
   * date du geste. Ce n'est pas un inventaire, qui demanderait une tenue
   * quotidienne et ferait rater des achats dès qu'il est mal tenu : juste la
   * mémoire de ce qu'on a dit avoir, avec sa date, qui se périme (voir
   * shopping-plan.ts, STOCK_DAYS).
   */
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
