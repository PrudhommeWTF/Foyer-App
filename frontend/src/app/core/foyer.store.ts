import { Injectable, computed, effect, signal, untracked } from '@angular/core';
import { ApiError, ApiService, PlaceOp, PlaceOpDraft, SettingsPayload, SetupPayload, ShopOp, ShopOpDraft, isOffline } from './api.service';
import { Mutation, asConflict, rebase } from './state-sync';
import { CardFormat, EventItem, HouseholdState, ListKind, MealItem, MealValue, Member, Notif, Place, PlaceItem, PlaceItemState, Rayon, Recipe, SchedSlot, ShopItem, ShopState, TaskItem, TaskList } from './models';
import { TaskDraft, TaskFields, TaskOp, TaskOpDraft, applyTaskOp, inverseOf } from './task-ops';
import { byOrd, singleMove } from './task-order';
import { REMIND_LABELS, categories, dailyTasks, dueLabel, subtasksOf, suggestTexts, visibleLists } from './tasks';
import { cardColor } from './cards';
import { downloadBlob } from './download';
import { askPersistence, clearCachedDoc, loadCachedDoc, packDoc, readDoc, saveCachedDoc, staleLabel } from './offline-doc';
import { nextOccurrence, skipOccurrence } from './recurrence';
import { buildArticleIndex, resolveArticleKey } from './ingredients';
import { PlanLine, PlanReport, aisleForRayon, buildPlan, keyOfLine } from './shopping-plan';
import { CopyReport, applyMealCopy } from './meal-copy';
import { closableShoppingTask, mealEventTitle, shoppingTaskLabel } from './links';
import { moveMeal } from './meal-move';
import { createArticle, learnRayon, linkForm, scanRecipes, searchArticles } from './ingredient-repair';
import { Conflict, checkRecipe, conflictLabel, hasDiet, mealConflicts } from './diet';
import { parseQuery, searchRecipes } from './recipe-search';
import { RecipeData, recipeChanges } from './recipe-form';
import { SlotDefaults, slotChanges } from './slot-form';
import { ShopDefaults, ShopFields, shopOps, shopRestoreOps } from './shop-item';
import { PlaceFields, PlaceItemFields, placeItemOps, placeItemRestoreOps, placeOps } from './place-item';
import { presenceAt } from './presence';
import { SuggestReport, daysBetween, lastServed, semaines, suggestMeals } from './suggest';
import { Allergene } from './articles';
import {
  ExportedPhoto, ImportError, ImportReport, buildBundle, fileName, parseBundle, planImport, recipeToText, shopToCsv,
} from './exports';
import { CalendarFacts, SchedScope, SlotEvent, calendarFacts, dowLabel, filterSlots, knownLabels, nextFreeStart, slotEventsOn, slotsOn } from './schedule';
import { PastePlan, applyPaste as applyPastePlan, pasteSummary, planPaste, undoPaste } from './sched-copy';
import { UiState, initialUi, rememberScreen } from './ui-state';
import { ECRANS_ADULTES } from '../shell/nav';
import { ModuleFlag, SCREEN_MODULE } from './modules';
import { EventDraft, EventFields, applyToSeries, detachOccurrence, draftChanges, eventDraft, isSeries, seriesDate, withSkip, withoutEvent, withoutSkip } from './event-scope';
import { ITEM_KINDS, ItemCtx, ItemKindId, ItemResult } from './items';
import { sheetBack, sheetEdit, sheetOpen, sheetSaved } from './item-sheet';
import { addDaysIso, ageOn, cap, contactIni, dstr, fmtNumericDate, isBirthdayOn, keptIni, normText, parseDay, todayIn, uid, weekDates, weekdayOf } from './helpers';
import { HOUSEHOLD_LOCALE, HOUSEHOLD_TZ, MEAL_SLOTS, isFallbackAisleName, tint, grad } from './constants';
import { DayExtra, SchoolHoliday, dayExtrasOn, eventsOn } from './agenda';
import { SettingDecl, SettingKey, SettingValue, declOf, householdDefaults, setting, validate } from './settings/registry';
import { mealItemName, mealNames, recipeTime, sameMeal, splitMealKey } from './meals';

/**
 * Octets vers base64, par tranches : `String.fromCharCode(...tableau)` dépasse la
 * taille d'appel autorisée dès quelques dizaines de milliers d'octets, et une
 * photo en fait des centaines de milliers.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// « Masquer les cochés » dans les courses : une préférence d'affichage propre à
// l'appareil (le magasin et la maison ne veulent pas la même vue), gardée dans
// localStorage comme l'écran courant, pas dans le document du foyer. Activée par
// défaut : en magasin, un article coché a disparu de ce qu'il reste à prendre.
const SHOP_HIDE_CHECKED_KEY = 'foyer.shopHideChecked';
function loadShopHideChecked(): boolean {
  try { return localStorage.getItem(SHOP_HIDE_CHECKED_KEY) !== '0'; } catch { return true; }
}


/**
 * File des opérations de courses pas encore acquittées par le serveur.
 *
 * Elle est persistée dans le navigateur, et c'est tout l'intérêt : les coches
 * faites dans un magasin sans réseau survivent à un onglet recyclé par iOS. Sans
 * cela, elles ne vivaient qu'en mémoire et disparaissaient sans un mot.
 */
const SHOP_QUEUE_KEY = 'foyer.shopQueue';
const TASK_QUEUE_KEY = 'foyer.taskQueue';
const PLACE_QUEUE_KEY = 'foyer.placeQueue';
function loadQueue<T>(key: string): T[] {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Durée d'un toast simple, et celle d'un toast qui propose de revenir en arrière. */
const TOAST_MS = 2600;
const UNDO_MS = 7000;

/** Délai avant de retenter un enregistrement que le réseau a fait échouer. */
const SAVE_RETRY_MS = 8000;

/**
 * Cadence de sondage des courses et des tâches, selon l'écran.
 *
 * En magasin, ou quand on coche chacun de son côté, la coche de l'autre doit
 * apparaître tout de suite. Sur l'accueil, savoir à quinze secondes près ce
 * qui reste suffit largement, et c'est l'écran qui reste ouvert toute la
 * journée : la même cadence y serait payée en batterie sans rien apporter.
 */
const LIVE_POLL_MS = 5000;
const HOME_POLL_MS = 15000;

export type { DayExtra, SchoolHoliday } from './agenda';
export interface SearchHit { kind: string; icon: string; color: string; title: string; sub: string; screen: string; id?: string; }

type SaveState = 'idle' | 'saving' | 'error';

@Injectable({ providedIn: 'root' })
export class FoyerStore {
  private _data = signal<HouseholdState | null>(null);
  readonly ui = signal<UiState>(initialUi());

  /** Version exécutée par le serveur, affichée dans Paramètres. */
  readonly version = signal('');

  readonly ready = signal(false);
  readonly authed = signal(false);
  readonly needsSetup = signal(false);
  readonly authError = signal('');
  readonly saveState = signal<SaveState>('idle');

  /** Ce qui empêche de charger le document, faute de réseau au démarrage. L'accueil l'affiche avec un bouton « Réessayer ». Vide quand tout va bien. */
  readonly docError = signal('');
  /**
   * Ce qui est à l'écran vient du dernier document gardé, faute de réseau au
   * démarrage. Porte la date de cette lecture : l'écran doit pouvoir dire de
   * quand il date, au lieu de laisser croire que c'est frais.
   */
  readonly docStaleAt = signal('');
  /** « Hors ligne, votre foyer tel qu'il était le 04/09/2026 à 14:12. » Vide quand tout est frais. */
  readonly staleNotice = computed(() => {
    const at = this.docStaleAt();
    if (!at) return '';
    const quand = staleLabel(at, (iso) => this.fmtNumDate(iso));
    return 'Hors ligne. Voici votre foyer tel qu’il était' + (quand ? ' ' + quand : '') + '. Vos gestes partiront au retour du réseau.';
  });

  // Current user & member login accounts (admin-managed).
  readonly isAdmin = signal(false);
  /** Membre mineur : les Paramètres lui sont fermés, et le serveur refuse aussi. */
  readonly isChild = signal(false);
  /** Le second facteur est-il posé sur ce compte, et combien de codes de secours restent. */
  readonly totpOn = signal(false);
  readonly totpRecoveryLeft = signal<number | null>(null);
  readonly currentMemberId = signal<string | null>(null);
  /** L'adresse avec laquelle on s'est connecté, telle que le serveur la connaît. */
  readonly myEmail = signal('');

  // Calendar overlays
  readonly schoolHolidays = signal<SchoolHoliday[]>([]);

  /**
   * Signaux de coordination vers AdminStore (dépendance à sens unique : ce
   * magasin ne connaît pas l'admin). `docLoadedAt` s'incrémente à chaque
   * document chargé pour armer le bootstrap d'administration ; `accountsRev`
   * quand la liste des comptes a bougé sans rechargement complet.
   */
  readonly docLoadedAt = signal(0);
  readonly accountsRev = signal(0);

  /** The household member for the currently authenticated user (NOT the shared profile). */
  readonly me = computed(() => {
    const d = this._data();
    if (!d) return null;
    const id = this.currentMemberId();
    return (id ? d.members.find((m) => m.id === id) : undefined)
      || d.members.find((m) => m.id === d.profile.memberId)
      || d.members[0]
      || null;
  });

  /** Le document du foyer, ou null tant qu'il n'est pas chargé. */
  readonly data = this._data.asReadonly();
  /**
   * Le document, garanti non nul. Réservé aux vues que le châssis ne rend que
   * lorsqu'il existe (voir shell.ts) : elles l'utilisaient toutes via le même
   * cast `data as () => NonNullable<...>`, recopié dans treize fichiers.
   */
  readonly d = computed(() => this._data()!);

  /**
   * Meal slots actually shown. Breakfast is opt-in: it is almost never planned
   * and costs a third of the grid height on a phone. Hiding it keeps whatever
   * was already recorded, it only stops displaying the row.
   */
  /**
   * Les heures de référence des repas, telles que le foyer les a réglées. Elles
   * décident de l'heure de l'événement créé quand un repas part à l'agenda, et
   * de qui est compté à table (voir presence.ts).
   */
  readonly mealTimes = computed<Record<string, string>>(() => ({
    matin: this.setting('mealTimeMorning'),
    midi: this.setting('mealTimeNoon'),
    soir: this.setting('mealTimeEvening'),
  }));
  readonly mealSlots = computed(() => MEAL_SLOTS
    .filter((s) => s.key !== 'matin' || this.setting('showBreakfast'))
    .map((s) => ({ ...s, at: this.mealTimes()[s.key] || s.at })));
  readonly narrow = signal(false);

  // Notifications lues (ids), portées par la fiche du membre dans le document :
  // marquer lu sur un appareil se voit sur les autres (le localStorage, lui,
  // restait sur l'appareil). Chacun a ses propres notifications, donc son propre
  // ensemble de lues.
  readonly readNotifs = computed<Set<string>>(() => {
    const me = this.currentMemberId();
    const m = me ? this._data()?.members.find((x) => x.id === me) : null;
    return new Set(m?.readNotifs || []);
  });

  // ---- regional formatting ----------------------------------------------
  // Foyer cible la France métropolitaine : locale et fuseau sont fixes.
  readonly locale = HOUSEHOLD_LOCALE;
  readonly timeZone = HOUSEHOLD_TZ;

  /**
   * Horloge du foyer.
   *
   * Sans elle, `todayStr()` est un `computed` qui appelle `new Date()` : aucun
   * signal ne change, il ne se réévalue donc jamais, et une application laissée
   * ouverte la nuit sur un iPad affiche encore la veille au matin.
   *
   * Une minute plutôt qu'un réveil calé sur minuit : c'est insensible aux
   * changements d'heure, et sans effet mesurable, un jour inchangé rendant la
   * même chaîne, ce qui arrête net la propagation.
   */
  private readonly tick = signal(0);
  private advanceClock(): void { this.tick.update((v) => v + 1); }

  /** Real "today" (YYYY-MM-DD) in the household time zone. */
  readonly todayStr = computed(() => {
    this.tick();
    return todayIn(this.timeZone);
  });

  /** ISO date → date courte française (24/07/2026). */
  fmtNumDate(iso: string): string { return fmtNumericDate(iso); }
  /** ISO date → long localized label (e.g. « jeudi 24 juillet »). */
  fmtLongDate(iso: string): string {
    try { return cap(parseDay(iso).toLocaleDateString(this.locale, { weekday: 'long', day: 'numeric', month: 'long' })); }
    catch { return iso; }
  }

  // ---- synchronisation des courses et des tâches --------------------------
  /** Version du document connue du sondage ; sert au sondage différentiel. */
  private liveVersion = 0;
  /** Opérations en attente d'acquittement, persistées (voir SHOP_QUEUE_KEY, TASK_QUEUE_KEY). */
  private shopQueue = signal<ShopOp[]>(loadQueue<ShopOp>(SHOP_QUEUE_KEY));
  private taskQueue = signal<TaskOp[]>(loadQueue<TaskOp>(TASK_QUEUE_KEY));
  private placeQueue = signal<PlaceOp[]>(loadQueue<PlaceOp>(PLACE_QUEUE_KEY));
  /** Nombre de gestes pas encore partis. Affiché : sans cela le doute est total. */
  readonly shopPending = computed(() => this.shopQueue().length);
  readonly taskPending = computed(() => this.taskQueue().length);
  readonly placePending = computed(() => this.placeQueue().length);
  /** Le serveur n'a pas répondu au dernier envoi ou sondage. */
  readonly syncOffline = signal(false);
  private shopFlushing = false;
  private taskFlushing = false;
  private placeFlushing = false;
  private shopFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private taskFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private placeFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private livePollTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Version du document connue de ce client, et modifications pas encore
   * acquittées par le serveur. Ensemble, elles permettent de rejouer plutôt que
   * de perdre quand quelqu'un d'autre a enregistré entre-temps (voir state-sync.ts).
   */
  private docVersion = 0;
  private pending: Mutation[] = [];
  private saving = false;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService) {
    // Theme side effect: reflect the theme setting onto <html>. Le thème est une
    // préférence personnelle : il suit le membre connecté, pas le foyer.
    effect(() => {
      document.documentElement.classList.toggle('dark', setting('dark', this._data(), this.currentMemberId()));
    });

    // La pastille sur l'icône de l'app suit le nombre de notifications non lues :
    // le même compteur que la cloche, porté sur l'icône (écran d'accueil, dock).
    // Quand l'app tourne, c'est elle qui pose le nombre exact ; le service worker
    // ne pose qu'un repère à la réception d'un push, faute de connaître le compte.
    // L'API n'existe pas partout (Firefox, iOS < 16.4) : elle est testée, et
    // setAppBadge(0) efface la pastille, comme clearAppBadge, d'où un seul appel.
    effect(() => {
      const n = this.unreadCount();
      const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<unknown> };
      nav.setAppBadge?.(n).catch(() => { /* pastille indisponible sur ce navigateur */ });
    });

    // Les photos sont téléchargées avec la session dès qu'une recette en cite
    // une. `untracked` évite que la mise en cache relance l'effet en boucle.
    effect(() => {
      const needed = this.neededPhotoIds();
      const known = untracked(() => this.photoUrls());
      for (const id of needed) if (!(id in known)) void this.loadPhoto(id);
    });

    // L'écran courant est retenu sur l'appareil pour survivre à un F5. Un compte
    // enfant qui retrouverait un écran d'adulte (laissé par un autre sur le même
    // navigateur) est ramené à l'accueil : go() garde déjà la porte à la
    // navigation, ceci la garde aussi à la restauration.
    effect(() => {
      const screen = this.ui().screen;
      if (this.authed() && this.isChild() && ECRANS_ADULTES.has(screen)) { this.patch({ screen: 'home' }); return; }
      // Écran d'un module désactivé (retenu, ou éteint pendant qu'on le regarde) : retour à l'accueil.
      if (this.authed() && this._data() && !this.screenEnabled(screen)) { this.patch({ screen: 'home' }); return; }
      rememberScreen(screen);
    });

    // Le sondage tourne sur les écrans qui montrent ce qui se coche à deux :
    // Courses, Tâches et l'accueil. Ailleurs il ne servirait qu'à vider la
    // batterie. Il s'arrête aussi quand l'onglet passe en arrière-plan.
    effect(() => {
      const screen = this.ui().screen;
      // Une fiche ouverte suit l'élément de près, quel que soit l'écran dessous :
      // c'est elle qui doit dire « modifié par Nolwenn » avant qu'on écrase.
      const fiche = !!this.ui().item;
      const cadence = !this.authed() ? 0 : fiche || screen === 'courses' || screen === 'taches' || screen === 'lieux' ? LIVE_POLL_MS : screen === 'home' ? HOME_POLL_MS : 0;
      if (cadence) this.startLivePolling(cadence); else this.stopLivePolling();
    });

    // Retour du réseau : les files partent immédiatement, sans attendre que
    // quelqu'un touche à nouveau l'écran.
    window.addEventListener('online', () => {
      this.syncOffline.set(false);
      void this.flushQueues();
      if (this.saveState() === 'error') void this.flush();
    });
    window.addEventListener('offline', () => this.syncOffline.set(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      // Un téléphone qui se réveille peut avoir dormi douze heures : l'horloge
      // est remise à l'heure avant tout le reste, sinon l'écran affiche la veille
      // le temps d'une minute.
      this.advanceClock();
      if (!this.authed()) return;
      void this.flushQueues();
      if (this.saveState() === 'error') void this.flush();
      if (this.ui().screen === 'courses' || this.ui().screen === 'taches' || this.ui().screen === 'lieux') void this.pollLive();
    });
    setInterval(() => this.advanceClock(), 60_000);
  }

  // ---- lifecycle / auth -------------------------------------------------
  async init(): Promise<void> {
    // Enregistré avant tout le reste, et pour tout le monde : c'est lui qui
    // garde la coquille, donc ce qui décide qu'un prochain démarrage sans
    // réseau ouvre quelque chose. L'attacher aux rappels le réservait à ceux
    // qui les avaient activés.
    void this.ensureServiceWorker();
    // Demandé une fois, sans rien attendre en retour : le navigateur accorde ou
    // non de ne pas évincer nos données sous la pression du disque.
    void askPersistence();
    // First run? The setup wizard must create the household + admin account.
    try {
      const status = await this.api.setupStatus();
      if (status.needsSetup) {
        this.needsSetup.set(true);
        this.api.markSession(false);
        this.ready.set(true);
        return;
      }
    } catch {
      /* status unreachable — fall through to normal auth handling */
    }
    if (this.api.hasSession()) {
      try {
        await this.loadState();
        this.authed.set(true);
      } catch (e) {
        // Un serveur injoignable n'est pas une session invalide. Jeter le jeton
        // dans ce cas renvoyait à l'écran de connexion pendant un simple
        // redémarrage du conteneur, sans rien expliquer. La session est gardée,
        // l'écran se rend, et chaque tuile dit qu'elle ne peut pas charger.
        if (isOffline(e)) {
          this.authed.set(true);
          // Le réseau manque : plutôt qu'une application vide, le foyer tel
          // qu'on l'a laissé, avec la date de cette lecture. Sans document
          // gardé, on garde le message d'erreur, qui reste la vérité.
          if (await this.hydrateFromCache()) this.syncOffline.set(true);
          else this.docError.set((e as Error).message);
        } else {
          // Session refusée (jeton périmé ou révoqué) : on oublie le drapeau, et
          // l'écran de connexion reprend la main.
          this.api.markSession(false);
        }
      }
    }
    this.ready.set(true);
  }

  /**
   * Recharge le document du foyer. C'est ce que fait le « Réessayer » d'une
   * tuile : la panne est signalée là où elle se voit, et se rattrape sans
   * recharger l'application ni se reconnecter.
   */
  async reloadDocument(): Promise<void> {
    try {
      await this.loadState();
    } catch (e) {
      const msg = (e as Error).message;
      this.docError.set(msg);
      // eslint-disable-next-line no-console
      console.error('[foyer] accueil : rechargement du document échoué : ' + msg);
    }
  }

  async completeSetup(payload: SetupPayload): Promise<boolean> {
    this.authError.set('');
    try {
      await this.api.setup(payload);
      this.api.markSession(true);
      await this.loadState();
      this.needsSetup.set(false);
      this.authed.set(true);
      this.toast('Votre foyer est créé 🎉');
      return true;
    } catch (e) {
      this.authError.set((e as Error).message);
      return false;
    }
  }

  // ---- le dernier document connu, pour un démarrage hors ligne ---------------
  //
  // Gardé à chaque lecture réussie et à chaque enregistrement réussi : ce sont
  // les deux moments où l'on sait ce que le serveur a. Voir offline-doc.ts.

  private async persistDoc(): Promise<void> {
    const d = this._data(); if (!d) return;
    const raw = packDoc(d, this.docVersion, new Date().toISOString());
    if (!raw) {
      // Trop gros : on retire ce qui traînait plutôt que de laisser un document
      // périmé prendre la place, et on le dit une fois dans la console.
      await clearCachedDoc();
      // eslint-disable-next-line no-console
      console.warn('[foyer] hors ligne : document trop volumineux pour être gardé, le démarrage hors ligne est indisponible.');
      return;
    }
    await saveCachedDoc(raw);
  }

  /**
   * Le réseau manque au démarrage : montrer le foyer tel qu'on l'a laissé,
   * daté. Vrai quand il y avait quelque chose à montrer. Les files d'attente
   * sont rejouées par-dessus, comme après une lecture réussie.
   */
  private async hydrateFromCache(): Promise<boolean> {
    const garde = readDoc<HouseholdState>(await loadCachedDoc());
    if (!garde) return false;
    this._data.set(this.normalise(garde.state));
    this.docVersion = garde.version;
    this.replayQueues();
    this.pending = [];
    this.docStaleAt.set(garde.at);
    this.patch({ famNameField: garde.state.familyName });
    return true;
  }

  async loadState(): Promise<void> {
    const { state, version } = await this.api.getState();
    this._data.set(this.normalise(state));
    this.docVersion = version;
    this.docStaleAt.set('');
    // Ce qui n'est pas encore parti n'a pas été vu du serveur : le rejouer
    // par-dessus son document évite qu'une coche faite hors ligne clignote.
    this.replayQueues();
    // Un rechargement complet repart du document du serveur : ce qui n'était pas
    // parti est perdu de toute façon, et le garder ferait réapparaître des
    // modifications que l'utilisateur croit abandonnées.
    this.pending = [];
    this.docError.set('');
    void this.persistDoc();
    this.patch({ famNameField: state.familyName });
    try {
      const me = await this.api.me();
      // Passé la moitié de sa vie, le serveur repose le cookie de session tout
      // seul : une session active ne se termine jamais par une déconnexion
      // surprise, et rien n'est à ranger côté client.
      this.myEmail.set(me.email);
      this.currentMemberId.set(me.memberId);
      this.isAdmin.set(me.admin);
      this.isChild.set(me.enfant);
      this.totpOn.set(me.totp);
      this.totpRecoveryLeft.set(me.totpRecoveryLeft);
    } catch { /* ignore */ }
    // Quelle version le serveur exécute réellement : la première question quand
    // un écran ne ressemble pas à ce que la mise à jour annonçait.
    this.api.systemVersion().then((v) => this.version.set(v.current)).catch(() => { /* sans conséquence */ });
    this.loadSchoolHolidays();
    this.veilleInactivite();
    // Le document est chargé : AdminStore s'en saisit pour son bootstrap
    // (comptes, lien ICS, mises à jour, rappels). Voir docLoadedAt.
    this.docLoadedAt.update((v) => v + 1);
  }

  /**
   * Le service worker, enregistré une fois pour toutes. Il sert deux choses
   * sans rapport (les rappels Web Push, gérés par AdminStore, et le cache de la
   * coquille), et c'est le même : un navigateur n'en accepte qu'un par portée.
   * Public pour qu'AdminStore récupère l'enregistrement sans le réenregistrer.
   */
  private swPromise: Promise<ServiceWorkerRegistration | null> | null = null;
  ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (this.swPromise) return this.swPromise;
    if (!('serviceWorker' in navigator)) return (this.swPromise = Promise.resolve(null));
    this.swPromise = navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href)
      .catch((e: Error) => {
        // eslint-disable-next-line no-console
        console.warn('[foyer] service worker refusé : ' + e.message + ' (ni rappels, ni démarrage hors ligne)');
        return null;
      });
    return this.swPromise;
  }

  // ---- calendar overlays -----------------------------------------------
  async loadSchoolHolidays(): Promise<void> {
    const ac = this.setting('academie');
    if (!ac) { this.schoolHolidays.set([]); return; }
    try { const r = await this.api.schoolHolidays(ac); this.schoolHolidays.set(r.holidays || []); }
    catch { this.schoolHolidays.set([]); }
  }
  /** Derived (non-event) calendar items for a day: holidays, school holidays, birthdays, dated tasks. */
  dayExtras(ds: string): DayExtra[] {
    const d = this._data();
    if (!d) return [];
    return dayExtrasOn(ds, { doc: d, schoolHolidays: this.schoolHolidays(), external: this.externalDayExtras() });
  }

  /** Guard against older/partial state documents missing newer keys. */
  private normalise(s: HouseholdState): HouseholdState {
    s.meals ||= {};
    s.articles ||= [];
    s.shopMemory ||= {};
    // `who` d'un événement est une liste (plusieurs membres). Un document d'avant
    // la migration 11, ou lu hors ligne, peut encore porter une chaîne : on la
    // met en liste ici aussi, pour que l'affichage n'ait jamais à s'en soucier.
    for (const e of s.events || []) { const w = e.who as unknown; if (typeof w === 'string') e.who = w ? [w] : []; else if (!Array.isArray(w)) e.who = []; }
    s.tasks ||= [];
    s.taskLists ||= [];
    s.taskTemplates ||= [];
    s.places ||= [];
    s.placeItems ||= [];
    s.cards ||= [];
    s.settings ||= householdDefaults();
    s.prefs ||= {};
    return s;
  }

  /**
   * Le défi rendu par le premier temps de la connexion, quand le compte porte un
   * second facteur. Il ne vaut que pour le second temps : il n'ouvre rien.
   */
  readonly totpChallenge = signal('');

  async login(email: string, password: string, remember = true): Promise<boolean> {
    this.authError.set('');
    try {
      const res = await this.api.login(email, password, remember);
      // Second facteur posé : le mot de passe est bon, mais il ne suffit pas.
      // L'écran passe à la saisie du code, sans rien ouvrir entre-temps.
      if (res.totpRequired && res.challenge) {
        this.totpChallenge.set(res.challenge);
        return false;
      }
      return await this.entrer(res);
    } catch (e) {
      this.authError.set((e as Error).message);
      return false;
    }
  }

  /** Second temps : le code du téléphone, ou l'un des codes de secours. */
  async loginTotp(code: string): Promise<boolean> {
    const defi = this.totpChallenge();
    if (!defi) return false;
    this.authError.set('');
    try {
      return await this.entrer(await this.api.loginTotp(defi, code));
    } catch (e) {
      const msg = (e as Error).message;
      this.authError.set(msg);
      // Le défi a expiré ou ne vaut plus : renvoyer au mot de passe plutôt que
      // de laisser quelqu'un ressaisir des codes dans le vide.
      if (/expiré|plus valable/.test(msg)) this.abandonnerTotp();
      return false;
    }
  }

  /** Retour au mot de passe : le défi est jeté. */
  abandonnerTotp(): void {
    this.totpChallenge.set('');
  }

  /** Ce qui est commun aux deux chemins d'entrée, une fois le jeton obtenu. */
  private async entrer(res: { token?: string }): Promise<boolean> {
    if (!res.token) { this.authError.set('Réponse inattendue du serveur.'); return false; }
    // Le cookie de session vient d'être posé par le serveur ; on ne garde ici
    // que le drapeau « session ouverte », jamais le jeton.
    this.api.markSession(true);
    this.totpChallenge.set('');
    await this.loadState();
    this.authed.set(true);
    this.toast('Bienvenue dans votre foyer');
    return true;
  }

  /**
   * Ferme la session d'un appareil resté inactif.
   *
   * Purement local : rien n'est envoyé, et le jeton reste valable côté serveur
   * jusqu'à son terme. Ce n'est donc pas une révocation, c'est un geste de bon
   * sens sur un téléphone oublié quelque part, qui coûte un rechargement à qui
   * revient. Le réglage « Déconnexion après inactivité » le règle, zéro le coupe.
   */
  private veilleInactivite(): void {
    const heures = Number(this.setting('inactivityHours')) || 0;
    if (heures <= 0) return;
    const limite = heures * 3600_000;
    let dernier = Date.now();
    const bouge = (): void => { dernier = Date.now(); };
    for (const ev of ['pointerdown', 'keydown', 'visibilitychange'] as const) {
      addEventListener(ev, bouge, { passive: true });
    }
    setInterval(() => {
      if (!this.authed() || Date.now() - dernier < limite) return;
      this.logout();
      this.toast(`Session fermée après ${heures} h sans activité.`);
    }, 60_000);
  }

  logout(): void {
    // Le cookie de session est HttpOnly : seul le serveur peut l'effacer. Au
    // pire (hors ligne), le drapeau local tombe quand même et l'appareil revient
    // à l'écran de connexion ; le cookie, lui, expirera de lui-même.
    void this.api.logout().catch(() => { /* déconnexion locale de toute façon */ });
    this.api.markSession(false);
    this.authed.set(false);
    this._data.set(null);
    this.docVersion = 0;
    this.pending = [];
    this.docError.set('');
    this.docStaleAt.set('');
    // Le document gardé porte la vie du foyer : il ne survit pas à une déconnexion.
    void clearCachedDoc();
    this.ui.set(initialUi());
    this.isAdmin.set(false);
    this.isChild.set(false);
    this.totpOn.set(false);
    this.totpRecoveryLeft.set(null);
    this.totpChallenge.set('');
    this.currentMemberId.set(null);
    this.myEmail.set('');
    this.schoolHolidays.set([]);
    this.revokePhotos();
  }

  // ---- state plumbing ---------------------------------------------------
  patch(p: Partial<UiState>): void { this.ui.update((u) => ({ ...u, ...p })); }

  private mutate(fn: Mutation): void {
    const cur = this._data();
    if (!cur) return;
    const next = structuredClone(cur);
    fn(next);
    this._data.set(next);
    // La mutation est retenue telle quelle : si le serveur refuse l'écriture
    // parce que l'autre appareil l'a devancé, elle sera rejouée sur sa version.
    this.pending.push(fn);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 700);
  }

  /** Nombre de rejeux avant d'abandonner. Au-delà, c'est que l'autre écrit en boucle. */
  private static readonly MAX_REBASE = 3;

  async flush(): Promise<void> {
    if (!this._data() || this.saving) return;
    this.saving = true;
    this.saveState.set('saving');
    try {
      for (let essai = 0; essai <= FoyerStore.MAX_REBASE; essai++) {
        // Ce qui part réellement : le document et les mutations du moment. Ce
        // qui arrive pendant l'aller-retour reste en attente pour le prochain envoi.
        const doc = this._data()!;
        const envoyees = this.pending.length;
        try {
              const r = await this.api.putState(doc, this.docVersion);
          this.docVersion = r.version;
          this.pending = this.pending.slice(envoyees);
          this.saveState.set('idle');
          this.docStaleAt.set('');
          void this.persistDoc();
          if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
          return;
        } catch (e) {
          const conflit = e instanceof ApiError ? asConflict(e.status, e.body) : null;
          if (!conflit) throw e;
          this.applyConflict(conflit.version, conflit.state);
        }
      }
      this.failSave('Le document change plus vite qu’il ne s’enregistre.');
    } catch (e) {
      this.failSave((e as Error).message);
    } finally {
      this.saving = false;
    }
  }

  /**
   * Un enregistrement a échoué. Ce n'est **pas** un document illisible : les
   * modifications sont toujours là, en mémoire et en attente, et repartiront
   * toutes seules. Le dire est le minimum, et réessayer sans qu'on le demande
   * est ce qui évite d'avoir à y penser.
   */
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private failSave(reason: string): void {
    this.saveState.set('error');
    // eslint-disable-next-line no-console
    console.error('[foyer] enregistrement du document échoué : ' + reason);
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flush(); }, SAVE_RETRY_MS);
  }

  /**
   * Quelqu'un d'autre a enregistré : on repart de sa version et on rejoue
   * par-dessus ce qui n'était pas encore parti. L'écran bouge, mais dans le bon
   * sens, et rien de ce qui a été fait des deux côtés n'est perdu.
   */
  private applyConflict(version: number, serverState: HouseholdState): void {
    this.docVersion = version;
    const rep = rebase(this.normalise(serverState), this.pending);
    this._data.set(rep.state);
    this.replayQueues();
    if (rep.dropped) {
      // Le seul cas où du travail se perd : ce qu'on modifiait n'existe plus.
      // Le taire ferait douter de tout le reste.
      this.toast(rep.dropped > 1
        ? rep.dropped + ' modifications n’ont pas pu être reprises : leur cible a été supprimée ailleurs'
        : 'Une modification n’a pas pu être reprise : sa cible a été supprimée ailleurs');
    }
  }

  // ---- courses et tâches : opérations, files et sondage ---------------------
  //
  // Ni la liste ni les tâches ne partent dans `putState` : le serveur ignore
  // ces champs. Toute mutation passe par une opération ciblée, ce qui rend
  // impossible qu'un téléphone périmé décoche ce que l'autre vient de cocher.
  //
  // Trois choses se passent ici, dans cet ordre :
  //   1. l'écran est mis à jour tout de suite, sans attendre le réseau ;
  //   2. l'opération est mise en file, et la file est persistée ;
  //   3. la file part au serveur, dont la réponse fait autorité.

  /** Rejoue les deux files sur le document en mémoire, sans rien envoyer. */
  private replayQueues(): void {
    for (const op of this.shopQueue()) this.applyShopLocally(op);
    for (const op of this.taskQueue()) this.applyTaskLocally(op);
    for (const op of this.placeQueue()) this.applyPlaceLocally(op);
  }

  private async flushQueues(): Promise<void> {
    await Promise.all([this.flushShopQueue(), this.flushTaskQueue(), this.flushPlaceQueue()]);
  }

  private saveShopQueue(q: ShopOp[]): void {
    this.shopQueue.set(q);
    try { localStorage.setItem(SHOP_QUEUE_KEY, JSON.stringify(q)); } catch { /* quota : la file reste en mémoire */ }
  }

  /**
   * Applique une opération à la liste locale. Volontairement naïf : ni
   * validation ni journal, le serveur s'en charge et sa réponse écrase ce
   * résultat. Ici on ne cherche qu'à ce que la coche s'affiche au doigt levé.
   */
  private applyShopLocally(op: ShopOp): void {
    const cur = this._data(); if (!cur) return;
    const items = cur.shop.map((i) => ({ ...i }));
    const idx = items.findIndex((i) => i.id === op.id);
    switch (op.op) {
      case 'add':
        if (idx < 0) items.push({
          id: op.id, name: op.name, qty: op.qty || '', aisleId: op.aisleId, state: 'a-prendre', listId: op.listId,
          by: op.by ?? null, at: op.at ?? null,
          ...(op.art ? { art: op.art } : {}), ...(op.gen ? { gen: true } : {}), ...(op.photoId ? { photoId: op.photoId } : {}),
        });
        break;
      case 'set-state':
        if (idx >= 0) items[idx] = { ...items[idx], state: op.state, by: op.by ?? null, at: op.at ?? null };
        break;
      case 'edit':
        if (idx >= 0) {
          const next = {
            ...items[idx],
            ...(op.name !== undefined ? { name: op.name } : {}),
            ...(op.qty !== undefined ? { qty: op.qty } : {}),
            ...(op.aisleId !== undefined ? { aisleId: op.aisleId } : {}),
            ...(op.listId !== undefined ? { listId: op.listId } : {}),
          };
          if (op.photoId !== undefined) { if (op.photoId) next.photoId = op.photoId; else delete next.photoId; }
          items[idx] = next;
        }
        break;
      case 'remove':
        if (idx >= 0) items.splice(idx, 1);
        break;
    }
    this._data.set({ ...cur, shop: items });
  }

  /** Empile une ou plusieurs opérations : affichage immédiat, envoi groupé. */
  private pushShopOps(ops: ShopOpDraft[]): void {
    const by = this.me()?.id ?? null;
    const at = new Date().toISOString();
    const full = ops.map((o) => ({ ...o, opId: uid('op'), by, at }) as ShopOp);
    for (const op of full) this.applyShopLocally(op);
    this.saveShopQueue([...this.shopQueue(), ...full]);
    if (this.shopFlushTimer) clearTimeout(this.shopFlushTimer);
    // Court délai : trois coches d'affilée partent en un seul aller-retour.
    this.shopFlushTimer = setTimeout(() => void this.flushShopQueue(), 300);
  }

  /**
   * Envoie la file. En cas d'échec réseau, elle reste intacte et repartira au
   * prochain geste, au retour du réseau ou au prochain sondage : rien n'est
   * perdu, c'est tout l'objet de l'exercice.
   */
  async flushShopQueue(): Promise<void> {
    if (this.shopFlushing || !this.authed()) return;
    const batch = this.shopQueue();
    if (!batch.length) return;
    this.shopFlushing = true;
    try {
      const res = await this.api.shoppingOps(batch);
      this.syncOffline.set(false);
      // Retenues comme écartées, les opérations quittent la file : une
      // opération définitivement refusée qu'on rejouerait tournerait sans fin.
      const settled = new Set([...res.applied, ...res.skipped.map((k) => k.opId)]);
      this.saveShopQueue(this.shopQueue().filter((o) => !settled.has(o.opId)));
      this.adoptShop(res.items);
      if (res.skipped.length) {
        // Le dire : un article qui n'arrive jamais dans la liste sans explication
        // est exactement ce qui fait abandonner l'outil.
        this.toast(res.skipped.length === 1 ? res.skipped[0].reason : res.skipped.length + ' modifications refusées');
      }
    } catch {
      this.syncOffline.set(true);
    } finally {
      this.shopFlushing = false;
    }
  }

  /**
   * Remplace la liste locale par celle du serveur, qui fait autorité. Les
   * opérations encore en file n'ont pas été vues du serveur : les rejouer
   * par-dessus sa réponse évite qu'une coche faite hors ligne clignote.
   */
  private adoptShop(items: ShopItem[]): void {
    const cur = this._data(); if (!cur) return;
    this._data.set({ ...cur, shop: items });
    for (const op of this.shopQueue()) this.applyShopLocally(op);
  }

  private adoptTasks(items: TaskItem[]): void {
    const cur = this._data(); if (!cur) return;
    this._data.set({ ...cur, tasks: items });
    for (const op of this.taskQueue()) this.applyTaskLocally(op);
  }

  // ---- lieux : mêmes rouages que les courses, sur deux collections ---------
  private savePlaceQueue(q: PlaceOp[]): void {
    this.placeQueue.set(q);
    try { localStorage.setItem(PLACE_QUEUE_KEY, JSON.stringify(q)); } catch { /* quota : la file reste en mémoire */ }
  }

  /** Application locale naïve : la coche s'affiche au doigt levé, le serveur écrase ensuite. */
  private applyPlaceLocally(op: PlaceOp): void {
    const cur = this._data(); if (!cur) return;
    let places = cur.places;
    let items = cur.placeItems;
    switch (op.op) {
      case 'place-add':
        if (!places.some((p) => p.id === op.id)) places = [...places, {
          id: op.id, name: op.name, color: op.color || '#4E93B8', icon: op.icon || 'map-pin', position: places.length,
          ...(op.note ? { note: op.note } : {}), by: op.by ?? null, at: op.at ?? null,
        }];
        break;
      case 'place-edit':
        places = places.map((p) => (p.id === op.id ? {
          ...p,
          ...(op.name !== undefined ? { name: op.name } : {}),
          ...(op.color !== undefined ? { color: op.color } : {}),
          ...(op.icon !== undefined ? { icon: op.icon } : {}),
          ...(op.note !== undefined ? { note: op.note || null } : {}),
          ...(op.position !== undefined ? { position: op.position } : {}),
        } : p));
        break;
      case 'place-remove':
        places = places.filter((p) => p.id !== op.id);
        items = items.filter((i) => i.placeId !== op.id);
        break;
      case 'add':
        if (!items.some((i) => i.id === op.id)) items = [...items, {
          id: op.id, placeId: op.placeId, name: op.name, qty: op.qty || '', state: op.state || 'la-bas',
          by: op.by ?? null, at: op.at ?? null,
        }];
        break;
      case 'set-state':
        items = items.map((i) => (i.id === op.id ? { ...i, state: op.state, by: op.by ?? null, at: op.at ?? null } : i));
        break;
      case 'edit':
        items = items.map((i) => (i.id === op.id ? {
          ...i,
          ...(op.name !== undefined ? { name: op.name } : {}),
          ...(op.qty !== undefined ? { qty: op.qty } : {}),
          ...(op.placeId !== undefined ? { placeId: op.placeId } : {}),
        } : i));
        break;
      case 'remove':
        items = items.filter((i) => i.id !== op.id);
        break;
    }
    this._data.set({ ...cur, places, placeItems: items });
  }

  /** Empile une ou plusieurs opérations : affichage immédiat, envoi groupé. */
  private pushPlaceOps(ops: PlaceOpDraft[]): void {
    const by = this.me()?.id ?? null;
    const at = new Date().toISOString();
    const full = ops.map((o) => ({ ...o, opId: uid('op'), by, at }) as PlaceOp);
    for (const op of full) this.applyPlaceLocally(op);
    this.savePlaceQueue([...this.placeQueue(), ...full]);
    if (this.placeFlushTimer) clearTimeout(this.placeFlushTimer);
    this.placeFlushTimer = setTimeout(() => void this.flushPlaceQueue(), 300);
  }

  async flushPlaceQueue(): Promise<void> {
    if (this.placeFlushing || !this.authed()) return;
    const batch = this.placeQueue();
    if (!batch.length) return;
    this.placeFlushing = true;
    try {
      const res = await this.api.placesOps(batch);
      this.syncOffline.set(false);
      const settled = new Set([...res.applied, ...res.skipped.map((k) => k.opId)]);
      this.savePlaceQueue(this.placeQueue().filter((o) => !settled.has(o.opId)));
      this.adoptPlaces(res.places, res.items);
      if (res.skipped.length) this.toast(res.skipped.length === 1 ? res.skipped[0].reason : res.skipped.length + ' modifications refusées');
    } catch {
      this.syncOffline.set(true);
    } finally {
      this.placeFlushing = false;
    }
  }

  /** Remplace lieux et affaires par ceux du serveur, puis rejoue la file par-dessus. */
  private adoptPlaces(places?: Place[], items?: PlaceItem[]): void {
    const cur = this._data(); if (!cur) return;
    this._data.set({ ...cur, ...(places ? { places } : {}), ...(items ? { placeItems: items } : {}) });
    for (const op of this.placeQueue()) this.applyPlaceLocally(op);
  }

  /**
   * Sondage différentiel des deux sous-arbres : sans changement, la réponse
   * tient en trois lignes. La version n'est retenue qu'ici : une réponse à un
   * lot d'opérations ne dit rien de ce que l'autre appareil a pu écrire ailleurs.
   */
  async pollLive(): Promise<void> {
    if (!this.authed()) return;
    try {
      const snap = await this.api.live(this.liveVersion);
      this.syncOffline.set(false);
      this.liveVersion = snap.version;
      if (snap.unchanged) return;
      if (snap.shop) this.adoptShop(snap.shop);
      if (snap.tasks) this.adoptTasks(snap.tasks);
      if (snap.places || snap.placeItems) this.adoptPlaces(snap.places, snap.placeItems);
      // Le reste du document (les événements…) ne voyage pas par ce canal. Sur
      // l'accueil et sous une fiche ouverte, une version qui a bougé le fait
      // relire, pour qu'un événement modifié ailleurs s'y voie sans recharger.
      if (snap.version !== this.docVersion && (this.ui().item || this.ui().screen === 'home')) void this.refreshDocument();
    } catch {
      this.syncOffline.set(true);
    }
  }

  /**
   * Relit le document du serveur et repart de sa version, en rejouant par-dessus
   * ce qui n'est pas encore parti : le même chemin qu'un conflit
   * d'enregistrement, donc rien de ce qui a été fait ici n'est perdu. Sans
   * effet pendant un enregistrement (il s'en chargera), ni hors ligne.
   */
  async refreshDocument(): Promise<void> {
    if (!this.authed() || this.saving) return;
    try {
      const { state, version } = await this.api.getState();
      if (version !== this.docVersion && !this.saving) this.applyConflict(version, state);
    } catch { /* hors ligne : on garde ce qu'on a */ }
  }

  /** Cadence en cours, pour ne pas relancer la minuterie quand elle est déjà bonne. */
  private livePollMs = 0;

  private startLivePolling(cadence: number): void {
    if (this.livePollTimer && this.livePollMs === cadence) return;
    this.stopLivePolling();
    this.livePollMs = cadence;
    void this.flushQueues();
    void this.pollLive();
    this.livePollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void this.flushQueues();
      void this.pollLive();
    }, cadence);
  }

  private stopLivePolling(): void {
    if (!this.livePollTimer) return;
    clearInterval(this.livePollTimer);
    this.livePollTimer = null;
    this.livePollMs = 0;
  }

  toast(msg: string): void {
    this.undoFn = null;
    this.patch({ toast: msg, toastUndo: false });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.patch({ toast: '', toastUndo: false }), TOAST_MS);
  }

  /**
   * Annulation de la dernière action, offerte quelques secondes.
   *
   * Elle est due à toute action qui fait **disparaître** ce sur quoi on vient
   * d'appuyer : cocher une tâche depuis l'accueil la retire de la tuile, la
   * reporter aussi, remplacer un repas écrase celui qui était prévu. Sans retour
   * possible, un geste fait de travers oblige à ouvrir le module pour le défaire,
   * ce qui est exactement ce que l'action rapide cherchait à éviter.
   *
   * `undo` n'est pas rangé dans l'état d'interface : c'est une fonction, et
   * l'état d'interface ne contient que des données.
   */
  private undoFn: (() => void) | null = null;
  toastWithUndo(msg: string, undo: () => void): void { this.toastAction(msg, 'Annuler', undo); }

  /** Un toast qui propose une suite, nommée : « Clore » la tâche quand la liste de courses est finie. */
  toastAction(msg: string, label: string, fn: () => void): void {
    this.undoFn = fn;
    this.patch({ toast: msg, toastUndo: true, toastLabel: label });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.undoFn = null; this.patch({ toast: '', toastUndo: false }); }, UNDO_MS);
  }

  undoLast(): void {
    const fn = this.undoFn;
    this.undoFn = null;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.patch({ toast: '', toastUndo: false });
    fn?.();
  }

  // ---- member helpers ---------------------------------------------------
  private members(): Member[] { return this._data()?.members || []; }
  memberColor(id: string): string { return this.members().find((m) => m.id === id)?.color || '#8A7E74'; }
  memberName(id: string): string { return this.members().find((m) => m.id === id)?.name || ''; }
  memberIni(id: string): string { return this.members().find((m) => m.id === id)?.ini || '?'; }
  tint = tint;
  grad = grad;

  // ---- navigation -------------------------------------------------------
  // ---- modules activables ----------------------------------------------
  // Un module éteint (réglage foyer à false) disparaît partout. Ces cinq
  // lectures littérales sont aussi ce qui atteste au registre qu'un drapeau sert.
  readonly modRepas = computed(() => this.setting('modRepas') !== false);
  readonly modFidelite = computed(() => this.setting('modFidelite') !== false);
  readonly modFinances = computed(() => this.setting('modFinances') !== false);
  readonly modEmploye = computed(() => this.setting('modEmploye') !== false);
  // École est le seul module éteint par défaut : il faut l'avoir allumé.
  readonly modEcole = computed(() => this.setting('modEcole') === true);
  moduleOn(flag: ModuleFlag): boolean {
    return flag === 'modRepas' ? this.modRepas() : flag === 'modFidelite' ? this.modFidelite() : flag === 'modFinances' ? this.modFinances()
      : flag === 'modEcole' ? this.modEcole() : this.modEmploye();
  }
  /** Un écran est-il accessible ? (module actif, ou écran hors module.) */
  screenEnabled(screen: string): boolean {
    const flag = SCREEN_MODULE[screen];
    return !flag || this.moduleOn(flag);
  }

  go(screen: string): void {
    // Un seul point de passage, plutôt qu'une condition à chaque bouton : c'est
    // ce qui rend impossible d'ouvrir l'écran par une entrée qu'on aurait
    // oublié de cacher. Le serveur refuse de son côté, indépendamment.
    if (this.isChild() && ECRANS_ADULTES.has(screen)) {
      this.toast(screen === 'settings'
        ? 'Les réglages du foyer sont réservés aux adultes.'
        : 'Cet écran est réservé aux adultes du foyer.');
      return;
    }
    // Un écran de module désactivé ramène à l'accueil, comme une porte fermée.
    if (!this.screenEnabled(screen)) { this.patch({ screen: 'home', addMenuOpen: false, notifOpen: false }); return; }
    this.patch({ screen, addMenuOpen: false, notifOpen: false, item: null });
  }

  // ---- fiche d'élément --------------------------------------------------
  // Un tap sur un élément, d'où qu'il vienne, ouvre sa fiche par-dessus l'écran
  // courant : on lit, on modifie, on ferme, et l'on est toujours là où l'on
  // était. La machine d'état est pure (core/item-sheet.ts), la fiche est rendue
  // par le shell (shell/item-sheet.ts).

  /** Ouvre un élément (`id` vide : création). `stack` : depuis une autre fiche, qu'on retrouve au retour. */
  openItem(kind: ItemKindId, id: string | null, ctx?: ItemCtx, stack = false): void {
    const m = ITEM_KINDS[kind];
    if ((m.module && !this.moduleOn(m.module)) || (m.adultOnly && this.isChild())) return;
    this.patch({ item: sheetOpen(this.ui().item, kind, id, ctx, stack), addMenuOpen: false, notifOpen: false });
  }
  closeItem(): void { this.patch({ item: null }); }
  editItem(): void { this.patch({ item: sheetEdit(this.ui().item) }); }
  backItem(): void { this.patch({ item: sheetBack(this.ui().item) }); }
  itemSaved(id?: string): void { this.patch({ item: sheetSaved(this.ui().item, id) }); }

  toggleDark(): void { this.setSetting('dark', !this.setting('dark')); }

  // ---- global search ----------------------------------------------------
  openSearch(): void { this.patch({ searchOpen: true, searchQuery: '' }); }
  closeSearch(): void { this.patch({ searchOpen: false, searchQuery: '' }); }

  /** Accent/case-insensitive matches across the whole household state. */
  readonly searchResults = computed<SearchHit[]>(() => {
    const d = this._data();
    const q = normText(this.ui().searchQuery);
    if (!d || !q) return [];
    const mname = (id: string): string => d.members.find((m) => m.id === id)?.name || '';
    const hits: SearchHit[] = [];
    const push = (h: SearchHit): void => { hits.push(h); };
    for (const c of d.contacts) if (normText(`${c.name} ${c.role} ${c.phone || ''} ${c.email || ''} ${c.cat || ''}`).includes(q)) push({ kind: 'contact', icon: 'phone', color: c.color || '#4E93B8', title: c.name, sub: c.role || 'Contact', screen: 'contacts', id: c.id });
    for (const t of d.tasks) if (normText(t.text).includes(q)) push({ kind: 'task', icon: 'task', color: '#6E9E5F', title: t.text, sub: 'Tâche' + (t.who.length ? ' · ' + t.who.map(mname).join(', ') : ''), screen: 'taches', id: t.id });
    for (const e of d.events) if (normText(e.title).includes(q)) push({ kind: 'event', icon: 'calendar', color: '#4E93B8', title: e.title, sub: 'Événement · ' + e.date, screen: 'calendar', id: e.id });
    for (const s of d.shop) if (normText(s.name).includes(q)) push({ kind: 'shop', icon: 'panier', color: '#E08D3C', title: s.name, sub: 'Course' + (s.qty ? ' · ' + s.qty : ''), screen: 'courses', id: s.id });
    if (this.modRepas()) for (const r of d.recipes) if (normText(r.name).includes(q)) push({ kind: 'recipe', icon: 'recettes', color: r.color || '#C6492F', title: r.name, sub: 'Recette', screen: 'recettes', id: r.id });
    if (this.modFidelite()) for (const c of d.cards) if (normText(c.name).includes(q)) push({ kind: 'card', icon: 'card', color: c.color || '#4E93B8', title: c.name, sub: 'Carte de fidélité', screen: 'fidelite', id: c.id });
    for (const m of d.members) if (normText(`${m.name} ${m.role}`).includes(q)) push({ kind: 'member', icon: 'users', color: m.color, title: m.name, sub: m.role || 'Membre', screen: 'settings', id: m.id });
    return hits.slice(0, 40);
  });

  /** Navigate to a search hit and open its detail where possible. */
  openHit(h: SearchHit): void {
    this.closeSearch();
    // Un élément qui a sa fiche s'ouvre par-dessus l'écran courant, sans y changer.
    if (h.id && h.kind in ITEM_KINDS) { this.openItem(h.kind as ItemKindId, h.id); return; }
    this.go(h.screen);
    if (!h.id) return;
    switch (h.kind) {
      case 'contact': this.editContact(h.id); break;
      case 'card': this.showCard(h.id); break;
      case 'member': this.openMembers(); break;
      default: break;
    }
  }

  // ---- events -----------------------------------------------------------
  eventsForDay(ds: string): HouseholdState['events'] {
    return eventsOn(this._data()?.events || [], ds);
  }

  /**
   * Les créneaux de l'emploi du temps **publiés à l'agenda** qui tombent ce
   * jour-là. Dérivés à la volée, jamais stockés : la récurrence réelle du
   * créneau est respectée, et rien de périmé ne traîne dans le document.
   */
  slotEventsForDay(ds: string): SlotEvent[] {
    return slotEventsOn(this._data()?.sched || [], ds, this.calendar());
  }

  /**
   * Depuis l'agenda, la fiche du créneau source à sa date, par-dessus l'agenda :
   * on lit et on modifie l'emploi du temps, pas une copie. La question « cette
   * fois ou toute la série » se pose comme partout ailleurs dans le module.
   */
  openSlotEvent(slotId: string, date: string): void { this.openItem('slot', slotId, { occ: date }); }
  /**
   * Enregistre un événement depuis sa fiche. `id` vide : création. Sur une
   * occurrence de série (`occ`), la portée est demandée ici, une fois les
   * champs remplis, et seulement si quelque chose a changé ; changer la
   * récurrence elle-même ne peut viser que la série.
   */
  saveEvent(f: EventFields, id: string | null, occ: string, scope?: string): ItemResult {
    const draft = eventDraft(f);
    if (!draft) { this.toast('Donne un titre à l’événement'); return { kind: 'invalid' }; }
    const by = this.me()?.id ?? null;
    const now = new Date().toISOString();
    const ev = id ? this._data()?.events.find((e) => e.id === id) : undefined;
    if (!ev) {
      this.mutate((d) => { d.events.push({ id: uid('e'), ...draft, by, at: now }); });
      this.toast('Événement ajouté à l’agenda');
      return { kind: 'done' };
    }
    const at = occ && isSeries(ev) ? occ : '';
    const serie: EventDraft = at ? { ...draft, date: seriesDate(ev.date, at, draft.date) } : draft;
    // Rien de changé : rien n'est écrit, pas même l'auteur de la modification.
    if (!draftChanges(ev, serie)) return { kind: 'done' };
    const askable = !!at && draft.recur === ev.recur;
    if (askable && !scope) {
      return { kind: 'ask', question: 'Appliquer la modification à :', choices: [
        { scope: 'one', label: 'Cette occurrence (' + this.fmtNumDate(at) + ')' }, { scope: 'all', label: 'Toute la série' }] };
    }
    if (askable && scope === 'one') {
      // Calculé dans la mutation : rejouée sur la version d'un autre appareil,
      // elle part de la série telle qu'il l'a laissée. L'identifiant, lui, est fixé.
      const newId = uid('e');
      this.mutate((d) => {
        const i = d.events.findIndex((e) => e.id === ev.id); if (i < 0) return;
        const { series, single } = detachOccurrence(d.events[i], at, draft, newId, by, now);
        d.events[i] = series;
        if (!d.events.some((e) => e.id === newId)) d.events.push(single);
      });
      this.toast('Cette occurrence modifiée, la série continue');
      return { kind: 'done', id: newId };
    } else {
      this.mutate((d) => {
        const i = d.events.findIndex((e) => e.id === ev.id);
        if (i >= 0) d.events[i] = applyToSeries(d.events[i], serie, by, now);
      });
      this.toast(isSeries(ev) ? 'Série modifiée' : 'Événement modifié');
    }
    return { kind: 'done' };
  }

  /**
   * Suggestions de lieu pour le champ « Lieu » d'un événement. Gardé par le
   * réglage `placeSuggest` : éteint, aucune requête ne part. Une panne rend une
   * liste vide, le champ restant une saisie libre.
   */
  placeSuggestions(q: string): Promise<string[]> {
    if (this.setting('placeSuggest') !== true) return Promise.resolve([]);
    return this.api.placeSuggest(q).then((r) => r.suggestions).catch(() => []);
  }

  /**
   * Supprime l'événement, ou seulement l'occurrence ouverte d'une série (la
   * série saute alors cette date). Pas de confirmation : l'annulation est
   * offerte quelques secondes, et rend l'événement tel qu'il était.
   */
  delEvent(id: string, occ: string, scope?: string): ItemResult {
    const ev = this._data()?.events.find((e) => e.id === id); if (!ev) return { kind: 'done' };
    const at = occ && isSeries(ev) ? occ : '';
    if (at && !scope) {
      return { kind: 'ask', question: 'Supprimer :', choices: [
        { scope: 'one', label: 'Cette occurrence (' + this.fmtNumDate(at) + ')', danger: true }, { scope: 'all', label: 'Toute la série', danger: true }] };
    }
    if (at && scope === 'one') {
      this.mutate((d) => { const i = d.events.findIndex((e) => e.id === id); if (i >= 0) d.events[i] = withSkip(d.events[i], at); });
      this.toastWithUndo('Occurrence du ' + this.fmtNumDate(at) + ' supprimée', () => this.mutate((d) => {
        const i = d.events.findIndex((e) => e.id === id); if (i >= 0) d.events[i] = withoutSkip(d.events[i], at);
      }));
      return { kind: 'done' };
    }
    let restore: (cur: EventItem[]) => EventItem[] = (cur) => cur;
    this.mutate((d) => { const r = withoutEvent(d.events, id); d.events = r.list; restore = r.restore; });
    this.toastWithUndo(isSeries(ev) ? 'Série supprimée' : 'Événement supprimé', () => this.mutate((d) => { d.events = restore(d.events); }));
    return { kind: 'done' };
  }

  // ---- articles de courses ------------------------------------------------
  // Toutes ces méthodes passent par `pushShopOps` : rien de la liste ne part
  // dans l'enregistrement du document complet.

  /** Un tap : à prendre ou dans le panier. Sans confirmation, c'est le geste du magasin. */
  toggleShop(id: string): void {
    const it = this._data()?.shop.find((x) => x.id === id); if (!it) return;
    this.setShopState(id, it.state === 'panier' ? 'a-prendre' : 'panier');
    this.proposeClosing(it.listId);
  }
  setShopState(id: string, state: ShopState): void { this.pushShopOps([{ op: 'set-state', id, state }]); }

  /**
   * Le dernier article vient d'être pris et une tâche ouvre cette liste :
   * proposer de la clore, sans la cocher à la place de quiconque. Vrai quand
   * la proposition a été faite.
   */
  private proposeClosing(listId: string): boolean {
    const d = this._data(); if (!d) return false;
    const t = closableShoppingTask(d.tasks, d.shop, listId); if (!t) return false;
    this.toastAction('Tout est dans le panier. Clore « ' + t.text + ' » ?', 'Clore', () => this.toggleTask(t.id));
    return true;
  }

  /**
   * Ajoute un article depuis un texte libre, et rend son identifiant. Les
   * attributs (quantité, rayon, liste) sont facultatifs : sans eux, on retombe
   * sur la quantité vide, le rayon « À trier » et la liste active, comme avant.
   */
  addShop(name: string, opts?: { qty?: string; aisleId?: string; listId?: string; art?: string }): string | null {
    const t = name.trim(); if (!t) return null;
    const listId = opts?.listId || this.activeShopListId(); if (!listId) { this.toast('Créez d’abord une liste'); return null; }
    const id = uid('s');
    // Sans rayon imposé, on le déduit du nom : le référentiel (base + ce que le
    // foyer a appris) range « bananes » aux fruits sans qu'on ait à le dire.
    const aisleId = opts?.aisleId || this.resolveAisleForName(t);
    // Rattachement au référentiel : la clé fournie (suggestion choisie) ou, à
    // défaut, celle que le nom désigne. L'article gagne un lien fiable, ce qui
    // évite un doublon quand la génération des repas réclame le même produit.
    const art = opts?.art || resolveArticleKey(t, this.articleIndex());
    this.pushShopOps([{ op: 'add', id, name: t, qty: opts?.qty?.trim() || '', aisleId, listId, ...(art ? { art } : {}) }]);
    return id;
  }

  /**
   * Rayon où atterrit un article saisi, déduit de son nom via le référentiel
   * (base intégrée + corrections du foyer). Retombe sur « À trier » quand le nom
   * n'évoque rien de connu.
   */
  resolveAisleForName(name: string): string {
    const d = this._data(); if (!d) return this.defaultAisleId();
    const key = resolveArticleKey(name, this.articleIndex());
    const rayon = key ? this.articleIndex().byKey.get(key)?.rayon : undefined;
    return rayon ? aisleForRayon(d.aisles, rayon, this.defaultAisleId()) : this.defaultAisleId();
  }

  /**
   * Retient qu'un article se range à ce rayon, dès qu'il est choisi à la main.
   * Le rayon est typé (le `kind` du rayon du foyer) : « À trier » et les rayons
   * sans type n'apprennent rien. Silencieux si la base rangeait déjà ainsi.
   */
  learnAisle(name: string, aisleId: string): void {
    const d = this._data(); if (!d) return;
    const rayon = d.aisles.find((a) => a.id === aisleId)?.kind;
    if (!rayon) return;
    const cur = d.articles || [];
    if (learnRayon(cur, name, rayon, this.articleIndex()) === cur) return; // rien à apprendre
    // Recalculé dans la mutation : si l'ajout de l'article (file de courses) ou un
    // autre appareil a devancé l'écriture, le rejeu part des articles à jour du
    // serveur, pas d'un instantané périmé.
    this.mutate((s) => { s.articles = learnRayon(s.articles || [], name, rayon, buildArticleIndex(s.articles || [])); });
  }

  addShopQuick(): void {
    if (this.addShop(this.ui().newShop)) this.patch({ newShop: '' });
  }

  /**
   * Range un article dans un rayon en un tap (depuis « À trier »), et retient ce
   * rayon pour ce nom (articles du foyer), comme le fait un choix manuel à la
   * saisie. Silencieux si le rayon n'existe pas.
   */
  rangeShopItem(id: string, aisleId: string): void {
    const it = this._data()?.shop.find((x) => x.id === id);
    if (!it || !this._data()?.aisles.some((a) => a.id === aisleId)) return;
    this.pushShopOps([{ op: 'edit', id, aisleId }]);
    this.learnAisle(it.name, aisleId);
    this.toast(it.name + ' rangé');
  }

  /**
   * Y a-t-il des repas planifiés sur la semaine que « Générer » utilise ? Le
   * bouton ne s'affiche que si oui, pour ne pas proposer une génération qui
   * répondrait « aucun repas planifié ».
   */
  readonly weekHasMeals = computed(() => {
    const d = this._data(); if (!d) return false;
    const slots = this.mealSlots();
    return this.weekDays().some((ds) => slots.some((sl) => (d.meals[`${ds}-${sl.key}`]?.items?.length ?? 0) > 0));
  });
  activeShopListId(): string {
    const s = this.ui();
    return s.activeShopList !== 'all' ? s.activeShopList : (this._data()?.shopLists[0]?.id || '');
  }
  /** Rayon de repli d'un article saisi à la volée : « Non classé » (ou « À trier »), sinon le dernier. */
  defaultAisleId(): string {
    const aisles = this._data()?.aisles || [];
    return (aisles.find((a) => isFallbackAisleName(a.name)) || aisles[aisles.length - 1] || aisles[0])?.id || '';
  }
  /** Nouvel article, en fiche : dans la liste ouverte, au rayon de repli tant que le nom n'en évoque pas un autre. */
  openShop(): void { this.openItem('shop', null); }
  shopDefaults(): ShopDefaults { return { aisleId: this.defaultAisleId(), listId: this.activeShopListId() }; }
  /**
   * Enregistre un article depuis sa fiche : seuls les champs changés partent,
   * l'état à part (il dit qui l'a posé et quand). Un rayon choisi à la main est
   * retenu pour ce nom, comme à la saisie rapide.
   */
  saveShop(id: string, f: ShopFields, isNew: boolean): ItemResult {
    const before = isNew ? null : this._data()?.shop.find((x) => x.id === id) ?? null;
    if (!isNew && !before) { this.toast('Cet article n’existe plus'); return { kind: 'invalid' }; }
    const ops = shopOps(id, before, f);
    if (!ops.length) return { kind: 'done' };
    this.pushShopOps(ops);
    if (!before || before.aisleId !== f.aisleId) this.learnAisle(f.name.trim(), f.aisleId);
    this.toast(before ? 'Article modifié' : 'Article ajouté');
    return { kind: 'done' };
  }
  /** Envoie la photo d'un article (existant ou pas encore enregistré) ; son identifiant, ou null en cas d'échec dit par un toast. */
  async uploadShopPhoto(ownerId: string, file: File): Promise<number | null> {
    try {
      const res = await this.api.uploadFile('shop', ownerId, file);
      this.cachePhoto(res.file.id, file);
      return res.file.id;
    } catch (e) {
      this.toast((e as Error).message);
      return null;
    }
  }
  /** Supprime un article, sans confirmation : Annuler le remet tel qu'il était, sous le même identifiant. */
  delShop(id: string): ItemResult {
    const it = this._data()?.shop.find((x) => x.id === id); if (!it) return { kind: 'done' };
    const copie = { ...it };
    this.pushShopOps([{ op: 'remove', id }]);
    this.toastWithUndo('Article supprimé', () => this.pushShopOps(shopRestoreOps(copie)));
    return { kind: 'done' };
  }
  /**
   * Supprime les articles cochés d'une liste. Les introuvables ne sont pas
   * touchés : ils restent pour la prochaine fois. Le serveur garde le nom, le
   * rayon et la quantité de chaque coché retiré dans la mémoire d'achats
   * (shopping/memory.ts), pour qu'ils restent proposés à la saisie.
   */
  clearPicked(listId: string): void {
    const done = (this._data()?.shop || []).filter((i) => i.listId === listId && i.state === 'panier');
    if (!done.length) { this.toast('Aucun article coché'); return; }
    this.pushShopOps(done.map((i) => ({ op: 'remove' as const, id: i.id })));
    this.toast(done.length + (done.length > 1 ? ' articles supprimés' : ' article supprimé'));
  }

  // ---- shopping lists ---------------------------------------------------
  /** Nouvelle liste, en fiche. */
  newShopList(): void { this.openItem('shopList', null); }
  /** Enregistre une liste ; une liste créée devient la liste ouverte. */
  saveShopList(id: string | null, v: { name: string; color: string; icon: string }): ItemResult {
    const name = v.name.trim(); if (!name) { this.toast('Donne un nom à la liste'); return { kind: 'invalid' }; }
    const cur = id ? this._data()?.shopLists.find((l) => l.id === id) : undefined;
    if (cur) {
      if (cur.name === name && cur.color === v.color && (cur.icon || 'panier') === v.icon) return { kind: 'done' };
      this.mutate((d) => { const i = d.shopLists.findIndex((l) => l.id === cur.id); if (i >= 0) d.shopLists[i] = { ...d.shopLists[i], name, color: v.color, icon: v.icon }; });
      this.toast('Liste modifiée');
      return { kind: 'done' };
    }
    const nid = uid('cl');
    this.mutate((d) => { if (!d.shopLists.some((l) => l.id === nid)) d.shopLists.push({ id: nid, name, color: v.color, icon: v.icon }); });
    this.patch({ activeShopList: nid });
    this.toast('Liste de courses créée');
    return { kind: 'done' };
  }
  /**
   * Supprime une liste et ses articles, après confirmation : c'est une perte
   * sans retour. Les listes s'éditent par le document complet ; le serveur
   * retire lui-même les articles orphelins (shopping/repo.ts, reconcile), la
   * copie locale fait de même pour ne pas montrer des articles déjà partis.
   */
  delShopList(id: string, scope?: string): ItemResult {
    const l = this._data()?.shopLists.find((x) => x.id === id); if (!l) return { kind: 'done' };
    if (!scope) {
      const n = (this._data()?.shop || []).filter((x) => x.listId === id).length;
      return { kind: 'ask', question: 'Supprimer « ' + l.name + ' »' + (n > 1 ? ' et ses ' + n + ' articles' : n ? ' et son article' : '') + ' ? C’est définitif.',
        choices: [{ scope: 'all', label: 'Supprimer', danger: true }] };
    }
    this.mutate((d) => { d.shopLists = d.shopLists.filter((x) => x.id !== id); d.shop = d.shop.filter((x) => x.listId !== id); });
    if (this.ui().activeShopList === id) this.patch({ activeShopList: 'all' });
    this.toast('Liste supprimée');
    return { kind: 'done' };
  }

  // ---- lieux (inventaires par lieu de vacances) --------------------------
  // Comme les courses, tout passe par des opérations : ni les lieux ni les
  // affaires ne voyagent dans l'enregistrement du document complet.

  /** Les lieux, dans leur ordre. */
  placesInOrder(): Place[] {
    return [...(this._data()?.places || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }
  /** Les affaires d'un lieu. */
  itemsOfPlace(placeId: string): PlaceItem[] {
    return (this._data()?.placeItems || []).filter((i) => i.placeId === placeId);
  }

  /** Nouveau lieu, en fiche. */
  openPlace(): void { this.openItem('place', null); }
  /** Enregistre un lieu depuis sa fiche : seuls les champs changés partent. */
  savePlace(id: string | null, f: PlaceFields): ItemResult {
    if (!f.name.trim()) { this.toast('Donne un nom au lieu'); return { kind: 'invalid' }; }
    const before = id ? this._data()?.places.find((x) => x.id === id) ?? null : null;
    if (id && !before) { this.toast('Ce lieu n’existe plus'); return { kind: 'invalid' }; }
    const ops = placeOps(id || uid('lieu'), before, f);
    if (!ops.length) return { kind: 'done' };
    this.pushPlaceOps(ops);
    this.toast(before ? 'Lieu modifié' : 'Lieu créé');
    return { kind: 'done' };
  }
  /** Supprime un lieu après confirmation : il emporte son inventaire, sans retour. */
  delPlace(id: string, scope?: string): ItemResult {
    const p = this._data()?.places.find((x) => x.id === id); if (!p) return { kind: 'done' };
    if (!scope) {
      const n = this.itemsOfPlace(id).length;
      return { kind: 'ask', question: 'Supprimer « ' + p.name + ' »' + (n > 1 ? ' et ses ' + n + ' affaires' : n ? ' et son affaire' : '') + ' ? C’est définitif.',
        choices: [{ scope: 'all', label: 'Supprimer', danger: true }] };
    }
    this.pushPlaceOps([{ op: 'place-remove', id }]);
    this.toast('Lieu supprimé');
    return { kind: 'done' };
  }

  /** Ajoute une affaire à un lieu, restée là-bas par défaut. */
  addPlaceItem(placeId: string, name: string): void {
    const t = name.trim(); if (!t) return;
    this.pushPlaceOps([{ op: 'add', id: uid('pi'), placeId, name: t }]);
  }
  /** Les deux gestes : « J'ai laissé » (là-bas) et « J'ai ramené » (ici). */
  setPlaceItemState(id: string, state: PlaceItemState): void { this.pushPlaceOps([{ op: 'set-state', id, state }]); }

  /** Enregistre une affaire depuis sa fiche : seuls les champs changés partent. */
  savePlaceItem(id: string, f: PlaceItemFields): ItemResult {
    if (!f.name.trim()) { this.toast('Donne un nom à l’affaire'); return { kind: 'invalid' }; }
    const before = this._data()?.placeItems.find((x) => x.id === id);
    if (!before) { this.toast('Cette affaire n’existe plus'); return { kind: 'invalid' }; }
    const ops = placeItemOps(before, f);
    if (!ops.length) return { kind: 'done' };
    this.pushPlaceOps(ops);
    this.toast('Affaire modifiée');
    return { kind: 'done' };
  }
  /** Supprime une affaire, sans confirmation : Annuler la remet à l'identique, état compris. */
  delPlaceItem(id: string): ItemResult {
    const it = this._data()?.placeItems.find((x) => x.id === id); if (!it) return { kind: 'done' };
    const copie = { ...it };
    this.pushPlaceOps([{ op: 'remove', id }]);
    this.toastWithUndo('Affaire supprimée', () => this.pushPlaceOps(placeItemRestoreOps(copie)));
    return { kind: 'done' };
  }

  // ---- rayons -------------------------------------------------------------
  readonly aislesInOrder = computed(() => (this._data()?.aisles || []).slice().sort((a, b) => a.position - b.position));
  /** Un rayon est-il replié (ses articles masqués) ? */
  /** « Masquer les cochés » : préférence d'appareil, activée par défaut (voir SHOP_HIDE_CHECKED_KEY). */
  readonly shopHideChecked = signal<boolean>(loadShopHideChecked());
  toggleShopHideChecked(): void {
    const next = !this.shopHideChecked();
    this.shopHideChecked.set(next);
    try { localStorage.setItem(SHOP_HIDE_CHECKED_KEY, next ? '1' : '0'); } catch { /* mode privé : vaut pour la session */ }
  }

  aisleCollapsed(id: string): boolean { return this.ui().collapsedAisles.includes(id); }
  /** Replier ou déplier un rayon : on masque ses articles, cochés ou non, sans toucher aux données. */
  toggleAisleCollapse(id: string): void {
    const cur = this.ui().collapsedAisles;
    this.patch({ collapsedAisles: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  }
  /** Nouveau rayon, en fiche. */
  newAisle(): void { this.openItem('aisle', null); }
  saveAisle(id: string | null, v: { name: string; color: string; kind: Rayon | '' }): ItemResult {
    const name = v.name.trim(); if (!name) { this.toast('Donne un nom au rayon'); return { kind: 'invalid' }; }
    const cur = id ? this._data()?.aisles.find((a) => a.id === id) : undefined;
    if (cur) {
      if (cur.name === name && cur.color === v.color && (cur.kind || '') === v.kind) return { kind: 'done' };
      // Les articles désignent le rayon par son identifiant : renommer ne demande
      // plus de rattraper quoi que ce soit dans la liste.
      this.mutate((d) => { const i = d.aisles.findIndex((a) => a.id === cur.id); if (i >= 0) d.aisles[i] = { ...d.aisles[i], name, color: v.color, kind: v.kind || null }; });
      this.toast('Rayon modifié');
      return { kind: 'done' };
    }
    const nid = uid('a');
    this.mutate((d) => { if (!d.aisles.some((a) => a.id === nid)) d.aisles.push({ id: nid, name, color: v.color, position: d.aisles.length, ...(v.kind ? { kind: v.kind } : {}) }); });
    this.toast('Rayon ajouté');
    return { kind: 'done' };
  }
  /** Remonte ou descend un rayon : c'est l'ordre des allées du magasin habituel. */
  moveAisle(id: string, dir: -1 | 1): void {
    const ordered = this.aislesInOrder();
    const i = ordered.findIndex((a) => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const ids = ordered.map((a) => a.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.mutate((d) => { d.aisles.forEach((a) => { a.position = ids.indexOf(a.id); }); });
  }
  /** Supprime un rayon après confirmation ; ses articles passent au rayon de repli, qui lui ne se supprime pas. */
  delAisle(id: string, scope?: string): ItemResult {
    const a = this._data()?.aisles.find((x) => x.id === id); if (!a) return { kind: 'done' };
    const fallback = this.defaultAisleId();
    if (id === fallback) { this.toast('Ce rayon sert de repli, il ne peut pas être supprimé'); return { kind: 'invalid' }; }
    if (!scope) {
      const n = (this._data()?.shop || []).filter((x) => x.aisleId === id).length;
      const repli = this._data()?.aisles.find((x) => x.id === fallback)?.name || 'le rayon de repli';
      return { kind: 'ask', question: 'Supprimer le rayon « ' + a.name + ' » ?' + (n ? ' Ses ' + n + ' article' + (n > 1 ? 's passeront' : ' passera') + ' dans « ' + repli + ' ».' : ''),
        choices: [{ scope: 'all', label: 'Supprimer', danger: true }] };
    }
    this.mutate((d) => {
      d.aisles = d.aisles.filter((x) => x.id !== id);
      d.aisles.forEach((x, i) => { x.position = i; });
      d.shop.forEach((x) => { if (x.aisleId === id) x.aisleId = fallback; });
    });
    this.toast('Rayon supprimé');
    return { kind: 'done' };
  }

  // ---- tâches : opérations, file et annulation -----------------------------
  //
  // Même dispositif que les courses, ci-dessus. Ce qui s'annule s'annule par
  // l'opération inverse (voir task-ops.ts), jamais par une remise en bloc du
  // tableau, qui effacerait ce que l'autre appareil vient d'écrire.

  private saveTaskQueue(q: TaskOp[]): void {
    this.taskQueue.set(q);
    try { localStorage.setItem(TASK_QUEUE_KEY, JSON.stringify(q)); } catch { /* quota : la file reste en mémoire */ }
  }

  private applyTaskLocally(op: TaskOp): void {
    const cur = this._data(); if (!cur) return;
    // La remise à zéro pose aussi lastResetAt sur la liste (comme le serveur) :
    // affichage immédiat, sans PUT du document (le reset le persiste déjà).
    const taskLists = op.op === 'reset'
      ? cur.taskLists.map((l) => (l.id === op.id ? { ...l, lastResetAt: op.at ?? new Date().toISOString() } : l))
      : cur.taskLists;
    this._data.set({ ...cur, tasks: applyTaskOp(cur.tasks, op), taskLists });
  }

  /** Empile une ou plusieurs opérations : affichage immédiat, envoi groupé. */
  private pushTaskOps(ops: TaskOpDraft[]): void {
    const by = this.me()?.id ?? null;
    const at = new Date().toISOString();
    const full = ops.map((o) => ({ ...o, opId: uid('op'), by, at }) as TaskOp);
    for (const op of full) this.applyTaskLocally(op);
    this.saveTaskQueue([...this.taskQueue(), ...full]);
    if (this.taskFlushTimer) clearTimeout(this.taskFlushTimer);
    this.taskFlushTimer = setTimeout(() => void this.flushTaskQueue(), 300);
  }

  /**
   * Envoie la file. Une liste créée à l'instant part par l'enregistrement du
   * document : il passe d'abord, sinon le serveur refuserait la tâche pour
   * une liste qu'il ne connaît pas encore.
   */
  async flushTaskQueue(): Promise<void> {
    if (this.taskFlushing || !this.authed() || !this.taskQueue().length) return;
    if (this.saving) { setTimeout(() => void this.flushTaskQueue(), 500); return; }
    if (this.pending.length) { await this.flush(); if (this.saveState() === 'error') return; }
    const batch = this.taskQueue();
    if (!batch.length) return;
    this.taskFlushing = true;
    try {
      const res = await this.api.taskOps(batch);
      this.syncOffline.set(false);
      const settled = new Set([...res.applied, ...res.skipped.map((k) => k.opId)]);
      this.saveTaskQueue(this.taskQueue().filter((o) => !settled.has(o.opId)));
      this.adoptTasks(res.items);
      if (res.skipped.length) {
        // Le dire : une coche refusée sans explication est exactement ce qui
        // ferait douter de toutes les autres.
        this.toast(res.skipped.length === 1 ? 'Refusé : ' + res.skipped[0].reason : res.skipped.length + ' modifications de tâches refusées');
      }
    } catch {
      this.syncOffline.set(true);
    } finally {
      this.taskFlushing = false;
    }
  }

  /** Une opération et son annulation, offerte quelques secondes. */
  private taskOpWithUndo(op: TaskOpDraft, msg: string): void {
    const back = inverseOf(op, this.task(op.id));
    this.pushTaskOps([op]);
    if (back) this.toastWithUndo(msg, () => this.pushTaskOps([back]));
    else this.toast(msg);
  }

  private taskOpsWithUndo(ops: TaskOpDraft[], msg: string): void {
    const backs = ops.map((op) => inverseOf(op, this.task(op.id))).filter((b): b is TaskOpDraft => !!b);
    this.pushTaskOps(ops);
    if (backs.length) this.toastWithUndo(msg, () => this.pushTaskOps(backs));
    else this.toast(msg);
  }

  task(id: string): TaskItem | undefined { return this._data()?.tasks.find((t) => t.id === id); }

  /** Les listes que ce membre a le droit de voir. */
  visibleTaskLists(includeArchived = false): TaskList[] {
    return visibleLists(this._data()?.taskLists || [], this.currentMemberId(), includeArchived);
  }

  /** La liste où atterrit une saisie : celle qui est ouverte, sinon la première liste « tâches » visible. */
  activeTaskListId(): string {
    const lists = this.visibleTaskLists();
    const a = this.ui().activeList;
    if (a !== 'all' && lists.some((l) => l.id === a)) return a;
    return (lists.find((l) => l.kind === 'taches') || lists[0])?.id || '';
  }

  taskSuggestions(listId: string, typed: string): string[] { return suggestTexts(this._data()?.tasks || [], listId, typed); }
  taskCategories(): string[] { return categories(this._data()?.tasks || []); }

  /**
   * Crée une tâche depuis la saisie rapide, et rend son identifiant. Utilisée par
   * l'écran Tâches comme par l'accueil : une seule écriture de ce que « ajouter
   * une tâche » veut dire.
   */
  createTask(draft: TaskDraft): string | null {
    const text = draft.text.trim(); if (!text) return null;
    const listId = draft.listId || this.activeTaskListId();
    if (!listId) { this.toast('Créez d’abord une liste de tâches'); return null; }
    const id = uid('t');
    // Une série a toujours une échéance : sans elle, « toutes les semaines » ne veut rien dire.
    const due = draft.due || (draft.rec ? this.todayStr() : null);
    this.pushTaskOps([{
      op: 'add', id, listId, text, who: draft.who, due, time: due ? draft.time || null : null,
      cat: draft.cat.trim(), note: draft.note.trim(), rec: draft.rec, remind: due ? draft.remind : null,
    }]);
    return id;
  }

  /** Reprend une affaire de l'inventaire d'un lieu comme article à préparer dans une liste. */
  addPrepArticle(listId: string, name: string): void {
    const text = name.trim(); if (!text) return;
    this.pushTaskOps([{ op: 'add', id: uid('t'), listId, text, who: [], due: null }]);
    this.toast('Ajouté à préparer');
  }

  /**
   * Modifie une tâche. Sur une série, « cette occurrence seulement » détache
   * une copie ponctuelle qui porte la modification, et fait avancer la série :
   * une occurrence retouchée n'est pas un troisième type d'objet.
   */
  /** Modifie une tâche. Renvoie l'identifiant de la copie ponctuelle quand seule l'occurrence change. */
  updateTask(id: string, fields: TaskFields, scope: 'one' | 'all' = 'all'): string | null {
    const t = this.task(id); if (!t) return null;
    if (scope === 'one' && t.rec && t.due) {
      const next = skipOccurrence(t.rec, t.due, this.todayStr());
      const { rec: _rec, ...rest } = fields; void _rec;
      const copy = { ...t, ...rest };
      const copyId = uid('t');
      this.taskOpsWithUndo([
        { op: 'add', id: copyId, listId: copy.listId, text: copy.text, who: copy.who, due: copy.due, time: copy.time ?? null, cat: copy.cat || '', note: copy.note || '', shopListId: copy.shopListId ?? null, remind: copy.remind ?? null, contractId: copy.contractId ?? null },
        { op: 'skip', id, occ: t.due, next },
      ], 'Cette occurrence modifiée, la série continue');
      return copyId;
    }
    if (fields.rec && !(fields.due ?? t.due)) fields.due = this.todayStr();
    this.pushTaskOps([{ op: 'edit', id, ...fields }]);
    return null;
  }

  /** « samedi », « 12/09/2026 » : l'échéance suivante telle qu'on la lit. */
  private nextLabel(iso: string): string { return dueLabel(iso, null, this.todayStr(), (d) => this.fmtNumDate(d)); }

  /**
   * Un tap : faite, ou rouverte. Sur une série, la coche solde l'occurrence
   * courante et fait avancer l'échéance à la suivante, calculée ici ; annuler
   * rétablit l'occurrence soldée. Le retour en arrière est toujours offert.
   */
  toggleTask(id: string): void {
    const t = this.task(id); if (!t) return;
    if (t.done) { this.taskOpWithUndo({ op: 'reopen', id, ...(t.rec ? { occ: t.due || '' } : {}) }, 'Tâche rouverte'); return; }
    const subs = this.subtasks(id);
    if (t.rec && t.due) {
      const next = nextOccurrence(t.rec, t.due, this.todayStr());
      const msg = next ? 'Faite. Prochaine : ' + this.nextLabel(next) : 'Faite, la série s’arrête là';
      // Une série qui avance repart avec ses cases : les sous-tâches d'une
      // occurrence soldée sont celles de la suivante, à refaire.
      const remises = next ? subs.filter((sb) => sb.done) : [];
      this.taskOpsWithUndo(
        [{ op: 'done', id, occ: t.due, next }, ...remises.map((sb) => ({ op: 'reopen' as const, id: sb.id }))],
        remises.length ? msg + ', cases remises à zéro' : msg,
      );
      return;
    }
    const ouvertes = subs.filter((sb) => !sb.done);
    if (ouvertes.length) {
      // Cocher le parent coche ce qu'il porte : laisser des sous-tâches ouvertes
      // sous une ligne barrée les rendrait invisibles. Un seul geste défait tout.
      this.taskOpsWithUndo(
        [{ op: 'done', id }, ...ouvertes.map((sb) => ({ op: 'done' as const, id: sb.id }))],
        (ouvertes.length > 1 ? 'Faite, avec ses ' + ouvertes.length + ' sous-tâches' : 'Faite, avec sa sous-tâche'),
      );
      return;
    }
    // La dernière sous-tâche cochée propose de clore le parent, elle ne le coche
    // pas : c'est au foyer de dire que l'affaire est finie.
    if (t.parentId) {
      this.pushTaskOps([{ op: 'done', id }]);
      if (this.proposeParentClose(t.parentId)) return;
      const back = inverseOf({ op: 'done', id }, t);
      if (back) this.toastWithUndo('Tâche faite', () => this.pushTaskOps([back]));
      else this.toast('Tâche faite');
      return;
    }
    this.taskOpWithUndo({ op: 'done', id }, 'Tâche faite');
  }

  /** Les sous-tâches d'une tâche, dans leur ordre. */
  subtasks(id: string): TaskItem[] { return subtasksOf(this._data()?.tasks || [], id); }

  /** Le parent vient-il de voir sa dernière sous-tâche cochée ? Alors le proposer, sans le faire. */
  private proposeParentClose(parentId: string): boolean {
    const p = this.task(parentId);
    if (!p || p.done) return false;
    const subs = this.subtasks(parentId);
    if (!subs.length || subs.some((sb) => !sb.done)) return false;
    this.toastAction('Tout est coché. Clore « ' + p.text + ' » ?', 'Clore', () => this.toggleTask(parentId));
    return true;
  }

  /** Une sous-tâche : un intitulé sous un parent, et rien d'autre à régler. */
  addSubtask(parentId: string, text: string): string | null {
    const p = this.task(parentId); const t = text.trim();
    if (!p || !t) return null;
    if (p.parentId) { this.toast('Une sous-tâche ne peut pas en avoir elle-même'); return null; }
    const id = uid('t');
    // La clé d'ordre est posée par le serveur (fin de liste) ; une sous-tâche
    // neuve se range donc après les autres, sans qu'on calcule d'index ici.
    this.pushTaskOps([{ op: 'add', id, listId: p.listId, text: t, who: [], due: null, parentId }]);
    return id;
  }

  /**
   * Le rangement après un glisser-déposer : un seul déplacement relatif est
   * envoyé (la tâche qui a bougé, et ce qu'elle suit), jamais une renumérotation
   * de la liste. Le serveur calcule la clé fractionnaire sur les voisins réels.
   */
  reorderTasks(ids: readonly string[]): void {
    // `ids` est le nouvel ordre d'un groupe rendu par le glisser-déposer. On en
    // déduit LA tâche qui a bougé et ce qu'elle suit désormais, pour n'émettre
    // qu'un seul déplacement relatif : le serveur recalcule la clé sur les
    // voisins réels, et deux appareils qui rangent en même temps ne s'écrasent pas.
    const set = new Set(ids);
    const old = (this.data()?.tasks || []).filter((t) => set.has(t.id)).sort(byOrd).map((t) => t.id);
    const mv = singleMove(old, ids);
    if (!mv) return;
    const op: TaskOpDraft = mv.avant ? { op: 'move', id: mv.id, avant: mv.avant } : { op: 'move', id: mv.id, apres: mv.apres! };
    this.taskOpWithUndo(op, 'Tâche déplacée');
  }

  /** Passer l'occurrence courante d'une série sans la faire. */
  skipTask(id: string): void {
    const t = this.task(id); if (!t?.rec || !t.due || t.done) return;
    const next = skipOccurrence(t.rec, t.due, this.todayStr());
    this.taskOpWithUndo({ op: 'skip', id, occ: t.due, next }, next ? 'Occurrence passée. Prochaine : ' + this.nextLabel(next) : 'Série terminée');
  }

  /** Reporte une tâche : à demain par défaut. */
  postponeTask(id: string, to = this.addDays(this.todayStr(), 1)): void {
    if (!this.task(id)) return;
    const demain = to === this.addDays(this.todayStr(), 1);
    this.taskOpWithUndo({ op: 'edit', id, due: to }, demain ? 'Reportée à demain' : to === this.todayStr() ? 'Reportée à aujourd’hui' : 'Reportée au ' + this.fmtNumDate(to));
  }

  /** Report en masse, avec une seule annulation pour tout le lot. */
  postponeTasks(ids: string[], to: string): void {
    const ops: TaskOpDraft[] = ids.filter((id) => !!this.task(id)).map((id) => ({ op: 'edit', id, due: to }));
    if (!ops.length) return;
    const quand = to === this.todayStr() ? 'à aujourd’hui' : to === this.addDays(this.todayStr(), 1) ? 'à demain' : 'au ' + this.fmtNumDate(to);
    this.taskOpsWithUndo(ops, ops.length + (ops.length > 1 ? ' tâches reportées ' : ' tâche reportée ') + quand);
  }

  /** Supprime une tâche, ou seulement l'occurrence courante d'une série. */
  removeTask(id: string, scope: 'one' | 'all' = 'all'): void {
    const t = this.task(id); if (!t) return;
    if (scope === 'one' && t.rec) { this.skipTask(id); return; }
    const subs = this.subtasks(id);
    if (subs.length) {
      // Les sous-tâches partent avec leur parent, et reviennent avec lui : une
      // seule annulation, sinon on rendrait la tâche sans ce qu'elle portait.
      this.taskOpsWithUndo(
        [...subs.map((sb) => ({ op: 'remove' as const, id: sb.id })), { op: 'remove', id }],
        (subs.length > 1 ? 'Tâche supprimée, avec ses ' + subs.length + ' sous-tâches' : 'Tâche supprimée, avec sa sous-tâche'),
      );
      return;
    }
    this.taskOpWithUndo({ op: 'remove', id }, t.rec ? 'Série supprimée' : 'Tâche supprimée');
  }

  /** Une checklist se refait : tout décocher, d'un geste, annulable. */
  uncheckAll(listId: string): void {
    const ops: TaskOpDraft[] = (this._data()?.tasks || []).filter((t) => t.listId === listId && t.done).map((t) => ({ op: 'reopen', id: t.id }));
    if (!ops.length) { this.toast('Rien à décocher'); return; }
    this.taskOpsWithUndo(ops, ops.length + (ops.length > 1 ? ' cases décochées' : ' case décochée'));
  }

  /**
   * Remet une liste de préparation à zéro : les articles restent, les coches
   * s'effacent, la liste porte la date du geste. Opération ciblée, comme une
   * coche ; pas d'annulation (l'écran a demandé confirmation).
   */
  resetList(listId: string): void {
    this.patch({ prepResetId: null });
    this.pushTaskOps([{ op: 'reset', id: listId }]);
    this.toast('Liste remise à zéro');
  }

  /** Décalage en jours sur une date ISO, dans le calendrier du foyer. */
  addDays = addDaysIso;

  /**
   * Tâche créée depuis un autre module. C'est une **copie ponctuelle**, assumée :
   * si la date du contrat bouge ensuite, la tâche ne suit pas. Une tâche que
   * l'utilisateur peut cocher, déplacer et supprimer doit lui appartenir, pas
   * réapparaître parce qu'une table dit autre chose.
   */
  addExternalTask(text: string, due: string | null, who: string[] = [], link: { contractId?: number | null } = {}): string | null {
    const listId = this.activeTaskListId();
    if (!listId) { this.toast('Créez d’abord une liste de tâches'); return null; }
    const id = uid('t');
    this.pushTaskOps([{ op: 'add', id, listId, text, who, due, contractId: link.contractId ?? null }]);
    this.toast('Tâche ajoutée');
    return id;
  }

  // ---- listes de tâches et modèles -------------------------------------------
  // Elles s'éditent par l'enregistrement du document : ce sont des réglages,
  // pas des coches, et le serveur en tire lui-même les conséquences pour les tâches.

  newTaskList(kind: ListKind = 'taches'): void {
    const icon = kind === 'taches' ? 'maison' : kind === 'preparation' ? 'valise' : 'checklist';
    this.patch({ listForm: true, listEditId: null, lName: '', lColor: '#E56B4E', lIcon: icon, lKind: kind, lScope: 'shared', lOrder: 'echeance', lForMember: null, lDeparture: '', lRemind: 3, lPlace: '' });
  }
  editTaskList(id: string): void {
    const l = this._data()?.taskLists.find((x) => x.id === id); if (!l) return;
    this.patch({ listForm: true, listEditId: id, lName: l.name, lColor: l.color, lIcon: l.icon || 'checklist', lKind: l.kind, lScope: l.scope, lOrder: l.order === 'manuel' ? 'manuel' : 'echeance',
      lForMember: l.forMember ?? null, lDeparture: l.departure ?? '', lRemind: l.remindDaysBefore ?? 3, lPlace: l.placeId ?? '' });
  }
  /** Les champs propres à une liste de préparation, ou de quoi les effacer si elle n'en est pas (ou plus) une. */
  private prepFields(): Partial<TaskList> {
    const s = this.ui();
    if (s.lKind !== 'preparation') return { forMember: null, departure: null, remindDaysBefore: null, lastResetAt: null, placeId: null };
    const remind = Math.min(30, Math.max(1, Math.round(s.lRemind || 3)));
    return { forMember: s.lForMember || null, departure: s.lDeparture || null, remindDaysBefore: remind, placeId: s.lPlace || null };
  }
  saveTaskList(): void {
    const s = this.ui(); const name = s.lName.trim(); if (!name) { this.toast('Donne un nom à la liste'); return; }
    // Une liste de préparation est toujours partagée : l'enfant coche son sac.
    const scope = s.lKind === 'preparation' ? 'shared' : s.lScope;
    const extra = this.prepFields();
    // Le mode manuel ne concerne que les tâches et les corvées ; ailleurs il est
    // absent (échéance par défaut, la checklist étant manuelle par nature).
    const order = (s.lKind === 'taches' || s.lKind === 'corvees') && s.lOrder === 'manuel' ? 'manuel' : undefined;
    if (s.listEditId) {
      const before = this._data()?.taskLists.find((l) => l.id === s.listEditId);
      this.mutate((d) => { const i = d.taskLists.findIndex((l) => l.id === s.listEditId); if (i >= 0) d.taskLists[i] = { ...d.taskLists[i], name, color: s.lColor, icon: s.lIcon, kind: s.lKind, scope, order, ...extra }; });
      this.toast('Liste modifiée');
      this.patch({ listForm: false, listEditId: null });
      // Nouveau départ : la date a changé et des affaires restent cochées de la
      // dernière fois. On propose de repartir de zéro dans la foulée.
      const hasChecked = (this._data()?.tasks || []).some((t) => t.listId === s.listEditId && t.done);
      if (s.lKind === 'preparation' && extra.departure && before?.departure !== extra.departure && hasChecked) {
        this.patch({ prepResetId: s.listEditId });
      }
      return;
    }
    const id = this.createTaskList(name, s.lColor, s.lIcon, s.lKind, scope, { ...extra, ...(order ? { order } : {}) });
    this.patch({ listForm: false, activeList: id });
    this.toast('Liste créée');
  }
  private createTaskList(name: string, color: string, icon: string, kind: ListKind, scope: string, extra: Partial<TaskList> = {}): string {
    const id = uid('l');
    this.mutate((d) => {
      const position = d.taskLists.reduce((m, l) => Math.max(m, l.position ?? 0), -1) + 1;
      d.taskLists.push({ id, name, color, icon, kind, scope, position, ...extra });
    });
    return id;
  }
  /** Archiver range une liste sans rien perdre ; c'est réversible, et proposé tout de suite. */
  archiveTaskList(id: string, archived: boolean): void {
    this.mutate((d) => { const l = d.taskLists.find((x) => x.id === id); if (l) l.archived = archived; });
    if (this.ui().activeList === id && archived) this.patch({ activeList: 'all' });
    this.toastWithUndo(archived ? 'Liste archivée' : 'Liste restaurée', () => this.archiveTaskList(id, !archived));
  }
  confirmTaskListDel(): void {
    const id = this.ui().listDelId; if (!id) return;
    // Les tâches partent avec la liste : le serveur le fait de son côté, l'écran l'anticipe.
    this.mutate((d) => { d.taskLists = d.taskLists.filter((l) => l.id !== id); d.tasks = d.tasks.filter((t) => t.listId !== id); });
    this.patch({ listDelId: null, activeList: this.ui().activeList === id ? 'all' : this.ui().activeList });
    this.toast('Liste supprimée');
  }

  /** Le contenu d'une liste devient un modèle : ses intitulés, faits ou non, dans l'ordre. */
  saveListAsTemplate(listId: string): void {
    const d = this._data(); const l = d?.taskLists.find((x) => x.id === listId); if (!d || !l) return;
    const items = d.tasks.filter((t) => t.listId === listId).sort((a, b) => (a.at || '').localeCompare(b.at || '')).map((t) => t.text);
    if (!items.length) { this.toast('La liste est vide, rien à retenir'); return; }
    this.mutate((dd) => { dd.taskTemplates.push({ id: uid('tp'), name: l.name, kind: l.kind, color: l.color, icon: l.icon, items }); });
    this.toast('Modèle « ' + l.name + ' » enregistré, ' + items.length + (items.length > 1 ? ' lignes' : ' ligne'));
  }

  /**
   * Une liste neuve à partir d'un modèle. La liste part par le document, ses
   * lignes par opérations : l'envoi de la file attend que le document soit passé.
   */
  createListFromTemplate(tplId: string): void {
    const tpl = this._data()?.taskTemplates.find((t) => t.id === tplId); if (!tpl) return;
    const listId = this.createTaskList(tpl.name, tpl.color, tpl.icon, tpl.kind, 'shared');
    const base = Date.now();
    this.pushTaskOps(tpl.items.map((text, i) => ({ op: 'add' as const, id: uid('t'), listId, text, who: [], due: null, at: new Date(base + i).toISOString() })));
    this.patch({ tplOpen: false, activeList: listId });
    this.toast('Liste « ' + tpl.name + ' » créée');
  }
  deleteTemplate(id: string): void {
    this.mutate((d) => { d.taskTemplates = d.taskTemplates.filter((t) => t.id !== id); });
    this.toast('Modèle supprimé');
  }

  // ---- contacts ---------------------------------------------------------
  newContact(): void { this.patch({ contactForm: true, coEditId: null, coName: '', coRole: '', coPhone: '', coEmail: '', coCat: 'Famille', coColor: '#9B6FA8', coUrgent: false, coBirthday: '' }); }
  editContact(id: string): void { const c = this._data()?.contacts.find((x) => x.id === id); if (!c) return; this.patch({ contactForm: true, coEditId: id, coName: c.name, coRole: c.role, coPhone: c.phone, coEmail: c.email || '', coCat: c.cat, coColor: c.color, coUrgent: !!c.urgent, coBirthday: c.birthday || '' }); }
  saveContact(): void {
    const s = this.ui(); const name = s.coName.trim(); if (!name) { this.toast('Donne un nom'); return; } const phone = s.coPhone.trim(); if (!phone) { this.toast('Indique un téléphone'); return; }
    const data = { name, role: s.coRole.trim(), phone, email: s.coEmail.trim(), cat: s.coCat as any, color: s.coColor, urgent: s.coUrgent, birthday: s.coBirthday || null };
    this.mutate((d) => {
      if (s.coEditId) { const i = d.contacts.findIndex((c) => c.id === s.coEditId); if (i >= 0) d.contacts[i] = { ...d.contacts[i], ...data }; }
      else d.contacts.push({ id: uid('ct'), ...data });
    });
    this.toast(s.coEditId ? 'Contact modifié' : 'Contact ajouté');
    this.patch({ contactForm: false, coEditId: null });
  }
  confirmContactDel(): void { const id = this.ui().contactDelId; if (!id) return; this.mutate((d) => { d.contacts = d.contacts.filter((c) => c.id !== id); }); this.patch({ contactDelId: null }); this.toast('Contact supprimé'); }

  // ---- cartes de fidélité -----------------------------------------------
  // Un code partagé par tout le foyer, réaffiché en QR ou code-barres. Le code
  // est du texte ; le logo est soit un monogramme dérivé du nom, soit un logo
  // choisi (recherché en ligne d'après le nom), gardé en data-URI dans le document.
  private resetLogo(): Partial<UiState> { return { caLogo: '', logoOpts: [], logoBusy: false, logoSearched: false }; }
  newCard(): void { this.patch({ cardForm: true, caEditId: null, caName: '', caCode: '', caFormat: 'qr', caColor: cardColor(''), caNote: '', caColorTouched: false, scanOpen: false, ...this.resetLogo() }); }
  editCard(id: string): void {
    const c = this._data()?.cards.find((x) => x.id === id); if (!c) return;
    this.patch({ cardForm: true, caEditId: id, caName: c.name, caCode: c.code, caFormat: c.format, caColor: c.color, caNote: c.note || '', caColorTouched: true, cardShow: null, ...this.resetLogo(), caLogo: c.logo || '' });
  }
  /** Le scan a rendu un code et son format : la saisie s'ouvre pré-remplie, il ne reste que le nom. */
  cardFromScan(code: string, format: CardFormat): void {
    this.patch({ cardForm: true, caEditId: null, caName: '', caCode: code, caFormat: format, caColor: cardColor(''), caNote: '', caColorTouched: false, scanOpen: false, ...this.resetLogo() });
  }
  /** Le nom pilote la couleur suggérée ; changer le nom périme aussi les logos proposés. */
  onCardName(v: string): void { this.patch({ caName: v, logoOpts: [], logoSearched: false, ...(this.ui().caColorTouched ? {} : { caColor: cardColor(v) }) }); }
  pickCardColor(c: string): void { this.patch({ caColor: c, caColorTouched: true }); }
  /**
   * Cherche des logos d'après le nom saisi. Gardé par le réglage `cardLogoSearch`
   * (le bouton n'apparaît pas s'il est éteint). Une panne ou une liste vide laisse
   * le monogramme : rien ne casse.
   */
  async searchCardLogos(): Promise<void> {
    const name = this.ui().caName.trim();
    if (name.length < 2) { this.toast('Écris d’abord le nom de l’enseigne'); return; }
    this.patch({ logoBusy: true, logoSearched: true });
    try { this.patch({ logoOpts: (await this.api.cardLogos(name)).logos, logoBusy: false }); }
    catch { this.patch({ logoOpts: [], logoBusy: false }); }
  }
  pickCardLogo(dataUri: string): void { this.patch({ caLogo: dataUri }); }
  /** Revenir au monogramme : oublier le logo choisi. */
  useMonogram(): void { this.patch({ caLogo: '' }); }
  saveCard(): void {
    const s = this.ui(); const name = s.caName.trim(); const code = s.caCode.trim();
    if (!name) { this.toast('Donne un nom à la carte'); return; }
    if (!code) { this.toast('Le code est vide : scanne la carte ou saisis-le'); return; }
    const data = { name, code, format: s.caFormat, color: s.caColor, note: s.caNote.trim() || undefined, logo: s.caLogo || undefined };
    this.mutate((d) => {
      if (s.caEditId) { const i = d.cards.findIndex((c) => c.id === s.caEditId); if (i >= 0) d.cards[i] = { ...d.cards[i], ...data }; }
      else d.cards.push({ id: uid('cf'), ...data });
    });
    this.toast(s.caEditId ? 'Carte modifiée' : 'Carte ajoutée');
    this.patch({ cardForm: false, caEditId: null });
  }
  confirmCardDel(): void { const id = this.ui().cardDelId; if (!id) return; this.mutate((d) => { d.cards = d.cards.filter((c) => c.id !== id); }); this.patch({ cardDelId: null, cardShow: null }); this.toast('Carte supprimée'); }
  /** Ouvrir une carte, c'est la présenter en caisse : on compte l'usage pour nourrir le classement « fréquemment utilisées ». */
  showCard(id: string): void {
    this.mutate((d) => { const c = d.cards.find((x) => x.id === id); if (c) { c.uses = (c.uses || 0) + 1; c.lastUsedAt = new Date().toISOString(); } });
    this.patch({ cardShow: id });
  }
  closeCard(): void { this.patch({ cardShow: null }); }
  toggleCardSort(): void { void this.setSetting('cardSort', this.setting('cardSort') === 'freq' ? 'nom' : 'freq'); }
  openScan(): void { this.patch({ scanOpen: true }); }
  closeScan(): void { this.patch({ scanOpen: false }); }

  // ---- meals ------------------------------------------------------------
  // Un créneau porte plusieurs plats, dans l'ordre du service : une entrée, un
  // plat, un dessert se choisissent séparément. Pas d'étiquette imposée, l'ordre
  // suffit et une taxonomie fixe (entrée/plat/dessert) laisserait dehors l'apéro,
  // le fromage et l'accompagnement.

  /** Intitulé d'un plat : le nom de la recette, ou le texte saisi. */
  mealItemName(it: MealItem): string { return mealItemName(it, this._data()?.recipes || []); }
  /** Intitulés d'un créneau, dans l'ordre. Vide quand rien n'est prévu. */
  mealNames(v?: MealValue): string[] { return mealNames(v, this._data()?.recipes || []); }
  /** Une ligne pour les vignettes et l'accueil : « Salade · Gratin · Tiramisu ». */
  mealLabel(v?: MealValue): string | null {
    const names = this.mealNames(v);
    return names.length ? names.join(' · ') : null;
  }

  /** Un tap sur un créneau : sa fiche s'il est garni, sinon sa saisie directement. */
  openMeal(dateStr: string, slot: string): void {
    const key = dateStr + '-' + slot;
    if (this.mealAt(key)) this.openItem('meal', key); else this.openItem('meal', null, { date: dateStr, slot });
  }

  /** Le repas d'un créneau (« 2026-10-20-soir »), s'il porte au moins un plat. */
  mealAt(key: string): MealValue | null { const v = this._data()?.meals[key]; return v?.items?.length ? v : null; }

  /**
   * Le repas tel que le formulaire le décrit. Les couverts ne sont retenus que
   * s'ils dérogent au décompte des présents : un chiffre recopié partout se
   * périmerait au premier changement de famille.
   */
  mealFromForm(dateStr: string, slot: string, items: MealItem[], paxText: string, away: string[]): MealValue {
    const pax = parseInt(paxText, 10);
    const attendus = this.presenceWith(dateStr, slot, away).pax;
    return {
      items: items.map((i) => ({ ...i })),
      ...(Number.isFinite(pax) && pax > 0 && pax !== attendus ? { pax } : {}),
      ...(away.length ? { away: [...away] } : {}),
    };
  }

  /** Enregistre un créneau. Rien de changé : rien n'est écrit. */
  saveMeal(key: string, value: MealValue): ItemResult {
    if (!value.items.length) { this.toast('Choisis au moins un plat'); return { kind: 'invalid' }; }
    if (sameMeal(this._data()?.meals[key], value)) return { kind: 'done' };
    this.mutate((d) => { d.meals[key] = value; });
    this.toast(value.items.length > 1 ? value.items.length + ' plats enregistrés' : 'Repas enregistré');
    return { kind: 'done' };
  }
  /**
   * Écrit une copie de repas déjà calculée. Le rapport est produit par l'écran,
   * qui seul connaît la période affichée, et il est montré avant d'arriver ici :
   * cette méthode ne décide de rien, elle applique.
   */
  copyMeals(report: CopyReport): void {
    if (!report.writes.length && !report.cleared.length) { this.toast('Rien à recopier'); return; }
    this.mutate((d) => { d.meals = applyMealCopy(d.meals, report); });
    this.patch({ dupOpen: false });
    const n = report.writes.length;
    const vides = report.cleared.length - report.writes.filter((w) => report.cleared.includes(w.to)).length;
    this.toast(n + (n > 1 ? ' repas recopiés' : ' repas recopié') + (vides > 0 ? ', ' + vides + ' créneau(x) vidé(s)' : ''));
  }

  // ---- liens avec le reste du foyer -------------------------------------

  /** Articles restant à prendre sur une liste. Sert au libellé de la tâche liée. */
  shopRemaining(listId: string): number {
    return (this._data()?.shop || []).filter((i) => i.listId === listId && i.state === 'a-prendre').length;
  }

  /** La tâche qui ouvre cette liste, s'il y en a une encore à faire. */
  shoppingTask(listId: string): TaskItem | undefined {
    return (this._data()?.tasks || []).find((t) => t.shopListId === listId && !t.done);
  }

  /**
   * Crée la tâche qui ouvre cette liste. Elle appartient ensuite au foyer :
   * personne ne la recrée, ne la coche ni ne la supprime à sa place. Le lien
   * n'est qu'un raccourci, pas un miroir de la liste.
   */
  addShoppingTask(listId = this.activeShopListId()): void {
    const d = this._data(); if (!d || !listId) { this.toast('Choisissez une liste de courses'); return; }
    if (this.shoppingTask(listId)) { this.toast('La tâche existe déjà'); this.patch({ screen: 'taches' }); return; }
    const taskList = this.activeTaskListId();
    if (!taskList) { this.toast('Créez d’abord une liste de tâches'); return; }
    const intitule = shoppingTaskLabel(d.shopLists.find((l) => l.id === listId)?.name || '');
    this.pushTaskOps([{ op: 'add', id: uid('t'), listId: taskList, text: intitule, who: [], due: null, shopListId: listId }]);
    this.toast('Tâche ajoutée : « ' + intitule + ' »');
  }

  /** Depuis la tâche, aller à sa liste. C'est tout l'intérêt du lien. */
  openShoppingList(listId: string): void {
    this.patch({ screen: 'courses', activeShopList: listId });
  }

  /** L'événement d'agenda créé depuis ce créneau de repas, s'il existe encore. */
  mealEvent(key: string): EventItem | undefined {
    return (this._data()?.events || []).find((e) => e.mealKey === key);
  }

  /**
   * Met le repas du créneau en cours d'édition à l'agenda, pour qu'il soit vu
   * par ceux qui ne regardent que le calendrier. Rappuyer met l'événement à
   * jour plutôt que d'en créer un second.
   */
  /**
   * Enregistre le repas **et** le met à l'agenda, pour qu'il soit vu de ceux qui
   * ne regardent que le calendrier. Les deux vont ensemble : un événement qui
   * décrirait un repas non enregistré mentirait dès la modale refermée.
   *
   * Rappuyer met l'événement à jour plutôt que d'en créer un second.
   */
  addMealToCalendar(key: string): void {
    const value = this.mealAt(key); if (!value) return;
    const { dateStr, slot } = splitMealKey(key);
    const heure = this.mealTimes()[slot];
    const titre = this.titleFor(value, slot);
    const existant = this.mealEvent(key);
    const by = this.me()?.id ?? null;
    const now = new Date().toISOString();
    this.mutate((d) => {
      const i = existant ? d.events.findIndex((x) => x.id === existant.id) : -1;
      if (i >= 0) d.events[i] = { ...d.events[i], date: dateStr, title: titre, time: heure || '—', upBy: by, upAt: now };
      else d.events.push({
        id: uid('e'), date: dateStr, title: titre, time: heure || '—',
        who: [by || this.members()[0]?.id].filter((x): x is string => !!x), recur: 'none', end: null, mealKey: key, by, at: now,
      });
    });
    this.toast(existant ? 'Événement d’agenda mis à jour' : 'Repas ajouté à l’agenda');
  }

  /** Titre d'agenda pour un repas donné, réutilisé quand un repas change de créneau. */
  private titleFor(value: MealValue, slotKey: string): string {
    const slot = MEAL_SLOTS.find((x) => x.key === slotKey);
    return mealEventTitle(slot?.label || '', value.items.map((it) => this.mealItemName(it)), value.pax);
  }

  /**
   * Déplace un repas vers un autre créneau (glisser-déposer, ou « Déplacer » de
   * sa fiche). Un créneau occupé échange son repas : rien n'est perdu. Vrai
   * quand quelque chose a bougé.
   */
  moveMealBetween(from: string, to: string): boolean {
    const d = this._data(); if (!d) return false;
    const res = moveMeal(d.meals, d.events, from, to,
      (v, slot) => this.titleFor(v, slot),
      (slot) => this.mealTimes()[slot] || '—');
    if (!res.moved) { this.toast('Rien à déplacer'); return false; }
    this.mutate((dd) => { dd.meals = res.meals; dd.events = res.events; });
    this.toast(res.swapped ? 'Les deux repas ont été échangés' : 'Repas déplacé');
    return true;
  }

  /**
   * Retire le repas d'un créneau, et l'événement d'agenda qui en venait : garder
   * un dîner annulé à l'agenda serait pire que de ne l'y avoir jamais mis.
   * L'annulation rend les deux.
   */
  clearMeal(key: string): void {
    const d0 = this._data(); const meal = d0?.meals[key]; if (!d0 || !meal) return;
    const ev = this.mealEvent(key);
    this.mutate((d) => { delete d.meals[key]; d.events = d.events.filter((x) => x.mealKey !== key); });
    this.toastWithUndo(ev ? 'Repas retiré, et son événement d’agenda' : 'Repas retiré', () => this.mutate((d) => {
      if (!d.meals[key]) d.meals[key] = meal;
      if (ev && !d.events.some((x) => x.id === ev.id)) d.events.push(ev);
    }));
  }
  /** Couverts par défaut : tout le foyer, sauf dérogation posée sur le créneau. */
  householdPax(): number { return Math.max(this._data()?.members.length || 0, 1); }

  /**
   * Qui mange à ce créneau, et pour combien de couverts.
   *
   * Les absences viennent de l'emploi du temps, plus d'une grille tenue à la
   * main : le module savait déjà que Léa est au collège le lundi midi. Voir
   * presence.ts.
   */
  presenceOf(dateStr: string, slot: string) {
    const d = this._data();
    return presenceAt({ members: d?.members || [], sched: this.schedAll(), cal: this.calendar(), mealTimes: this.mealTimes() }, dateStr, slot, d?.meals[dateStr + '-' + slot]);
  }

  /**
   * Présence d'un créneau avec les absences en cours de saisie, couverts
   * manuels exclus. Lue depuis le formulaire et non depuis l'état enregistré :
   * sans cela, retirer un convive ne changerait rien à l'écran tant qu'on n'a
   * pas enregistré, et le geste paraîtrait sans effet.
   */
  presenceWith(dateStr: string, slot: string, away: string[]) {
    const d = this._data();
    return presenceAt({ members: d?.members || [], sched: this.schedAll(), cal: this.calendar(), mealTimes: this.mealTimes() }, dateStr, slot, { items: [], away });
  }

  // ---- suggestions ---------------------------------------------------------
  /**
   * Ce qu'on pourrait mettre dans un créneau, et pourquoi. Le carnet entier est
   * relu à chaque appel : le formulaire du repas le garde dans un computed, et
   * rien n'est calculé tant qu'il n'est pas ouvert.
   */
  mealSuggestions(dateStr: string, slot: string): SuggestReport | null {
    const d = this._data();
    if (!d) return null;
    return suggestMeals({
      recipes: d.recipes, meals: d.meals, members: d.members, sched: this.schedAll(), cal: this.calendar(), index: this.articleIndex(),
      mealTimes: this.mealTimes(),
      seuils: {
        repeatDays: this.setting('suggestRepeatDays'),
        oubliDays: this.setting('suggestForgottenDays'),
        rapideMin: this.setting('suggestQuickMin'),
      },
      shop: d.shop.filter((i) => i.listId === this.activeShopListId()),
      dateStr, slot,
    });
  }

  /** Référentiel d'articles, base intégrée plus les corrections du foyer. */
  readonly articleIndex = computed(() => buildArticleIndex(this._data()?.articles || []));

  /**
   * Ce que le lecteur d'ingrédients n'a pas su rattacher, sur tout le carnet.
   * Recalculé à chaque correction : le taux affiché bouge sous les yeux, ce qui
   * est le seul retour honnête sur l'effet d'un geste.
   */
  readonly repairReport = computed(() => scanRecipes(this._data()?.recipes || [], this.articleIndex()));

  /** Le groupe en cours de reprise, ou null quand on est sur la liste. */
  readonly repairGroup = computed(() => {
    const form = this.ui().repForm;
    return form ? this.repairReport().groups.find((g) => g.form === form) ?? null : null;
  });

  /** Articles proposés au rattachement, filtrés sur ce qui est tapé. */
  readonly repairMatches = computed(() =>
    searchArticles(this.articleIndex(), this._data()?.articles || [], this.ui().repSearch));

  openRepair(): void { this.patch({ repairOpen: true, repForm: '', repSearch: '' }); }

  // ---- contraintes alimentaires ------------------------------------------
  // Tout est dérivé du référentiel : ce qu'une recette contient vient des
  // articles que le lecteur a su rattacher. D'où la règle qui gouverne l'affichage :
  // l'absence d'alerte ne prouve rien, et les lignes non vérifiées sont dites.

  /** Contenu et conflits d'une recette, pour la fiche ouverte comme pour la grille. */
  recipeCheck(r: Recipe) { return checkRecipe(r, this._data()?.members || [], this.articleIndex()); }

  /** Y a-t-il seulement quelqu'un à alerter ? Sans contrainte déclarée, tout ce qui suit se tait. */
  readonly anyDiet = computed(() => (this._data()?.members || []).some(hasDiet));

  /** Conflits d'un créneau, pour la pastille de la grille du planning. */
  mealAlerts(key: string): Conflict[] {
    if (!this.anyDiet()) return [];
    const d = this._data(); if (!d) return [];
    // Seuls les convives attendus : alerter pour quelqu'un qui n'est pas là ce
    // soir-là est une fausse alerte, et une de trop suffit à ne plus les lire.
    const presents = presenceAt({ members: d.members, sched: this.schedAll(), cal: this.calendar(), mealTimes: this.mealTimes() }, key.slice(0, 10), key.slice(11), d.meals[key]).present;
    return mealConflicts(d.meals[key]?.items || [], d.recipes, presents, this.articleIndex());
  }

  /** « Léa : lait, œufs · Paul : champignon », phrase du survol et de la fiche. */
  alertLabel(list: Conflict[]): string { return list.map(conflictLabel).join(' · '); }

  toggleMemberAllerg(a: string): void {
    const cur = this.ui().mfAllerg;
    this.patch({ mfAllerg: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] });
  }
  /** Aliments proposés au refus, filtrés sur ce qui est tapé. */
  readonly refuseMatches = computed(() =>
    searchArticles(this.articleIndex(), this._data()?.articles || [], this.ui().mfRefuseQ)
      .filter((a) => !this.ui().mfRefuse.includes(a.key)));
  addMemberRefuse(key: string): void { this.patch({ mfRefuse: [...this.ui().mfRefuse, key], mfRefuseQ: '' }); }
  removeMemberRefuse(key: string): void { this.patch({ mfRefuse: this.ui().mfRefuse.filter((k) => k !== key) }); }
  /** Nom lisible d'un aliment refusé, tel que le référentiel le nomme. */
  articleName(key: string): string { return this.articleIndex().byKey.get(key)?.name ?? key; }

  /** Ouvre la reprise d'une forme. Le nom lu sert de proposition, jamais d'office. */
  repairPick(form: string, mode: 'lier' | 'creer'): void {
    const g = this.repairReport().groups.find((x) => x.form === form); if (!g) return;
    this.patch({ repForm: form, repMode: mode, repSearch: mode === 'lier' ? g.name : '', repName: g.name, repRayon: 'epicerie', repPantry: false, repAllerg: [] });
  }

  /** Apprend la forme en cours à un article connu. */
  repairLink(key: string): void {
    const g = this.repairGroup(); if (!g) return;
    const nom = this.articleIndex().byKey.get(key)?.name || key;
    this.mutate((d) => { d.articles = linkForm(d.articles || [], key, g.name, this.articleIndex()); });
    this.patch({ repForm: '', repSearch: '' });
    this.toast('« ' + g.name + ' » rattaché à ' + nom);
  }

  /** Crée l'article manquant, avec la forme qui l'a fait découvrir. */
  repairCreate(): void {
    const g = this.repairGroup(); if (!g) return;
    const s = this.ui(); const name = s.repName.trim();
    if (!name) { this.toast('Donne un nom à l’article'); return; }
    this.mutate((d) => {
      d.articles = createArticle(d.articles || [], { name, rayon: s.repRayon, pantry: s.repPantry, allerg: s.repAllerg as Allergene[] }, g.name, this.articleIndex());
    });
    this.patch({ repForm: '' });
    this.toast('Article « ' + name + ' » créé');
  }

  toggleRepairAllerg(a: string): void {
    const cur = this.ui().repAllerg;
    this.patch({ repAllerg: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] });
  }

  /** Ouvre la recette d'où vient une ligne : seul endroit où un intertitre se corrige. */
  openRepairRecipe(id: string): void { this.patch({ repairOpen: false }); this.openItem('recipe', id); }

  /** Rapport de la dernière génération préparée, affiché avant d'écrire. */
  readonly genReport = signal<PlanReport | null>(null);
  /** Fonds de placard que l'utilisateur veut quand même acheter cette fois. */
  readonly genPantry = signal<Set<string>>(new Set());

  /** Les sept jours de la semaine contenant une date, du lundi au dimanche. */
  weekDays(anchorIso = this.todayStr()): string[] { return weekDates(0, anchorIso).map(dstr); }

  /**
   * Prépare la liste depuis les repas des jours donnés : additionne les
   * ingrédients, les met à l'échelle des couverts, les range par rayon, et rend
   * compte **sans rien écrire**.
   *
   * Les jours sont passés explicitement, et non déduits de ce que l'écran Repas
   * affichait : un bouton ailleurs ne doit pas générer en douce la période qu'on
   * y avait laissée, et la fenêtre peut désormais faire trois jours comme sept.
   */
  prepareList(days: string[]): void {
    const d = this._data(); if (!d) return;
    const listId = this.activeShopListId();
    if (!listId) { this.toast('Créez d’abord une liste de courses'); return; }
    // Les couverts sont résolus créneau par créneau : la semaine type sait que
    // Léa déjeune au collège le mardi, et les quantités doivent le savoir aussi.
    const slots = days.flatMap((ds) => this.mealSlots().flatMap((sl) => {
      const value = d.meals[ds + '-' + sl.key];
      return value?.items?.length ? [{ value, pax: this.presenceOf(ds, sl.key).pax }] : [];
    }));
    if (!slots.length) { this.toast('Aucun repas planifié sur cette période'); return; }
    this.genReport.set(buildPlan({
      slots,
      stockDays: this.setting('stockDays'),
      recipes: d.recipes, aisles: d.aisles, articles: d.articles, index: this.articleIndex(),
      existing: d.shop.filter((i) => i.listId === listId),
      fallbackAisle: this.defaultAisleId(), stock: d.stock, today: this.todayStr(),
    }));
    this.genPantry.set(new Set());
    this.genHave.set(new Set());
    this.patch({ genOpen: true });
  }

  togglePantryPick(name: string): void {
    const s = new Set(this.genPantry());
    if (!s.delete(name)) s.add(name);
    this.genPantry.set(s);
  }
  isPantryPicked(name: string): boolean { return this.genPantry().has(name); }

  // ---- « j'ai déjà ça » ----------------------------------------------------
  // Le contraire d'un inventaire : rien à tenir au jour le jour, un seul geste,
  // au moment où la question se pose vraiment. La date est retenue et montrée,
  // parce que c'est elle qui permet de juger : trois jours pour de la crème et
  // trois semaines pour de la farine ne se valent pas.

  /** Lignes que l'on vient de déclarer avoir. Écrites seulement à l'application. */
  readonly genHave = signal<Set<string>>(new Set());
  toggleHave(line: PlanLine): void {
    const s = new Set(this.genHave()); const k = keyOfLine(line);
    if (!s.delete(k)) s.add(k);
    this.genHave.set(s);
  }
  hasHave(line: PlanLine): boolean { return this.genHave().has(keyOfLine(line)); }

  /** Recoche un article qu'on avait dit avoir : la marque disparaît du même geste. */
  toggleStockPick(line: PlanLine): void {
    const s = new Set(this.genPantry()); const k = keyOfLine(line);
    if (!s.delete(k)) s.add(k);
    this.genPantry.set(s);
  }
  isStockPicked(line: PlanLine): boolean { return this.genPantry().has(keyOfLine(line)); }

  /** « il y a 3 jours », « hier », « aujourd'hui ». */
  stockAgeLabel(days: number): string {
    return days <= 0 ? "aujourd'hui" : days === 1 ? 'hier' : 'il y a ' + days + ' jours';
  }

  /**
   * Applique le rapport. Ce qui a été ajouté à la main, coché ou marqué
   * introuvable n'est jamais touché : la régénération ne défait que son propre
   * ouvrage, c'est ce qui la rend rejouable sans crainte en cours de semaine.
   */
  applyList(): void {
    const rep = this.genReport(); const listId = this.activeShopListId();
    if (!rep || !listId) return;
    const ops: ShopOpDraft[] = [];
    // Un article qu'on avait dit avoir et qu'on recoche est acheté : sa marque
    // saute, sinon il resterait écarté trois semaines alors qu'on n'en a plus.
    const repris = rep.stocked.filter((x) => this.genPantry().has(keyOfLine(x.line)));
    const ajout = [
      ...rep.add.filter((l) => !this.genHave().has(keyOfLine(l))),
      ...rep.pantry.filter((l) => this.genPantry().has(l.name)),
      ...repris.map((x) => x.line),
    ];
    for (const l of ajout) {
      ops.push({ op: 'add', id: uid('g'), name: l.name, qty: l.qty, aisleId: l.aisleId, listId, gen: true, ...(l.art ? { art: l.art } : {}) });
    }
    for (const u of rep.update) ops.push({ op: 'edit', id: u.item.id, qty: u.line.qty, aisleId: u.line.aisleId });
    for (const r of rep.remove) ops.push({ op: 'remove', id: r.id });
    if (ops.length) this.pushShopOps(ops);

    const dits = this.genHave();
    if (dits.size || repris.length) {
      const jour = this.todayStr();
      this.mutate((d) => {
        const stock = { ...(d.stock || {}) };
        for (const k of dits) stock[k] = jour;
        for (const x of repris) delete stock[keyOfLine(x.line)];
        d.stock = stock;
      });
    }
    this.genHave.set(new Set());
    this.patch({ genOpen: false, screen: 'courses' });
    this.genReport.set(null);
    const bilan = [
      ajout.length ? ajout.length + (ajout.length > 1 ? ' articles ajoutés' : ' article ajouté') : '',
      rep.update.length ? rep.update.length + ' mis à jour' : '',
      rep.remove.length ? rep.remove.length + ' retirés' : '',
    ].filter(Boolean).join(', ');
    this.toast(bilan || 'La liste était déjà à jour');
  }

  // ---- recipes ----------------------------------------------------------
  // Le formulaire (screens/recettes/recipe-form.ts) garde sa saisie ; le store
  // ne porte que ce qui parle au serveur et l'enregistrement.

  /**
   * Lit une page de recette. Le serveur fait l'appel sortant et la lecture
   * (voir backend/src/recipes) ; le formulaire pose le résultat dans ses
   * champs, que l'utilisateur relit avant d'enregistrer.
   */
  async importRecipeFrom(url: string, ownerId: string) {
    const res = await this.api.importRecipe(url, ownerId);
    if (res.photoId) this.photoUrls.update((m) => { const c = { ...m }; delete c[res.photoId!]; return c; });
    return res;
  }

  /** Envoie la photo d'une recette (existante ou pas encore enregistrée) ; son identifiant, ou null en cas d'échec dit par un toast. */
  async uploadRecipePhoto(ownerId: string, file: File): Promise<number | null> {
    try {
      const res = await this.api.uploadFile('recipe', ownerId, file);
      this.cachePhoto(res.file.id, file);
      return res.file.id;
    } catch (e) {
      // Le message du serveur nomme le format attendu : le relayer tel quel vaut
      // mieux qu'un « échec » qui ne dit pas quoi faire.
      this.toast((e as Error).message);
      return null;
    }
  }

  /** La photo que montre un formulaire ouvert, pour qu'elle se télécharge comme les autres. */
  readonly formPhotoId = signal<number | null>(null);

  /** Enregistre une recette (`isNew` : l'identifiant a été tiré à l'ouverture du formulaire). */
  saveRecipe(id: string, data: RecipeData, isNew: boolean): ItemResult {
    const cur = isNew ? undefined : this._data()?.recipes.find((r) => r.id === id);
    if (cur && !recipeChanges(cur, data)) return { kind: 'done' };
    this.mutate((d) => {
      const i = d.recipes.findIndex((r) => r.id === id);
      if (i >= 0) d.recipes[i] = { ...d.recipes[i], ...data };
      else d.recipes.unshift({ id, ...data });
    });
    this.toast(cur ? 'Recette modifiée' : 'Recette ajoutée au carnet');
    return { kind: 'done' };
  }

  /** Supprime une recette. Définitif : la fiche l'a fait confirmer. */
  deleteRecipe(id: string): void {
    this.mutate((d) => { d.recipes = d.recipes.filter((r) => r.id !== id); });
    this.toast('Recette supprimée');
  }

  /** Durée totale d'une recette, pour les vignettes et l'accueil. */
  recipeTime(r: { prepMin?: number | null; cookMin?: number | null }): string { return recipeTime(r); }
  // ---- photos ------------------------------------------------------------
  // Une balise <img> ou un background CSS ne porte pas l'en-tête d'autorisation :
  // pointer directement /api/files renverrait 401. Le jeton dans l'URL est exclu
  // (il finirait dans l'historique du navigateur, voir api.service.ts), donc la
  // photo est téléchargée avec la session puis exposée en URL d'objet locale.
  // `null` en cache signifie « déjà tenté, sans succès » : on ne réessaie pas en
  // boucle, le dégradé de couleur de la recette prend le relais.
  private photoUrls = signal<Record<number, string | null>>({});

  /**
   * URL d'affichage d'une photo, ou null tant qu'elle n'est pas arrivée. Lecture
   * pure : le téléchargement est déclenché par l'effet du constructeur, car
   * écrire dans un signal depuis un gabarit est interdit (NG0600).
   */
  photoUrl(photoId?: number | null): string | null {
    return photoId ? this.photoUrls()[photoId] ?? null : null;
  }

  /** Photos citées par le document et par le formulaire en cours. */
  private neededPhotoIds(): number[] {
    const ids = new Set<number>();
    for (const r of this._data()?.recipes || []) if (r.photoId) ids.add(r.photoId);
    for (const it of this._data()?.shop || []) if (it.photoId) ids.add(it.photoId);
    const editing = this.formPhotoId();
    if (editing) ids.add(editing);
    return [...ids];
  }

  private async loadPhoto(id: number): Promise<void> {
    // Marqué avant l'appel : l'effet se réexécute pendant le téléchargement, et
    // sans cette marque il en lancerait un par passage.
    this.photoUrls.update((m) => ({ ...m, [id]: null }));
    try {
      const blob = await this.api.download('files/' + id);
      this.photoUrls.update((m) => ({ ...m, [id]: URL.createObjectURL(blob) }));
    } catch { /* fichier absent ou session expirée : la recette garde son dégradé */ }
  }

  /** Met une photo tout juste envoyée en cache, pour un aperçu sans aller-retour. */
  private cachePhoto(id: number, file: Blob): void {
    this.photoUrls.update((m) => ({ ...m, [id]: URL.createObjectURL(file) }));
  }

  private revokePhotos(): void {
    for (const url of Object.values(this.photoUrls())) if (url) URL.revokeObjectURL(url);
    this.photoUrls.set({});
  }
  // ---- étiquettes, note, recherche et collage ------------------------------

  /** Le carnet filtré par la ligne de recherche. */
  readonly recipeHits = computed(() =>
    searchRecipes(this._data()?.recipes || [], parseQuery(this.ui().recipeSearch), this.articleIndex()));

  /** « faite il y a trois semaines », ou null si jamais servie. */
  lastMadeLabel(id: string): string | null {
    const jour = lastServed(id, this._data()?.meals || {});
    if (!jour) return null;
    const j = daysBetween(jour, this.todayStr());
    if (j < 0) return 'prévue au planning';
    return j === 0 ? "faite aujourd'hui" : j === 1 ? 'faite hier' : j < 7 ? 'faite il y a ' + j + ' jours' : 'faite il y a ' + semaines(j);
  }


  // ---- emploi du temps --------------------------------------------------
  //
  // Le filtre par membre est un **affinage** : vide, il laisse passer tout le
  // foyer. Il ne s'initialise donc sur personne, et se vide en un geste.

  /**
   * Ce que le calendrier sait des jours : fériés calculés, vacances de
   * l'académie. Une liste de vacances vide veut dire **inconnue**, et le moteur
   * n'applique alors aucun filtre plutôt que de cacher l'école.
   */
  readonly calendar = computed<CalendarFacts>(() => calendarFacts(this.schoolHolidays()));

  /** Les sept dates de la semaine affichée, du lundi au dimanche. */
  readonly schedWeek = computed(() => weekDates(0, this.ui().schedAnchor).map(dstr));
  /** La date que porte un jour de la semaine affichée. */
  schedDate(dow: number): string { return this.schedWeek()[dow - 1] || this.todayStr(); }
  shiftSchedWeek(n: number): void { this.patch({ schedAnchor: addDaysIso(this.ui().schedAnchor, n * 7) }); }
  schedToday(): void { this.patch({ schedAnchor: this.todayStr(), schedDow: weekdayOf(this.todayStr()) }); }

  /** Les membres du filtre, tels que l'écran les coche et les décoche. */
  toggleSchedWho(id: string): void {
    const cur = this.ui().schedWho;
    this.patch({ schedWho: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  }
  clearSchedWho(): void { this.patch({ schedWho: [] }); }

  /**
   * Choisit le type du créneau, et repositionne « hors du foyer » sur le défaut
   * de ce type. Le télétravail existe, donc la case reste décochable ensuite :
   * c'est elle qui décide, pas le type.
   */
  /**
   * Nouveau créneau, en fiche. Le formulaire s'ouvre déjà rempli des membres du
   * filtre : quand on vient d'affiner sur Léa, le créneau qu'on ajoute est pour
   * Léa. Sans heure imposée, il propose celle qui suit le dernier créneau du jour.
   */
  newSlot(dow = 0, start = ''): void {
    const jour = dow >= 1 && dow <= 7 ? dow : this.ui().schedDow;
    this.openItem('slot', null, { date: this.schedDate(jour), ...(start ? { time: start } : {}) });
  }
  /** Ce qu'un créneau neuf reçoit d'office, au jour `date`. */
  slotDefaults(date: string, start = ''): SlotDefaults {
    return { date, who: [...this.ui().schedWho], start: start || nextFreeStart(this.shownOn(weekdayOf(date))) };
  }

  /**
   * Enregistre un créneau depuis sa fiche. Sur une série, la portée (ce jour
   * seulement, à partir de ce jour, toute la série) se demande ici, au moment
   * d'enregistrer et seulement si quelque chose a changé. Renvoie l'identifiant
   * de l'occurrence détachée quand c'est elle qui porte la modification.
   */
  saveSlot(id: string | null, forme: Omit<SchedSlot, 'id'>, occ: string, scope?: string): ItemResult {
    const avant = id ? this._data()?.sched.find((x) => x.id === id) : undefined;
    if (!avant) {
      this.mutate((d) => { d.sched.push({ id: uid('s'), ...forme }); });
      this.toast('Créneau ajouté');
      return { kind: 'done' };
    }
    if (!slotChanges(avant, forme)) return { kind: 'done' };
    // Un ponctuel n'a pas de série : la question ne se pose pas.
    if (avant.rec === 'weekly' && !scope) {
      return { kind: 'ask', question: 'Appliquer la modification :', choices: [
        { scope: 'once', label: 'Ce jour seulement (' + this.fmtNumDate(occ) + ')' },
        { scope: 'future', label: 'À partir du ' + this.fmtNumDate(occ) },
        { scope: 'all', label: 'À toute la série' }] };
    }
    const portee = avant.rec === 'once' ? 'all' : scope;

    if (portee === 'once') {
      // « Cette fois seulement » : la série saute la date, et une occurrence
      // détachée la reprend. C'est le RECURRENCE-ID d'iCalendar, exprimé avec
      // les objets qu'on a déjà plutôt qu'avec un troisième type.
      const detachee: SchedSlot = { id: uid('s'), ...forme, rec: 'once', dow: weekdayOf(occ), date: occ, srcId: avant.id };
      delete detachee.from; delete detachee.until; delete detachee.when; delete detachee.interval;
      this.mutate((d) => {
        const i = d.sched.findIndex((x) => x.id === avant.id);
        if (i >= 0) d.sched[i] = { ...d.sched[i], skip: [...new Set([...(d.sched[i].skip || []), occ])] };
        if (!d.sched.some((x) => x.id === detachee.id)) d.sched.push(detachee);
      });
      this.toast('Modifié pour ce jour seulement');
      return { kind: 'done', id: detachee.id };
    }
    if (portee === 'future') {
      // « À partir de cette date » : la série est coupée en deux. C'est ce qui
      // traite un changement d'horaire à la rentrée sans effacer l'historique.
      const veille = addDaysIso(occ, -1);
      const passe = !avant.from || avant.from <= veille;
      const suite: SchedSlot = { id: uid('s'), ...forme, from: occ };
      const gardees = (avant.skip || []).filter((x) => x >= occ);
      if (gardees.length) suite.skip = gardees;
      this.mutate((d) => {
        const i = d.sched.findIndex((x) => x.id === avant.id);
        if (i < 0) return;
        if (passe) {
          d.sched[i] = { ...d.sched[i], until: veille, skip: (d.sched[i].skip || []).filter((x) => x < occ) };
          if (!d.sched.some((x) => x.id === suite.id)) d.sched.push(suite);
        } else {
          // Rien avant la coupure : couper produirait une série vide.
          d.sched[i] = { id: avant.id, ...forme, from: occ, ...(gardees.length ? { skip: gardees } : {}) };
        }
      });
      this.toast('Modifié à partir du ' + this.fmtNumDate(occ));
      return passe ? { kind: 'done', id: suite.id } : { kind: 'done' };
    }
    // Toute la série : le créneau est **réécrit** plutôt que fusionné, sans quoi
    // une période qu'on vient d'effacer dans le formulaire survivrait.
    this.mutate((d) => {
      const i = d.sched.findIndex((x) => x.id === avant.id);
      if (i >= 0) d.sched[i] = { id: avant.id, ...forme, ...(avant.skip?.length ? { skip: [...avant.skip] } : {}), ...(avant.srcId ? { srcId: avant.srcId } : {}) };
    });
    this.toast(avant.rec === 'once' ? 'Créneau modifié' : 'Série modifiée');
    return { kind: 'done' };
  }

  /**
   * Supprime un créneau, ou sur une série ce jour seulement, ou à partir de ce
   * jour. Sans confirmation : l'annulation **réinsère le créneau retenu** plutôt
   * qu'une copie de tout l'emploi du temps, qui effacerait ce que l'autre a
   * ajouté entre-temps.
   */
  delSlot(id: string, occ: string, scope?: string): ItemResult {
    const slot = this._data()?.sched.find((x) => x.id === id);
    if (!slot) return { kind: 'done' };
    if (slot.rec === 'weekly' && !scope) {
      return { kind: 'ask', question: 'Supprimer :', choices: [
        { scope: 'once', label: 'Ce jour seulement (' + this.fmtNumDate(occ) + ')', danger: true },
        { scope: 'future', label: 'À partir du ' + this.fmtNumDate(occ), danger: true },
        { scope: 'all', label: 'Toute la série', danger: true }] };
    }
    const veille = addDaysIso(occ, -1);
    const rienAvant = slot.rec === 'weekly' && scope === 'future' && !!slot.from && slot.from > veille;

    // Suppression franche : le ponctuel, la série entière, ou une coupure qui ne
    // laisserait rien derrière elle.
    if (slot.rec === 'once' || scope === 'all' || rienAvant) {
      const copie = structuredClone(slot);
      this.mutate((d) => { d.sched = d.sched.filter((x) => x.id !== id); });
      this.toastWithUndo(
        slot.rec === 'weekly' && scope === 'all' ? 'Série supprimée' : 'Créneau supprimé',
        () => this.mutate((d) => { if (!d.sched.some((x) => x.id === copie.id)) d.sched.push(copie); }),
      );
      return { kind: 'done' };
    }
    if (scope === 'once') {
      // « Ce jeudi, pas de tennis. » La série n'est pas touchée.
      this.mutate((d) => {
        const i = d.sched.findIndex((x) => x.id === id);
        if (i >= 0) d.sched[i] = { ...d.sched[i], skip: [...new Set([...(d.sched[i].skip || []), occ])] };
      });
      this.toastWithUndo('Retiré pour ce jour seulement', () => this.mutate((d) => {
        const i = d.sched.findIndex((x) => x.id === id);
        if (i >= 0) d.sched[i] = { ...d.sched[i], skip: (d.sched[i].skip || []).filter((x) => x !== occ) };
      }));
      return { kind: 'done' };
    }
    // « À partir de cette date » : la série se ferme, le passé reste lisible.
    // C'est ainsi qu'une activité s'arrête en juin sans effacer l'année.
    const avantFin = slot.until ?? null;
    this.mutate((d) => {
      const i = d.sched.findIndex((x) => x.id === id);
      if (i >= 0) d.sched[i] = { ...d.sched[i], until: veille };
    });
    this.toastWithUndo('Arrêté après le ' + this.fmtNumDate(veille), () => this.mutate((d) => {
      const i = d.sched.findIndex((x) => x.id === id);
      if (i >= 0) d.sched[i] = { ...d.sched[i], until: avantFin };
    }));
    return { kind: 'done' };
  }

  /**
   * Déplace un créneau vers un autre jour de la semaine affichée.
   *
   * Une série ne change pas de jour sans qu'on l'ait demandé : l'écran pose la
   * question avant d'appeler cette méthode, et `scope` porte la réponse. Comme
   * partout dans ce module, l'annulation est ciblée : elle remet le jour du
   * créneau par son identifiant, jamais une copie de l'emploi du temps.
   */
  moveSlot(id: string, dow: number, scope: SchedScope = 'all'): void {
    this.patch({ schedMove: null });
    const slot = this._data()?.sched.find((x) => x.id === id);
    if (!slot || dow < 1 || dow > 7) return;
    const cible = this.schedDate(dow);

    if (slot.rec === 'once' || scope === 'all') {
      if (slot.dow === dow) return;
      const avantDow = slot.dow;
      const avantDate = slot.date;
      this.mutate((d) => {
        const i = d.sched.findIndex((x) => x.id === id);
        if (i >= 0) d.sched[i] = { ...d.sched[i], dow, ...(d.sched[i].rec === 'once' ? { date: cible } : {}) };
      });
      this.toastWithUndo(
        'Déplacé au ' + dowLabel(dow).toLowerCase() + (slot.rec === 'weekly' ? ' (toute la série)' : ''),
        () => this.mutate((d) => {
          const i = d.sched.findIndex((x) => x.id === id);
          if (i >= 0) d.sched[i] = { ...d.sched[i], dow: avantDow, ...(avantDate ? { date: avantDate } : {}) };
        }),
      );
      return;
    }

    // Cette occurrence seulement : la série saute sa date, une occurrence
    // détachée reprend les mêmes valeurs sur le jour visé.
    const occ = this.schedDate(slot.dow);
    const detachee: SchedSlot = {
      id: uid('s'), who: [...(slot.who || [])], dow, start: slot.start, end: slot.end,
      label: slot.label, k: slot.k, rec: 'once', date: cible, srcId: slot.id,
    };
    this.mutate((d) => {
      const i = d.sched.findIndex((x) => x.id === id);
      if (i >= 0) d.sched[i] = { ...d.sched[i], skip: [...new Set([...(d.sched[i].skip || []), occ])] };
      d.sched.push(detachee);
    });
    this.toastWithUndo('Déplacé au ' + dowLabel(dow).toLowerCase() + ' pour ce jour seulement', () => this.mutate((d) => {
      d.sched = d.sched.filter((x) => x.id !== detachee.id);
      const i = d.sched.findIndex((x) => x.id === id);
      if (i >= 0) d.sched[i] = { ...d.sched[i], skip: (d.sched[i].skip || []).filter((x) => x !== occ) };
    }));
  }

  /** Les intitulés déjà employés, proposés à la saisie. */
  readonly labelSuggestions = computed(() => knownLabels(this._data()?.sched || []));

  // ---- copier une journée -----------------------------------------------
  //
  // La copie prend **ce que la vue montre**, filtre compris, et le collage
  // remplace ce que la vue montrerait au même endroit. Sans cette règle, coller
  // la journée de Léa sur mardi effacerait celle de tout le monde.

  /** Les créneaux d'un jour tels qu'ils sont affichés en ce moment, à sa date. */
  shownOn(dow: number): SchedSlot[] {
    return filterSlots(slotsOn(this._data()?.sched || [], this.schedDate(dow), this.calendar()), this.ui().schedWho);
  }

  private snapshot(slots: SchedSlot[]): SchedSlot[] {
    return slots.map((s) => ({ ...s, who: [...(s.who || [])] }));
  }

  copyDay(dow: number): void {
    const slots = this.shownOn(dow);
    // Copier une journée vide n'a pas d'usage : même en mode remplacer, un
    // collage sans membre ne vise personne et ne ferait rien.
    if (!slots.length) { this.toast('Cette journée est vide, rien à copier'); return; }
    this.patch({ schedClip: { kind: 'day', dow, slots: this.snapshot(slots) }, schedPasteWho: null });
    this.toast(dowLabel(dow) + ' copié, ' + slots.length + (slots.length > 1 ? ' créneaux' : ' créneau'));
  }

  /**
   * Copie la semaine du ou des membres filtrés, pour la donner à quelqu'un d'autre.
   *
   * Sans filtre, l'action n'a pas de sens : recopier la semaine de tout le monde
   * sur elle-même ne changerait rien. C'est pourquoi l'écran ne la propose que
   * lorsqu'un filtre est actif.
   */
  copyWeek(): void {
    const who = this.ui().schedWho;
    if (!who.length) { this.toast('Choisissez d’abord de qui vous copiez la semaine'); return; }
    // La semaine affichée, occurrence par occurrence : ce qui n'a pas lieu cette
    // semaine (activité arrêtée, période de vacances) ne se copie pas.
    const slots = [1, 2, 3, 4, 5, 6, 7].flatMap((dow) => this.shownOn(dow));
    if (!slots.length) { this.toast('Cette semaine est vide, rien à copier'); return; }
    this.patch({ schedClip: { kind: 'week', dow: 0, slots: this.snapshot(slots) }, schedPasteWho: null });
    this.toast('Semaine copiée, ' + slots.length + (slots.length > 1 ? ' créneaux' : ' créneau'));
  }

  clearClip(): void { this.patch({ schedClip: null, schedPasteOpen: false, schedPasteDows: [], schedPasteWho: null }); }

  openPaste(dow = 0): void {
    if (!this.ui().schedClip) return;
    this.patch({ schedPasteOpen: true, schedPasteDows: dow ? [dow] : [] });
  }
  togglePasteDow(dow: number): void {
    const cur = this.ui().schedPasteDows;
    this.patch({ schedPasteDows: cur.includes(dow) ? cur.filter((x) => x !== dow) : [...cur, dow] });
  }

  /**
   * Le collage en deux gestes : copier une journée, taper « Coller » sur une
   * autre. La prévisualisation ne s'impose que si la cible n'est pas vide, parce
   * que c'est le seul cas où quelque chose peut se perdre ou entrer en conflit.
   */
  pasteOn(dow: number): void {
    const clip = this.ui().schedClip;
    if (!clip || clip.kind !== 'day') return;
    this.patch({ schedPasteDows: [dow], schedPasteWho: null });
    if (this.shownOn(dow).length) { this.patch({ schedPasteOpen: true }); return; }
    this.pasteNow();
  }

  /** Ce que le collage ferait, recalculé à chaque réglage du formulaire. */
  readonly pastePlan = computed<PastePlan | null>(() => {
    const s = this.ui();
    const d = this._data();
    if (!s.schedClip || !d) return null;
    return planPaste({
      sched: d.sched,
      source: s.schedClip.slots,
      targetDows: s.schedClip.kind === 'week' ? null : s.schedPasteDows,
      mode: s.schedPasteMode,
      remap: s.schedPasteWho,
      dateFor: (dow) => this.schedDate(dow),
      newId: () => uid('s'),
    });
  });

  pasteNow(): void {
    // Le plan est figé ici : l'appliquer et l'annuler doivent porter sur les
    // mêmes identifiants, sans quoi l'annulation raterait sa cible.
    const plan = this.pastePlan();
    if (!plan) return;
    this.patch({ schedPasteOpen: false });
    if (!plan.added.length && !plan.removed.length) { this.toast(pasteSummary(plan, dowLabel)); return; }
    this.mutate((d) => { d.sched = applyPastePlan(d.sched, plan); });
    this.toastWithUndo(pasteSummary(plan, dowLabel), () => this.mutate((d) => { d.sched = undoPaste(d.sched, plan); }));
  }

  // ---- family & profile -------------------------------------------------
  /** Mène à Paramètres → Membres et accès (là où vit toute la gestion de la famille). */
  openMembers(): void { this.patch({ settingsSection: 'membres', famNameField: this._data()?.familyName || '' }); this.go('settings'); }
  saveFamily(): void { const n = this.ui().famNameField.trim(); if (!n) { this.toast('Donne un nom au foyer'); return; } this.mutate((d) => { d.familyName = n; }); this.toast('Foyer mis à jour'); }
  newMember(): void { this.patch({ memberForm: true, mfEditId: null, mfName: '', mfRole: '', mfEmail: '', mfColor: '#9B6FA8', mfAdmin: false, mfEnfant: false, mfBirthday: '', mfAllerg: [], mfRefuse: [], mfRefuseQ: '' }); }
  editMember(id: string): void { const m = this._data()?.members.find((x) => x.id === id); if (!m) return; this.patch({ memberForm: true, mfEditId: id, mfName: m.name, mfRole: m.role, mfEmail: m.email || '', mfColor: m.color, mfAdmin: !!m.admin, mfEnfant: !!m.enfant, mfBirthday: m.birthday || '', mfAllerg: [...(m.allerg || [])], mfRefuse: [...(m.refuse || [])], mfRefuseQ: '' }); }
  saveMember(): void {
    const s = this.ui(); const name = s.mfName.trim(); if (!name) { this.toast('Donne un prénom'); return; }
    const data = { name, role: s.mfRole.trim(), email: s.mfEmail.trim(), color: s.mfColor, admin: s.mfAdmin, enfant: s.mfEnfant, birthday: s.mfBirthday || null, allerg: s.mfAllerg, refuse: s.mfRefuse };
    this.mutate((d) => {
      if (s.mfEditId) {
        const i = d.members.findIndex((m) => m.id === s.mfEditId); if (i < 0) return;
        // Des initiales que le membre a choisies lui-même (elles ne découlent pas
        // de son prénom) survivent au fait qu'un administrateur le renomme.
        const prev = d.members[i];
        d.members[i] = { ...prev, ...data, ini: keptIni(prev, name) };
      } else d.members.push({ id: uid('mb'), ...data, ini: contactIni(name) });
    });
    this.toast(s.mfEditId ? 'Membre modifié' : 'Membre ajouté');
    this.patch({ memberForm: false, mfEditId: null });
  }
  confirmMemberDel(): void {
    const id = this.ui().memberDelId; if (!id) return;
    // Ses créneaux ne partent pas avec lui : ceux qu'il partageait restent
    // entiers pour les autres, et ceux qui n'étaient qu'à lui deviennent « sans
    // membre », visibles et réparables. Les effacer serait une perte muette.
    const seuls = (this._data()?.sched || []).filter((x) => (x.who || []).length === 1 && x.who[0] === id).length;
    this.mutate((d) => {
      d.members = d.members.filter((m) => m.id !== id);
      d.sched = d.sched.map((x) => ((x.who || []).includes(id) ? { ...x, who: x.who.filter((w) => w !== id) } : x));
    });
    this.patch({ memberDelId: null, schedWho: this.ui().schedWho.filter((x) => x !== id) });
    // Un éventuel compte de connexion de ce membre est retiré côté serveur, au
    // mieux : l'appel est sans effet (et son échec sans conséquence) quand il
    // n'y en avait pas. AdminStore rafraîchit la liste via accountsRev.
    this.flush().then(() => this.api.deleteMemberAccount(id)).then(() => this.accountsRev.update((v) => v + 1)).catch(() => { /* pas de compte, ou hors ligne */ });
    this.toast(seuls
      ? 'Membre retiré, ' + seuls + (seuls > 1 ? ' créneaux sont désormais sans membre' : ' créneau est désormais sans membre')
      : 'Membre retiré');
  }
  /** Recharge le formulaire « Mon compte » depuis le document. */
  loadProfileFields(): void {
    const m = this.me();
    this.patch({
      pfName: m?.name || '', pfRole: m?.role || '', pfIni: m?.ini || '',
      pfEmail: this.myEmail(), pfColor: m?.color || '#E56B4E',
    });
  }
  /** Le bouton de profil de la barre latérale mène là où le profil se modifie. */
  openProfile(): void { this.loadProfileFields(); this.patch({ settingsSection: 'compte' }); this.go('settings'); }
  saveProfile(): void {
    const s = this.ui(); const name = s.pfName.trim(); if (!name) { this.toast('Le prénom est requis'); return; }
    // Des initiales laissées vides suivent le prénom ; des initiales choisies
    // restent, y compris après un changement de prénom (voir saveMember).
    const ini = s.pfIni.trim().toUpperCase().slice(0, 3) || contactIni(name);
    const id = this.me()?.id;
    this.mutate((d) => {
      const mi = d.members.findIndex((m) => m.id === id);
      if (mi >= 0) d.members[mi] = { ...d.members[mi], name, role: s.pfRole.trim(), color: s.pfColor, ini };
    });
    this.patch({ pfIni: ini });
    this.toast('Profil mis à jour');
  }

  /**
   * Changer son adresse de connexion ou son mot de passe, soi-même.
   *
   * Le mot de passe actuel est exigé par le serveur. Un changement de mot de
   * passe déconnecte les autres sessions : le jeton neuf que renvoie le serveur
   * garde celle-ci ouverte, sans quoi on se déconnecterait en se protégeant.
   */
  async changeCredentials(currentPassword: string, email: string, password: string): Promise<boolean> {
    if (!currentPassword) { this.toast('Donnez votre mot de passe actuel.'); return false; }
    const min = this.setting('passwordMinLength');
    if (password && password.length < min) { this.toast(`Mot de passe : ${min} caractères minimum`); return false; }
    const mail = email.trim();
    if (!password && mail.toLowerCase() === this.myEmail()) { this.toast('Rien à changer.'); return false; }
    try {
      const r = await this.api.updateMyCredentials(currentPassword, mail || undefined, password || undefined);
      // Le mot de passe changé a invalidé l'ancien cookie ; le serveur en a
      // reposé un frais dans la réponse. Rien à ranger côté client.
      this.myEmail.set(r.email);
      this.accountsRev.update((v) => v + 1);
      this.patch({ pfEmail: r.email });
      this.toast(r.othersLoggedOut ? 'Identifiants mis à jour, vos autres sessions sont déconnectées' : 'Adresse de connexion mise à jour');
      return true;
    } catch (e) { this.toast((e as Error).message); return false; }
  }

  // ---- notifications (dérivées de l'état, côté client) ------------------
  /**
   * Notifications poussées par les modules qui ne vivent pas dans ce document
   * (Finances). Évite une dépendance circulaire entre les stores.
   */
  readonly externalNotifs = signal<Notif[]>([]);

  /**
   * Repères de calendrier poussés par les modules qui ne vivent pas dans ce
   * document (échéances de contrat, déclarations CESU), indexés par date ISO.
   * Comme les notifications, ils sont **calculés** ailleurs et jamais stockés
   * ici : une date qui change change son repère, sans copie périmée. Chaque
   * module écrit sa propre source (finances, employé) sans écraser les autres.
   */
  private readonly extDayExtraSources = signal<Record<string, Record<string, DayExtra[]>>>({});

  /**
   * Créneaux d'emploi du temps venus d'ailleurs que du document : les cours
   * importés d'ÉcoleDirecte. Une source en plus, en lecture seule, jamais
   * écrite dans `sched` ; la vue semaine, la présence et les couverts lisent
   * `schedAll`, l'édition ne touche que `sched`.
   */
  private readonly extSlotSources = signal<Record<string, SchedSlot[]>>({});
  setExternalSlots(source: string, slots: SchedSlot[]): void {
    this.extSlotSources.update((s) => ({ ...s, [source]: slots }));
  }
  readonly schedAll = computed<SchedSlot[]>(() => {
    const own = this._data()?.sched || [];
    const ext = Object.entries(this.extSlotSources()).filter(([src]) => src !== 'ecole' || this.modEcole()).flatMap(([, v]) => v);
    return ext.length ? [...own, ...ext] : own;
  });
  setExternalDayExtras(source: string, map: Record<string, DayExtra[]>): void {
    this.extDayExtraSources.update((s) => ({ ...s, [source]: map }));
  }
  private readonly externalDayExtras = computed(() => {
    const out: Record<string, DayExtra[]> = {};
    // Un module éteint ne pose plus ses repères, même si son store tourne encore.
    const off = (src: string): boolean => (src === 'finances' && !this.modFinances()) || (src === 'employe' && !this.modEmploye()) || (src === 'ecole' && !this.modEcole());
    for (const [source, map] of Object.entries(this.extDayExtraSources())) {
      if (off(source)) continue;
      for (const [ds, items] of Object.entries(map)) (out[ds] ??= []).push(...items);
    }
    return out;
  });

  toggleNotif(): void { this.patch({ notifOpen: !this.ui().notifOpen }); }

  /**
   * Notifications utiles calculées à partir de l'état : événements du jour/demain,
   * tâches planifiées à faire ou en retard, anniversaires proches, budgets dépassés.
   * L'affichage est conditionné au réglage « Notifications ».
   */
  readonly notifications = computed<Notif[]>(() => {
    const d = this._data();
    if (!d || !this.setting('prefNotifs')) return [];
    const today = this.todayStr();
    const read = this.readNotifs();
    const addDays = (iso: string, n: number): string => { const dt = parseDay(iso); dt.setDate(dt.getDate() + n); return dstr(dt); };
    const tomorrow = addDays(today, 1);
    const mName = (id: string): string => d.members.find((m) => m.id === id)?.name || '';
    const mNames = (ids: string[]): string => (ids || []).map(mName).filter(Boolean).join(', ');
    const raw: Omit<Notif, 'read'>[] = [];

    // Chaque module a son interrupteur, personnel : la cloche de l'un n'est pas
    // celle de l'autre, et couper les anniversaires ne doit pas couper l'agenda.
    // Événements aujourd'hui / demain
    if (this.setting('notifEvents')) {
    for (const e of this.eventsForDay(today)) raw.push({ id: `ev-${e.id}-${today}`, kind: 'event', title: e.title, desc: (e.time && e.time !== '—' ? e.time + ' · ' : '') + "Aujourd'hui" + (mNames(e.who) ? ' · ' + mNames(e.who) : ''), time: "Aujourd'hui" });
    for (const e of this.eventsForDay(tomorrow)) raw.push({ id: `ev-${e.id}-${tomorrow}`, kind: 'event', title: e.title, desc: (e.time && e.time !== '—' ? e.time + ' · ' : '') + 'Demain' + (mNames(e.who) ? ' · ' + mNames(e.who) : ''), time: 'Demain' });
    }

    // Tâches datées de l'affaire du jour : à faire aujourd'hui / en retard
    if (this.setting('notifTasks')) {
    for (const t of dailyTasks(d.tasks, d.taskLists, this.currentMemberId())) {
      if (t.done || !t.due) continue;
      const qui = t.who.length ? ' · ' + t.who.map(mName).join(', ') : '';
      const rappel = t.remind ? ' · rappel ' + REMIND_LABELS[t.remind].toLowerCase() : '';
      if (t.due === today) raw.push({ id: `task-${t.id}-${t.due}`, kind: 'task', title: t.text, desc: "À faire aujourd'hui" + (t.time ? ' à ' + t.time : '') + rappel + qui, time: "Aujourd'hui" });
      else if (t.due < today) raw.push({ id: `task-${t.id}-${t.due}`, kind: 'task', title: t.text, desc: 'En retard (prévue le ' + this.fmtNumDate(t.due) + ')' + qui, time: 'En retard' });
    }
    }

    // Anniversaires : aujourd'hui + 7 jours (membres & contacts)
    if (this.setting('notifBirthdays')) {
    for (let i = 0; i <= 7; i++) {
      const ds = addDays(today, i);
      const when = i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : `Dans ${i} jours`;
      const bday = (name: string, birthday: string, key: string): void => {
        const a = ageOn(birthday, ds);
        raw.push({ id: `bday-${key}-${ds.slice(5)}`, kind: 'birthday', title: 'Anniversaire de ' + name, desc: when + (a != null ? ` · ${a} ans` : ''), time: when });
      };
      for (const m of d.members) if (isBirthdayOn(m.birthday, ds)) bday(m.name, m.birthday!, 'm' + m.id);
      for (const c of d.contacts) if (isBirthdayOn(c.birthday, ds)) bday(c.name, c.birthday!, 'c' + c.id);
    }
    }

    // Les alertes de budget viennent du module Finances, dont les données vivent
    // dans des tables dédiées et non dans ce document. Module éteint, plus d'alerte.
    if (this.setting('notifFinances') && this.modFinances()) raw.push(...this.externalNotifs());

    return raw.map((n) => ({ ...n, read: read.has(n.id) }));
  });

  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  /**
   * Enregistre les identifiants lus sur la fiche du membre (donc partagés entre
   * ses appareils). On ne garde que les identifiants encore vivants (une
   * notification affichable aujourd'hui) : sans quoi la liste enflerait d'un
   * identifiant par événement et par jour, sans jamais rien oublier.
   */
  private saveRead(ids: string[]): void {
    const me = this.currentMemberId();
    if (!me) return;
    const live = new Set(this.notifications().map((n) => n.id));
    const next = [...new Set([...this.readNotifs(), ...ids])].filter((id) => live.has(id));
    this.mutate((d) => { const m = d.members.find((x) => x.id === me); if (m) m.readNotifs = next; });
  }
  markAllRead(): void { this.saveRead(this.notifications().map((n) => n.id)); }
  openNotif(id: string, screen?: string): void {
    this.saveRead([id]);
    // « ev-<événement>-<jour> », « task-<tâche>-<échéance> » : l'élément a sa fiche, ouverte sur place.
    const el = /^(ev|task)-(.+)-(\d{4}-\d{2}-\d{2})$/.exec(id);
    if (el) {
      this.patch({ notifOpen: false });
      if (el[1] === 'ev') this.openItem('event', el[2], { occ: el[3] }); else this.openItem('task', el[2]);
      return;
    }
    this.patch({ notifOpen: false, screen: screen || this.ui().screen });
  }
  /** Marquer une seule notification comme lue, sans quitter le panneau. */
  markRead(id: string): void { this.saveRead([id]); }

  // ---- settings ---------------------------------------------------------
  //
  // Toute lecture et toute écriture d'un réglage passe par le registre
  // (core/settings/registry.ts) : c'est ce qui rend un réglage mort ou fantôme
  // détectable en CI. Personne ne touche `settings` directement.

  /**
   * Ce que le serveur dit des réglages : ce qu'une variable d'environnement
   * impose, qui a le droit d'écrire, et le journal des modifications. Les
   * valeurs, elles, viennent du document, pour que la page reste lisible hors
   * ligne.
   */
  readonly settingsInfo = signal<SettingsPayload | null>(null);

  async loadSettingsInfo(): Promise<void> {
    try { this.settingsInfo.set(await this.api.settings()); }
    catch { /* hors ligne : la page se contente du document, sans le journal */ }
  }

  /**
   * Pourquoi ce réglage n'est pas modifiable ici, ou une chaîne vide quand il
   * l'est. Un champ grisé sans explication est pire qu'un champ absent : on
   * croit à une panne.
   */
  settingLock(d: SettingDecl): string {
    const impose = this.settingsInfo()?.overrides[d.key];
    if (impose !== undefined) {
      return `Imposé par la variable d’environnement ${d.envOverride} (« ${impose} »). `
        + 'Pour le changer : éditez /etc/foyer/foyer.env (ou docker-compose.yml), puis redémarrez le service.';
    }
    if (d.scope === 'foyer' && !this.isAdmin()) return 'Réglage du foyer : seul un administrateur peut le modifier. Vous le voyez tel qu’il est appliqué.';
    if (d.scope === 'personnel' && !this.currentMemberId()) return 'Votre compte n’est rattaché à aucun membre du foyer : cette préférence n’a personne à qui s’appliquer.';
    return '';
  }

  /**
   * La valeur d'un réglage, ou son défaut quand le document ne la porte pas.
   *
   * Une préférence personnelle est lue dans la table du membre connecté : c'est
   * le même appel pour les deux portées, l'écran n'a pas à savoir laquelle.
   */
  setting<K extends SettingKey>(key: K): SettingValue<K> {
    return setting(key, this._data(), this.currentMemberId());
  }

  /**
   * Lit et écrit un réglage depuis sa **déclaration** plutôt que depuis sa clé.
   *
   * La page Paramètres est engendrée : elle parcourt le registre et ne connaît
   * aucune clé à la compilation. La conversion de type est enfermée ici, à un
   * seul endroit, et le contrôle de saisie du registre reste le juge.
   */
  readDeclared(d: SettingDecl): boolean | number | string {
    // Un réglage qu'une variable d'environnement écrase ne vaut pas ce que le
    // document en dit : c'est le serveur qui a raison, et la page doit montrer
    // ce qui s'applique, pas ce qui est rangé.
    const info = this.settingsInfo();
    if (info && info.overrides[d.key] !== undefined) return info.values[d.key];
    return this.setting(d.key as SettingKey);
  }
  writeDeclared(d: SettingDecl, val: boolean | number | string): Promise<void> {
    return this.setSetting(d.key as SettingKey, val as SettingValue<SettingKey>);
  }

  /**
   * Écrit un réglage.
   *
   * Application immédiate : l'écran répond tout de suite, puis le serveur
   * tranche. Un refus **remet la valeur d'avant** et le dit, plutôt que de
   * laisser croire que le réglage a pris. Le contrôle du registre a lieu deux
   * fois, ici pour un message instantané et sur le serveur parce que c'est lui
   * qui décide.
   *
   * L'écriture est ciblée (PATCH /api/settings) et non un enregistrement du
   * document : deux administrateurs qui règlent deux choses ne s'écrasent pas.
   */
  async setSetting<K extends SettingKey>(key: K, val: SettingValue<K>): Promise<void> {
    // Un réglage du foyer engage tout le monde, une préférence n'engage que soi.
    // Le serveur refuse de toute façon : le dire tout de suite évite un
    // interrupteur qui bascule puis revient tout seul, ce qui ressemble à une panne.
    if (declOf(key)?.scope === 'foyer' && !this.isAdmin()) {
      this.toast('Seul un administrateur du foyer peut modifier les réglages du foyer.');
      return;
    }
    const checked = validate(key, val);
    if (!checked.ok) { this.toast(checked.error); return; }
    const avant = this.setting(key);
    if (avant === checked.value) return;
    // Rendue attendable : un appelant qui enchaîne sur l'effet du réglage (le
    // canal de mise à jour revérifie dans la foulée) doit partir après
    // l'enregistrement, sinon le serveur répondrait avec l'ancienne valeur.
    // La pose locale, elle, reste immédiate : l'écran ne clignote pas.
    return this.writeSetting(key, checked.value as SettingValue<K>, avant);
  }

  private async writeSetting<K extends SettingKey>(key: K, val: SettingValue<K>, avant: SettingValue<K>): Promise<void> {
    this.putSettingLocally(key, val);
    if (key === 'academie') void this.loadSchoolHolidays();
    try {
      await this.api.patchSettings({ [key]: val });
      void this.loadSettingsInfo(); // le journal vient de gagner une ligne
    } catch (e) {
      this.putSettingLocally(key, avant);
      if (key === 'academie') void this.loadSchoolHolidays();
      const err = e as ApiError;
      this.toast(err.status === 403
        ? 'Réglage non enregistré : seul un administrateur du foyer peut le modifier.'
        : 'Réglage non enregistré : ' + err.message);
    }
  }

  /**
   * Pose la valeur dans le document tenu en mémoire, sans passer par `mutate` :
   * les réglages ne s'enregistrent plus avec le document, c'est le serveur qui
   * les détient.
   */
  private putSettingLocally(key: string, val: unknown): void {
    const cur = this._data();
    if (!cur) return;
    const next = structuredClone(cur);
    if (declOf(key)?.scope === 'personnel') {
      const me = this.currentMemberId();
      if (!me) return;
      next.prefs ||= {};
      next.prefs[me] = { ...(next.prefs[me] || {}), [key]: val } as (typeof next.prefs)[string];
    } else {
      (next.settings as Record<string, unknown>)[key] = val;
    }
    this._data.set(next);
  }
  exportData(): void {
    const d = this._data(); if (!d) return;
    downloadBlob(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }), 'foyer-export.json');
    this.toast('Export des données lancé');
  }

  // ---- exports du module Cuisine ----------------------------------------

  /** Provoque un téléchargement. Le lien est révoqué : sinon le blob reste en mémoire. */

  readonly exportBusy = signal(false);

  /**
   * Le carnet complet, photos comprises. Sans les photos ce ne serait pas une
   * sauvegarde : elles vivent sur le disque du serveur, qu'un export JSON ne
   * transporte pas.
   */
  async exportRecipes(): Promise<void> {
    const d = this._data(); if (!d || this.exportBusy()) return;
    if (!d.recipes.length) { this.toast('Le carnet est vide'); return; }
    this.exportBusy.set(true);
    try {
      const photos: Record<number, ExportedPhoto | undefined> = {};
      let manquantes = 0;
      for (const id of new Set(d.recipes.map((r) => r.photoId).filter((x): x is number => !!x))) {
        try {
          const blob = await this.api.download('files/' + id);
          photos[id] = { name: 'photo-' + id, type: blob.type || 'image/jpeg', data: await blobToBase64(blob) };
        } catch { manquantes++; }
      }
      const bundle = buildBundle(d.recipes, photos);
      downloadBlob(new Blob([JSON.stringify(bundle)], { type: 'application/json' }), fileName('carnet-de-recettes', 'json'));
      this.toast(d.recipes.length + ' recettes exportées' + (manquantes ? ', ' + manquantes + ' photo(s) illisible(s)' : ''));
    } finally { this.exportBusy.set(false); }
  }

  /** Rapport d'import en attente de validation, affiché avant d'écrire. */
  readonly importReport = signal<ImportReport | null>(null);
  readonly importBusy = signal(false);

  /** Lit le fichier choisi et prépare le rapport. N'écrit rien. */
  async prepareRecipeImport(file: File): Promise<void> {
    try {
      const rep = planImport(parseBundle(await file.text()), this._data()?.recipes || []);
      if (!rep.nouvelles.length && !rep.deja.length && !rep.ignorees.length) {
        this.toast('Ce fichier ne contient aucune recette'); return;
      }
      this.importReport.set(rep);
      this.patch({ importOpen: true });
    } catch (e) {
      this.toast(e instanceof ImportError ? e.message : 'Fichier illisible');
    }
  }

  /**
   * Crée les recettes du rapport. Une photo qui ne remonte pas ne fait pas
   * perdre sa recette : elle est importée sans image, et le compte est dit.
   */
  async applyRecipeImport(): Promise<void> {
    const rep = this.importReport();
    if (!rep || !rep.nouvelles.length || this.importBusy()) return;
    this.importBusy.set(true);
    let photosOk = 0;
    try {
      const ajouts: Recipe[] = [];
      for (const e of rep.nouvelles) {
        let photoId: number | null = null;
        if (e.photo) {
          try {
            const file = new File([base64ToBytes(e.photo.data)], e.photo.name, { type: e.photo.type });
            const res = await this.api.uploadFile('recipe', e.id, file);
            photoId = res.file.id; photosOk++;
            this.cachePhoto(res.file.id, file);
          } catch { /* la recette vaut mieux que sa photo */ }
        }
        ajouts.push({
          id: e.id, name: e.name, level: e.level, color: e.color,
          photoId,
          portions: e.portions ?? null, prepMin: e.prepMin ?? null, cookMin: e.cookMin ?? null,
          source: e.source ?? null,
          ingr: [...e.ingr], steps: [...e.steps],
        });
      }
      this.mutate((d) => { d.recipes = [...ajouts, ...d.recipes]; });
      const perdues = rep.photos - photosOk;
      this.toast(ajouts.length + ' recettes importées' + (perdues > 0 ? ', ' + perdues + ' photo(s) non reprise(s)' : ''));
    } finally {
      this.importBusy.set(false);
      this.importReport.set(null);
      this.patch({ importOpen: false });
    }
  }

  /**
   * La recette en texte, dans le presse-papier. Le presse-papier n'existe pas en
   * HTTP simple ni sur les navigateurs anciens : on retombe alors sur un
   * fichier, plutôt que d'échouer sans rien dire.
   */
  async copyRecipeText(r: Recipe): Promise<void> {
    const texte = recipeToText(r);
    try {
      await navigator.clipboard.writeText(texte);
      this.toast('Recette copiée, prête à être collée');
    } catch {
      downloadBlob(new Blob([texte], { type: 'text/plain;charset=utf-8' }), fileName(r.name, 'txt'));
      this.toast('Recette enregistrée en fichier texte');
    }
  }

  /** La liste visible, dans l'ordre des allées, lisible par un tableur français. */
  exportShoppingCsv(): void {
    const d = this._data(); if (!d) return;
    const a = this.ui().activeShopList;
    const items = a === 'all' ? d.shop : d.shop.filter((i) => i.listId === a);
    if (!items.length) { this.toast('Cette liste est vide'); return; }
    const nom = a === 'all' ? 'liste-de-courses' : (d.shopLists.find((l) => l.id === a)?.name || 'liste-de-courses');
    // Le BOM n'est pas décoratif : sans lui, un tableur ouvre le fichier en
    // encodage local et « Épicerie » devient « Ã‰picerie ».
    const csv = '\ufeff' + shopToCsv(items, this.aislesInOrder());
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName(nom, 'csv'));
    this.toast(items.length + ' articles exportés');
  }
}
