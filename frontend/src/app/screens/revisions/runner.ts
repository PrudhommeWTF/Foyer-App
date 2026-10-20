import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, OnInit, computed, input, output, signal, viewChild } from '@angular/core';
import type { ExerciseDef, Mode, Params } from '../../core/revisions/exercises/contract';
import { MODE_LABELS, Result, classify } from '../../core/revisions/revisions';
import { KeypadComponent } from './keypad';
import { ClockComponent } from './clock';

export interface RunPlan {
  def: ExerciseDef; params: Params; mode: Mode; questions: unknown[];
  allowedMs: number; fastMs: number; programId: number | null;
  /** Lire chaque ligne à voix haute (mode Apprendre, réglage de l'appareil, voix française présente). */
  voice: boolean;
}
export interface RunAnswer { question: unknown; key: string; given: string | null; ms: number; askedAt: string; result: Result; }
export interface RunResult { startedAt: string; endedAt: string; aborted: boolean; answers: RunAnswer[]; }

/** Les saisies que cet écran sait afficher. Un exercice d'une autre saisie n'est pas proposé. */
export const SUPPORTED_INPUTS: ReadonlySet<string> = new Set(['pave', 'clavier']);

/** La voix française de l'appareil, locale de préférence ; null sans synthèse vocale ou sans voix française. */
export function frenchVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const fr = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('fr'));
  return fr.find((v) => v.localService) ?? fr[0] ?? null;
}

/**
 * Une session d'exercice, plein écran, pour n'importe quel exercice du
 * registre : l'énoncé, la correction et la voix viennent de sa définition.
 * Tout se passe ici, sans réseau : les questions sont tirées avant, la
 * correction et le chronomètre tournent dans le navigateur, et le résultat
 * part en un seul envoi à la fin (ou à l'abandon, les réponses déjà données
 * comptent).
 *
 *   - Apprendre : toute la série sous les yeux, une ligne à la fois, lue à
 *     voix haute quand c'est possible ; l'enfant recopie la réponse affichée.
 *     Ni chronomètre ni score.
 *   - S'entraîner : une question à la fois, la barre de temps descend, une
 *     réponse lente est acceptée ; une erreur montre la bonne réponse.
 *   - Test : pareil, sans la bonne réponse pendant le test.
 */
@Component({
  selector: 'rev-runner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KeypadComponent, ClockComponent],
  template: `
    <div class="run" [class.learn]="learn()">
      <div class="top">
        <span class="prog">{{ plan().def.label }} · @if (learn()) { {{ modeLabel() }} } @else { question {{ idx() + 1 }} sur {{ total() }} }</span>
        <button type="button" class="stop" (click)="stop()">Arrêter</button>
      </div>

      <div class="body">
        <div class="zone">
          @if (learn()) {
            <ol class="rows" aria-label="La série à apprendre">
              @for (q of plan().questions; track $index; let i = $index) {
                <li class="row" [class.cur]="i === idx()" [class.done]="i < idx()">{{ rowOf(q) }}</li>
              }
            </ol>
          }
          @let q = current();
          @if (q !== null) {
            @switch (plan().def.prompt) {
              @case ('audio') {
                <!-- L'énoncé est la voix : le mot ne s'affiche qu'en mode Apprendre, pour être recopié. -->
                <div class="ask audio" #ask tabindex="-1" aria-label="Écoute le mot, puis écris-le">
                  @if (learn()) { <span class="word">{{ plan().def.text(q) }}</span> } @else { <span class="hint">Écoute, puis écris le mot</span> }
                  <button type="button" class="again" (click)="say()" [disabled]="!audioOn()">Réécouter</button>
                </div>
              }
              @case ('horloge') {
                <!-- L'énoncé est le cadran : sa légende ne dit pas l'heure, c'est elle qu'on demande. -->
                @let a = askOf(q);
                @let c = plan().def.clock?.(q);
                <div class="ask clock" #ask tabindex="-1" aria-label="Quelle heure est-il sur l’horloge ?">
                  @if (c) { <rev-clock [h]="c.h" [m]="c.m" /> }
                  <div class="line">
                    @if (a.before) { <span class="ops">{{ a.before }}</span> }
                    <span class="ans" [class.empty]="!typed()" [class.ko]="fb()?.kind === 'faux'">{{ shown() || '?' }}</span>
                    @if (a.after) { <span class="ops">{{ a.after }}</span> }
                  </div>
                </div>
              }
              @default {
                @let a = askOf(q);
                <!-- Un énoncé long (« avoir (présent) : tu ») prend une taille plus sobre que « 6 × 7 = ». -->
                <div class="ask" [class.long]="(a.before + a.after).length > 14" #ask tabindex="-1" [attr.aria-label]="plan().def.text(q)">
                  @if (a.before) { <span class="ops">{{ a.before }}</span> }
                  @if (plan().def.input === 'pave') { <span class="ans" [class.empty]="!typed()" [class.ko]="fb()?.kind === 'faux'">{{ shown() || '?' }}</span> }
                  @if (a.after) { <span class="ops">{{ a.after }}</span> }
                </div>
              }
            }
            @if (!learn()) {
              @for (k of [idx()]; track k) {
                <div class="bar" aria-hidden="true"><span [style.animation-duration.ms]="plan().allowedMs"></span></div>
              }
            }
          }
          <div class="fb" [class]="'fb ' + (fb()?.kind ?? '')" role="status" aria-live="polite">{{ fb()?.text ?? '' }}</div>
          @if (learn() && voiceOn() && plan().def.prompt !== 'audio') {
            <button type="button" class="say" (click)="say()">Écouter</button>
          }
        </div>
        <div class="padzone">
          @switch (plan().def.input) {
            @case ('pave') { <rev-keypad [disabled]="busy()" [canSubmit]="!!typed()" (digit)="digit($event)" (erase)="erase()" (submit)="ok()" /> }
            @case ('clavier') {
              <!-- Le clavier du système, sans correction automatique, majuscule ni vérification
                   orthographique : c'est l'enfant qui écrit, pas l'appareil. Sur iPhone et iPad,
                   la barre de suggestions peut rester selon les réglages (docs/revisions.md). -->
              <form class="type" (submit)="$event.preventDefault(); ok()">
                <input #field class="field" [class.ko]="fb()?.kind === 'faux'" [value]="typed()" (input)="type($any($event.target).value)" [disabled]="busy()"
                       type="text" inputmode="text" enterkeyhint="done" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
                       maxlength="40" aria-label="Ta réponse" />
                <button type="submit" class="ok" [disabled]="busy() || !typed().trim()">OK</button>
              </form>
            }
          }
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
    .ask.audio { flex-direction: column; align-items: center; gap: 14px; }
    .ask.long { font-size: clamp(30px, 6vw, 48px); flex-wrap: wrap; justify-content: center; text-align: center; }
    .ask.clock { flex-direction: column; align-items: center; gap: 10px; font-size: clamp(34px, 8vw, 56px); }
    .ask.clock .line { display: flex; align-items: baseline; gap: 14px; }
    .word { font-size: clamp(40px, 10vw, 64px); font-weight: 800; color: var(--primary); }
    .hint { font-size: 22px; font-weight: 800; color: var(--ink2); }
    .again { border: 2px solid var(--line); background: var(--surface); border-radius: 14px; padding: 10px 20px; font-family: inherit; font-size: 17px; font-weight: 800; color: var(--ink); min-height: 52px; cursor: pointer; }
    .type { display: flex; gap: 10px; width: 100%; max-width: 460px; }
    .field { flex: 1; min-width: 0; min-height: 60px; padding: 0 16px; border: 3px solid var(--line); border-radius: 16px; background: var(--surface); font-family: inherit; font-size: 28px; font-weight: 800; color: var(--ink); }
    .field:focus { outline: none; border-color: var(--primary); }
    .field.ko { border-color: #C6492F; color: #C6492F; }
    .ok { min-width: 84px; min-height: 60px; border: none; border-radius: 16px; background: var(--primary); color: #fff; font-family: inherit; font-size: 22px; font-weight: 800; cursor: pointer; }
    .ok:disabled { opacity: .45; cursor: default; }
    .say { border: 2px solid var(--line); background: var(--surface); border-radius: 12px; padding: 8px 16px; font-family: inherit; font-weight: 800; color: var(--ink); min-height: 44px; cursor: pointer; }
    .rows { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 4px 18px; font-size: 18px; font-weight: 700; color: var(--ink3); }
    .row { padding: 3px 10px; border-radius: 8px; }
    .row.done { color: var(--ink2); }
    .row.cur { background: #FCE9E3; color: var(--primary); font-weight: 800; }
    /* Tablette en paysage : la question à gauche, le pavé sous le pouce droit. */
    @media (min-width: 900px) and (orientation: landscape) {
      .body { flex-direction: row; justify-content: center; gap: 60px; }
      .padzone { width: auto; }
      .padzone rev-keypad { width: 340px; }
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
  /** La saisie telle que l'exercice l'affiche (« 745 » : « 7 h 45 »), ou les chiffres tels quels. */
  readonly shown = computed(() => { const t = this.typed(), d = this.plan().def.display; return t && d ? d(t) : t; });
  readonly fb = signal<{ kind: Result; text: string } | null>(null);
  readonly busy = signal(false);
  private readonly askEl = viewChild<ElementRef<HTMLElement>>('ask');
  private readonly fieldEl = viewChild<ElementRef<HTMLInputElement>>('field');
  private answers: RunAnswer[] = [];
  private startedAt = '';
  private shownAt = 0;
  private shownIso = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly learn = computed(() => this.plan().mode === 'apprendre');
  readonly modeLabel = computed(() => MODE_LABELS[this.plan().mode].label);
  readonly total = computed(() => this.plan().questions.length);
  readonly current = computed(() => this.plan().questions[this.idx()] ?? null);
  readonly voiceOn = computed(() => this.plan().voice && !!this.plan().def.spoken && !!frenchVoice());
  /** Un énoncé lu à voix haute : toujours, quel que soit le réglage, c'est l'énoncé. */
  readonly audioOn = computed(() => this.plan().def.prompt === 'audio' && !!this.plan().def.spoken && !!frenchVoice());

  ngOnInit(): void { this.startedAt = new Date().toISOString(); this.show(); }
  ngOnDestroy(): void { if (this.timer) clearTimeout(this.timer); if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }

  /** La bonne réponse telle que l'exercice l'affiche. */
  expectedOf(q: unknown): string { return this.plan().def.check(q, '').expected; }
  /** L'énoncé autour de la case de réponse : « 6 × 7 = ? », « ? × 7 = 42 » ; par défaut, le texte suivi de « = ». */
  askOf(q: unknown): { before: string; after: string } { return this.plan().def.ask?.(q) ?? { before: `${this.plan().def.text(q)} =`, after: '' }; }
  /** Une ligne du mode Apprendre ou de la correction : « 7 × 3 = 21 », « 6 × 7 = 42 » pour un trou, ou le mot seul quand l'énoncé est la réponse. */
  rowOf(q: unknown): string {
    const t = this.plan().def.text(q), e = this.expectedOf(q), a = this.plan().def.ask?.(q);
    return a ? `${a.before} ${e} ${a.after}`.trim() : t === e ? t : `${t} = ${e}`;
  }

  /** Le clavier d'un Mac ou d'un clavier branché à l'iPad : chiffres, retour arrière, Entrée. */
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (this.plan().def.input !== 'pave') return;
    if (/^[0-9]$/.test(e.key)) { this.digit(e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { this.erase(); e.preventDefault(); }
    else if (e.key === 'Enter') { this.ok(); e.preventDefault(); }
  }

  private show(): void {
    this.typed.set(''); this.shownAt = performance.now(); this.shownIso = new Date().toISOString();
    // Au clavier, le champ prend le focus (le clavier du système monte) ; sinon l'énoncé, pour un lecteur d'écran.
    setTimeout(() => (this.fieldEl() ?? this.askEl())?.nativeElement.focus());
    if (this.audioOn() || (this.learn() && this.voiceOn())) this.say();
  }

  say(): void {
    const q = this.current(); const v = frenchVoice(); const text = q !== null ? this.plan().def.spoken?.(q) : undefined;
    if (!text || !v) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v; u.lang = v.lang; u.rate = 0.9;
    speechSynthesis.speak(u);
  }

  digit(d: string): void { if (!this.busy() && this.typed().length < 4) this.typed.update((t) => (t === '0' ? d : t + d)); }
  type(v: string): void { if (!this.busy()) this.typed.set(v.slice(0, 40)); }
  erase(): void { if (!this.busy()) this.typed.update((t) => t.slice(0, -1)); }
  skip(): void { if (!this.busy()) this.answer(null); }
  ok(): void { if (!this.busy() && this.typed().trim()) this.answer(this.typed()); }

  private answer(given: string | null): void {
    const q = this.current(); if (q === null) return;
    const p = this.plan();
    const ms = Math.round(performance.now() - this.shownAt);
    const c = p.def.check(q, given ?? '');
    const base = { question: q, key: p.def.itemKey(q), given, ms, askedAt: this.shownIso };
    if (this.learn()) {
      // Recopier : juste, on passe à la ligne suivante ; sinon on recommence la même.
      this.answers.push({ ...base, result: c.ok ? 'bon' : 'faux' });
      if (!c.ok) { this.fb.set({ kind: 'faux', text: `Recopie ${c.expected}` }); this.typed.set(''); return; }
      this.fb.set({ kind: 'bon', text: 'Oui !' });
      return this.next(450);
    }
    const result = classify(c.ok, given, ms, p.fastMs);
    this.answers.push({ ...base, result });
    const show = p.mode === 'entrainer';
    const text = result === 'bon' ? 'Bravo !'
      : result === 'lent' ? 'Juste, un peu lent'
      : show ? this.rowOf(q) : result === 'passe' ? 'On passe' : 'Pas tout à fait';
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
