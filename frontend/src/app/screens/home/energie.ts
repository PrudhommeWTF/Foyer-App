import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FinancesStore } from '../../core/finances.store';
import { QuickAddComponent } from '../../shared/quick-add';
import { TileComponent } from '../../shared/tile';
import { EnergieTileData } from '../../core/tiles/energie.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-energie',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent, QuickAddComponent],
  template: `
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()" [raison]="raison()" [collapsed]="collapsed()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="lines">
          @for (r of d.due; track r.contractId) {
            <div class="line">
              <div class="name">{{ r.name }}@if (r.provider) { <span class="prov"> · {{ r.provider }}</span> }</div>
              <div class="since">{{ depuis(r.daysSince) }}</div>
              <!-- Le relevé se saisit là où il est réclamé : l'index, et rien d'autre. -->
              <f-quick-add label="Saisir l’index" placeholder="Ex : 12480"
                           (submitted)="fin.quickReading(r.contractId, $event)" />
            </div>
          }
        </div>
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .lines { display: flex; flex-direction: column; gap: 12px; }
    .line { padding: 11px 13px; border-radius: 14px; background: var(--soft); }
    .name { font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .prov { font-weight: 700; color: var(--ink2); }
    .since { font-size: 12px; font-weight: 700; color: var(--ink2); margin-top: 3px; }
  `],
})
export class EnergieTile extends HomeTile<EnergieTileData> {
  fin = inject(FinancesStore);

  /** Un compteur jamais lu ne se dit pas « en retard de zéro jour ». */
  depuis(days: number | null): string {
    if (days === null) return 'Jamais relevé';
    if (days < 60) return `Dernier relevé il y a ${days} jours`;
    return `Dernier relevé il y a ${Math.round(days / 30)} mois`;
  }
}
