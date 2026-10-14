import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { relTime } from '../../core/activity';
import { ShopItem } from '../../core/models';
import { ItemCtx } from '../../core/items';

/** Ce que dit l'état d'un article : « panier » reste la valeur en base, lue « coché » à l'écran. */
const STATE_LABELS = { 'a-prendre': 'À prendre', panier: 'Coché', indisponible: 'Introuvable' } as const;

/** La fiche d'un article, en lecture : sa photo, son état et qui l'a posé, son rayon, sa liste. */
@Component({
  selector: 'app-shop-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let it = item();
    @if (store.photoUrl(it.photoId); as ph) { <div class="photo" [style.background-image]="'url(' + ph + ')'"></div> }
    <div class="row">
      <span class="ic" [class.done]="it.state === 'panier'" [class.unavail]="it.state === 'indisponible'">
        <f-icon [name]="it.state === 'indisponible' ? 'x' : 'check'" [size]="17" [color]="it.state === 'a-prendre' ? 'var(--ink3)' : '#fff'" [width]="2.6" />
      </span>
      <div class="txt"><div class="main">{{ state() }}@if (it.qty) { <span class="qty">{{ it.qty }}</span> }</div>
        @if (stateBy()) { <div class="sub">{{ stateBy() }}</div> }</div>
    </div>
    <div class="row">
      <span class="ic"><span class="dot" [style.background]="aisle()?.color || 'var(--ink3)'"></span></span>
      <div class="txt"><div class="main">{{ aisle()?.name || 'Rayon retiré' }}</div><div class="sub">Rayon</div></div>
    </div>
    <div class="row">
      <span class="ic"><f-icon name="courses" [size]="17" [color]="list()?.color || 'var(--ink3)'" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ list()?.name || 'Liste retirée' }}</div><div class="sub">Liste</div></div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .photo { height: 170px; border-radius: 16px; margin-bottom: 10px; background-size: cover; background-position: center; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; }
    .row + .row { border-top: 1px solid var(--line); }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .ic.done { background: var(--sage); }
    .ic.unavail { background: #C6492F; }
    .dot { width: 12px; height: 12px; border-radius: 4px; }
    .txt { flex: 1; min-width: 0; }
    .main { display: flex; align-items: baseline; gap: 10px; font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .qty { font-size: 13px; font-weight: 800; color: var(--ink3); }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
  `],
})
export class ShopView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<ShopItem>();
  readonly ctx = input<ItemCtx | undefined>(undefined);

  readonly state = computed(() => STATE_LABELS[this.item().state]);
  /** Qui a coché (ou dit introuvable) et quand : c'est ce que l'autre téléphone vient de faire. */
  readonly stateBy = computed(() => {
    const it = this.item(); if (it.state === 'a-prendre' || !it.by) return '';
    return 'par ' + (this.store.memberName(it.by) || 'un membre') + (it.via ? ' (' + it.via + ')' : '') + (it.at ? ', ' + relTime(it.at, Date.now()) : '');
  });
  readonly aisle = computed(() => this.store.d().aisles.find((a) => a.id === this.item().aisleId) ?? null);
  readonly list = computed(() => this.store.d().shopLists.find((l) => l.id === this.item().listId) ?? null);
}
