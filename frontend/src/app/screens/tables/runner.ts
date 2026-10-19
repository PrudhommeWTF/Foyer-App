import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit, computed, input, output, signal, viewChild } from '@angular/core';
import { Mode, Operation, Question, Result, classify, rangeLabel, signOf, spoken } from '../../core/tables';
import { KeypadComponent } from './keypad';

export interface RunPlan {
  mode: Mode; op: Operation; from: number; to: number; questions: Question[];
  allowedMs: number; fastMs: number; programId: number | null;
  /** Lire chaque ligne à voix haute (mode Apprendre, réglage de l'appareil, voix française présente). */
  voice: boolean;
}
export interface RunAnswer { a: number; b: number; given: number | null; ms: number; askedAt: string; result: Result; }
export interface RunResult { startedAt: string; endedAt: string; aborted: boolean; answers: RunAnswer[]; }

/** La voix française de l'appareil, locale de préférence ; null sans synthèse vocale ou sans voix française. */
export function frenchVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const fr = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('fr'));
  return fr.find((v) => v.localService) ?? fr[0] ?? null;
}

/**
 * Une session d'exercice, plein écran. Tout se passe ici, sans réseau : les
 * questions sont tirées avant, la correction et le chronomètre tournent dans
 * le navigateur, et le résultat part en un seul envoi à la fin (ou à
 * l'abandon, les réponses déjà données comptent).
 *
 *   - Apprendre : la table entière sous les yeux, une ligne à la fois, lue à
 *     voix haute quand c'est possible ; l'enfant recopie le résultat affiché.
 *     Ni chronomètre ni score.
 *   - S'entraîner : une question à la fois, la barre de temps descend, une
 *     réponse lente est acceptée ; une erreur montre la bonne réponse.
 *   - Test : pareil, sans la bonne réponse pendant le test.
 */
@Component({
  selector: 'tables-runner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KeypadComponent],
  template: `
    <div class="run" [class.learn]="learn()">
      <div class="top">
        <span class="prog">@if (learn()) { {{ title() }} } @else { Question {{ idx() + 1 }} sur {{ total() }} }</span>
        <button type="button" class="stop" (click)="stop()">Arrêter</button>
      </div>

      <div class="body">
        <div class="zone">
          @if (learn()) {
            <ol class="rows" aria-label="La table">
              @for (q of plan().questions; track $index; let i = $index) {
                <li class="row" [class.cur]="i === idx()" [class.done]="i < idx()">{{ q.a }} {{ sign() }} {{ q.b }} = {{ q.expected }}</li>
              }
            </ol>
          }
          @let q = current();
          @if (q) {
            <div class="ask" #ask tabindex="-1" [attr.aria-label]="q.a + ' ' + word() + ' ' + q.b">
              <span class="ops">{{ q.a }} {{ sign() }} {{ q.b }} =</span>
              <span class="ans" [class.empty]="!typed()" [class.ko]="fb()?.kind === 'faux'">{{ typed() || '?' }}</span>
            </div>
            @if (!learn()) {
              @for (k of [idx()]; track k) {
                <div class="bar" aria-hidden="true"><span [style.animation-duration.ms]="plan().allowedMs"></span></div>
              }
            }
          }
          <div class="fb" [class]="'fb ' + (fb()?.kind ?? '')" role="status" aria-live="polite">{{ fb()?.text ?? '' }}</div>
          @if (learn() && voiceOn()) {
            <button type="button" class="say" (click)="say()">Écouter</button>
          }
        </div>
        <div class="padzone">
          <tables-keypad [disabled]="busy()" [canSubmit]="!!typed()" (digit)="digit($event)" (erase)="erase()" (submit)="ok()" />
          @if (!learn()) { <button type="button" class="skip" (click)="skip()" [disabled]="busy()">Je ne sais pas</button> }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .run { position: fixed; inset: 0; z-index: 60; background: var(--bg); display: flex; flex-direction: column; height: 100dvh; overflow: hidden;
           padding: max(14px, env(safe-area-inset-top)) 16px max(14px, env(safe-area-inset-bottom)); }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .prog { font-size: 15px; font-weight: 800; color: var(--ink2); }
    .stop { border: none; background: var(--soft2); color: var(--ink2); border-radius: 12px; padding: 10px 16px; font-family: inherit; font-size: 14px; font-weight: 800; cursor: pointer; min-height: 44px; }
    .body { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: space-evenly; gap: 14px; }
    .zone { display: flex; flex-direction: column; align-items: center; gap: 14px; width: 100%; max-width: 520px; }
    .padzone { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; }
    .ask { display: flex; align-items: baseline; gap: 16px; font-size: clamp(44px, 11vw, 76px); font-weight: 800; color: var(--ink); outline: none; }
    .ans { min-width: 1.6em; text-align: center; border-bottom: 4px solid var(--primary); color: var(--primary); }
    .ans.empty { color: var(--ink3); }
    .ans.ko { color: #C6492F; text-decoration: line-through; text-decoration-thickness: 4px; }
    .bar { width: 100%; max-width: 420px; height: 10px; border-radius: 6px; background: var(--soft2); overflow: hidden; }
    .bar span { display: block; height: 100%; width: 100%; background: var(--sage); transform-origin: left; animation-name: drain; animation-timing-function: linear; animation-fill-mode: forwards; }
    @keyframes drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    .fb { min-height: 34px; font-size: 22px; font-weight: 800; text-align: center; }
    .fb.bon { color: #4F7A4B; }
    .fb.lent { color: #A86F0B; }
    .fb.faux, .fb.passe { color: #C6492F; }
    .skip { border: none; background: transparent; color: var(--ink2); font-family: inherit; font-size: 15px; font-weight: 800; text-decoration: underline; min-height: 44px; cursor: pointer; }
    .say { border: 2px solid var(--line); background: var(--surface); border-radius: 12px; padding: 8px 16px; font-family: inherit; font-weight: 800; color: var(--ink); min-height: 44px; cursor: pointer; }
    .rows { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 4px 18px; font-size: 18px; font-weight: 700; color: var(--ink3); }
    .row { padding: 3px 10px; border-radius: 8px; }
    .row.done { color: var(--ink2); }
    .row.cur { background: #FCE9E3; color: var(--primary); font-weight: 800; }
    /* Tablette en paysage : la question à gauche, le pavé sous le pouce droit. */
    @media (min-width: 900px) and (orientation: landscape) {
      .body { flex-direction: row; justify-content: center; gap: 60px; }
      .padzone { width: auto; }
      .padzone tables-keypad { width: 340px; }
    }
    @media (max-height: 700px) { .rows { font-size: 15px; } .ask { font-size: 44px; } }
  `],
})
export class RunnerComponent implements OnInit, OnDestroy {
  readonly plan = input.required<RunPlan>();
  readonly finished = output<RunResult>();
  readonly quit = output<void>();

  readonly idx = signal(0);
  readonly typed = signal('');
  readonly fb = signal<{ kind: Result | 'note'; text: string } | null>(null);
  readonly busy = signal(false);
  private readonly askEl = viewChild<ElementRef<HTMLElement>>('ask');
  private answers: RunAnswer[] = [];
  private startedAt = '';
  private shownAt = 0;
  private shownIso = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly learn = computed(() => this.plan().mode === 'apprendre');
  readonly total = computed(() => this.plan().questions.length);
  readonly current = computed(() => this.plan().questions[this.idx()] ?? null);
  readonly sign = computed(() => signOf(this.plan().op));
  readonly word = computed(() => (this.plan().op === 'multiplication' ? 'fois' : 'plus'));
  readonly title = computed(() => `Apprendre ${rangeLabel(this.plan().from, this.plan().to)}`);
  readonly voiceOn = computed(() => this.plan().voice && !!frenchVoice());

  ngOnInit(): void { this.startedAt = new Date().toISOString(); this.show(); }
  ngOnDestroy(): void { if (this.timer) clearTimeout(this.timer); if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }

  /** Le clavier d'un Mac ou d'un clavier branché à l'iPad : chiffres, retour arrière, Entrée. */
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (/^[0-9]$/.test(e.key)) { this.digit(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { this.erase(); e.preventDefault(); }
    else if (e.key === 'Enter') { this.ok(); e.preventDefault(); }
  }

  private show(): void {
    this.typed.set(''); this.shownAt = performance.now(); this.shownIso = new Date().toISOString();
    setTimeout(() => this.askEl()?.nativeElement.focus());
    if (this.learn() && this.voiceOn()) this.say();
  }

  say(): void {
    const q = this.current(); const v = frenchVoice();
    if (!q || !v) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(spoken(this.plan().op, q));
    u.voice = v; u.lang = v.lang; u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  digit(d: string): void { if (!this.busy() && this.typed().length < 4) this.typed.update((t) => (t === '0' ? d : t + d)); }
  erase(): void { if (!this.busy()) this.typed.update((t) => t.slice(0, -1)); }
  skip(): void { if (!this.busy()) this.answer(null); }
  ok(): void { if (!this.busy() && this.typed()) this.answer(Number(this.typed())); }

  private answer(given: number | null): void {
    const q = this.current(); if (!q) return;
    const ms = Math.round(performance.now() - this.shownAt);
    const p = this.plan();
    if (this.learn()) {
      // Recopier : juste, on passe à la ligne suivante ; sinon on recommence la même.
      this.answers.push({ a: q.a, b: q.b, given, ms, askedAt: this.shownIso, result: given === q.expected ? 'bon' : 'faux' });
      if (given !== q.expected) { this.fb.set({ kind: 'faux', text: `Recopie ${q.expected}` }); this.typed.set(''); return; }
      this.fb.set({ kind: 'bon', text: 'Oui !' });
      return this.next(450);
    }
    const result = classify(q.expected, given, ms, p.fastMs);
    this.answers.push({ a: q.a, b: q.b, given, ms, askedAt: this.shownIso, result });
    const show = p.mode === 'entrainer';
    const text = result === 'bon' ? 'Bravo !'
      : result === 'lent' ? 'Juste, un peu lent'
      : show ? `${q.a} ${this.sign()} ${q.b} = ${q.expected}` : result === 'passe' ? 'On passe' : 'Pas tout à fait';
    this.fb.set({ kind: result, text });
    this.next(result === 'bon' ? 600 : result === 'lent' ? 900 : show ? 1800 : 900);
  }

  private next(delay: number): void {
    this.busy.set(true);
    this.timer = setTimeout(() => {
      this.busy.set(false); this.fb.set(null);
      if (this.idx() + 1 >= this.total()) { this.end(false); return; }
      this.idx.update((i) => i + 1);
      this.show();
    }, delay);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.answers.length) this.end(true); else this.quit.emit();
  }

  private end(aborted: boolean): void {
    this.finished.emit({ startedAt: this.startedAt, endedAt: new Date().toISOString(), aborted, answers: [...this.answers] });
  }
}
