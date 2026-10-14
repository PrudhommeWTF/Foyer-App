import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { EmployesStore } from '../../core/employes.store';
import { decHours } from '../../core/employe.format';
import { EmpShift } from '../../core/employes.api';
import { ShiftFields, shiftFields, shiftPatch, stepMinutes } from '../../core/employe-form';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/**
 * Le formulaire d'une présence : le jour, la durée au quart d'heure, une note.
 * Le serveur tranche (doublon le même jour, mois figé) : la fiche attend sa
 * réponse et reste ouverte s'il refuse.
 */
@Component({
  selector: 'app-shift-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @let v = f();
    <div class="field-label">Date</div>
    <input class="input" type="date" [ngModel]="v.day" (ngModelChange)="set({ day: $event || '' })" />
    <div class="field-label mt">Durée</div>
    <div class="stepper">
      <button type="button" (click)="step(-15)" aria-label="Moins un quart d’heure">−</button>
      <span>{{ decH(v.minutes) }}</span>
      <button type="button" (click)="step(15)" aria-label="Plus un quart d’heure">+</button>
    </div>
    <div class="field-label mt">Note (facultatif)</div>
    <input class="input" [ngModel]="v.note" (ngModelChange)="set({ note: $event })" placeholder="Ex : grand ménage" maxlength="500" />
  `,
  styles: [`
    :host { display: block; }
    .mt { margin-top: 16px; }
    .stepper { display: flex; align-items: center; gap: 14px; padding: 8px; border-radius: 14px; background: var(--soft); width: fit-content; }
    .stepper button { border: none; background: var(--surface); width: 44px; height: 44px; border-radius: 11px; font-size: 22px; font-weight: 800; cursor: pointer; color: var(--ink); }
    .stepper span { font-size: 17px; font-weight: 800; min-width: 64px; text-align: center; color: var(--ink); }
  `],
})
export class ShiftForm implements ItemForm, OnInit {
  readonly foyer = inject(FoyerStore);
  readonly emp = inject(EmployesStore);
  readonly item = input<EmpShift | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly decH = decHours;

  readonly f = signal<ShiftFields>({ day: '', minutes: 180, note: '' });
  private initial = '';
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);

  ngOnInit(): void {
    // Par défaut : aujourd'hui sur le mois en cours, le 1er sur un mois passé ;
    // la durée habituelle réglée dans les Paramètres.
    const today = this.foyer.todayStr(), mois = this.emp.month();
    this.f.set(shiftFields(this.item(), { day: today.startsWith(mois) ? today : mois + '-01', minutes: this.emp.dureeHabituelle() }));
    this.initial = JSON.stringify(this.f());
  }

  async submit(): Promise<ItemResult> {
    const v = this.f(), s = this.item();
    if (!v.day) { this.foyer.toast('Indique la date'); return { kind: 'invalid' }; }
    if (!s) {
      const r = await this.emp.ajouterPresence(v.day, v.minutes, v.note);
      if (r === 'doublon') this.foyer.toast('Une présence existe déjà ce jour : ajustez-la plutôt.');
      return r === 'ok' ? { kind: 'done' } : { kind: 'invalid' };
    }
    const patch = shiftPatch(s, v);
    if (!Object.keys(patch).length) return { kind: 'done' };
    return (await this.emp.ajuster(s.id, patch)) ? { kind: 'done' } : { kind: 'invalid' };
  }

  set(p: Partial<ShiftFields>): void { this.f.update((f) => ({ ...f, ...p })); }
  step(delta: number): void { this.set({ minutes: stepMinutes(this.f().minutes, delta) }); }
}
