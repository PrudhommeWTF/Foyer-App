import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { MEAL_SLOTS, DOW } from '../core/constants';
import { weekDates, dstr } from '../core/helpers';

@Component({
  selector: 'screen-repas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <div class="head-bar">
        <div class="nav">
          <button class="icon-btn" (click)="store.patch({ weekOffset: store.ui().weekOffset - 1 })" aria-label="Semaine précédente">
            <f-icon name="chevronLeft" [size]="18" [color]="'var(--ink2)'" [width]="2.2" />
          </button>
          <div class="nav-label">
            <div class="week-label f-display">{{ weekLabel() }}</div>
            <div class="week-tag" [style.color]="weekTagColor()">{{ weekTag() }}</div>
          </div>
          <button class="icon-btn" (click)="store.patch({ weekOffset: store.ui().weekOffset + 1 })" aria-label="Semaine suivante">
            <f-icon name="chevronRight" [size]="18" [color]="'var(--ink2)'" [width]="2.2" />
          </button>
          @if (store.ui().weekOffset !== 0) {
            <button class="btn btn-soft sm" (click)="store.patch({ weekOffset: 0 })">Cette semaine</button>
          }
        </div>
        <button class="btn btn-sage" (click)="store.generateList()">
          <f-icon name="bolt" [size]="20" color="#fff" [width]="2" /> Générer les courses
        </button>
      </div>

      <div class="grid-scroll">
        <div class="grid">
          <div class="corner"></div>
          @for (d of wDates(); track $index) {
            <div class="dhead" [class.today]="isToday(d)">
              <div class="dow">{{ DOW[$index] }}</div>
              <div class="dnum f-display">{{ d.getDate() }}</div>
            </div>
          }

          @for (slot of slots; track slot.key) {
            <div class="rlabel">
              <span class="rlabel-txt">{{ slot.label }}</span>
            </div>
            @for (d of wDates(); track dstr(d)) {
              @let meal = mealAt(d, slot.key);
              @let name = store.mealName(meal);
              <div class="cell" [class.filled]="!!name" [class.today]="isToday(d)" (click)="store.editMeal(dstr(d), slot.key)">
                <div class="cell-top">
                  <span class="dot" [style.background]="slot.dot"></span>
                  <span class="cell-slot">{{ slot.short }}</span>
                </div>
                @if (name) {
                  <div class="cell-name">{{ name }}</div>
                  <div class="cell-tag">
                    <span [class.tag-recipe]="!!meal?.rid" [class.tag-free]="!meal?.rid">{{ meal?.rid ? 'Recette' : 'Repas libre' }}</span>
                  </div>
                } @else {
                  <div class="cell-empty">
                    <f-icon name="plus" [size]="16" [color]="'var(--ink3)'" [width]="2.2" />
                    <span>Libre</span>
                  </div>
                }
              </div>
            }
          }
        </div>
      </div>
    </div>

    @if (store.ui().mealEdit; as me) {
      <f-modal [title]="slotLabel()" [maxWidth]="560" (close)="store.patch({ mealEdit: null })">
        <div class="modal-date">{{ dateLabel() }}</div>

        <div class="seg mode-seg">
          <button [class.active]="store.ui().mealMode === 'recipe'" (click)="store.patch({ mealMode: 'recipe' })">Recette</button>
          <button [class.active]="store.ui().mealMode === 'text'" (click)="store.patch({ mealMode: 'text' })">Texte libre</button>
        </div>

        @if (store.ui().mealMode === 'recipe') {
          <div class="recipe-grid">
            @for (r of d().recipes; track r.id) {
              <div class="recipe-card" [class.sel]="store.ui().mealRid === r.id" (click)="store.patch({ mealRid: r.id, mealMode: 'recipe' })">
                <div class="thumb" [style.background]="r.photo ? 'url(' + r.photo + ')' : store.grad(r.color)"></div>
                <div class="rc-body">
                  <div class="rc-name">{{ r.name }}</div>
                  <div class="rc-time">{{ r.time }}</div>
                </div>
              </div>
            } @empty {
              <div class="muted">Aucune recette dans le carnet.</div>
            }
          </div>
        } @else {
          <div class="field-label">Intitulé du repas</div>
          <input
            class="input"
            [ngModel]="store.ui().mealText"
            (ngModelChange)="store.patch({ mealText: $event })"
            placeholder="Ex : Restaurant, restes, pique-nique…"
          />
        }

        <div class="modal-foot">
          @if (hasExisting()) {
            <button class="btn btn-danger" (click)="store.clearMeal()">
              <f-icon name="trash" [size]="16" color="#fff" [width]="2.2" /> Retirer
            </button>
          }
          <div class="spacer"></div>
          <button class="btn btn-primary" (click)="store.saveMeal()">Enregistrer</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .head-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
    .nav { display: flex; align-items: center; gap: 12px; }
    .nav-label { text-align: center; min-width: 230px; }
    .week-label { font-size: 19px; font-weight: 700; color: var(--ink); }
    .week-tag { font-size: 12.5px; font-weight: 700; }

    .grid-scroll { overflow-x: auto; }
    .grid { display: grid; grid-template-columns: 64px repeat(7, minmax(120px, 1fr)); gap: 10px; align-items: stretch; min-width: 900px; }
    .corner { }
    .dhead { text-align: center; padding: 6px 0; border-radius: 12px; }
    .dhead.today { background: var(--honey); }
    .dow { font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; }
    .dhead.today .dow { color: #D9930F; }
    .dnum { font-size: 22px; font-weight: 700; color: var(--ink); }
    .dhead.today .dnum { color: #D9930F; }

    .rlabel { display: flex; align-items: center; justify-content: flex-end; padding-right: 4px; }
    .rlabel-txt { font-size: 11px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .03em; writing-mode: vertical-rl; transform: rotate(180deg); }

    .cell { background: var(--soft); border-radius: 16px; padding: 12px 11px; min-height: 96px; cursor: pointer; border: 2px solid transparent; display: flex; flex-direction: column; transition: transform .12s ease; }
    .cell:hover { transform: translateY(-2px); }
    .cell.filled { background: var(--surface); box-shadow: var(--sh-card); }
    .cell.today { border-color: var(--honey); }
    .cell-top { display: flex; align-items: center; gap: 6px; margin-bottom: 7px; }
    .dot { width: 8px; height: 8px; border-radius: 3px; flex: none; }
    .cell-slot { font-size: 9.5px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .04em; }
    .cell-name { font-weight: 800; font-size: 13px; color: var(--ink); line-height: 1.25; flex: 1; }
    .cell-tag { margin-top: 6px; font-size: 10px; font-weight: 800; }
    .tag-recipe { color: var(--sage); }
    .tag-free { color: var(--ink3); }
    .cell-empty { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; color: var(--ink3); }
    .cell-empty span { font-size: 11.5px; font-weight: 800; }

    .modal-date { font-size: 13px; font-weight: 700; color: var(--ink2); text-transform: capitalize; margin-top: -6px; margin-bottom: 16px; }
    .mode-seg { margin-bottom: 18px; }
    .recipe-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .recipe-card { display: flex; align-items: center; gap: 11px; padding: 11px; border-radius: 14px; cursor: pointer; background: var(--soft); border: 2px solid transparent; }
    .recipe-card.sel { background: rgba(229,107,78,.12); border-color: var(--primary); }
    .thumb { width: 40px; height: 40px; flex: none; border-radius: 11px; background-size: cover; background-position: center; }
    .rc-body { flex: 1; min-width: 0; }
    .rc-name { font-weight: 800; font-size: 13.5px; color: var(--ink); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rc-time { font-size: 11.5px; font-weight: 700; color: var(--ink2); }

    .modal-foot { display: flex; align-items: center; gap: 12px; margin-top: 22px; }

    @media (max-width: 860px) {
      .recipe-grid { grid-template-columns: 1fr; }
    }
    :host-context(.shell.narrow) .recipe-grid { grid-template-columns: 1fr; }
  `],
})
export class RepasScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  readonly slots = MEAL_SLOTS;
  readonly DOW = DOW;
  readonly dstr = dstr;

  wDates = computed(() => weekDates(this.store.ui().weekOffset));

  weekLabel = computed(() => {
    const w = this.wDates();
    return 'Semaine du ' + this.fmt(w[0]) + ' au ' + this.fmt(w[6]);
  });

  weekTag = computed(() => {
    const o = this.store.ui().weekOffset;
    if (o === 0) return 'Cette semaine';
    if (o === 1) return 'Semaine prochaine';
    if (o === -1) return 'Semaine dernière';
    return o > 0 ? 'Dans ' + o + ' semaines' : 'Il y a ' + -o + ' semaines';
  });

  weekTagColor = computed(() => (this.store.ui().weekOffset === 0 ? '#D9930F' : 'var(--ink2)'));

  slotLabel = computed(() => {
    const e = this.store.ui().mealEdit;
    return e ? (MEAL_SLOTS.find((s) => s.key === e.slot)?.label ?? '') : '';
  });

  dateLabel = computed(() => {
    const e = this.store.ui().mealEdit;
    if (!e) return '';
    return new Date(e.dateStr + 'T00:00:00').toLocaleDateString(this.store.locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  });

  hasExisting = computed(() => {
    const e = this.store.ui().mealEdit;
    return !!e && !!this.d().meals[e.dateStr + '-' + e.slot];
  });

  isToday(d: Date): boolean { return dstr(d) === this.store.todayStr(); }

  mealAt(d: Date, slot: string): { rid?: string; text?: string } | undefined {
    return this.d().meals[dstr(d) + '-' + slot];
  }

  private fmt(d: Date): string {
    return d.toLocaleDateString(this.store.locale(), { day: 'numeric', month: 'short' });
  }
}
