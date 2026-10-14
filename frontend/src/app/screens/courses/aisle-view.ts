import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { RAYONS } from '../../core/articles';
import { Aisle } from '../../core/models';
import { ItemCtx } from '../../core/items';

/** La fiche d'un rayon, en lecture : sa place dans le parcours du magasin, son type, ce qu'il porte. */
@Component({
  selector: 'app-aisle-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let a = item();
    <div class="row">
      <span class="ic"><span class="dot" [style.background]="a.color"></span></span>
      <div class="txt"><div class="main">{{ place() }}</div><div class="sub">Dans l'ordre du magasin</div></div>
    </div>
    <div class="row">
      <span class="ic"><f-icon name="courses" [size]="17" color="var(--ink2)" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ count() ? count() + ' article' + (count() > 1 ? 's' : '') + ' en liste' : 'Aucun article en liste' }}</div></div>
    </div>
    <div class="row">
      <span class="ic"></span>
      <div class="txt"><div class="main">{{ kind() }}</div>
        <div class="sub">{{ a.kind ? 'Range les ingrédients générés depuis les repas' : 'Type de rayon' }}</div></div>
    </div>
    @if (fallback()) { <div class="note">Rayon de repli : un article saisi sans rayon connu atterrit ici. Il ne se supprime pas.</div> }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; }
    .row + .row { border-top: 1px solid var(--line); }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .dot { width: 14px; height: 14px; border-radius: 4px; }
    .txt { flex: 1; min-width: 0; }
    .main { font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .note { margin-top: 6px; padding: 9px 12px; border-radius: 12px; background: var(--soft); font-size: 12.5px; font-weight: 700; color: var(--ink2); }
  `],
})
export class AisleView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<Aisle>();
  readonly ctx = input<ItemCtx | undefined>(undefined);

  readonly place = computed(() => {
    const all = this.store.aislesInOrder(), i = all.findIndex((a) => a.id === this.item().id);
    return i < 0 ? '' : (i === 0 ? '1er' : (i + 1) + 'e') + ' rayon sur ' + all.length;
  });
  readonly count = computed(() => this.store.d().shop.filter((x) => x.aisleId === this.item().id).length);
  readonly kind = computed(() => RAYONS.find((r) => r.key === this.item().kind)?.name || 'Aucun type');
  readonly fallback = computed(() => this.item().id === this.store.defaultAisleId());
}
