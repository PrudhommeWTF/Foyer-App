import { FileType, MealItem, Prio, Rayon, Recur, SchedType, ShopState } from './models';
import { dstr } from './helpers';

export interface IngrRow { id: string; val: string; }

/** All ephemeral UI state (navigation, modals, form buffers, selections). Not persisted. */
export interface UiState {
  screen: string;
  selDay: string;
  moreOpen: boolean;
  toast: string;
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
  /** Couverts du créneau en cours d'édition. Vide = la taille du foyer. */
  mealPax: string;
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

  // task modal
  showTask: boolean; taskEditId: string | null;
  tTitle: string; tWho: string; tDue: string; tPrio: Prio; tListId: string; tPlanned: string;
  newTask: string;
  // task lists
  activeList: string; listForm: boolean; listEditId: string | null;
  lName: string; lColor: string; lIcon: string; listDelId: string | null;

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

  // planning
  schedChild: string; schedEdit: boolean; seEditId: string | null;
  seDay: string; seStart: string; seEnd: string; seLabel: string; seType: SchedType;

  // family & profile
  familyOpen: boolean; famNameField: string;
  memberForm: boolean; mfEditId: string | null; mfName: string; mfRole: string; mfEmail: string; mfColor: string; mfAdmin: boolean; mfBirthday: string; memberDelId: string | null;
  profileOpen: boolean; pfTab: 'infos' | 'prefs';
  pfName: string; pfRole: string; pfEmail: string; pfColor: string;

  // member login account management
  accountFor: string | null; acEmail: string; acPassword: string; acBusy: boolean;
}

export function initialUi(): UiState {
  const today = dstr(new Date());
  return {
    screen: 'home', selDay: today, moreOpen: false, toast: '', notifOpen: false, addMenuOpen: false,
    searchOpen: false, searchQuery: '',
    calView: 'month', calAnchor: today,
    mealAnchor: today, mealView: '', mealEdit: null, mealItems: [], mealText: '', mealPax: '', genOpen: false, dupOpen: false, dupBack: 1, dupMode: 'fill', moveOpen: false, importOpen: false,
    repairOpen: false, repForm: '', repMode: 'lier', repSearch: '', repName: '', repRayon: 'epicerie', repPantry: false, repAllerg: [],
    showEvent: false, evEditId: null, evTitle: '', evTime: '', evWho: 'cam', evRecur: 'none', evEnd: '', evStart: today, evPickStart: true, dpMonth: 0,
    showShop: false, shEditId: null, shTitle: '', shQty: '', shState: 'a-prendre', shAisleId: '', shListId: '', newShop: '',
    aisleOrderOpen: false,
    activeShopList: 'all', shopListForm: false, clEditId: null, clName: '', clColor: '#7A9B76', clIcon: 'panier', shopListDelId: null,
    aiForm: false, aiEditId: null, aiName: '', aiColor: '#7A9B76', aiKind: '', aisleDelId: null,
    showTask: false, taskEditId: null, tTitle: '', tWho: 'cam', tDue: "Aujourd'hui", tPrio: 'med', tListId: 'l1', tPlanned: '', newTask: '',
    activeList: 'all', listForm: false, listEditId: null, lName: '', lColor: '#E56B4E', lIcon: 'checklist', listDelId: null,
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
    schedChild: 'lea', schedEdit: false, seEditId: null, seDay: 'Lundi', seStart: '', seEnd: '', seLabel: '', seType: 'ecole',
    familyOpen: false, famNameField: '',
    memberForm: false, mfEditId: null, mfName: '', mfRole: '', mfEmail: '', mfColor: '#9B6FA8', mfAdmin: false, mfBirthday: '', memberDelId: null,
    profileOpen: false, pfTab: 'infos', pfName: '', pfRole: '', pfEmail: '', pfColor: '#E56B4E',
    accountFor: null, acEmail: '', acPassword: '', acBusy: false,
  };
}
