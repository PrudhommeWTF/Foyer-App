import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { TablesStore } from '../../core/tables.store';
import { PairHistory, ProgramFields, TablesApi } from '../../core/tables.api';
import { MasteryCell, OPERATIONS, STATUS_LABEL, fragile, parisDay, signOf } from '../../core/tables';
import { AvatarComponent } from '../../shared/avatar';
import { GridComponent } from './grid';
import { HistoryComponent } from './history';

/**
 * L'onglet Suivi, pour les adultes : par enfant, son programme (réglé ici),
 * son activité sur quatre semaines, sa réussite par table, ses opérations
 * encore fragiles et sa grille. Les règles d'acquisition viennent du barème du
 * serveur et sont écrites dans l'aide, pour qu'on sache ce que « acquise » veut
 * dire.
 */
@Component({
  selector: 'tables-suivi',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AvatarComponent, GridComponent, HistoryComponent],
  template: `
    @if (!kids().length) {
      <div class="card empty">Aucun enfant dans le foyer. Un membre marqué « enfant » (Paramètres → Membres) apparaît ici.</div>
    } @else {
      <div class="kids" role="tablist" aria-label="Enfant suivi">
        @for (k of kids(); track k.id) {
          <button role="tab" class="kid" [class.on]="sel() === k.id" [attr.aria-selected]="sel() === k.id" (click)="select(k.id)">
            <f-avatar [ini]="k.ini" [color]="k.color" [size]="30" /> {{ k.name }}
          </button>
        }
      </div>

      @if (ov(); as o) {
        <div class="cols">
          <div class="card">
            <div class="h">Programme de {{ o.member.name }}</div>
            <div class="lbl">Opération</div>
            <div class="seg">
              @for (x of ops; track x.id) { <button [class.on]="f().operation === x.id" (click)="set({ operation: x.id })">{{ x.label }}</button> }
            </div>
            <div class="lbl">Tables</div>
            <div class="row">
              de <select [ngModel]="f().from" (ngModelChange)="set({ from: +$event, to: Math.max(+$event, f().to) })" aria-label="Première table">
                @for (t of axis(); track t) { <option [ngValue]="t">{{ t }}</option> }
              </select>
              à <select [ngModel]="f().to" (ngModelChange)="set({ to: +$event })" aria-label="Dernière table">
                @for (t of axis(); track t) { @if (t >= f().from) { <option [ngValue]="t">{{ t }}</option> } }
              </select>
            </div>
            <div class="lbl">Questions par session</div>
            <input class="input num" type="number" min="5" max="100" [ngModel]="f().questions" (ngModelChange)="set({ questions: +$event })" />
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
            <div class="row"><input class="input num" type="number" min="0" max="10" [ngModel]="f().dailyGoal" (ngModelChange)="set({ dailyGoal: +$event })" aria-label="Sessions par jour" /> session(s)</div>
            <label class="chk"><input type="checkbox" [ngModel]="f().bothDirections" (ngModelChange)="set({ bothDirections: $event })" /> Poser dans les deux sens (6 × 7 et 7 × 6)</label>
            @if (err()) { <p class="err" role="alert">{{ err() }}</p> }
            <button class="btn btn-primary btn-block save" (click)="save()" [disabled]="busy()">{{ o.program ? 'Enregistrer le programme' : 'Créer le programme' }}</button>
            @if (o.program; as p) { <p class="hint">Réglé par {{ nameOf(p.setBy) }} {{ day(p.setAt) }}. L’historique ne change pas quand le programme change.</p> }
          </div>

          <div class="card">
            <div class="h">Activité sur quatre semaines</div>
            <div class="bars" role="img" [attr.aria-label]="activityLine()">
              @for (d of days(); track d.day) {
                <span class="bar" [class.today]="d.today" [style.height.%]="d.h" [title]="d.label"></span>
              }
            </div>
            <p class="hint">{{ activityLine() }}</p>

            <div class="h">Réussite par table</div>
            @for (t of perTable(); track t.table) {
              <div class="tline">
                <span class="tl-n">Table de {{ t.table }}</span>
                @if (t.questions) {
                  <span class="tl-bar"><i [style.width.%]="t.pct"></i></span>
                  <span class="tl-v">{{ t.pct }} % justes · {{ t.questions }} questions</span>
                } @else { <span class="tl-v muted">pas encore vue</span> }
              </div>
            }

            <div class="h">Encore fragiles</div>
            @for (c of fragiles(); track c.a + 'x' + c.b) {
              <button class="frag" (click)="openHistory(c.a, c.b)">{{ c.a }} {{ sign() }} {{ c.b }} <span>{{ fragLabel(c) }}</span></button>
            } @empty { <p class="hint">Rien de fragile pour l’instant.</p> }
          </div>
        </div>

        <div class="card">
          <div class="h">Grille de {{ o.member.name }}</div>
          <tables-grid [op]="o.operation" [max]="o.tablesMax" [cells]="o.mastery" (pick)="openHistory($event.a, $event.b)" />
          <details class="aide">
            <summary>Ce que veulent dire les couleurs</summary>
            <p>Chaque case est une opération ; 6 × 7 et 7 × 6 comptent ensemble. Une bonne réponse rapide fait monter l’opération d’un niveau, mais seulement si elle était à revoir : on révise après {{ intervals() }}. Une réponse lente ne fait pas monter ; une fausse fait redescendre de {{ cfg()?.maitrise?.descenteSiFaux ?? 2 }} niveaux.</p>
            <p><b>Acquise</b> : niveau {{ cfg()?.maitrise?.niveauAcquis ?? 3 }} au moins, {{ cfg()?.maitrise?.bonnesMin ?? 3 }} bonnes réponses au moins, et la dernière rapide. <b>Pas encore vue</b> ne veut pas dire « pas sue » : aucune réponse n’a encore été donnée. Ces seuils se règlent dans le barème du serveur (docs/tables.md) ; les changer change l’affichage, pas les réponses enregistrées.</p>
          </details>
        </div>
      }
    }
    @if (history(); as h) { <tables-history [data]="h" [op]="ov()?.operation ?? 'multiplication'" (close)="history.set(null)" /> }
  `,
  styles: [`
    .empty { padding: 24px; text-align: center; font-weight: 700; color: var(--ink2); }
    .kids { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .kid { display: inline-flex; align-items: center; gap: 8px; border: 2px solid var(--line); background: var(--surface); border-radius: 14px; padding: 6px 14px 6px 6px; font-family: inherit; font-size: 15px; font-weight: 800; color: var(--ink); cursor: pointer; min-height: 44px; }
    .kid.on { border-color: var(--primary); background: #FCE9E3; }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 16px; align-items: start; }
    .h { font-size: 15px; font-weight: 800; color: var(--ink); margin: 18px 0 10px; }
    .h:first-child { margin-top: 0; }
    .lbl { margin: 14px 0 6px; font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .seg { display: flex; background: var(--soft2); border-radius: 12px; padding: 3px; gap: 3px; }
    .seg button { flex: 1; border: none; background: transparent; border-radius: 10px; padding: 8px 12px; font-family: inherit; font-size: 14px; font-weight: 800; color: var(--ink2); cursor: pointer; min-height: 40px; }
    .seg button.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh-float); }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; font-weight: 700; color: var(--ink2); }
    .row select { min-height: 42px; min-width: 70px; border-radius: 10px; border: 2px solid var(--line); background: var(--surface); color: var(--ink); font-family: inherit; font-size: 15px; font-weight: 800; padding: 0 8px; }
    .num { width: 86px; }
    .chk { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 14px; font-weight: 700; color: var(--ink); cursor: pointer; }
    .chk input { width: 20px; height: 20px; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin: 8px 0 0; }
    .err { font-size: 13px; font-weight: 700; color: var(--primary); }
    .save { margin-top: 16px; }
    .bars { display: flex; align-items: flex-end; gap: 3px; height: 72px; padding-bottom: 2px; border-bottom: 1px solid var(--line); }
    .bar { flex: 1; min-height: 3px; border-radius: 3px 3px 0 0; background: #C9D9A4; }
    .bar.today { background: var(--primary); }
    .tline { display: grid; grid-template-columns: 96px 1fr auto; gap: 10px; align-items: center; padding: 5px 0; font-size: 13.5px; }
    .tl-n { font-weight: 800; color: var(--ink); }
    .tl-bar { height: 8px; border-radius: 5px; background: var(--soft2); overflow: hidden; }
    .tl-bar i { display: block; height: 100%; background: #6E9B6A; }
    .tl-v { font-weight: 700; color: var(--ink2); } .muted { color: var(--ink3); grid-column: 2 / 4; }
    .frag { display: flex; justify-content: space-between; gap: 10px; width: 100%; padding: 9px 2px; border: none; border-top: 1px solid var(--line); background: transparent; font-family: inherit; font-size: 15px; font-weight: 800; color: var(--ink); cursor: pointer; text-align: left; }
    .frag span { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .aide { margin-top: 14px; font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.5; }
    .aide summary { cursor: pointer; font-weight: 800; color: var(--ink); }
  `],
})
export class SuiviComponent {
  private foyer = inject(FoyerStore);
  readonly store = inject(TablesStore);
  private api = inject(TablesApi);
  readonly ops = OPERATIONS;
  readonly Math = Math;

  readonly kids = computed(() => (this.foyer.data()?.members || []).filter((m) => m.enfant));
  readonly sel = signal<string | null>(null);
  readonly ov = computed(() => { const id = this.sel(); return id ? this.store.overviews()[id] ?? null : null; });
  readonly cfg = this.store.config;
  readonly busy = signal(false);
  readonly err = signal('');
  readonly history = signal<PairHistory | null>(null);
  readonly f = signal<ProgramFields>({ operation: 'multiplication', from: 2, to: 5, questions: 20, secondsAllowed: null, fastSeconds: null, dailyGoal: 1, bothDirections: true });

  constructor() {
    effect(() => { const k = this.kids(); if (k.length && !untracked(() => this.sel())) untracked(() => this.select(k[0].id)); });
    // Le formulaire repart du programme enregistré quand l'enfant change, ou quand le serveur répond.
    effect(() => {
      const p = this.ov()?.program;
      untracked(() => this.f.set(p
        ? { operation: p.operation, from: p.from, to: p.to, questions: p.questions, secondsAllowed: p.secondsAllowed, fastSeconds: p.fastSeconds, dailyGoal: p.dailyGoal, bothDirections: p.bothDirections }
        : { ...this.f(), secondsAllowed: null, fastSeconds: null }));
    });
  }

  select(id: string): void { this.sel.set(id); this.err.set(''); void this.store.load(id); void this.store.loadStats(id); }
  set(p: Partial<ProgramFields>): void { this.f.update((f) => ({ ...f, ...p })); }
  useBareme(on: boolean): void {
    const t = this.ov()?.timing;
    this.set(on ? { secondsAllowed: null, fastSeconds: null } : { secondsAllowed: (t?.allowedMs ?? 8000) / 1000, fastSeconds: (t?.fastMs ?? 4000) / 1000 });
  }

  async save(): Promise<void> {
    const id = this.sel(); if (!id) return;
    this.busy.set(true); this.err.set('');
    try {
      const f = this.f();
      await this.api.setProgram(id, { ...f, fastSeconds: f.secondsAllowed === null ? null : f.fastSeconds });
      await this.store.load(id, f.operation);
      this.foyer.toast('Programme enregistré');
    } catch (e) { this.err.set((e as Error).message); }
    finally { this.busy.set(false); }
  }

  readonly axis = computed(() => Array.from({ length: (this.ov()?.tablesMax ?? 10) + 1 }, (_, i) => i));
  readonly sign = computed(() => signOf(this.ov()?.operation ?? 'multiplication'));
  readonly fragiles = computed(() => fragile(this.ov()?.mastery ?? []));
  readonly baremeLine = computed(() => {
    const t = this.ov()?.timing; if (!t) return '';
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
    const st = this.store.stats()[this.sel() ?? '']; const by = new Map((st?.days ?? []).map((d) => [d.day, d] as const));
    const out = Array.from({ length: 28 }, (_, i) => {
      const day = parisDay(new Date(Date.now() - (27 - i) * 86400_000).toISOString());
      const n = by.get(day)?.sessions ?? 0;
      return { day, n, today: i === 27, label: `${day.slice(8)}/${day.slice(5, 7)} : ${n} session${n > 1 ? 's' : ''}`, h: 0 };
    });
    const top = Math.max(1, ...out.map((d) => d.n));
    return out.map((d) => ({ ...d, h: Math.round((d.n / top) * 100) }));
  });
  readonly activityLine = computed(() => {
    const st = this.store.stats()[this.sel() ?? '']; if (!st) return '';
    const s = st.days.reduce((t, d) => t + d.sessions, 0), q = st.days.reduce((t, d) => t + d.questions, 0);
    return s ? `${s} session${s > 1 ? 's' : ''} et ${q} questions en quatre semaines.` : 'Pas encore de session ces quatre dernières semaines.';
  });
  /**
   * Les tables du programme (une question compte pour ses deux tables : 6 × 3
   * compte aussi pour celle de 3, qui noierait la lecture) ; sans programme,
   * toutes celles déjà travaillées.
   */
  readonly perTable = computed(() => {
    const st = this.store.stats()[this.sel() ?? '']; const f = this.ov()?.program;
    const by = new Map((st?.tables ?? []).map((t) => [t.table, t] as const));
    const want = new Set<number>(f ? Array.from({ length: f.to - f.from + 1 }, (_, i) => f.from + i) : by.keys());
    return [...want].sort((a, b) => a - b).map((table) => {
      const t = by.get(table);
      return { table, questions: t?.questions ?? 0, pct: t?.questions ? Math.round((t.correct / t.questions) * 100) : 0 };
    });
  });

  fragLabel(c: MasteryCell): string { return `${c.wrong ? `${c.wrong} erreur${c.wrong > 1 ? 's' : ''}` : 'réponse lente'}, ${STATUS_LABEL[c.status]}`; }
  nameOf(id: string | null): string { return (id && this.foyer.memberName(id)) || 'un membre retiré'; }
  day(iso: string): string { return 'le ' + new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' }).format(new Date(iso)); }

  async openHistory(a: number, b: number): Promise<void> {
    const id = this.sel(); const o = this.ov(); if (!id || !o) return;
    try { this.history.set(await this.api.history(id, o.operation, a, b)); } catch { this.foyer.toast('Historique indisponible pour le moment.'); }
  }
}
