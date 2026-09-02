import { ChangeDetectionStrategy, Component } from '@angular/core';
import { inject } from '@angular/core';
import { TileComponent } from '../../shared/tile';
import { FinancesStore } from '../../core/finances.store';
import { inDaysLabel } from '../../core/deadlines';
import { IconComponent } from '../../core/icon';
import { EcheancesTileData } from '../../core/tiles/echeances.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-echeances',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent, IconComponent],
  template: `
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()" [raison]="raison()" [collapsed]="collapsed()"
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
              <!-- « J'ai vu, je m'en occupe » : l'échéance devient une tâche du
                   foyer, qui appartient ensuite à qui la coche. -->
              <button class="ack" title="En faire une tâche" (click)="fin.taskFromDeadline(l.deadline)">
                <f-icon name="plus" [size]="14" color="var(--ink2)" [width]="2.6" />
              </button>
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
    .ack { flex: none; align-self: center; border: none; background: none; cursor: pointer; padding: 4px; display: flex; border-radius: 8px; }
    .ack:hover { background: rgba(0,0,0,.05); }
  `],
})
export class EcheancesTile extends HomeTile<EcheancesTileData> {
  fin = inject(FinancesStore);
  quand = inDaysLabel;
}
