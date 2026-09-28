import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { EmployesApi, EmpBootstrap, EmpRate, EmpRole } from '../../core/employes.api';
import { todayIn } from '../../core/helpers';
import { HOUSEHOLD_TZ } from '../../core/constants';

/** Des centimes vers « 14,50 € ». */
const euro = (cents: number): string => (cents / 100).toFixed(2).replace('.', ',') + ' €';

/**
 * Contrôle fait main du taux horaire, dans la section « Employé à domicile » des
 * Paramètres. Le champ décimal générique ne peut pas demander une **date
 * d'effet** : ici, taux et date se saisissent ensemble, et enregistrer ajoute
 * une ligne d'historique daté (emp_rates) tout en mettant le réglage à jour. Le
 * calcul d'un mois lit l'historique (le taux du jour de chaque présence), pas
 * cette valeur courante. Réservé aux administrateurs, comme tout réglage du foyer.
 */
@Component({
  selector: 'settings-employe',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (chargement()) { <div class="hint">Chargement…</div> }
    @else if (!store.isAdmin()) {
      <div class="hint">Le taux est un réglage du foyer : seul un administrateur peut le modifier. Vous le voyez tel qu’il s’applique.</div>
      <div class="cur">Taux actuel : <b>{{ tauxActuel() }}</b>@if (dateActuelle(); as d) { <span class="since"> depuis le {{ frDate(d) }}</span> }</div>
    }
    @else {
      @if (!employe()) {
        <div class="hint">Aucun employé configuré. Créez la personne pour commencer (le nom seul, aucune donnée sensible).</div>
        <div class="grille">
          <input class="input" [(ngModel)]="nom" placeholder="Nom (ex : Nolwenn)" maxlength="120" />
          <select class="input" [(ngModel)]="role">
            <option value="menage">Ménage</option>
            <option value="garde">Garde d’enfant</option>
            <option value="jardin">Jardinage</option>
            <option value="autre">Autre</option>
          </select>
        </div>
        <button class="btn" [disabled]="!nom.trim() || busy()" (click)="creer()">Créer l’employé</button>
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
    .lab { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 800; color: var(--ink2); }
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

  readonly chargement = signal(true);
  readonly boot = signal<EmpBootstrap | null>(null);
  readonly rates = signal<EmpRate[]>([]);
  readonly busy = signal(false);
  readonly erreur = signal('');

  nom = '';
  role: EmpRole = 'menage';
  taux = '';
  dateEffet = todayIn(HOUSEHOLD_TZ);

  readonly employe = computed(() => this.boot()?.employees[0] ?? null);
  readonly dateActuelle = computed(() => this.employe()?.currentRate?.effectiveFrom ?? null);
  readonly tauxActuel = computed(() => {
    const c = this.employe()?.currentRate?.netHourlyCents;
    if (typeof c === 'number') return euro(c);
    // Le taux réglé mais pas encore daté (juste après la configuration) : lu du réglage.
    const conf = this.store.setting('empNetHourlyRate');
    return conf ? euro(Math.round(Number(conf) * 100)) : 'non défini';
  });
  readonly valide = computed(() => { const n = Number(String(this.taux).replace(',', '.')); return Number.isFinite(n) && n >= 0 && n <= 100 && /^\d{4}-\d{2}-\d{2}$/.test(this.dateEffet); });

  constructor() { void this.load(); }

  private async load(): Promise<void> {
    this.chargement.set(true);
    try {
      const b = await this.api.bootstrap();
      this.boot.set(b);
      if (!this.taux && b.configuredHourlyRate) this.taux = String(b.configuredHourlyRate);
      const e = b.employees[0];
      if (e) this.rates.set((await this.api.rates(e.id)).rates);
    } catch { /* module injoignable : la section reste, sans données */ }
    this.chargement.set(false);
  }

  frDate(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }

  async creer(): Promise<void> {
    if (!this.nom.trim() || this.busy()) return;
    this.busy.set(true); this.erreur.set('');
    try { await this.api.createEmployee(this.nom.trim(), this.role); await this.load(); this.nom = ''; }
    catch (e) { this.erreur.set((e as Error).message || 'La création a échoué.'); }
    this.busy.set(false);
  }

  async enregistrer(): Promise<void> {
    if (!this.valide() || this.busy()) return;
    this.busy.set(true); this.erreur.set('');
    try {
      const euros = Number(String(this.taux).replace(',', '.'));
      await this.api.setRate(euros, this.dateEffet, this.employe()?.id);
      // Rafraîchir le document (le réglage courant a été écrit côté serveur) et l'historique.
      await this.store.loadState();
      await this.load();
    } catch (e) { this.erreur.set((e as Error).message || 'L’enregistrement a échoué.'); }
    this.busy.set(false);
  }
}
