import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { EmployesApi, EmpBootstrap, EmpMonthRecap, EmpRole, EmpShift } from './employes.api';
import { DayExtra, FoyerStore } from './foyer.store';
import { ApiError } from './api.service';
import { todayIn } from './helpers';
import { CAL_KINDS, HOUSEHOLD_TZ } from './constants';

/**
 * État de l'écran « Ménage » (module Employé à domicile). Le module vit dans ses
 * tables relationnelles : tout passe par /api/employes, jamais par le document.
 * Le calcul du net est fait par le serveur (le taux du jour de chaque présence) ;
 * le store affiche le récapitulatif tel qu'il le reçoit, sans le recalculer.
 */
@Injectable({ providedIn: 'root' })
export class EmployesStore {
  private api = inject(EmployesApi);
  readonly foyer = inject(FoyerStore);

  readonly boot = signal<EmpBootstrap | null>(null);
  readonly month = signal(todayIn(HOUSEHOLD_TZ).slice(0, 7));
  readonly recap = signal<EmpMonthRecap | null>(null);
  readonly loading = signal(false);
  /** L'appel a échoué (serveur injoignable) : l'écran le dit plutôt que d'afficher « 0 h ». */
  readonly indispo = signal(false);
  readonly busy = signal(false);

  /** L'employé regardé (plusieurs peuvent coexister). Null = revenir au premier. */
  readonly selectedId = signal<number | null>(null);
  readonly employes = computed(() => this.boot()?.employees ?? []);
  readonly employe = computed(() => {
    const list = this.employes();
    return list.find((e) => e.id === this.selectedId()) ?? list[0] ?? null;
  });
  readonly dureeHabituelle = computed(() => this.boot()?.dureeHabituelle ?? 180);
  readonly congesInclus = computed(() => this.boot()?.congesInclus ?? true);

  constructor() {
    // À la déconnexion, on oublie tout : le module recharge au retour.
    effect(() => { if (!this.foyer.authed() && this.loaded) this.reset(); });
    // Repère d'agenda : un mois à déclarer pose un repère au jour de rappel du
    // mois suivant. Réservé aux adultes (un enfant ne charge jamais le module).
    effect(() => this.foyer.setExternalDayExtras('employe', this.cesuDayExtras()));
    // Charger le socle dès qu'un adulte est connecté, pour que le repère
    // d'agenda existe sans avoir ouvert l'écran « Ménage ».
    effect(() => { if (this.foyer.authed() && !this.foyer.isChild() && !this.boot()) void this.reloadBoot(); });
  }

  /** Date « AAAA-MM-JJ » du jour de rappel (borné [1, 28]) du mois suivant `month`. */
  private markDate(month: string, day: number): string {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 1));
    const jour = Math.min(28, Math.max(1, day));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
  }
  /** « août » pour « 2026-08 », dans la locale du foyer. */
  private moisNom(month: string): string {
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: HOUSEHOLD_TZ }).format(new Date(month + '-01T12:00:00Z'));
  }
  /** Les repères CESU, indexés par date : un par mois à déclarer, tous employés confondus. */
  private cesuDayExtras(): Record<string, DayExtra[]> {
    const b = this.boot();
    const out: Record<string, DayExtra[]> = {};
    if (!b || this.foyer.isChild()) return out;
    for (const e of b.employees) {
      for (const mois of e.openMonths || []) {
        const ds = this.markDate(mois, b.rappelJour);
        (out[ds] ??= []).push({ kind: 'cesu', label: 'Déclaration CESU', color: CAL_KINDS['cesu'].color, sub: e.role === 'menage' ? 'Ménage de ' + this.moisNom(mois) : e.name + ' : ' + this.moisNom(mois) });
      }
    }
    return out;
  }

  private loaded = false;
  async init(force = false): Promise<void> {
    if (this.loaded && !force) { return; }
    this.loaded = true;
    await this.reloadBoot();
    await this.reloadMonth();
  }
  reset(): void {
    this.loaded = false; this.boot.set(null); this.recap.set(null); this.indispo.set(false); this.selectedId.set(null);
    this.month.set(todayIn(HOUSEHOLD_TZ).slice(0, 7));
  }

  /** Regarder un autre employé : recharge son mois courant. */
  selectEmploye(id: number): void { this.selectedId.set(id); void this.reloadMonth(); }

  private async reloadBoot(): Promise<void> {
    try { this.boot.set(await this.api.bootstrap()); this.indispo.set(false); }
    catch (e) { if (e instanceof ApiError && e.status === 0) this.indispo.set(true); }
  }
  async reloadMonth(): Promise<void> {
    if (!this.employe()) { this.recap.set(null); return; }
    this.loading.set(true);
    try { this.recap.set(await this.api.month(this.month(), this.employe()!.id)); this.indispo.set(false); }
    catch (e) { if (e instanceof ApiError && e.status === 0) this.indispo.set(true); this.recap.set(null); }
    this.loading.set(false);
  }

  setMonth(mois: string): void { this.month.set(mois); void this.reloadMonth(); }
  shiftMonth(delta: number): void {
    const [y, m] = this.month().split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    this.setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  private empId(): number | undefined { return this.employe()?.id; }

  /** Créer un employé (catégorie CESU + taux à la création), et le regarder aussitôt. */
  async creerEmploye(nom: string, role: EmpRole, euros?: number): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.api.createEmployee(nom.trim(), role, euros);
      await this.reloadBoot();
      this.selectedId.set(r.employee.id);
      await this.reloadMonth();
    } finally { this.busy.set(false); }
  }

  /** Modifier le nom ou la catégorie d'un employé. */
  async modifierEmploye(id: number, patch: { name?: string; role?: EmpRole }): Promise<void> {
    this.busy.set(true);
    try { await this.api.editEmployee(id, patch); await this.reloadBoot(); await this.reloadMonth(); }
    finally { this.busy.set(false); }
  }

  /**
   * Retirer un employé (archivage) : il quitte la liste, mais ses heures et
   * déclarations restent en base (rien n'est effacé, comme partout dans le module).
   * On bascule alors sur le premier employé restant.
   */
  async archiverEmploye(id: number): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.archiveEmployee(id);
      if (this.selectedId() === id) this.selectedId.set(null);
      await this.reloadBoot();
      await this.reloadMonth();
    } finally { this.busy.set(false); }
  }

  /** « Elle est venue aujourd'hui » : une présence à la durée habituelle, en un tap, annulable. */
  async elleEstVenue(): Promise<void> {
    const jour = this.foyer.todayStr();
    try {
      const r = await this.api.addShift({ day: jour, minutes: this.dureeHabituelle() }, this.empId());
      if (r.duplicate) { this.foyer.toast('Déjà une présence notée aujourd’hui. Ajustez-la dans la liste.'); return; }
      await this.reloadMonth();
      const id = r.shift!.id;
      this.foyer.toastWithUndo('Présence notée', () => void this.retirerSilencieux(id));
    } catch (e) { this.foyer.toast(this.msg(e)); }
  }

  /**
   * Ajouter une présence à une date choisie (formulaire). Contrairement au bouton
   * du jour, la date peut tomber dans un autre mois : on s'y déplace pour que la
   * présence se voie. Rend `doublon` pour que l'écran garde le formulaire ouvert
   * et invite à ajuster l'existante plutôt que d'en créer une seconde en silence.
   */
  async ajouterPresence(day: string, minutes: number, note: string): Promise<'ok' | 'doublon' | 'erreur'> {
    this.busy.set(true);
    try {
      const r = await this.api.addShift({ day, minutes, note: note.trim() || undefined }, this.empId());
      if (r.duplicate) return 'doublon';
      const mois = day.slice(0, 7);
      if (mois !== this.month()) this.month.set(mois);
      await this.reloadMonth();
      await this.reloadBoot();
      this.foyer.toastWithUndo('Présence notée', () => void this.retirerSilencieux(r.shift!.id));
      return 'ok';
    } catch (e) { this.foyer.toast(this.msg(e)); return 'erreur'; }
    finally { this.busy.set(false); }
  }

  async ajuster(id: number, patch: { day?: string; minutes?: number; note?: string }): Promise<void> {
    this.busy.set(true);
    try { await this.api.editShift(id, patch); await this.reloadMonth(); }
    catch (e) { this.foyer.toast(this.msg(e)); }
    finally { this.busy.set(false); }
  }
  async retirer(shift: EmpShift): Promise<void> {
    try {
      await this.api.archiveShift(shift.id); await this.reloadMonth();
      this.foyer.toastWithUndo('Présence retirée', () => void this.reAjouter(shift));
    } catch (e) { this.foyer.toast(this.msg(e)); }
  }
  private async retirerSilencieux(id: number): Promise<void> { try { await this.api.archiveShift(id); await this.reloadMonth(); } catch { /* rien */ } }
  private async reAjouter(s: EmpShift): Promise<void> { try { await this.api.addShift({ day: s.day, minutes: s.minutes, note: s.note, force: true }, this.empId()); await this.reloadMonth(); } catch { /* rien */ } }

  async declarer(note = ''): Promise<void> { await this.moisAction(() => this.api.declare(this.month(), { note }, this.empId()), 'Mois déclaré'); }
  async payer(urssafEuros?: number): Promise<void> { await this.moisAction(() => this.api.pay(this.month(), urssafEuros != null ? { urssaf_total: urssafEuros } : {}, this.empId()), 'Mois marqué payé'); }
  async rouvrir(): Promise<void> { await this.moisAction(() => this.api.reopen(this.month(), this.empId()), 'Mois rouvert'); }
  async sansPresence(): Promise<void> { await this.moisAction(() => this.api.noPresence(this.month(), this.empId()), 'Mois marqué sans présence'); }

  private async moisAction(fn: () => Promise<EmpMonthRecap>, ok: string): Promise<void> {
    this.busy.set(true);
    try { this.recap.set(await fn()); this.foyer.toast(ok); }
    catch (e) { this.foyer.toast(this.msg(e)); }
    finally { this.busy.set(false); }
  }

  private msg(e: unknown): string { return e instanceof ApiError ? (e.status === 0 ? 'Hors ligne : réessayez.' : e.message) : 'Une erreur est survenue.'; }
}
