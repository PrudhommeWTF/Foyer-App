import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { EmployesStore } from '../../core/employes.store';
import { EMP_ROLES, EmpEmployee } from '../../core/employes.api';
import { EmployeeFields, employeeFields, parseRate } from '../../core/employe-form';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/**
 * Le formulaire d'un employé (administrateur) : à la création, prénom et nom,
 * catégorie CESU et taux ; ensuite, le nom, la catégorie, et un nouveau taux
 * daté (l'historique est gardé, un mois déjà déclaré n'est pas recalculé).
 */
@Component({
  selector: 'app-employee-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @let v = f();
    @if (!item()) {
      <div class="field-label">Prénom et nom</div>
      <div class="two">
        <input class="input" [ngModel]="v.first" (ngModelChange)="set({ first: $event })" placeholder="Prénom" maxlength="60" />
        <input class="input" [ngModel]="v.last" (ngModelChange)="set({ last: $event })" placeholder="Nom" maxlength="60" />
      </div>
    } @else {
      <div class="field-label">Nom</div>
      <input class="input" [ngModel]="v.name" (ngModelChange)="set({ name: $event })" placeholder="Prénom et nom" maxlength="120" />
    }
    <div class="field-label mt">Catégorie (CESU)</div>
    <select class="input" [ngModel]="v.role" (ngModelChange)="set({ role: $event })">
      @for (r of roles; track r.id) { <option [value]="r.id">{{ r.label }}</option> }
    </select>
    <div class="two mt">
      <label class="lab">{{ item() ? 'Nouveau taux (€/h)' : 'Taux horaire net (€/h)' }}
        <input class="input" type="number" inputmode="decimal" min="0" max="100" step="0.01" [ngModel]="v.rate" (ngModelChange)="set({ rate: $event ?? '' })" placeholder="14,50" />
      </label>
      @if (item()) {
        <label class="lab">Date d’effet<input class="input" type="date" [ngModel]="v.from" (ngModelChange)="set({ from: $event || '' })" /></label>
      }
    </div>
    <div class="hint">{{ item() ? 'Laisser vide pour garder le taux actuel. Un nouveau taux s’applique à partir de sa date, sans recalculer un mois déjà déclaré.' : 'Le taux se déclare au CESU. Il pourra changer plus tard (historique daté), sans recalculer un mois déjà déclaré.' }}</div>
  `,
  styles: [`
    :host { display: block; }
    .mt { margin-top: 16px; }
    select.input { appearance: auto; width: 100%; }
    .two { display: flex; gap: 10px; }
    .two .input { flex: 1; min-width: 0; width: 100%; box-sizing: border-box; }
    .lab { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .04em; }
    .hint { font-size: 12px; font-weight: 600; color: var(--ink3); margin-top: 8px; line-height: 1.5; }
  `],
})
export class EmployeeForm implements ItemForm, OnInit {
  readonly foyer = inject(FoyerStore);
  readonly emp = inject(EmployesStore);
  readonly item = input<EmpEmployee | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly roles = EMP_ROLES;

  readonly f = signal<EmployeeFields>(employeeFields(null, ''));
  private initial = '';
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);

  ngOnInit(): void { this.f.set(employeeFields(this.item(), this.foyer.todayStr())); this.initial = JSON.stringify(this.f()); }
  set(p: Partial<EmployeeFields>): void { this.f.update((f) => ({ ...f, ...p })); }

  async submit(): Promise<ItemResult> {
    const v = this.f(), e = this.item();
    const typed = String(v.rate ?? '').trim() !== '', rate = parseRate(v.rate);
    if (typed && rate === null) { this.foyer.toast('Le taux doit être un nombre entre 0 et 100'); return { kind: 'invalid' }; }
    try {
      if (!e) {
        const name = `${v.first.trim()} ${v.last.trim()}`.trim();
        if (!name) { this.foyer.toast('Indique le prénom et le nom'); return { kind: 'invalid' }; }
        await this.emp.creerEmploye(name, v.role, rate ?? undefined);
        this.foyer.toast('Employé ajouté');
        return { kind: 'done' };
      }
      const name = v.name.trim();
      if (!name) { this.foyer.toast('Indique le nom'); return { kind: 'invalid' }; }
      if (name !== e.name || v.role !== e.role) await this.emp.modifierEmploye(e.id, { name, role: v.role });
      if (rate !== null) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v.from)) { this.foyer.toast('Indique la date d’effet du taux'); return { kind: 'invalid' }; }
        await this.emp.reglerTaux(e.id, rate, v.from);
      }
      return { kind: 'done' };
    } catch (err) {
      // Le message du serveur dit quoi faire : le relayer tel quel, la fiche reste ouverte.
      this.foyer.toast((err as Error).message || 'L’enregistrement a échoué.');
      return { kind: 'invalid' };
    }
  }
}
