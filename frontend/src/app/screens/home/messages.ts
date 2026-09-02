import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AvatarComponent } from '../../shared/avatar';
import { TileComponent } from '../../shared/tile';
import { MessagesTileData } from '../../core/tiles/messages.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-messages',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent, AvatarComponent],
  template: `
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="msgs">
          @for (m of d.msgs; track $index) {
            <div class="msg">
              <f-avatar [ini]="store.memberIni(m.who)" [color]="store.memberColor(m.who)" [size]="30" />
              <div>
                <div class="msg-name">{{ store.memberName(m.who) }} · {{ m.time }}</div>
                <div class="msg-text">{{ m.text }}</div>
              </div>
            </div>
          }
        </div>
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .msgs { display: flex; flex-direction: column; gap: 12px; }
    .msg { display: flex; gap: 10px; }
    .msg-name { font-size: 12px; font-weight: 800; color: var(--ink2); }
    .msg-text { font-size: 13px; font-weight: 700; color: var(--ink); line-height: 1.3; }
  `],
})
export class MessagesTile extends HomeTile<MessagesTileData> {}
