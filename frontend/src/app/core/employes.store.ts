import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { EmployesApi, EmpBootstrap, EmpMonthRecap, EmpShift } from './employes.api';
import { FoyerStore } from './foyer.store';
import { ApiError } from './api.service';
import { todayIn } from './helpers';
import { HOUSEHOLD_TZ } from './constants';

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

  readonly employe = computed(() => this.boot()?.employees[0] ?? null);
  readonly dureeHabituelle = computed(() => this.boot()?.dureeHabituelle ?? 180);
  readonly congesInclus = computed(() => this.boot()?.congesInclus ?? true);

  constructor() {
    // À la déconnexion, on oublie tout : le module recharge au retour.
    effect(() => { if (!this.foyer.authed() && this.loaded) this.reset(); });
  }

  private loaded = false;
  async init(force = false): Promise<void> {
    if (this.loaded && !force) { return; }
    this.loaded = true;
    await this.reloadBoot();
    await this.reloadMonth();
  }
  reset(): void {
    this.loaded = false; this.boot.set(null); this.recap.set(null); this.indispo.set(false);
    this.month.set(todayIn(HOUSEHOLD_TZ).slice(0, 7));
  }

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

  async creerEmploye(nom: string): Promise<void> {
    this.busy.set(true);
    try { await this.api.createEmployee(nom.trim(), 'menage'); await this.reloadBoot(); await this.reloadMonth(); }
    finally { this.busy.set(false); }
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
