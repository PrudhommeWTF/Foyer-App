import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TileComponent } from '../../shared/tile';
import { inDaysLabel } from '../../core/deadlines';
import { EcheancesTileData } from '../../core/tiles/echeances.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-echeances',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent],
  template: `
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="lines">
          @for (l of d.lines; track l.deadline.contractId + '-' + l.deadline.date) {
            <div class="line" [class.costly]="l.costly">
              <div class="when">{{ quand(l.deadline.daysAway) }}</div>
              <div class="what">
                <div class="label">{{ l.label }}</div>
                <div class="who">{{ l.deadline.contractName }}@if (l.deadline.provider) { · {{ l.deadline.provider }} }</div>
              </div>
            </div>
          }
        </div>
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .lines { display: flex; flex-direction: column; gap: 10px; }
    .line { display: flex; gap: 12px; padding: 11px 13px; border-radius: 14px; background: var(--soft); border-left: 4px solid var(--line2); }
    /* Une fenêtre de résiliation manquée coûte une année d'abonnement : c'est la
       seule des trois échéances qui appelle un geste à date fixe. */
    .line.costly { background: #FCE9E3; border-left-color: var(--primary); }
    .when { font-size: 12px; font-weight: 800; color: var(--ink2); min-width: 74px; padding-top: 1px; }
    .line.costly .when { color: var(--primary-darker); }
    .label { font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .who { font-size: 12px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
  `],
})
export class EcheancesTile extends HomeTile<EcheancesTileData> {
  quand = inDaysLabel;
}
