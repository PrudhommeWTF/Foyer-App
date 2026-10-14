import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS, PALETTE } from '../../core/constants';
import { Place } from '../../core/models';
import { PlaceFields, placeFields } from '../../core/place-item';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/** Le formulaire d'un lieu : nom, note (adresse, code de la boîte à clés), couleur, icône. */
@Component({
  selector: 'app-place-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @let v = f();
    <div class="field-label">Nom du lieu</div>
    <input class="input mb" placeholder="Ex : Chalet de la montagne, Mobil-home…" [ngModel]="v.name" (ngModelChange)="set({ name: $event })" />
    <div class="field-label">Note <span class="opt">(facultatif)</span></div>
    <input class="input mb" placeholder="Adresse, code de la boîte à clés…" [ngModel]="v.note" (ngModelChange)="set({ note: $event })" />
    <div class="field-label">Couleur</div>
    <div class="swatch-row mb">
      @for (c of PALETTE; track c) {
        <button type="button" class="swatch" [style.background]="c" [style.box-shadow]="v.color === c ? '0 0 0 3px var(--surface), 0 0 0 5px ' + c : ''"
                (click)="set({ color: c })" [attr.aria-label]="'Couleur ' + ($index + 1)" [attr.aria-pressed]="v.color === c"></button>
      }
    </div>
    <div class="field-label">Icône</div>
    <div class="icon-grid">
      @for (k of iconKeys; track k) {
        <button type="button" class="icon-cell" [style.background]="v.icon === k ? v.color : 'var(--soft2)'" (click)="set({ icon: k })" [attr.aria-pressed]="v.icon === k" [attr.aria-label]="k">
          <f-icon [path]="LIST_ICONS[k]" [size]="20" [color]="v.icon === k ? '#fff' : 'var(--ink2)'" />
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mb { margin-bottom: 20px; }
    .opt { color: var(--ink3); font-weight: 700; text-transform: none; letter-spacing: 0; }
    .icon-grid { display: flex; flex-wrap: wrap; gap: 9px; }
    .icon-cell { width: 42px; height: 42px; border: none; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  `],
})
export class PlaceForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  readonly item = input<Place | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly LIST_ICONS = LIST_ICONS;
  readonly PALETTE = PALETTE;
  readonly iconKeys = Object.keys(LIST_ICONS);

  readonly f = signal<PlaceFields>(placeFields(null));
  private initial = '';
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);

  ngOnInit(): void { this.f.set(placeFields(this.item())); this.initial = JSON.stringify(this.f()); }
  submit(): ItemResult { return this.store.savePlace(this.item()?.id ?? null, this.f()); }
  set(p: Partial<PlaceFields>): void { this.f.update((f) => ({ ...f, ...p })); }
}
