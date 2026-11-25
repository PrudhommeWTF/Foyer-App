import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { Routine, breath, earned, mmss, nextStep, remaining } from '../../core/epopee/epopee';
import { coin, fanfare, setSound, soundOn } from '../../core/epopee/sound';
import { EpopeeStore } from '../../core/epopee/store';
import { IconComponent } from '../../core/icon';

/** How long the coin celebration holds the screen before the next step. */
const BRAVO_MS = 1400;
const RING = 2 * Math.PI * 54;

/**
 * Une routine, pas à pas, en plein écran : une seule consigne à la fois, un
 * sablier qui n'est qu'un repère (passé le temps, rien ne se perd), l'écu au
 * moment où l'étape est faite, et une pause « grain de sable » qui arrête le
 * sablier. L'étape est notée dans le store, qui l'envoie ; ici rien n'attend le
 * réseau.
 */
@Component({
  selector: 'epopee-runner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="run" [class.soir]="routine().kind === 'soir'" role="dialog" aria-modal="true" [attr.aria-label]="routine().title">
      <header class="top">
        <button class="ico" (click)="closed.emit()" aria-label="Fermer la routine"><f-icon name="x" [size]="22" color="var(--ink2)" [width]="2.2" /></button>
        <div class="rt">{{ routine().title }}</div>
        <button class="ico" [class.muet]="!son()" (click)="toggleSound()" [attr.aria-label]="son() ? 'Couper le son' : 'Remettre le son'" [attr.aria-pressed]="!son()">
          <f-icon name="bell" [size]="20" color="var(--ink2)" [width]="2" />
        </button>
      </header>

      <div class="path" aria-hidden="true">
        @for (s of routine().steps; track s.id; let i = $index) { <span class="dot" [class.fait]="s.status === 'fait'" [class.saute]="s.status === 'saute'" [class.cur]="i === index()"></span> }
      </div>

      @switch (phase()) {
        @case ('fin') {
          <div class="mid">
            <div class="medal"><f-icon name="bouclier" [size]="56" color="#7D5400" [width]="1.8" /></div>
            <h2>Tu es allé au bout !</h2>
            @if (gain(); as g) { <p class="big">+{{ g }} écu{{ g > 1 ? 's' : '' }} dans ta besace</p> } @else { <p class="soft">Tu es allé jusqu’au bout, c’est ce qui compte.</p> }
          </div>
          <button class="btn btn-primary go" (click)="closed.emit()">Retour à ma besace</button>
        }
        @case ('bravo') {
          <div class="mid" aria-live="polite">
            <div class="coin pop"></div>
            <h2>Bravo !</h2>
            @if (lastEcus(); as n) { <p class="big">+{{ n }} écu{{ n > 1 ? 's' : '' }}</p> }
          </div>
        }
        @case ('pause') {
          <div class="mid">
            <h2>Un grain de sable</h2>
            <p class="soft">Le sablier est arrêté. Rien n’est perdu, on respire.</p>
            <div class="lung" [class.p0]="souffle().phase === 0" [class.p1]="souffle().phase === 1" [class.p2]="souffle().phase === 2"><span>{{ souffle().label }}</span></div>
            <p class="soft idea">Un câlin, un verre d’eau, et on repart quand tu veux.</p>
          </div>
          <div class="acts">
            <button class="btn btn-primary go" (click)="reprendre()">Je reprends</button>
            <button class="btn btn-soft" (click)="passer()">Passer cette étape pour aujourd’hui</button>
          </div>
        }
        @default {
          @if (step(); as s) {
            <div class="mid">
              <div class="n">Étape {{ index() + 1 }} sur {{ routine().steps.length }}</div>
              <div class="pic"><f-icon [name]="s.icon" [size]="72" color="var(--primary)" [width]="1.6" /></div>
              <h2>{{ s.title }}</h2>
              @if (s.hint) { <p class="soft">{{ s.hint }}</p> }
              <div class="glass" [class.over]="!left()">
                <svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true">
                  <circle cx="60" cy="60" r="54" class="bg" /><circle cx="60" cy="60" r="54" class="fg" [attr.stroke-dasharray]="ring" [attr.stroke-dashoffset]="offset()" transform="rotate(-90 60 60)" />
                </svg>
                <div class="gl">@if (left(); as l) { <b>{{ fmt(l) }}</b> } @else { <b>Prends ton temps</b><span>tes écus t’attendent</span> }</div>
              </div>
            </div>
            <div class="acts">
              <button class="btn btn-primary go" (click)="valider()"><f-icon name="check" [size]="22" color="#fff" [width]="2.6" /> C’est fait !@if (s.ecus) { <span class="plus">+{{ s.ecus }}</span> }</button>
              <button class="btn btn-soft" (click)="grain()">Un grain de sable ? Faire une pause</button>
            </div>
          }
        }
      }
    </div>
  `,
  styles: [`
    .run { position: fixed; inset: 0; z-index: 60; background: var(--bg); display: flex; flex-direction: column; align-items: center; height: 100dvh; overflow-y: auto;
           padding: max(14px, env(safe-area-inset-top)) 18px max(18px, env(safe-area-inset-bottom)); }
    .run > * { width: 100%; max-width: 520px; }
    .top { display: flex; align-items: center; gap: 10px; }
    .rt { flex: 1; text-align: center; font-family: var(--font-display); font-weight: 800; font-size: 17px; color: var(--ink); }
    .ico { width: 48px; height: 48px; border: none; border-radius: 14px; background: var(--surface); cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .ico.muet { position: relative; }
    .ico.muet f-icon { opacity: .4; }
    .ico.muet::after { content: ''; position: absolute; width: 26px; height: 2.5px; border-radius: 2px; background: var(--ink2); transform: rotate(-45deg); }
    .path { display: flex; justify-content: center; gap: 10px; margin: 14px 0 6px; }
    .dot { width: 16px; height: 16px; border-radius: 50%; background: var(--line); }
    .dot.fait { background: #F0B24B; box-shadow: 0 2px 0 #D99427; }
    .dot.saute { background: none; border: 2px solid var(--line); }
    .dot.cur { outline: 3px solid var(--primary); outline-offset: 2px; }
    .mid { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 10px; padding: 12px 0; }
    .n { font-size: 13px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--ink3); }
    .pic { width: 132px; height: 132px; border-radius: 34px; background: var(--surface); display: flex; align-items: center; justify-content: center; box-shadow: var(--sh-card); }
    h2 { margin: 6px 0 0; font-family: var(--font-display); font-size: 32px; font-weight: 800; line-height: 1.15; color: var(--ink); }
    .soft { margin: 0; font-size: 17px; font-weight: 600; color: var(--ink2); line-height: 1.45; max-width: 380px; }
    .big { margin: 0; font-family: var(--font-display); font-size: 24px; font-weight: 800; color: #7D5400; }
    .glass { display: flex; align-items: center; gap: 16px; margin-top: 14px; padding: 10px 20px 10px 10px; border-radius: 22px; background: var(--surface); }
    .glass .bg { fill: none; stroke: #F5EEE2; stroke-width: 10; }
    .glass .fg { fill: none; stroke: #D99427; stroke-width: 10; stroke-linecap: round; transition: stroke-dashoffset .3s linear; }
    .glass.over .fg { stroke: #7A9B76; }
    .gl { display: flex; flex-direction: column; text-align: left; }
    .gl b { font-family: var(--font-display); font-size: 26px; font-weight: 800; color: var(--ink); }
    .glass.over .gl b { font-size: 19px; }
    .gl span { font-size: 13.5px; font-weight: 700; color: var(--ink2); }
    .acts { display: flex; flex-direction: column; gap: 10px; }
    .go { min-height: 68px; font-family: var(--font-display); font-size: 21px; border-radius: 20px; }
    .acts .btn-soft { min-height: 52px; font-size: 15px; border-radius: 16px; }
    .plus { margin-left: 6px; padding: 3px 11px; border-radius: 999px; background: #FDF0DA; color: #7D5400; font-size: 16px; }
    .coin { width: 120px; height: 120px; border-radius: 50%; background: #F0B24B; box-shadow: 0 6px 0 #D99427, inset 0 0 0 8px #F6C673; }
    .pop { animation: epop .6s cubic-bezier(.3, 1.6, .5, 1); }
    .medal { width: 132px; height: 132px; border-radius: 50%; background: #FDF0DA; display: flex; align-items: center; justify-content: center; animation: epop .6s cubic-bezier(.3, 1.6, .5, 1); }
    .lung { width: 170px; height: 170px; margin: 18px 0; border-radius: 50%; background: #EDF2EB; border: 3px solid #7A9B76; display: flex; align-items: center; justify-content: center; transform: scale(.72); }
    .lung span { font-family: var(--font-display); font-size: 22px; font-weight: 800; color: #476645; }
    .lung.p0 { transform: scale(1); transition: transform 4s ease-in-out; }
    .lung.p1 { transform: scale(1); }
    .lung.p2 { transform: scale(.72); transition: transform 4s ease-in-out; }
    .idea { font-size: 15px; }
    .run.soir { background: #1E1B4B; }
    .run.soir .rt, .run.soir h2 { color: #F4F1FF; }
    .run.soir .soft, .run.soir .n { color: #C7C3E8; }
    .run.soir .big { color: #F6C673; }
    @keyframes epop { from { transform: scale(.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .pop, .medal { animation: none; } .lung, .lung.p0, .lung.p2 { transform: none; transition: none; } .glass .fg { transition: none; } }
  `],
})
export class EpopeeRunner {
  private readonly epopee = inject(EpopeeStore);

  /** The routine, with what this device already marked (see withPending). */
  readonly routine = input.required<Routine>();
  readonly day = input.required<string>();
  readonly closed = output<void>();

  readonly ring = RING;
  readonly son = signal(soundOn());
  readonly phase = signal<'etape' | 'bravo' | 'pause' | 'fin'>('etape');
  readonly lastEcus = signal(0);
  private readonly now = signal(Date.now());
  private readonly started = signal(Date.now());
  private readonly paused = signal(0);
  private pauseAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly index = computed(() => nextStep(this.routine()));
  readonly step = computed(() => this.routine().steps[this.index()] ?? null);
  readonly gain = computed(() => earned(this.routine()));
  readonly left = computed(() => { const s = this.step(); return s ? remaining(s.seconds, this.started(), this.paused(), this.now()) : 0; });
  readonly offset = computed(() => { const s = this.step(); return s ? RING * (1 - this.left() / s.seconds) : RING; });
  readonly souffle = computed(() => breath(this.now() - this.pauseAt));

  constructor() {
    const tick = setInterval(() => this.now.set(Date.now()), 250);
    inject(DestroyRef).onDestroy(() => { clearInterval(tick); if (this.timer) clearTimeout(this.timer); });
    // Opened on a routine already finished (a second tap, another device): straight to the end.
    queueMicrotask(() => { if (this.index() < 0) this.phase.set('fin'); });
  }

  fmt(s: number): string { return mmss(s); }
  toggleSound(): void { this.son.update((v) => !v); setSound(this.son()); }

  private restart(): void { const t = Date.now(); this.now.set(t); this.started.set(t); this.paused.set(0); }
  /** After a step: the end if it was the last one, the next step otherwise, with a fresh hourglass. */
  private advance(): void {
    if (this.index() < 0) { this.phase.set('fin'); fanfare(); } else { this.restart(); this.phase.set('etape'); }
  }

  valider(): void {
    const s = this.step(); if (!s || this.phase() !== 'etape') return;
    this.lastEcus.set(s.ecus);
    this.epopee.noter(s, 'fait', this.day());
    coin();
    this.phase.set('bravo');
    this.timer = setTimeout(() => this.advance(), BRAVO_MS);
  }
  grain(): void {
    this.pauseAt = Date.now(); this.now.set(this.pauseAt);
    this.phase.set('pause');
    this.epopee.pause(this.routine(), this.day());
  }
  reprendre(): void { this.paused.update((p) => p + Date.now() - this.pauseAt); this.now.set(Date.now()); this.phase.set('etape'); }
  passer(): void {
    const s = this.step(); if (!s) return;
    this.epopee.noter(s, 'saute', this.day());
    this.advance();
  }
}
