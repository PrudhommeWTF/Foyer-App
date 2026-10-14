import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS } from '../../core/constants';
import { relTime } from '../../core/activity';
import { PlaceItem } from '../../core/models';
import { ItemCtx } from '../../core/items';

/** La fiche d'une affaire, en lecture : où elle est, qui l'a dit et quand, et dans quel lieu. */
@Component({
  selector: 'app-place-item-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let it = item();
    <div class="row">
      <span class="ic" [class.there]="it.state === 'la-bas'"><f-icon [name]="it.state === 'la-bas' ? 'map-pin' : 'home'" [size]="17" [color]="it.state === 'la-bas' ? '#fff' : 'var(--ink2)'" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ it.state === 'la-bas' ? 'Sur place' : 'À la maison' }}@if (it.qty) { <span class="qty">{{ it.qty }}</span> }</div>
        @if (by()) { <div class="sub">{{ by() }}</div> }</div>
    </div>
    @if (place(); as p) {
      <div class="row">
        <span class="ic" [style.background]="p.color"><f-icon [path]="LIST_ICONS[p.icon] || LIST_ICONS['voyage']" [size]="17" color="#fff" /></span>
        <div class="txt"><div class="main">{{ p.name }}</div><div class="sub">Lieu</div></div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; }
    .row + .row { border-top: 1px solid var(--line); }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .ic.there { background: var(--sage); }
    .txt { flex: 1; min-width: 0; }
    .main { display: flex; align-items: baseline; gap: 10px; font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .qty { font-size: 13px; font-weight: 800; color: var(--ink3); }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
  `],
})
export class PlaceItemView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<PlaceItem>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly LIST_ICONS = LIST_ICONS;

  readonly place = computed(() => this.store.d().places.find((p) => p.id === this.item().placeId) ?? null);
  /** Le dernier geste : qui a dit « laissé » ou « ramené », et quand. */
  readonly by = computed(() => {
    const it = this.item(); if (!it.by) return '';
    return 'Dernier geste par ' + (this.store.memberName(it.by) || 'un membre') + (it.at ? ', ' + relTime(it.at, Date.now()) : '');
  });
}
