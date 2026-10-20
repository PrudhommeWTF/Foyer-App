import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { FinancesStore } from '../../core/finances.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS } from '../../core/constants';
import { ListKind, Place, PlaceItem, TaskItem, TaskList } from '../../core/models';
import { whoBadges } from '../../core/schedule';
import { KIND_LABELS, KIND_SORT, REMIND_LABELS, REORDERABLE, TaskGroup, assignedTo, dailyTasks, doneTasks, groupOpen, openCount, subProgress, whenLabel } from '../../core/tasks';
import { occurrenceProgress, recLabel } from '../../core/recurrence';
import { parseDay } from '../../core/helpers';
import { ModalComponent } from '../../shared/modal';
import { ConfirmComponent } from '../../shared/confirm';
import { ReorderDirective } from '../../shared/reorder';
import { SwipeDirective } from '../../shared/swipe';
import { WhoComponent } from '../../shared/who';
import { RingCheckComponent } from '../../shared/ring-check';
import { TabItem, TabsComponent } from '../../shared/tabs';
import { TaskComposerComponent } from './composer';

/**
 * L'écran Tâches.
 *
 * Il est construit autour de la saisie : un champ en haut, la barre d'action
 * dessous, et la liste en dessous, groupée (aujourd'hui, en retard, à venir,
 * sans date). Cocher est un tap, sans confirmation ; supprimer et reporter
 * s'annulent quelques secondes. Le retard se dit, il ne crie pas : il vient
 * après le jour même, et propose de tout reporter d'un geste.
 *
 * Les listes se lisent en puces. « Toutes » ne montre que l'affaire du jour :
 * une liste de valise ou d'idées vit dans sa propre puce, sans peser.
 */
@Component({
  selector: 'screen-taches',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent, ConfirmComponent, ReorderDirective, SwipeDirective, WhoComponent, RingCheckComponent, TabsComponent, TaskComposerComponent],
  host: { '(document:click)': 'closePlus($event)', '(document:keydown.escape)': 'plusOpen.set(false)' },
  template: `
    <div class="screen-enter">
      <!-- Listes : des onglets soulignés. La couleur d'une liste vit sur ses cases, pas sur son onglet. -->
      <f-tabs class="tabs" label="Listes de tâches" [tabs]="tabItems()" [active]="active()" (select)="store.patch({ activeList: $event })">
        <div tabsEnd class="plus-wrap">
          <button type="button" class="plus" (click)="plus()" [attr.aria-label]="templates().length ? 'Ajouter une liste' : 'Nouvelle liste'"
                  [attr.aria-haspopup]="templates().length ? 'menu' : null" [attr.aria-expanded]="templates().length ? plusOpen() : null">
            <f-icon name="plus" [size]="16" color="var(--ink2)" [width]="2.6" />
          </button>
          @if (plusOpen()) {
            <div class="menu" role="menu">
              <button type="button" role="menuitem" (click)="plusOpen.set(false); store.newTaskList()"><f-icon name="plus" [size]="15" color="var(--ink2)" [width]="2.6" /> Nouvelle liste</button>
              <button type="button" role="menuitem" (click)="plusOpen.set(false); store.patch({ tplOpen: true })"><f-icon name="copy" [size]="15" color="var(--ink2)" [width]="2.4" /> Depuis un modèle</button>
            </div>
          }
        </div>
        @if (archivedCount()) {
          <button tabsAside type="button" class="arch-link" (click)="store.patch({ showArchived: !store.ui().showArchived })">
            {{ store.ui().showArchived ? 'Masquer les archivées' : 'Archivées · ' + archivedCount() }}
          </button>
        }
      </f-tabs>

      <!-- État de la synchronisation. Silencieux quand tout va bien. -->
      @if (store.syncOffline() || store.taskPending()) {
        <div class="sync" [class.off]="store.syncOffline()">
          <f-icon [name]="store.syncOffline() ? 'x' : 'refresh'" [size]="15" [color]="store.syncOffline() ? 'var(--status-crit)' : 'var(--ink2)'" [width]="2.4" />
          @if (store.syncOffline()) {
            <span>Hors ligne. {{ store.taskPending() }} modification(s) en attente, elles partiront au retour du réseau.</span>
          } @else {
            <span>Envoi de {{ store.taskPending() }} modification(s)…</span>
          }
        </div>
      }

      <!-- En-tête de la liste active -->
      <div class="head-row">
        @if (activeObj(); as l) {
          <!-- Le nom de la liste ouvre sa fiche : la modifier, l'archiver, en faire un modèle, la supprimer. -->
          <button class="ident ident-btn" (click)="store.openItem('taskList', l.id)">
            <span class="ident-txt">
              <span class="ident-name"><span class="ident-sq" [style.background]="l.color"></span>{{ l.name }}
                <f-icon name="chevronRight" [size]="16" color="var(--ink3)" [width]="2.4" /></span>
              <span class="ident-sub">{{ kindLabel(l.kind) }}{{ l.scope !== 'shared' ? ' · privée' : '' }}{{ l.archived ? ' · archivée' : '' }}</span>
            </span>
          </button>
          <div class="spacer"></div>
          @if (l.kind === 'devoirs' && store.screenEnabled('ecole')) {
            <button class="btn btn-soft sm" (click)="store.go('ecole')"><f-icon name="ecole" [size]="15" color="var(--ink2)" [width]="2.2" /> Écran École</button>
          }
          @if (l.kind === 'corvees' || l.kind === 'checklist') {
            <button class="btn btn-soft sm" (click)="store.uncheckAll(l.id)"><f-icon name="refresh" [size]="15" color="var(--ink2)" [width]="2.2" /> Tout décocher</button>
          }
        } @else {
          <div class="ident">
            <div class="ident-txt">
              <div class="ident-name">{{ active() === 'me' ? 'À moi' : 'Toutes les tâches' }}</div>
              <div class="ident-sub">{{ active() === 'me' ? 'Ce qui m’est affecté, toutes listes confondues' : 'L’affaire du jour, toutes listes confondues' }}</div>
            </div>
          </div>
        }
      </div>

      <!-- En-tête d'une liste de préparation : le départ, la progression, la remise à zéro. -->
      @if (activeObj(); as l) {
        @if (l.kind === 'preparation') {
          @let p = prepProgress(l.id);
          <div class="reg-head prep-head">
            <f-icon name="suitcase" [size]="15" [color]="isDeparturePast(l) ? 'var(--ink3)' : l.color" [width]="2.2" />
            <span class="prep-dep" [class.past]="isDeparturePast(l)">{{ departureText(l) }}@if (isDeparturePast(l)) {<span class="prep-past"> · départ passé</span>}</span>
            <span class="reg-n">{{ p.done }} / {{ p.total }} préparé{{ p.done > 1 ? 's' : '' }}</span>
            <div class="prep-acts">
              @if (isDeparturePast(l)) {
                <button class="btn btn-soft sm" (click)="store.openItem('taskList', l.id); store.editItem()"><f-icon name="calendar" [size]="15" color="var(--ink2)" [width]="2.2" /> Nouveau départ</button>
              }
              <button class="btn btn-soft sm" [disabled]="!p.total" (click)="store.patch({ prepResetId: l.id })"><f-icon name="refresh" [size]="15" color="var(--ink2)" [width]="2.2" /> Tout remettre à zéro</button>
            </div>
          </div>

          <!-- Croisement avec l'inventaire du lieu de destination : ce qui est
               déjà là-bas (à ne pas emporter) et ce qui reste à remporter. -->
          @if (placeOf(l); as pl) {
            @let there = alreadyThere(pl.id);
            @let bring = toBring(l);
            <div class="reg-box prep-place"><div class="pp-in">
              <div class="pp-head"><f-icon name="map-pin" [size]="15" [color]="pl.color" [width]="2.2" /> <span>{{ pl.name }}</span></div>
              @if (there.length) {
                <div class="pp-line"><span class="pp-tag">Déjà sur place</span>
                  @for (i of there; track i.id) { <span class="pp-chip">{{ i.name }}</span> }
                </div>
              }
              @if (bring.length) {
                <div class="pp-line"><span class="pp-tag">À remporter</span>
                  @for (i of bring; track i.id) {
                    <button class="pp-chip add" (click)="store.addPrepArticle(l.id, i.name)"><f-icon name="plus" [size]="12" color="var(--sage)" [width]="2.8" /> {{ i.name }}</button>
                  }
                </div>
              }
              @if (!there.length && !bring.length) {
                <div class="pp-empty">Rien de noté à « {{ pl.name }} » pour l’instant.</div>
              }
            </div></div>
          }
        }
      }

      <!-- Saisie rapide. Pas dans « À moi » : cette vue rassemble, elle ne range pas. -->
      @if (!lists().length) {
        <div class="empty">Créez une liste pour commencer.</div>
      } @else if (activeObj()?.kind === 'devoirs') {
        <!-- Pas de « + » ici : la liste se remplit depuis ÉcoleDirecte. -->
        <div class="ed-hint">Remplie par ÉcoleDirecte : une tâche par devoir, cochée ici ou dans l’écran École.@if (hasDayTask()) { L’entraînement du jour vient des Révisions et se coche tout seul quand l’objectif est atteint. } Une tâche maison va dans une autre liste.</div>
      } @else if (active() !== 'me') {
        <div class="compose"><app-task-composer (saved)="store.createTask($event)" /></div>
      }

      <!-- Ce qui reste à faire, par groupe : une surface par groupe, une ligne par tâche. -->
      @for (g of groups(); track g.key) {
        <section class="reg-sec">
          @if (g.label) {
            <div class="reg-head" [class.late]="g.key === 'late'">
              @if (g.key === 'soon') {
                <!-- « À venir » se replie : ce qui n'est pas pour tout de suite peut s'effacer. -->
                <button class="reg-fold" (click)="store.patch({ soonCollapsed: !store.ui().soonCollapsed })" [attr.aria-expanded]="!store.ui().soonCollapsed">
                  <f-icon [name]="store.ui().soonCollapsed ? 'chevronRight' : 'chevronDown'" [size]="15" color="var(--ink2)" [width]="2.4" />
                  <span class="reg-title">{{ g.label }}</span><span class="reg-n">{{ g.lines.length }}</span>
                </button>
              } @else {
                <h3 class="reg-title">{{ g.label }}</h3><span class="reg-n">{{ g.lines.length }}</span>
              }
              @if (g.key === 'late') {
                <button class="reg-act" (click)="postponeAll(g, store.todayStr())">{{ store.narrow() ? 'Tout à aujourd’hui' : 'Tout reporter à aujourd’hui' }}</button>
              }
            </div>
          }
          @if (g.key !== 'soon' || !store.ui().soonCollapsed) {
          <div class="reg-box" [fReorder]="ids(g)" (reordered)="store.reorderTasks($event)">
            @for (l of g.lines; track l.task.id) {
              @let w = whenOf(l.task);
              <div [attr.data-rid]="l.task.id">
              <div class="swipe-wrap" [class.swap]="!rightDone()">
              <!-- Fonds révélés par le glissement, coupés par la surface du groupe. Le sens (terminer / supprimer) suit le réglage. -->
              <div class="swipe-bg" aria-hidden="true">
                <span class="swipe-ic r">
                  @if (rightDone()) { <f-icon name="check" [size]="20" color="#fff" [width]="3" /> Terminer }
                  @else { <f-icon name="trash" [size]="19" color="#fff" [width]="2.4" /> Supprimer }
                </span>
                <span class="swipe-ic l">
                  @if (rightDone()) { Supprimer <f-icon name="trash" [size]="19" color="#fff" [width]="2.4" /> }
                  @else { Terminer <f-icon name="check" [size]="20" color="#fff" [width]="3" /> }
                </span>
              </div>
              <div class="reg-row task" fSwipe (swipeRight)="doSwipe(l.task.id, 'right')" (swipeLeft)="doSwipe(l.task.id, 'left')" (click)="store.openItem('task', l.task.id)">
                @if (canOrder(g)) {
                  <!-- On tire par la poignée, jamais par la ligne : sinon la liste ne défile plus. -->
                  <button class="reg-grip reveal" data-grip (click)="$event.stopPropagation()" [attr.aria-label]="'Déplacer ' + l.task.text">
                    <f-icon name="grip" [size]="16" color="var(--ink3)" [width]="3" />
                  </button>
                }
                <f-ring-check [color]="listColor(l.task.listId)" [progress]="ringOf(l.task)" [late]="l.late > 0" [label]="l.task.text" (toggle)="store.toggleTask(l.task.id)" />
                <div class="reg-main">
                  <div class="reg-text">{{ l.task.text }}</div>
                  @if ((w && store.narrow()) || l.task.edId || l.task.revEx || l.subs.length || l.task.time || l.task.rec || l.task.cat || l.task.note || l.task.shopListId || l.task.contractId || active() === 'all' || active() === 'me') {
                    <div class="reg-meta">
                      <!-- Sur téléphone, l'échéance quitte sa colonne et passe en tête. -->
                      @if (w && store.narrow()) { <span [class.late]="l.late > 0">{{ w.day }}{{ w.rel ? ' · ' + w.rel : '' }}</span> }
                      @if (l.task.edId) { <span><f-icon name="ecole" [size]="12" color="var(--ink2)" [width]="2.2" /> ÉcoleDirecte</span> }
                      @if (l.subs.length) { <span><f-icon name="check" [size]="12" color="var(--ink2)" [width]="2.6" /> {{ progress(l.subs) }}</span> }
                      @if (l.task.time && l.task.due) { <span><f-icon name="clock" [size]="12" color="var(--ink2)" [width]="2.4" /> {{ l.task.time }}</span> }
                      @if (l.task.rec) { <span [title]="recOf(l.task)"><f-icon name="refresh" [size]="12" color="var(--ink2)" [width]="2.4" /> {{ recOf(l.task) }}</span> }
                      @if (l.task.remind && l.task.due) { <span title="Rappel"><f-icon name="bell" [size]="12" color="var(--ink2)" [width]="2.4" /> {{ remindOf(l.task) }}</span> }
                      @if (l.task.cat) { <span>{{ l.task.cat }}</span> }
                      @if (l.task.note) { <span [title]="l.task.note"><f-icon name="edit" [size]="12" color="var(--ink2)" [width]="2.2" /> note</span> }
                      @if (active() === 'all' || active() === 'me') { <span><span class="reg-sq" [style.background]="listColor(l.task.listId)"></span>{{ listName(l.task.listId) }}</span> }
                      <!-- Les liens vers le reste du foyer : un tap, et on y est. -->
                      @if (l.task.shopListId) {
                        <button class="reg-link sage" (click)="$event.stopPropagation(); store.openShoppingList(l.task.shopListId!)">
                          <f-icon name="panier" [size]="12" color="currentColor" [width]="2.4" />
                          {{ store.shopRemaining(l.task.shopListId!) }} article{{ store.shopRemaining(l.task.shopListId!) > 1 ? 's' : '' }} à prendre ›
                        </button>
                      }
                      @if (l.task.revEx && store.screenEnabled('revisions')) {
                        <button class="reg-link sage" (click)="$event.stopPropagation(); store.go('revisions')">
                          <f-icon name="grille" [size]="12" color="currentColor" [width]="2.4" /> S’entraîner ›
                        </button>
                      }
                      @if (l.task.contractId) {
                        <button class="reg-link" (click)="$event.stopPropagation(); fin.openContract(l.task.contractId!)">
                          <f-icon name="budget" [size]="12" color="currentColor" [width]="2.4" /> Ouvrir le contrat ›
                        </button>
                      }
                    </div>
                  }
                </div>
                @if ((g.key === 'late' || g.key === 'today') && !l.task.revEx) {
                  <button class="reg-mini reveal" (click)="$event.stopPropagation(); store.postponeTask(l.task.id)">Demain</button>
                }
                @if (l.task.who.length) { <f-who [badges]="badges(l.task)" [size]="22" /> }
                @if (w && !store.narrow()) {
                  <div class="reg-when" [class.late]="l.late > 0">{{ w.day }}@if (w.rel) { <small>{{ w.rel }}</small> }</div>
                }
              </div>
              </div>
              <!-- Les sous-tâches, dans la surface du parent : un détail se coche là où il est. -->
              @if (l.subs.length) {
                <div [fReorder]="subIds(l.subs)" (reordered)="store.reorderTasks($event)">
                  @for (sb of l.subs; track sb.id) {
                    <div class="reg-sub" [attr.data-rid]="sb.id">
                      <button class="reg-grip sub-grip reveal" data-grip [attr.aria-label]="'Déplacer ' + sb.text">
                        <f-icon name="grip" [size]="15" color="var(--ink3)" [width]="2.8" />
                      </button>
                      <f-ring-check [size]="18" [done]="sb.done" [label]="sb.text" (toggle)="store.toggleTask(sb.id)" />
                      <button class="sub-text" [class.strike]="sb.done" (click)="store.openItem('task', sb.id)">{{ sb.text }}</button>
                      @if (sb.who.length) { <f-who [badges]="badges(sb)" [size]="18" /> }
                    </div>
                  }
                </div>
              }
              </div>
            }
          </div>
          }
        </section>
      } @empty {
        @if (lists().length) { <div class="empty">Rien à faire ici.</div> }
      }

      <!-- Terminées, repliées : ce qui est fait n'a pas à occuper l'écran. -->
      @if (done().length) {
        <section class="reg-sec">
          <div class="reg-head">
            <button class="reg-fold quiet" (click)="store.patch({ showDone: !store.ui().showDone })" [attr.aria-expanded]="store.ui().showDone">
              <f-icon [name]="store.ui().showDone ? 'chevronDown' : 'chevronRight'" [size]="15" color="var(--ink2)" [width]="2.4" />
              <span class="reg-title">Terminées</span><span class="reg-n">{{ done().length }}</span>
            </button>
          </div>
          @if (store.ui().showDone) {
            <div class="reg-box">
              @for (t of done(); track t.id) {
                <div class="reg-row done" (click)="store.openItem('task', t.id)">
                  <f-ring-check [done]="true" [label]="t.text" (toggle)="store.toggleTask(t.id)" />
                  <div class="reg-main">
                    <div class="reg-text">{{ t.text }}</div>
                    <div class="reg-meta dim">{{ doneBy(t) }}{{ active() === 'all' ? ' · ' + listName(t.listId) : '' }}</div>
                  </div>
                </div>
              }
            </div>
          }
        </section>
      }
    </div>


    <!-- Modèles -->
    @if (store.ui().tplOpen) {
      <f-modal title="Nouvelle liste depuis un modèle" [maxWidth]="440" (close)="store.patch({ tplOpen: false })">
        <div class="tpls">
          @for (t of templates(); track t.id) {
            <div class="tpl">
              <button class="tpl-main" (click)="store.createListFromTemplate(t.id)">
                <span class="ident-ic sm" [style.background]="t.color"><f-icon [path]="listIcons[t.icon] || listIcons['checklist']" [size]="16" color="#fff" [width]="2" /></span>
                <span class="tpl-body">
                  <span class="tpl-name">{{ t.name }}</span>
                  <span class="tpl-sub">{{ kindLabel(t.kind) }} · {{ t.items.length }} ligne{{ t.items.length > 1 ? 's' : '' }}</span>
                </span>
              </button>
              <button class="icon-btn sm" (click)="store.deleteTemplate(t.id)" aria-label="Supprimer le modèle"><f-icon name="trash" [size]="15" color="var(--primary)" [width]="2" /></button>
            </div>
          } @empty {
            <div class="empty">Aucun modèle. Sur une liste, « En modèle » la retient pour la refaire plus tard.</div>
          }
        </div>
      </f-modal>
    }

    <!-- Remettre à zéro une liste de préparation -->
    @if (store.ui().prepResetId) {
      <f-confirm title="Tout remettre à zéro ?" confirmLabel="Remettre à zéro" (cancel)="store.patch({ prepResetId: null })" (confirm)="store.resetList(store.ui().prepResetId!)">
        Les affaires de « {{ resetName() }} » restent, les coches sont effacées. La liste est prête pour le prochain départ.
      </f-confirm>
    }
  `,
  styles: [`
    .tabs { margin-bottom: 18px; }
    .plus-wrap { position: relative; flex: none; }
    .plus { width: 30px; height: 30px; border: none; border-radius: 8px; background: none; display: grid; place-items: center; cursor: pointer; }
    .plus:hover, .plus[aria-expanded="true"] { background: var(--soft2); }
    .menu { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; min-width: 200px; background: var(--surface); border: 1px solid var(--line2);
            border-radius: 12px; padding: 5px; box-shadow: var(--sh-card); display: flex; flex-direction: column; }
    .menu button { display: flex; align-items: center; gap: 9px; border: none; background: none; border-radius: 8px; padding: 9px 10px; font: inherit; font-size: 13.5px; font-weight: 800; color: var(--ink); cursor: pointer; text-align: left; white-space: nowrap; }
    .menu button:hover, .menu button:focus-visible { background: var(--soft); outline: none; }
    .arch-link { margin-left: auto; flex: none; border: none; background: none; padding: 6px 0; font: inherit; font-size: 13px; font-weight: 800; color: var(--ink3); cursor: pointer; white-space: nowrap; }
    .arch-link:hover { color: var(--ink2); }

    .sync { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 9px 12px; border-radius: 12px; background: var(--soft); font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .sync.off { background: var(--status-crit-bg); color: var(--status-crit); }

    .head-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
    .ident { display: flex; align-items: center; gap: 10px; margin-right: 4px; min-width: 0; }
    .ident-btn { padding: 0; border: none; background: none; font: inherit; text-align: left; cursor: pointer; }
    .ident-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .ident-ic { width: 34px; height: 34px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex: none; }
    .ident-ic.sm { width: 30px; height: 30px; border-radius: 9px; }
    .ident-name { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--ink); line-height: 1.15; }
    .ident-sq { width: 10px; height: 10px; border-radius: 3px; flex: none; }
    .ident-sub { font-size: 13px; font-weight: 600; color: var(--ink2); }
    .btn.sm { padding: 8px 12px; font-size: 12.5px; display: inline-flex; align-items: center; gap: 6px; }

    .compose { margin-bottom: 22px; }

    /* Glissé au doigt : le fond coloré et son icône, révélés derrière la ligne, coupés par la surface. */
    .swipe-wrap { position: relative; }
    .swipe-bg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; opacity: 0; }
    .swipe-wrap[data-swipe] .swipe-bg { opacity: 1; }
    /* La couleur suit l'action de ce côté : terminer en vert, supprimer en rouge. « swap » intervertit les deux. */
    .swipe-wrap[data-swipe="right"] .swipe-bg { background: var(--sage); }
    .swipe-wrap[data-swipe="left"] .swipe-bg { background: var(--primary); }
    .swipe-wrap.swap[data-swipe="right"] .swipe-bg { background: var(--primary); }
    .swipe-wrap.swap[data-swipe="left"] .swipe-bg { background: var(--sage); }
    .swipe-ic { display: inline-flex; align-items: center; gap: 8px; color: #fff; font-weight: 800; font-size: 14px; opacity: 0; transition: transform .12s ease; }
    .swipe-wrap[data-swipe="right"] .swipe-ic.r { opacity: 1; }
    .swipe-wrap[data-swipe="left"] .swipe-ic.l { opacity: 1; }
    .swipe-wrap.swipe-commit .swipe-ic { transform: scale(1.14); }

    .task { touch-action: pan-y; }
    .sub-grip { left: 30px; }
    .sub-text { flex: 1; min-width: 0; text-align: left; border: none; background: transparent; cursor: pointer; padding: 0; font: inherit; font-size: 14px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
    .sub-text.strike { color: var(--ink3); text-decoration: line-through; }
    .ed-hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); background: var(--soft); border-radius: 12px; padding: 10px 14px; margin-bottom: 14px; line-height: 1.45; }
    .empty { color: var(--ink3); font-weight: 700; font-size: 13.5px; padding: 16px 0; }

    /* En-tête d'une liste de préparation : le départ, la progression, les actions à droite. */
    .prep-head { flex-wrap: wrap; row-gap: 8px; margin-bottom: 14px; }
    .prep-dep { font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .prep-dep.past, .prep-past { color: var(--ink3); }
    .prep-acts { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }

    /* Croisement avec l'inventaire du lieu de destination. */
    .prep-place { margin: 0 0 18px; }
    .pp-in { padding: 12px 16px; }
    .pp-head { display: flex; align-items: center; gap: 7px; font-size: 14.5px; font-weight: 800; color: var(--ink); margin-bottom: 4px; }
    .pp-line { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 6px; }
    .pp-tag { font-size: 12px; font-weight: 800; color: var(--ink3); margin-right: 2px; }
    .pp-chip { display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px; border-radius: 10px; font-size: 12.5px; font-weight: 800; background: var(--soft2); color: var(--ink2); border: none; font-family: inherit; }
    .pp-chip.add { background: var(--tint-sage); color: var(--sage); cursor: pointer; }
    .pp-empty { font-size: 12.5px; font-weight: 700; color: var(--ink3); }

    .tpls { display: flex; flex-direction: column; gap: 8px; }
    .tpl { display: flex; align-items: center; gap: 8px; }
    .tpl-main { flex: 1; display: flex; align-items: center; gap: 12px; border: none; background: var(--soft); border-radius: 14px; padding: 10px 12px; cursor: pointer; text-align: left; font: inherit; }
    .tpl-body { display: flex; flex-direction: column; }
    .tpl-name { font-size: 14px; font-weight: 800; color: var(--ink); }
    .tpl-sub { font-size: 12px; font-weight: 700; color: var(--ink3); }


  `],
})
export class TachesScreen {
  store = inject(FoyerStore);
  fin = inject(FinancesStore);
  d = this.store.d;

  readonly listIcons = LIST_ICONS;

  active = computed(() => this.store.ui().activeList);
  /** Les listes visibles, dans l'ordre des types puis des positions. */
  lists = computed(() => {
    const all = this.store.visibleTaskLists(this.store.ui().showArchived);
    return all.slice().sort((a, b) => KIND_SORT.indexOf(a.kind) - KIND_SORT.indexOf(b.kind) || (a.position ?? 0) - (b.position ?? 0));
  });
  archivedCount = computed(() => this.store.visibleTaskLists(true).filter((l) => l.archived).length);
  templates = computed(() => this.d().taskTemplates);
  activeObj = computed(() => this.d().taskLists.find((l) => l.id === this.active()) || null);
  /** La liste de devoirs ouverte porte-t-elle un entraînement du jour des Révisions ? */
  hasDayTask = computed(() => this.d().tasks.some((t) => t.revEx && t.listId === this.active()));
  /** L'affaire du jour : ce que « Toutes » montre et compte. */
  private daily = computed(() => dailyTasks(this.d().tasks, this.d().taskLists, this.store.currentMemberId()));
  allOpen = computed(() => openCount(this.daily()));
  /** Ce qui m'est affecté, dans toutes les listes que je vois : une affectation est une affectation. */
  private assigned = computed(() => {
    const visibles = new Set(this.store.visibleTaskLists(true).map((l) => l.id));
    return assignedTo(this.d().tasks.filter((t) => visibles.has(t.listId)), this.store.currentMemberId());
  });
  /**
   * Ce que la vue montre : mes tâches, **et** les sous-tâches de celles-ci. Sans
   * elles, une tâche à moi paraîtrait vide de ce qu'elle demande. Une sous-tâche
   * à mon nom dont le parent n'est pas à moi reste une ligne à part entière.
   */
  private mine = computed(() => {
    const miens = this.assigned();
    const ids = new Set(miens.map((t) => t.id));
    return [...miens, ...this.d().tasks.filter((t) => t.parentId && ids.has(t.parentId) && !ids.has(t.id))];
  });
  meOpen = computed(() => this.assigned().filter((t) => !t.done).length);

  private scoped = computed<TaskItem[]>(() => {
    const a = this.active();
    if (a === 'all') return this.daily();
    if (a === 'me') return this.mine();
    return this.d().tasks.filter((t) => t.listId === a);
  });
  groups = computed<TaskGroup[]>(() => groupOpen(this.scoped(), this.store.todayStr(), this.activeObj()?.kind || 'taches', this.activeObj()?.order === 'manuel' ? 'manuel' : 'echeance'));
  done = computed(() => doneTasks(this.scoped()));

  /** Le glissement à droite termine-t-il la tâche ? Faux si l'utilisateur a inversé les deux sens. */
  rightDone = computed(() => this.store.setting('taskSwipe') !== 'right-delete');
  /** Applique le geste selon le réglage : un côté termine, l'autre supprime. */
  doSwipe(id: string, dir: 'right' | 'left'): void {
    const terminer = dir === 'right' ? this.rightDone() : !this.rightDone();
    if (terminer) this.store.toggleTask(id); else this.store.removeTask(id);
  }


  kindLabel(k: ListKind): string { return KIND_LABELS[k]; }

  /** Les onglets : Toutes, À moi, puis chaque liste avec ce qui y reste à faire. */
  tabItems = computed<TabItem[]>(() => [
    { id: 'all', label: 'Toutes', count: this.allOpen() },
    ...(this.store.currentMemberId() ? [{ id: 'me', label: 'À moi', count: this.meOpen() }] : []),
    ...this.lists().map((l) => ({ id: l.id, label: l.name, count: this.undoneCount(l.id), lock: l.scope !== 'shared', muted: !!l.archived })),
  ]);
  /** Le « + » : un menu quand il y a des modèles, sinon la nouvelle liste tout de suite. */
  readonly plusOpen = signal(false);
  plus(): void { if (this.templates().length) this.plusOpen.set(!this.plusOpen()); else this.store.newTaskList(); }
  closePlus(e: Event): void { if (this.plusOpen() && !(e.target as HTMLElement).closest?.('.plus-wrap')) this.plusOpen.set(false); }
  // ---- listes de préparation -------------------------------------------------
  memberName(id: string | null | undefined): string { return id ? this.store.memberName(id) : ''; }

  /** Progression d'une liste de préparation : préparés sur total. */
  prepProgress(listId: string): { done: number; total: number } {
    const items = this.d().tasks.filter((t) => t.listId === listId);
    return { done: items.filter((t) => t.done).length, total: items.length };
  }
  /** Jours d'ici au départ ( >0 avenir, 0 aujourd'hui, <0 passé ), ou null sans date. */
  daysToDeparture(l: TaskList): number | null {
    if (!l.departure) return null;
    const today = parseDay(this.store.todayStr()), dep = parseDay(l.departure);
    return Math.round((dep.getTime() - today.getTime()) / 86_400_000);
  }
  /** « Départ de Nolan, samedi 12 juillet, dans 9 jours » ; « Aucune date de départ » sans date. */
  departureText(l: TaskList): string {
    const who = l.forMember ? 'Départ de ' + this.memberName(l.forMember) : 'Départ';
    if (!l.departure) return l.forMember ? who + ', sans date' : 'Aucune date de départ';
    const n = this.daysToDeparture(l)!;
    const quand = n > 1 ? `dans ${n} jours` : n === 1 ? 'demain' : n === 0 ? 'aujourd’hui' : n === -1 ? 'hier' : `il y a ${-n} jours`;
    return `${who}, ${this.store.fmtLongDate(l.departure)}, ${quand}`;
  }
  isDeparturePast(l: TaskList): boolean { const n = this.daysToDeparture(l); return n !== null && n < 0; }

  // ---- croisement avec les lieux (inventaire du lieu de destination) ---------
  /** Les lieux, pour retrouver celui d'une préparation. */
  places = computed(() => this.store.placesInOrder());
  /** Le lieu lié à une préparation, s'il existe encore. */
  placeOf(l: TaskList): Place | null { return l.placeId ? this.places().find((p) => p.id === l.placeId) ?? null : null; }
  /** Ce qui est déjà sur place (état « là-bas ») : à ne pas emporter. */
  alreadyThere(placeId: string): PlaceItem[] { return this.store.itemsOfPlace(placeId).filter((i) => i.state === 'la-bas'); }
  /**
   * Ce qui est ramené à la maison (état « ici ») et n'est pas déjà dans la
   * préparation : à remporter, ajoutable en un geste. Comparé par nom normalisé.
   */
  toBring(l: TaskList): PlaceItem[] {
    if (!l.placeId) return [];
    const dansListe = new Set(this.d().tasks.filter((t) => t.listId === l.id).map((t) => t.text.trim().toLowerCase()));
    return this.store.itemsOfPlace(l.placeId).filter((i) => i.state === 'ici' && !dansListe.has(i.name.trim().toLowerCase()));
  }
  resetName = computed(() => this.d().taskLists.find((l) => l.id === this.store.ui().prepResetId)?.name || '');
  undoneCount(listId: string): number { return openCount(this.d().tasks.filter((t) => t.listId === listId)); }
  private list(id: string): TaskList | undefined { return this.d().taskLists.find((l) => l.id === id); }
  listColor(id: string): string { return this.list(id)?.color || 'var(--primary)'; }
  listName(id: string): string { return this.list(id)?.name || 'Liste supprimée'; }
  badges(t: TaskItem) { return whoBadges(t, this.d().members); }
  /** La colonne d'échéance : « Demain », « 26 oct. » et « dans 9 j ». Null sans date. */
  whenOf(t: TaskItem): { day: string; rel: string } | null { return t.due ? whenLabel(t.due, this.store.todayStr(), t.rec?.grace) : null; }
  recOf(t: TaskItem): string { return t.rec ? recLabel(t.rec, (iso) => this.store.fmtNumDate(iso)) : ''; }
  /** L'anneau d'une tâche récurrente (0 à 1), vers l'occurrence à venir ; null sans récurrence (case pleine). */
  ringOf(t: TaskItem): number | null { return t.rec && t.due ? occurrenceProgress(t.rec, t.due, this.store.todayStr()) : null; }
  remindOf(t: TaskItem): string { return t.remind ? REMIND_LABELS[t.remind].toLowerCase() : ''; }
  doneBy(t: TaskItem): string {
    const qui = t.doneBy ? this.store.memberName(t.doneBy) : '';
    const quand = t.doneAt ? this.store.fmtNumDate(t.doneAt.slice(0, 10)) : '';
    return [qui ? 'par ' + qui : '', quand ? 'le ' + quand : ''].filter(Boolean).join(' ') || 'Faite';
  }
  postponeAll(g: TaskGroup, to: string): void { this.store.postponeTasks(g.lines.map((l) => l.task.id), to); }

  /** L'ordre se règle à la main là où aucune date ne le règle déjà. */
  canOrder(g: TaskGroup): boolean { return REORDERABLE.includes(g.key); }
  ids(g: TaskGroup): string[] { return g.lines.map((l) => l.task.id); }
  subIds(subs: TaskItem[]): string[] { return subs.map((sb) => sb.id); }
  progress(subs: TaskItem[]): string { const p = subProgress(subs); return p ? p.done + '/' + p.total : ''; }

}
