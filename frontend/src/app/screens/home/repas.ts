import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TileComponent } from '../../shared/tile';
import { RepasTileData } from '../../core/tiles/repas.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-repas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent],
  template: `
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="dish f-display">{{ d.name }}</div>
        <div class="meta">{{ d.meta }}</div>
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .dish { font-size: 24px; font-weight: 700; color: var(--ink); line-height: 1.1; }
    .meta { font-size: 13px; font-weight: 700; color: var(--ink2); margin-top: 6px; }
  `],
})
export class RepasTile extends HomeTile<RepasTileData> {}
