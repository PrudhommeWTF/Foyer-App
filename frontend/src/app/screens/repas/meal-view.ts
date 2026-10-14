import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { DOW } from '../../core/constants';
import { parseDay } from '../../core/helpers';
import { paxLabel } from '../../core/presence';
import { MealSlotRef } from '../../core/meals';
import { ItemCtx } from '../../core/items';

/**
 * La fiche d'un repas, en lecture : ce qui est au menu (une recette s'ouvre
 * d'un tap, par-dessus, et le retour ramène ici), qui mange, et l'agenda.
 * « Déplacer » se choisit dans la fiche même : plus de modale sur modale.
 */
@Component({
  selector: 'app-meal-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let m = item();
    <div class="menu">
      @for (it of dishes(); track $index) {
        @if (it.rid && it.exists) {
          <button type="button" class="dish" (click)="store.openItem('recipe', it.rid, undefined, true)">
            <span class="thumb" [style.background]="it.photo ? 'url(' + it.photo + ')' : store.grad(it.color)"
                  [style.background-size]="'cover'" [style.background-position]="'center'"></span>
            <span class="d-body"><span class="d-name">{{ it.name }}</span>@if (it.time) { <span class="d-sub">{{ it.time }}</span> }</span>
            <f-icon name="chevronRight" [size]="16" color="var(--ink3)" [width]="2.2" />
          </button>
        } @else {
          <div class="dish free">
            <span class="thumb plain"><f-icon name="edit" [size]="15" color="var(--ink3)" [width]="2.2" /></span>
            <span class="d-body"><span class="d-name">{{ it.name }}</span><span class="d-sub">{{ it.rid ? 'recette retirée du carnet' : 'intitulé libre' }}</span></span>
          </div>
        }
      }
    </div>

    @if (alerts().length) {
      <div class="alert"><f-icon name="urgent" [size]="16" color="var(--primary)" [width]="2.4" /> {{ store.alertLabel(alerts()) }}</div>
    }

    <div class="row">
      <span class="ic"><f-icon name="users" [size]="18" color="#9B6FA8" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ pax() }}</div>
        @if (m.value.pax) { <div class="sub">Posés à la main, pour des invités</div> }</div>
    </div>
    @if (event(); as ev) {
      <div class="row">
        <span class="ic"><f-icon name="calendar" [size]="18" color="#E56B4E" [width]="2.2" /></span>
        <div class="txt"><div class="main">À l’agenda{{ ev.time && ev.time !== '—' ? ' à ' + ev.time : '' }}</div></div>
      </div>
    }

    <button type="button" class="move-toggle" (click)="moving.set(!moving())" [attr.aria-expanded]="moving()">
      <f-icon name="arrowDown" [size]="15" color="var(--ink2)" [width]="2.2" /> Déplacer vers un autre créneau
      <f-icon [name]="moving() ? 'chevronDown' : 'chevronRight'" [size]="15" color="var(--ink3)" [width]="2.2" />
    </button>
    @if (moving()) {
      <div class="hint">Un créneau déjà occupé échange son repas avec celui-ci : rien n'est perdu.</div>
      @for (d of week(); track d) {
        <div class="mv-day">
          <div class="mv-date">{{ dayLabel(d) }}</div>
          @for (slot of store.mealSlots(); track slot.key) {
            @let cible = d + '-' + slot.key;
            @let occupe = store.mealNames(store.data()?.meals?.[cible]);
            <button type="button" class="mv-row" [disabled]="cible === m.key" (click)="move(cible)">
              <span class="dot" [style.background]="slot.dot"></span>
              <span class="mv-slot">{{ slot.short }}</span>
              <span class="mv-what">
                @if (cible === m.key) { <i>ici</i> }
                @else if (occupe.length) { {{ occupe.join(' · ') }} }
                @else { <i>libre</i> }
              </span>
              @if (occupe.length && cible !== m.key) { <span class="mv-swap">échange</span> }
            </button>
          }
        </div>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .menu { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
    .dish { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 12px; border: none; border-radius: 14px; background: var(--soft); font: inherit; text-align: left; cursor: pointer; }
    .dish.free { cursor: default; }
    .thumb { width: 46px; height: 46px; flex: none; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
    .thumb.plain { background: var(--surface); }
    .d-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .d-name { font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .d-sub { font-size: 12px; font-weight: 700; color: var(--ink2); }
    .alert { display: flex; align-items: center; gap: 8px; margin: 6px 0; padding: 9px 12px; border-radius: 12px; background: #FCE9E3; color: #C6492F; font-size: 12.5px; font-weight: 800; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; border-top: 1px solid var(--line); }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .txt { flex: 1; min-width: 0; }
    .main { font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .move-toggle { display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 6px; padding: 12px 0 8px; border: none; border-top: 1px solid var(--line); background: none; font: inherit; font-size: 13.5px; font-weight: 800; color: var(--ink2); cursor: pointer; text-align: left; }
    .move-toggle f-icon:last-child { margin-left: auto; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin-bottom: 10px; }
    .mv-day { margin-bottom: 12px; }
    .mv-date { font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
    .mv-row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 8px 10px; border: none; border-radius: 11px; background: none; font: inherit; text-align: left; cursor: pointer; }
    .mv-row + .mv-row { border-top: 1px solid var(--line); border-radius: 0; }
    .mv-row:hover:not([disabled]) { background: var(--soft); }
    .mv-row[disabled] { opacity: .5; cursor: default; }
    .dot { width: 8px; height: 8px; border-radius: 3px; flex: none; }
    .mv-slot { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; width: 38px; flex: none; }
    .mv-what { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .mv-what i { color: var(--ink3); font-style: normal; font-weight: 700; }
    .mv-swap { flex: none; font-size: 11px; font-weight: 800; color: var(--honey); text-transform: uppercase; }
  `],
})
export class MealView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<MealSlotRef>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly moving = signal(false);

  readonly dishes = computed(() => {
    const recipes = this.store.data()?.recipes || [];
    return this.item().value.items.map((it) => {
      const r = it.rid ? recipes.find((x) => x.id === it.rid) : undefined;
      return { rid: it.rid || '', exists: !!r, name: this.store.mealItemName(it), color: r?.color || '#7A9B76',
        photo: r ? this.store.photoUrl(r.photoId) : null, time: r ? this.store.recipeTime(r) : '' };
    });
  });
  readonly alerts = computed(() => this.store.mealAlerts(this.item().key));
  readonly pax = computed(() => { const m = this.item(); return paxLabel(this.store.presenceOf(m.dateStr, m.slot)); });
  readonly event = computed(() => this.store.mealEvent(this.item().key));
  /** Les créneaux proposés au déplacement : la semaine du repas. */
  readonly week = computed(() => this.store.weekDays(this.item().dateStr));
  dayLabel(d: string): string { const p = parseDay(d); return DOW[(p.getDay() + 6) % 7] + ' ' + p.getDate() + ' ' + p.toLocaleDateString(this.store.locale, { month: 'short' }); }

  /** Le repas part à son nouveau créneau, et la fiche le suit là-bas. */
  move(to: string): void {
    if (this.store.moveMealBetween(this.item().key, to)) this.store.openItem('meal', to);
  }
}
