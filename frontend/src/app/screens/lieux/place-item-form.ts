import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { PlaceItem } from '../../core/models';
import { PlaceItemFields, placeItemFields } from '../../core/place-item';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/**
 * Le formulaire d'une affaire : renommer, quantité, changer de lieu. L'état
 * n'y est pas : « J'ai laissé » et « J'ai ramené » sont des gestes, sur la
 * ligne comme dans la fiche. Une affaire se crée par le champ d'ajout du lieu.
 */
@Component({
  selector: 'app-place-item-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @let v = f();
    <div class="name-row">
      <div class="grow">
        <div class="field-label">Affaire</div>
        <input class="input" placeholder="Ex : Skis" [ngModel]="v.name" (ngModelChange)="set({ name: $event })" />
      </div>
      <div class="qty-f">
        <div class="field-label">Quantité</div>
        <input class="input" placeholder="x1" [ngModel]="v.qty" (ngModelChange)="set({ qty: $event })" />
      </div>
    </div>
    <div class="field-label">Lieu</div>
    <div class="seg-wrap">
      @for (p of store.placesInOrder(); track p.id) {
        <button type="button" class="seg-opt" [class.on]="v.placeId === p.id" (click)="set({ placeId: p.id })">
          <span class="s-dot" [style.background]="p.color"></span>{{ p.name }}
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .name-row { display: flex; gap: 12px; margin-bottom: 16px; }
    .grow { flex: 1; min-width: 0; }
    .qty-f { width: 110px; flex: none; }
    .seg-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
    .seg-opt { display: flex; align-items: center; gap: 7px; padding: 11px 15px; border-radius: 11px; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; background: var(--soft2); color: var(--ink2); border: 2px solid transparent; }
    .seg-opt.on { background: var(--primary); color: #fff; }
    .s-dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
  `],
})
export class PlaceItemForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  readonly item = input<PlaceItem | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);

  readonly f = signal<PlaceItemFields>({ name: '', qty: '', placeId: '' });
  private initial = '';
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);

  ngOnInit(): void {
    const it = this.item();
    if (it) this.f.set(placeItemFields(it));
    this.initial = JSON.stringify(this.f());
  }
  submit(): ItemResult {
    const it = this.item();
    if (!it) { this.store.toast('Ajoutez une affaire depuis son lieu'); return { kind: 'invalid' }; }
    return this.store.savePlaceItem(it.id, this.f());
  }
  set(p: Partial<PlaceItemFields>): void { this.f.update((f) => ({ ...f, ...p })); }
}
