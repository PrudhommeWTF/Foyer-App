import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { ExerciseOverview, ExerciseStats, ItemHistory, ProgramFields, RevisionsApi, RevisionsConfig } from '../../core/revisions/api';
import { ExerciseDef } from '../../core/revisions/exercises/contract';
import { EXERCISES } from '../../core/revisions/exercises';
import { MasteryItem, STATUS_LABEL, activityDays, fragile, programGroups } from '../../core/revisions/revisions';
import { AvatarComponent } from '../../shared/avatar';
import { GridComponent } from './grid';
import { HistoryComponent } from './history';
import { ParamsFormComponent } from './params-form';
import { SUPPORTED_INPUTS } from './runner';

/** Ce que porte une vue de suivi : l'exercice pour l'enfant, et son activité. */
interface Followed { ov: ExerciseOverview; stats: ExerciseStats | null; }

/**
 * L'onglet Suivi, pour les adultes : par enfant et par exercice, son programme
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
  imports: [FormsModule, AvatarComponent, GridComponent, HistoryComponent, ParamsFormComponent],
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
            <rev-params-form [def]="def" [value]="f().params" (edited)="set({ params: $event })" />
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
    .chk input { width: 20px; height: 20px; }
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
    .aide { margin-top: 14px; font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.5; }
    .aide summary { cursor: pointer; font-weight: 800; color: var(--ink); }
    @media (max-width: 420px) { .tline { grid-template-columns: 92px 1fr; } .tl-v { grid-column: 1 / 3; font-size: 12.5px; } }
  `],
})
export class SuiviComponent {
  private foyer = inject(FoyerStore);
  private api = inject(RevisionsApi);

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
  readonly f = signal<ProgramFields>({ params: {}, questions: 20, secondsAllowed: null, fastSeconds: null, dailyGoal: 1 });

  constructor() {
    effect(() => { const k = this.kids(); if (k.length && !untracked(() => this.sel())) untracked(() => this.select(k[0].id, this.ex().id)); });
    // Le formulaire repart du programme enregistré (ou des réglages en vigueur) quand l'enfant ou l'exercice change, ou quand le serveur répond.
    effect(() => {
      const ov = this.view()?.ov;
      if (!ov) return;
      const p = ov.program;
      untracked(() => this.f.set(p
        ? { params: p.params, questions: p.questions, secondsAllowed: p.secondsAllowed, fastSeconds: p.fastSeconds, dailyGoal: p.dailyGoal }
        : { params: ov.params, questions: 20, secondsAllowed: null, fastSeconds: null, dailyGoal: 1 }));
    });
  }

  kidName(): string { return this.foyer.memberName(this.sel() ?? ''); }

  select(member: string, exId: string): void {
    const def = this.exercises().find((d) => d.id === exId) ?? this.exercises()[0];
    this.sel.set(member); this.ex.set(def); this.err.set('');
    void this.reload(member, def.id);
  }

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
      await this.api.setProgram(id, this.ex().id, { ...f, fastSeconds: f.secondsAllowed === null ? null : f.fastSeconds });
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

  readonly fragiles = computed(() => { const v = this.view(); return v ? fragile(v.ov.mastery, 8, this.ex().universe(v.ov.params)) : []; });
  readonly groups = computed(() => { const v = this.view(); return v ? programGroups(this.ex(), v.ov.params, v.stats?.groups ?? []) : []; });
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
