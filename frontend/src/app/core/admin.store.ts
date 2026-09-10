import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiError, ApiService, ConfigImportReport, PushStatus, SystemStatus, UpdateInfo } from './api.service';
import { downloadBlob } from './download';
import { FoyerStore } from './foyer.store';
import { pushInviteVisible } from './push-invite';

/** La clé VAPID publique, en base64 URL, vers les octets que `subscribe` attend. */
function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * L'administration du foyer, sortie de FoyerStore : comptes de connexion des
 * membres, rappels Web Push, mises à jour du serveur, lien de calendrier ICS,
 * sauvegardes et export/import de la configuration. Tout cela ne sert qu'aux
 * écrans d'un administrateur, ne touche pas le document du foyer, et alourdissait
 * le magasin central sans y avoir sa place.
 *
 * La dépendance ne va que dans un sens : AdminStore connaît FoyerStore (pour
 * poser un toast, lire un réglage, savoir qui est connecté), jamais l'inverse.
 * FoyerStore signale simplement, par deux compteurs, qu'un document vient d'être
 * chargé (`docLoadedAt`) ou que la liste des comptes a bougé (`accountsRev`) :
 * des effets ici s'en saisissent pour (re)faire le nécessaire, sans cycle.
 */
@Injectable({ providedIn: 'root' })
export class AdminStore {
  private api = inject(ApiService);
  private store = inject(FoyerStore);

  // ---- member login accounts (admin-managed) ----------------------------
  readonly accounts = signal<Record<string, string>>({}); // memberId → login email
  /** Les membres qui ont posé un second facteur. Rempli en même temps que `accounts`. */
  readonly accountsTotp = signal<Set<string>>(new Set());

  // ---- self-update ------------------------------------------------------
  readonly updateInfo = signal<UpdateInfo | null>(null);
  readonly updateChecking = signal(false);
  readonly updating = signal(false);
  readonly updateMsg = signal('');

  // ---- calendar feed (ICS) ----------------------------------------------
  readonly icsToken = signal<string>('');

  // ---- Web Push ---------------------------------------------------------
  readonly pushSupport = signal<'checking' | 'unsupported' | 'install' | 'denied' | 'off' | 'on'>('checking');
  readonly pushStatus = signal<PushStatus | null>(null);
  readonly pushBusy = signal(false);
  private swReg: ServiceWorkerRegistration | null = null;
  /** Report de l'invitation d'accueil, en millisecondes (0 = aucun). Lu une fois, tenu ici. */
  private readonly pushSnoozeUntil = signal<number>(this.readPushSnooze());
  /**
   * Faut-il proposer l'activation sur l'accueil ? Canal prêt mais éteint, app
   * installée, aucun report en cours. Sur iPhone non installé (`install`), rien
   * n'est proposé ici : le message d'installation reste dans Paramètres.
   */
  readonly pushInvite = computed(() => pushInviteVisible(this.pushSupport(), this.isStandalone(), this.pushSnoozeUntil(), Date.now()));

  // ---- exploitation -----------------------------------------------------
  readonly systemStatus = signal<SystemStatus | null>(null);
  readonly backupBusy = signal(false);
  readonly configBusy = signal(false);
  readonly configReport = signal<ConfigImportReport | null>(null);

  constructor() {
    // Un document vient d'être chargé (démarrage, connexion, rechargement) : le
    // bootstrap d'administration s'ensuit. `authed()` est reposé après
    // `loadState()`, donc c'est ce signal qui arme réellement l'effet ; le
    // compteur le refait à chaque relecture. `untracked` empêche les signaux
    // écrits par le bootstrap de le relancer en boucle.
    effect(() => {
      const tick = this.store.docLoadedAt();
      const authed = this.store.authed();
      if (authed && tick > 0) untracked(() => {
        void this.refreshAccounts();
        void this.loadIcs();
        this.resumeUpdateIfRunning();
        void this.initPush();
      });
    });

    // La liste des comptes a bougé sans rechargement complet (membre retiré,
    // identifiants changés) : la relire, elle seule.
    effect(() => {
      this.store.accountsRev();
      if (untracked(() => this.store.authed())) untracked(() => void this.refreshAccounts());
    });

    // Déconnexion : ce qui n'a de sens que connecté est oublié.
    effect(() => {
      if (!this.store.authed()) untracked(() => {
        this.accounts.set({});
        this.accountsTotp.set(new Set());
        this.icsToken.set('');
      });
    });
  }

  // ---- member login accounts --------------------------------------------
  /** Réservée à un administrateur, comme l'écran qui s'en sert. */
  async refreshAccounts(): Promise<void> {
    if (!this.store.isAdmin()) return;
    try {
      const { accounts } = await this.api.memberAccounts();
      this.accounts.set(Object.fromEntries(accounts.map((a) => [a.memberId, a.email])));
      this.accountsTotp.set(new Set(accounts.filter((a) => a.totp).map((a) => a.memberId)));
    } catch { /* ignore */ }
  }

  memberHasAccount(memberId: string): boolean { return !!this.accounts()[memberId]; }
  memberAccountEmail(memberId: string): string { return this.accounts()[memberId] || ''; }
  /** Ce membre a-t-il posé un second facteur ? Réservé à l'écran d'un administrateur. */
  memberHasTotp(memberId: string): boolean { return this.accountsTotp().has(memberId); }

  /**
   * Retire le second facteur d'un membre : le téléphone est perdu, cassé ou
   * réinitialisé, et les codes de secours avec. Le mot de passe de
   * l'administrateur est redemandé par le serveur.
   */
  async resetMemberTotp(memberId: string, password: string): Promise<boolean> {
    try {
      await this.api.totpReset(memberId, password);
      await this.refreshAccounts();
      this.store.toast('Second facteur retiré. Ce membre se reconnecte avec son seul mot de passe.');
      return true;
    } catch (e) { this.store.toast((e as Error).message); return false; }
  }

  async openAccount(memberId: string): Promise<void> {
    // Ensure the member exists server-side before managing its account.
    await this.store.flush();
    await this.refreshAccounts();
    this.store.patch({ accountFor: memberId, acEmail: this.memberAccountEmail(memberId), acPassword: '', acBusy: false });
  }
  closeAccount(): void { this.store.patch({ accountFor: null, acBusy: false }); }

  async saveAccount(): Promise<void> {
    const s = this.store.ui();
    const memberId = s.accountFor;
    if (!memberId || s.acBusy) return;
    const email = s.acEmail.trim();
    const password = s.acPassword;
    const exists = this.memberHasAccount(memberId);
    const min = this.store.setting('passwordMinLength');
    if (!exists) {
      if (!/^\S+@\S+\.\S+$/.test(email)) { this.store.toast('Email invalide'); return; }
      if (password.length < min) { this.store.toast(`Mot de passe : ${min} caractères minimum`); return; }
    } else if (password && password.length < min) {
      this.store.toast(`Mot de passe : ${min} caractères minimum`); return;
    }
    this.store.patch({ acBusy: true });
    try {
      if (!exists) await this.api.createMemberAccount(memberId, email, password);
      else await this.api.updateMemberAccount(memberId, email || undefined, password || undefined);
      await this.refreshAccounts();
      this.store.patch({ accountFor: null, acBusy: false });
      this.store.toast(exists ? 'Accès mis à jour' : 'Accès créé');
    } catch (e) {
      this.store.patch({ acBusy: false });
      this.store.toast((e as Error).message);
    }
  }

  async removeAccount(): Promise<void> {
    const memberId = this.store.ui().accountFor;
    if (!memberId) return;
    this.store.patch({ acBusy: true });
    try {
      await this.api.deleteMemberAccount(memberId);
      await this.refreshAccounts();
      this.store.patch({ accountFor: null, acBusy: false });
      this.store.toast('Accès retiré');
    } catch (e) {
      this.store.patch({ acBusy: false });
      this.store.toast((e as Error).message);
    }
  }

  // ---- calendar feed (ICS) ----------------------------------------------
  /** Le jeton du flux vaut accès sans mot de passe : le serveur ne le sert qu'à un administrateur. */
  async loadIcs(): Promise<void> {
    if (!this.store.isAdmin()) return;
    try { const r = await this.api.icsInfo(); this.icsToken.set(r.token); } catch { /* ignore */ }
  }
  async regenerateIcs(): Promise<void> {
    try { const r = await this.api.icsRegenerate(); this.icsToken.set(r.token); this.store.toast('Nouveau lien de calendrier généré'); }
    catch (e) { this.store.toast((e as Error).message); }
  }
  icsUrl(): string { const t = this.icsToken(); return t ? new URL('api/calendar/feed.ics?token=' + t, document.baseURI).href : ''; }

  // ---- self-update ------------------------------------------------------
  async checkUpdates(): Promise<void> {
    this.updateChecking.set(true);
    try { this.updateInfo.set(await this.api.updateCheck()); }
    catch (e) { this.updateInfo.set({ current: '?', selfUpdate: false, error: (e as Error).message }); }
    this.updateChecking.set(false);
  }

  async applyUpdate(password: string): Promise<void> {
    if (this.updating()) return;
    this.updating.set(true);
    this.updateMsg.set('Démarrage de la mise à jour…');
    try {
      const r = await this.api.startSystemUpdate(password);
      if (r.error) { this.updating.set(false); this.store.toast(r.error); return; }
    } catch (e) { this.updating.set(false); this.store.toast((e as Error).message); return; }
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
      } else if (s.state === 'error' && s.message) {
        // Une mise à jour qui a échoué ne doit pas se découvrir en fouillant le
        // serveur : le panneau Mises à jour l'affiche tant qu'on n'en a pas relancé une.
        this.updateMsg.set(s.message);
      }
    } catch { /* status unreachable — ignore */ }
  }

  /**
   * Poll the server update status every 3 s. A total deadline here would lie:
   * on a small container `npm ci` plus two builds dépassent dix minutes sans
   * que rien n'aille mal. C'est le serveur qui déclare une mise à jour
   * interrompue (voir freshStatus), sur l'absence de progression. Il ne reste
   * donc à juger ici qu'un seul cas : un backend qui ne répond plus du tout.
   */
  private pollUpdateStatus(): void {
    let mute = 0;
    const poll = async (): Promise<void> => {
      try {
        const s = await this.api.updateStatus();
        mute = 0;
        if (s.message) this.updateMsg.set(s.message);
        if (s.state === 'done') { this.updating.set(false); this.store.toast('Mise à jour installée, rechargement…'); setTimeout(() => location.reload(), 1600); return; }
        if (s.state === 'error') { this.updating.set(false); this.store.toast('Échec : ' + (s.message || 'voir les logs')); return; }
      } catch {
        // Le service est coupé pendant l'installation : quelques minutes de
        // silence sont normales, un quart d'heure ne l'est plus.
        if (++mute > 300) {
          this.updating.set(false);
          this.updateMsg.set('Le serveur ne répond plus depuis un quart d’heure. Voir le journal de mise à jour sur le serveur, puis relancez.');
          return;
        }
        this.updateMsg.set('Redémarrage du service…');
      }
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 3000);
  }

  // ---- Web Push ---------------------------------------------------------
  //
  // Le navigateur s'abonne auprès du service push de son éditeur et confie
  // l'abonnement au serveur, qui y enverra les rappels. Sur iPhone, seule une
  // application ajoutée à l'écran d'accueil peut s'abonner : c'est l'état
  // « install ». Le reste est muet quand il casse (voir docs/taches.md), d'où
  // l'état détaillé dans Paramètres.

  /** iPhone ou iPad, où Safari n'accepte le push que depuis l'écran d'accueil. */
  private isIos(): boolean {
    return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  private isStandalone(): boolean {
    return matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone;
  }

  /**
   * Le report de l'invitation vit sur l'appareil, pas dans le foyer : c'est un
   * choix d'affichage local, comme l'écran retenu. Un timestamp ISO en
   * localStorage, lu une fois puis tenu par un signal pour que le computed n'ait
   * pas à toucher le stockage à chaque cycle.
   */
  private static readonly PUSH_INVITE_KEY = 'foyer.push-invite-until';
  private readPushSnooze(): number {
    try { const v = localStorage.getItem(AdminStore.PUSH_INVITE_KEY); if (!v) return 0; const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
    catch { return 0; }
  }
  /** « Plus tard » : on ne repropose pas avant 14 jours sur cet appareil. */
  snoozePushInvite(): void {
    const until = Date.now() + 14 * 24 * 60 * 60 * 1000;
    try { localStorage.setItem(AdminStore.PUSH_INVITE_KEY, new Date(until).toISOString()); } catch { /* mode privé : le report vaut pour la session */ }
    this.pushSnoozeUntil.set(until);
  }

  async initPush(): Promise<void> {
    if (!('serviceWorker' in navigator)) { this.pushSupport.set('unsupported'); return; }
    const reg = await this.store.ensureServiceWorker();
    if (!reg) { this.pushSupport.set('unsupported'); return; }
    this.swReg = reg;
    if (!('PushManager' in window) || !('Notification' in window)) {
      this.pushSupport.set(this.isIos() && !this.isStandalone() ? 'install' : 'unsupported');
      return;
    }
    if (Notification.permission === 'denied') { this.pushSupport.set('denied'); }
    else {
      const sub = await reg.pushManager.getSubscription();
      this.pushSupport.set(sub ? 'on' : 'off');
      // Un abonnement déjà là est redit au serveur : il a pu changer de membre ou être perdu en base.
      if (sub) this.api.pushSubscribe(sub.toJSON(), navigator.userAgent).catch(() => { /* l'état l'affichera */ });
    }
    void this.refreshPushStatus();
  }

  async refreshPushStatus(): Promise<void> {
    try { this.pushStatus.set(await this.api.pushStatus()); } catch { /* l'écran dit « indisponible » */ }
  }

  /** Sur un geste de l'utilisateur, obligatoirement : Safari refuse la demande sinon. */
  async enablePush(): Promise<void> {
    if (!this.swReg || this.pushBusy()) return;
    this.pushBusy.set(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { this.pushSupport.set(perm === 'denied' ? 'denied' : 'off'); this.store.toast('Autorisation refusée : les rappels ne peuvent pas arriver ici.'); return; }
      const key = this.pushStatus()?.publicKey || (await this.api.pushStatus()).publicKey;
      const sub = await this.swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      await this.api.pushSubscribe(sub.toJSON(), navigator.userAgent);
      this.pushSupport.set('on');
      this.store.toast('Rappels activés sur cet appareil');
      await this.refreshPushStatus();
    } catch (e) {
      this.store.toast('Activation impossible : ' + (e as Error).message);
    } finally { this.pushBusy.set(false); }
  }

  async disablePush(): Promise<void> {
    if (!this.swReg || this.pushBusy()) return;
    this.pushBusy.set(true);
    try {
      const sub = await this.swReg.pushManager.getSubscription();
      if (sub) { await this.api.pushUnsubscribe(sub.endpoint).catch(() => { /* l'abonnement local part quand même */ }); await sub.unsubscribe(); }
      this.pushSupport.set('off');
      this.store.toast('Rappels désactivés sur cet appareil');
      await this.refreshPushStatus();
    } finally { this.pushBusy.set(false); }
  }

  async removePushDevice(id: number): Promise<void> {
    try { await this.api.pushRemoveDevice(id); await this.refreshPushStatus(); this.store.toast('Appareil retiré'); }
    catch (e) { this.store.toast((e as Error).message); }
  }

  /** Une vraie notification, tout de suite : le seul test qui vaille. */
  async testPush(): Promise<void> {
    if (this.pushBusy()) return;
    this.pushBusy.set(true);
    try {
      const r = await this.api.pushTest();
      // Un envoi partiel n'est pas un envoi réussi : le dire, en nommant ce qui
      // a échoué. La liste des appareils, elle, dit lequel.
      this.store.toast(
        r.status === 'sent' ? 'Test envoyé à ' + r.devices + (r.devices > 1 ? ' appareils' : ' appareil') + ', il devrait arriver dans la seconde'
        : r.status === 'partial' ? `Reçu par ${r.devices} appareil sur ${r.total} : ${r.error || 'les autres ont refusé'}`
        : r.status === 'no-device' ? 'Aucun appareil abonné pour vous'
        : 'Échec : ' + (r.error || r.status));
      await this.refreshPushStatus();
    } catch (e) { this.store.toast((e as Error).message); }
    finally { this.pushBusy.set(false); }
  }

  // ---- exploitation -----------------------------------------------------
  async loadSystemStatus(): Promise<void> {
    try { this.systemStatus.set(await this.api.systemStatus()); }
    catch { /* non administrateur, ou hors ligne : la section le dit */ }
  }

  /**
   * Un instantané cohérent de la base, sans arrêter le service. Il n'emporte ni
   * les fichiers ni les photos : l'écran le dit, plutôt que de laisser croire à
   * une sauvegarde complète.
   */
  async makeBackup(): Promise<void> {
    this.backupBusy.set(true);
    try {
      const out = await this.api.makeBackup();
      await this.loadSystemStatus();
      this.store.toast(`Sauvegarde écrite : ${out.snapshot.name}`);
    } catch (e) {
      this.store.toast('Sauvegarde impossible : ' + (e as Error).message);
    } finally { this.backupBusy.set(false); }
  }

  async downloadBackup(name: string): Promise<void> {
    try { downloadBlob(await this.api.downloadBackup(name), name); }
    catch (e) { this.store.toast('Téléchargement impossible : ' + (e as Error).message); }
  }

  async deleteBackup(name: string): Promise<void> {
    if (!confirm(`Effacer la sauvegarde ${name} ? Elle ne sera pas récupérable.`)) return;
    try { await this.api.deleteBackup(name); await this.loadSystemStatus(); this.store.toast('Sauvegarde effacée'); }
    catch (e) { this.store.toast('Suppression impossible : ' + (e as Error).message); }
  }

  /**
   * Le fichier de configuration : l'exporter, le relire.
   *
   * Ce n'est pas une sauvegarde des données, et l'écran le dit. C'est le filet
   * de sécurité avant de toucher aux réglages, et ce qui évite de tout
   * reparamétrer de mémoire après une réinstallation.
   */
  async exportSettings(): Promise<void> {
    this.configBusy.set(true);
    try {
      downloadBlob(await this.api.exportSettings(), `foyer-reglages-${this.store.todayStr()}.json`);
      this.store.toast('Configuration exportée');
    } catch (e) {
      this.store.toast('Export impossible : ' + (e as Error).message);
    } finally { this.configBusy.set(false); }
  }

  async importSettings(file: File): Promise<void> {
    this.configBusy.set(true);
    this.configReport.set(null);
    try {
      const rapport = await this.api.importSettings(JSON.parse(await file.text()));
      this.configReport.set(rapport);
      // Le document local ne sait rien de ce que le serveur vient d'écrire : on
      // le relit en entier plutôt que de deviner, sinon l'écran montre l'état d'avant.
      await this.store.loadState();
      await this.store.loadSettingsInfo();
      this.store.toast(rapport.applied.length ? `${rapport.applied.length} réglage(s) rétabli(s)` : 'Rien à rétablir : tout était déjà en place');
    } catch (e) {
      const err = e as ApiError;
      this.configReport.set(null);
      this.store.toast(err instanceof SyntaxError ? 'Ce fichier n’est pas du JSON lisible.' : 'Import impossible : ' + err.message);
    } finally { this.configBusy.set(false); }
  }
}
