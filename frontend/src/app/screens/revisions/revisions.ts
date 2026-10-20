import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { IconComponent } from '../../core/icon';
import { ItemHistory, SessionReceipt } from '../../core/revisions/api';
import { ExerciseDef, MODES, Mode, Params } from '../../core/revisions/exercises/contract';
import { EXERCISES } from '../../core/revisions/exercises';
import { MODE_LABELS, dayLine, drawQuestions, fragile, goalLine, sessionUuid, summaryLine } from '../../core/revisions/revisions';
import { RevisionsStore } from '../../core/revisions/store';
import { ModalComponent } from '../../shared/modal';
import { GridComponent } from './grid';
import { ListComponent } from './list';
import { HistoryComponent } from './history';
import { ParamsFormComponent } from './params-form';
import { RunPlan, RunResult, RunnerComponent, SUPPORTED_INPUTS, frenchVoice } from './runner';
import { SuiviComponent } from './suivi';

/** Le nombre de questions d'une session sans programme (un adulte, ou un enfant à qui rien n'est encore réglé). */
const FREE_QUESTIONS = 20;
const NONE: ReadonlySet<string> = new Set();

/** Une session finie, et où en est son envoi : partie, reçue, ou en attente du réseau. */
interface Done { plan: RunPlan; result: RunResult; receipt: SessionReceipt | null; sent: 'envoi' | 'recue' | 'attente'; }
interface Chooser { def: ExerciseDef; mode: Mode; params: Params; }

/**
 * L'écran Révisions. Un bouton « Mon entraînement du jour » enchaîne les
 * exercices du programme réglé par un parent (sans programme : chaque
 * exercice, à ses réglages par défaut) ; puis une carte par exercice, rangée
 * par matière, avec sa grille et « Je choisis ». Rien ici ne connaît un
 * exercice : le registre (core/revisions/exercises) dit lesquels existent,
 * leur définition dit comment les poser et les corriger. Pas de points ni de
 * classement : c'est la grille qui se colorie.
 */
@Component({
  selector: 'screen-revisions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ModalComponent, GridComponent, ListComponent, RunnerComponent, HistoryComponent, ParamsFormComponent, SuiviComponent],
  template: `
    <div class="screen-enter">
      <!-- Un adulte ne s'entraîne pas ici : l'écran est le suivi de ses enfants. -->
      @if (!store.foyer.isChild()) {
        @if (store.foyer.children().length) {
          <rev-suivi [kid]="followed()" />
        } @else {
          <div class="card empty">Les révisions se règlent et se suivent pour les enfants du foyer. Ajoutez un enfant dans la famille (fiche cochée « enfant ») pour commencer.</div>
        }
      } @else {
      @if (store.queue().length; as n) {
        <div class="note">{{ n > 1 ? n + ' sessions attendent le réseau : elles partiront toutes seules.' : 'Une session attend le réseau : elle partira toute seule.' }}</div>
      }
      @if (!ready()) {
        <div class="card empty">@if (store.offline()) { Pas de réseau, et rien de gardé sur cet appareil pour l’instant. } @else { Chargement… }</div>
      } @else {
        <button class="big" (click)="startDay()" [disabled]="!dayPlans().length">
          <span class="b-l">Mon entraînement du jour</span>
          <span class="b-s">{{ daySub() }}</span>
          @if (dayGoal()) { <span class="b-g">{{ dayGoal() }}</span> }
        </button>

        @for (g of groups(); track g.matiere) {
          <h2 class="mat">{{ g.label }}</h2>
          @for (def of g.defs; track def.id) {
            @let ov = store.overviews()[def.id];
            @if (ov) {
              <section class="card ex">
                <div class="ex-h">
                  <span class="ex-i"><f-icon [name]="def.icon" [size]="22" color="var(--primary)" [width]="2.2" /></span>
                  <div class="ex-t">
                    <div class="card-title">{{ def.label }}</div>
                    <div class="ex-s">{{ def.summary(ov.params, store.ctxOf(def.id)) }}@if (ov.program) { · {{ ov.program.questions }} questions }</div>
                    @if (ov.program && goalOf(def.id); as gl) { <div class="ex-g">{{ gl }}</div> }
                  </div>
                </div>
                <div class="ex-b">
                  <button class="btn btn-primary" (click)="startOne(def)">S’entraîner</button>
                  <button class="btn btn-soft" (click)="openChooser(def)">Je choisis</button>
                </div>
                @switch (def.view) {
                  @case ('grille') { @if (def.grid) { <rev-grid [def]="def" [params]="ov.params" [items]="ov.mastery" [highlight]="hl(def.id)" (pick)="openHistory(def, $event)" /> } }
                  @case ('liste') { <rev-list [def]="def" [params]="ov.params" [ctx]="store.ctxOf(def.id)" [items]="ov.mastery" [highlight]="hl(def.id)" (pick)="openHistory(def, $event)" /> }
                }
                @if (toWork(def.id).length) {
                  <div class="work"><span class="work-l">À retravailler</span>
                    @for (it of toWork(def.id); track it.key) { <button class="chip" (click)="openHistory(def, it.key)">{{ it.label }}</button> }
                  </div>
                }
              </section>
            }
          }
        }
        @for (d of unavailable(); track d.id) {
          <p class="na">« {{ d.label }} » : pas sur cet appareil. L’exercice se lit à voix haute, et l’appareil n’a pas de voix française (sur iPhone et iPad : Réglages → Accessibilité → Contenu énoncé → Voix).</p>
        }
      }
      }
    </div>

    @if (chooser(); as c) {
      <f-modal [title]="c.def.label + ' : je choisis'" [maxWidth]="460" (close)="chooser.set(null)">
        <div class="lbl">Mode</div>
        <div class="modes">
          @for (m of modesOf(c.def); track m) {
            <button class="mode" [class.on]="c.mode === m" (click)="choose({ mode: m })"><b>{{ modeLabels[m].label }}</b><span>{{ modeLabels[m].sub }}</span></button>
          }
        </div>
        <rev-params-form [def]="c.def" [value]="c.params" [ctx]="store.ctxOf(c.def.id)" (edited)="choose({ params: $event })" />
        <button class="btn btn-primary btn-block go" (click)="startChosen(c)">C’est parti</button>
      </f-modal>
    }

    @if (running(); as p) {
      <rev-runner [plan]="p" (finished)="finished(p, $event)" (quit)="quit()" />
    }

    @if (between(); as nx) {
      <div class="sum" role="dialog" aria-modal="true" aria-labelledby="bt-t">
        <div class="sum-in">
          <div id="bt-t" class="sum-t">Bravo !</div>
          <p class="sum-l">Ensuite : {{ nx.def.label }}, {{ nx.questions.length }} questions.</p>
          <div class="sum-b">
            <button class="btn btn-soft" (click)="toSummary()">J’arrête là</button>
            <button class="btn btn-primary" (click)="continueChain()">Continuer</button>
          </div>
        </div>
      </div>
    }

    @if (summary()) {
      <div class="sum" role="dialog" aria-modal="true" aria-labelledby="sum-t">
        <div class="sum-in">
          <div id="sum-t" class="sum-t">{{ aborted() ? 'Session arrêtée' : 'Bravo !' }}</div>
          @for (d of dones(); track $index) {
            <div class="sum-x">
              @if (dones().length > 1) { <div class="sum-h">{{ d.plan.def.label }}</div> }
              @if (d.plan.mode === 'apprendre') {
                <p class="sum-l">{{ learnLine(d) }}</p>
              } @else {
                <p class="sum-l">{{ line(d) }}</p>
                @if (review(d).length) { <p class="sum-r">À revoir : {{ review(d).join(', ') }}</p> }
                @if (d.receipt && store.overviews()[d.plan.def.id]; as ov) {
                  <div class="sum-g">
                    @switch (d.plan.def.view) {
                      @case ('grille') { @if (d.plan.def.grid) { <rev-grid [def]="d.plan.def" [params]="ov.params" [items]="ov.mastery" [highlight]="hl(d.plan.def.id)" /> } }
                      @case ('liste') { <rev-list [def]="d.plan.def" [params]="d.plan.params" [ctx]="store.ctxOf(d.plan.def.id)" [items]="ov.mastery" [highlight]="hl(d.plan.def.id)" /> }
                    }
                  </div>
                }
              }
            </div>
          }
          @if (waiting()) { <p class="sum-w">Pas de réseau : la session est gardée sur l’appareil et partira toute seule.</p> }
          <div class="sum-b">
            @if (dones().length === 1) { <button class="btn btn-soft" (click)="again()">Encore une</button> }
            <button class="btn btn-primary" (click)="closeSummary()">J’ai fini</button>
          </div>
        </div>
      </div>
    }

    @if (history(); as h) { <rev-history [data]="h" (close)="history.set(null)" /> }
  `,
  styles: [`
    .na { margin: 6px 0 14px; font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.45; }
    .note { margin-bottom: 14px; padding: 10px 14px; border-radius: 12px; background: #FDF0DA; color: #8A5A07; font-size: 13px; font-weight: 700; }
    .empty { padding: 24px; text-align: center; font-weight: 700; color: var(--ink2); }
    .big { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; width: 100%; min-height: 120px; padding: 20px 22px; margin-bottom: 8px; border: none; border-radius: 22px;
           background: var(--primary); color: #fff; box-shadow: var(--sh-primary); cursor: pointer; font-family: inherit; text-align: left; }
    .big:disabled { opacity: .5; cursor: default; }
    .b-l { font-size: 22px; font-weight: 800; }
    .b-s { font-size: 14px; font-weight: 700; opacity: .9; }
    .b-g { margin-top: 4px; font-size: 13px; font-weight: 800; padding: 4px 10px; border-radius: 10px; background: rgba(255,255,255,.22); }
    .mat { margin: 22px 0 10px; font-size: 13px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .06em; }
    .ex { display: flex; flex-direction: column; gap: 14px; margin-bottom: 14px; }
    .ex-h { display: flex; gap: 12px; align-items: flex-start; }
    .ex-i { width: 42px; height: 42px; flex: none; border-radius: 13px; background: #FCE9E3; display: flex; align-items: center; justify-content: center; }
    .ex-s { margin-top: 2px; font-size: 13.5px; font-weight: 700; color: var(--ink2); }
    .ex-g { margin-top: 4px; font-size: 12.5px; font-weight: 800; color: var(--sage-d, #5F7E5C); }
    .ex-b { display: flex; gap: 10px; flex-wrap: wrap; }
    .ex-b .btn { min-height: 48px; padding: 0 20px; font-size: 15px; }
    .work { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .work-l { font-size: 12px; font-weight: 800; color: var(--ink3); margin-right: 4px; }
    .chip { border: none; background: var(--soft2); color: var(--ink); border-radius: 10px; padding: 6px 10px; font-family: inherit; font-size: 13px; font-weight: 800; cursor: pointer; min-height: 34px; }
    .lbl { margin: 0 0 8px; font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .modes { display: flex; flex-direction: column; gap: 8px; }
    .mode { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 12px 14px; border: 2px solid var(--line); border-radius: 14px; background: var(--surface); font-family: inherit; cursor: pointer; text-align: left; min-height: 56px; }
    .mode b { font-size: 16px; color: var(--ink); } .mode span { font-size: 12.5px; font-weight: 600; color: var(--ink2); }
    .mode.on { border-color: var(--primary); background: #FCE9E3; }
    .go { margin-top: 20px; min-height: 52px; font-size: 17px; }
    .sum { position: fixed; inset: 0; z-index: 61; background: var(--bg); display: flex; align-items: center; justify-content: center; padding: 20px 16px; overflow-y: auto; }
    .sum-in { width: 100%; max-width: 520px; max-height: 100%; text-align: center; display: flex; flex-direction: column; gap: 12px; align-items: center; }
    .sum-x { display: flex; flex-direction: column; gap: 8px; align-items: center; width: 100%; }
    .sum-h { font-size: 15px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .sum-t { font-size: 34px; font-weight: 800; color: var(--primary); }
    .sum-l { font-size: 18px; font-weight: 700; color: var(--ink); margin: 0; }
    .sum-g { width: 100%; max-width: 420px; margin-top: 6px; }
    .sum-r { font-size: 16px; font-weight: 800; color: var(--ink2); margin: 0; }
    .sum-w { font-size: 13px; font-weight: 700; color: #8A5A07; margin: 0; }
    .sum-b { display: flex; gap: 12px; margin-top: 10px; }
    .sum-b .btn { min-height: 52px; min-width: 140px; font-size: 16px; }
  `],
})
export class RevisionsScreen implements OnDestroy {
  readonly store = inject(RevisionsStore);
  readonly modeLabels = MODE_LABELS;

  /** L'enfant dont le suivi a été demandé (notification du dimanche), passé au suivi. */
  readonly followed = signal<string | null>(null);
  readonly chooser = signal<Chooser | null>(null);
  /** La série en cours : les sessions à enchaîner, et où on en est. */
  private readonly chain = signal<{ plans: RunPlan[]; i: number } | null>(null);
  readonly running = signal<RunPlan | null>(null);
  readonly between = signal<RunPlan | null>(null);
  readonly dones = signal<Done[]>([]);
  readonly summary = signal(false);
  readonly history = signal<ItemHistory | null>(null);
  /** Par exercice, les items qui viennent de changer, soulignés dans la grille après une session. */
  readonly changed = signal<Record<string, ReadonlySet<string>>>({});
  /** Les voix de l'appareil arrivent parfois après le chargement : on les guette. */
  private readonly hasVoice = signal(!!frenchVoice());
  private readonly onVoices = (): void => this.hasVoice.set(!!frenchVoice());

  constructor() {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.addEventListener?.('voiceschanged', this.onVoices);
    effect(() => {
      const kid = this.store.follow();
      if (kid) untracked(() => { this.followed.set(kid); this.store.follow.set(null); });
    });
  }
  ngOnDestroy(): void { if (typeof speechSynthesis !== 'undefined') speechSynthesis.removeEventListener?.('voiceschanged', this.onVoices); }

  /** Les exercices que cet écran sait faire tourner, rangés par matière dans l'ordre de la configuration. */
  /** Ce que l'appareil sait faire : une voix française, pour un exercice qui lit à voix haute. */
  private readonly can = (d: ExerciseDef): boolean => (d.requires ?? []).every((c) => c !== 'voix' || this.hasVoice());
  private readonly available = computed(() => EXERCISES.filter((d) => SUPPORTED_INPUTS.has(d.input) && this.can(d)));
  /** Les exercices que l'appareil ne peut pas faire tourner faute de voix : on le dit plutôt que de les cacher. */
  readonly unavailable = computed(() => EXERCISES.filter((d) => SUPPORTED_INPUTS.has(d.input) && !this.can(d)));
  readonly groups = computed(() => {
    const order = this.store.matieres();
    const ids = [...new Set([...order.map((m) => m.id), ...this.available().map((d) => d.matiere)])];
    return ids.map((id) => ({ matiere: id, label: order.find((m) => m.id === id)?.label ?? id, defs: this.available().filter((d) => d.matiere === id) }))
      .filter((g) => g.defs.length);
  });
  readonly ready = computed(() => this.available().some((d) => this.store.overviews()[d.id]));

  /** Les exercices du jour : ceux qu'un parent a réglés ; sans programme, tous, à leurs réglages par défaut. */
  private readonly dayDefs = computed(() => {
    const ready = this.available().filter((d) => this.store.overviews()[d.id]);
    const set = ready.filter((d) => this.store.overviews()[d.id]!.program);
    return set.length ? set : ready;
  });
  readonly dayPlans = computed(() => this.dayDefs().map((d) => this.planOf(d, 'entrainer', this.store.overviews()[d.id]!.params, true)).filter((p): p is RunPlan => !!p));
  readonly daySub = computed(() => {
    const ps = this.dayPlans();
    if (!ps.length) return '';
    const total = ps.reduce((t, p) => t + p.questions.length, 0);
    return (ps.length === 1 ? ps[0].def.summary(ps[0].params, this.store.ctxOf(ps[0].def.id)) : ps.map((p) => p.def.label).join(', ')) + ` · ${total} questions`;
  });
  readonly dayGoal = computed(() => {
    this.store.recent(); this.store.queue();
    const progs = this.dayDefs().map((d) => this.store.overviews()[d.id]?.program).filter((p) => !!p);
    return progs.length ? dayLine(progs.map((p) => ({ done: this.store.doneToday(p.exerciseId), goal: p.dailyGoal }))) : '';
  });
  readonly aborted = computed(() => this.dones().some((d) => d.result.aborted));
  readonly waiting = computed(() => this.dones().some((d) => d.sent === 'attente'));

  goalOf(ex: string): string {
    this.store.recent(); this.store.queue();
    const p = this.store.overviews()[ex]?.program;
    return p ? goalLine(this.store.doneToday(ex), p.dailyGoal) : '';
  }
  /** Les items soulignés dans la grille d'un exercice. */
  hl(ex: string): ReadonlySet<string> { return this.changed()[ex] ?? NONE; }
  toWork(ex: string) {
    const ov = this.store.overviews()[ex]; const def = EXERCISES.find((d) => d.id === ex);
    return ov && def ? fragile(ov.mastery, 6, def.universe(ov.params, this.store.ctxOf(ex))) : [];
  }
  modesOf(def: ExerciseDef): Mode[] { return MODES.filter((m) => m !== 'apprendre' || !!def.learn); }

  /**
   * Une session prête à tourner : les questions tirées d'avance (dus d'abord),
   * le temps accordé du membre. `program` : la session du programme (ses
   * paramètres, son nombre de questions), sinon une session libre.
   */
  private planOf(def: ExerciseDef, mode: Mode, params: Params, program: boolean): RunPlan | null {
    const ov = this.store.overviews()[def.id]; if (!ov) return null;
    const prog = program ? ov.program : null;
    const ctx = this.store.ctxOf(def.id);
    const questions = mode === 'apprendre' ? def.learn?.(params, ctx) ?? []
      : drawQuestions(def, params, { count: prog?.questions ?? ov.program?.questions ?? FREE_QUESTIONS, mastery: ov.mastery, now: new Date().toISOString(), ctx });
    if (!questions.length) return null;
    const voice = mode === 'apprendre' && this.store.foyer.devicePref('revisionsVoix') !== false && this.hasVoice();
    return { def, params, mode, questions, allowedMs: ov.timing.allowedMs, fastMs: ov.timing.fastMs, programId: prog?.id ?? null, voice };
  }

  private run(plans: RunPlan[]): void {
    if (!plans.length) return;
    this.dones.set([]); this.changed.set({}); this.summary.set(false);
    this.chain.set({ plans, i: 0 });
    this.running.set(plans[0]);
  }
  startDay(): void { this.run(this.dayPlans()); }
  startOne(def: ExerciseDef): void {
    const ov = this.store.overviews()[def.id]; if (!ov) return;
    const p = this.planOf(def, 'entrainer', ov.params, true);
    if (p) this.run([p]);
  }
  openChooser(def: ExerciseDef): void {
    const ov = this.store.overviews()[def.id]; if (!ov) return;
    this.chooser.set({ def, mode: 'entrainer', params: ov.params });
  }
  /** Change le mode ou les paramètres choisis, toujours à partir de l'état courant. */
  choose(change: Partial<Chooser>): void { this.chooser.update((c) => c && { ...c, ...change }); }
  startChosen(c: Chooser): void {
    this.chooser.set(null);
    const p = this.planOf(c.def, c.mode, c.params, false);
    if (p) this.run([p]);
  }
  again(): void {
    const d = this.dones()[0]; if (!d) return;
    const p = this.planOf(d.plan.def, d.plan.mode, d.plan.params, d.plan.programId !== null);
    if (p) this.run([p]);
  }

  quit(): void { this.running.set(null); if (this.dones().length) this.toSummary(); else this.chain.set(null); }

  async finished(plan: RunPlan, result: RunResult): Promise<void> {
    this.running.set(null);
    const ch = this.chain();
    const done: Done = { plan, result, receipt: null, sent: 'envoi' };
    this.dones.update((xs) => [...xs, done]);
    const next = !result.aborted && ch && ch.i + 1 < ch.plans.length ? ch.plans[ch.i + 1] : null;
    if (next && ch) { this.chain.set({ plans: ch.plans, i: ch.i + 1 }); this.between.set(next); } else this.toSummary();
    const me = this.store.me(); if (!me) return;
    const receipt = await this.store.submit({
      id: sessionUuid(), memberId: me, exerciseId: plan.def.id, programId: plan.programId, mode: plan.mode, params: plan.params,
      startedAt: result.startedAt, endedAt: result.endedAt, aborted: result.aborted, allowedMs: plan.allowedMs, fastMs: plan.fastMs,
      tactile: navigator.maxTouchPoints > 0, answers: result.answers.map(({ question, given, ms, askedAt }) => ({ question, given, ms, askedAt })),
    });
    this.dones.update((xs) => xs.map((x) => (x === done ? { ...x, receipt, sent: receipt ? 'recue' : 'attente' } : x)));
    if (!receipt) return;
    const keys = new Set(receipt.changes.filter((c) => c.before !== c.after).map((c) => c.key));
    this.changed.update((m) => ({ ...m, [plan.def.id]: keys }));
  }

  continueChain(): void { const nx = this.between(); this.between.set(null); if (nx) this.running.set(nx); }
  toSummary(): void { this.between.set(null); this.chain.set(null); this.summary.set(true); }
  closeSummary(): void { this.summary.set(false); this.dones.set([]); }

  private count(d: Done, r: string): number { return d.result.answers.filter((a) => a.result === r).length; }
  line(d: Done): string {
    return summaryLine(d.plan.def, d.plan.params, { good: this.count(d, 'bon'), slow: this.count(d, 'lent'), wrong: this.count(d, 'faux') + this.count(d, 'passe') }, this.store.ctxOf(d.plan.def.id));
  }
  learnLine(d: Done): string {
    const k = this.count(d, 'bon'), n = d.plan.questions.length;
    return k >= n ? 'Tu as tout recopié, une ligne après l’autre.' : `Tu as recopié ${k} ligne${k > 1 ? 's' : ''} sur ${n}.`;
  }
  review(d: Done): string[] { return [...new Set(d.result.answers.filter((a) => a.result !== 'bon').map((a) => d.plan.def.itemLabel(a.key)))].slice(0, 8); }

  async openHistory(def: ExerciseDef, key: string): Promise<void> {
    try { this.history.set(await this.store.history(def.id, key)); }
    catch { this.store.foyer.toast('L’historique n’est pas disponible sans réseau.'); }
  }
}
