import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { MEAL_SLOTS, DOW } from '../core/constants';
import { weekDates, dstr } from '../core/helpers';
import { MealValue } from '../core/models';

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
        <button class="btn btn-sage" (click)="store.prepareList(store.ui().weekOffset)">
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

          @for (slot of store.mealSlots(); track slot.key) {
            <div class="rlabel">
              <span class="rlabel-txt">{{ slot.label }}</span>
            </div>
            @for (d of wDates(); track dstr(d)) {
              @let meal = mealAt(d, slot.key);
              @let names = store.mealNames(meal);
              <div class="cell" [class.filled]="names.length > 0" [class.today]="isToday(d)" (click)="store.editMeal(dstr(d), slot.key)">
                <div class="cell-top">
                  <span class="dot" [style.background]="slot.dot"></span>
                  <span class="cell-slot">{{ slot.short }}</span>
                </div>
                @if (names.length) {
                  @for (n of names; track $index) {
                    <div class="cell-name">{{ n }}</div>
                  }
                  <div class="cell-tag">
                    <span class="tag-count">{{ names.length > 1 ? names.length + ' plats' : 'Un plat' }}</span>
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

        @if (store.ui().mealItems.length) {
          <div class="overline menu-t">Au menu</div>
          <div class="menu">
            @for (it of store.ui().mealItems; track $index; let i = $index) {
              <div class="menu-row">
                <span class="menu-n">{{ i + 1 }}</span>
                <span class="menu-name">{{ store.mealItemName(it) }}</span>
                @if (!it.rid) { <span class="menu-free">libre</span> }
                <button class="icon-btn sm" (click)="store.removeMealItem(i)" [attr.aria-label]="'Retirer ' + store.mealItemName(it)">
                  <f-icon name="minus" [size]="16" color="var(--ink2)" />
                </button>
              </div>
            }
          </div>
        } @else {
          <div class="menu-empty">Aucun plat choisi. Touchez une recette ci-dessous, ou ajoutez un intitulé libre.</div>
        }

        <div class="field-label">Couverts</div>
        <div class="pax-row">
          <input class="input pax" type="number" inputmode="numeric" min="1" max="30"
                 [ngModel]="store.ui().mealPax" (ngModelChange)="store.patch({ mealPax: $event })"
                 [placeholder]="store.householdPax() + ' (le foyer)'" />
          <span class="pax-hint">Les quantités de la liste de courses suivent ce nombre. Laissez vide pour le foyer entier.</span>
        </div>

        <div class="field-label">Ajouter un intitulé libre</div>
        <div class="free-row">
          <input class="input" [ngModel]="store.ui().mealText" (ngModelChange)="store.patch({ mealText: $event })"
                 (keydown.enter)="store.addMealText()" placeholder="Ex : Restaurant, restes, pique-nique…" />
          <button class="btn btn-soft" (click)="store.addMealText()">Ajouter</button>
        </div>

        <div class="overline menu-t">Recettes du carnet</div>
        <div class="recipe-grid">
          @for (r of d().recipes; track r.id) {
            <div class="recipe-card" [class.sel]="store.isMealRecipe(r.id)" (click)="store.toggleMealRecipe(r.id)">
              @let th = store.photoUrl(r.photoId);
              <div class="thumb" [style.background]="th ? 'url(' + th + ')' : store.grad(r.color)"
                   [style.background-size]="'cover'" [style.background-position]="'center'"></div>
              <div class="rc-body">
                <div class="rc-name">{{ r.name }}</div>
                <div class="rc-time">{{ store.recipeTime(r) }}{{ r.portions ? ' · ' + r.portions + ' pers.' : '' }}</div>
              </div>
              @if (store.isMealRecipe(r.id)) { <f-icon name="check" [size]="16" color="var(--primary)" [width]="3" /> }
            </div>
          } @empty {
            <div class="muted">Aucune recette dans le carnet.</div>
          }
        </div>

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
    .pax-row { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
    .pax { width: 120px; flex: none; }
    .pax-hint { flex: 1; min-width: 180px; font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; }

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
    .cell-name { font-weight: 800; font-size: 13px; color: var(--ink); line-height: 1.25; }
    .cell-name + .cell-name { margin-top: 3px; font-weight: 700; color: var(--ink2); }
    .cell-tag { margin-top: 6px; font-size: 10px; font-weight: 800; }
    .tag-count { color: var(--sage); }
    .cell-empty { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; color: var(--ink3); }
    .cell-empty span { font-size: 11.5px; font-weight: 800; }

    .modal-date { font-size: 13px; font-weight: 700; color: var(--ink2); text-transform: capitalize; margin-top: -6px; margin-bottom: 16px; }
    .menu-t { display: block; margin: 18px 0 10px; }
    .menu { display: flex; flex-direction: column; gap: 8px; }
    .menu-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 13px; background: var(--soft); }
    .menu-n { width: 22px; height: 22px; flex: none; border-radius: 50%; background: var(--primary); color: #fff; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .menu-name { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .menu-free { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; flex: none; }
    .menu-empty { font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.45; padding: 12px 0 4px; }
    .free-row { display: flex; gap: 10px; margin-bottom: 4px; }
    .free-row .input { flex: 1; min-width: 0; }
    .recipe-card.sel .rc-name { color: var(--primary); }
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

  readonly DOW = DOW;
  readonly dstr = dstr;

  wDates = computed(() => weekDates(this.store.ui().weekOffset, this.store.todayStr()));

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
    return new Date(e.dateStr + 'T00:00:00').toLocaleDateString(this.store.locale, { weekday: 'long', day: 'numeric', month: 'long' });
  });

  hasExisting = computed(() => {
    const e = this.store.ui().mealEdit;
    return !!e && !!this.d().meals[e.dateStr + '-' + e.slot]?.items?.length;
  });

  isToday(d: Date): boolean { return dstr(d) === this.store.todayStr(); }

  mealAt(d: Date, slot: string): MealValue | undefined { return this.d().meals[dstr(d) + '-' + slot]; }

  private fmt(d: Date): string {
    return d.toLocaleDateString(this.store.locale, { day: 'numeric', month: 'short' });
  }
}
