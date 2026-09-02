import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IconComponent } from '../../core/icon';
import { QuickAddComponent } from '../../shared/quick-add';
import { TileComponent } from '../../shared/tile';
import { RepasTileData } from '../../core/tiles/repas.tile';
import { HomeTile } from './base';

/** Le créneau que l'accueil met en avant. Il vient du fournisseur, pas d'ici. */
const SLOT = 'soir';

@Component({
  selector: 'tile-repas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent, IconComponent, QuickAddComponent],
  template: `
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="dish f-display">{{ d.name }}</div>
        <div class="meta">{{ d.meta }} · {{ d.pax }}</div>
        @for (a of d.alerts; track $index) {
          <div class="alert">
            <f-icon name="urgent" [size]="14" color="#C6492F" [width]="2.4" />
            <span>{{ a }}</span>
          </div>
        }
      }
      @if (state().kind !== 'error' && state().kind !== 'loading') {
        <f-quick-add [label]="data() ? 'Finalement, autre chose' : 'Décider maintenant'"
                     placeholder="Ex : pizza, restes"
                     (submitted)="store.setMealText(store.todayStr(), slot, $event)" />
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .dish { font-size: 24px; font-weight: 700; color: var(--ink); line-height: 1.1; }
    .meta { font-size: 13px; font-weight: 700; color: var(--ink2); margin-top: 6px; }
    /* Une alerte alimentaire ne se range pas discrètement : c'est la seule chose
       de cet écran qui peut envoyer quelqu'un aux urgences. */
    .alert { display: flex; align-items: center; gap: 7px; margin-top: 10px; padding: 8px 11px; border-radius: 12px;
             background: #FCE9E3; color: #C6492F; font-size: 12.5px; font-weight: 800; }
  `],
})
export class RepasTile extends HomeTile<RepasTileData> {
  slot = SLOT;
}
