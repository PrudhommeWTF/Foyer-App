import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { tint } from '../core/constants';

const KIND_MAP: Record<string, { icon: string; color: string; screen: string }> = {
  event: { icon: 'calendar', color: '#E56B4E', screen: 'calendar' },
  task: { icon: 'taches', color: '#9B6FA8', screen: 'taches' },
  budget: { icon: 'budget', color: '#F0B24B', screen: 'budget' },
  shop: { icon: 'courses', color: '#7A9B76', screen: 'courses' },
  doc: { icon: 'documents', color: '#4E93B8', screen: 'documents' },
};

@Component({
  selector: 'app-notifications',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="backdrop" (click)="store.patch({ notifOpen: false })"></div>
    <div class="panel fscroll">
      <div class="head">
        <div class="modal-title">Notifications</div>
        <button class="icon-btn sm" (click)="store.patch({ notifOpen: false })"><f-icon name="x" [size]="18" /></button>
      </div>
      <button class="mark" (click)="store.markAllRead()">Tout marquer comme lu</button>
      <div class="list">
        @for (n of d().notifs; track n.id) {
          <button class="item" [class.unread]="!n.read" (click)="open(n)">
            <span class="ic" [style.background]="tintOf(kind(n.kind).color)"><f-icon [name]="kind(n.kind).icon" [size]="18" [color]="kind(n.kind).color" /></span>
            <span class="body">
              <span class="t">{{ n.title }}</span>
              <span class="s">{{ n.desc }}</span>
              <span class="time">{{ n.time }}</span>
            </span>
            @if (!n.read) { <span class="dot"></span> }
          </button>
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
    .item { display: flex; gap: 12px; padding: 13px; border-radius: 15px; border: none; background: transparent; cursor: pointer; text-align: left; position: relative; align-items: flex-start; }
    .item:hover { background: var(--soft); }
    .item.unread { background: var(--soft); }
    .ic { width: 38px; height: 38px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .body { display: flex; flex-direction: column; gap: 2px; flex: 1; }
    .t { font-size: 14px; font-weight: 800; color: var(--ink); line-height: 1.2; }
    .s { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .time { font-size: 11px; font-weight: 700; color: var(--ink3); margin-top: 2px; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--primary); flex: none; margin-top: 5px; }
  `],
})
export class NotificationsComponent {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;
  tintOf = tint;
  kind(k: string) { return KIND_MAP[k] || { icon: 'bell', color: '#8A7E74', screen: '' }; }
  open(n: { id: string; kind: string }): void { this.store.openNotif(n.id, this.kind(n.kind).screen || undefined); }
}
