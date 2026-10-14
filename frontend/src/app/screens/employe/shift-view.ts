import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { EmployesStore } from '../../core/employes.store';
import { IconComponent } from '../../core/icon';
import { relTime } from '../../core/activity';
import { cap, parseDay } from '../../core/helpers';
import { decHours } from '../../core/employe.format';
import { EmpShift } from '../../core/employes.api';
import { ItemCtx } from '../../core/items';

/** La fiche d'une présence, en lecture : le jour, la durée, la note, qui l'a notée, et si le mois est figé. */
@Component({
  selector: 'app-shift-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let s = item();
    <div class="row">
      <span class="ic"><f-icon name="calendar" [size]="17" color="#4E93B8" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ day() }}</div><div class="sub">{{ hours() }}</div></div>
    </div>
    @if (s.note) {
      <div class="row">
        <span class="ic"><f-icon name="edit" [size]="16" color="var(--ink2)" [width]="2.2" /></span>
        <div class="txt"><div class="main note">{{ s.note }}</div></div>
      </div>
    }
    <div class="row">
      <span class="ic"><f-icon name="users" [size]="17" color="#9B6FA8" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ who() }}</div></div>
    </div>
    @if (frozen()) { <div class="frozen"><f-icon name="lock" [size]="14" color="var(--ink3)" [width]="2.2" /> Mois figé (déclaré ou payé) : rouvrez-le depuis l'écran pour modifier.</div> }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; }
    .row + .row { border-top: 1px solid var(--line); }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .txt { flex: 1; min-width: 0; }
    .main { font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .main.note { font-weight: 700; white-space: pre-line; }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .frozen { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 9px 12px; border-radius: 12px; background: var(--soft); font-size: 12.5px; font-weight: 700; color: var(--ink2); }
  `],
})
export class ShiftView {
  readonly foyer = inject(FoyerStore);
  readonly emp = inject(EmployesStore);
  readonly item = input.required<EmpShift>();
  readonly ctx = input<ItemCtx | undefined>(undefined);

  readonly day = computed(() => cap(parseDay(this.item().day).toLocaleDateString(this.foyer.locale, { weekday: 'long', day: 'numeric', month: 'long' })));
  readonly hours = computed(() => decHours(this.item().minutes) + ' de présence');
  /** Qui l'a notée, ou modifiée en dernier, et quand ; un assistant se dit tel quel. */
  readonly who = computed(() => {
    const s = this.item(), by = s.updatedBy || s.createdBy, at = s.updatedAt || s.createdAt, via = s.updatedVia || s.createdVia;
    const nom = by ? this.foyer.memberName(by) || 'quelqu’un' : 'quelqu’un';
    return (s.updatedAt ? 'Modifiée par ' : 'Notée par ') + nom + (via ? ' (via un assistant)' : '') + (at ? ', ' + relTime(at, Date.now()) : '');
  });
  readonly frozen = computed(() => !!this.emp.recap()?.frozen);
}
