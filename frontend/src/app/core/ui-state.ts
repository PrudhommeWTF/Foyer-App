import { FileType, ListKind, MealItem, Rayon, Recur, SchedRec, SchedType, SchedWhen, ShopState } from './models';
import { todayIn, weekdayOf } from './helpers';
import { PasteMode, SchedClip } from './sched-copy';
import { SchedScope } from './schedule';
import { HOUSEHOLD_TZ } from './constants';

export interface IngrRow { id: string; val: string; }

/** All ephemeral UI state (navigation, modals, form buffers, selections). Not persisted. */
export interface UiState {
  screen: string;
  selDay: string;
  moreOpen: boolean;
  toast: string;
  /** Le toast en cours propose-t-il une action ? `toastLabel` la nomme (« Annuler » le plus souvent). */
  toastUndo: boolean; toastLabel: string;
  notifOpen: boolean;
  addMenuOpen: boolean;
  searchOpen: boolean;
  searchQuery: string;

  // calendar
  calView: 'month' | 'week' | '3';
  calAnchor: string;
  // meals
  /**
   * Jour d'ancrage du planning. En vue semaine, la semaine qui le contient ; en
   * vue 3 jours, lui et les deux suivants. Un simple décalage de semaines ne
   * suffisait plus dès lors que la fenêtre peut faire trois jours.
   */
  mealAnchor: string;
  /** Vide = automatique : trois jours sur téléphone, la semaine sur grand écran. */
  mealView: '' | '3' | 'week';
  mealEdit: { dateStr: string; slot: string } | null;
  /** Plats retenus pour le créneau en cours d'édition, dans l'ordre du service. */
  mealItems: MealItem[];
  mealText: string;
  /** Couverts du créneau en cours d'édition. Vide = le décompte des présents. */
  mealPax: string;
  /** Convives exceptionnellement absents du créneau en cours d'édition. */
  mealAway: string[];
  /** Suggestions dépliées dans la modale d'un créneau. */
  mealSuggest: boolean;
  /** Rapport de génération de la liste, affiché avant d'écrire quoi que ce soit. */
  genOpen: boolean;
  /** Recopie d'une période sur la période affichée. `dupBack` = de combien de périodes en arrière. */
  dupOpen: boolean; dupBack: number; dupMode: 'fill' | 'replace';
  /** Choix du créneau d'arrivée quand on déplace un repas. */
  moveOpen: boolean;
  /** Rapport d'import du carnet, affiché avant de créer quoi que ce soit. */
  importOpen: boolean;
  /**
   * Reprise des ingrédients non rattachés. `repForm` vide = la liste ; sinon la
   * forme en cours de reprise, et `repMode` dit lequel des deux gestes est ouvert.
   */
  repairOpen: boolean; repForm: string; repMode: 'lier' | 'creer';
  repSearch: string; repName: string; repRayon: Rayon; repPantry: boolean; repAllerg: string[];

  // event modal + datepicker
  showEvent: boolean; evEditId: string | null;
  evTitle: string; evTime: string; evWho: string; evRecur: Recur; evEnd: string; evStart: string;
  evPickStart: boolean; dpMonth: number;

  // shop item modal
  showShop: boolean; shEditId: string | null;
  shTitle: string; shQty: string; shState: ShopState; shAisleId: string; shListId: string;
  newShop: string;
  /** Réordonnancement des rayons : l'ordre des allées du magasin habituel. */
  aisleOrderOpen: boolean;
  // shop lists
  activeShopList: string; shopListForm: boolean; clEditId: string | null;
  clName: string; clColor: string; clIcon: string; shopListDelId: string | null;
  // aisles
  aiForm: boolean; aiEditId: string | null; aiName: string; aiColor: string; aiKind: Rayon | ''; aisleDelId: string | null;

  // tâches
  /** Tâche ouverte dans la modale de modification, ou null. `taskNew` ouvre la saisie en modale (menu « + »). */
  taskEdit: string | null; taskNew: boolean;
  /** Terminées dépliées, listes archivées montrées. */
  showDone: boolean; showArchived: boolean;
  // listes de tâches
  activeList: string; listForm: boolean; listEditId: string | null;
  lName: string; lColor: string; lIcon: string; lKind: ListKind; lScope: string; listDelId: string | null;
  /** Choix d'un modèle pour créer une liste. */
  tplOpen: boolean;

  // messages
  newMsg: string;

  // contacts
  contactSearch: string; contactCat: string;
  contactForm: boolean; coEditId: string | null;
  coName: string; coRole: string; coPhone: string; coEmail: string; coCat: string; coColor: string; coUrgent: boolean; coBirthday: string;
  contactDelId: string | null;

  // documents
  docFolder: string | null; docSearch: string;
  folderForm: boolean; foEditId: string | null; foName: string; foColor: string; folderDelId: string | null;
  fileForm: boolean; fiEditId: string | null; fiId: string; fiName: string; fiFolderId: string | null; fiType: FileType; fiFileId: number | null; fiBusy: boolean; fileDelId: string | null;

  // recipes
  recipeForm: boolean; editingId: string | null; confirmDelId: string | null; openRecipeId: string | null;
  fRecipeId: string;
  fName: string; fLevel: string; fColor: string; fPhotoId: number | null; fPhotoBusy: boolean; fIngr: IngrRow[]; fSteps: IngrRow[];
  fPortions: string; fPrepMin: string; fCookMin: string; fSource: string;
  /** Import depuis une URL : saisie, état d'attente et avertissements du lecteur. */
  fImportUrl: string; fImportBusy: boolean; fImportWarnings: string[];
  /** Étiquettes et note du foyer, dans le formulaire. */
  fTags: string[]; fTagInput: string; fRating: number;
  /** Import d'une recette collée en texte : la zone de saisie et son dépliage. */
  fPasteOpen: boolean; fPaste: string;
  /** Recherche du carnet : « courgette 20min ». */
  recipeSearch: string;

  // planning
  /**
   * Filtre par membre de l'emploi du temps. **Vide veut dire tout le foyer**,
   * jamais rien : la sélection est un affinage, pas un prérequis à l'affichage.
   */
  schedWho: string[];
  /** Jour montré par la vue jour (téléphone), lundi = 1. */
  schedDow: number;
  /**
   * Semaine affichée, par une de ses dates. La semaine type est un modèle, mais
   * la vue est **datée** : sans date, impossible de savoir si un créneau est
   * encore valide, si c'est les vacances, ni où poser un créneau ponctuel.
   */
  schedAnchor: string;
  schedEdit: boolean; seEditId: string | null;
  seDow: number; seWho: string[]; seStart: string; seEnd: string; seLabel: string; seType: SchedType;
  /** Récurrence et période, dans le formulaire. */
  seRec: SchedRec; seDate: string; seFrom: string; seUntil: string; seWhen: SchedWhen;
  /** Le créneau se passe hors du foyer : c'est ce qui retire un couvert. */
  seAway: boolean;
  /** Déplie les réglages de période, qui ne servent pas à la saisie courante. */
  seMore: boolean;
  /** La date de l'occurrence ouverte : c'est elle que visent « cette fois » et « à partir de ». */
  seOccDate: string;
  /** Portée d'une modification de série. */
  seScope: SchedScope;
  /** Confirmation de suppression, dépliée dans le formulaire plutôt qu'en modale sur modale. */
  seDelOpen: boolean;
  /**
   * Déplacement en cours par glisser-déposer, quand il reste à savoir s'il vaut
   * pour l'occurrence ou pour la série. Null le reste du temps.
   */
  schedMove: { id: string; dow: number } | null;
  /**
   * Presse-papier de l'emploi du temps : ce qui a été copié, **tel que la vue le
   * montrait**. C'est une photo, pas un lien : modifier l'original après la copie
   * ne change pas ce qui sera collé, comme n'importe quel presse-papier.
   */
  schedClip: SchedClip | null;
  schedPasteOpen: boolean;
  /**
   * Mode de collage, retenu d'une action à l'autre plutôt que redemandé à chaque
   * fois. Il ne survit pas à une reconnexion, et c'est voulu : « fusionner », qui
   * ne détruit rien, est le seul défaut acceptable au démarrage.
   */
  schedPasteMode: PasteMode;
  schedPasteDows: number[];
  /** Réattribution du collage à un autre membre, ou null pour garder l'original. */
  schedPasteWho: string | null;

  // family & profile
  familyOpen: boolean; famNameField: string;
  memberForm: boolean; mfEditId: string | null; mfName: string; mfRole: string; mfEmail: string; mfColor: string; mfAdmin: boolean; mfBirthday: string; memberDelId: string | null;
  /** Contraintes alimentaires en cours d'édition, et recherche d'aliment refusé. */
  mfAllerg: string[]; mfRefuse: string[]; mfRefuseQ: string;
  profileOpen: boolean;
  pfName: string; pfRole: string; pfEmail: string; pfColor: string;

  // member login account management
  accountFor: string | null; acEmail: string; acPassword: string; acBusy: boolean;
}

export function initialUi(): UiState {
  const today = todayIn(HOUSEHOLD_TZ);
  return {
    screen: 'home', selDay: today, moreOpen: false, toast: '', toastUndo: false, toastLabel: 'Annuler', notifOpen: false, addMenuOpen: false,
    searchOpen: false, searchQuery: '',
    calView: 'month', calAnchor: today,
    mealAnchor: today, mealView: '', mealEdit: null, mealItems: [], mealText: '', mealPax: '', mealAway: [], mealSuggest: false, genOpen: false, dupOpen: false, dupBack: 1, dupMode: 'fill', moveOpen: false, importOpen: false,
    repairOpen: false, repForm: '', repMode: 'lier', repSearch: '', repName: '', repRayon: 'epicerie', repPantry: false, repAllerg: [],
    showEvent: false, evEditId: null, evTitle: '', evTime: '', evWho: 'cam', evRecur: 'none', evEnd: '', evStart: today, evPickStart: true, dpMonth: 0,
    showShop: false, shEditId: null, shTitle: '', shQty: '', shState: 'a-prendre', shAisleId: '', shListId: '', newShop: '',
    aisleOrderOpen: false,
    activeShopList: 'all', shopListForm: false, clEditId: null, clName: '', clColor: '#7A9B76', clIcon: 'panier', shopListDelId: null,
    aiForm: false, aiEditId: null, aiName: '', aiColor: '#7A9B76', aiKind: '', aisleDelId: null,
    taskEdit: null, taskNew: false, showDone: false, showArchived: false,
    activeList: 'all', listForm: false, listEditId: null, lName: '', lColor: '#E56B4E', lIcon: 'checklist', lKind: 'taches', lScope: 'shared', listDelId: null,
    tplOpen: false,
    newMsg: '',
    contactSearch: '', contactCat: 'Tous',
    contactForm: false, coEditId: null, coName: '', coRole: '', coPhone: '', coEmail: '', coCat: 'Famille', coColor: '#9B6FA8', coUrgent: false, coBirthday: '', contactDelId: null,
    docFolder: null, docSearch: '',
    folderForm: false, foEditId: null, foName: '', foColor: '#E56B4E', folderDelId: null,
    fileForm: false, fiEditId: null, fiId: '', fiName: '', fiFolderId: null, fiType: 'PDF', fiFileId: null, fiBusy: false, fileDelId: null,
    recipeForm: false, editingId: null, confirmDelId: null, openRecipeId: null,
    fRecipeId: '', fName: '', fLevel: 'Facile', fColor: '#7A9B76', fPhotoId: null, fPhotoBusy: false, fIngr: [], fSteps: [],
    fPortions: '', fPrepMin: '', fCookMin: '', fSource: '',
    fImportUrl: '', fImportBusy: false, fImportWarnings: [],
    fTags: [], fTagInput: '', fRating: 0, fPasteOpen: false, fPaste: '', recipeSearch: '',
    schedWho: [], schedDow: weekdayOf(today), schedAnchor: today, schedEdit: false, seEditId: null,
    seDow: weekdayOf(today), seWho: [], seStart: '', seEnd: '', seLabel: '', seType: 'ecole',
    seRec: 'weekly', seDate: today, seFrom: '', seUntil: '', seWhen: 'always', seAway: true,
    seMore: false, seOccDate: today, seScope: 'all', seDelOpen: false, schedMove: null,
    schedClip: null, schedPasteOpen: false, schedPasteMode: 'merge', schedPasteDows: [], schedPasteWho: null,
    familyOpen: false, famNameField: '',
    memberForm: false, mfEditId: null, mfName: '', mfRole: '', mfEmail: '', mfColor: '#9B6FA8', mfAdmin: false, mfBirthday: '', memberDelId: null,
    mfAllerg: [], mfRefuse: [], mfRefuseQ: '',
    profileOpen: false, pfName: '', pfRole: '', pfEmail: '', pfColor: '#E56B4E',
    accountFor: null, acEmail: '', acPassword: '', acBusy: false,
  };
}
