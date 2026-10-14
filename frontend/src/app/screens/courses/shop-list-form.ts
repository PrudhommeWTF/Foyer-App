import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS, PALETTE } from '../../core/constants';
import { ShopList } from '../../core/models';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/** Le formulaire d'une liste de courses : nom, couleur, icône. */
@Component({
  selector: 'app-shop-list-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @let v = f();
    <div class="field-label">Nom de la liste</div>
    <input class="input mb" placeholder="Ex : Drive, Boulangerie…" [ngModel]="v.name" (ngModelChange)="set({ name: $event })" />
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
    .swatch { border: none; padding: 0; cursor: pointer; }
    .icon-grid { display: flex; flex-wrap: wrap; gap: 9px; }
    .icon-cell { width: 42px; height: 42px; border: none; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  `],
})
export class ShopListForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  readonly item = input<ShopList | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly LIST_ICONS = LIST_ICONS;
  readonly PALETTE = PALETTE;
  readonly iconKeys = Object.keys(LIST_ICONS);

  readonly f = signal({ name: '', color: '#7A9B76', icon: 'panier' });
  private initial = '';
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);

  ngOnInit(): void {
    const l = this.item();
    this.f.set(l ? { name: l.name, color: l.color, icon: l.icon || 'panier' } : { name: '', color: '#7A9B76', icon: 'panier' });
    this.initial = JSON.stringify(this.f());
  }
  submit(): ItemResult { return this.store.saveShopList(this.item()?.id ?? null, this.f()); }
  set(p: Partial<{ name: string; color: string; icon: string }>): void { this.f.update((f) => ({ ...f, ...p })); }
}
