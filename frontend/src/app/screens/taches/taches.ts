import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { FinancesStore } from '../../core/finances.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS, PALETTE, tint } from '../../core/constants';
import { ListKind, TaskItem, TaskList } from '../../core/models';
import { whoBadges } from '../../core/schedule';
import { TaskDraft } from '../../core/task-ops';
import { KIND_LABELS, KIND_ORDER, REMIND_LABELS, TaskGroup, dailyTasks, doneTasks, dueLabel, groupOpen } from '../../core/tasks';
import { recLabel } from '../../core/recurrence';
import { ModalComponent } from '../../shared/modal';
import { WhoComponent } from '../../shared/who';
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
  imports: [FormsModule, IconComponent, ModalComponent, WhoComponent, TaskComposerComponent],
  template: `
    <div class="screen-enter">
      <!-- Listes -->
      <div class="chips">
        <div class="chip-l" [class.active]="active() === 'all'" (click)="store.patch({ activeList: 'all' })"
             [style.background]="active() === 'all' ? 'var(--primary)' : 'var(--soft)'"
             [style.color]="active() === 'all' ? '#fff' : 'var(--ink)'">
          <f-icon name="taches" [size]="16" [color]="active() === 'all' ? '#fff' : 'var(--primary)'" [width]="2" />
          Toutes
          <span class="cc" [style.color]="active() === 'all' ? 'rgba(255,255,255,.8)' : 'var(--ink3)'">{{ allOpen() }}</span>
        </div>
        @for (l of lists(); track l.id) {
          <div class="chip-l" [class.active]="active() === l.id" [class.archived]="l.archived" (click)="store.patch({ activeList: l.id })"
               [style.background]="active() === l.id ? l.color : 'var(--soft)'"
               [style.color]="active() === l.id ? '#fff' : 'var(--ink)'">
            <f-icon [path]="iconOf(l)" [size]="16" [color]="active() === l.id ? '#fff' : l.color" [width]="2" />
            {{ l.name }}
            @if (l.scope !== 'shared') { <f-icon name="lock" [size]="12" [color]="active() === l.id ? 'rgba(255,255,255,.8)' : 'var(--ink3)'" [width]="2.4" /> }
            <span class="cc" [style.color]="active() === l.id ? 'rgba(255,255,255,.8)' : 'var(--ink3)'">{{ undoneCount(l.id) }}</span>
          </div>
        }
        <div class="chip-new" (click)="store.newTaskList()">
          <f-icon name="plus" [size]="15" color="var(--primary)" [width]="2.6" /> Nouvelle liste
        </div>
        @if (templates().length) {
          <div class="chip-new" (click)="store.patch({ tplOpen: true })">
            <f-icon name="copy" [size]="15" color="var(--primary)" [width]="2.4" /> Depuis un modèle
          </div>
        }
        @if (archivedCount()) {
          <button class="chip-soft" (click)="store.patch({ showArchived: !store.ui().showArchived })">
            {{ store.ui().showArchived ? 'Masquer les archivées' : 'Archivées · ' + archivedCount() }}
          </button>
        }
      </div>

      <!-- État de la synchronisation. Silencieux quand tout va bien. -->
      @if (store.syncOffline() || store.taskPending()) {
        <div class="sync" [class.off]="store.syncOffline()">
          <f-icon [name]="store.syncOffline() ? 'x' : 'refresh'" [size]="15" [color]="store.syncOffline() ? '#C6492F' : 'var(--ink2)'" [width]="2.4" />
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
          <div class="ident">
            <div class="ident-ic" [style.background]="l.color"><f-icon [path]="iconOf(l)" [size]="18" color="#fff" [width]="2" /></div>
            <div>
              <div class="ident-name">{{ l.name }}</div>
              <div class="ident-sub">{{ kindLabel(l.kind) }}{{ l.scope !== 'shared' ? ' · privée' : '' }}{{ l.archived ? ' · archivée' : '' }}</div>
            </div>
          </div>
          <button class="icon-btn" (click)="store.editTaskList(l.id)" aria-label="Modifier la liste"><f-icon name="edit" [size]="15" color="var(--ink2)" [width]="2" /></button>
          <button class="icon-btn" (click)="store.archiveTaskList(l.id, !l.archived)" [attr.aria-label]="l.archived ? 'Restaurer la liste' : 'Archiver la liste'" [title]="l.archived ? 'Restaurer' : 'Archiver'">
            <f-icon [name]="l.archived ? 'refresh' : 'folder'" [size]="15" color="var(--ink2)" [width]="2" />
          </button>
          <button class="icon-btn" (click)="store.patch({ listDelId: l.id })" aria-label="Supprimer la liste"><f-icon name="trash" [size]="15" color="var(--primary)" [width]="2" /></button>
          <div class="spacer"></div>
          <button class="btn btn-soft sm" (click)="store.saveListAsTemplate(l.id)" title="Retenir cette liste pour la refaire plus tard">
            <f-icon name="copy" [size]="15" color="var(--ink2)" [width]="2.2" /> En modèle
          </button>
          @if (l.kind !== 'taches') {
            <button class="btn btn-soft sm" (click)="store.uncheckAll(l.id)"><f-icon name="refresh" [size]="15" color="var(--ink2)" [width]="2.2" /> Tout décocher</button>
          }
        } @else {
          <div class="ident">
            <div class="ident-ic" style="background:var(--primary)"><f-icon name="taches" [size]="18" color="#fff" [width]="2" /></div>
            <div>
              <div class="ident-name">Toutes les tâches</div>
              <div class="ident-sub">L’affaire du jour, toutes listes confondues</div>
            </div>
          </div>
        }
      </div>

      <!-- Saisie rapide -->
      @if (lists().length) {
        <div class="compose"><app-task-composer (saved)="store.createTask($event)" /></div>
      } @else {
        <div class="empty">Créez une liste pour commencer.</div>
      }

      <!-- Ce qui reste à faire, par groupe -->
      @for (g of groups(); track g.key) {
        <div class="group">
          @if (g.label) {
            <div class="g-head">
              <span class="col-title">{{ g.label }} · {{ g.lines.length }}</span>
              @if (g.key === 'late') {
                <button class="g-act" (click)="postponeAll(g, store.todayStr())">Tout reporter à aujourd’hui</button>
              }
            </div>
          }
          <div class="list">
            @for (l of g.lines; track l.task.id) {
              <div class="task" [style.border-left]="'4px solid ' + listColor(l.task.listId)" (click)="store.editTaskItem(l.task.id)">
                <button class="tick" (click)="$event.stopPropagation(); store.toggleTask(l.task.id)" [attr.aria-label]="'Cocher ' + l.task.text"></button>
                <div class="t-body">
                  <div class="t-text">{{ l.task.text }}</div>
                  <!-- Les liens vers le reste du foyer : un tap, et on y est. -->
                  @if (l.task.shopListId || l.task.contractId || l.task.docId) {
                    <div class="links">
                      @if (l.task.shopListId) {
                        <button class="shop-link" (click)="$event.stopPropagation(); store.openShoppingList(l.task.shopListId!)">
                          <f-icon name="panier" [size]="14" color="var(--sage)" [width]="2.2" />
                          {{ store.shopRemaining(l.task.shopListId!) }} article{{ store.shopRemaining(l.task.shopListId!) > 1 ? 's' : '' }} à prendre
                          <f-icon name="chevronRight" [size]="13" color="var(--sage)" [width]="2.4" />
                        </button>
                      }
                      @if (l.task.contractId) {
                        <button class="shop-link ext" (click)="$event.stopPropagation(); fin.openContract(l.task.contractId!)">
                          <f-icon name="budget" [size]="14" color="var(--ink2)" [width]="2.2" /> Ouvrir le contrat
                          <f-icon name="chevronRight" [size]="13" color="var(--ink2)" [width]="2.4" />
                        </button>
                      }
                      @if (l.task.docId) {
                        <button class="shop-link ext" (click)="$event.stopPropagation(); store.openDocument(l.task.docId!)">
                          <f-icon name="documents" [size]="14" color="var(--ink2)" [width]="2.2" /> <span class="clip">{{ docName(l.task.docId!) }}</span>
                          <f-icon name="chevronRight" [size]="13" color="var(--ink2)" [width]="2.4" />
                        </button>
                      }
                    </div>
                  }
                  @if (l.task.due || l.task.cat || l.task.note || active() === 'all') {
                    <div class="t-meta">
                      @if (l.task.due) { <span class="due" [class.late]="l.late > 0">{{ dueOf(l.task) }}@if (l.late > 0) { <span class="late-n"> · depuis {{ lateLabel(l.late) }}</span> }</span> }
                      @if (l.task.rec) { <span class="rec" [title]="recOf(l.task)"><f-icon name="refresh" [size]="12" color="var(--ink3)" [width]="2.4" /> {{ recOf(l.task) }}</span> }
                      @if (l.task.remind && l.task.due) { <span class="rec" title="Rappel"><f-icon name="bell" [size]="12" color="var(--ink3)" [width]="2.4" /> {{ remindOf(l.task) }}</span> }
                      @if (l.task.cat) { <span class="pill" [style.background]="tint(listColor(l.task.listId))" [style.color]="listColor(l.task.listId)">{{ l.task.cat }}</span> }
                      @if (l.task.note) { <span class="note-mark" [title]="l.task.note"><f-icon name="edit" [size]="12" color="var(--ink3)" [width]="2.2" /> note</span> }
                      @if (active() === 'all') { <span class="list-badge" [style.color]="listColor(l.task.listId)"><span class="dot" [style.background]="listColor(l.task.listId)"></span>{{ listName(l.task.listId) }}</span> }
                    </div>
                  }
                </div>
                @if (g.key === 'late' || g.key === 'today') {
                  <button class="later" (click)="$event.stopPropagation(); store.postponeTask(l.task.id)">demain</button>
                }
                @if (l.task.who.length) { <f-who [badges]="badges(l.task)" [size]="22" /> }
              </div>
            }
          </div>
        </div>
      } @empty {
        @if (lists().length) { <div class="empty">Rien à faire ici 🎉</div> }
      }

      <!-- Terminées, repliées : ce qui est fait n'a pas à occuper l'écran. -->
      @if (done().length) {
        <button class="done-toggle" (click)="store.patch({ showDone: !store.ui().showDone })">
          <f-icon [name]="store.ui().showDone ? 'chevronDown' : 'chevronRight'" [size]="15" color="var(--ink2)" [width]="2.4" />
          Terminées · {{ done().length }}
        </button>
        @if (store.ui().showDone) {
          <div class="list">
            @for (t of done(); track t.id) {
              <div class="task done" (click)="store.editTaskItem(t.id)">
                <button class="tick on" (click)="$event.stopPropagation(); store.toggleTask(t.id)" [attr.aria-label]="'Rouvrir ' + t.text"><f-icon name="check" [size]="14" color="#fff" [width]="3.4" /></button>
                <div class="t-body">
                  <div class="t-text strike">{{ t.text }}</div>
                  <div class="t-sub muted">{{ doneBy(t) }}{{ active() === 'all' ? ' · ' + listName(t.listId) : '' }}</div>
                </div>
              </div>
            }
          </div>
        }
      }
    </div>

    <!-- Modifier une tâche, ou en créer une depuis le menu « + » -->
    @if (editing() || store.ui().taskNew) {
      <f-modal [title]="editing() ? 'Modifier la tâche' : 'Nouvelle tâche'" [maxWidth]="520" (close)="closeTask()">
        <app-task-composer [task]="editing()" (saved)="saveTask($event)" (deleted)="store.removeTask(editing()!.id, $event)" (closed)="closeTask()" />
        @if (editing()?.history?.length) {
          <!-- Les réalisations d'une série : la dernière d'abord, cinq au plus. -->
          <div class="hist">
            <div class="field-label">Réalisations · {{ editing()!.history!.length }}</div>
            @for (h of lastDone(); track h.at) {
              <div class="hist-line">{{ store.fmtNumDate(h.at.slice(0, 10)) }}{{ h.by ? ' par ' + store.memberName(h.by) : '' }}@if (h.due) { <span class="hist-due"> · prévue le {{ store.fmtNumDate(h.due) }}</span> }</div>
            }
          </div>
        }
      </f-modal>
    }

    <!-- Liste : nom, type, portée, couleur, icône -->
    @if (store.ui().listForm) {
      <f-modal [title]="store.ui().listEditId ? 'Modifier la liste' : 'Nouvelle liste'" [maxWidth]="460" (close)="store.patch({ listForm: false })">
        <div class="field-label">Nom de la liste</div>
        <input class="input" placeholder="Ex : Bricolage, Valise, Idées…"
               [ngModel]="store.ui().lName" (ngModelChange)="store.patch({ lName: $event })" (keydown.enter)="store.saveTaskList()" />

        <div class="field-label mt">Type</div>
        <div class="seg">
          @for (k of kinds; track k) {
            <button [class.active]="store.ui().lKind === k" (click)="store.patch({ lKind: k })">{{ kindLabel(k) }}</button>
          }
        </div>
        <div class="plan-hint">{{ kindHint(store.ui().lKind) }}</div>

        <div class="field-label mt">Qui la voit</div>
        <div class="seg">
          <button [class.active]="store.ui().lScope === 'shared'" (click)="store.patch({ lScope: 'shared' })">Tout le foyer</button>
          <button [class.active]="store.ui().lScope !== 'shared'" (click)="store.patch({ lScope: store.currentMemberId() || 'shared' })">Moi seulement</button>
        </div>
        @if (store.ui().lScope !== 'shared') { <div class="plan-hint">Cachée aux autres membres, pas chiffrée.</div> }

        <div class="field-label mt">Couleur</div>
        <div class="swatch-row">
          @for (c of palette; track c) {
            <div class="swatch" [style.background]="c" [class.on]="store.ui().lColor === c" (click)="store.patch({ lColor: c })"></div>
          }
        </div>

        <div class="field-label mt">Icône</div>
        <div class="icon-grid">
          @for (k of iconKeys; track k) {
            <div class="ic-cell" [class.on]="store.ui().lIcon === k"
                 [style.background]="store.ui().lIcon === k ? tint(store.ui().lColor) : 'var(--soft)'"
                 (click)="store.patch({ lIcon: k })">
              <f-icon [path]="listIcons[k]" [size]="20" [color]="store.ui().lIcon === k ? store.ui().lColor : 'var(--ink2)'" [width]="2" />
            </div>
          }
        </div>

        <div class="actions">
          <button class="btn btn-soft grow" (click)="store.patch({ listForm: false })">Annuler</button>
          <button class="btn btn-primary grow2" (click)="store.saveTaskList()">Enregistrer</button>
        </div>
      </f-modal>
    }

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

    <!-- Supprimer une liste -->
    @if (store.ui().listDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ listDelId: null })">
        <div class="confirm">
          <div class="warn"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="confirm-title">Supprimer cette liste ?</div>
          <div class="confirm-sub">« {{ delListName() }} » et ses {{ delListCount() }} tâches seront supprimées. Pour la garder sans l’afficher, archivez-la plutôt.</div>
          <div class="actions">
            <button class="btn btn-soft grow" (click)="store.patch({ listDelId: null })">Annuler</button>
            <button class="btn btn-primary grow" (click)="store.confirmTaskListDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .chips { display: flex; gap: 9px; flex-wrap: wrap; align-items: center; margin-bottom: 18px; }
    .chip-l { display: flex; align-items: center; gap: 8px; padding: 9px 15px; border-radius: var(--r-chip); font-size: 13.5px; font-weight: 800; cursor: pointer; box-shadow: 0 6px 14px -12px rgba(90,60,40,.6); }
    .chip-l.archived { opacity: .55; }
    .chip-l .cc { font-size: 12px; }
    .chip-new { display: flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: var(--r-chip); font-size: 13px; font-weight: 800; cursor: pointer; color: var(--primary); border: 2px dashed var(--line2); }
    .chip-soft { border: none; background: transparent; color: var(--ink3); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; padding: 6px 4px; }

    .sync { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 9px 12px; border-radius: 12px; background: var(--soft); font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .sync.off { background: #FCE9E3; color: #C6492F; }

    .head-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .ident { display: flex; align-items: center; gap: 10px; margin-right: 4px; }
    .ident-ic { width: 34px; height: 34px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex: none; }
    .ident-ic.sm { width: 30px; height: 30px; border-radius: 9px; }
    .ident-name { font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--ink); line-height: 1.1; }
    .ident-sub { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .spacer { flex: 1; }
    .btn.sm { padding: 8px 12px; font-size: 12.5px; display: inline-flex; align-items: center; gap: 6px; }

    .compose { margin-bottom: 22px; }

    .group { margin-bottom: 20px; }
    .g-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
    .col-title { font-size: 13px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .06em; }
    .g-act { border: none; background: var(--soft2); color: var(--ink2); font: inherit; font-size: 12px; font-weight: 800; padding: 6px 10px; border-radius: 9px; cursor: pointer; }
    .list { display: flex; flex-direction: column; gap: 10px; }

    .task { display: flex; align-items: center; gap: 12px; background: var(--surface); border-radius: 16px; padding: 14px 16px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); cursor: pointer; }
    .task.done { background: var(--soft2); box-shadow: none; }
    /* Une cible de 44 px pour le pouce, dessinée à 24 : le geste du magasin, sans confirmation. */
    .tick { width: 24px; height: 24px; flex: none; border-radius: 8px; border: 2px solid var(--line2); background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; position: relative; padding: 0; }
    .tick::before { content: ''; position: absolute; inset: -10px; }
    .tick.on { background: var(--sage); border-color: var(--sage); }
    .t-body { flex: 1; min-width: 0; }
    .links { display: flex; flex-wrap: wrap; gap: 6px; margin: 5px 0 2px; }
    .shop-link { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; border: none; border-radius: 9px; background: var(--soft2); color: var(--sage); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; max-width: 100%; }
    .shop-link.ext { color: var(--ink2); }
    .clip { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .t-text { font-size: 15px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .t-text.strike { color: var(--ink3); text-decoration: line-through; }
    .t-meta { display: flex; align-items: center; gap: 7px; margin-top: 5px; flex-wrap: wrap; }
    .due { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    /* Le retard se dit, il ne crie pas : une précision, pas une alarme. */
    .due.late { color: var(--ink2); }
    .late-n { color: var(--ink3); }
    .pill { font-size: 11px; font-weight: 800; padding: 2px 9px; border-radius: 7px; }
    .note-mark { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 800; color: var(--ink3); }
    .rec { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 800; color: var(--ink3); }
    .hist { margin-top: 18px; }
    .hist-line { font-size: 12.5px; font-weight: 700; color: var(--ink2); padding: 4px 0; }
    .hist-due { color: var(--ink3); }
    .list-badge { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 800; background: var(--soft2); padding: 2px 8px; border-radius: 6px; }
    .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
    .later { flex: none; border: none; cursor: pointer; padding: 6px 10px; border-radius: 8px; background: var(--soft2); color: var(--ink2); font: inherit; font-size: 11.5px; font-weight: 800; }
    .t-sub.muted { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 3px; }
    .empty { color: var(--ink3); font-weight: 700; font-size: 13.5px; padding: 16px 0; }
    .done-toggle { display: flex; align-items: center; gap: 6px; border: none; background: transparent; cursor: pointer; font: inherit; font-size: 13px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .06em; padding: 6px 0 12px; }

    .field-label.mt { margin-top: 18px; }
    .plan-hint { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; }
    .icon-grid { display: flex; flex-wrap: wrap; gap: 9px; }
    .ic-cell { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .ic-cell.on { box-shadow: inset 0 0 0 2px currentColor; }

    .tpls { display: flex; flex-direction: column; gap: 8px; }
    .tpl { display: flex; align-items: center; gap: 8px; }
    .tpl-main { flex: 1; display: flex; align-items: center; gap: 12px; border: none; background: var(--soft); border-radius: 14px; padding: 10px 12px; cursor: pointer; text-align: left; font: inherit; }
    .tpl-body { display: flex; flex-direction: column; }
    .tpl-name { font-size: 14px; font-weight: 800; color: var(--ink); }
    .tpl-sub { font-size: 12px; font-weight: 700; color: var(--ink3); }

    .actions { display: flex; gap: 12px; align-items: center; margin-top: 26px; }
    .actions .grow { flex: 1; }
    .actions .grow2 { flex: 1.4; }

    .confirm { text-align: center; }
    .warn { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: var(--soft2); display: flex; align-items: center; justify-content: center; }
    .confirm-title { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-sub { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 4px; }
  `],
})
export class TachesScreen {
  store = inject(FoyerStore);
  fin = inject(FinancesStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  readonly tint = tint;
  readonly palette = PALETTE;
  readonly listIcons = LIST_ICONS;
  readonly iconKeys = Object.keys(LIST_ICONS);
  readonly kinds = KIND_ORDER;

  active = computed(() => this.store.ui().activeList);
  /** Les listes visibles, dans l'ordre des types puis des positions. */
  lists = computed(() => {
    const all = this.store.visibleTaskLists(this.store.ui().showArchived);
    return all.slice().sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.position ?? 0) - (b.position ?? 0));
  });
  archivedCount = computed(() => this.store.visibleTaskLists(true).filter((l) => l.archived).length);
  templates = computed(() => this.d().taskTemplates);
  activeObj = computed(() => this.d().taskLists.find((l) => l.id === this.active()) || null);
  /** L'affaire du jour : ce que « Toutes » montre et compte. */
  private daily = computed(() => dailyTasks(this.d().tasks, this.d().taskLists, this.store.currentMemberId()));
  allOpen = computed(() => this.daily().filter((t) => !t.done).length);

  private scoped = computed<TaskItem[]>(() => {
    const a = this.active();
    return a === 'all' ? this.daily() : this.d().tasks.filter((t) => t.listId === a);
  });
  groups = computed<TaskGroup[]>(() => groupOpen(this.scoped(), this.store.todayStr(), this.activeObj()?.kind || 'taches'));
  done = computed(() => doneTasks(this.scoped()));
  editing = computed(() => { const id = this.store.ui().taskEdit; return id ? this.store.task(id) || null : null; });

  delListName = computed(() => this.d().taskLists.find((l) => l.id === this.store.ui().listDelId)?.name || '');
  delListCount = computed(() => this.d().tasks.filter((t) => t.listId === this.store.ui().listDelId).length);

  iconOf(l: TaskList): string { return LIST_ICONS[l.icon] || LIST_ICONS['checklist']; }
  kindLabel(k: ListKind): string { return KIND_LABELS[k]; }
  kindHint(k: ListKind): string {
    return k === 'taches' ? 'L’affaire du jour : compte dans « Toutes » et sur l’accueil.'
      : k === 'corvees' ? 'Des cases à cocher, lisibles par un enfant. Hors de « Toutes » et de l’accueil.'
      : 'Valise, fournitures, idées : une liste qu’on refait. Hors de « Toutes » et de l’accueil.';
  }
  undoneCount(listId: string): number { return this.d().tasks.filter((t) => t.listId === listId && !t.done).length; }
  private list(id: string): TaskList | undefined { return this.d().taskLists.find((l) => l.id === id); }
  listColor(id: string): string { return this.list(id)?.color || 'var(--primary)'; }
  listName(id: string): string { return this.list(id)?.name || 'Liste supprimée'; }
  docName(id: string): string { return this.d().files.find((f) => f.id === id)?.name || 'Document supprimé'; }
  badges(t: TaskItem) { return whoBadges(t, this.d().members); }
  dueOf(t: TaskItem): string { return dueLabel(t.due, t.time, this.store.todayStr(), (iso) => this.store.fmtNumDate(iso), t.rec?.grace); }
  recOf(t: TaskItem): string { return t.rec ? recLabel(t.rec, (iso) => this.store.fmtNumDate(iso)) : ''; }
  remindOf(t: TaskItem): string { return t.remind ? REMIND_LABELS[t.remind].toLowerCase() : ''; }
  lastDone() { return (this.editing()?.history || []).slice(-5).reverse(); }
  lateLabel(days: number): string {
    if (days < 7) return days + (days > 1 ? ' jours' : ' jour');
    if (days < 60) { const w = Math.round(days / 7); return w + (w > 1 ? ' semaines' : ' semaine'); }
    return Math.round(days / 30) + ' mois';
  }
  doneBy(t: TaskItem): string {
    const qui = t.doneBy ? this.store.memberName(t.doneBy) : '';
    const quand = t.doneAt ? this.store.fmtNumDate(t.doneAt.slice(0, 10)) : '';
    return [qui ? 'par ' + qui : '', quand ? 'le ' + quand : ''].filter(Boolean).join(' ') || 'Faite';
  }
  postponeAll(g: TaskGroup, to: string): void { this.store.postponeTasks(g.lines.map((l) => l.task.id), to); }

  closeTask(): void { this.store.patch({ taskEdit: null, taskNew: false }); }
  saveTask(draft: TaskDraft & { scope: 'one' | 'all' }): void {
    const t = this.editing();
    if (t) {
      this.store.updateTask(t.id, { text: draft.text, listId: draft.listId, who: draft.who, due: draft.due, time: draft.due ? draft.time : null, cat: draft.cat.trim(), note: draft.note.trim(), rec: draft.rec, remind: draft.due ? draft.remind : null, docId: draft.docId }, draft.scope);
      if (draft.scope === 'all') this.store.toast(t.rec || draft.rec ? 'Série modifiée' : 'Tâche modifiée');
    } else {
      this.store.createTask(draft);
      this.store.toast('Tâche ajoutée');
    }
    this.closeTask();
  }
}
