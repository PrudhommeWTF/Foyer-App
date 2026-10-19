import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { TablesStore } from '../../core/tables.store';
import { PairHistory, SessionReceipt, TablesApi } from '../../core/tables.api';
import { MODES, Mode, OPERATIONS, Operation, Question, drawQuestions, goalLine, learnRows, pairKey, rangeLabel, sessionUuid, signOf, summaryLine } from '../../core/tables';
import { ModalComponent } from '../../shared/modal';
import { GridComponent } from './grid';
import { RunPlan, RunResult, RunnerComponent, frenchVoice } from './runner';
import { HistoryComponent } from './history';
import { SuiviComponent } from './suivi';

interface Summary { plan: RunPlan; result: RunResult; receipt: SessionReceipt | null; }

/**
 * L'écran Tables. Pour un enfant : deux taps pour commencer (« Mon
 * entraînement du jour », le programme réglé par un parent ; ou « Je choisis »),
 * sa grille, et le bilan de fin. Pour un adulte : la même chose pour lui-même
 * (sa grille existe, sans programme ni bilan), et l'onglet Suivi des enfants.
 * Pas de points ni de classement : c'est la grille qui se colorie.
 */
@Component({
  selector: 'screen-tables',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, GridComponent, RunnerComponent, SuiviComponent, HistoryComponent],
  template: `
    @if (!store.foyer.isChild()) {
      <div class="tabs" role="tablist">
        <button role="tab" [attr.aria-selected]="tab() === 'moi'" [class.on]="tab() === 'moi'" (click)="tab.set('moi')">M’entraîner</button>
        <button role="tab" [attr.aria-selected]="tab() === 'suivi'" [class.on]="tab() === 'suivi'" (click)="tab.set('suivi')">Suivi des enfants</button>
      </div>
    }

    @if (tab() === 'suivi' && !store.foyer.isChild()) {
      <tables-suivi />
    } @else {
      @let ov = store.mine();
      @if (store.queue().length) {
        <div class="note">{{ store.queue().length > 1 ? store.queue().length + ' sessions attendent' : 'Une session attend' }} le réseau : elle{{ store.queue().length > 1 ? 's partiront' : ' partira' }} toute{{ store.queue().length > 1 ? 's' : '' }} seule{{ store.queue().length > 1 ? 's' : '' }}.</div>
      }
      @if (!ov) {
        <div class="card empty">@if (store.offline()) { Pas de réseau, et rien de gardé sur cet appareil pour l’instant. } @else { Chargement… }</div>
      } @else {
        <div class="start">
          @if (ov.program; as p) {
            <button class="big main" (click)="startProgram()">
              <span class="b-l">Mon entraînement du jour</span>
              <span class="b-s">{{ cap(rangeLabel(p.from, p.to)) }} · {{ p.operation === 'multiplication' ? 'multiplication' : 'addition' }} · {{ p.questions }} questions</span>
              @if (goal()) { <span class="b-g">{{ goal() }}</span> }
            </button>
          }
          <button class="big" (click)="openChooser()">
            <span class="b-l">Je choisis</span>
            <span class="b-s">Une opération, des tables, un mode</span>
          </button>
        </div>

        <div class="card">
          <div class="card-h"><span>Ma grille</span>
            <div class="seg">
              @for (o of ops; track o.id) { <button [class.on]="ov.operation === o.id" (click)="switchOp(o.id)">{{ o.sign }}</button> }
            </div>
          </div>
          <tables-grid [op]="ov.operation" [max]="ov.tablesMax" [cells]="ov.mastery" [highlight]="changed()" (pick)="openHistory($event.a, $event.b)" />
        </div>
      }
    }

    @if (choosing()) {
      <f-modal title="Je choisis" [maxWidth]="460" (close)="choosing.set(false)">
        <div class="lbl">Opération</div>
        <div class="seg wide">
          @for (o of ops; track o.id) { <button [class.on]="cOp() === o.id" (click)="cOp.set(o.id)">{{ o.label }}</button> }
        </div>
        <div class="lbl">Mode</div>
        <div class="modes">
          @for (m of modes; track m.id) {
            <button class="mode" [class.on]="cMode() === m.id" (click)="cMode.set(m.id)"><b>{{ m.label }}</b><span>{{ m.sub }}</span></button>
          }
        </div>
        <div class="lbl">{{ cMode() === 'apprendre' ? 'La table' : 'Les tables' }}</div>
        <div class="range">
          @if (cMode() !== 'apprendre') { <span>de</span> }
          <select [value]="cFrom()" (change)="setFrom(+$any($event.target).value)" aria-label="Première table">
            @for (t of axis(); track t) { <option [value]="t" [selected]="t === cFrom()">{{ t }}</option> }
          </select>
          @if (cMode() !== 'apprendre') {
            <span>à</span>
            <select [value]="cTo()" (change)="cTo.set(+$any($event.target).value)" aria-label="Dernière table">
              @for (t of axis(); track t) { @if (t >= cFrom()) { <option [value]="t" [selected]="t === cTo()">{{ t }}</option> } }
            </select>
          }
        </div>
        <button class="btn btn-primary btn-block go" (click)="startChosen()">C’est parti</button>
      </f-modal>
    }

    @if (plan(); as p) {
      <tables-runner [plan]="p" (finished)="done(p, $event)" (quit)="plan.set(null)" />
    }

    @if (summary(); as s) {
      <div class="sum" role="dialog" aria-modal="true" aria-labelledby="sum-t">
        <div class="sum-in">
          @if (s.plan.mode === 'apprendre') {
            <div id="sum-t" class="sum-t">Bravo, tu as écrit {{ rangeLabel(s.plan.from, s.plan.to) }} !</div>
          } @else {
            <div id="sum-t" class="sum-t">{{ s.result.aborted ? 'Session arrêtée' : 'Bravo !' }}</div>
            <p class="sum-l">{{ line(s) }}</p>
            @if (toReview(s).length) {
              <p class="sum-r">À revoir : {{ toReview(s).join(', ') }}</p>
            }
            @if (!s.receipt) { <p class="sum-w">Pas de réseau : la session est gardée sur l’appareil et partira toute seule.</p> }
            @else if (store.mine(); as ov) {
              <div class="sum-g"><tables-grid [op]="ov.operation" [max]="ov.tablesMax" [cells]="ov.mastery" [highlight]="changed()" /></div>
            }
          }
          <div class="sum-b">
            <button class="btn btn-soft" (click)="again(s)">Encore une</button>
            <button class="btn btn-primary" (click)="summary.set(null)">J’ai fini</button>
          </div>
        </div>
      </div>
    }

    @if (history(); as h) { <tables-history [data]="h" [op]="store.mine()?.operation ?? 'multiplication'" (close)="history.set(null)" /> }
  `,
  styles: [`
    .tabs { display: flex; gap: 8px; margin-bottom: 18px; }
    .tabs button { border: none; background: var(--soft2); color: var(--ink2); border-radius: 12px; padding: 10px 16px; font-family: inherit; font-size: 14px; font-weight: 800; cursor: pointer; min-height: 44px; }
    .tabs button.on { background: var(--ink); color: var(--bg); }
    .note { margin-bottom: 14px; padding: 10px 14px; border-radius: 12px; background: #FDF0DA; color: #8A5A07; font-size: 13px; font-weight: 700; }
    .empty { padding: 24px; text-align: center; font-weight: 700; color: var(--ink2); }
    .start { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-bottom: 18px; }
    .big { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-height: 120px; padding: 20px 22px; border: none; border-radius: 22px; background: var(--surface); box-shadow: var(--sh-float); cursor: pointer; font-family: inherit; text-align: left; }
    .big.main { background: var(--primary); color: #fff; }
    .b-l { font-size: 22px; font-weight: 800; }
    .b-s { font-size: 14px; font-weight: 700; opacity: .85; }
    .b-g { margin-top: 4px; font-size: 13px; font-weight: 800; padding: 4px 10px; border-radius: 10px; background: rgba(255,255,255,.22); }
    .big:not(.main) .b-l { color: var(--ink); }
    .big:not(.main) .b-s { color: var(--ink2); }
    .card-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; font-size: 15px; font-weight: 800; color: var(--ink); }
    .seg { display: inline-flex; background: var(--soft2); border-radius: 12px; padding: 3px; gap: 3px; }
    .seg button { border: none; background: transparent; border-radius: 10px; padding: 8px 14px; font-family: inherit; font-size: 15px; font-weight: 800; color: var(--ink2); cursor: pointer; min-height: 40px; }
    .seg button.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh-float); }
    .seg.wide { display: flex; } .seg.wide button { flex: 1; }
    .lbl { margin: 16px 0 8px; font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .lbl:first-child { margin-top: 0; }
    .modes { display: flex; flex-direction: column; gap: 8px; }
    .mode { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 14px; border: 2px solid var(--line); border-radius: 14px; background: var(--surface); font-family: inherit; cursor: pointer; text-align: left; min-height: 56px; }
    .mode b { font-size: 16px; color: var(--ink); } .mode span { font-size: 12.5px; font-weight: 600; color: var(--ink2); }
    .mode.on { border-color: var(--primary); background: #FCE9E3; }
    .range { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 800; color: var(--ink2); }
    .range select { min-height: 48px; min-width: 76px; font-size: 18px; font-weight: 800; border-radius: 12px; border: 2px solid var(--line); background: var(--surface); color: var(--ink); padding: 0 10px; font-family: inherit; }
    .go { margin-top: 20px; min-height: 52px; font-size: 17px; }
    .sum { position: fixed; inset: 0; z-index: 61; background: var(--bg); display: flex; align-items: center; justify-content: center; padding: 20px 16px; overflow-y: auto; }
    .sum-in { width: 100%; max-width: 520px; text-align: center; display: flex; flex-direction: column; gap: 12px; align-items: center; }
    .sum-t { font-size: 34px; font-weight: 800; color: var(--primary); }
    .sum-l { font-size: 18px; font-weight: 700; color: var(--ink); margin: 0; }
    .sum-g { width: 100%; max-width: 420px; margin-top: 6px; }
    .sum-r { font-size: 16px; font-weight: 800; color: var(--ink2); margin: 0; }
    .sum-w { font-size: 13px; font-weight: 700; color: #8A5A07; margin: 0; }
    .sum-b { display: flex; gap: 12px; margin-top: 10px; }
    .sum-b .btn { min-height: 52px; min-width: 140px; font-size: 16px; }
  `],
})
export class TablesScreen implements OnDestroy {
  readonly store = inject(TablesStore);
  private api = inject(TablesApi);
  readonly ops = OPERATIONS;
  readonly modes = MODES;
  readonly rangeLabel = rangeLabel;

  readonly tab = signal<'moi' | 'suivi'>('moi');
  readonly choosing = signal(false);
  readonly cOp = signal<Operation>('multiplication');
  readonly cMode = signal<Mode>('entrainer');
  readonly cFrom = signal(2);
  readonly cTo = signal(5);
  readonly plan = signal<RunPlan | null>(null);
  readonly summary = signal<Summary | null>(null);
  readonly history = signal<PairHistory | null>(null);
  /** Les cases qui viennent de changer, soulignées dans la grille après une session. */
  readonly changed = signal<ReadonlySet<string>>(new Set());
  /** Les voix de l'appareil arrivent parfois après le chargement : on les guette. */
  private readonly hasVoice = signal(!!frenchVoice());
  private readonly onVoices = (): void => this.hasVoice.set(!!frenchVoice());

  constructor() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener?.('voiceschanged', this.onVoices);
    const me = this.store.me();
    if (me) void this.store.loadStats(me);
  }
  ngOnDestroy(): void { if (typeof speechSynthesis !== 'undefined') speechSynthesis.removeEventListener?.('voiceschanged', this.onVoices); }

  readonly axis = computed(() => Array.from({ length: (this.store.mine()?.tablesMax ?? 10) + 1 }, (_, i) => i));
  readonly goal = computed(() => {
    const ov = this.store.mine(); const me = this.store.me();
    if (!ov?.program || !me) return '';
    this.store.stats(); this.store.queue();
    return goalLine(this.store.sessionsToday(me), ov.program.dailyGoal);
  });

  cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
  /** « Je choisis » part du programme quand il y en a un : la plage la plus probable. */
  openChooser(): void {
    const p = this.store.mine()?.program;
    if (p) { this.cOp.set(p.operation); this.cFrom.set(p.from); this.cTo.set(p.to); }
    this.choosing.set(true);
  }
  setFrom(v: number): void { this.cFrom.set(v); if (this.cTo() < v) this.cTo.set(v); }
  switchOp(op: Operation): void { const me = this.store.me(); if (me) void this.store.load(me, op); }

  private build(mode: Mode, op: Operation, from: number, to: number, count: number, bothDirections: boolean, programId: number | null): RunPlan | null {
    const ov = this.store.mine(); if (!ov) return null;
    const cells = ov.operation === op ? ov.mastery : [];
    const questions: Question[] = mode === 'apprendre' ? learnRows(op, from, Math.max(10, ov.tablesMax))
      : drawQuestions({ op, from, to, max: ov.tablesMax, count, bothDirections, mastery: cells, now: new Date().toISOString() });
    const voice = mode === 'apprendre' && this.store.foyer.devicePref('tablesVoix') !== false && this.hasVoice();
    return { mode, op, from, to: mode === 'apprendre' ? from : to, questions, allowedMs: ov.timing.allowedMs, fastMs: ov.timing.fastMs, programId, voice };
  }

  startProgram(): void {
    const p = this.store.mine()?.program; if (!p) return;
    this.changed.set(new Set());
    this.plan.set(this.build('entrainer', p.operation, p.from, p.to, p.questions, p.bothDirections, p.id));
  }
  startChosen(): void {
    const p = this.store.mine()?.program;
    this.choosing.set(false); this.changed.set(new Set());
    this.plan.set(this.build(this.cMode(), this.cOp(), this.cFrom(), this.cTo(), p?.questions ?? 20, p?.bothDirections ?? true, null));
  }
  again(s: Summary): void {
    this.summary.set(null);
    this.plan.set(this.build(s.plan.mode, s.plan.op, s.plan.from, s.plan.to, s.plan.questions.length, this.store.mine()?.program?.bothDirections ?? true, s.plan.programId));
  }

  async done(plan: RunPlan, result: RunResult): Promise<void> {
    this.plan.set(null);
    const me = this.store.me(); if (!me) return;
    this.summary.set({ plan, result, receipt: null });
    const receipt = await this.store.submit({
      id: sessionUuid(), memberId: me, programId: plan.programId, mode: plan.mode, operation: plan.op, from: plan.from, to: plan.to,
      startedAt: result.startedAt, endedAt: result.endedAt, aborted: result.aborted, allowedMs: plan.allowedMs, fastMs: plan.fastMs,
      tactile: navigator.maxTouchPoints > 0, answers: result.answers.map(({ a, b, given, ms, askedAt }) => ({ a, b, given, ms, askedAt })),
    });
    if (this.summary()?.result === result) this.summary.set({ plan, result, receipt });
    if (receipt) this.changed.set(new Set(receipt.changes.filter((c) => c.before !== c.after).map((c) => pairKey(c.a, c.b))));
  }

  count(s: Summary, r: string): number { return s.result.answers.filter((a) => a.result === r).length; }
  line(s: Summary): string {
    return summaryLine(s.plan.from, s.plan.to, { good: this.count(s, 'bon'), slow: this.count(s, 'lent'), wrong: this.count(s, 'faux') + this.count(s, 'passe') });
  }
  toReview(s: Summary): string[] {
    const sg = signOf(s.plan.op);
    return [...new Set(s.result.answers.filter((a) => a.result !== 'bon').map((a) => `${a.a} ${sg} ${a.b}`))].slice(0, 8);
  }

  async openHistory(a: number, b: number): Promise<void> {
    const me = this.store.me(); const ov = this.store.mine(); if (!me || !ov) return;
    try { this.history.set(await this.api.history(me, ov.operation, a, b)); }
    catch { this.store.foyer.toast('L’historique de cette case n’est pas disponible sans réseau.'); }
  }
}
