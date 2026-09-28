import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { EmployesApi, EmpBootstrap, EmpEmployee, EmpRate, empRoleLabel } from '../../core/employes.api';
import { todayIn } from '../../core/helpers';
import { HOUSEHOLD_TZ } from '../../core/constants';

/** Des centimes vers « 14,50 € ». */
const euro = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',') + ' €';

/**
 * Gestion du taux horaire, par employé, dans la section « Employé à domicile »
 * des Paramètres. Chaque employé porte son propre taux daté (emp_rates) : le
 * taux se pose à la création (écran « Employé à domicile ») puis évolue ici,
 * avec sa date d'effet. Le calcul d'un mois lit l'historique (le taux du jour de
 * chaque présence), un mois déjà déclaré n'est jamais recalculé. Réservé aux
 * administrateurs, comme tout réglage du foyer.
 */
@Component({
  selector: 'settings-employe',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (chargement()) { <div class="hint">Chargement…</div> }
    @else if (!employes().length) {
      <div class="hint">Aucun employé configuré. Ajoutez-en un depuis l’écran « Employé à domicile » (nom, catégorie CESU et taux horaire).</div>
    }
    @else {
      @if (employes().length > 1) {
        <label class="lab">Employé
          <select class="input" [ngModel]="selId()" (ngModelChange)="selId.set(+$event)">
            @for (e of employes(); track e.id) { <option [value]="e.id">{{ e.name }} · {{ roleLabel(e.role) }}</option> }
          </select>
        </label>
      } @else {
        <div class="cur">{{ employe()!.name }} <span class="since">· {{ roleLabel(employe()!.role) }}</span></div>
      }

      @if (!store.isAdmin()) {
        <div class="hint">Le taux est un réglage du foyer : seul un administrateur peut le modifier. Vous le voyez tel qu’il s’applique.</div>
        <div class="cur">Taux actuel : <b>{{ tauxActuel() }}</b>@if (dateActuelle(); as d) { <span class="since"> depuis le {{ frDate(d) }}</span> }</div>
      } @else {
        <div class="cur">Taux actuel : <b>{{ tauxActuel() }}</b>@if (dateActuelle(); as d) { <span class="since"> depuis le {{ frDate(d) }}</span> }</div>
        <div class="grille">
          <label class="lab">Nouveau taux net (€/h)
            <input class="input" type="number" inputmode="decimal" min="0" max="100" step="0.01" [(ngModel)]="taux" placeholder="14,50" />
          </label>
          <label class="lab">Date d’effet
            <input class="input" type="date" [(ngModel)]="dateEffet" />
          </label>
        </div>
        <button class="btn" [disabled]="!valide() || busy()" (click)="enregistrer()">Enregistrer le taux</button>
        @if (erreur()) { <div class="ko">{{ erreur() }}</div> }

        @if (rates().length) {
          <div class="hist-t">Historique des taux</div>
          <ul class="hist">
            @for (r of rates(); track r.id) {
              <li><b>{{ euro(r.netHourlyCents) }}</b> à partir du {{ frDate(r.effectiveFrom) }}</li>
            }
          </ul>
        }
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); margin-bottom: 10px; line-height: 1.5; }
    .cur { font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 12px; }
    .cur .since { color: var(--ink3); font-weight: 600; }
    .grille { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
    .lab { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 800; color: var(--ink2); margin-bottom: 12px; }
    .input { min-width: 150px; }
    .btn { border: none; background: var(--primary); color: #fff; font-weight: 800; font-size: 13.5px; padding: 10px 16px; border-radius: 11px; cursor: pointer; }
    .btn:disabled { opacity: .5; cursor: default; }
    .ko { margin-top: 8px; font-size: 12px; font-weight: 800; color: #C6492F; }
    .hist-t { margin-top: 16px; font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .hist { margin: 8px 0 0; padding-left: 18px; }
    .hist li { font-size: 13px; font-weight: 600; color: var(--ink2); margin: 3px 0; }
  `],
})
export class SettingsEmployeComponent {
  store = inject(FoyerStore);
  private api = inject(EmployesApi);
  euro = euro;
  roleLabel = empRoleLabel;

  readonly chargement = signal(true);
  readonly boot = signal<EmpBootstrap | null>(null);
  readonly rates = signal<EmpRate[]>([]);
  readonly busy = signal(false);
  readonly erreur = signal('');
  readonly selId = signal<number | null>(null);

  taux = '';
  dateEffet = todayIn(HOUSEHOLD_TZ);

  readonly employes = computed<EmpEmployee[]>(() => this.boot()?.employees ?? []);
  readonly employe = computed<EmpEmployee | null>(() => {
    const list = this.employes();
    return list.find((e) => e.id === this.selId()) ?? list[0] ?? null;
  });
  readonly dateActuelle = computed(() => this.employe()?.currentRate?.effectiveFrom ?? null);
  readonly tauxActuel = computed(() => {
    const c = this.employe()?.currentRate?.netHourlyCents;
    return typeof c === 'number' ? euro(c) : 'non défini';
  });
  readonly valide = computed(() => { const n = Number(String(this.taux).replace(',', '.')); return Number.isFinite(n) && n >= 0 && n <= 100 && /^\d{4}-\d{2}-\d{2}$/.test(this.dateEffet); });

  constructor() {
    void this.load();
    // Changer d'employé (ou le premier chargement) relit son historique de taux.
    effect(() => { const e = this.employe(); if (e) void this.loadRates(e.id); });
  }

  private async load(): Promise<void> {
    this.chargement.set(true);
    try { this.boot.set(await this.api.bootstrap()); }
    catch { /* module injoignable : la section reste, sans données */ }
    this.chargement.set(false);
  }
  private async loadRates(id: number): Promise<void> {
    try { this.rates.set((await this.api.rates(id)).rates); } catch { /* ignore */ }
  }

  frDate(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }

  async enregistrer(): Promise<void> {
    const e = this.employe();
    if (!this.valide() || this.busy() || !e) return;
    this.busy.set(true); this.erreur.set('');
    try {
      const euros = Number(String(this.taux).replace(',', '.'));
      await this.api.setRate(euros, this.dateEffet, e.id);
      this.taux = '';
      await this.load();
    } catch (err) { this.erreur.set((err as Error).message || 'L’enregistrement a échoué.'); }
    this.busy.set(false);
  }
}
