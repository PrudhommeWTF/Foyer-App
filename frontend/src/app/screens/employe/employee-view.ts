import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { EmployesStore } from '../../core/employes.store';
import { IconComponent } from '../../core/icon';
import { decHours, eurosFmt } from '../../core/employe.format';
import { EmpEmployee, EmpRate, EmployesApi, empRoleLabel } from '../../core/employes.api';
import { ItemCtx } from '../../core/items';

/** La fiche d'un employé, en lecture : sa catégorie CESU, son taux et leur historique, ses heures du mois. */
@Component({
  selector: 'app-employee-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let e = item();
    <div class="row">
      <span class="ic"><f-icon name="users" [size]="17" color="#9B6FA8" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ role() }}</div><div class="sub">Catégorie CESU</div></div>
    </div>
    <div class="row">
      <span class="ic"><f-icon name="clock" [size]="17" color="var(--ink2)" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ hours() }}</div><div class="sub">ce mois-ci</div></div>
    </div>
    <div class="row">
      <span class="ic"><f-icon name="budget" [size]="17" color="#7A9B76" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ e.currentRate ? euro(e.currentRate.netHourlyCents) + ' net de l’heure' : 'Taux non défini' }}</div>
        @if (e.currentRate; as cr) { <div class="sub">depuis le {{ frDate(cr.effectiveFrom) }}</div> }</div>
    </div>
    @if (rates().length > 1) {
      <div class="overline">Historique des taux</div>
      <ul class="hist">@for (r of rates(); track r.id) { <li><b>{{ euro(r.netHourlyCents) }}</b> à partir du {{ frDate(r.effectiveFrom) }}</li> }</ul>
    }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; }
    .row + .row { border-top: 1px solid var(--line); }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .txt { flex: 1; min-width: 0; }
    .main { font-size: 15px; font-weight: 800; color: var(--ink); }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .overline { margin: 12px 0 4px; }
    .hist { margin: 0; padding-left: 18px; }
    .hist li { font-size: 13px; font-weight: 600; color: var(--ink2); margin: 3px 0; }
  `],
})
export class EmployeeView {
  readonly emp = inject(EmployesStore);
  private api = inject(EmployesApi);
  readonly item = input.required<EmpEmployee>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly euro = eurosFmt;

  readonly role = computed(() => empRoleLabel(this.item().role));
  readonly hours = computed(() => decHours(this.emp.minutesOf(this.item().id)));
  /** L'historique des taux, lu au serveur à l'ouverture et quand le taux courant change. */
  readonly rates = signal<EmpRate[]>([]);
  private readonly rateKey = computed(() => this.item().id + '|' + (this.item().currentRate?.effectiveFrom || '') + '|' + (this.item().currentRate?.netHourlyCents ?? ''));

  constructor() {
    effect(() => {
      const id = this.item().id; this.rateKey();
      this.api.rates(id).then((r) => this.rates.set(r.rates), () => this.rates.set([]));
    });
  }
  frDate(iso: string): string { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }
}
