import { FileType, Prio, Recur, SchedType } from './models';

export interface IngrRow { id: string; val: string; }

/** All ephemeral UI state (navigation, modals, form buffers, selections). Not persisted. */
export interface UiState {
  screen: string;
  selDay: string;
  moreOpen: boolean;
  toast: string;
  notifOpen: boolean;
  addMenuOpen: boolean;

  // calendar
  calView: 'month' | 'week' | '3';
  calAnchor: string;
  // meals
  weekOffset: number;
  mealEdit: { dateStr: string; slot: string } | null;
  mealMode: 'recipe' | 'text';
  mealRid: string | null;
  mealText: string;
  // budget
  monthOffset: number;

  // event modal + datepicker
  showEvent: boolean; evEditId: string | null;
  evTitle: string; evTime: string; evWho: string; evRecur: Recur; evEnd: string; evStart: string;
  evPickStart: boolean; dpMonth: number;

  // shop item modal
  showShop: boolean; shEditId: string | null;
  shTitle: string; shQty: string; shCat: string; shListId: string;
  newShop: string;
  // shop lists
  activeShopList: string; shopListForm: boolean; clEditId: string | null;
  clName: string; clColor: string; clIcon: string; shopListDelId: string | null;
  // aisles
  aiForm: boolean; aiEditId: string | null; aiName: string; aiColor: string; aisleDelId: string | null;

  // task modal
  showTask: boolean; taskEditId: string | null;
  tTitle: string; tWho: string; tDue: string; tPrio: Prio; tListId: string;
  newTask: string;
  // task lists
  activeList: string; listForm: boolean; listEditId: string | null;
  lName: string; lColor: string; lIcon: string; listDelId: string | null;

  // messages
  newMsg: string;

  // contacts
  contactSearch: string; contactCat: string;
  contactForm: boolean; coEditId: string | null;
  coName: string; coRole: string; coPhone: string; coEmail: string; coCat: string; coColor: string; coUrgent: boolean;
  contactDelId: string | null;

  // documents
  docFolder: string | null; docSearch: string;
  folderForm: boolean; foEditId: string | null; foName: string; foColor: string; folderDelId: string | null;
  fileForm: boolean; fiEditId: string | null; fiName: string; fiFolderId: string | null; fiType: FileType; fiData: string | null; fileDelId: string | null;

  // budget forms
  catForm: boolean; catEditId: string | null; cName: string; cBudget: string; cColor: string; cIcon: string; catDelId: string | null;
  txForm: boolean; txEditId: string | null; txName: string; txAmount: string; txIncome: boolean; txCatId: string | null; txDate: string;

  // recipes
  recipeForm: boolean; editingId: string | null; confirmDelId: string | null; openRecipeId: string | null;
  fName: string; fTime: string; fLevel: string; fColor: string; fPhoto: string | null; fIngr: IngrRow[]; fSteps: IngrRow[];

  // planning
  schedChild: string; schedEdit: boolean; seEditId: string | null;
  seDay: string; seStart: string; seEnd: string; seLabel: string; seType: SchedType;

  // family & profile
  familyOpen: boolean; famNameField: string;
  memberForm: boolean; mfEditId: string | null; mfName: string; mfRole: string; mfEmail: string; mfColor: string; mfAdmin: boolean; memberDelId: string | null;
  profileOpen: boolean; pfTab: 'infos' | 'prefs';
  pfName: string; pfRole: string; pfEmail: string; pfPhone: string; pfColor: string;
}

export function initialUi(): UiState {
  return {
    screen: 'home', selDay: '2026-07-16', moreOpen: false, toast: '', notifOpen: false, addMenuOpen: false,
    calView: 'month', calAnchor: '2026-07-16',
    weekOffset: 0, mealEdit: null, mealMode: 'recipe', mealRid: null, mealText: '',
    monthOffset: 0,
    showEvent: false, evEditId: null, evTitle: '', evTime: '', evWho: 'cam', evRecur: 'none', evEnd: '', evStart: '2026-07-16', evPickStart: true, dpMonth: 0,
    showShop: false, shEditId: null, shTitle: '', shQty: '', shCat: 'Fruits & légumes', shListId: 'cl1', newShop: '',
    activeShopList: 'cl1', shopListForm: false, clEditId: null, clName: '', clColor: '#7A9B76', clIcon: 'panier', shopListDelId: null,
    aiForm: false, aiEditId: null, aiName: '', aiColor: '#7A9B76', aisleDelId: null,
    showTask: false, taskEditId: null, tTitle: '', tWho: 'cam', tDue: "Aujourd'hui", tPrio: 'med', tListId: 'l1', newTask: '',
    activeList: 'all', listForm: false, listEditId: null, lName: '', lColor: '#E56B4E', lIcon: 'checklist', listDelId: null,
    newMsg: '',
    contactSearch: '', contactCat: 'Tous',
    contactForm: false, coEditId: null, coName: '', coRole: '', coPhone: '', coEmail: '', coCat: 'Famille', coColor: '#9B6FA8', coUrgent: false, contactDelId: null,
    docFolder: null, docSearch: '',
    folderForm: false, foEditId: null, foName: '', foColor: '#E56B4E', folderDelId: null,
    fileForm: false, fiEditId: null, fiName: '', fiFolderId: null, fiType: 'PDF', fiData: null, fileDelId: null,
    catForm: false, catEditId: null, cName: '', cBudget: '', cColor: '#7A9B76', cIcon: 'panier', catDelId: null,
    txForm: false, txEditId: null, txName: '', txAmount: '', txIncome: false, txCatId: 'c1', txDate: '',
    recipeForm: false, editingId: null, confirmDelId: null, openRecipeId: null,
    fName: '', fTime: '', fLevel: 'Facile', fColor: '#7A9B76', fPhoto: null, fIngr: [], fSteps: [],
    schedChild: 'lea', schedEdit: false, seEditId: null, seDay: 'Lundi', seStart: '', seEnd: '', seLabel: '', seType: 'ecole',
    familyOpen: false, famNameField: '',
    memberForm: false, mfEditId: null, mfName: '', mfRole: '', mfEmail: '', mfColor: '#9B6FA8', mfAdmin: false, memberDelId: null,
    profileOpen: false, pfTab: 'infos', pfName: '', pfRole: '', pfEmail: '', pfPhone: '', pfColor: '#E56B4E',
  };
}
