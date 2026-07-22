import { Injectable, computed, effect, signal } from '@angular/core';
import { ApiService, SetupPayload, UpdateInfo } from './api.service';
import { HouseholdState, Member } from './models';
import { UiState, initialUi, IngrRow } from './ui-state';
import { ageOn, contactIni, dstr, fileTypeOf, frenchHolidays, isBirthdayOn, occursOn, parseAmt, uid, weekDates } from './helpers';
import { CAL_KINDS, LIST_ICONS, MEAL_SLOTS, SCHED_DAYS, tint, grad } from './constants';

export interface DayExtra { kind: string; label: string; color: string; sub?: string; }
export interface SchoolHoliday { name: string; start: string; end: string; zone: string; }

type SaveState = 'idle' | 'saving' | 'error';

@Injectable({ providedIn: 'root' })
export class FoyerStore {
  private _data = signal<HouseholdState | null>(null);
  readonly ui = signal<UiState>(initialUi());

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
  readonly narrow = signal(false);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService) {
    // Theme side effect: reflect settings.dark onto <html>.
    effect(() => {
      const d = this._data();
      const dark = d ? d.settings.dark : false;
      document.documentElement.classList.toggle('dark', dark);
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
    this.loadSchoolHolidays();
    this.loadIcs();
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
    s.settings ||= { lang: 'Français', tz: 'Europe/Paris (GMT+1)', dateFmt: 'JJ/MM/AAAA', weekStart: 'Lundi', currency: 'Euro (€)', dark: false, prefNotifs: true, prefWeekly: true, prefShared: false };
    return s;
  }

  async login(email: string, password: string): Promise<boolean> {
    this.authError.set('');
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

  // ---- shopping items ---------------------------------------------------
  toggleShop(id: string): void { this.mutate((d) => { const it = d.shop.find((x) => x.id === id); if (it) it.done = !it.done; }); }
  addShopQuick(): void {
    const t = this.ui().newShop.trim(); if (!t) return;
    const cl = this.activeShopListId();
    this.mutate((d) => { d.shop.push({ id: uid('s'), name: t, qty: 'x1', cat: 'À trier', done: false, listId: cl }); });
    this.patch({ newShop: '' });
  }
  activeShopListId(): string {
    const s = this.ui();
    return s.activeShopList !== 'all' ? s.activeShopList : (this._data()?.shopLists[0]?.id || '');
  }
  openShop(): void { this.patch({ showShop: true, shEditId: null, shTitle: '', shQty: '', shCat: 'Fruits & légumes', shListId: this.activeShopListId() }); }
  editShop(id: string): void {
    const it = this._data()?.shop.find((x) => x.id === id); if (!it) return;
    this.patch({ showShop: true, shEditId: id, shTitle: it.name, shQty: it.qty, shCat: it.cat, shListId: it.listId || this.activeShopListId() });
  }
  saveShop(): void {
    const s = this.ui(); const t = s.shTitle.trim(); if (!t) { this.toast('Donne un nom à l’article'); return; }
    const qty = s.shQty.trim() || 'x1';
    this.mutate((d) => {
      if (s.shEditId) { const i = d.shop.findIndex((x) => x.id === s.shEditId); if (i >= 0) d.shop[i] = { ...d.shop[i], name: t, qty, cat: s.shCat, listId: s.shListId }; }
      else d.shop.push({ id: uid('s'), name: t, qty, cat: s.shCat, done: false, listId: s.shListId });
    });
    this.toast(s.shEditId ? 'Article modifié' : 'Article ajouté aux courses');
    this.patch({ showShop: false, shEditId: null });
  }
  delShop(): void { const id = this.ui().shEditId; if (!id) return; this.mutate((d) => { d.shop = d.shop.filter((x) => x.id !== id); }); this.patch({ showShop: false, shEditId: null }); this.toast('Article supprimé'); }

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
    this.mutate((d) => { d.shopLists = d.shopLists.filter((l) => l.id !== id); d.shop = d.shop.filter((x) => x.listId !== id); });
    this.patch({ shopListDelId: null, activeShopList: this.ui().activeShopList === id ? 'all' : this.ui().activeShopList });
    this.toast('Liste supprimée');
  }

  // ---- aisles -----------------------------------------------------------
  newAisle(): void { this.patch({ aiForm: true, aiEditId: null, aiName: '', aiColor: '#7A9B76' }); }
  editAisle(id: string): void { const a = this._data()?.aisles.find((x) => x.id === id); if (!a) return; this.patch({ aiForm: true, aiEditId: id, aiName: a.name, aiColor: a.color }); }
  saveAisle(): void {
    const s = this.ui(); const name = s.aiName.trim(); if (!name) { this.toast('Donne un nom au rayon'); return; }
    if (s.aiEditId) {
      const old = this._data()?.aisles.find((a) => a.id === s.aiEditId); const oldName = old?.name;
      this.mutate((d) => { const i = d.aisles.findIndex((a) => a.id === s.aiEditId); if (i >= 0) d.aisles[i] = { ...d.aisles[i], name, color: s.aiColor }; d.shop.forEach((x) => { if (x.cat === oldName) x.cat = name; }); });
      this.toast('Rayon modifié');
    } else { this.mutate((d) => { d.aisles.push({ id: uid('a'), name, color: s.aiColor }); }); this.toast('Rayon ajouté'); }
    this.patch({ aiForm: false, aiEditId: null });
  }
  confirmAisleDel(): void {
    const id = this.ui().aisleDelId; if (!id) return;
    const a = this._data()?.aisles.find((x) => x.id === id); const nm = a?.name;
    this.mutate((d) => { d.aisles = d.aisles.filter((x) => x.id !== id); d.shop.forEach((x) => { if (x.cat === nm) x.cat = 'À trier'; }); });
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

  // ---- budget -----------------------------------------------------------
  newCat(): void { this.patch({ catForm: true, catEditId: null, cName: '', cBudget: '', cColor: '#7A9B76', cIcon: 'panier' }); }
  editCat(id: string): void { const c = this._data()?.bcats.find((x) => x.id === id); if (!c) return; this.patch({ catForm: true, catEditId: id, cName: c.name, cBudget: String(c.budget), cColor: c.color, cIcon: c.icon || 'panier' }); }
  saveCat(): void {
    const s = this.ui(); const name = s.cName.trim(); if (!name) { this.toast('Donne un nom à la catégorie'); return; }
    const budget = parseAmt(s.cBudget);
    this.mutate((d) => {
      if (s.catEditId) { const i = d.bcats.findIndex((c) => c.id === s.catEditId); if (i >= 0) d.bcats[i] = { ...d.bcats[i], name, budget, color: s.cColor, icon: s.cIcon }; }
      else d.bcats.push({ id: uid('c'), name, budget, color: s.cColor, icon: s.cIcon });
    });
    this.toast(s.catEditId ? 'Catégorie modifiée' : 'Catégorie ajoutée');
    this.patch({ catForm: false, catEditId: null });
  }
  confirmCatDel(): void { const id = this.ui().catDelId; if (!id) return; this.mutate((d) => { d.bcats = d.bcats.filter((c) => c.id !== id); d.tx.forEach((t) => { if (t.catId === id) t.catId = null; }); }); this.patch({ catDelId: null }); this.toast('Catégorie supprimée'); }
  newTx(): void { const first = this._data()?.bcats[0]; this.patch({ txForm: true, txEditId: null, txName: '', txAmount: '', txIncome: false, txCatId: first?.id || null, txDate: '16 juil.' }); }
  editTx(id: string): void { const t = this._data()?.tx.find((x) => x.id === id); if (!t) return; this.patch({ txForm: true, txEditId: id, txName: t.name, txAmount: t.amount.toFixed(2).replace('.', ','), txIncome: t.income, txCatId: t.catId || this._data()?.bcats[0]?.id || null, txDate: t.date }); }
  saveTx(): void {
    const s = this.ui(); const name = s.txName.trim(); if (!name) { this.toast('Donne un libellé'); return; } const amount = parseAmt(s.txAmount); if (!amount) { this.toast('Saisis un montant'); return; }
    const data = { name, amount, income: s.txIncome, catId: s.txIncome ? null : s.txCatId, date: s.txDate.trim() || '—' };
    this.mutate((d) => {
      if (s.txEditId) { const i = d.tx.findIndex((t) => t.id === s.txEditId); if (i >= 0) d.tx[i] = { ...d.tx[i], ...data }; }
      else d.tx.unshift({ id: uid('x'), ...data, m: s.monthOffset });
    });
    this.toast(s.txEditId ? 'Transaction modifiée' : 'Transaction ajoutée');
    this.patch({ txForm: false, txEditId: null });
  }
  delTx(): void { const id = this.ui().txEditId; if (!id) return; this.mutate((d) => { d.tx = d.tx.filter((t) => t.id !== id); }); this.patch({ txForm: false, txEditId: null }); this.toast('Transaction supprimée'); }

  // ---- meals ------------------------------------------------------------
  mealName(v?: { rid?: string; text?: string }): string | null {
    if (!v) return null;
    if (v.rid) { const r = this._data()?.recipes.find((x) => x.id === v.rid); return r ? r.name : 'Recette supprimée'; }
    return v.text || null;
  }
  editMeal(dateStr: string, slot: string): void {
    const v = this._data()?.meals[dateStr + '-' + slot];
    this.patch({ mealEdit: { dateStr, slot }, mealMode: v && v.text ? 'text' : 'recipe', mealRid: v && v.rid ? v.rid : null, mealText: v && v.text ? v.text : '' });
  }
  saveMeal(): void {
    const e = this.ui().mealEdit; if (!e) return; const key = e.dateStr + '-' + e.slot;
    let val: { rid?: string; text?: string };
    if (this.ui().mealMode === 'recipe') { if (!this.ui().mealRid) { this.toast('Choisis une recette'); return; } val = { rid: this.ui().mealRid! }; }
    else { const t = this.ui().mealText.trim(); if (!t) { this.toast('Saisis un intitulé'); return; } val = { text: t }; }
    this.mutate((d) => { d.meals[key] = val; });
    this.patch({ mealEdit: null });
    this.toast('Repas enregistré');
  }
  clearMeal(): void { const e = this.ui().mealEdit; if (!e) return; const key = e.dateStr + '-' + e.slot; this.mutate((d) => { delete d.meals[key]; }); this.patch({ mealEdit: null }); this.toast('Repas retiré'); }
  generateList(): void {
    const cl = this.activeShopListId();
    const d = this._data(); if (!d) return;
    const names = new Set(d.shop.filter((i) => i.listId === cl).map((i) => i.name.toLowerCase()));
    const add: HouseholdState['shop'] = [];
    weekDates(this.ui().weekOffset).forEach((day) => {
      const ds = dstr(day);
      MEAL_SLOTS.forEach((sl) => {
        const v = d.meals[ds + '-' + sl.key]; if (!v || !v.rid) return;
        const r = d.recipes.find((x) => x.id === v.rid); if (!r) return;
        r.ingr.forEach((ing) => {
          const short = ing.replace(/^[0-9].*?(de |d’)?/, '').trim();
          const label = short.charAt(0).toUpperCase() + short.slice(1);
          if (!names.has(label.toLowerCase())) { names.add(label.toLowerCase()); add.push({ id: uid('g'), name: label, qty: '', cat: 'Depuis le planning repas', done: false, listId: cl }); }
        });
      });
    });
    this.mutate((s) => { s.shop.push(...add); });
    this.patch({ screen: 'courses' });
    this.toast(add.length + ' ingrédients ajoutés depuis les repas');
  }

  // ---- recipes ----------------------------------------------------------
  newRecipe(): void { this.patch({ recipeForm: true, editingId: null, fName: '', fTime: '', fLevel: 'Facile', fColor: '#7A9B76', fPhoto: null, fIngr: [{ id: uid('i'), val: '' }], fSteps: [{ id: uid('p'), val: '' }] }); }
  editRecipe(id: string): void {
    const r = this._data()?.recipes.find((x) => x.id === id); if (!r) return;
    this.patch({ recipeForm: true, editingId: id, openRecipeId: null, fName: r.name, fTime: r.time, fLevel: r.level, fColor: r.color, fPhoto: r.photo || null, fIngr: r.ingr.map((v) => ({ id: uid('i'), val: v })), fSteps: r.steps.map((v) => ({ id: uid('p'), val: v })) });
  }
  onRecipePhoto(file: File): void { const rd = new FileReader(); rd.onload = (ev) => this.patch({ fPhoto: ev.target?.result as string }); rd.readAsDataURL(file); }
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
    const data = { name, time: s.fTime.trim() || '—', level: s.fLevel, color: s.fColor, photo: s.fPhoto || null, ingr, steps };
    this.mutate((d) => {
      if (s.editingId) { const i = d.recipes.findIndex((r) => r.id === s.editingId); if (i >= 0) d.recipes[i] = { ...d.recipes[i], ...data }; }
      else d.recipes.unshift({ id: uid('r'), ...data });
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
    this.toast(s.mfEditId ? 'Membre modifié' : 'Invitation envoyée');
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
    this.patch({ profileOpen: true, pfTab: 'infos', pfName: m?.name || '', pfRole: m?.role || '', pfEmail: m ? this.memberAccountEmail(m.id) : '', pfPhone: '', pfColor: m?.color || '#E56B4E' });
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

  // ---- notifications ----------------------------------------------------
  toggleNotif(): void { this.patch({ notifOpen: !this.ui().notifOpen }); }
  markAllRead(): void { this.mutate((d) => { d.notifs.forEach((n) => (n.read = true)); }); this.toast('Notifications marquées comme lues'); }
  openNotif(id: string, screen?: string): void { this.mutate((d) => { const n = d.notifs.find((x) => x.id === id); if (n) n.read = true; }); this.patch({ notifOpen: false, screen: screen || this.ui().screen }); }

  // ---- settings ---------------------------------------------------------
  setSetting<K extends keyof HouseholdState['settings']>(key: K, val: HouseholdState['settings'][K]): void {
    this.mutate((d) => { (d.settings as any)[key] = val; });
    if (key === 'academie') this.loadSchoolHolidays();
  }
  async resetDemo(): Promise<void> {
    try { const { state } = await this.api.resetState(); this._data.set(this.normalise(state)); this.toast('Données de démonstration réinitialisées'); }
    catch { this.toast('Échec de la réinitialisation'); }
  }
  exportData(): void {
    const d = this._data(); if (!d) return;
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'foyer-export.json'; a.click();
    URL.revokeObjectURL(url);
    this.toast('Export des données lancé');
  }

  // ---- add menu picks ---------------------------------------------------
  pickShopFromMenu(): void { this.patch({ addMenuOpen: false, screen: 'courses' }); this.openShop(); }
}
