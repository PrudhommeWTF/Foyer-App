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
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()" [raison]="raison()" [collapsed]="collapsed()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="agenda">
          @for (x of d.extras; track $index) {
            <div class="extra" [style.background]="store.tint(x.color)">
              <span class="dot" [style.background]="x.color"></span>
              <span class="extra-label" [style.color]="x.color">{{ x.label }}</span>
              @if (x.sub) { <span class="extra-sub">{{ x.sub }}</span> }
            </div>
          }
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
          @if (d.tomorrow.length) {
            <div class="demain">Demain</div>
            @for (e of d.tomorrow; track e.id) {
              <div class="ev next" [style.border-left]="'4px solid ' + store.memberColor(e.who)">
                <div class="ev-time f-display">{{ e.time }}</div>
                <div class="ev-body">
                  <div class="ev-title">{{ e.title }}</div>
                  <div class="ev-who"><span>{{ store.memberName(e.who) }}</span></div>
                </div>
              </div>
            }
          }
        </div>
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .agenda { display: flex; flex-direction: column; gap: 10px; }
    .extra { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 12px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
    .extra-label { font-size: 13px; font-weight: 800; }
    .extra-sub { font-size: 12px; font-weight: 700; color: var(--ink2); margin-left: auto; }
    .ev { display: flex; gap: 14px; padding: 14px; border-radius: 16px; background: var(--soft); }
    .ev-time { font-size: 16px; font-weight: 700; color: var(--ink); min-width: 48px; }
    .ev-title { font-weight: 800; font-size: 15px; color: var(--ink); }
    .ev-who { display: flex; align-items: center; gap: 6px; margin-top: 5px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    /* Demain est là pour être préparé ce soir, pas pour concurrencer aujourd'hui. */
    .demain { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .08em; margin-top: 4px; }
    .ev.next { padding: 10px 14px; background: transparent; border-left-style: dashed; }
    .ev.next .ev-time { font-size: 14px; color: var(--ink2); }
    .ev.next .ev-title { font-size: 13.5px; color: var(--ink2); }
  `],
})
export class AgendaTile extends HomeTile<AgendaTileData> {}
