import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { paxLabel } from '../core/presence';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { MEAL_SLOTS, DOW } from '../core/constants';
import { dstr, parseDay } from '../core/helpers';
import { MealValue } from '../core/models';
import { CopyReport, planMealCopy } from '../core/meal-copy';

/** Largeur en deçà de laquelle la semaine se lit en pile plutôt qu'en grille. */
const GRID_MIN = 760;

@Component({
  selector: 'screen-repas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <div class="head-bar">
        <div class="nav">
          <button class="icon-btn" (click)="nav(-1)" [attr.aria-label]="view() === '3' ? 'Trois jours précédents' : 'Semaine précédente'">
            <f-icon name="chevronLeft" [size]="18" [color]="'var(--ink2)'" [width]="2.2" />
          </button>
          <div class="nav-label">
            <div class="week-label f-display">{{ rangeLabel() }}</div>
            <div class="week-tag" [style.color]="rangeTagColor()">{{ rangeTag() }}</div>
          </div>
          <button class="icon-btn" (click)="nav(1)" [attr.aria-label]="view() === '3' ? 'Trois jours suivants' : 'Semaine suivante'">
            <f-icon name="chevronRight" [size]="18" [color]="'var(--ink2)'" [width]="2.2" />
          </button>
          @if (!showsToday()) {
            <button class="btn btn-soft sm" (click)="goToday()">Aujourd'hui</button>
          }
        </div>
        <div class="head-right">
          <div class="seg2">
            <button [class.active]="view() === '3'" (click)="setView('3')">3 jours</button>
            <button [class.active]="view() === 'week'" (click)="setView('week')">Semaine</button>
          </div>
          <button class="btn btn-soft dup-btn" (click)="openDup()">
            <f-icon name="copy" [size]="17" color="var(--ink2)" [width]="2" /> Recopier
          </button>
          <button class="btn btn-sage" (click)="store.prepareList(days())">
            <f-icon name="bolt" [size]="20" color="#fff" [width]="2" />
            {{ view() === '3' ? 'Courses de ces 3 jours' : 'Courses de la semaine' }}
          </button>
        </div>
      </div>

      @if (!wide()) {
        <!-- Sur téléphone, la grille 7 x 2 imposait 900 px de large et défilait
             horizontalement : illisible d'une main. La semaine devient une pile
             de jours, chaque créneau une ligne pleine largeur. -->
        <div class="days">
          @for (d of days(); track d) {
            <div class="day" [class.today]="isToday(d)" [class.past]="isPast(d)">
              <div class="day-head">
                <span class="day-dow">{{ dowOf(d) }}</span>
                <span class="day-num f-display">{{ dayNum(d) }}</span>
                <span class="day-month">{{ monthOf(d) }}</span>
                @if (isToday(d)) { <span class="day-today">Aujourd'hui</span> }
              </div>
              @for (slot of store.mealSlots(); track slot.key) {
                @let meal = mealAt(d, slot.key);
                @let names = store.mealNames(meal);
                <button class="srow" [class.filled]="names.length > 0" (click)="store.editMeal(d, slot.key)">
                  <span class="dot" [style.background]="slot.dot"></span>
                  <span class="srow-slot">{{ slot.short }}</span>
                  <span class="srow-body">
                    @if (names.length) {
                      @for (n of names; track $index) { <span class="srow-name">{{ n }}</span> }
                    } @else {
                      <span class="srow-empty">Libre</span>
                    }
                  </span>
                  @let alertes = store.mealAlerts(d + '-' + slot.key);
                  @if (alertes.length) {
                    <span class="srow-alert" [title]="store.alertLabel(alertes)">
                      <f-icon name="urgent" [size]="15" color="var(--primary)" [width]="2.4" />
                      {{ alertes.length > 1 ? alertes.length : alertes[0].name }}
                    </span>
                  }
                  @if (meal?.pax) { <span class="srow-pax">{{ meal!.pax }} couv.</span> }
                  <f-icon name="chevronRight" [size]="16" color="var(--ink3)" [width]="2.2" />
                </button>
              }
            </div>
          }
        </div>
      } @else {
        <div class="grid-scroll">
          <div class="grid" [style.grid-template-columns]="gridCols()" [style.min-width.px]="gridMin()" [style.max-width.px]="gridMax()">
            <div class="corner"></div>
            @for (d of days(); track d) {
              <div class="dhead" [class.today]="isToday(d)">
                <div class="dow">{{ dowOf(d) }}</div>
                <div class="dnum f-display">{{ dayNum(d) }}</div>
              </div>
            }

            @for (slot of store.mealSlots(); track slot.key) {
              <div class="rlabel">
                <span class="rlabel-txt">{{ slot.label }}</span>
              </div>
              @for (d of days(); track d) {
                @let meal = mealAt(d, slot.key);
                @let names = store.mealNames(meal);
                <div class="cell" [class.filled]="names.length > 0" [class.today]="isToday(d)"
                   [class.drop]="dragOver() === d + '-' + slot.key"
                   [attr.draggable]="names.length > 0"
                   (dragstart)="onDragStart($event, d + '-' + slot.key)"
                   (dragover)="onDragOver($event, d + '-' + slot.key)"
                   (dragleave)="dragOver.set('')"
                   (drop)="onDrop($event, d + '-' + slot.key)"
                   (dragend)="dragOver.set('')"
                   (click)="store.editMeal(d, slot.key)">
                  <div class="cell-top">
                    <span class="dot" [style.background]="slot.dot"></span>
                    <span class="cell-slot">{{ slot.short }}</span>
                  </div>
                  @if (names.length) {
                    @for (n of names; track $index) {
                      <div class="cell-name">{{ n }}</div>
                    }
                    @let alertes = store.mealAlerts(d + '-' + slot.key);
                    @if (alertes.length) {
                      <div class="cell-alert" [title]="store.alertLabel(alertes)">
                        <f-icon name="urgent" [size]="13" color="var(--primary)" [width]="2.6" />
                        {{ store.alertLabel(alertes) }}
                      </div>
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
      }
    </div>

    @if (store.ui().moveOpen && store.ui().mealEdit) {
      <f-modal title="Déplacer vers" [maxWidth]="480" (close)="store.patch({ moveOpen: false })">
        <div class="hint mb">Un créneau déjà occupé échange son repas avec celui-ci : rien n'est perdu.</div>
        @for (d of days(); track d) {
          <div class="mv-day">
            <div class="mv-date">{{ dowOf(d) }} {{ dayNum(d) }} {{ monthOf(d) }}</div>
            @for (slot of store.mealSlots(); track slot.key) {
              @let cible = d + '-' + slot.key;
              @let occupe = store.mealNames(mealAt(d, slot.key));
              <button class="mv-row" [disabled]="cible === courant()" (click)="store.moveMealTo(cible)">
                <span class="dot" [style.background]="slot.dot"></span>
                <span class="mv-slot">{{ slot.short }}</span>
                <span class="mv-what">
                  @if (cible === courant()) { <i>ici</i> }
                  @else if (occupe.length) { {{ occupe.join(' · ') }} }
                  @else { <i>libre</i> }
                </span>
                @if (occupe.length && cible !== courant()) { <span class="mv-swap">échange</span> }
              </button>
            }
          </div>
        }
      </f-modal>
    }

    @if (store.ui().dupOpen) {
      <f-modal title="Recopier des repas ici" [maxWidth]="520" (close)="store.patch({ dupOpen: false })">
        <div class="hint mb">Les repas seront recopiés sur <b>{{ targetLabel() }}</b>.</div>

        <div class="field-label">Depuis</div>
        <div class="dup-list mb">
          @for (c of dupSources(); track c.back) {
            <button class="dup-row" [class.on]="store.ui().dupBack === c.back" [disabled]="!c.plats"
                    (click)="store.patch({ dupBack: c.back })">
              <span class="dup-when">{{ c.label }}</span>
              <span class="dup-count">{{ c.plats ? c.plats + ' repas' : 'vide' }}</span>
            </button>
          }
        </div>

        <div class="field-label">Comment</div>
        <div class="seg-wrap">
          <div class="seg-opt" [class.on]="store.ui().dupMode === 'fill'" (click)="store.patch({ dupMode: 'fill' })">Compléter</div>
          <div class="seg-opt" [class.on]="store.ui().dupMode === 'replace'" (click)="store.patch({ dupMode: 'replace' })">Remplacer</div>
        </div>

        @let rep = dupReport();
        <div class="dup-bilan" [class.warn]="rep.cleared.length > 0">
          @if (rep.sourceEmpty) {
            <div>Cette période ne contient aucun repas : il n'y a rien à recopier.</div>
          } @else if (!rep.writes.length && !rep.cleared.length) {
            <div>Rien à changer : ces repas sont déjà en place.</div>
          } @else {
            @if (rep.writes.length) { <div>{{ phrase(rep.writes.length, 'repas sera recopié', 'repas seront recopiés') }}.</div> }
            @if (rep.kept.length) { <div>{{ phrase(rep.kept.length, 'créneau déjà garni sera laissé tel quel', 'créneaux déjà garnis seront laissés tels quels') }}.</div> }
            @if (rep.cleared.length) {
              <div>{{ phrase(rep.cleared.length, 'créneau déjà garni sera écrasé ou vidé', 'créneaux déjà garnis seront écrasés ou vidés') }}. C'est définitif.</div>
            }
          }
        </div>

        <div class="modal-actions">
          <button class="btn btn-soft grow" (click)="store.patch({ dupOpen: false })">Annuler</button>
          <button class="btn grow2" [class.btn-primary]="!rep.cleared.length" [class.btn-danger]="rep.cleared.length > 0"
                  [disabled]="rep.sourceEmpty" (click)="store.copyMeals(rep)">
            {{ rep.cleared.length ? 'Recopier et écraser' : 'Recopier' }}
          </button>
        </div>
      </f-modal>
    }

    <!-- Masquée pendant le choix du créneau : deux modales empilées se recouvrent,
         et les clics partent dans celle du dessus. -->
    @if (store.ui().mealEdit; as me) {
      @if (!store.ui().moveOpen) {
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

        @let sugg = store.suggestions();
        @if (sugg && !store.ui().mealItems.length && (sugg.suggestions.length || sugg.excluded.length)) {
          <div class="sugg">
            <button class="sugg-head" (click)="store.patch({ mealSuggest: !store.ui().mealSuggest })">
              <f-icon name="bolt" [size]="16" color="var(--sage)" [width]="2.2" />
              <span>Des idées pour ce créneau</span>
              <f-icon [name]="store.ui().mealSuggest ? 'chevronDown' : 'chevronRight'" [size]="16" color="var(--ink3)" [width]="2.2" />
            </button>
            @if (store.ui().mealSuggest) {
              @for (sg of sugg.suggestions; track sg.recipe.id) {
                <button class="sugg-row" (click)="store.toggleMealRecipe(sg.recipe.id)">
                  <span class="sugg-name">{{ sg.recipe.name }}</span>
                  <span class="sugg-why">{{ sg.reasons.join(' · ') || 'rien à signaler' }}</span>
                </button>
              } @empty {
                <div class="sugg-none">Tout le carnet est soit servi récemment, soit écarté ci-dessous.</div>
              }
              @if (sugg.excluded.length) {
                <div class="sugg-out">
                  <b>{{ sugg.excluded.length }}</b> recette(s) écartée(s) : elles ne conviennent pas à {{ excludedWho() }}.
                </div>
              }
              @if (sugg.recent) {
                <div class="sugg-out">{{ sugg.recent }} recette(s) servie(s) ces quinze derniers jours ne sont pas proposées.</div>
              }
            }
          </div>
        }

        <div class="field-label">Convives</div>
        @if (d().members.length) {
          <div class="guests">
            @for (m of d().members; track m.id) {
              @let absent = store.ui().mealAway.includes(m.id);
              <button class="guest" [class.off]="absent" (click)="store.toggleMealGuest(m.id)"
                      [title]="absent ? m.name + ' ne mange pas ici' : m.name + ' est attendu'">
                <span class="g-dot" [style.background]="absent ? 'transparent' : m.color"></span>{{ m.name }}
              </button>
            }
          </div>
        }
        <div class="pax-row">
          <input class="input pax" type="number" inputmode="numeric" min="1" max="30"
                 [ngModel]="store.ui().mealPax" (ngModelChange)="store.patch({ mealPax: $event })"
                 [placeholder]="attendus() + ''" />
          <span class="pax-hint">
            {{ paxText() }}. Les quantités de la liste de courses suivent ce nombre ; posez-en un autre pour des invités.
          </span>
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
          @if (store.ui().mealItems.length) {
            <button class="btn btn-soft" (click)="store.patch({ moveOpen: true })">
              <f-icon name="arrowDown" [size]="16" color="var(--ink2)" [width]="2" /> Déplacer
            </button>
            <button class="btn btn-soft" (click)="store.addMealToCalendar()">
              <f-icon name="calendar" [size]="16" color="var(--ink2)" [width]="2" />
              {{ dejaAgenda() ? 'Mettre à jour l’agenda' : 'À l’agenda' }}
            </button>
          }
          <div class="spacer"></div>
          <button class="btn btn-primary" (click)="store.saveMeal()">Enregistrer</button>
        </div>
      </f-modal>
      }
    }
  `,
  styles: [`
    /* Sans cela, l'hôte reste « inline » : sa largeur mesurée vaut zéro, et la
       bascule grille/pile choisissait toujours la pile, y compris sur écran large. */
    :host { display: block; }

    .pax-row { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
    .pax { width: 120px; flex: none; }
    .pax-hint { flex: 1; min-width: 180px; font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; }

    .head-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; flex-wrap: wrap; }
    .nav { display: flex; align-items: center; gap: 12px; }
    .head-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .seg2 { display: flex; gap: 3px; background: var(--soft); border-radius: 12px; padding: 4px; flex: none; }
    .seg2 button { padding: 7px 13px; border: none; background: transparent; border-radius: 9px; font-size: 12.5px; font-weight: 800; color: var(--ink2); cursor: pointer; font-family: inherit; }
    .seg2 button.active { background: var(--surface); color: var(--ink); box-shadow: 0 4px 10px -6px rgba(90,60,40,.5); }
    .nav-label { text-align: center; min-width: 230px; }
    .week-label { font-size: 19px; font-weight: 700; color: var(--ink); }
    .week-tag { font-size: 12.5px; font-weight: 700; }

    /* Ces classes viennent des autres écrans, où elles sont définies localement :
       les styles d'un composant Angular ne franchissent pas ses frontières. */
    .hint { font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.45; }
    .mb { margin-bottom: 18px; }
    .seg-wrap { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
    .seg-opt { display: flex; align-items: center; gap: 7px; padding: 11px 15px; border-radius: 11px; font-size: 13.5px; font-weight: 800; cursor: pointer; background: var(--soft2); color: var(--ink2); border: 2px solid transparent; }
    .seg-opt.on { background: var(--primary); color: #fff; }
    .modal-actions { display: flex; gap: 12px; align-items: center; }
    .modal-actions .grow { flex: 1; }
    .modal-actions .grow2 { flex: 1.4; }

    /* Le créneau visé s'éclaire pendant le survol : sans retour visuel, on lâche
       le repas au jugé. */
    .cell.drop { border-color: var(--primary); background: rgba(229,107,78,.1); }
    .sugg { border: 2px solid var(--line2); border-radius: 14px; margin: 16px 0 4px; overflow: hidden; }
    .sugg-head { display: flex; align-items: center; gap: 9px; width: 100%; border: none; background: var(--soft); padding: 11px 13px; cursor: pointer; font-family: var(--font-body); font-size: 13.5px; font-weight: 800; color: var(--ink); text-align: left; }
    .sugg-head span { flex: 1; }
    .sugg-row { display: flex; flex-direction: column; gap: 2px; width: 100%; border: none; background: none; border-top: 1px solid var(--line); padding: 10px 13px; cursor: pointer; text-align: left; font-family: var(--font-body); }
    .sugg-row:hover { background: var(--soft); }
    .sugg-name { font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .sugg-why { font-size: 12px; font-weight: 700; color: var(--sage); }
    .sugg-none, .sugg-out { border-top: 1px solid var(--line); padding: 10px 13px; font-size: 12px; font-weight: 600; color: var(--ink2); line-height: 1.45; }
    .sugg-out b { color: var(--ink); }
    .guests { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
    .guest { display: inline-flex; align-items: center; gap: 6px; border: 2px solid var(--line2); background: transparent; border-radius: 11px; padding: 6px 11px; font-family: var(--font-body); font-size: 13px; font-weight: 800; color: var(--ink); cursor: pointer; }
    .guest.off { color: var(--ink3); text-decoration: line-through; }
    .g-dot { width: 9px; height: 9px; border-radius: 50%; border: 2px solid var(--line2); }
    .cell-alert { display: flex; align-items: flex-start; gap: 5px; margin-top: 6px; font-size: 11px; font-weight: 800; color: var(--primary); line-height: 1.35; overflow-wrap: anywhere; }
    .srow-alert { display: inline-flex; align-items: center; gap: 4px; flex: none; font-size: 11.5px; font-weight: 800; color: var(--primary); }
    .cell[draggable=true] { cursor: grab; }

    .mv-day { margin-bottom: 14px; }
    .mv-date { font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
    .mv-row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 46px; padding: 8px 10px; border: none; border-radius: 11px; background: none; font: inherit; text-align: left; cursor: pointer; }
    .mv-row + .mv-row { border-top: 1px solid var(--line); border-radius: 0; }
    .mv-row:hover:not([disabled]) { background: var(--soft); }
    .mv-row[disabled] { opacity: .5; cursor: default; }
    .mv-slot { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; width: 38px; flex: none; }
    .mv-what { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .mv-what i { color: var(--ink3); font-style: normal; font-weight: 700; }
    .mv-swap { flex: none; font-size: 11px; font-weight: 800; color: var(--honey); text-transform: uppercase; }

    .dup-btn { flex: none; gap: 7px; }
    .dup-list { display: flex; flex-direction: column; gap: 8px; }
    .dup-row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 10px 13px; border-radius: 13px; border: 2px solid transparent; background: var(--soft); font: inherit; cursor: pointer; text-align: left; }
    .dup-row.on { background: rgba(229,107,78,.12); border-color: var(--primary); }
    .dup-row[disabled] { opacity: .45; cursor: default; }
    .dup-when { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .dup-count { font-size: 12.5px; font-weight: 800; color: var(--ink3); flex: none; }
    .dup-bilan { background: var(--soft); border-radius: 13px; padding: 12px 14px; font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.55; margin-bottom: 18px; }
    .dup-bilan.warn { background: #FCE9E3; color: #C6492F; }
    .dup-bilan b { color: inherit; }

    /* ---- semaine en pile, sur téléphone ---- */
    .days { display: flex; flex-direction: column; gap: 14px; }
    .day { background: var(--surface); border-radius: var(--r-card); padding: 10px 12px 6px; box-shadow: 0 12px 28px -20px rgba(90,60,40,.5); }
    .day.today { border: 2px solid var(--honey); padding: 8px 10px 4px; }
    /* Un jour passé reste consultable, mais cesse de tirer l'œil. */
    .day.past { opacity: .55; }
    .day-head { display: flex; align-items: baseline; gap: 7px; padding: 2px 2px 6px; }
    .day-dow { font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .04em; }
    .day-num { font-size: 20px; font-weight: 700; color: var(--ink); }
    .day-month { font-size: 12.5px; font-weight: 700; color: var(--ink3); }
    .day.today .day-dow, .day.today .day-num, .day.today .day-month { color: #D9930F; }
    .day-today { margin-left: auto; font-size: 11px; font-weight: 800; color: #D9930F; text-transform: uppercase; letter-spacing: .04em; }

    /* La ligne fait 52 px : elle se vise au pouce, comme une ligne de courses. */
    .srow { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 9px 2px; border: none; background: none; font: inherit; text-align: left; cursor: pointer; }
    .srow + .srow { border-top: 1px solid var(--line); }
    .srow-slot { font-size: 10.5px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .04em; width: 38px; flex: none; }
    .srow-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .srow-name { font-size: 14.5px; font-weight: 800; color: var(--ink); line-height: 1.25; overflow-wrap: anywhere; }
    .srow-name ~ .srow-name { font-size: 13.5px; font-weight: 700; color: var(--ink2); }
    .srow-empty { font-size: 13.5px; font-weight: 700; color: var(--ink3); }
    .srow-pax { font-size: 11px; font-weight: 800; color: var(--sage); flex: none; }

    .grid-scroll { overflow-x: auto; }
    /* La grille ne s'affiche plus qu'au-dessus de 860 px, la pile prenant le
       relais en dessous : les colonnes sont dimensionnées pour tenir dans une
       fenêtre de portable, barre latérale comprise, sans défilement latéral. */
    .grid { display: grid; gap: 10px; align-items: stretch; }
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
    /* Sur téléphone, la barre passe sur deux lignes plutôt que de comprimer le
       libellé de semaine, et le bouton devient une cible pleine largeur. */
    :host-context(.shell.narrow) .head-bar { gap: 12px; margin-bottom: 16px; }
    :host-context(.shell.narrow) .nav { width: 100%; justify-content: space-between; flex-wrap: wrap; }
    :host-context(.shell.narrow) .nav-label { min-width: 0; flex: 1; }
    :host-context(.shell.narrow) .head-right { width: 100%; gap: 10px; }
    :host-context(.shell.narrow) .seg2 { flex: 1; }
    :host-context(.shell.narrow) .seg2 button { flex: 1; }
    :host-context(.shell.narrow) .head-bar .btn-sage { width: 100%; justify-content: center; }
  `],
})
export class RepasScreen implements AfterViewInit, OnDestroy {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;
  private host = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;

  /**
   * Vrai quand la grille tient sans défilement latéral. La bascule se décide sur
   * la largeur réellement disponible et non sur celle de la fenêtre : entre 900
   * et 1100 px, la barre latérale prend la place, et la grille défilait encore.
   */
  readonly wide = signal(false);

  ngAfterViewInit(): void {
    const el = this.host.nativeElement as HTMLElement;
    const measure = (w: number): void => this.wide.set(w >= GRID_MIN);
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver((e) => measure(e[0].contentRect.width));
      this.ro.observe(el);
    }
    measure(el.clientWidth || window.innerWidth);
  }
  ngOnDestroy(): void { this.ro?.disconnect(); }

  constructor() {
    // En pile, la fenêtre qui contient aujourd'hui s'ouvre sur le jour même :
    // « qu'est-ce qu'on mange ce soir » ne doit pas demander de faire défiler
    // les jours révolus. Sans objet en vue 3 jours, qui commence sur le jour.
    effect(() => {
      const aRecentrer = this.view() === 'week' && !this.wide() && this.showsToday();
      void this.days();
      if (!aRecentrer) return;
      setTimeout(() => {
        const el = (this.host.nativeElement as HTMLElement).querySelector('.day.today');
        el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  }

  /**
   * Vue effective. Le réglage est vide tant que l'utilisateur n'a rien choisi :
   * trois jours tiennent sur un écran de téléphone, la semaine demande d'en
   * faire défiler deux ; sur grand écran la semaine entière se lit d'un coup.
   */
  view = computed<'3' | 'week'>(() => this.store.ui().mealView || (this.wide() ? 'week' : '3'));

  /** Jours affichés, du plus ancien au plus récent. */
  days = computed<string[]>(() => {
    const anchor = this.store.ui().mealAnchor || this.store.todayStr();
    if (this.view() === 'week') return this.store.weekDays(anchor);
    const a = parseDay(anchor);
    return [0, 1, 2].map((n) => { const d = new Date(a); d.setDate(a.getDate() + n); return dstr(d); });
  });

  showsToday = computed(() => this.days().includes(this.store.todayStr()));

  rangeLabel = computed(() => {
    const w = this.days();
    const [a, b] = [w[0], w[w.length - 1]];
    // « Du 21 au 23 août » plutôt que de répéter le mois quand il est le même.
    const debut = a.slice(0, 7) === b.slice(0, 7) ? String(parseDay(a).getDate()) : this.fmt(a);
    return (this.view() === 'week' ? 'Semaine du ' : 'Du ') + debut + ' au ' + this.fmt(b);
  });

  rangeTag = computed(() => {
    if (this.showsToday()) return this.view() === 'week' ? 'Cette semaine' : "À partir d'aujourd'hui";
    const ecart = Math.round((parseDay(this.days()[0]).getTime() - parseDay(this.store.todayStr()).getTime()) / 86400000);
    if (ecart > 0) return 'Dans ' + ecart + (ecart > 1 ? ' jours' : ' jour');
    return 'Il y a ' + -ecart + (ecart < -1 ? ' jours' : ' jour');
  });

  rangeTagColor = computed(() => (this.showsToday() ? '#D9930F' : 'var(--ink2)'));

  /** La grille suit le nombre de jours : trois colonnes larges, ou sept serrées. */
  gridCols = computed(() => '56px repeat(' + this.days().length + ', minmax(84px, 1fr))');
  gridMin = computed(() => (this.view() === 'week' ? 724 : 0));
  /** Trois colonnes n'ont rien à gagner à s'étaler sur un écran de 27 pouces. */
  gridMax = computed(() => (this.view() === 'week' ? null : 820));

  /** Périodes candidates à la recopie : les quatre précédentes, de même longueur. */
  dupSources = computed(() => {
    const meals = this.d().meals;
    const slots = this.store.mealSlots().map((s) => s.key);
    return [1, 2, 3, 4].map((back) => {
      const days = this.shifted(back);
      const plats = days.reduce((n, j) => n + slots.filter((s) => meals[j + '-' + s]?.items?.length).length, 0);
      return { back, plats, label: this.periodLabel(days, back) };
    });
  });

  dupReport = computed<CopyReport>(() => planMealCopy(
    this.d().meals,
    this.shifted(this.store.ui().dupBack),
    this.days(),
    this.store.mealSlots().map((s) => s.key),
    this.store.ui().dupMode,
  ));

  openDup(): void { this.store.patch({ dupOpen: true, dupBack: 1, dupMode: 'fill' }); }

  /** Créneau en cours d'édition, pour le griser dans la liste des destinations. */
  courant = computed(() => {
    const e = this.store.ui().mealEdit;
    return e ? e.dateStr + '-' + e.slot : '';
  });

  /** Créneau survolé pendant un glisser-déposer, pour l'éclairer. */
  readonly dragOver = signal('');
  private dragged = '';

  onDragStart(ev: DragEvent, key: string): void {
    this.dragged = key;
    // Le type est exigé par Firefox, qui refuse le glisser sans données.
    ev.dataTransfer?.setData('text/plain', key);
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }

  onDragOver(ev: DragEvent, key: string): void {
    if (!this.dragged || this.dragged === key) return;
    ev.preventDefault();
    this.dragOver.set(key);
  }

  onDrop(ev: DragEvent, key: string): void {
    ev.preventDefault();
    const from = this.dragged || ev.dataTransfer?.getData('text/plain') || '';
    this.dragOver.set('');
    this.dragged = '';
    if (from && from !== key) this.store.moveMealBetween(from, key);
  }

  /** « 1 repas sera recopié », « 3 repas seront recopiés » : l'accord se voit. */
  phrase(n: number, un: string, plusieurs: string): string { return n + ' ' + (n > 1 ? plusieurs : un); }

  /** La période visée, nommée pour se lire au milieu d'une phrase. */
  targetLabel = computed(() => {
    const w = this.days();
    const bornes = this.fmt(w[0]) + ' au ' + this.fmt(w[w.length - 1]);
    return this.view() === 'week' ? 'la semaine du ' + bornes : 'les 3 jours du ' + bornes;
  });

  /** La période affichée, décalée de `back` périodes vers le passé. */
  private shifted(back: number): string[] {
    const pas = this.days().length * back;
    return this.days().map((j) => { const d = parseDay(j); d.setDate(d.getDate() - pas); return dstr(d); });
  }

  private periodLabel(days: string[], back: number): string {
    const quand = this.view() === 'week'
      ? (back === 1 ? 'Semaine dernière' : 'Il y a ' + back + ' semaines')
      : (back === 1 ? 'Les 3 jours précédents' : 'Il y a ' + back * 3 + ' jours');
    return quand + ' · ' + this.fmt(days[0]) + ' au ' + this.fmt(days[days.length - 1]);
  }

  setView(v: '3' | 'week'): void { this.store.patch({ mealView: v }); }
  goToday(): void { this.store.patch({ mealAnchor: this.store.todayStr() }); }

  /** Un cran de navigation vaut la fenêtre affichée : trois jours, ou sept. */
  nav(dir: number): void {
    const a = parseDay(this.store.ui().mealAnchor || this.store.todayStr());
    a.setDate(a.getDate() + dir * (this.view() === 'week' ? 7 : 3));
    this.store.patch({ mealAnchor: dstr(a) });
  }

  slotLabel = computed(() => {
    const e = this.store.ui().mealEdit;
    return e ? (MEAL_SLOTS.find((s) => s.key === e.slot)?.label ?? '') : '';
  });

  dateLabel = computed(() => {
    const e = this.store.ui().mealEdit;
    if (!e) return '';
    return new Date(e.dateStr + 'T00:00:00').toLocaleDateString(this.store.locale, { weekday: 'long', day: 'numeric', month: 'long' });
  });

  /** Vrai quand ce créneau a déjà donné un événement : le bouton le dit. */
  dejaAgenda = computed(() => {
    const e = this.store.ui().mealEdit;
    return !!e && !!this.store.mealEvent(e.dateStr + '-' + e.slot);
  });

  /**
   * Qui bloque les recettes écartées. Nommer les douze recettes une à une
   * remplissait la modale d'un mur de titres : ce qu'on veut savoir, c'est
   * combien, et pour qui.
   */
  excludedWho = computed(() => {
    const noms = new Set((this.store.suggestions()?.excluded || []).flatMap((e) => e.why.split(', ')));
    return [...noms].join(', ');
  });

  /** Convives attendus, semaine type et dérogations de la modale comprises. */
  attendus = computed(() => this.store.editingPresence()?.pax ?? this.store.householdPax());
  paxText = computed(() => { const p = this.store.editingPresence(); return p ? paxLabel(p) : ''; });

  hasExisting = computed(() => {
    const e = this.store.ui().mealEdit;
    return !!e && !!this.d().meals[e.dateStr + '-' + e.slot]?.items?.length;
  });

  isToday(day: string): boolean { return day === this.store.todayStr(); }

  /** Un jour déjà passé : affiché en retrait plutôt que masqué, on y revient parfois. */
  isPast(day: string): boolean { return day < this.store.todayStr(); }

  dowOf(day: string): string { return DOW[(parseDay(day).getDay() + 6) % 7]; }
  dayNum(day: string): number { return parseDay(day).getDate(); }
  monthOf(day: string): string { return parseDay(day).toLocaleDateString(this.store.locale, { month: 'short' }); }

  mealAt(day: string, slot: string): MealValue | undefined { return this.d().meals[day + '-' + slot]; }

  private fmt(day: string): string {
    return parseDay(day).toLocaleDateString(this.store.locale, { day: 'numeric', month: 'short' });
  }
}
