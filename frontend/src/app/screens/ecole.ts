import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { EcoleStore, subjectLabel } from '../core/ecole.store';
import { EcoleApi, EdAverageView, EdGradeView, EdHomework, EdLifeView, EdVueStudent } from '../core/ecole.api';
import { IconComponent } from '../core/icon';

interface DayGroup { day: string; label: string; items: EdHomework[]; }

/**
 * L'écran « École » : les devoirs des enfants, rapatriés d'ÉcoleDirecte.
 *
 * Demain en tête, puis les jours suivants : c'est la question du soir. Un
 * onglet par enfant pour un adulte ; un enfant ne voit que lui (le serveur ne
 * lui envoie rien d'autre). La case « Fait » est la coche de la tâche projetée
 * dans « Devoirs de … » : cocher l'une coche l'autre, et ÉcoleDirecte l'apprend
 * à la synchronisation suivante.
 */
@Component({
  selector: 'screen-ecole',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="screen-enter">
      <div class="screen-head">
        <div>
          <h1>École</h1>
          @if (ecole.syncLine(); as s) { <div class="screen-sub" [class.ko]="!s.ok">{{ s.text }}</div> }
        </div>
      </div>

      @if (ecole.indispo() && !ecole.vue()) {
        <div class="banner ko">Foyer ne répond pas : les devoirs ne peuvent pas être affichés pour l’instant.</div>
      } @else if (!ecole.vue()) {
        <div class="hint">Chargement…</div>
      } @else if (!ecole.students().length) {
        <div class="empty">
          @if (store.isAdmin()) {
            Aucun élève associé pour l’instant. Ajoutez le compte ÉcoleDirecte et confirmez les élèves dans
            <button class="link" (click)="openSettings()">Paramètres, section École</button>.
          } @else {
            Aucun élève associé à ÉcoleDirecte pour l’instant.
          }
        </div>
      } @else {
        @if (ecole.students().length > 1) {
          <div class="tabs">
            @for (s of ecole.students(); track s.id) {
              <button class="tab" [class.on]="current()?.id === s.id" (click)="pick.set(s.id); mode.set('avenir')"
                      [style.background]="current()?.id === s.id ? store.memberColor(s.memberId) : 'var(--soft)'">
                {{ name(s) }}@if (openTomorrow(s.id); as n) { <span class="cnt">{{ n }}</span> }
              </button>
            }
          </div>
        }

        @if (current(); as s) {
          <div class="who">{{ [s.className, s.schoolName].filter(nonVide).join(' · ') }}</div>
          @if (s.dataError) {
            <div class="banner ko">
              Données de {{ name(s) }} indisponibles : {{ s.dataError }}
              @if (s.dataOkAt) { <div class="small">Dernière réussite {{ ecole.when(s.dataOkAt) }} : ce qui suit date de ce moment-là.</div> }
            </div>
          } @else if (s.account && s.account.state !== 'ok' && s.account.state !== 'jamais') {
            <div class="banner ko">
              Synchronisation ÉcoleDirecte en échec{{ s.account.lastError ? ' : ' + s.account.lastError : '' }}.
              @if (s.dataOkAt) { <div class="small">Dernière réussite {{ ecole.when(s.dataOkAt) }}.</div> }
            </div>
          }

          <div class="seg">
            <button [class.on]="mode() === 'avenir'" (click)="mode.set('avenir')">À faire</button>
            <button [class.on]="mode() === 'passe'" (click)="showPast(s)">Passés</button>
            <button [class.on]="mode() === 'notes'" (click)="showNotes(s)">Notes</button>
            <button [class.on]="mode() === 'vie'" (click)="showVie(s)">Vie scolaire</button>
          </div>

          @if (mode() === 'notes') {
            @if (notes(); as n) {
              @if (period(); as p) {
                <div class="d-head">Moyennes · {{ p.label }}</div>
                <div class="avg-card">
                  @for (a of p.rows; track a.subjectCode) {
                    <div class="avg" [class.gen]="a.subjectCode === '_GENERALE'">
                      <span class="avg-s">{{ subject2(a.subject) }}</span>
                      <span class="avg-v">{{ a.average || '–' }}</span>
                      @if (a.classAverage) { <span class="avg-c">classe {{ a.classAverage }}</span> }
                    </div>
                  }
                </div>
                <div class="small">Moyennes calculées par l’établissement et reprises telles quelles.</div>
              }
              <div class="d-head" style="margin-top:16px">Dernières notes</div>
              @for (g of n.grades; track g.id) {
                <button class="grade" (click)="openGrade.set(openGrade() === g.id ? null : g.id)" [attr.aria-expanded]="openGrade() === g.id">
                  <div class="g-top">
                    <span class="g-s">{{ subject2(g.subject) }}</span>
                    <span class="g-v" [class.ns]="g.notSignificant">{{ g.value }}{{ g.outOf && isNum(g.value) ? '/' + g.outOf : '' }}</span>
                  </div>
                  <div class="g-meta">{{ g.date ? fr(g.date) : '' }}{{ g.label ? ' · ' + g.label : '' }}@if (g.notSignificant) { · non significative }</div>
                  @if (openGrade() === g.id) {
                    <div class="g-detail">
                      @if (g.kind) { <div><span>Type</span><b>{{ g.kind }}</b></div> }
                      @if (g.coefficient) { <div><span>Coefficient</span><b>{{ g.coefficient }}</b></div> }
                      @if (g.classAverage) { <div><span>Moyenne de la classe</span><b>{{ g.classAverage }}</b></div> }
                      @if (g.classMin || g.classMax) { <div><span>Plus basse · plus haute</span><b>{{ g.classMin || '–' }} · {{ g.classMax || '–' }}</b></div> }
                    </div>
                  }
                </button>
              } @empty {
                <div class="empty">Aucune note pour l’instant.</div>
              }
            } @else {
              <div class="hint">Chargement…</div>
            }
          } @else if (mode() === 'vie') {
            @if (vie(); as items) {
              @for (e of items; track e.id) {
                <div class="life" [class]="'life ' + e.kind">
                  <div class="g-top">
                    <span class="g-s">{{ lifeLabel(e.kind) }}</span>
                    @if (e.kind === 'absence' || e.kind === 'retard') {
                      <span class="badge" [class.pend]="e.justified === false" [class.okb]="e.justified === true">{{ e.justified === null ? '' : e.justified ? 'justifié' + (e.kind === 'absence' ? 'e' : '') : 'non justifié' + (e.kind === 'absence' ? 'e' : '') }}</span>
                    }
                  </div>
                  <div class="g-meta">{{ e.displayDate || (e.date ? fr(e.date) : '') }}</div>
                  @if (e.label || e.reason) { <div class="txt">{{ [e.label, e.reason].filter(nonVide).join(' · ') }}</div> }
                  @if (e.by) { <div class="g-meta">{{ e.by }}</div> }
                </div>
              } @empty {
                <div class="empty">Rien d’enregistré cette année.</div>
              }
            } @else {
              <div class="hint">Chargement…</div>
            }
          } @else {
          @for (g of groups(); track g.day) {
            <div class="day">
              <div class="d-head">{{ g.label }}<span class="d-n">{{ g.items.length }}</span></div>
              @for (h of g.items; track h.id) {
                <div class="hw" [class.done]="h.done" [class.archived]="h.archived">
                  <button class="tick" [class.on]="h.done" [disabled]="ecole.busy().has(h.id) || h.archived" (click)="ecole.setDone(h, !h.done)"
                          [attr.aria-pressed]="h.done" [attr.aria-label]="(h.done ? 'Décocher ' : 'Marquer fait : ') + subject(h)">
                    @if (h.done) { <f-icon name="check" [size]="16" color="#fff" [width]="3.2" /> }
                  </button>
                  <div class="hw-b">
                    <div class="hw-t">
                      <span class="subj">{{ subject(h) }}</span>
                      @if (h.isTest) { <span class="badge test">Interrogation</span> }
                      @if (h.pending) { <span class="badge pend" [title]="h.doneError || 'Envoi à ÉcoleDirecte à la prochaine synchronisation'">non transmis</span> }
                      @if (h.archived) { <span class="badge off">retiré d’ÉcoleDirecte</span> }
                    </div>
                    @if (h.html) { <div class="txt" [innerHTML]="h.html"></div> } @else { <div class="txt muted">Énoncé pas encore récupéré.</div> }
                    <div class="meta">
                      @if (h.teacher) { <span>{{ h.teacher }}</span> }
                      @if (h.givenOn) { <span>donné le {{ fr(h.givenOn) }}</span> }
                      @if (h.modifiedAt) { <span class="mod">modifié {{ ecole.when(h.modifiedAt) }}</span> }
                      @if (h.pending && h.doneError) { <span class="ko">{{ h.doneError }}</span> }
                    </div>
                  </div>
                </div>
              }
            </div>
          } @empty {
            <div class="empty">{{ mode() === 'avenir' ? 'Rien à faire dans les prochains jours.' : 'Rien la semaine passée.' }}</div>
          }
          }
        }
      }
    </div>
  `,
  styles: [`
    .screen-sub.ko { color: #C6492F; }
    .hint, .small { font-size: 12.5px; font-weight: 600; color: var(--ink3); line-height: 1.45; }
    .small { margin-top: 4px; }
    .banner { border-radius: 12px; padding: 11px 14px; font-size: 13px; font-weight: 700; margin-bottom: 12px; line-height: 1.45; }
    .banner.ko { background: #FCE9E3; color: #A33A22; }
    .empty { font-size: 13.5px; font-weight: 600; color: var(--ink2); background: var(--soft); border-radius: 14px; padding: 18px; line-height: 1.5; }
    .link { border: none; background: none; padding: 0; color: var(--primary); font: inherit; font-weight: 800; cursor: pointer; }
    .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    .tab { border: none; border-radius: 20px; padding: 9px 16px; font-weight: 800; font-size: 14px; color: var(--ink); cursor: pointer; display: inline-flex; gap: 8px; align-items: center; }
    .tab.on { color: #fff; }
    .cnt { font-size: 11.5px; background: rgba(0,0,0,.12); border-radius: 10px; padding: 1px 7px; }
    .who { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-bottom: 10px; }
    .seg { display: inline-flex; background: var(--soft2); border-radius: 12px; padding: 3px; margin-bottom: 14px; }
    .seg button { border: none; background: none; padding: 7px 14px; border-radius: 9px; font-weight: 800; font-size: 13px; color: var(--ink2); cursor: pointer; }
    .seg button.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh-float); }
    .day { margin-bottom: 18px; }
    .d-head { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; color: var(--ink2); margin-bottom: 8px; display: flex; gap: 8px; align-items: center; }
    .d-n { font-size: 11px; color: var(--ink3); }
    .hw { display: flex; gap: 12px; background: var(--surface); border-radius: 14px; padding: 12px 14px; box-shadow: var(--sh-card); margin-bottom: 8px; }
    .hw.done .subj, .hw.done .txt { opacity: .55; }
    .hw.archived { opacity: .7; }
    .tick { flex: none; width: 30px; height: 30px; border-radius: 9px; border: 2px solid var(--line2); background: var(--surface); cursor: pointer; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
    .tick.on { background: #5F9E6E; border-color: #5F9E6E; }
    .tick:disabled { opacity: .5; cursor: default; }
    .hw-b { flex: 1; min-width: 0; }
    .hw-t { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .subj { font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .badge { font-size: 10.5px; font-weight: 800; border-radius: 6px; padding: 2px 7px; }
    .badge.test { background: #E3ECF7; color: #3D6FA8; }
    .badge.pend { background: #FDF0DA; color: #9A6A12; }
    .badge.off { background: var(--soft2); color: var(--ink2); }
    .txt { font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin-top: 4px; overflow-wrap: anywhere; }
    .txt.muted { color: var(--ink3); font-style: italic; }
    .txt :is(p, ul, ol) { margin: 0 0 4px; }
    .txt ul, .txt ol { padding-left: 18px; }
    .txt a { color: var(--primary); font-weight: 800; }
    .meta { display: flex; gap: 10px; flex-wrap: wrap; font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; }
    .meta .mod { color: #9A6A12; }
    .meta .ko { color: #C6492F; }
    .seg { max-width: 100%; overflow-x: auto; }
    .seg button { white-space: nowrap; }
    .avg-card { background: var(--surface); border-radius: 14px; box-shadow: var(--sh-card); padding: 4px 14px; }
    .avg { display: flex; align-items: baseline; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); }
    .avg:first-child { border-top: none; }
    .avg.gen .avg-s, .avg.gen .avg-v { font-weight: 900; color: var(--ink); }
    .avg-s { flex: 1; font-size: 13.5px; font-weight: 700; color: var(--ink2); }
    .avg-v { font-size: 15px; font-weight: 800; color: var(--ink); }
    .avg-c { font-size: 11.5px; font-weight: 700; color: var(--ink3); min-width: 74px; text-align: right; }
    .grade, .life { display: block; width: 100%; text-align: left; border: none; font: inherit; background: var(--surface); border-radius: 14px; box-shadow: var(--sh-card); padding: 11px 14px; margin-bottom: 8px; cursor: pointer; }
    .life { cursor: default; }
    .life.sanction { border-left: 4px solid #C6492F; }
    .life.encouragement { border-left: 4px solid #5F9E6E; }
    .g-top { display: flex; align-items: center; gap: 8px; }
    .g-s { flex: 1; font-size: 14px; font-weight: 800; color: var(--ink); }
    .g-v { font-size: 16px; font-weight: 900; color: var(--ink); }
    .g-v.ns { color: var(--ink3); text-decoration: line-through; }
    .g-meta { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 3px; }
    .g-detail { margin-top: 8px; display: grid; gap: 4px; }
    .g-detail div { display: flex; justify-content: space-between; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .badge.okb { background: #EDF2EB; color: #5F7E5C; }
  `],
})
export class EcoleScreen {
  store = inject(FoyerStore);
  ecole = inject(EcoleStore);
  private api = inject(EcoleApi);

  readonly pick = signal<number | null>(null);
  readonly mode = signal<'avenir' | 'passe' | 'notes' | 'vie'>('avenir');
  /** La semaine passée, archives comprises (devoirs retirés d'ÉcoleDirecte depuis). */
  readonly past = signal<EdHomework[]>([]);
  readonly notes = signal<{ grades: EdGradeView[]; averages: EdAverageView[] } | null>(null);
  readonly vie = signal<EdLifeView[] | null>(null);
  readonly openGrade = signal<number | null>(null);
  readonly nonVide = (s: string): boolean => !!s;

  constructor() { void this.ecole.load(); }

  /** L'enfant affiché : celui choisi, sinon le premier (pour un compte enfant, lui-même). */
  readonly current = computed<EdVueStudent | null>(() => {
    const st = this.ecole.students();
    return st.find((s) => s.id === this.pick()) ?? st[0] ?? null;
  });

  readonly groups = computed<DayGroup[]>(() => {
    const s = this.current(); const v = this.ecole.vue();
    if (!s || !v) return [];
    const today = v.today, demain = this.store.addDays(today, 1);
    if (this.mode() === 'passe') {
      return this.byDay(this.past().filter((h) => h.studentId === s.id && h.due < today)).reverse();
    }
    const upcoming = this.ecole.homeworkOf(s.id).filter((h) => h.due >= today);
    const groups = this.byDay(upcoming.filter((h) => h.due > today));
    // Demain d'abord, puis les jours suivants ; ce qui était pour aujourd'hui ferme la marche.
    const todayGroup = this.byDay(upcoming.filter((h) => h.due === today));
    return [...groups.filter((g) => g.day === demain), ...groups.filter((g) => g.day !== demain), ...todayGroup];
  });

  private byDay(list: EdHomework[]): DayGroup[] {
    const map = new Map<string, EdHomework[]>();
    for (const h of list.slice().sort((a, b) => a.due.localeCompare(b.due) || Number(b.isTest) - Number(a.isTest))) (map.get(h.due) ?? map.set(h.due, []).get(h.due)!).push(h);
    return [...map].map(([day, items]) => ({ day, label: this.dayLabel(day), items }));
  }

  async showPast(s: EdVueStudent): Promise<void> {
    this.mode.set('passe');
    const today = this.ecole.vue()?.today || this.store.todayStr();
    try { this.past.set((await this.api.archives(s.id, this.store.addDays(today, -7), this.store.addDays(today, -1))).homework); }
    catch (e) { this.store.toast((e as Error).message); }
  }

  async showNotes(s: EdVueStudent): Promise<void> {
    this.mode.set('notes'); this.notes.set(null);
    try { this.notes.set(await this.api.notes(s.id)); } catch (e) { this.store.toast((e as Error).message); this.mode.set('avenir'); }
  }
  async showVie(s: EdVueStudent): Promise<void> {
    this.mode.set('vie'); this.vie.set(null);
    try { this.vie.set((await this.api.vie(s.id)).items); } catch (e) { this.store.toast((e as Error).message); this.mode.set('avenir'); }
  }

  /**
   * Les moyennes de la période en cours (celle qui contient aujourd'hui, sinon
   * la dernière), telles qu'ÉcoleDirecte les renvoie, moyenne générale en tête.
   */
  readonly period = computed<{ label: string; rows: EdAverageView[] } | null>(() => {
    const a = this.notes()?.averages ?? [];
    if (!a.length) return null;
    const today = this.ecole.vue()?.today || this.store.todayStr();
    const codes = [...new Set(a.map((x) => x.periodCode))];
    const current = codes.find((c) => { const p = a.find((x) => x.periodCode === c)!; return !!p.periodFrom && !!p.periodTo && p.periodFrom <= today && today <= p.periodTo; }) ?? codes[codes.length - 1];
    const rows = a.filter((x) => x.periodCode === current);
    return { label: rows[0].periodLabel || current, rows };
  });

  isNum(v: string): boolean { return /^-?\d+([.,]\d+)?$/.test(v.trim()); }
  subject2(s: string): string { return subjectLabel(s); }
  lifeLabel(k: EdLifeView['kind']): string { return k === 'absence' ? 'Absence' : k === 'retard' ? 'Retard' : k === 'sanction' ? 'Sanction' : 'Encouragement'; }

  openTomorrow(studentId: number): number {
    const v = this.ecole.vue(); if (!v) return 0;
    const demain = this.store.addDays(v.today, 1);
    return this.ecole.homeworkOf(studentId).filter((h) => h.due === demain && !h.done).length;
  }

  dayLabel(day: string): string {
    const today = this.ecole.vue()?.today || this.store.todayStr();
    if (day === today) return 'Pour aujourd’hui';
    if (day === this.store.addDays(today, 1)) return 'Pour demain';
    if (day === this.store.addDays(today, -1)) return 'Hier';
    return 'Pour ' + this.store.fmtLongDate(day);
  }
  name(s: EdVueStudent): string { return this.store.memberName(s.memberId) || s.firstName; }
  subject(h: EdHomework): string { return subjectLabel(h.subject); }
  fr(day: string): string { return day.split('-').reverse().slice(0, 2).join('/'); }
  openSettings(): void { this.store.go('settings'); this.store.patch({ settingsSection: 'ecole' }); }
}
