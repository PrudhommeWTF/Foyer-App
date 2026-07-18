import { AfterViewChecked, ChangeDetectionStrategy, Component, ElementRef, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';

@Component({
  selector: 'screen-messages',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent],
  template: `
    <div class="wrap card screen-enter">
      <div class="thread fscroll" #thread>
        @for (m of d().msgs; track $index) {
          <div class="line" [class.me]="isMe(m.who)">
            @if (!isMe(m.who)) { <f-avatar [ini]="store.memberIni(m.who)" [color]="store.memberColor(m.who)" [size]="34" /> }
            <div class="col" [class.me]="isMe(m.who)">
              @if (!isMe(m.who)) { <div class="name" [style.color]="store.memberColor(m.who)">{{ store.memberName(m.who) }}</div> }
              <div class="bubble" [class.me]="isMe(m.who)">{{ m.text }}</div>
              <div class="time">{{ m.time }}</div>
            </div>
          </div>
        }
      </div>
      <div class="composer">
        <input class="input" [ngModel]="store.ui().newMsg" (ngModelChange)="store.patch({ newMsg: $event })" (keydown.enter)="store.sendMsg()" placeholder="Écrire un message au foyer…" />
        <button class="btn btn-primary send" (click)="store.sendMsg()"><f-icon name="send" [size]="20" color="#fff" /></button>
      </div>
    </div>
  `,
  styles: [`
    .wrap { display: flex; flex-direction: column; height: calc(100vh - 150px); padding: 0; overflow: hidden; }
    .thread { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
    .line { display: flex; gap: 10px; align-items: flex-end; }
    .line.me { flex-direction: row-reverse; }
    .col { display: flex; flex-direction: column; gap: 4px; max-width: 68%; }
    .col.me { align-items: flex-end; }
    .name { font-size: 12px; font-weight: 800; }
    .bubble { background: var(--soft); color: var(--ink); font-size: 14.5px; font-weight: 700; padding: 11px 15px; border-radius: 16px; border-bottom-left-radius: 5px; line-height: 1.35; }
    .bubble.me { background: var(--primary); color: #fff; border-bottom-left-radius: 16px; border-bottom-right-radius: 5px; }
    .time { font-size: 10.5px; font-weight: 700; color: var(--ink3); }
    .composer { display: flex; gap: 10px; padding: 16px 24px; border-top: 1px solid var(--line); }
    .send { width: 50px; padding: 0; flex: none; }
    @media (max-width: 860px) { .wrap { height: calc(100vh - 190px); } .thread { padding: 16px; } .composer { padding: 12px 16px; } }
  `],
})
export class MessagesScreen implements AfterViewChecked {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;
  @ViewChild('thread') thread?: ElementRef<HTMLElement>;
  private lastCount = 0;

  isMe(who: string): boolean { return who === (this.store.me()?.id ?? this.d().profile.memberId); }

  ngAfterViewChecked(): void {
    const n = this.d().msgs.length;
    if (n !== this.lastCount && this.thread) { this.lastCount = n; this.thread.nativeElement.scrollTop = this.thread.nativeElement.scrollHeight; }
  }
}
