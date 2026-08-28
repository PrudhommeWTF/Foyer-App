import { Injectable, computed, effect, signal, untracked } from '@angular/core';
import { ApiService, SetupPayload, ShopOp, ShopOpDraft, UpdateInfo } from './api.service';
import { EventItem, HouseholdState, MealItem, MealValue, Member, Notif, Recipe, ShopItem, ShopState, TaskItem } from './models';
import { buildArticleIndex } from './ingredients';
import { PlanReport, buildPlan } from './shopping-plan';
import { CopyReport, applyMealCopy } from './meal-copy';
import { mealEventTitle, shoppingTaskLabel } from './links';
import {
  ExportedPhoto, ImportError, ImportReport, buildBundle, fileName, parseBundle, planImport, recipeToText, shopToCsv,
} from './exports';
import { UiState, initialUi } from './ui-state';
import { ageOn, cap, contactIni, dstr, fileTypeOf, fmtNumericDate, frenchHolidays, isBirthdayOn, normText, num, occursOn, parseDay, uid, weekDates } from './helpers';
import { CAL_KINDS, DATEFMT_ORDER, MEAL_SLOTS, SCHED_DAYS, tint, grad } from './constants';

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

const READ_NOTIFS_KEY = 'foyer.readNotifs';
function loadReadNotifs(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(READ_NOTIFS_KEY) || '[]')); } catch { return new Set(); }
}

/**
 * File des opérations de courses pas encore acquittées par le serveur.
 *
 * Elle est persistée dans le navigateur, et c'est tout l'intérêt : les coches
 * faites dans un magasin sans réseau survivent à un onglet recyclé par iOS. Sans
 * cela, elles ne vivaient qu'en mémoire et disparaissaient sans un mot.
 */
const SHOP_QUEUE_KEY = 'foyer.shopQueue';
function loadShopQueue(): ShopOp[] {
  try { const v = JSON.parse(localStorage.getItem(SHOP_QUEUE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Cadence de sondage tant que l'écran Courses est visible. */
const SHOP_POLL_MS = 5000;

export interface DayExtra { kind: string; label: string; color: string; sub?: string; }
export interface SchoolHoliday { name: string; start: string; end: string; zone: string; }
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
  readonly allowSignup = signal(true);
  readonly authError = signal('');
  readonly saveState = signal<SaveState>('idle');

  // Current user & member login accounts (admin-managed).
  readonly isAdmin = signal(false);
  readonly currentMemberId = signal<string | null>(null);
  readonly accounts = signal<Record<string, string>>({}); // memberId → login email

  // Calendar overlays
  readonly schoolHolidays = signal<SchoolHoliday[]>([]);
  readonly icsToken = signal<string>('');

  // Self-update
  readonly updateInfo = signal<UpdateInfo | null>(null);
  readonly updateChecking = signal(false);
  readonly updating = signal(false);
  readonly updateMsg = signal('');

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

  /** Non-null data accessor for use inside authed views. */
  readonly data = computed(() => this._data());

  /**
   * Meal slots actually shown. Breakfast is opt-in: it is almost never planned
   * and costs a third of the grid height on a phone. Hiding it keeps whatever
   * was already recorded, it only stops displaying the row.
   */
  readonly mealSlots = computed(() => MEAL_SLOTS.filter((s) => s.key !== 'matin' || !!this._data()?.settings.showBreakfast));
  readonly narrow = signal(false);

  // Notifications lues (ids), persistées côté navigateur (état d'UI, non partagé).
  readonly readNotifs = signal<Set<string>>(loadReadNotifs());

  // ---- regional formatting ----------------------------------------------
  // Foyer cible la France métropolitaine : locale et fuseau sont fixes.
  readonly locale = 'fr-FR';
  readonly timeZone = 'Europe/Paris';
  /** Real "today" (YYYY-MM-DD) in the household time zone. */
  readonly todayStr = computed(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch { return dstr(new Date()); }
  });
  /** ISO date → household numeric format (e.g. 24/07/2026). */
  fmtNumDate(iso: string): string { return fmtNumericDate(iso, DATEFMT_ORDER[this._data()?.settings.dateFmt || ''] || 'dmy'); }
  /** ISO date → long localized label (e.g. « jeudi 24 juillet »). */
  fmtLongDate(iso: string): string {
    try { return cap(parseDay(iso).toLocaleDateString(this.locale, { weekday: 'long', day: 'numeric', month: 'long' })); }
    catch { return iso; }
  }

  // ---- synchronisation de la liste de courses ----------------------------
  /** Version du document connue du client ; sert au sondage différentiel. */
  private shopVersion = 0;
  /** Opérations en attente d'acquittement, persistées (voir SHOP_QUEUE_KEY). */
  private shopQueue = signal<ShopOp[]>(loadShopQueue());
  /** Nombre de coches pas encore parties. Affiché : sans cela le doute est total. */
  readonly shopPending = computed(() => this.shopQueue().length);
  readonly shopOffline = signal(false);
  private shopFlushing = false;
  private shopFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private shopPollTimer: ReturnType<typeof setInterval> | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService) {
    // Theme side effect: reflect settings.dark onto <html>.
    effect(() => {
      const d = this._data();
      const dark = d ? d.settings.dark : false;
      document.documentElement.classList.toggle('dark', dark);
    });

    // Les photos sont téléchargées avec la session dès qu'une recette en cite
    // une. `untracked` évite que la mise en cache relance l'effet en boucle.
    effect(() => {
      const needed = this.neededPhotoIds();
      const known = untracked(() => this.photoUrls());
      for (const id of needed) if (!(id in known)) void this.loadPhoto(id);
    });

    // Le sondage ne tourne que sur l'écran Courses : ailleurs il ne servirait
    // qu'à vider la batterie. Il s'arrête aussi quand l'onglet passe en arrière-plan.
    effect(() => {
      const onCourses = this.ui().screen === 'courses' && this.authed();
      if (onCourses) this.startShopPolling(); else this.stopShopPolling();
    });

    // Retour du réseau : la file part immédiatement, sans attendre que
    // quelqu'un touche à nouveau l'écran.
    window.addEventListener('online', () => { this.shopOffline.set(false); void this.flushShopQueue(); });
    window.addEventListener('offline', () => this.shopOffline.set(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !this.authed()) return;
      void this.flushShopQueue();
      if (this.ui().screen === 'courses') void this.pollShopping();
    });
  }

  // ---- lifecycle / auth -------------------------------------------------
  async init(): Promise<void> {
    // First run? The setup wizard must create the household + admin account.
    try {
      const status = await this.api.setupStatus();
      this.allowSignup.set(status.allowSignup);
      if (status.needsSetup) {
        this.needsSetup.set(true);
        this.api.token = null;
        this.ready.set(true);
        return;
      }
    } catch {
      /* status unreachable — fall through to normal auth handling */
    }
    if (this.api.token) {
      try {
        await this.loadState();
        this.authed.set(true);
      } catch {
        this.api.token = null;
      }
    }
    this.ready.set(true);
  }

  async completeSetup(payload: SetupPayload): Promise<boolean> {
    this.authError.set('');
    try {
      const res = await this.api.setup(payload);
      this.api.token = res.token;
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

  private async loadState(): Promise<void> {
    const { state } = await this.api.getState();
    this._data.set(this.normalise(state));
    this.patch({ famNameField: state.familyName });
    try {
      const me = await this.api.me();
      this.currentMemberId.set(me.memberId);
      this.isAdmin.set(me.admin);
    } catch { /* ignore */ }
    await this.refreshAccounts();
    // Quelle version le serveur exécute réellement : la première question quand
    // un écran ne ressemble pas à ce que la mise à jour annonçait.
    this.api.systemVersion().then((v) => this.version.set(v.current)).catch(() => { /* sans conséquence */ });
    this.loadSchoolHolidays();
    this.loadIcs();
    this.resumeUpdateIfRunning();
  }

  // ---- calendar overlays -----------------------------------------------
  async loadSchoolHolidays(): Promise<void> {
    const ac = this._data()?.settings.academie || '';
    if (!ac) { this.schoolHolidays.set([]); return; }
    try { const r = await this.api.schoolHolidays(ac); this.schoolHolidays.set(r.holidays || []); }
    catch { this.schoolHolidays.set([]); }
  }
  async loadIcs(): Promise<void> { try { const r = await this.api.icsInfo(); this.icsToken.set(r.token); } catch { /* ignore */ } }
  async regenerateIcs(): Promise<void> {
    try { const r = await this.api.icsRegenerate(); this.icsToken.set(r.token); this.toast('Nouveau lien de calendrier généré'); }
    catch (e) { this.toast((e as Error).message); }
  }
  icsUrl(): string { const t = this.icsToken(); return t ? new URL('api/calendar/feed.ics?token=' + t, document.baseURI).href : ''; }

  // ---- self-update ------------------------------------------------------
  async checkUpdates(): Promise<void> {
    this.updateChecking.set(true);
    try { this.updateInfo.set(await this.api.updateCheck()); }
    catch (e) { this.updateInfo.set({ current: '?', selfUpdate: false, error: (e as Error).message }); }
    this.updateChecking.set(false);
  }

  async applyUpdate(): Promise<void> {
    if (this.updating()) return;
    this.updating.set(true);
    this.updateMsg.set('Démarrage de la mise à jour…');
    try {
      const r = await this.api.startSystemUpdate();
      if (r.error) { this.updating.set(false); this.toast(r.error); return; }
    } catch (e) { this.updating.set(false); this.toast((e as Error).message); return; }
    this.pollUpdateStatus();
  }

  /**
   * If a self-update is already running on the server (e.g. the page was
   * reloaded mid-update), resume showing its progress. Called on app load.
   */
  async resumeUpdateIfRunning(): Promise<void> {
    if (this.updating()) return;
    try {
      const s = await this.api.updateStatus();
      if (s.state === 'running') {
        this.updating.set(true);
        this.updateMsg.set(s.message || 'Mise à jour en cours…');
        this.pollUpdateStatus();
      }
    } catch { /* status unreachable — ignore */ }
  }

  /** Poll the server update status every 3 s until it finishes (done/error/timeout). */
  private pollUpdateStatus(): void {
    const started = Date.now();
    const poll = async (): Promise<void> => {
      if (Date.now() - started > 10 * 60 * 1000) { this.updating.set(false); this.updateMsg.set('Délai dépassé — vérifiez les logs du serveur.'); return; }
      try {
        const s = await this.api.updateStatus();
        if (s.message) this.updateMsg.set(s.message);
        if (s.state === 'done') { this.updating.set(false); this.toast('Mise à jour installée — rechargement…'); setTimeout(() => location.reload(), 1600); return; }
        if (s.state === 'error') { this.updating.set(false); this.toast('Échec : ' + (s.message || 'voir les logs')); return; }
      } catch { this.updateMsg.set('Redémarrage du service…'); }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 3000);
  }

  /** Derived (non-event) calendar items for a day: holidays, school holidays, birthdays, planned tasks. */
  dayExtras(ds: string): DayExtra[] {
    const d = this._data();
    if (!d) return [];
    const out: DayExtra[] = [];
    const h = frenchHolidays(parseInt(ds.slice(0, 4), 10)).find((x) => x.date === ds);
    if (h) out.push({ kind: 'holiday', label: h.name, color: CAL_KINDS['holiday'].color });
    for (const sh of this.schoolHolidays()) { if (ds >= sh.start && ds <= sh.end) { out.push({ kind: 'school', label: sh.name, color: CAL_KINDS['school'].color }); break; } }
    for (const m of d.members) { if (isBirthdayOn(m.birthday, ds)) { const a = ageOn(m.birthday!, ds); out.push({ kind: 'birthday', label: 'Anniv. ' + m.name, color: m.color, sub: a != null ? a + ' ans' : undefined }); } }
    for (const c of d.contacts) { if (isBirthdayOn(c.birthday, ds)) { const a = ageOn(c.birthday!, ds); out.push({ kind: 'birthday', label: 'Anniv. ' + c.name, color: CAL_KINDS['birthday'].color, sub: a != null ? a + ' ans' : undefined }); } }
    for (const t of d.tasks) { if (t.planned === ds) out.push({ kind: 'task', label: t.text, color: CAL_KINDS['task'].color, sub: t.done ? 'faite' : undefined }); }
    out.push(...(this.externalDayExtras()[ds] || []));
    return out;
  }

  async refreshAccounts(): Promise<void> {
    try {
      const { accounts } = await this.api.memberAccounts();
      this.accounts.set(Object.fromEntries(accounts.map((a) => [a.memberId, a.email])));
    } catch { /* ignore */ }
  }

  memberHasAccount(memberId: string): boolean { return !!this.accounts()[memberId]; }
  memberAccountEmail(memberId: string): string { return this.accounts()[memberId] || ''; }

  /** Guard against older/partial state documents missing newer keys. */
  private normalise(s: HouseholdState): HouseholdState {
    s.meals ||= {};
    s.articles ||= [];
    s.settings ||= { dateFmt: 'JJ/MM/AAAA', dark: false, prefNotifs: true };
    return s;
  }

  async login(email: string, password: string, remember = true): Promise<boolean> {
    this.authError.set('');
    this.api.setRemember(remember);
    try {
      const res = await this.api.login(email, password);
      this.api.token = res.token;
      await this.loadState();
      this.authed.set(true);
      this.toast('Bienvenue dans votre foyer');
      return true;
    } catch (e) {
      this.authError.set((e as Error).message);
      return false;
    }
  }

  async register(email: string, password: string, name: string): Promise<boolean> {
    this.authError.set('');
    try {
      const res = await this.api.register(email, password, name);
      this.api.token = res.token;
      await this.loadState();
      this.authed.set(true);
      this.toast('Bienvenue dans votre foyer');
      return true;
    } catch (e) {
      this.authError.set((e as Error).message);
      return false;
    }
  }

  logout(): void {
    this.api.token = null;
    this.authed.set(false);
    this._data.set(null);
    this.ui.set(initialUi());
    this.isAdmin.set(false);
    this.currentMemberId.set(null);
    this.accounts.set({});
    this.schoolHolidays.set([]);
    this.icsToken.set('');
    this.revokePhotos();
  }

  // ---- member login accounts --------------------------------------------
  async openAccount(memberId: string): Promise<void> {
    // Ensure the member exists server-side before managing its account.
    await this.flush();
    await this.refreshAccounts();
    this.patch({ accountFor: memberId, acEmail: this.memberAccountEmail(memberId), acPassword: '', acBusy: false });
  }
  closeAccount(): void { this.patch({ accountFor: null, acBusy: false }); }

  async saveAccount(): Promise<void> {
    const s = this.ui();
    const memberId = s.accountFor;
    if (!memberId || s.acBusy) return;
    const email = s.acEmail.trim();
    const password = s.acPassword;
    const exists = this.memberHasAccount(memberId);
    if (!exists) {
      if (!/^\S+@\S+\.\S+$/.test(email)) { this.toast('Email invalide'); return; }
      if (password.length < 6) { this.toast('Mot de passe : 6 caractères minimum'); return; }
    } else if (password && password.length < 6) {
      this.toast('Mot de passe : 6 caractères minimum'); return;
    }
    this.patch({ acBusy: true });
    try {
      if (!exists) await this.api.createMemberAccount(memberId, email, password);
      else await this.api.updateMemberAccount(memberId, email || undefined, password || undefined);
      await this.refreshAccounts();
      this.patch({ accountFor: null, acBusy: false });
      this.toast(exists ? 'Accès mis à jour' : 'Accès créé');
    } catch (e) {
      this.patch({ acBusy: false });
      this.toast((e as Error).message);
    }
  }

  async removeAccount(): Promise<void> {
    const memberId = this.ui().accountFor;
    if (!memberId) return;
    this.patch({ acBusy: true });
    try {
      await this.api.deleteMemberAccount(memberId);
      await this.refreshAccounts();
      this.patch({ accountFor: null, acBusy: false });
      this.toast('Accès retiré');
    } catch (e) {
      this.patch({ acBusy: false });
      this.toast((e as Error).message);
    }
  }

  // ---- state plumbing ---------------------------------------------------
  patch(p: Partial<UiState>): void { this.ui.update((u) => ({ ...u, ...p })); }

  private mutate(fn: (d: HouseholdState) => void): void {
    const cur = this._data();
    if (!cur) return;
    const next = structuredClone(cur);
    fn(next);
    this._data.set(next);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 700);
  }

  async flush(): Promise<void> {
    const d = this._data();
    if (!d) return;
    this.saveState.set('saving');
    try {
      await this.api.putState(d);
      this.saveState.set('idle');
    } catch {
      this.saveState.set('error');
    }
  }

  // ---- liste de courses : opérations, file et sondage ---------------------
  //
  // La liste ne part plus dans `putState` : le serveur ignore ce champ. Toute
  // mutation passe par une opération ciblée, ce qui rend impossible qu'un
  // téléphone périmé décoche ce que l'autre vient de cocher.
  //
  // Trois choses se passent ici, dans cet ordre :
  //   1. l'écran est mis à jour tout de suite, sans attendre le réseau ;
  //   2. l'opération est mise en file, et la file est persistée ;
  //   3. la file part au serveur, dont la réponse fait autorité.

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
          ...(op.art ? { art: op.art } : {}), ...(op.gen ? { gen: true } : {}),
        });
        break;
      case 'set-state':
        if (idx >= 0) items[idx] = { ...items[idx], state: op.state, by: op.by ?? null, at: op.at ?? null };
        break;
      case 'edit':
        if (idx >= 0) {
          items[idx] = {
            ...items[idx],
            ...(op.name !== undefined ? { name: op.name } : {}),
            ...(op.qty !== undefined ? { qty: op.qty } : {}),
            ...(op.aisleId !== undefined ? { aisleId: op.aisleId } : {}),
            ...(op.listId !== undefined ? { listId: op.listId } : {}),
          };
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
      this.shopOffline.set(false);
      // Retenues comme écartées, les opérations quittent la file : une
      // opération définitivement refusée qu'on rejouerait tournerait sans fin.
      const settled = new Set([...res.applied, ...res.skipped.map((k) => k.opId)]);
      this.saveShopQueue(this.shopQueue().filter((o) => !settled.has(o.opId)));
      this.adoptShopping(res.version, res.items);
      if (res.skipped.length) {
        // Le dire : un article qui n'arrive jamais dans la liste sans explication
        // est exactement ce qui fait abandonner l'outil.
        this.toast(res.skipped.length === 1 ? res.skipped[0].reason : res.skipped.length + ' modifications refusées');
      }
    } catch {
      this.shopOffline.set(true);
    } finally {
      this.shopFlushing = false;
    }
  }

  /** Remplace la liste locale par celle du serveur, qui fait autorité. */
  private adoptShopping(version: number, items: ShopItem[]): void {
    this.shopVersion = version;
    const cur = this._data(); if (!cur) return;
    // Les opérations encore en file n'ont pas été vues du serveur : les rejouer
    // par-dessus sa réponse évite qu'une coche faite hors ligne clignote.
    this._data.set({ ...cur, shop: items });
    for (const op of this.shopQueue()) this.applyShopLocally(op);
  }

  /** Sondage différentiel : sans changement, la réponse tient en trois lignes. */
  async pollShopping(): Promise<void> {
    if (!this.authed()) return;
    try {
      const snap = await this.api.shopping(this.shopVersion);
      this.shopOffline.set(false);
      if (snap.unchanged || !snap.items) { this.shopVersion = snap.version; return; }
      this.adoptShopping(snap.version, snap.items);
    } catch {
      this.shopOffline.set(true);
    }
  }

  private startShopPolling(): void {
    if (this.shopPollTimer) return;
    void this.flushShopQueue();
    void this.pollShopping();
    this.shopPollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void this.flushShopQueue();
      void this.pollShopping();
    }, SHOP_POLL_MS);
  }

  private stopShopPolling(): void {
    if (!this.shopPollTimer) return;
    clearInterval(this.shopPollTimer);
    this.shopPollTimer = null;
  }

  toast(msg: string): void {
    this.patch({ toast: msg });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.patch({ toast: '' }), 2600);
  }

  // ---- member helpers ---------------------------------------------------
  private members(): Member[] { return this._data()?.members || []; }
  memberColor(id: string): string { return this.members().find((m) => m.id === id)?.color || '#8A7E74'; }
  memberName(id: string): string { return this.members().find((m) => m.id === id)?.name || ''; }
  memberIni(id: string): string { return this.members().find((m) => m.id === id)?.ini || '?'; }
  tint = tint;
  grad = grad;

  // ---- navigation -------------------------------------------------------
  go(screen: string): void { this.patch({ screen, openRecipeId: null, moreOpen: false, addMenuOpen: false, notifOpen: false }); }
  toggleDark(): void { this.mutate((d) => { d.settings.dark = !d.settings.dark; }); }
  setThemeMode(mode: 'light' | 'dark'): void { this.mutate((d) => { d.settings.dark = mode === 'dark'; }); }

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
    for (const t of d.tasks) if (normText(t.text).includes(q)) push({ kind: 'task', icon: 'task', color: '#6E9E5F', title: t.text, sub: 'Tâche' + (t.who ? ' · ' + mname(t.who) : ''), screen: 'taches', id: t.id });
    for (const e of d.events) if (normText(e.title).includes(q)) push({ kind: 'event', icon: 'calendar', color: '#4E93B8', title: e.title, sub: 'Événement · ' + e.date, screen: 'calendar', id: e.id });
    for (const s of d.shop) if (normText(s.name).includes(q)) push({ kind: 'shop', icon: 'panier', color: '#E08D3C', title: s.name, sub: 'Course' + (s.qty ? ' · ' + s.qty : ''), screen: 'courses', id: s.id });
    for (const r of d.recipes) if (normText(r.name).includes(q)) push({ kind: 'recipe', icon: 'recettes', color: r.color || '#C6492F', title: r.name, sub: 'Recette', screen: 'recettes', id: r.id });
    for (const f of d.files) if (normText(f.name).includes(q)) push({ kind: 'file', icon: 'documents', color: '#9B6FA8', title: f.name, sub: 'Document', screen: 'documents', id: f.id });
    for (const m of d.members) if (normText(`${m.name} ${m.role}`).includes(q)) push({ kind: 'member', icon: 'users', color: m.color, title: m.name, sub: m.role || 'Membre', screen: 'settings', id: m.id });
    for (const msg of d.msgs) if (normText(msg.text).includes(q)) push({ kind: 'message', icon: 'messages', color: '#4E93B8', title: msg.text, sub: 'Message' + (msg.who ? ' · ' + mname(msg.who) : ''), screen: 'messages' });
    return hits.slice(0, 40);
  });

  /** Navigate to a search hit and open its detail where possible. */
  openHit(h: SearchHit): void {
    this.closeSearch();
    this.go(h.screen);
    if (!h.id) return;
    switch (h.kind) {
      case 'contact': this.editContact(h.id); break;
      case 'task': this.editTaskItem(h.id); break;
      case 'event': this.editEvent(h.id); break;
      case 'shop': this.editShop(h.id); break;
      case 'recipe': this.patch({ openRecipeId: h.id }); break;
      case 'member': this.openFamily(); break;
      default: break;
    }
  }

  // ---- events -----------------------------------------------------------
  eventsForDay(ds: string): HouseholdState['events'] {
    return (this._data()?.events || []).filter((e) => occursOn(e, ds)).slice().sort((a, b) => a.time.localeCompare(b.time));
  }
  openEvent(): void {
    const m = parseInt(this.ui().selDay.slice(5, 7), 10) - 7;
    this.patch({ showEvent: true, evEditId: null, evTitle: '', evTime: '', evWho: this.members()[0]?.id || 'cam', evRecur: 'none', evEnd: '', evStart: this.ui().selDay, evPickStart: true, dpMonth: m });
  }
  editEvent(id: string): void {
    const ev = this._data()?.events.find((e) => e.id === id);
    if (!ev) return;
    const m = parseInt(ev.date.slice(5, 7), 10) - 7;
    this.patch({ showEvent: true, evEditId: id, evTitle: ev.title, evTime: ev.time === '—' ? '' : ev.time, evWho: ev.who, evRecur: ev.recur || 'none', evStart: ev.date, evEnd: ev.end || '', evPickStart: true, dpMonth: m });
  }
  dpPick(ds: string): void {
    const s = this.ui();
    if (s.evPickStart || (s.evStart && s.evEnd)) this.patch({ evStart: ds, evEnd: '', evPickStart: false });
    else if (ds < s.evStart) this.patch({ evStart: ds, evEnd: '' });
    else if (ds === s.evStart) this.patch({ evEnd: '' });
    else this.patch({ evEnd: ds });
  }
  saveEvent(): void {
    const s = this.ui();
    const t = s.evTitle.trim(); if (!t) { this.toast('Donne un titre à l’événement'); return; }
    const time = s.evTime.trim() || '—';
    this.mutate((d) => {
      if (s.evEditId) {
        const i = d.events.findIndex((e) => e.id === s.evEditId);
        if (i >= 0) d.events[i] = { ...d.events[i], date: s.evStart, title: t, time, who: s.evWho, recur: s.evRecur, end: s.evEnd || null };
      } else {
        d.events.push({ id: uid('e'), date: s.evStart, title: t, time, who: s.evWho, recur: s.evRecur, end: s.evEnd || null });
      }
    });
    this.toast(s.evEditId ? 'Événement modifié' : 'Événement ajouté à l’agenda');
    this.patch({ showEvent: false, evEditId: null });
  }
  delEvent(): void {
    const id = this.ui().evEditId; if (!id) return;
    this.mutate((d) => { d.events = d.events.filter((e) => e.id !== id); });
    this.patch({ showEvent: false, evEditId: null });
    this.toast('Événement supprimé');
  }

  // ---- articles de courses ------------------------------------------------
  // Toutes ces méthodes passent par `pushShopOps` : rien de la liste ne part
  // dans l'enregistrement du document complet.

  /** Un tap : à prendre ou dans le panier. Sans confirmation, c'est le geste du magasin. */
  toggleShop(id: string): void {
    const it = this._data()?.shop.find((x) => x.id === id); if (!it) return;
    this.setShopState(id, it.state === 'panier' ? 'a-prendre' : 'panier');
  }
  setShopState(id: string, state: ShopState): void { this.pushShopOps([{ op: 'set-state', id, state }]); }

  addShopQuick(): void {
    const t = this.ui().newShop.trim(); if (!t) return;
    const listId = this.activeShopListId(); if (!listId) { this.toast('Créez d’abord une liste'); return; }
    this.pushShopOps([{ op: 'add', id: uid('s'), name: t, qty: '', aisleId: this.defaultAisleId(), listId }]);
    this.patch({ newShop: '' });
  }
  activeShopListId(): string {
    const s = this.ui();
    return s.activeShopList !== 'all' ? s.activeShopList : (this._data()?.shopLists[0]?.id || '');
  }
  /** Rayon de repli d'un article saisi à la volée : « À trier », créé au besoin. */
  defaultAisleId(): string {
    const aisles = this._data()?.aisles || [];
    return (aisles.find((a) => a.name === 'À trier') || aisles[aisles.length - 1] || aisles[0])?.id || '';
  }
  openShop(): void {
    this.patch({ showShop: true, shEditId: null, shTitle: '', shQty: '', shState: 'a-prendre', shAisleId: this.defaultAisleId(), shListId: this.activeShopListId() });
  }
  editShop(id: string): void {
    const it = this._data()?.shop.find((x) => x.id === id); if (!it) return;
    this.patch({ showShop: true, shEditId: id, shTitle: it.name, shQty: it.qty, shState: it.state, shAisleId: it.aisleId, shListId: it.listId || this.activeShopListId() });
  }
  saveShop(): void {
    const s = this.ui(); const name = s.shTitle.trim(); if (!name) { this.toast('Donne un nom à l’article'); return; }
    const qty = s.shQty.trim();
    if (s.shEditId) {
      const before = this._data()?.shop.find((x) => x.id === s.shEditId);
      const ops: ShopOpDraft[] = [{ op: 'edit', id: s.shEditId, name, qty, aisleId: s.shAisleId, listId: s.shListId }];
      // L'état est une opération distincte : elle porte qui l'a posé et quand,
      // ce qu'une simple édition de champs ne dit pas.
      if (before && before.state !== s.shState) ops.push({ op: 'set-state', id: s.shEditId, state: s.shState });
      this.pushShopOps(ops);
    } else {
      this.pushShopOps([{ op: 'add', id: uid('s'), name, qty, aisleId: s.shAisleId, listId: s.shListId }]);
    }
    this.toast(s.shEditId ? 'Article modifié' : 'Article ajouté');
    this.patch({ showShop: false, shEditId: null });
  }
  delShop(): void {
    const id = this.ui().shEditId; if (!id) return;
    this.pushShopOps([{ op: 'remove', id }]);
    this.patch({ showShop: false, shEditId: null });
    this.toast('Article supprimé');
  }
  /** Vide les articles déjà pris d'une liste, une fois les courses rangées. */
  clearPicked(listId: string): void {
    const done = (this._data()?.shop || []).filter((i) => i.listId === listId && i.state !== 'a-prendre');
    if (!done.length) { this.toast('Rien à retirer'); return; }
    this.pushShopOps(done.map((i) => ({ op: 'remove' as const, id: i.id })));
    this.toast(done.length + (done.length > 1 ? ' articles retirés' : ' article retiré'));
  }

  // ---- shopping lists ---------------------------------------------------
  newShopList(): void { this.patch({ shopListForm: true, clEditId: null, clName: '', clColor: '#7A9B76', clIcon: 'panier' }); }
  editShopList(id: string): void { const l = this._data()?.shopLists.find((x) => x.id === id); if (!l) return; this.patch({ shopListForm: true, clEditId: id, clName: l.name, clColor: l.color, clIcon: l.icon || 'panier' }); }
  saveShopList(): void {
    const s = this.ui(); const name = s.clName.trim(); if (!name) { this.toast('Donne un nom à la liste'); return; }
    if (s.clEditId) { this.mutate((d) => { const i = d.shopLists.findIndex((l) => l.id === s.clEditId); if (i >= 0) d.shopLists[i] = { ...d.shopLists[i], name, color: s.clColor, icon: s.clIcon }; }); this.toast('Liste modifiée'); this.patch({ shopListForm: false, clEditId: null }); }
    else { const id = uid('cl'); this.mutate((d) => { d.shopLists.push({ id, name, color: s.clColor, icon: s.clIcon }); }); this.patch({ shopListForm: false, activeShopList: id }); this.toast('Liste de courses créée'); }
  }
  confirmShopListDel(): void {
    const id = this.ui().shopListDelId; if (!id) return;
    // Les listes s'éditent par le document complet ; le serveur retire lui-même
    // les articles orphelins (voir shopping/repo.ts, reconcile). La copie locale
    // fait de même pour que l'écran ne montre pas des articles déjà partis.
    this.mutate((d) => { d.shopLists = d.shopLists.filter((l) => l.id !== id); d.shop = d.shop.filter((x) => x.listId !== id); });
    this.patch({ shopListDelId: null, activeShopList: this.ui().activeShopList === id ? 'all' : this.ui().activeShopList });
    this.toast('Liste supprimée');
  }

  // ---- rayons -------------------------------------------------------------
  aislesInOrder(): HouseholdState['aisles'] { return (this._data()?.aisles || []).slice().sort((a, b) => a.position - b.position); }
  newAisle(): void { this.patch({ aiForm: true, aiEditId: null, aiName: '', aiColor: '#7A9B76', aiKind: '' }); }
  editAisle(id: string): void { const a = this._data()?.aisles.find((x) => x.id === id); if (!a) return; this.patch({ aiForm: true, aiEditId: id, aiName: a.name, aiColor: a.color, aiKind: a.kind || '' }); }
  saveAisle(): void {
    const s = this.ui(); const name = s.aiName.trim(); if (!name) { this.toast('Donne un nom au rayon'); return; }
    if (s.aiEditId) {
      // Les articles désignent le rayon par son identifiant : renommer ne demande
      // plus de rattraper quoi que ce soit dans la liste.
      this.mutate((d) => { const i = d.aisles.findIndex((a) => a.id === s.aiEditId); if (i >= 0) d.aisles[i] = { ...d.aisles[i], name, color: s.aiColor, kind: s.aiKind || null }; });
      this.toast('Rayon modifié');
    } else {
      this.mutate((d) => { d.aisles.push({ id: uid('a'), name, color: s.aiColor, position: d.aisles.length, ...(s.aiKind ? { kind: s.aiKind } : {}) }); });
      this.toast('Rayon ajouté');
    }
    this.patch({ aiForm: false, aiEditId: null });
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
  confirmAisleDel(): void {
    const id = this.ui().aisleDelId; if (!id) return;
    const fallback = this.defaultAisleId();
    if (id === fallback) { this.patch({ aisleDelId: null }); this.toast('« À trier » sert de rayon de repli, il ne peut pas être supprimé'); return; }
    this.mutate((d) => {
      d.aisles = d.aisles.filter((x) => x.id !== id);
      d.aisles.forEach((a, i) => { a.position = i; });
      d.shop.forEach((x) => { if (x.aisleId === id) x.aisleId = fallback; });
    });
    this.patch({ aisleDelId: null });
    this.toast('Rayon supprimé');
  }

  // ---- tasks ------------------------------------------------------------
  toggleTask(id: string): void { this.mutate((d) => { const t = d.tasks.find((x) => x.id === id); if (t) t.done = !t.done; }); }
  activeTaskListId(): string { const s = this.ui(); return s.activeList !== 'all' ? s.activeList : (this._data()?.taskLists[0]?.id || ''); }
  addTaskQuick(): void {
    const t = this.ui().newTask.trim(); if (!t) return; const lid = this.activeTaskListId();
    this.mutate((d) => { d.tasks.unshift({ id: uid('t'), text: t, who: this.members()[0]?.id || 'cam', due: "Aujourd'hui", done: false, listId: lid, prio: 'med' }); });
    this.patch({ newTask: '' });
  }
  /**
   * Tâche créée depuis un autre module. C'est une **copie ponctuelle**, assumée :
   * si la date du contrat bouge ensuite, la tâche ne suit pas. Une tâche que
   * l'utilisateur peut cocher, déplacer et supprimer doit lui appartenir, pas
   * réapparaître parce qu'une table dit autre chose.
   */
  addExternalTask(text: string, plannedOn: string, memberId: string | null = null): string | null {
    const listId = this.activeTaskListId();
    if (!listId) { this.toast('Créez d’abord une liste de tâches'); return null; }
    const id = uid('t');
    this.mutate((d) => {
      d.tasks.unshift({
        id, text, who: memberId || this.members()[0]?.id || 'cam',
        due: this.fmtNumDate(plannedOn), done: false, listId, prio: 'high', planned: plannedOn,
      });
    });
    this.toast('Tâche ajoutée');
    return id;
  }

  openTask(): void { this.patch({ showTask: true, taskEditId: null, tTitle: '', tWho: this.members()[0]?.id || 'cam', tDue: "Aujourd'hui", tPrio: 'med', tListId: this.activeTaskListId(), tPlanned: '' }); }
  editTaskItem(id: string): void { const t = this._data()?.tasks.find((x) => x.id === id); if (!t) return; this.patch({ showTask: true, taskEditId: id, tTitle: t.text, tWho: t.who, tDue: t.due, tPrio: t.prio || 'med', tListId: t.listId, tPlanned: t.planned || '' }); }
  saveTask(): void {
    const s = this.ui(); const t = s.tTitle.trim(); if (!t) { this.toast('Donne un intitulé à la tâche'); return; }
    const planned = s.tPlanned || null;
    this.mutate((d) => {
      if (s.taskEditId) { const i = d.tasks.findIndex((x) => x.id === s.taskEditId); if (i >= 0) d.tasks[i] = { ...d.tasks[i], text: t, who: s.tWho, due: s.tDue, prio: s.tPrio, listId: s.tListId, planned }; }
      else d.tasks.unshift({ id: uid('t'), text: t, who: s.tWho, due: s.tDue, done: false, prio: s.tPrio, listId: s.tListId, planned });
    });
    this.toast(s.taskEditId ? 'Tâche modifiée' : 'Tâche ajoutée');
    this.patch({ showTask: false, taskEditId: null });
  }
  delTask(): void { const id = this.ui().taskEditId; if (!id) return; this.mutate((d) => { d.tasks = d.tasks.filter((x) => x.id !== id); }); this.patch({ showTask: false, taskEditId: null }); this.toast('Tâche supprimée'); }
  newTaskList(): void { this.patch({ listForm: true, listEditId: null, lName: '', lColor: '#E56B4E', lIcon: 'checklist' }); }
  editTaskList(id: string): void { const l = this._data()?.taskLists.find((x) => x.id === id); if (!l) return; this.patch({ listForm: true, listEditId: id, lName: l.name, lColor: l.color, lIcon: l.icon || 'checklist' }); }
  saveTaskList(): void {
    const s = this.ui(); const name = s.lName.trim(); if (!name) { this.toast('Donne un nom à la liste'); return; }
    if (s.listEditId) { this.mutate((d) => { const i = d.taskLists.findIndex((l) => l.id === s.listEditId); if (i >= 0) d.taskLists[i] = { ...d.taskLists[i], name, color: s.lColor, icon: s.lIcon }; }); this.toast('Liste modifiée'); this.patch({ listForm: false, listEditId: null }); }
    else { const id = uid('l'); this.mutate((d) => { d.taskLists.push({ id, name, color: s.lColor, icon: s.lIcon }); }); this.patch({ listForm: false, activeList: id }); this.toast('Liste créée'); }
  }
  confirmTaskListDel(): void {
    const id = this.ui().listDelId; if (!id) return;
    this.mutate((d) => { d.taskLists = d.taskLists.filter((l) => l.id !== id); d.tasks = d.tasks.filter((t) => t.listId !== id); });
    this.patch({ listDelId: null, activeList: this.ui().activeList === id ? 'all' : this.ui().activeList });
    this.toast('Liste supprimée');
  }

  // ---- messages ---------------------------------------------------------
  sendMsg(): void {
    const t = this.ui().newMsg.trim(); if (!t) return;
    const me = this.currentMemberId() || this._data()?.profile.memberId || this.members()[0]?.id || 'cam';
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    this.mutate((d) => { d.msgs.push({ who: me, text: t, time }); });
    this.patch({ newMsg: '' });
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

  // ---- documents --------------------------------------------------------
  newFolder(): void { this.patch({ folderForm: true, foEditId: null, foName: '', foColor: '#E56B4E' }); }
  editFolder(id: string): void { const f = this._data()?.folders.find((x) => x.id === id); if (!f) return; this.patch({ folderForm: true, foEditId: id, foName: f.name, foColor: f.color }); }
  saveFolder(): void {
    const s = this.ui(); const name = s.foName.trim(); if (!name) { this.toast('Donne un nom au dossier'); return; }
    this.mutate((d) => {
      if (s.foEditId) { const i = d.folders.findIndex((f) => f.id === s.foEditId); if (i >= 0) d.folders[i] = { ...d.folders[i], name, color: s.foColor }; }
      else d.folders.push({ id: uid('f'), name, color: s.foColor });
    });
    this.toast(s.foEditId ? 'Dossier modifié' : 'Dossier créé');
    this.patch({ folderForm: false, foEditId: null });
  }
  confirmFolderDel(): void {
    const id = this.ui().folderDelId; if (!id) return;
    this.mutate((d) => { d.folders = d.folders.filter((f) => f.id !== id); d.files = d.files.filter((fl) => fl.folderId !== id); });
    this.patch({ folderDelId: null, docFolder: this.ui().docFolder === id ? null : this.ui().docFolder });
    this.toast('Dossier supprimé');
  }
  newFile(): void { const fld = this.ui().docFolder || this._data()?.folders[0]?.id || null; this.patch({ fileForm: true, fiEditId: null, fiName: '', fiFolderId: fld, fiType: 'PDF', fiData: null }); }
  editFile(id: string): void { const f = this._data()?.files.find((x) => x.id === id); if (!f) return; this.patch({ fileForm: true, fiEditId: id, fiName: f.name, fiFolderId: f.folderId, fiType: f.type, fiData: f.data || null }); }
  onFileUpload(file: File): void {
    const type = fileTypeOf(file.name);
    const rd = new FileReader();
    rd.onload = (ev) => this.patch({ fiName: this.ui().fiName.trim() || file.name, fiType: type, fiData: ev.target?.result as string });
    rd.readAsDataURL(file);
    this.patch({ fiName: this.ui().fiName.trim() || file.name, fiType: type });
  }
  saveFile(): void {
    const s = this.ui(); const name = s.fiName.trim(); if (!name) { this.toast('Donne un nom au fichier'); return; } if (!s.fiFolderId) { this.toast('Choisis un dossier'); return; }
    const now = new Date(); const date = now.getDate() + ' ' + ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][now.getMonth()] + ' ' + now.getFullYear();
    this.mutate((d) => {
      if (s.fiEditId) { const i = d.files.findIndex((f) => f.id === s.fiEditId); if (i >= 0) d.files[i] = { ...d.files[i], name, folderId: s.fiFolderId!, type: s.fiType, data: s.fiData || null }; }
      else d.files.unshift({ id: uid('d'), name, folderId: s.fiFolderId!, type: s.fiType, data: s.fiData || null, date });
    });
    this.toast(s.fiEditId ? 'Fichier modifié' : 'Fichier ajouté');
    this.patch({ fileForm: false, fiEditId: null });
  }
  confirmFileDel(): void { const id = this.ui().fileDelId; if (!id) return; this.mutate((d) => { d.files = d.files.filter((f) => f.id !== id); }); this.patch({ fileDelId: null }); this.toast('Fichier supprimé'); }

  // ---- meals ------------------------------------------------------------
  // Un créneau porte plusieurs plats, dans l'ordre du service : une entrée, un
  // plat, un dessert se choisissent séparément. Pas d'étiquette imposée, l'ordre
  // suffit et une taxonomie fixe (entrée/plat/dessert) laisserait dehors l'apéro,
  // le fromage et l'accompagnement.

  /** Intitulé d'un plat : le nom de la recette, ou le texte saisi. */
  mealItemName(it: MealItem): string {
    if (it.rid) { const r = this._data()?.recipes.find((x) => x.id === it.rid); return r ? r.name : 'Recette supprimée'; }
    return it.text || '';
  }
  /** Intitulés d'un créneau, dans l'ordre. Vide quand rien n'est prévu. */
  mealNames(v?: MealValue): string[] {
    return (v?.items || []).map((it) => this.mealItemName(it)).filter(Boolean);
  }
  /** Une ligne pour les vignettes et l'accueil : « Salade · Gratin · Tiramisu ». */
  mealLabel(v?: MealValue): string | null {
    const names = this.mealNames(v);
    return names.length ? names.join(' · ') : null;
  }

  editMeal(dateStr: string, slot: string): void {
    const v = this._data()?.meals[dateStr + '-' + slot];
    this.patch({
      mealEdit: { dateStr, slot }, mealItems: (v?.items || []).map((i) => ({ ...i })), mealText: '',
      mealPax: v?.pax ? String(v.pax) : '',
    });
  }
  /** Un tap sur une recette l'ajoute au menu, un second l'en retire. */
  toggleMealRecipe(rid: string): void {
    const items = this.ui().mealItems;
    const i = items.findIndex((x) => x.rid === rid);
    this.patch({ mealItems: i >= 0 ? items.filter((_, k) => k !== i) : [...items, { rid }] });
  }
  isMealRecipe(rid: string): boolean { return this.ui().mealItems.some((x) => x.rid === rid); }
  addMealText(): void {
    const t = this.ui().mealText.trim(); if (!t) return;
    this.patch({ mealItems: [...this.ui().mealItems, { text: t }], mealText: '' });
  }
  removeMealItem(index: number): void {
    this.patch({ mealItems: this.ui().mealItems.filter((_, i) => i !== index) });
  }
  /**
   * Le repas tel que la modale le décrit. Les couverts ne sont enregistrés que
   * s'ils dérogent à la taille du foyer : un chiffre recopié partout se
   * périmerait au premier changement de famille.
   */
  private mealFromForm(): MealValue {
    const pax = parseInt(this.ui().mealPax, 10);
    return {
      items: this.ui().mealItems,
      ...(Number.isFinite(pax) && pax > 0 && pax !== this.householdPax() ? { pax } : {}),
    };
  }

  saveMeal(): void {
    const e = this.ui().mealEdit; if (!e) return;
    const value = this.mealFromForm();
    if (!value.items.length) { this.toast('Choisis au moins un plat'); return; }
    const key = e.dateStr + '-' + e.slot;
    this.mutate((d) => { d.meals[key] = value; });
    this.patch({ mealEdit: null });
    this.toast(value.items.length > 1 ? value.items.length + ' plats enregistrés' : 'Repas enregistré');
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
    this.mutate((dd) => {
      dd.tasks.unshift({
        id: uid('t'), text: intitule, who: this.me()?.id || this.members()[0]?.id || '',
        due: "Aujourd'hui", done: false, listId: taskList, prio: 'med', planned: null, shopListId: listId,
      });
    });
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
  addMealToCalendar(): void {
    const e = this.ui().mealEdit; if (!e) return;
    const value = this.mealFromForm();
    if (!value.items.length) { this.toast('Choisis au moins un plat'); return; }
    const slot = MEAL_SLOTS.find((s) => s.key === e.slot);
    const titre = mealEventTitle(slot?.label || '', value.items.map((it) => this.mealItemName(it)), value.pax);
    const key = e.dateStr + '-' + e.slot;
    const existant = this.mealEvent(key);
    this.mutate((d) => {
      d.meals[key] = value;
      if (existant) {
        const i = d.events.findIndex((x) => x.id === existant.id);
        if (i >= 0) d.events[i] = { ...d.events[i], date: e.dateStr, title: titre, time: slot?.at || '—' };
      } else {
        d.events.push({
          id: uid('e'), date: e.dateStr, title: titre, time: slot?.at || '—',
          who: this.me()?.id || this.members()[0]?.id || '', recur: 'none', end: null, mealKey: key,
        });
      }
    });
    this.patch({ mealEdit: null });
    this.toast(existant ? 'Repas enregistré, événement mis à jour' : 'Repas enregistré et ajouté à l’agenda');
  }

  clearMeal(): void {
    const e = this.ui().mealEdit; if (!e) return;
    const key = e.dateStr + '-' + e.slot;
    // L'événement qui venait de ce repas part avec lui : garder un dîner annulé
    // à l'agenda serait pire que de ne l'y avoir jamais mis.
    const avaitEvenement = !!this.mealEvent(key);
    this.mutate((d) => { delete d.meals[key]; d.events = d.events.filter((x) => x.mealKey !== key); });
    this.patch({ mealEdit: null });
    this.toast(avaitEvenement ? 'Repas retiré, et son événement d’agenda' : 'Repas retiré');
  }
  /** Couverts par défaut : tout le foyer, sauf dérogation posée sur le créneau. */
  householdPax(): number { return Math.max(this._data()?.members.length || 0, 1); }

  /** Référentiel d'articles, base intégrée plus les corrections du foyer. */
  readonly articleIndex = computed(() => buildArticleIndex(this._data()?.articles || []));

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
    const slots = days.flatMap((ds) =>
      this.mealSlots().map((sl) => d.meals[ds + '-' + sl.key]).filter((v): v is MealValue => !!v?.items?.length));
    if (!slots.length) { this.toast('Aucun repas planifié sur cette période'); return; }
    this.genReport.set(buildPlan({
      slots: slots.map((value) => ({ value })),
      recipes: d.recipes, aisles: d.aisles, articles: d.articles, index: this.articleIndex(),
      existing: d.shop.filter((i) => i.listId === listId),
      fallbackAisle: this.defaultAisleId(), defaultPax: this.householdPax(),
    }));
    this.genPantry.set(new Set());
    this.patch({ genOpen: true });
  }

  togglePantryPick(name: string): void {
    const s = new Set(this.genPantry());
    if (!s.delete(name)) s.add(name);
    this.genPantry.set(s);
  }
  isPantryPicked(name: string): boolean { return this.genPantry().has(name); }

  /**
   * Applique le rapport. Ce qui a été ajouté à la main, coché ou marqué
   * introuvable n'est jamais touché : la régénération ne défait que son propre
   * ouvrage, c'est ce qui la rend rejouable sans crainte en cours de semaine.
   */
  applyList(): void {
    const rep = this.genReport(); const listId = this.activeShopListId();
    if (!rep || !listId) return;
    const ops: ShopOpDraft[] = [];
    const ajout = [...rep.add, ...rep.pantry.filter((l) => this.genPantry().has(l.name))];
    for (const l of ajout) {
      ops.push({ op: 'add', id: uid('g'), name: l.name, qty: l.qty, aisleId: l.aisleId, listId, gen: true, ...(l.art ? { art: l.art } : {}) });
    }
    for (const u of rep.update) ops.push({ op: 'edit', id: u.item.id, qty: u.line.qty, aisleId: u.line.aisleId });
    for (const r of rep.remove) ops.push({ op: 'remove', id: r.id });
    if (ops.length) this.pushShopOps(ops);
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
  // L'identifiant est tiré à l'ouverture du formulaire, avant l'enregistrement :
  // une photo a besoin d'un propriétaire pour être rangée, y compris sur une
  // recette qui n'existe pas encore.
  newRecipe(): void {
    this.patch({
      recipeForm: true, editingId: null, fRecipeId: uid('r'),
      fName: '', fLevel: 'Facile', fColor: '#7A9B76', fPhotoId: null, fPhotoBusy: false,
      fPortions: '', fPrepMin: '', fCookMin: '', fSource: '',
      fImportUrl: '', fImportBusy: false, fImportWarnings: [],
      fIngr: [{ id: uid('i'), val: '' }], fSteps: [{ id: uid('p'), val: '' }],
    });
  }
  editRecipe(id: string): void {
    const r = this._data()?.recipes.find((x) => x.id === id); if (!r) return;
    this.patch({
      recipeForm: true, editingId: id, fRecipeId: id, openRecipeId: null,
      fName: r.name, fLevel: r.level, fColor: r.color, fPhotoId: r.photoId ?? null, fPhotoBusy: false,
      fPortions: num(r.portions), fPrepMin: num(r.prepMin), fCookMin: num(r.cookMin), fSource: r.source || '',
      fImportUrl: '', fImportBusy: false, fImportWarnings: [],
      fIngr: r.ingr.map((v) => ({ id: uid('i'), val: v })), fSteps: r.steps.map((v) => ({ id: uid('p'), val: v })),
    });
  }

  /**
   * Remplit le formulaire depuis une page de recette. Le serveur fait l'appel
   * sortant et la lecture (voir backend/src/recipes) ; ici on ne fait que poser
   * le résultat dans les champs, que l'utilisateur relit avant d'enregistrer.
   * C'est cette relecture qui tient lieu d'écran de reprise manuelle.
   */
  async importRecipe(): Promise<void> {
    const s = this.ui();
    const url = s.fImportUrl.trim();
    if (!url) { this.toast('Collez l’adresse de la recette'); return; }
    this.patch({ fImportBusy: true, fImportWarnings: [] });
    try {
      const res = await this.api.importRecipe(url, s.fRecipeId);
      const r = res.recipe;
      if (res.photoId) this.photoUrls.update((m) => { const c = { ...m }; delete c[res.photoId!]; return c; });
      this.patch({
        fName: r.name,
        fPortions: num(r.portions), fPrepMin: num(r.prepMin), fCookMin: num(r.cookMin),
        fSource: r.source,
        // Un import ne doit pas effacer ce qui a déjà été saisi à la main : les
        // listes vides du formulaire neuf sont remplacées, une saisie ne l'est
        // que si la page a effectivement quelque chose à mettre à la place.
        fIngr: r.ingr.length ? r.ingr.map((v) => ({ id: uid('i'), val: v })) : s.fIngr,
        fSteps: r.steps.length ? r.steps.map((v) => ({ id: uid('p'), val: v })) : s.fSteps,
        ...(res.photoId ? { fPhotoId: res.photoId } : {}),
        fImportWarnings: res.warnings,
        fImportUrl: '',
      });
      this.toast('Recette importée, relisez-la avant d’enregistrer');
    } catch (e) {
      // Le message du serveur dit quoi faire : le relayer tel quel.
      this.patch({ fImportWarnings: [(e as Error).message] });
    } finally {
      this.patch({ fImportBusy: false });
    }
  }

  /** Durée totale d'une recette, pour les vignettes et l'accueil. */
  recipeTime(r: { prepMin?: number | null; cookMin?: number | null }): string {
    const total = (r.prepMin || 0) + (r.cookMin || 0);
    if (!total) return '—';
    return total < 60 ? total + ' min' : Math.floor(total / 60) + ' h' + (total % 60 ? ' ' + (total % 60) : '');
  }
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
    const editing = this.ui().fPhotoId;
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
  async onRecipePhoto(file: File): Promise<void> {
    const ownerId = this.ui().fRecipeId; if (!ownerId) return;
    this.patch({ fPhotoBusy: true });
    try {
      const res = await this.api.uploadFile('recipe', ownerId, file);
      this.cachePhoto(res.file.id, file);
      this.patch({ fPhotoId: res.file.id });
    } catch (e) {
      // Le message du serveur nomme le format attendu : le relayer tel quel vaut
      // mieux qu'un « échec » qui ne dit pas quoi faire.
      this.toast((e as Error).message);
    } finally {
      this.patch({ fPhotoBusy: false });
    }
  }
  addIngr(): void { this.patch({ fIngr: [...this.ui().fIngr, { id: uid('i'), val: '' }] }); }
  addStep(): void { this.patch({ fSteps: [...this.ui().fSteps, { id: uid('p'), val: '' }] }); }
  setIngr(id: string, val: string): void { this.patch({ fIngr: this.ui().fIngr.map((x) => (x.id === id ? { ...x, val } : x)) }); }
  removeIngr(id: string): void { this.patch({ fIngr: this.ui().fIngr.filter((x) => x.id !== id) }); }
  setStep(id: string, val: string): void { this.patch({ fSteps: this.ui().fSteps.map((x) => (x.id === id ? { ...x, val } : x)) }); }
  removeStep(id: string): void { this.patch({ fSteps: this.ui().fSteps.filter((x) => x.id !== id) }); }
  saveRecipe(): void {
    const s = this.ui(); const name = s.fName.trim(); if (!name) { this.toast('Donne un nom à la recette'); return; }
    const ingr = s.fIngr.map((x) => x.val.trim()).filter(Boolean);
    const steps = s.fSteps.map((x) => x.val.trim()).filter(Boolean);
    const int = (v: string): number | null => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };
    const data = {
      name, level: s.fLevel, color: s.fColor, photoId: s.fPhotoId,
      portions: int(s.fPortions), prepMin: int(s.fPrepMin), cookMin: int(s.fCookMin),
      source: s.fSource.trim() || null,
      ingr, steps,
    };
    this.mutate((d) => {
      if (s.editingId) { const i = d.recipes.findIndex((r) => r.id === s.editingId); if (i >= 0) d.recipes[i] = { ...d.recipes[i], ...data }; }
      else d.recipes.unshift({ id: s.fRecipeId || uid('r'), ...data });
    });
    this.toast(s.editingId ? 'Recette modifiée' : 'Recette ajoutée au carnet');
    this.patch({ recipeForm: false, editingId: null });
  }
  confirmRecipeDel(): void { const id = this.ui().confirmDelId; if (!id) return; this.mutate((d) => { d.recipes = d.recipes.filter((r) => r.id !== id); }); this.patch({ confirmDelId: null, openRecipeId: this.ui().openRecipeId === id ? null : this.ui().openRecipeId }); this.toast('Recette supprimée'); }

  // ---- planning ---------------------------------------------------------
  newSlot(day: string): void { this.patch({ screen: 'planning', schedEdit: true, seEditId: null, seDay: day || SCHED_DAYS[0], seStart: '', seEnd: '', seLabel: '', seType: 'ecole', addMenuOpen: false }); }
  editSlot(id: string): void { const it = this._data()?.sched.find((x) => x.id === id); if (!it) return; this.patch({ schedEdit: true, seEditId: id, seDay: it.day, seStart: it.start || '', seEnd: it.end || '', seLabel: it.label, seType: it.k }); }
  saveSlot(): void {
    const s = this.ui(); const label = s.seLabel.trim(); if (!label) { this.toast('Donne un intitulé'); return; } const start = s.seStart.trim(); if (!start) { this.toast('Indique une heure de début'); return; }
    const data = { who: s.schedChild, day: s.seDay, start, end: s.seEnd.trim(), label, k: s.seType };
    this.mutate((d) => {
      if (s.seEditId) { const i = d.sched.findIndex((x) => x.id === s.seEditId); if (i >= 0) d.sched[i] = { ...d.sched[i], ...data }; }
      else d.sched.push({ id: uid('s'), ...data });
    });
    this.toast(s.seEditId ? 'Créneau modifié' : 'Créneau ajouté');
    this.patch({ schedEdit: false, seEditId: null });
  }
  delSlot(): void { const id = this.ui().seEditId; if (!id) return; this.mutate((d) => { d.sched = d.sched.filter((x) => x.id !== id); }); this.patch({ schedEdit: false, seEditId: null }); this.toast('Créneau supprimé'); }

  // ---- family & profile -------------------------------------------------
  openFamily(): void { this.patch({ familyOpen: true, famNameField: this._data()?.familyName || '' }); }
  saveFamily(): void { const n = this.ui().famNameField.trim(); if (!n) { this.toast('Donne un nom au foyer'); return; } this.mutate((d) => { d.familyName = n; }); this.patch({ familyOpen: false }); this.toast('Foyer mis à jour'); }
  newMember(): void { this.patch({ memberForm: true, mfEditId: null, mfName: '', mfRole: '', mfEmail: '', mfColor: '#9B6FA8', mfAdmin: false, mfBirthday: '' }); }
  editMember(id: string): void { const m = this._data()?.members.find((x) => x.id === id); if (!m) return; this.patch({ memberForm: true, mfEditId: id, mfName: m.name, mfRole: m.role, mfEmail: m.email || '', mfColor: m.color, mfAdmin: !!m.admin, mfBirthday: m.birthday || '' }); }
  saveMember(): void {
    const s = this.ui(); const name = s.mfName.trim(); if (!name) { this.toast('Donne un prénom'); return; } const ini = contactIni(name);
    const data = { name, role: s.mfRole.trim(), email: s.mfEmail.trim(), color: s.mfColor, admin: s.mfAdmin, ini, birthday: s.mfBirthday || null };
    this.mutate((d) => {
      if (s.mfEditId) { const i = d.members.findIndex((m) => m.id === s.mfEditId); if (i >= 0) d.members[i] = { ...d.members[i], ...data }; }
      else d.members.push({ id: uid('mb'), ...data });
    });
    this.toast(s.mfEditId ? 'Membre modifié' : 'Membre ajouté');
    this.patch({ memberForm: false, mfEditId: null });
  }
  confirmMemberDel(): void {
    const id = this.ui().memberDelId; if (!id) return;
    const hadAccount = this.memberHasAccount(id);
    this.mutate((d) => { d.members = d.members.filter((m) => m.id !== id); });
    const sc = this.ui().schedChild === id ? (this._data()?.members[0]?.id || 'cam') : this.ui().schedChild;
    this.patch({ memberDelId: null, schedChild: sc });
    if (hadAccount) {
      this.flush().then(() => this.api.deleteMemberAccount(id)).then(() => this.refreshAccounts()).catch(() => { /* ignore */ });
    }
    this.toast('Membre retiré');
  }
  openProfile(): void {
    const m = this.me();
    this.patch({ profileOpen: true, pfTab: 'infos', pfName: m?.name || '', pfRole: m?.role || '', pfEmail: m ? this.memberAccountEmail(m.id) : '', pfColor: m?.color || '#E56B4E' });
  }
  saveProfile(): void {
    const s = this.ui(); if (!s.pfName.trim()) { this.toast('Le prénom est requis'); return; }
    const id = this.me()?.id;
    this.mutate((d) => {
      const mi = d.members.findIndex((m) => m.id === id);
      if (mi >= 0) d.members[mi] = { ...d.members[mi], name: s.pfName.trim(), role: s.pfRole.trim(), color: s.pfColor, ini: contactIni(s.pfName.trim()) };
      // Keep the stored admin profile in sync only when the admin edits their own member.
      if (id === d.profile.memberId) d.profile = { ...d.profile, name: s.pfName.trim(), role: s.pfRole.trim(), color: s.pfColor };
    });
    this.patch({ profileOpen: false });
    this.toast('Profil mis à jour');
  }

  // ---- notifications (dérivées de l'état, côté client) ------------------
  /**
   * Notifications poussées par les modules qui ne vivent pas dans ce document
   * (Finances). Évite une dépendance circulaire entre les stores.
   */
  readonly externalNotifs = signal<Notif[]>([]);

  /**
   * Repères de calendrier poussés par les modules qui ne vivent pas dans ce
   * document (échéances de contrat), indexés par date ISO. Comme les
   * notifications, ils sont **calculés** ailleurs et jamais stockés ici : une
   * date de reconduction qui change change son repère, sans copie périmée.
   */
  readonly externalDayExtras = signal<Record<string, DayExtra[]>>({});

  toggleNotif(): void { this.patch({ notifOpen: !this.ui().notifOpen }); }

  /**
   * Notifications utiles calculées à partir de l'état : événements du jour/demain,
   * tâches planifiées à faire ou en retard, anniversaires proches, budgets dépassés.
   * L'affichage est conditionné au réglage « Notifications ».
   */
  readonly notifications = computed<Notif[]>(() => {
    const d = this._data();
    if (!d || !d.settings.prefNotifs) return [];
    const today = this.todayStr();
    const read = this.readNotifs();
    const addDays = (iso: string, n: number): string => { const dt = parseDay(iso); dt.setDate(dt.getDate() + n); return dstr(dt); };
    const tomorrow = addDays(today, 1);
    const mName = (id: string): string => d.members.find((m) => m.id === id)?.name || '';
    const raw: Omit<Notif, 'read'>[] = [];

    // Événements aujourd'hui / demain
    for (const e of this.eventsForDay(today)) raw.push({ id: `ev-${e.id}-${today}`, kind: 'event', title: e.title, desc: (e.time && e.time !== '—' ? e.time + ' · ' : '') + "Aujourd'hui" + (mName(e.who) ? ' · ' + mName(e.who) : ''), time: "Aujourd'hui" });
    for (const e of this.eventsForDay(tomorrow)) raw.push({ id: `ev-${e.id}-${tomorrow}`, kind: 'event', title: e.title, desc: (e.time && e.time !== '—' ? e.time + ' · ' : '') + 'Demain' + (mName(e.who) ? ' · ' + mName(e.who) : ''), time: 'Demain' });

    // Tâches planifiées : à faire aujourd'hui / en retard
    for (const t of d.tasks) {
      if (t.done || !t.planned) continue;
      if (t.planned === today) raw.push({ id: `task-${t.id}-${t.planned}`, kind: 'task', title: t.text, desc: "À faire aujourd'hui" + (t.who ? ' · ' + mName(t.who) : ''), time: "Aujourd'hui" });
      else if (t.planned < today) raw.push({ id: `task-${t.id}-${t.planned}`, kind: 'task', title: t.text, desc: 'En retard (prévue le ' + this.fmtNumDate(t.planned) + ')', time: 'En retard' });
    }

    // Anniversaires : aujourd'hui + 7 jours (membres & contacts)
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

    // Les alertes de budget viennent du module Finances, dont les données vivent
    // dans des tables dédiées et non dans ce document.
    raw.push(...this.externalNotifs());

    return raw.map((n) => ({ ...n, read: read.has(n.id) }));
  });

  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  private persistReadNotifs(s: Set<string>): void { try { localStorage.setItem(READ_NOTIFS_KEY, JSON.stringify([...s])); } catch { /* ignore */ } }
  markAllRead(): void {
    const s = new Set(this.readNotifs());
    this.notifications().forEach((n) => s.add(n.id));
    this.readNotifs.set(s); this.persistReadNotifs(s);
  }
  openNotif(id: string, screen?: string): void {
    const s = new Set(this.readNotifs()); s.add(id);
    this.readNotifs.set(s); this.persistReadNotifs(s);
    this.patch({ notifOpen: false, screen: screen || this.ui().screen });
  }

  // ---- settings ---------------------------------------------------------
  setSetting<K extends keyof HouseholdState['settings']>(key: K, val: HouseholdState['settings'][K]): void {
    this.mutate((d) => { (d.settings as any)[key] = val; });
    if (key === 'academie') this.loadSchoolHolidays();
  }
  exportData(): void {
    const d = this._data(); if (!d) return;
    this.download(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }), 'foyer-export.json');
    this.toast('Export des données lancé');
  }

  // ---- exports du module Cuisine ----------------------------------------

  /** Provoque un téléchargement. Le lien est révoqué : sinon le blob reste en mémoire. */
  private download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    // Différé : Safari n'a pas encore commencé le téléchargement au retour du clic.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

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
      this.download(new Blob([JSON.stringify(bundle)], { type: 'application/json' }), fileName('carnet-de-recettes', 'json'));
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
      this.download(new Blob([texte], { type: 'text/plain;charset=utf-8' }), fileName(r.name, 'txt'));
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
    this.download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), fileName(nom, 'csv'));
    this.toast(items.length + ' articles exportés');
  }

  // ---- add menu picks ---------------------------------------------------
  pickShopFromMenu(): void { this.patch({ addMenuOpen: false, screen: 'courses' }); this.openShop(); }
}
