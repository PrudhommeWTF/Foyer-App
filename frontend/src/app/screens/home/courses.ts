import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { IconComponent } from '../../core/icon';
import { QuickAddComponent } from '../../shared/quick-add';
import { TileComponent } from '../../shared/tile';
import { CoursesTileData } from '../../core/tiles/courses.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-courses',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent, IconComponent, QuickAddComponent],
  template: `
    <f-tile [title]="tile().title" [badge]="badge()" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="shop-grid">
          @for (it of d.items; track it.id) {
            <div class="shop-it" (click)="store.toggleShopWithUndo(it.id)">
              <span class="tick" [class.on]="it.state === 'panier'">
                @if (it.state === 'panier') { <f-icon name="check" [size]="11" color="#fff" [width]="3.6" /> }
              </span>
              <span class="shop-name" [class.done]="it.state === 'panier'">{{ it.name }}</span>
              <span class="shop-qty">{{ it.qty }}</span>
            </div>
          }
        </div>
      }
      @if (state().kind !== 'error' && state().kind !== 'loading') {
        <f-quick-add label="Ajouter un article" placeholder="Ex : farine"
                     [suggestions]="suggestions()" (typed)="query.set($event)"
                     (submitted)="store.addShop($event)" />
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .shop-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
    :host-context(.shell.narrow) .shop-grid { grid-template-columns: 1fr; }
    .shop-it { display: flex; align-items: center; gap: 11px; cursor: pointer; }
    .shop-name { flex: 1; font-size: 13.5px; font-weight: 700; color: var(--ink); }
    .shop-name.done { color: var(--ink3); text-decoration: line-through; }
    .shop-qty { font-size: 12px; font-weight: 700; color: var(--ink3); }
  `],
})
export class CoursesTile extends HomeTile<CoursesTileData> {
  readonly badge = computed(() => { const d = this.data(); return d ? d.left + ' restant' + (d.left > 1 ? 's' : '') : ''; });

  /** Ce qui est tapé, pour que le module propose ce qu'il connaît. */
  readonly query = signal('');
  readonly suggestions = computed(() => this.store.shopSuggestions(this.query()));
}
