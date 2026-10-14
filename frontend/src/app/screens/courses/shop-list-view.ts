import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS } from '../../core/constants';
import { ShopList } from '../../core/models';
import { ItemCtx } from '../../core/items';

/** La fiche d'une liste de courses, en lecture : ce qu'il reste à prendre, et la tâche qui l'ouvre. */
@Component({
  selector: 'app-shop-list-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let l = item();
    <div class="row">
      <span class="ic" [style.background]="l.color"><f-icon [path]="LIST_ICONS[l.icon] || LIST_ICONS['panier']" [size]="18" color="#fff" /></span>
      <div class="txt"><div class="main">{{ counts().toTake ? counts().toTake + ' à prendre' : 'Rien à prendre' }}</div>
        @if (counts().rest) { <div class="sub">{{ counts().rest }}</div> }</div>
    </div>
    @if (task(); as t) {
      <!-- La tâche qui ouvre la liste s'ouvre par-dessus, et le retour ramène ici. -->
      <button type="button" class="row link" (click)="store.openItem('task', t.id, undefined, true)">
        <span class="ic"><f-icon name="checklist" [size]="17" color="var(--ink2)" [width]="2.2" /></span>
        <div class="txt"><div class="main">{{ t.text }}</div><div class="sub">Tâche ouverte</div></div>
        <f-icon name="chevronRight" [size]="16" color="var(--ink3)" [width]="2.2" />
      </button>
    }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 13px; width: 100%; padding: 11px 0; border: none; background: none; font: inherit; text-align: left; }
    .row + .row { border-top: 1px solid var(--line); }
    .row.link { cursor: pointer; }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .txt { flex: 1; min-width: 0; }
    .main { font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
  `],
})
export class ShopListView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<ShopList>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly LIST_ICONS = LIST_ICONS;

  readonly counts = computed(() => {
    const items = this.store.d().shop.filter((x) => x.listId === this.item().id);
    const n = (st: string) => items.filter((x) => x.state === st).length;
    const coches = n('panier'), introuvables = n('indisponible');
    return { toTake: n('a-prendre'), rest: [coches ? coches + ' coché' + (coches > 1 ? 's' : '') : '', introuvables ? introuvables + ' introuvable' + (introuvables > 1 ? 's' : '') : ''].filter(Boolean).join(', ') };
  });
  readonly task = computed(() => this.store.shoppingTask(this.item().id));
}
