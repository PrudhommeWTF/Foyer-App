import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FinancesStore } from '../../core/finances.store';
import { IconComponent } from '../../core/icon';

/** ‹ Octobre 2026 › « Ce mois-ci / Historique », en tête d'Aperçu et d'Opérations. Le contenu projeté se range à droite. */
@Component({
  selector: 'fin-month-nav',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="nav">
      <button class="nav-btn" (click)="store.prevMonth()" aria-label="Mois précédent"><f-icon name="chevronLeft" [size]="17" color="var(--ink2)" [width]="2.2" /></button>
      <div class="nav-month f-display">{{ store.monthLabel() }}</div>
      <button class="nav-btn" (click)="store.nextMonth()" aria-label="Mois suivant"><f-icon name="chevronRight" [size]="17" color="var(--ink2)" [width]="2.2" /></button>
      <span class="nav-tag">{{ store.isCurrentMonth() ? 'Ce mois-ci' : 'Historique' }}</span>
    </div>
    <ng-content />
  `,
  styles: [`
    :host { display: flex; align-items: center; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap; margin-bottom: 16px; }
    .nav { display: flex; align-items: center; gap: 6px; }
    .nav-btn { width: 34px; height: 34px; border: none; border-radius: 11px; background: var(--soft2); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .nav-btn:hover { background: var(--line); }
    .nav-month { font-size: 19px; font-weight: 700; color: var(--ink); min-width: 132px; text-align: center; }
    .nav-tag { margin-left: 6px; font-size: 12.5px; font-weight: 800; color: var(--ink3); }
  `],
})
export class FinMonthNav {
  store = inject(FinancesStore);
}
