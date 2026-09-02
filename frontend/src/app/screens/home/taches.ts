import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { AvatarComponent } from '../../shared/avatar';
import { TileComponent } from '../../shared/tile';
import { TachesTileData } from '../../core/tiles/taches.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-taches',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent, AvatarComponent],
  template: `
    <f-tile [title]="tile().title" [badge]="badge()" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="tasks">
          @for (l of d.lines; track l.task.id) {
            <div class="task">
              <span class="tick" (click)="store.toggleTask(l.task.id)"></span>
              <span class="ttext">
                {{ l.task.text }}
                @if (l.late) { <span class="late">depuis {{ lateLabel(l.late) }}</span> }
              </span>
              <f-avatar [ini]="store.memberIni(l.task.who)" [color]="store.memberColor(l.task.who)" [size]="18" />
            </div>
          }
        </div>
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .tasks { display: flex; flex-direction: column; gap: 10px; }
    .task { display: flex; align-items: center; gap: 11px; }
    .ttext { flex: 1; font-size: 13.5px; font-weight: 700; color: var(--ink); }
    /* Le retard se dit, il ne crie pas : c'est une précision, pas une alarme. */
    .late { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-left: 6px; white-space: nowrap; }
  `],
})
export class TachesTile extends HomeTile<TachesTileData> {
  /** Le compteur ne s'affiche que s'il y a quelque chose pour aujourd'hui. */
  readonly badge = computed(() => { const d = this.data(); return d && d.due ? d.due + ' aujourd’hui' : ''; });

  lateLabel(days: number): string {
    if (days < 7) return days + (days > 1 ? ' jours' : ' jour');
    if (days < 60) { const w = Math.round(days / 7); return w + (w > 1 ? ' semaines' : ' semaine'); }
    return Math.round(days / 30) + ' mois';
  }
}
