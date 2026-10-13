import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { EcoleStore, subjectLabel } from '../core/ecole.store';
import { EcoleApi, EdHomework, EdVueStudent } from '../core/ecole.api';
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
              <button class="tab" [class.on]="current()?.id === s.id" (click)="pick.set(s.id)"
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
            <button [class.on]="mode() === 'passe'" (click)="showPast(s)">Semaine passée</button>
          </div>

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
  `],
})
export class EcoleScreen {
  store = inject(FoyerStore);
  ecole = inject(EcoleStore);
  private api = inject(EcoleApi);

  readonly pick = signal<number | null>(null);
  readonly mode = signal<'avenir' | 'passe'>('avenir');
  /** La semaine passée, archives comprises (devoirs retirés d'ÉcoleDirecte depuis). */
  readonly past = signal<EdHomework[]>([]);
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
