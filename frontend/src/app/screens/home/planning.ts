import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TileComponent } from '../../shared/tile';
import { WhoComponent } from '../../shared/who';
import { SCHED_COLORS } from '../../core/constants';
import { PlanningTileData } from '../../core/tiles/planning.tile';
import { SchedSlot } from '../../core/models';
import { whoBadges } from '../../core/schedule';
import { HomeTile } from './base';

@Component({
  selector: 'tile-planning',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent, WhoComponent],
  template: `
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()" [raison]="raison()" [collapsed]="collapsed()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="slots">
          @for (s of d.slots; track s.id) {
            <div class="slot" [style.border-left]="'4px solid ' + color(s.k)">
              <div class="hours">{{ s.end ? s.start + ' – ' + s.end : s.start }}</div>
              <div class="body">
                <div class="label">{{ s.label }}</div>
                <div class="who"><f-who [badges]="badges(s)" [size]="18" /></div>
              </div>
            </div>
          }
        </div>
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .slots { display: flex; flex-direction: column; gap: 10px; }
    .slot { display: flex; gap: 12px; padding: 11px 13px; border-radius: 14px; background: var(--soft); }
    .hours { font-size: 12.5px; font-weight: 800; color: var(--ink2); min-width: 86px; padding-top: 1px; }
    .label { font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .who { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 12px; font-weight: 700; color: var(--ink2); }
  `],
})
export class PlanningTile extends HomeTile<PlanningTileData> {
  color(k: string): string { return SCHED_COLORS[k] || 'var(--ink3)'; }
  /** Les mêmes marqueurs d'identité que l'écran : une seule source de couleurs. */
  badges(s: SchedSlot) { return whoBadges(s, this.store.data()?.members || []); }
}
