import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AvatarComponent } from '../../shared/avatar';
import { TileComponent } from '../../shared/tile';
import { AgendaTileData } from '../../core/tiles/agenda.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-agenda',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent, AvatarComponent],
  template: `
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="agenda">
          @for (e of d.events; track e.id) {
            <div class="ev" [style.border-left]="'4px solid ' + store.memberColor(e.who)">
              <div class="ev-time f-display">{{ e.time }}</div>
              <div class="ev-body">
                <div class="ev-title">{{ e.title }}</div>
                <div class="ev-who">
                  <f-avatar [ini]="store.memberIni(e.who)" [color]="store.memberColor(e.who)" [size]="18" />
                  <span>{{ store.memberName(e.who) }}</span>
                </div>
              </div>
            </div>
          }
        </div>
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .agenda { display: flex; flex-direction: column; gap: 12px; }
    .ev { display: flex; gap: 14px; padding: 14px; border-radius: 16px; background: var(--soft); }
    .ev-time { font-size: 16px; font-weight: 700; color: var(--ink); min-width: 48px; }
    .ev-title { font-weight: 800; font-size: 15px; color: var(--ink); }
    .ev-who { display: flex; align-items: center; gap: 6px; margin-top: 5px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
  `],
})
export class AgendaTile extends HomeTile<AgendaTileData> {}
