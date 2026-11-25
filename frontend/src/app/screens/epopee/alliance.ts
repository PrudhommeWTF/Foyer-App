import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { CATEGORY_LABEL, Kid, LOIS, Reward, SERMENT, SealPress, bothSealed, currentQuest, sealSet } from '../../core/epopee/epopee';
import { coin, fanfare } from '../../core/epopee/sound';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { sessionUuid } from '../../core/revisions/revisions';

const OFF: SealPress = { down: false, tappedAt: 0 };

/**
 * L'alliance : le parcours qu'un parent et son enfant font côte à côte, sur
 * l'appareil du parent, avant le premier écu. Quatre temps : les trois lois,
 * la besace d'amorce (c'est là que l'enfant est enrôlé), le premier trésor, et
 * le serment que les deux scellent ensemble. On peut s'arrêter en route : ce
 * qui est fait reste fait, et le parcours reprend où il en était.
 */
@Component({
  selector: 'epopee-alliance',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let k = kid();
    <div class="run" role="dialog" aria-modal="true" [attr.aria-label]="'L’alliance de ' + k.name">
      <header class="top">
        <button class="ico" (click)="closed.emit()" aria-label="Fermer"><f-icon name="x" [size]="22" color="var(--ink2)" [width]="2.2" /></button>
        <div class="dots" aria-hidden="true">@for (n of [1, 2, 3, 4]; track n) { <span [class.on]="n <= step()"></span> }</div>
        <span class="count">{{ step() }} / 4</span>
      </header>

      @switch (step()) {
        @case (1) {
          <div class="mid">
            <h2>L’alliance de {{ k.name }}</h2>
            <p class="soft">Installez-vous côte à côte. Voici les trois lois de notre foyer : lisez-les ensemble, à voix haute.</p>
            @for (l of lois; track l.title) {
              <div class="law"><div class="l-ico"><f-icon [name]="l.icon" [size]="24" color="#7D5400" [width]="2" /></div><div><div class="t">{{ l.title }}</div><div class="d">{{ l.text }}</div></div></div>
            }
          </div>
          <button class="btn btn-primary go" (click)="step.set(2)">On est d’accord</button>
        }
        @case (2) {
          <div class="mid center">
            <h2>La besace de {{ k.name }}</h2>
            @if (k.enrolled) {
              <div class="coins" aria-hidden="true">@for (c of amorce(); track $index) { <span class="coin"></span> }</div>
              <p class="big">{{ k.floor }} écus d’amorce</p>
              <p class="soft">Ils sont à toi pour toujours. Ta besace ne sera jamais vide : c’est d’ici que tout commence.</p>
            } @else {
              <div class="pouch"><f-icon name="bouclier" [size]="60" color="#7D5400" [width]="1.6" /></div>
              <p class="soft">Une besace ne commence jamais vide. Ouvre la tienne : des écus t’y attendent déjà, et ceux-là ne se reprennent pas.</p>
            }
          </div>
          @if (k.enrolled) { <button class="btn btn-primary go" (click)="step.set(3)">Continuer</button> }
          @else { <button class="btn btn-primary go" [disabled]="busy()" (click)="ouvrir()">Ouvrir la besace</button> }
        }
        @case (3) {
          <div class="mid">
            <h2>Le premier trésor</h2>
            @if (quest(); as q) {
              <p class="soft">{{ k.name }} vise déjà un trésor.</p>
              <div class="law"><div class="l-ico"><f-icon name="check" [size]="24" color="#476645" [width]="2.4" /></div><div><div class="t">{{ q.title }}</div><div class="d">{{ q.cost }} écus</div></div></div>
            } @else {
              <p class="soft">Choisissez-le ensemble : un premier trésor à portée, pour qu’il arrive vite. Vous pourrez préciser le pacte ensuite.</p>
              @for (r of rewards(); track r.id) {
                <button class="pick" [class.on]="chosen() === r.id" [attr.aria-pressed]="chosen() === r.id" (click)="chosen.set(chosen() === r.id ? '' : r.id)">
                  <span class="what"><span class="t">{{ r.title }}</span><span class="d">{{ cat(r) }}, {{ r.cost }} écus</span></span>
                  @if (chosen() === r.id) { <f-icon name="check" [size]="22" color="#476645" [width]="2.6" /> }
                </button>
              }
            }
          </div>
          <button class="btn btn-primary go" [disabled]="busy()" (click)="viser()">{{ quest() || chosen() ? 'Continuer' : 'Choisir plus tard' }}</button>
        }
        @default {
          <div class="mid">
            <h2>Le serment</h2>
            <div class="sides">
              <div><div class="who">{{ k.name }} promet</div><ul>@for (p of serment.child; track p) { <li>{{ p }}</li> }</ul></div>
              <div><div class="who">Je promets</div><ul>@for (p of serment.parent; track p) { <li>{{ p }}</li> }</ul></div>
            </div>
            <p class="soft center">Posez chacun un pouce sur votre sceau, en même temps. Avec une souris : l’un, puis l’autre.</p>
            <div class="seals">
              <button class="seal" [class.set]="setA()" [attr.aria-pressed]="setA()" [attr.aria-label]="'Le sceau de ' + k.name" (pointerdown)="press('a', true)" (pointerup)="press('a', false)" (pointerleave)="lift('a')" (pointercancel)="lift('a')" (keydown.enter)="tap('a')" (keydown.space)="tap('a'); $event.preventDefault()">
                <f-icon name="bouclier" [size]="40" [color]="setA() ? '#fff' : '#7D5400'" [width]="1.8" /><span>{{ k.name }}</span>
              </button>
              <button class="seal" [class.set]="setB()" [attr.aria-pressed]="setB()" aria-label="Le sceau du parent" (pointerdown)="press('b', true)" (pointerup)="press('b', false)" (pointerleave)="lift('b')" (pointercancel)="lift('b')" (keydown.enter)="tap('b')" (keydown.space)="tap('b'); $event.preventDefault()">
                <f-icon name="bouclier" [size]="40" [color]="setB() ? '#fff' : '#7D5400'" [width]="1.8" /><span>{{ parent() }}</span>
              </button>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .run { position: fixed; inset: 0; z-index: 60; background: var(--bg); display: flex; flex-direction: column; align-items: center; height: 100dvh; overflow-y: auto;
           padding: max(14px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom)); }
    .run > * { width: 100%; max-width: 560px; }
    .top { display: flex; align-items: center; gap: 12px; }
    .ico { width: 48px; height: 48px; border: none; border-radius: 14px; background: var(--surface); cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .dots { flex: 1; display: flex; justify-content: center; gap: 8px; }
    .dots span { width: 38px; height: 6px; border-radius: 99px; background: var(--line); }
    .dots span.on { background: #F0B24B; }
    .count { width: 48px; text-align: right; font-size: 13px; font-weight: 800; color: var(--ink3); }
    .mid { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 22px 0; }
    .mid.center { align-items: center; justify-content: center; text-align: center; }
    h2 { margin: 0; font-family: var(--font-display); font-size: 30px; font-weight: 800; line-height: 1.15; color: var(--ink); }
    .soft { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: var(--ink2); line-height: 1.5; }
    .soft.center { text-align: center; margin-top: 10px; }
    .big { margin: 0; font-family: var(--font-display); font-size: 26px; font-weight: 800; color: #7D5400; }
    .law { display: flex; gap: 14px; align-items: flex-start; padding: 16px; border-radius: 18px; background: var(--surface); box-shadow: var(--sh-card); }
    .l-ico { width: 46px; height: 46px; flex: none; border-radius: 13px; background: #FDF0DA; display: flex; align-items: center; justify-content: center; }
    .t { font-family: var(--font-display); font-size: 17px; font-weight: 800; color: var(--ink); }
    .d { font-size: 14.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin-top: 2px; }
    .pouch { width: 132px; height: 132px; border-radius: 50%; background: #FDF0DA; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
    .coins { display: flex; gap: 10px; margin: 6px 0; }
    .coin { width: 46px; height: 46px; border-radius: 50%; background: #F0B24B; box-shadow: 0 4px 0 #D99427; animation: apop .5s cubic-bezier(.3, 1.6, .5, 1) backwards; }
    .coin:nth-child(2) { animation-delay: .12s; } .coin:nth-child(3) { animation-delay: .24s; } .coin:nth-child(4) { animation-delay: .36s; } .coin:nth-child(5) { animation-delay: .48s; }
    .pick { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; padding: 12px 16px; border-radius: 18px; border: 2px solid var(--line); background: var(--surface); cursor: pointer; text-align: left; font-family: var(--font-body); }
    .pick.on { border-color: #7A9B76; background: #EDF2EB; }
    .pick .what { flex: 1; display: flex; flex-direction: column; }
    .pick .d { margin: 0; }
    .sides { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .sides > div { padding: 16px; border-radius: 18px; background: var(--surface); box-shadow: var(--sh-card); }
    .who { font-family: var(--font-display); font-size: 15px; font-weight: 800; color: #7D5400; margin-bottom: 8px; }
    ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: 14px; font-weight: 600; color: var(--ink); line-height: 1.45; }
    .seals { display: flex; justify-content: center; gap: 28px; margin-top: 8px; }
    .seal { width: 132px; height: 132px; border-radius: 50%; border: 3px dashed #D99427; background: #FDF0DA; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
            font: 800 14px var(--font-body); color: #7D5400; touch-action: none; user-select: none; -webkit-user-select: none; transition: background .15s, transform .15s; }
    .seal.set { background: #D99427; border-style: solid; color: #fff; transform: scale(1.06); }
    .go { min-height: 64px; font-family: var(--font-display); font-size: 20px; border-radius: 20px; }
    @keyframes apop { from { transform: scale(.2); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    @media (max-width: 480px) { .sides { grid-template-columns: 1fr; } .seals { gap: 16px; } .seal { width: 118px; height: 118px; } }
    @media (prefers-reduced-motion: reduce) { .coin { animation: none; } .seal { transition: none; } .seal.set { transform: none; } }
  `],
})
export class Alliance {
  private readonly api = inject(ApiService);
  private readonly store = inject(FoyerStore);

  readonly kid = input.required<Kid>();
  readonly rewards = input.required<Reward[]>();
  /** Something changed on the server: the screen reloads, and this flow reads the new state. */
  readonly changed = output<void>();
  /** The oath was sealed: the screen shows the parchment. */
  readonly sealed = output<void>();
  readonly closed = output<void>();

  readonly lois = LOIS;
  readonly serment = SERMENT;
  readonly step = signal(1);
  readonly busy = signal(false);
  readonly chosen = signal('');
  private readonly a = signal<SealPress>(OFF);
  private readonly b = signal<SealPress>(OFF);
  private readonly now = signal(Date.now());
  private done = false;

  readonly quest = computed(() => currentQuest(this.kid().quetes || []));
  readonly amorce = computed(() => Array.from({ length: this.kid().floor ?? 0 }));
  readonly parent = computed(() => this.store.me()?.name || 'Moi');
  readonly setA = computed(() => sealSet(this.a(), this.now()));
  readonly setB = computed(() => sealSet(this.b(), this.now()));

  constructor() {
    // The latch of a tapped seal wears off with time: a slow tick is enough to show it.
    const tick = setInterval(() => this.now.set(Date.now()), 250);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  cat(r: Reward): string { return CATEGORY_LABEL[r.category]; }

  private async agir(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await fn(); } catch (e) { this.store.toast((e as Error).message); } finally { this.busy.set(false); }
  }

  /** Opening the pouch is the enrolment: the amorce is paid, the routines and the catalogues are set. */
  ouvrir(): Promise<void> {
    return this.agir(async () => { await this.api.post(`epopee/membres/${this.kid().memberId}/enrolement`); coin(); this.changed.emit(); });
  }
  /** The first treasure: chosen and sealed at once, since parent and child are deciding together right now. */
  viser(): Promise<void> {
    const id = this.chosen();
    if (this.quest() || !id) { this.step.set(4); return Promise.resolve(); }
    return this.agir(async () => {
      const { quete } = await this.api.post<{ quete: { id: string } }>(`epopee/membres/${this.kid().memberId}/quetes`, { id: sessionUuid(), rewardId: id });
      await this.api.post(`epopee/quetes/${quete.id}/pacte`, {});
      this.changed.emit();
      this.step.set(4);
    });
  }

  private seal(which: 'a' | 'b') { return which === 'a' ? this.a : this.b; }
  /** A press holds the seal; releasing it leaves it set for a moment (a mouse has only one pointer). */
  press(which: 'a' | 'b', down: boolean): void {
    const t = Date.now(); this.now.set(t);
    this.seal(which).set({ down, tappedAt: t });
    this.check();
  }
  lift(which: 'a' | 'b'): void { this.seal(which).update((s) => ({ ...s, down: false })); }
  tap(which: 'a' | 'b'): void { this.press(which, false); }
  private check(): void {
    if (this.done || !bothSealed(this.a(), this.b(), this.now())) return;
    this.done = true;
    void this.agir(async () => {
      try { await this.api.post(`epopee/membres/${this.kid().memberId}/serment`); fanfare(); this.changed.emit(); this.sealed.emit(); }
      catch (e) { this.done = false; this.a.set(OFF); this.b.set(OFF); throw e; }
    });
  }
}
