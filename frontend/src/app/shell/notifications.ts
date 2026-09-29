import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { SwipeDirective } from '../shared/swipe';
import { tint } from '../core/constants';

const KIND_MAP: Record<string, { icon: string; color: string; screen: string }> = {
  event: { icon: 'calendar', color: '#E56B4E', screen: 'calendar' },
  task: { icon: 'taches', color: '#9B6FA8', screen: 'taches' },
  budget: { icon: 'budget', color: '#F0B24B', screen: 'finances' },
  birthday: { icon: 'cake', color: '#C77DA5', screen: 'calendar' },
  shop: { icon: 'courses', color: '#7A9B76', screen: 'courses' },
};

@Component({
  selector: 'app-notifications',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SwipeDirective],
  template: `
    <div class="backdrop" (click)="store.patch({ notifOpen: false })"></div>
    <div class="panel fscroll">
      <div class="head">
        <div class="modal-title">Notifications</div>
        <button class="icon-btn sm" (click)="store.patch({ notifOpen: false })"><f-icon name="x" [size]="18" /></button>
      </div>
      @let items = store.notifications();
      @if (items.length) {
        <button class="mark" (click)="store.markAllRead()">Tout marquer comme lu</button>
      }
      <div class="list">
        @for (n of items; track n.id + (n.read ? 'r' : 'u')) {
          <div class="swipe-wrap">
            <!-- Fond révélé par le glissement : dans les deux sens, « Lu ». -->
            <div class="swipe-bg" aria-hidden="true">
              <span class="swipe-ic"><f-icon name="check" [size]="18" color="#fff" [width]="2.6" /> Lu</span>
              <span class="swipe-ic">Lu <f-icon name="check" [size]="18" color="#fff" [width]="2.6" /></span>
            </div>
            <div class="item" [class.unread]="!n.read" fSwipe (swipeRight)="store.markRead(n.id)" (swipeLeft)="store.markRead(n.id)" (click)="open(n)">
              <span class="ic" [style.background]="tintOf(kind(n.kind).color)"><f-icon [name]="kind(n.kind).icon" [size]="18" [color]="kind(n.kind).color" /></span>
              <span class="body">
                <span class="t">{{ n.title }}</span>
                <span class="s">{{ n.desc }}</span>
                <span class="time">{{ n.time }}</span>
              </span>
              @if (!n.read) {
                <button class="x" (click)="markRead($event, n.id)" aria-label="Marquer comme lu"><f-icon name="x" [size]="15" color="var(--ink3)" [width]="2.4" /></button>
              }
            </div>
          </div>
        } @empty {
          <div class="empty">Rien de neuf pour le moment 🎉</div>
        }
      </div>
    </div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 70; background: rgba(30,24,20,.35); }
    .panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(380px, 100vw); background: var(--surface); z-index: 71; padding: 22px; overflow-y: auto; box-shadow: -20px 0 60px -30px rgba(0,0,0,.5); animation: fslide .28s ease; }
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .mark { border: none; background: var(--soft2); color: var(--primary); font-weight: 800; font-size: 12.5px; padding: 9px 14px; border-radius: 11px; cursor: pointer; margin-bottom: 14px; }
    .list { display: flex; flex-direction: column; gap: 6px; }
    .swipe-wrap { position: relative; border-radius: 15px; }
    .swipe-bg { position: absolute; inset: 0; border-radius: 15px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; opacity: 0; background: var(--sage); }
    .swipe-wrap[data-swipe] .swipe-bg { opacity: 1; }
    .swipe-ic { display: inline-flex; align-items: center; gap: 6px; color: #fff; font-weight: 800; font-size: 12.5px; opacity: 0; transition: transform .12s ease; }
    .swipe-wrap[data-swipe="right"] .swipe-ic:first-child { opacity: 1; }
    .swipe-wrap[data-swipe="left"] .swipe-ic:last-child { opacity: 1; }
    .swipe-wrap.swipe-commit .swipe-ic { transform: scale(1.12); }
    .item { display: flex; gap: 12px; padding: 13px; border-radius: 15px; border: none; background: var(--surface); cursor: pointer; text-align: left; position: relative; align-items: flex-start; touch-action: pan-y; }
    .item:hover { background: var(--soft); }
    .item.unread { background: var(--soft); }
    .ic { width: 38px; height: 38px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .t { font-size: 14px; font-weight: 800; color: var(--ink); line-height: 1.2; }
    .s { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .time { font-size: 11px; font-weight: 700; color: var(--ink3); margin-top: 2px; }
    .x { flex: none; border: none; background: var(--soft2); width: 26px; height: 26px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; margin-top: 2px; }
    .x:hover { background: var(--line2); }
    .empty { padding: 40px 16px; text-align: center; font-size: 13.5px; font-weight: 700; color: var(--ink3); }
  `],
})
export class NotificationsComponent {
  store = inject(FoyerStore);
  tintOf = tint;
  kind(k: string) { return KIND_MAP[k] || { icon: 'bell', color: '#8A7E74', screen: '' }; }
  open(n: { id: string; kind: string }): void { this.store.openNotif(n.id, this.kind(n.kind).screen || undefined); }
  /** La croix marque la notification lue sans ouvrir son écran ni fermer le panneau. */
  markRead(e: Event, id: string): void { e.stopPropagation(); this.store.markRead(id); }
}
