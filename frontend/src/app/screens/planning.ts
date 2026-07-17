import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { ModalComponent } from '../shared/modal';
import { SCHED_DAYS, SCHED_TYPES, SCHED_COLORS } from '../core/constants';

@Component({
  selector: 'screen-planning',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <div class="head-row">
        <div class="members">
          @for (m of d().members; track m.id) {
            <div class="pill" [class.active]="store.ui().schedChild === m.id" (click)="store.patch({ schedChild: m.id })">
              <f-avatar [ini]="m.ini" [color]="m.color" [size]="24" />
              <span>{{ m.name }}</span>
            </div>
          }
        </div>
        <button class="btn btn-primary" (click)="store.newSlot(days[0])">
          <f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Nouveau créneau
        </button>
      </div>

      <div class="grid">
        @for (day of days; track day) {
          <div class="day-card">
            <div class="day-head">
              <div class="day-name">{{ day }}</div>
              <span class="day-count">{{ slotsFor(day).length }}</span>
            </div>
            <div class="slots">
              @for (s of slotsFor(day); track s.id) {
                <div class="slot" [style.border-left]="'4px solid ' + SCHED_COLORS[s.k]" (click)="store.editSlot(s.id)">
                  <div class="slot-time">{{ s.end ? s.start + ' – ' + s.end : s.start }}</div>
                  <div class="slot-label">{{ s.label }}</div>
                  <span class="slot-badge" [style.background]="tintOf(s.k)" [style.color]="SCHED_COLORS[s.k]">
                    <span class="dot" [style.background]="SCHED_COLORS[s.k]"></span>{{ typeLabel(s.k) }}
                  </span>
                </div>
              } @empty {
                <div class="free">Libre</div>
              }
            </div>
            <div class="add" (click)="store.newSlot(day)">
              <f-icon name="plus" [size]="13" color="var(--ink2)" [width]="2.6" /> Ajouter
            </div>
          </div>
        }
      </div>
    </div>

    @if (store.ui().schedEdit) {
      <f-modal [title]="formTitle()" [maxWidth]="520" (close)="store.patch({ schedEdit: false })">
        <div class="field-label">Jour</div>
        <div class="seg wrap">
          @for (day of days; track day) {
            <button [class.active]="store.ui().seDay === day" (click)="store.patch({ seDay: day })">{{ day }}</button>
          }
        </div>

        <div class="form-row">
          <div class="field">
            <div class="field-label">Début</div>
            <input class="input" type="time" [ngModel]="store.ui().seStart" (ngModelChange)="store.patch({ seStart: $event })" />
          </div>
          <div class="field">
            <div class="field-label">Fin (option.)</div>
            <input class="input" type="time" [ngModel]="store.ui().seEnd" (ngModelChange)="store.patch({ seEnd: $event })" />
          </div>
        </div>

        <div class="field-label">Intitulé</div>
        <input class="input" [ngModel]="store.ui().seLabel" (ngModelChange)="store.patch({ seLabel: $event })" placeholder="Ex : Cours de piano" />

        <div class="field-label">Type</div>
        <div class="type-opts">
          @for (t of types; track t.k) {
            <div class="type-opt" [class.on]="store.ui().seType === t.k"
                 [style.border-color]="store.ui().seType === t.k ? t.color : 'transparent'"
                 [style.background]="tintOf(t.k)" [style.color]="t.color"
                 (click)="store.patch({ seType: t.k })">
              <span class="dot" [style.background]="t.color"></span>{{ t.label }}
            </div>
          }
        </div>

        <div class="modal-actions">
          @if (store.ui().seEditId) {
            <button class="btn btn-danger" (click)="store.delSlot()"><f-icon name="trash" [size]="16" color="#fff" [width]="2.2" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ schedEdit: false })">Annuler</button>
          <button class="btn btn-primary" (click)="store.saveSlot()">Enregistrer</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .head-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 22px; flex-wrap: wrap; }
    .members { display: flex; flex-wrap: wrap; gap: 10px; }
    .pill { display: flex; align-items: center; gap: 9px; padding: 8px 16px 8px 8px; border-radius: 14px; cursor: pointer; background: var(--surface); color: var(--ink); font-weight: 800; font-size: 14px; box-shadow: 0 8px 18px -14px rgba(90,60,40,.6); }
    .pill.active { background: var(--primary); color: #fff; }
    .head-row .btn { flex: none; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; align-items: start; }
    :host-context(.shell.narrow) .grid { grid-template-columns: repeat(2, 1fr); }
    @media (max-width: 860px) { .grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }

    .day-card { background: var(--surface); border-radius: 18px; padding: 14px; box-shadow: 0 12px 28px -22px rgba(90,60,40,.5); min-height: 230px; display: flex; flex-direction: column; }
    .day-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .day-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--ink); }
    .day-count { font-size: 11px; font-weight: 800; color: var(--ink3); }

    .slots { display: flex; flex-direction: column; gap: 8px; flex: 1; }
    .slot { background: var(--soft); border-radius: 12px; padding: 10px 11px; cursor: pointer; }
    .slot-time { font-family: var(--font-display); font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .slot-label { font-size: 13.5px; font-weight: 800; color: var(--ink); margin-top: 2px; line-height: 1.2; }
    .slot-badge { display: inline-flex; align-items: center; gap: 5px; margin-top: 7px; padding: 3px 8px; border-radius: 8px; font-size: 10.5px; font-weight: 800; }
    .slot-badge .dot { width: 7px; height: 7px; border-radius: 2px; }
    .free { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--ink3); font-size: 12px; font-weight: 700; padding: 16px 0; }

    .add { margin-top: 8px; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 8px; border-radius: 11px; background: var(--soft2); color: var(--ink2); font-size: 12px; font-weight: 800; cursor: pointer; }

    .seg.wrap { flex-wrap: wrap; margin-bottom: 20px; }
    .form-row { display: flex; gap: 12px; margin-bottom: 4px; }
    .field { flex: 1; min-width: 0; }
    .field-label { margin-top: 4px; }
    .input { margin-bottom: 4px; }

    .type-opts { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 12px; }
    .type-opt { display: flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 11px; font-size: 13.5px; font-weight: 800; cursor: pointer; border: 2px solid transparent; }
    .type-opt .dot { width: 9px; height: 9px; border-radius: 3px; }

    .modal-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
    .modal-actions .spacer { flex: 1; }
  `],
})
export class PlanningScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  days = SCHED_DAYS;
  types = SCHED_TYPES;
  SCHED_COLORS = SCHED_COLORS;

  private byDay = computed(() => {
    const who = this.store.ui().schedChild;
    return this.d().sched
      .filter((s) => s.who === who)
      .slice()
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  });

  slotsFor(day: string) { return this.byDay().filter((s) => s.day === day); }

  typeLabel(k: string): string { return SCHED_TYPES.find((t) => t.k === k)?.label || k; }

  tintOf(k: string): string {
    const c = SCHED_COLORS[k] || 'var(--ink3)';
    return `color-mix(in srgb, ${c} 14%, var(--surface))`;
  }

  formTitle = computed(() => (this.store.ui().seEditId ? 'Modifier le créneau' : 'Nouveau créneau'));
}
