import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { Bilan, ExerciseOverview, ExerciseStats, ItemHistory, ProgramFields, RevisionsApi, RevisionsConfig } from '../../core/revisions/api';
import { downloadBlob } from '../../core/download';
import { ContentList, ExerciseDef, ParamDecl } from '../../core/revisions/exercises/contract';
import { RevisionsStore } from '../../core/revisions/store';
import { ListComponent } from './list';
import { EXERCISES } from '../../core/revisions/exercises';
import { MasteryItem, PERIODS, PeriodPreset, STATUS_LABEL, activityDays, fragile, parisDay, periodOf, programGroups } from '../../core/revisions/revisions';
import { AvatarComponent } from '../../shared/avatar';
import { GridComponent } from './grid';
import { HistoryComponent } from './history';
import { ParamsFormComponent } from './params-form';
import { SUPPORTED_INPUTS } from './runner';

/** Ce que porte une vue de suivi : l'exercice pour l'enfant, et son activité. */
interface Followed { ov: ExerciseOverview; stats: ExerciseStats | null; }

/**
 * Le suivi des enfants, l'écran Révisions d'un adulte : par enfant et par exercice, son programme
 * (réglé ici, paramètres de l'exercice en formulaire engendré), son activité
 * sur quatre semaines, sa réussite par groupe d'items, ce qui reste fragile et
 * sa grille. Les règles d'acquisition viennent du barème du serveur et sont
 * écrites dans l'aide, pour qu'on sache ce que « acquis » veut dire. Rien ici
 * n'est écrit pour un exercice en particulier.
 */
@Component({
  selector: 'rev-suivi',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AvatarComponent, GridComponent, ListComponent, HistoryComponent, ParamsFormComponent],
  template: `
    @if (!kids().length) {
      <div class="card empty">Aucun enfant dans le foyer. Un membre marqué « enfant » (Paramètres → Membres et accès) apparaît ici.</div>
    } @else {
      <div class="kids" role="tablist" aria-label="Enfant suivi">
        @for (k of kids(); track k.id) {
          <button role="tab" class="kid" [class.on]="sel() === k.id" [attr.aria-selected]="sel() === k.id" (click)="select(k.id, ex().id)">
            <f-avatar [ini]="k.ini" [color]="k.color" [size]="30" /> {{ k.name }}
          </button>
        }
      </div>
      @if (exercises().length > 1) {
        <div class="seg ex-seg" role="tablist" aria-label="Exercice">
          @for (d of exercises(); track d.id) {
            <button role="tab" [class.on]="ex().id === d.id" [attr.aria-selected]="ex().id === d.id" (click)="select(sel()!, d.id)">{{ d.label }}</button>
          }
        </div>
      }

      @if (view(); as v) {
        @let def = ex();
        <div class="cols">
          <div class="card">
            <div class="h">Programme {{ def.label }} de {{ kidName() }}</div>
            <p class="hint top">{{ def.desc }}</p>
            <rev-params-form [def]="def" [value]="f().params" [ctx]="ctx()" (edited)="set({ params: $event })" />
            <div class="lbl">Questions par session</div>
            <input class="input num" type="number" min="5" max="100" [ngModel]="f().questions" (ngModelChange)="set({ questions: +$event })" aria-label="Questions par session" />
            <div class="lbl">Temps par réponse</div>
            <label class="chk"><input type="checkbox" [ngModel]="f().secondsAllowed === null" (ngModelChange)="useBareme($event)" /> Selon l’âge (barème)</label>
            @if (f().secondsAllowed === null) {
              <p class="hint">{{ baremeLine() }}</p>
            } @else {
              <div class="row">
                <input class="input num" type="number" min="1" max="120" step="0.5" [ngModel]="f().secondsAllowed" (ngModelChange)="set({ secondsAllowed: +$event })" aria-label="Temps accordé, en secondes" /> s accordées,
                rapide sous <input class="input num" type="number" min="0.5" max="120" step="0.5" [ngModel]="f().fastSeconds" (ngModelChange)="set({ fastSeconds: +$event })" aria-label="Seuil rapide, en secondes" /> s
              </div>
            }
            <div class="lbl">Objectif par jour</div>
            <div class="row"><input class="input num" type="number" min="0" max="10" [ngModel]="f().dailyGoal" (ngModelChange)="set({ dailyGoal: +$event })" aria-label="Sessions par jour" /> session(s), 0 pour aucun objectif</div>
            @if (v.ov.devoirsList; as dl) {
              <!-- La liste du module École : sans elle (module éteint, enfant non associé), pas d'option. -->
              <label class="chk"><input type="checkbox" [ngModel]="f().dailyTask" (ngModelChange)="set({ dailyTask: $event })" [disabled]="f().dailyGoal < 1" />
                Une tâche «&nbsp;{{ def.label }} : entraînement du jour&nbsp;» dans «&nbsp;{{ dl }}&nbsp;», les jours d’école</label>
              <p class="hint">{{ f().dailyGoal < 1 ? 'Il faut un objectif d’au moins une session : c’est lui qui coche la tâche.' : 'Elle se coche toute seule quand l’objectif du jour est atteint.' }}</p>
            }
            @if (err()) { <p class="err" role="alert">{{ err() }}</p> }
            <button class="btn btn-primary btn-block save" (click)="save()" [disabled]="busy()">{{ v.ov.program ? 'Enregistrer le programme' : 'Créer le programme' }}</button>
            @if (v.ov.program; as p) {
              <p class="hint">Réglé par {{ nameOf(p.setBy) }} {{ day(p.setAt) }}. L’historique ne change pas quand le programme change.</p>
              <button class="btn btn-ghost btn-block" (click)="stop()" [disabled]="busy()">Retirer le programme</button>
            } @else {
              <p class="hint">Sans programme, {{ kidName() }} s’entraîne aux réglages par défaut, sans objectif du jour.</p>
            }
          </div>

          <div class="card">
            <div class="h">Activité sur quatre semaines</div>
            <div class="bars" role="img" [attr.aria-label]="activityLine()">
              @for (d of days(); track d.day; let last = $last) {
                <span class="bar" [class.today]="last" [style.height.%]="d.h" [title]="d.label"></span>
              }
            </div>
            <p class="hint">{{ activityLine() }}</p>

            <div class="h">Réussite</div>
            @for (g of groups(); track g.group) {
              <div class="tline">
                <span class="tl-n">{{ g.group }}</span>
                @if (g.questions) {
                  <span class="tl-bar" [attr.aria-label]="g.pct + ' % justes, dont ' + g.fastPct + ' % rapides'"><i class="ok" [style.width.%]="g.pct"></i></span>
                  <span class="tl-v">{{ g.pct }} % justes · {{ g.questions }} questions</span>
                } @else { <span class="tl-v muted">pas encore vu</span> }
              </div>
            } @empty { <p class="hint">Rien à montrer pour l’instant.</p> }

            <div class="h">Encore fragiles</div>
            @for (c of fragiles(); track c.key) {
              <button class="frag" (click)="openHistory(c.key)">{{ c.label }} <span>{{ fragLabel(c) }}</span></button>
            } @empty { <p class="hint">Rien de fragile pour l’instant.</p> }
          </div>
        </div>

        <div class="card bilan">
          <div class="h">Bilan de {{ kidName() }}</div>
          <div class="seg per" role="radiogroup" aria-label="Période du bilan">
            @for (pp of periods; track pp.id) {
              <button type="button" role="radio" [attr.aria-checked]="per() === pp.id" [class.on]="per() === pp.id" (click)="setPeriod(pp.id)">{{ pp.label }}</button>
            }
          </div>
          @if (bilan(); as b) {
            <p class="b-l">{{ b.label }}</p>
            @if (!b.matieres.length) { <p class="hint">Pas de session de révisions sur cette période.</p> }
            @for (mt of b.matieres; track mt.id) {
              @for (e of mt.exercises; track e.id) {
                <div class="b-ex">
                  <div class="b-t">{{ mt.label }} · {{ e.label }} : {{ e.summary }}</div>
                  @if (e.totals.sessions) {
                    <div class="b-n">{{ plural(e.totals.sessions, 'session', 'sessions') }}, {{ plural(e.totals.questions, 'question', 'questions') }}, <b>{{ e.totals.pct }} % justes</b>@if (e.prev) { ({{ e.prev.pct }} % la période précédente)}</div>
                  } @else { <div class="b-n">Pas de session sur cette période.</div> }
                  @if (e.fragiles.length) { <div class="b-f">Encore fragiles : {{ fragileList(e.fragiles) }}</div> }
                </div>
              }
            }
            <div class="b-b">
              <button class="btn btn-primary" (click)="download('pdf')" [disabled]="busy()">Pour la maîtresse (PDF)</button>
              <button class="btn btn-soft" (click)="download('csv')" [disabled]="busy()">Les sessions (CSV)</button>
            </div>
            <p class="hint">Le PDF tient sur une page par enfant : sessions, réussite par groupe comparée à la période précédente, ce qui reste fragile. Il ne contient rien sur les autres membres du foyer.</p>
          } @else { <p class="hint">Chargement du bilan…</p> }
        </div>

        @if (contentParam(); as cp) {
          <div class="card lists">
            <div class="h">Les listes · {{ def.label }}</div>
            <p class="hint top">Celles livrées avec Foyer, et celles du foyer : la dictée de la semaine donnée par la maîtresse se saisit ici. Une liste retirée est archivée, jamais effacée : l’historique de ses {{ cp.items }} reste.</p>
            @for (l of lists(); track l.id) {
              <div class="li" [class.arch]="l.archived">
                <div class="li-t"><b>{{ l.label }}</b> <span>{{ l.items.length }} {{ l.items.length > 1 ? cp.items : cp.item }}{{ l.source === 'livre' ? ', livrée' : '' }}{{ l.archived ? ', archivée' : '' }}</span>
                  <div class="li-w">{{ l.items.slice(0, 12).join(', ') }}{{ l.items.length > 12 ? '…' : '' }}</div></div>
                @if (l.source === 'foyer') {
                  <div class="li-b">
                    @if (!l.archived) { <button class="btn btn-soft sm" (click)="editList(l)">Modifier</button> }
                    <button class="btn btn-ghost sm" (click)="archive(l.id, !l.archived)" [disabled]="busy()">{{ l.archived ? 'Ressortir' : 'Archiver' }}</button>
                  </div>
                }
              </div>
            }
            @if (editing(); as ed) {
              <div class="ed">
                <div class="lbl">Nom de la liste</div>
                <input class="input" [ngModel]="ed.label" (ngModelChange)="editing.set({ id: ed.id, label: $event, text: ed.text })" maxlength="60" placeholder="Semaine du 12 octobre" aria-label="Nom de la liste" />
                <div class="lbl">Les {{ cp.items }}, un par ligne ou séparés par des virgules</div>
                <textarea class="input ta" [ngModel]="ed.text" (ngModelChange)="editing.set({ id: ed.id, label: ed.label, text: $event })" rows="6" [attr.aria-label]="'Les ' + cp.items"></textarea>
                <p class="hint">{{ splitItems(ed.text).length }} {{ splitItems(ed.text).length > 1 ? cp.items : cp.item }}</p>
                <div class="b-b">
                  <button class="btn btn-primary" (click)="saveList()" [disabled]="busy() || !ed.label.trim() || !splitItems(ed.text).length">{{ ed.id ? 'Enregistrer la liste' : 'Créer la liste' }}</button>
                  <button class="btn btn-ghost" (click)="editing.set(null)">Annuler</button>
                </div>
              </div>
            } @else {
              <button class="btn btn-soft" (click)="editing.set({ id: null, label: '', text: '' })">Nouvelle liste</button>
            }
          </div>
        }

        @if (def.view === 'liste') {
          <div class="card">
            <div class="h">{{ def.label }} de {{ kidName() }}</div>
            <rev-list [def]="def" [params]="v.ov.params" [ctx]="ctx()" [items]="v.ov.mastery" (pick)="openHistory($event)" />
          </div>
        }
        @if (def.view === 'grille' && def.grid) {
          <div class="card">
            <div class="h">Grille de {{ kidName() }}</div>
            <rev-grid [def]="def" [params]="v.ov.params" [items]="v.ov.mastery" (pick)="openHistory($event)" />
            <details class="aide">
              <summary>Ce que veulent dire les couleurs</summary>
              <p>Une bonne réponse rapide fait monter un item d’un niveau, mais seulement s’il était à revoir : on révise après {{ intervals() }}. Une réponse lente ne fait pas monter ; une fausse fait redescendre de {{ cfg()?.maitrise?.descenteSiFaux ?? 2 }} niveaux.</p>
              <p><b>Acquis</b> : niveau {{ cfg()?.maitrise?.niveauAcquis ?? 3 }} au moins, {{ cfg()?.maitrise?.bonnesMin ?? 3 }} bonnes réponses au moins, et la dernière rapide. <b>Pas encore vu</b> ne veut pas dire « pas su » : aucune réponse n’a encore été donnée. Ces seuils se règlent dans le barème du serveur (docs/revisions.md) ; les changer change l’affichage, pas les réponses enregistrées.</p>
            </details>
          </div>
        }
      } @else {
        <div class="card empty">Chargement…</div>
      }
    }
    @if (history(); as h) { <rev-history [data]="h" (close)="history.set(null)" /> }
  `,
  styles: [`
    .empty { padding: 24px; text-align: center; font-weight: 700; color: var(--ink2); }
    .kids { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .kid { display: inline-flex; align-items: center; gap: 8px; border: 2px solid var(--line); background: var(--surface); border-radius: 14px; padding: 6px 14px 6px 6px; font-family: inherit; font-size: 15px; font-weight: 800; color: var(--ink); cursor: pointer; min-height: 44px; }
    .kid.on { border-color: var(--primary); background: #FCE9E3; }
    .seg { display: flex; background: var(--soft2); border-radius: 12px; padding: 3px; gap: 3px; }
    .seg button { flex: 1; border: none; background: transparent; border-radius: 10px; padding: 8px 12px; font-family: inherit; font-size: 14px; font-weight: 800; color: var(--ink2); cursor: pointer; min-height: 40px; }
    .seg button.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh-float); }
    .ex-seg { margin-bottom: 14px; max-width: 520px; }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 16px; align-items: start; }
    .h { font-size: 15px; font-weight: 800; color: var(--ink); margin: 18px 0 10px; }
    .h:first-child { margin-top: 0; }
    .lbl { margin: 14px 0 6px; font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; font-weight: 700; color: var(--ink2); }
    .num { width: 86px; }
    .chk { display: flex; align-items: center; gap: 8px; margin-top: 4px; font-size: 14px; font-weight: 700; color: var(--ink); cursor: pointer; }
    .chk input { width: 20px; height: 20px; flex-shrink: 0; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin: 8px 0 0; }
    .hint.top { margin: -4px 0 4px; }
    .err { font-size: 13px; font-weight: 700; color: var(--primary); }
    .save { margin-top: 16px; }
    .bars { display: flex; align-items: flex-end; gap: 3px; height: 72px; padding-bottom: 2px; border-bottom: 1px solid var(--line); }
    .bar { flex: 1; min-height: 3px; border-radius: 3px 3px 0 0; background: #C9D9A4; }
    .bar.today { background: var(--primary); }
    .tline { display: grid; grid-template-columns: 110px 1fr auto; gap: 10px; align-items: center; padding: 5px 0; font-size: 13.5px; }
    .tl-n { font-weight: 800; color: var(--ink); }
    .tl-bar { height: 8px; border-radius: 5px; background: var(--soft2); overflow: hidden; }
    .tl-bar i { display: block; height: 100%; background: #6E9B6A; }
    .tl-v { font-weight: 700; color: var(--ink2); } .muted { color: var(--ink3); grid-column: 2 / 4; }
    .frag { display: flex; justify-content: space-between; gap: 10px; width: 100%; padding: 9px 2px; border: none; border-top: 1px solid var(--line); background: transparent; font-family: inherit; font-size: 15px; font-weight: 800; color: var(--ink); cursor: pointer; text-align: left; }
    .frag span { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .bilan, .lists { margin-bottom: 16px; }
    .li { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 10px 0; border-top: 1px solid var(--line); }
    .li.arch { opacity: .6; }
    .li-t { font-size: 14px; color: var(--ink); min-width: 0; } .li-t span { margin-left: 8px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .li-w { margin-top: 2px; font-size: 12.5px; font-weight: 600; color: var(--ink3); overflow-wrap: anywhere; }
    .li-b { display: flex; gap: 6px; flex: none; } .sm { min-height: 38px; padding: 0 12px; font-size: 13px; }
    .ed { margin-top: 12px; } .ta { width: 100%; min-height: 120px; font-family: inherit; resize: vertical; }
    .per { max-width: 620px; flex-wrap: wrap; }
    .b-l { margin: 12px 0 4px; font-size: 14px; font-weight: 800; color: var(--ink2); }
    .b-ex { padding: 10px 0; border-top: 1px solid var(--line); }
    .b-ex:first-of-type { border-top: none; }
    .b-t { font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .b-n, .b-f { margin-top: 3px; font-size: 13.5px; font-weight: 600; color: var(--ink2); }
    .b-b { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    .b-b .btn { min-height: 46px; }
    .aide { margin-top: 14px; font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.5; }
    .aide summary { cursor: pointer; font-weight: 800; color: var(--ink); }
    @media (max-width: 420px) { .tline { grid-template-columns: 92px 1fr; } .tl-v { grid-column: 1 / 3; font-size: 12.5px; } }
  `],
})
export class SuiviComponent {
  private foyer = inject(FoyerStore);
  private api = inject(RevisionsApi);
  private store = inject(RevisionsStore);

  /** L'enfant à montrer d'abord, quand on arrive d'une notification. */
  readonly kid = input<string | null>(null);
  readonly kids = this.foyer.children;
  readonly exercises = computed(() => EXERCISES.filter((d) => SUPPORTED_INPUTS.has(d.input)));
  readonly sel = signal<string | null>(null);
  readonly ex = signal<ExerciseDef>(EXERCISES[0]);
  /** Les vues chargées, par « membre|exercice ». */
  private readonly views = signal<Record<string, Followed>>({});
  readonly view = computed(() => this.views()[`${this.sel()}|${this.ex().id}`] ?? null);
  readonly cfg = signal<RevisionsConfig | null>(null);
  readonly busy = signal(false);
  readonly err = signal('');
  readonly history = signal<ItemHistory | null>(null);
  readonly f = signal<ProgramFields>({ params: {}, questions: 20, secondsAllowed: null, fastSeconds: null, dailyGoal: 1, dailyTask: false });
  readonly periods = PERIODS;
  readonly per = signal<PeriodPreset>('semaine');
  readonly bilan = signal<Bilan | null>(null);

  constructor() {
    effect(() => {
      const k = this.kids(), asked = this.kid();
      const want = asked && k.some((x) => x.id === asked) ? asked : !untracked(() => this.sel()) && k.length ? k[0].id : null;
      if (want && want !== untracked(() => this.sel())) untracked(() => this.select(want, this.ex().id));
    });
    // Le formulaire repart du programme enregistré (ou des réglages en vigueur) quand l'enfant ou l'exercice change, ou quand le serveur répond.
    effect(() => {
      const ov = this.view()?.ov;
      if (!ov) return;
      const p = ov.program;
      untracked(() => this.f.set(p
        ? { params: p.params, questions: p.questions, secondsAllowed: p.secondsAllowed, fastSeconds: p.fastSeconds, dailyGoal: p.dailyGoal, dailyTask: p.dailyTask && !!ov.devoirsList }
        : { params: ov.params, questions: 20, secondsAllowed: null, fastSeconds: null, dailyGoal: 1, dailyTask: false }));
    });
  }

  kidName(): string { return this.foyer.memberName(this.sel() ?? ''); }

  select(member: string, exId: string): void {
    const def = this.exercises().find((d) => d.id === exId) ?? this.exercises()[0];
    if (member !== this.sel()) this.bilan.set(null);
    this.sel.set(member); this.ex.set(def); this.err.set('');
    void this.reload(member, def.id);
    void this.loadBilan();
  }

  setPeriod(p: PeriodPreset): void { this.per.set(p); this.bilan.set(null); void this.loadBilan(); }
  private range() { return periodOf(this.per(), parisDay(new Date().toISOString())); }

  private async loadBilan(): Promise<void> {
    const id = this.sel(); if (!id) return;
    const { from, to } = this.range();
    try { const b = await this.api.bilan(id, from, to); if (this.sel() === id) this.bilan.set(b); }
    catch (e) { this.err.set((e as Error).message); }
  }

  async download(kind: 'pdf' | 'csv'): Promise<void> {
    const id = this.sel(); if (!id) return;
    const { from, to } = this.range();
    this.busy.set(true);
    try {
      const blob = kind === 'pdf' ? await this.api.bilanPdf(id, from, to) : await this.api.sessionsCsv(id, from, to);
      const who = this.kidName().normalize('NFD').replace(/[^\w-]+/g, '') || id;
      downloadBlob(blob, kind === 'pdf' ? `revisions-${who}-${from}-${to}.pdf` : `revisions-sessions-${who}-${from}-${to}.csv`);
    } catch (e) { this.foyer.toast((e as Error).message || 'Le téléchargement a échoué.'); }
    finally { this.busy.set(false); }
  }

  plural(k: number, one: string, many: string): string { return `${k} ${k > 1 ? many : one}`; }
  fragileList(f: { label: string }[]): string { return f.map((x) => x.label).join(', '); }

  private async reload(member: string, exId: string): Promise<void> {
    try {
      const [ov, stats, cfg] = await Promise.all([this.api.exercise(member, exId), this.api.stats(member, exId).catch(() => null), this.api.config(exId)]);
      this.views.update((m) => ({ ...m, [`${member}|${exId}`]: { ov, stats } }));
      if (this.ex().id === exId) this.cfg.set(cfg);
    } catch (e) { this.err.set((e as Error).message); }
  }

  set(p: Partial<ProgramFields>): void { this.f.update((f) => ({ ...f, ...p })); }
  useBareme(on: boolean): void {
    const t = this.view()?.ov.timing;
    this.set(on ? { secondsAllowed: null, fastSeconds: null } : { secondsAllowed: (t?.allowedMs ?? 8000) / 1000, fastSeconds: (t?.fastMs ?? 4000) / 1000 });
  }

  async save(): Promise<void> {
    const id = this.sel(); if (!id) return;
    this.busy.set(true); this.err.set('');
    try {
      const f = this.f();
      // Sans liste « Devoirs de … » (module École éteint), le choix déjà fait reste tel quel au serveur.
      const dailyTask = this.view()?.ov.devoirsList ? !!f.dailyTask && f.dailyGoal >= 1 : undefined;
      await this.api.setProgram(id, this.ex().id, { ...f, dailyTask, fastSeconds: f.secondsAllowed === null ? null : f.fastSeconds });
      await this.reload(id, this.ex().id);
      this.foyer.toast('Programme enregistré');
    } catch (e) { this.err.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  async stop(): Promise<void> {
    const id = this.sel(); if (!id) return;
    this.busy.set(true); this.err.set('');
    try {
      await this.api.stopProgram(id, this.ex().id);
      await this.reload(id, this.ex().id);
      this.foyer.toast('Programme retiré : l’historique reste');
    } catch (e) { this.err.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  readonly fragiles = computed(() => { const v = this.view(); return v ? fragile(v.ov.mastery, 8, this.ex().universe(v.ov.params, this.ctx())) : []; });
  readonly groups = computed(() => { const v = this.view(); return v ? programGroups(this.ex(), v.ov.params, v.stats?.groups ?? [], this.ctx()) : []; });
  /** Les listes de l'exercice suivi, et son paramètre de contenu s'il en a un. */
  readonly ctx = computed(() => this.store.ctxOf(this.ex().id));
  readonly lists = computed(() => this.ctx().lists);
  readonly contentParam = computed(() => this.ex().params.find((p) => p.type === 'content') as Extract<ParamDecl, { type: 'content' }> | undefined);
  readonly editing = signal<{ id: string | null; label: string; text: string } | null>(null);
  splitItems(text: string): string[] { return [...new Set(text.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))]; }
  editList(l: ContentList): void { this.editing.set({ id: l.id, label: l.label, text: l.items.join('\n') }); }

  async saveList(): Promise<void> {
    const ed = this.editing(); if (!ed) return;
    this.busy.set(true); this.err.set('');
    try {
      const items = this.splitItems(ed.text);
      if (ed.id) await this.api.updateList(this.ex().id, ed.id, { label: ed.label.trim(), items });
      else await this.api.createList(this.ex().id, ed.label.trim(), items);
      await this.store.reloadContent(this.ex().id);
      this.editing.set(null);
      this.foyer.toast(ed.id ? 'Liste enregistrée' : 'Liste créée : choisissez-la dans le programme');
    } catch (e) { this.foyer.toast((e as Error).message); }
    finally { this.busy.set(false); }
  }

  async archive(id: string, archived: boolean): Promise<void> {
    this.busy.set(true);
    try { await this.api.updateList(this.ex().id, id, { archived }); await this.store.reloadContent(this.ex().id); }
    catch (e) { this.foyer.toast((e as Error).message); }
    finally { this.busy.set(false); }
  }
  readonly baremeLine = computed(() => {
    const t = this.view()?.ov.timing; if (!t || t.source === 'programme') return 'Le barème selon l’âge s’appliquera une fois le programme enregistré.';
    const s = (ms: number) => String(ms / 1000).replace('.', ',');
    const pour = t.source === 'sans-age' ? 'sans date de naissance sur sa fiche' : t.age !== null ? `à ${t.age} ans` : '';
    return `${s(t.allowedMs)} s par réponse, rapide sous ${s(t.fastMs)} s ${pour}. La barre de temps n’arrête rien : une réponse après la barre est notée « un peu lente ».`;
  });
  readonly intervals = computed(() => {
    const e = this.cfg()?.maitrise?.espacementJours ?? [0, 1, 3, 7, 14, 30];
    return e.slice(1).map((d) => `${d} jour${d > 1 ? 's' : ''}`).join(', ').replace(/, ([^,]*)$/, ' puis $1');
  });

  /** Vingt-huit barres, une par jour, aujourd'hui en dernier. */
  readonly days = computed(() => {
    const out = activityDays(this.view()?.stats?.days ?? [], new Date());
    const top = Math.max(1, ...out.map((d) => d.sessions));
    return out.map((d) => ({ ...d, h: Math.round((d.sessions / top) * 100), label: `${d.day.slice(8)}/${d.day.slice(5, 7)} : ${d.sessions} session${d.sessions > 1 ? 's' : ''}` }));
  });
  readonly activityLine = computed(() => {
    const st = this.view()?.stats; if (!st) return '';
    const s = st.days.reduce((t, d) => t + d.sessions, 0), q = st.days.reduce((t, d) => t + d.questions, 0);
    return s ? `${s} session${s > 1 ? 's' : ''} et ${q} questions en quatre semaines.` : 'Pas encore de session ces quatre dernières semaines.';
  });

  fragLabel(c: MasteryItem): string { return `${c.wrong ? `${c.wrong} erreur${c.wrong > 1 ? 's' : ''}` : 'réponse lente'}, ${STATUS_LABEL[c.status]}`; }
  nameOf(id: string | null): string { return (id && this.foyer.memberName(id)) || 'un membre retiré'; }
  day(iso: string): string { return 'le ' + new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' }).format(new Date(iso)); }

  async openHistory(key: string): Promise<void> {
    const id = this.sel(); if (!id) return;
    try { this.history.set(await this.api.history(id, this.ex().id, key)); } catch { this.foyer.toast('Historique indisponible pour le moment.'); }
  }
}
