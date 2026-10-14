import { CardFormat, ListKind, Rayon } from './models';
import { todayIn, weekdayOf } from './helpers';
import { PasteMode, SchedClip } from './sched-copy';
import { HOUSEHOLD_TZ, SCREENS } from './constants';
import { ItemRef } from './items';

/** All ephemeral UI state (navigation, modals, form buffers, selections). Not persisted, except the current `screen` which is restored across a refresh. */
export interface UiState {
  screen: string;
  selDay: string;
  toast: string;
  /** Le toast en cours propose-t-il une action ? `toastLabel` la nomme (« Annuler » le plus souvent). */
  toastUndo: boolean; toastLabel: string;
  notifOpen: boolean;
  addMenuOpen: boolean;
  searchOpen: boolean;
  searchQuery: string;

  // calendar
  calView: 'month' | 'week' | '3';
  /**
   * Jour d'ancrage de la vue : le mois affiché, ou une date de la semaine / des
   * trois jours montrés. Le mini-calendrier du panneau latéral en dérive son
   * mois, si bien que naviguer d'un côté suit de l'autre.
   */
  calAnchor: string;
  /**
   * Affichage des vues Semaine et 3 jours : la grille horaire (24 h, les
   * événements posés à leur heure, les chevauchements côte à côte) ou la liste
   * empilée. Choix d'affichage local, comme la vue ; sans effet en vue Mois.
   */
  calDisplay: 'grid' | 'list';
  /** Le bandeau de droite (mini-calendrier, détail du jour) est-il affiché ? Sur grand écran seulement. */
  calSide: boolean;
  /**
   * Types d'éléments masqués dans le calendrier (« event », « planning »,
   * « task », « birthday », « holiday », « school », « echeance »). Vide = tout
   * s'affiche. Filtre d'affichage local, comme la vue.
   */
  calHidden: string[];
  // meals
  /**
   * Jour d'ancrage du planning. En vue semaine, la semaine qui le contient ; en
   * vue 3 jours, lui et les deux suivants. Un simple décalage de semaines ne
   * suffisait plus dès lors que la fenêtre peut faire trois jours.
   */
  mealAnchor: string;
  /** Vide = automatique : trois jours sur téléphone, la semaine sur grand écran. */
  mealView: '' | '3' | 'week';
  /** Rapport de génération de la liste, affiché avant d'écrire quoi que ce soit. */
  genOpen: boolean;
  /** Recopie d'une période sur la période affichée. `dupBack` = de combien de périodes en arrière. */
  dupOpen: boolean; dupBack: number; dupMode: 'fill' | 'replace';
  /** Rapport d'import du carnet, affiché avant de créer quoi que ce soit. */
  importOpen: boolean;
  /**
   * Reprise des ingrédients non rattachés. `repForm` vide = la liste ; sinon la
   * forme en cours de reprise, et `repMode` dit lequel des deux gestes est ouvert.
   */
  repairOpen: boolean; repForm: string; repMode: 'lier' | 'creer';
  repSearch: string; repName: string; repRayon: Rayon; repPantry: boolean; repAllerg: string[];

  /**
   * La fiche d'élément ouverte par-dessus l'écran courant, ou null. Seul état
   * d'ouverture d'un élément : le brouillon d'édition vit dans le composant de
   * formulaire, pas ici. Jamais retenue d'un chargement à l'autre.
   */
  item: ItemRef | null;

  // courses
  newShop: string;
  /** Réordonnancement des rayons : l'ordre des allées du magasin habituel. */
  aisleOrderOpen: boolean;
  /** Rayons repliés (par identifiant) : on masque leurs articles, cochés ou non. Par appareil, non persisté. */
  collapsedAisles: string[];
  // shop lists
  activeShopList: string;

  // tâches
  /** Terminées dépliées, listes archivées montrées, section « À venir » repliée. */
  showDone: boolean; showArchived: boolean; soonCollapsed: boolean;
  // listes de tâches
  activeList: string; listForm: boolean; listEditId: string | null;
  lName: string; lColor: string; lIcon: string; lKind: ListKind; lScope: string; listDelId: string | null;
  /** Mode de rangement de la liste éditée : 'manuel' (ordre à la main) ou 'echeance' (par date). */
  lOrder: 'manuel' | 'echeance';
  /** Champs propres aux listes de préparation (kind 'preparation'). */
  lForMember: string | null; lDeparture: string; lRemind: number;
  /** Lieu de destination lié à la préparation, ou '' : l'écran montre alors son inventaire. */
  lPlace: string;
  /** Liste dont on demande la remise à zéro (modale de confirmation). */
  prepResetId: string | null;
  /** Choix d'un modèle pour créer une liste. */
  tplOpen: boolean;

  // contacts
  contactSearch: string; contactCat: string;
  contactForm: boolean; coEditId: string | null;
  coName: string; coRole: string; coPhone: string; coEmail: string; coCat: string; coColor: string; coUrgent: boolean; coBirthday: string;
  contactDelId: string | null;

  // cartes de fidélité
  cardSearch: string;
  cardForm: boolean; caEditId: string | null;
  caName: string; caCode: string; caFormat: CardFormat; caColor: string; caNote: string;
  /** L'utilisateur a choisi la couleur : le nom ne la reppropose plus. */
  caColorTouched: boolean;
  /** Logo choisi (data-URI), ou '' pour le monogramme. */
  caLogo: string;
  /** Recherche de logo en cours, et les logos proposés (data-URI) tirés du nom. */
  logoBusy: boolean; logoOpts: { name: string; domain: string; dataUri: string }[];
  /** Une recherche a été lancée : distingue « pas encore cherché » de « rien trouvé ». */
  logoSearched: boolean;
  cardDelId: string | null;
  /** Carte affichée en plein écran (son code réaffiché), ou null. */
  cardShow: string | null;
  /** La modale de scan par la caméra est ouverte. */
  scanOpen: boolean;

  // recipes
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
  famNameField: string;
  memberForm: boolean; mfEditId: string | null; mfName: string; mfRole: string; mfEmail: string; mfColor: string; mfAdmin: boolean; mfEnfant: boolean; mfBirthday: string; memberDelId: string | null;
  /** Contraintes alimentaires en cours d'édition, et recherche d'aliment refusé. */
  mfAllerg: string[]; mfRefuse: string[]; mfRefuseQ: string;
  /** La section ouverte dans Paramètres : l'accordéon sur téléphone, l'onglet sur grand écran. */
  settingsSection: string;
  pfName: string; pfRole: string; pfIni: string; pfEmail: string; pfColor: string;

  // member login account management
  accountFor: string | null; acEmail: string; acPassword: string; acBusy: boolean;
}

/**
 * Écran courant, retenu sur l'appareil : un F5 sur le Calendrier doit rouvrir le
 * Calendrier, pas l'accueil. C'est un choix d'affichage local, comme la largeur
 * du menu, et non un état du foyer : il vit dans localStorage, pas dans le
 * document. On ne restaure qu'un écran connu, jamais une valeur douteuse.
 */
const SCREEN_KEY = 'foyer.screen';
const KNOWN_SCREENS: ReadonlySet<string> = new Set(SCREENS);
export function rememberScreen(screen: string): void {
  try { localStorage.setItem(SCREEN_KEY, screen); } catch { /* mode privé : le choix vaut pour la session */ }
}
function persistedScreen(): string {
  try { const s = localStorage.getItem(SCREEN_KEY); return s && KNOWN_SCREENS.has(s) ? s : 'home'; } catch { return 'home'; }
}

/**
 * Vue d'agenda à l'ouverture. Le mois donne la vue d'ensemble qu'un grand écran
 * a la place d'afficher ; sur téléphone il se resserre à quelques pixels par
 * case, où « 3 jours » se lit bien mieux. Même seuil que le châssis (860 px).
 */
function defaultCalView(): UiState['calView'] {
  try { return window.innerWidth < 860 ? '3' : 'month'; } catch { return 'month'; }
}

/**
 * Affichage par défaut des vues à colonnes. La grille horaire donne le meilleur
 * de la journée sur grand écran ; sur téléphone, sept colonnes de 24 h se lisent
 * mal au doigt, la liste empilée y démarre donc, l'utilisateur bascule à sa
 * guise. Même seuil que le châssis (860 px).
 */
function defaultCalDisplay(): UiState['calDisplay'] {
  try { return window.innerWidth < 860 ? 'list' : 'grid'; } catch { return 'grid'; }
}

export function initialUi(): UiState {
  const today = todayIn(HOUSEHOLD_TZ);
  return {
    screen: persistedScreen(), selDay: today, toast: '', toastUndo: false, toastLabel: 'Annuler', notifOpen: false, addMenuOpen: false,
    searchOpen: false, searchQuery: '',
    calView: defaultCalView(), calAnchor: today, calDisplay: defaultCalDisplay(), calSide: true, calHidden: [],
    mealAnchor: today, mealView: '', genOpen: false, dupOpen: false, dupBack: 1, dupMode: 'fill', importOpen: false,
    repairOpen: false, repForm: '', repMode: 'lier', repSearch: '', repName: '', repRayon: 'epicerie', repPantry: false, repAllerg: [],
    item: null,
    newShop: '',
    aisleOrderOpen: false, collapsedAisles: [],
    activeShopList: 'all',
    showDone: false, showArchived: false, soonCollapsed: false,
    activeList: 'all', listForm: false, listEditId: null, lName: '', lColor: '#E56B4E', lIcon: 'checklist', lKind: 'taches', lScope: 'shared', lOrder: 'echeance', listDelId: null,
    lForMember: null, lDeparture: '', lRemind: 3, lPlace: '', prepResetId: null,
    tplOpen: false,
    contactSearch: '', contactCat: 'Tous',
    contactForm: false, coEditId: null, coName: '', coRole: '', coPhone: '', coEmail: '', coCat: 'Famille', coColor: '#9B6FA8', coUrgent: false, coBirthday: '', contactDelId: null,
    cardSearch: '',
    cardForm: false, caEditId: null, caName: '', caCode: '', caFormat: 'qr', caColor: '#E56B4E', caNote: '', caColorTouched: false, caLogo: '', logoBusy: false, logoOpts: [], logoSearched: false, cardDelId: null, cardShow: null, scanOpen: false,
    recipeSearch: '',
    schedWho: [], schedDow: weekdayOf(today), schedAnchor: today, schedMove: null,
    schedClip: null, schedPasteOpen: false, schedPasteMode: 'merge', schedPasteDows: [], schedPasteWho: null,
    famNameField: '',
    memberForm: false, mfEditId: null, mfName: '', mfRole: '', mfEmail: '', mfColor: '#9B6FA8', mfAdmin: false, mfEnfant: false, mfBirthday: '', memberDelId: null,
    mfAllerg: [], mfRefuse: [], mfRefuseQ: '',
    settingsSection: 'compte', pfName: '', pfRole: '', pfIni: '', pfEmail: '', pfColor: '#E56B4E',
    accountFor: null, acEmail: '', acPassword: '', acBusy: false,
  };
}
