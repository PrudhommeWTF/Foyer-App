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
          @for (t of d.items; track t.id) {
            <div class="task">
              <span class="tick" (click)="store.toggleTask(t.id)"></span>
              <span class="ttext">{{ t.text }}</span>
              <f-avatar [ini]="store.memberIni(t.who)" [color]="store.memberColor(t.who)" [size]="18" />
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
  `],
})
export class TachesTile extends HomeTile<TachesTileData> {
  readonly badge = computed(() => { const d = this.data(); return d ? String(d.open) : ''; });
}
