import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { EcoleStore } from '../../core/ecole.store';
import { EdAverageView, EdGradeView } from '../../core/ecole.api';
import { ItemCtx } from '../../core/items';

/** Ce que la fiche d'une note reçoit : la note, et la moyenne de sa matière sur la période quand elle existe. */
export interface GradeRef { grade: EdGradeView; studentId: number; average: EdAverageView | null; }

/** La fiche d'une note, en lecture : la note, l'épreuve, et où elle se situe dans la classe. */
@Component({
  selector: 'app-grade-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let g = item().grade;
    <div class="big">
      <span class="val" [class.ns]="g.notSignificant">{{ g.value }}@if (g.outOf && isNum(g.value)) { <span class="out">/{{ g.outOf }}</span> }</span>
      <span class="when">{{ [student(), g.date ? foyer.fmtNumDate(g.date) : ''].filter(nonVide).join(' · ') }}</span>
    </div>
    @if (g.notSignificant) { <div class="flag">Note non significative : elle ne compte pas dans la moyenne.</div> }
    <dl class="rows">
      @if (g.label) { <div><dt>Épreuve</dt><dd>{{ g.label }}</dd></div> }
      @if (g.kind) { <div><dt>Type</dt><dd>{{ g.kind }}</dd></div> }
      @if (g.coefficient) { <div><dt>Coefficient</dt><dd>{{ g.coefficient }}</dd></div> }
      @if (g.classAverage) { <div><dt>Moyenne de la classe</dt><dd>{{ g.classAverage }}</dd></div> }
      @if (g.classMin || g.classMax) { <div><dt>Plus basse · plus haute</dt><dd>{{ g.classMin || '–' }} · {{ g.classMax || '–' }}</dd></div> }
      @if (item().average; as a) { <div><dt>Moyenne de la matière{{ a.periodLabel ? ' (' + a.periodLabel + ')' : '' }}</dt><dd>{{ a.average || '–' }}{{ a.classAverage ? ' · classe ' + a.classAverage : '' }}</dd></div> }
    </dl>
    <div class="small">Notes et moyennes reprises telles qu’ÉcoleDirecte les donne.</div>
  `,
  styles: [`
    :host { display: block; }
    .big { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 4px 0 12px; }
    .val { font-family: var(--font-display); font-size: 34px; font-weight: 800; color: var(--ink); }
    .val.ns { color: var(--ink3); }
    .out { font-size: 18px; color: var(--ink3); }
    .when { font-size: 12.5px; font-weight: 700; color: var(--ink3); }
    .flag { margin: 0 0 10px; padding: 9px 12px; border-radius: 12px; background: var(--soft); font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .rows { margin: 0; }
    .rows div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line); }
    dt { font-size: 13px; font-weight: 700; color: var(--ink2); }
    dd { margin: 0; font-size: 14px; font-weight: 800; color: var(--ink); text-align: right; }
    .small { margin-top: 10px; font-size: 12px; font-weight: 600; color: var(--ink3); }
  `],
})
export class GradeView {
  readonly foyer = inject(FoyerStore);
  readonly ecole = inject(EcoleStore);
  readonly item = input.required<GradeRef>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly nonVide = (s: string): boolean => !!s;

  isNum(v: string): boolean { return /^-?\d+([.,]\d+)?$/.test(v.trim()); }
  /** L'élève, quand il y en a plusieurs à suivre. */
  readonly student = computed(() => {
    if (this.ecole.students().length < 2) return '';
    const s = this.ecole.students().find((x) => x.id === this.item().studentId);
    return s ? this.foyer.memberName(s.memberId) || s.firstName : '';
  });
}
