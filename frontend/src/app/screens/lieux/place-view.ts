import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS } from '../../core/constants';
import { Place } from '../../core/models';
import { ItemCtx } from '../../core/items';

/**
 * La fiche d'un lieu, en lecture : sa note, ce qui est sur place, ce qui est
 * revenu à la maison. Une affaire s'ouvre d'un tap, par-dessus, et le retour
 * ramène ici.
 */
@Component({
  selector: 'app-place-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let p = item();
    <div class="row">
      <span class="ic" [style.background]="p.color"><f-icon [path]="LIST_ICONS[p.icon] || LIST_ICONS['voyage']" [size]="18" color="#fff" /></span>
      <div class="txt"><div class="main">{{ there().length }} sur place</div>
        @if (home().length) { <div class="sub home">{{ home().length }} à la maison, à rapporter</div> }</div>
    </div>
    @if (p.note) { <div class="note">{{ p.note }}</div> }
    @for (g of groups(); track g.label) {
      @if (g.items.length) {
        <div class="overline">{{ g.label }}</div>
        @for (it of g.items; track it.id) {
          <button type="button" class="aff" (click)="store.openItem('placeItem', it.id, undefined, true)">
            <span class="dot" [class.there]="it.state === 'la-bas'"></span>
            <span class="a-name">{{ it.name }}</span>
            @if (it.qty) { <span class="a-qty">{{ it.qty }}</span> }
            <f-icon name="chevronRight" [size]="15" color="var(--ink3)" [width]="2.2" />
          </button>
        }
      }
    }
    @if (!there().length && !home().length) { <div class="empty">Aucune affaire notée pour ce lieu.</div> }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .txt { flex: 1; min-width: 0; }
    .main { font-size: 15px; font-weight: 800; color: var(--ink); }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .sub.home { color: #C6492F; }
    .note { margin: 2px 0 10px; padding: 9px 12px; border-radius: 12px; background: var(--soft); font-size: 13px; font-weight: 600; color: var(--ink2); overflow-wrap: anywhere; white-space: pre-line; }
    .overline { margin: 12px 0 4px; }
    .aff { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 44px; padding: 8px 2px; border: none; border-top: 1px solid var(--line); background: none; font: inherit; text-align: left; cursor: pointer; }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--line2); }
    .dot.there { background: var(--sage); }
    .a-name { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .a-qty { font-size: 12.5px; font-weight: 800; color: var(--ink3); }
    .empty { color: var(--ink2); font-weight: 700; font-size: 13.5px; padding: 8px 0; }
  `],
})
export class PlaceView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<Place>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly LIST_ICONS = LIST_ICONS;

  private readonly items = computed(() => this.store.itemsOfPlace(this.item().id).slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')));
  readonly there = computed(() => this.items().filter((i) => i.state === 'la-bas'));
  readonly home = computed(() => this.items().filter((i) => i.state === 'ici'));
  readonly groups = computed(() => [{ label: 'Sur place', items: this.there() }, { label: 'À la maison', items: this.home() }]);
}
