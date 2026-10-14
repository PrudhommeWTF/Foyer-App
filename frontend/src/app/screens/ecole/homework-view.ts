import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { EcoleStore } from '../../core/ecole.store';
import { IconComponent } from '../../core/icon';
import { EdHomework } from '../../core/ecole.api';
import { ItemCtx } from '../../core/items';

/**
 * La fiche d'un devoir ÉcoleDirecte, en lecture : pour quand, l'énoncé entier,
 * qui l'a donné et quand, et où en est la case « Fait » (une coche pas encore
 * acceptée par ÉcoleDirecte se dit telle quelle).
 */
@Component({
  selector: 'app-homework-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let h = item();
    <div class="row">
      <span class="ic" [class.done]="h.done"><f-icon [name]="h.done ? 'check' : 'ecole'" [size]="17" [color]="h.done ? '#fff' : '#3D6FA8'" [width]="2.4" /></span>
      <div class="txt"><div class="main">{{ due() }}@if (h.isTest) { <span class="badge test">Interrogation</span> }</div>
        <div class="sub">{{ [student(), h.done ? 'fait' : 'à faire'].filter(nonVide).join(' · ') }}</div></div>
    </div>
    @if (h.pending) { <div class="flag warn">Coche pas encore transmise à ÉcoleDirecte{{ h.doneError ? ' : ' + h.doneError : ', elle partira à la prochaine synchronisation' }}.</div> }
    @if (h.archived) { <div class="flag">Retiré d’ÉcoleDirecte depuis : gardé ici pour mémoire.</div> }
    @if (h.html) { <div class="stmt" [innerHTML]="h.html"></div> } @else { <div class="stmt muted">Énoncé pas encore récupéré.</div> }
    @if (meta()) { <div class="meta">{{ meta() }}</div> }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 13px; padding: 4px 0 12px; }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: #E5EDF6; display: flex; align-items: center; justify-content: center; }
    .ic.done { background: var(--sage); }
    .txt { flex: 1; min-width: 0; }
    .main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 15px; font-weight: 800; color: var(--ink); }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .badge { font-size: 10.5px; font-weight: 800; border-radius: 6px; padding: 2px 7px; }
    .badge.test { background: #FCE9E3; color: #C6492F; }
    .flag { margin: 0 0 10px; padding: 9px 12px; border-radius: 12px; background: var(--soft); font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .flag.warn { background: #FDF0DA; color: #9A6A12; }
    .stmt { padding: 12px 14px; border-radius: 14px; background: var(--soft); font-size: 14px; font-weight: 600; color: var(--ink); line-height: 1.5; overflow-wrap: anywhere; }
    .stmt.muted { color: var(--ink3); }
    .stmt :is(p, ul, ol) { margin: 0 0 6px; }
    .meta { margin-top: 10px; font-size: 12.5px; font-weight: 700; color: var(--ink3); }
  `],
})
export class HomeworkView {
  readonly foyer = inject(FoyerStore);
  readonly ecole = inject(EcoleStore);
  readonly item = input.required<EdHomework>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly nonVide = (s: string): boolean => !!s;

  /** « Pour demain », « Pour jeudi 16 octobre » : la question du soir d'abord. */
  readonly due = computed(() => {
    const d = this.item().due, today = this.ecole.vue()?.today || this.foyer.todayStr();
    if (d === today) return 'Pour aujourd’hui';
    if (d === this.foyer.addDays(today, 1)) return 'Pour demain';
    const l = this.foyer.fmtLongDate(d);
    return (d < today ? 'Pour le ' : 'Pour ') + l.charAt(0).toLowerCase() + l.slice(1);
  });
  /** L'élève, quand il y en a plusieurs à suivre. */
  readonly student = computed(() => {
    if (this.ecole.students().length < 2) return '';
    const s = this.ecole.students().find((x) => x.id === this.item().studentId);
    return s ? this.foyer.memberName(s.memberId) || s.firstName : '';
  });
  readonly meta = computed(() => {
    const h = this.item();
    return [h.teacher, h.givenOn ? 'donné le ' + this.foyer.fmtNumDate(h.givenOn) : '', h.modifiedAt ? 'modifié ' + this.ecole.when(h.modifiedAt) : ''].filter(Boolean).join(' · ');
  });
}
