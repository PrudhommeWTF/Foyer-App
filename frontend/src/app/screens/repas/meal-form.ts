import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { parseDay } from '../../core/helpers';
import { paxLabel } from '../../core/presence';
import { MealItem } from '../../core/models';
import { MealSlotRef, sameMeal } from '../../core/meals';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/**
 * Le formulaire d'un créneau de repas dans la fiche : les plats dans l'ordre
 * du service, des idées pour ce créneau, qui mange et pour combien. Le
 * brouillon vit ici : rien n'est écrit avant « Sauvegarder ».
 */
@Component({
  selector: 'app-meal-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="when">{{ when() }}</div>

    @if (items().length) {
      <div class="overline menu-t">Au menu</div>
      <div class="menu">
        @for (it of items(); track $index; let i = $index) {
          <div class="menu-row">
            <span class="menu-n">{{ i + 1 }}</span>
            <span class="menu-name">{{ store.mealItemName(it) }}</span>
            @if (!it.rid) { <span class="menu-free">libre</span> }
            <button type="button" class="icon-btn sm" (click)="removeItem(i)" [attr.aria-label]="'Retirer ' + store.mealItemName(it)">
              <f-icon name="minus" [size]="16" color="var(--ink2)" />
            </button>
          </div>
        }
      </div>
    } @else {
      <div class="menu-empty">Aucun plat choisi. Touchez une recette ci-dessous, ou ajoutez un intitulé libre.</div>
    }

    @let sugg = suggestions();
    @if (sugg && !items().length && (sugg.suggestions.length || sugg.excluded.length)) {
      <div class="sugg">
        <button type="button" class="sugg-head" (click)="suggestOpen.set(!suggestOpen())">
          <f-icon name="bolt" [size]="16" color="var(--sage)" [width]="2.2" />
          <span>Des idées pour ce créneau</span>
          <f-icon [name]="suggestOpen() ? 'chevronDown' : 'chevronRight'" [size]="16" color="var(--ink3)" [width]="2.2" />
        </button>
        @if (suggestOpen()) {
          @for (sg of sugg.suggestions; track sg.recipe.id) {
            <button type="button" class="sugg-row" (click)="toggleRecipe(sg.recipe.id)">
              <span class="sugg-name">{{ sg.recipe.name }}</span>
              <span class="sugg-why">{{ sg.reasons.join(' · ') || 'rien à signaler' }}</span>
            </button>
          } @empty {
            <div class="sugg-none">Tout le carnet est soit servi récemment, soit écarté ci-dessous.</div>
          }
          @if (sugg.excluded.length) {
            <div class="sugg-out"><b>{{ sugg.excluded.length }}</b> recette(s) écartée(s) : elles ne conviennent pas à {{ excludedWho() }}.</div>
          }
          @if (sugg.recent) {
            <div class="sugg-out">{{ sugg.recent }} recette(s) servie(s) ces quinze derniers jours ne sont pas proposées.</div>
          }
        }
      </div>
    }

    <div class="field-label">Convives</div>
    @if (store.d().members.length) {
      <div class="guests">
        @for (mb of store.d().members; track mb.id) {
          @let absent = away().includes(mb.id);
          <button type="button" class="guest" [class.off]="absent" (click)="toggleGuest(mb.id)"
                  [title]="absent ? mb.name + ' ne mange pas ici' : mb.name + ' est attendu'">
            <span class="g-dot" [style.background]="absent ? 'transparent' : mb.color"></span>{{ mb.name }}
          </button>
        }
      </div>
    }
    <div class="pax-row">
      <input class="input pax" type="number" inputmode="numeric" min="1" max="30"
             [ngModel]="pax()" (ngModelChange)="pax.set($event === null || $event === undefined ? '' : '' + $event)" [placeholder]="presence().pax + ''" />
      <span class="pax-hint">{{ paxText() }}. Les quantités de la liste de courses suivent ce nombre ; posez-en un autre pour des invités.</span>
    </div>

    <div class="field-label">Ajouter un intitulé libre</div>
    <div class="free-row">
      <input class="input" [ngModel]="text()" (ngModelChange)="text.set($event)" (keydown.enter)="addText()" placeholder="Ex : Restaurant, restes, pique-nique…" />
      <button type="button" class="btn btn-soft" (click)="addText()">Ajouter</button>
    </div>

    <div class="overline menu-t">Recettes du carnet</div>
    <div class="recipe-grid">
      @for (r of store.d().recipes; track r.id) {
        <div class="recipe-card" [class.sel]="hasRecipe(r.id)" (click)="toggleRecipe(r.id)">
          @let th = store.photoUrl(r.photoId);
          <div class="thumb" [style.background]="th ? 'url(' + th + ')' : store.grad(r.color)" [style.background-size]="'cover'" [style.background-position]="'center'"></div>
          <div class="rc-body">
            <div class="rc-name">{{ r.name }}</div>
            <div class="rc-time">{{ store.recipeTime(r) }}{{ r.portions ? ' · ' + r.portions + ' pers.' : '' }}</div>
          </div>
          @if (hasRecipe(r.id)) { <f-icon name="check" [size]="16" color="var(--primary)" [width]="3" /> }
        </div>
      } @empty {
        <div class="muted">Aucune recette dans le carnet.</div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; container-type: inline-size; }
    .when { font-size: 13.5px; font-weight: 800; color: var(--ink2); margin-bottom: 8px; }
    .menu-t { display: block; margin: 16px 0 10px; }
    .menu { display: flex; flex-direction: column; gap: 8px; }
    .menu-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 13px; background: var(--soft); }
    .menu-n { width: 22px; height: 22px; flex: none; border-radius: 50%; background: var(--primary); color: #fff; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .menu-name { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .menu-free { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; flex: none; }
    .menu-empty { font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.45; padding: 12px 0 4px; }
    .sugg { border: 2px solid var(--line2); border-radius: 14px; margin: 16px 0 4px; overflow: hidden; }
    .sugg-head { display: flex; align-items: center; gap: 9px; width: 100%; border: none; background: var(--soft); padding: 11px 13px; cursor: pointer; font-family: var(--font-body); font-size: 13.5px; font-weight: 800; color: var(--ink); text-align: left; }
    .sugg-head span { flex: 1; }
    .sugg-row { display: flex; flex-direction: column; gap: 2px; width: 100%; border: none; background: none; border-top: 1px solid var(--line); padding: 10px 13px; cursor: pointer; text-align: left; font-family: var(--font-body); }
    .sugg-row:hover { background: var(--soft); }
    .sugg-name { font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .sugg-why { font-size: 12px; font-weight: 700; color: var(--sage); }
    .sugg-none, .sugg-out { border-top: 1px solid var(--line); padding: 10px 13px; font-size: 12px; font-weight: 600; color: var(--ink2); line-height: 1.45; }
    .sugg-out b { color: var(--ink); }
    .field-label { margin-top: 18px; }
    .guests { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
    .guest { display: inline-flex; align-items: center; gap: 6px; border: 2px solid var(--line2); background: transparent; border-radius: 11px; padding: 6px 11px; font-family: var(--font-body); font-size: 13px; font-weight: 800; color: var(--ink); cursor: pointer; }
    .guest.off { color: var(--ink3); text-decoration: line-through; }
    .g-dot { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--line2); }
    .pax-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .pax { width: 120px; flex: none; }
    .pax-hint { flex: 1; min-width: 180px; font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; }
    .free-row { display: flex; gap: 10px; margin-bottom: 4px; }
    .free-row .input { flex: 1; min-width: 0; }
    .recipe-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @container (max-width: 420px) { .recipe-grid { grid-template-columns: 1fr; } }
    .recipe-card { display: flex; align-items: center; gap: 11px; padding: 11px; border-radius: 14px; cursor: pointer; background: var(--soft); border: 2px solid transparent; }
    .recipe-card.sel { background: rgba(229,107,78,.12); border-color: var(--primary); }
    .recipe-card.sel .rc-name { color: var(--primary); }
    .thumb { width: 40px; height: 40px; flex: none; border-radius: 11px; }
    .rc-body { flex: 1; min-width: 0; }
    .rc-name { font-weight: 800; font-size: 13.5px; color: var(--ink); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rc-time { font-size: 11.5px; font-weight: 700; color: var(--ink2); }
    .muted { color: var(--ink3); font-weight: 700; font-size: 13.5px; }
  `],
})
export class MealForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  /** Le créneau garni, ou null pour en garnir un vide (`ctx.date` et `ctx.slot`). */
  readonly item = input<MealSlotRef | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);

  readonly items = signal<MealItem[]>([]);
  readonly text = signal('');
  readonly pax = signal('');
  readonly away = signal<string[]>([]);
  readonly suggestOpen = signal(false);
  private readonly where = signal<{ dateStr: string; slot: string }>({ dateStr: '', slot: '' });

  ngOnInit(): void {
    const m = this.item(), c = this.ctx();
    const v = m?.value;
    this.where.set(m ? { dateStr: m.dateStr, slot: m.slot } : { dateStr: c?.date || this.store.todayStr(), slot: c?.slot || 'soir' });
    this.items.set((v?.items || []).map((i) => ({ ...i })));
    this.pax.set(v?.pax ? String(v.pax) : '');
    this.away.set([...(v?.away || [])]);
  }

  private readonly key = computed(() => this.where().dateStr + '-' + this.where().slot);
  private readonly value = computed(() => this.store.mealFromForm(this.where().dateStr, this.where().slot, this.items(), this.pax(), this.away()));
  readonly dirty = computed(() => !sameMeal(this.item()?.value, this.value()) || !!this.text().trim());

  submit(): ItemResult { return this.store.saveMeal(this.key(), this.value()); }

  readonly when = computed(() => {
    const w = this.where();
    const slot = this.store.mealSlots().find((s) => s.key === w.slot)?.label || '';
    return w.dateStr ? slot + ', ' + parseDay(w.dateStr).toLocaleDateString(this.store.locale, { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  });
  /** Ce qu'on pourrait mettre dans ce créneau : calculé une fois par ouverture, le carnet entier y passe. */
  readonly suggestions = computed(() => { const w = this.where(); return w.dateStr ? this.store.mealSuggestions(w.dateStr, w.slot) : null; });
  /** Qui bloque les recettes écartées : combien, et pour qui, plutôt qu'un mur de titres. */
  readonly excludedWho = computed(() => [...new Set((this.suggestions()?.excluded || []).flatMap((e) => e.why.split(', ')))].join(', '));
  /** Convives attendus, semaine type et absences saisies ici comprises. */
  readonly presence = computed(() => this.store.presenceWith(this.where().dateStr, this.where().slot, this.away()));
  readonly paxText = computed(() => paxLabel(this.presence()));

  hasRecipe(rid: string): boolean { return this.items().some((x) => x.rid === rid); }
  /** Un tap sur une recette l'ajoute au menu, un second l'en retire. */
  toggleRecipe(rid: string): void {
    this.items.update((items) => { const i = items.findIndex((x) => x.rid === rid); return i >= 0 ? items.filter((_, k) => k !== i) : [...items, { rid }]; });
  }
  removeItem(index: number): void { this.items.update((items) => items.filter((_, i) => i !== index)); }
  addText(): void { const t = this.text().trim(); if (!t) return; this.items.update((items) => [...items, { text: t }]); this.text.set(''); }
  /** Un tap sur un convive le retire du créneau, un second l'y remet. */
  toggleGuest(id: string): void { this.away.update((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id])); }
}
