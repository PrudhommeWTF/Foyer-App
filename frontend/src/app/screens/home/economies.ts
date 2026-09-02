import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TileComponent } from '../../shared/tile';
import { fmtEurosInt } from '../../core/finances.store';
import { EconomiesTileData } from '../../core/tiles/economies.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-economies',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent],
  template: `
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="amt f-display">{{ eur(d.pending) }} € <span class="par-an">par an</span></div>
        <div class="note">{{ d.open }} piste{{ d.open > 1 ? 's' : '' }} en attente@if (d.done) { , {{ eur(d.done) }} € déjà gagnés }</div>
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .amt { font-size: 26px; font-weight: 700; color: var(--sage-dark); }
    .par-an { font-size: 14px; color: var(--ink3); font-weight: 700; }
    .note { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 8px; }
  `],
})
export class EconomiesTile extends HomeTile<EconomiesTileData> {
  eur = fmtEurosInt;
}
