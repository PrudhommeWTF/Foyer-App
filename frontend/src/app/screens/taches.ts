import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { ModalComponent } from '../shared/modal';
import { LIST_ICONS, PALETTE, tint } from '../core/constants';
import { Prio, TaskItem, TaskList } from '../core/models';

@Component({
  selector: 'screen-taches',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <!-- List chips -->
      <div class="chips">
        <div class="chip-l" [class.active]="active() === 'all'" (click)="store.patch({ activeList: 'all' })"
             [style.background]="active() === 'all' ? 'var(--primary)' : 'var(--soft)'"
             [style.color]="active() === 'all' ? '#fff' : 'var(--ink)'">
          <f-icon name="taches" [size]="16" [color]="active() === 'all' ? '#fff' : 'var(--primary)'" [width]="2" />
          Toutes
          <span class="cc" [style.color]="active() === 'all' ? 'rgba(255,255,255,.8)' : 'var(--ink3)'">{{ allOpen() }}</span>
        </div>

        @for (l of lists(); track l.id) {
          <div class="chip-l" [class.active]="active() === l.id" (click)="store.patch({ activeList: l.id })"
               [style.background]="active() === l.id ? l.color : 'var(--soft)'"
               [style.color]="active() === l.id ? '#fff' : 'var(--ink)'">
            <f-icon [path]="iconOf(l)" [size]="16" [color]="active() === l.id ? '#fff' : l.color" [width]="2" />
            {{ l.name }}
            <span class="cc" [style.color]="active() === l.id ? 'rgba(255,255,255,.8)' : 'var(--ink3)'">{{ undoneCount(l.id) }}</span>
          </div>
        }

        <div class="chip-new" (click)="store.newTaskList()">
          <f-icon name="plus" [size]="15" color="var(--primary)" [width]="2.6" />
          Nouvelle liste
        </div>
      </div>

      <!-- Active list header -->
      <div class="head-row">
        @if (activeObj(); as l) {
          <div class="ident">
            <div class="ident-ic" [style.background]="l.color"><f-icon [path]="iconOf(l)" [size]="18" color="#fff" [width]="2" /></div>
            <span class="ident-name">{{ l.name }}</span>
          </div>
          <button class="icon-btn" (click)="store.editTaskList(l.id)"><f-icon name="edit" [size]="15" color="var(--ink2)" [width]="2" /></button>
          <button class="icon-btn" (click)="store.patch({ listDelId: l.id })"><f-icon name="trash" [size]="15" color="var(--primary)" [width]="2" /></button>
        } @else {
          <div class="ident">
            <div class="ident-ic" style="background:var(--primary)"><f-icon name="taches" [size]="18" color="#fff" [width]="2" /></div>
            <span class="ident-name">Toutes les tâches</span>
          </div>
        }
        <div class="spacer"></div>
        <button class="btn btn-primary" (click)="store.openTask()"><f-icon name="plus" [size]="17" color="#fff" [width]="2.4" /> Nouvelle tâche</button>
      </div>

      <!-- Quick add -->
      <div class="quick">
        <input class="input" placeholder="Ajouter vite une tâche à cette liste…"
               [ngModel]="store.ui().newTask" (ngModelChange)="store.patch({ newTask: $event })"
               (keydown.enter)="store.addTaskQuick()" />
        <button class="add-btn" (click)="store.addTaskQuick()"><f-icon name="plus" [size]="22" color="#fff" [width]="2.4" /></button>
      </div>

      <!-- Columns -->
      <div class="cols">
        <div>
          <div class="col-title">À faire · {{ open().length }}</div>
          <div class="list">
            @for (t of open(); track t.id) {
              <div class="task" [style.border-left]="'4px solid ' + listColor(t.listId)" (click)="store.editTaskItem(t.id)">
                <span class="tick" (click)="$event.stopPropagation(); store.toggleTask(t.id)"></span>
                <div class="t-body">
                  <div class="t-text">{{ t.text }}</div>
                  <div class="t-meta">
                    <f-avatar [ini]="store.memberIni(t.who)" [color]="store.memberColor(t.who)" [size]="18" />
                    <span class="t-sub">{{ store.memberName(t.who) }} · {{ t.due }}</span>
                    <span class="pill" [style.background]="tint(prioColor(t.prio))" [style.color]="prioColor(t.prio)">{{ prioLabel(t.prio) }}</span>
                    <span class="list-badge" [style.color]="listColor(t.listId)"><span class="dot" [style.background]="listColor(t.listId)"></span>{{ listName(t.listId) }}</span>
                  </div>
                </div>
                <f-icon name="edit" [size]="15" color="var(--ink3)" [width]="2" />
              </div>
            } @empty { <div class="empty">Rien à faire ici 🎉</div> }
          </div>
        </div>

        <div>
          <div class="col-title">Terminées · {{ done().length }}</div>
          <div class="list">
            @for (t of done(); track t.id) {
              <div class="task done" (click)="store.editTaskItem(t.id)">
                <span class="tick on" (click)="$event.stopPropagation(); store.toggleTask(t.id)"><f-icon name="check" [size]="14" color="#fff" [width]="3.4" /></span>
                <div class="t-body">
                  <div class="t-text strike">{{ t.text }}</div>
                  <div class="t-sub muted">{{ store.memberName(t.who) }} · {{ listName(t.listId) }}</div>
                </div>
              </div>
            } @empty { <div class="empty">Aucune tâche terminée</div> }
          </div>
        </div>
      </div>
    </div>

    <!-- Task modal -->
    @if (store.ui().showTask) {
      <f-modal [title]="store.ui().taskEditId ? 'Modifier la tâche' : 'Nouvelle tâche'" [maxWidth]="470" (close)="store.patch({ showTask: false })">
        <div class="field-label">Intitulé</div>
        <input class="input" placeholder="Ex : Prendre rendez-vous chez le coiffeur"
               [ngModel]="store.ui().tTitle" (ngModelChange)="store.patch({ tTitle: $event })" />

        <div class="field-label mt">Liste</div>
        <div class="seg-wrap">
          @for (l of lists(); track l.id) {
            <button class="lchip" [class.active]="store.ui().tListId === l.id"
                    [style.border-color]="store.ui().tListId === l.id ? l.color : 'var(--line2)'"
                    (click)="store.patch({ tListId: l.id })">
              <span class="dot" [style.background]="l.color"></span>{{ l.name }}
            </button>
          }
        </div>

        <div class="field-label mt">Assigné à</div>
        <div class="members">
          @for (m of d().members; track m.id) {
            <div class="mem" (click)="store.patch({ tWho: m.id })">
              <f-avatar [ini]="m.ini" [color]="m.color" [size]="46" [border]="store.ui().tWho === m.id ? '3px solid var(--surface)' : '3px solid transparent'" />
              <span class="mem-name" [class.on]="store.ui().tWho === m.id">{{ m.name }}</span>
            </div>
          }
        </div>

        <div class="field-label mt">Échéance</div>
        <input class="input" placeholder="Ex : Demain, 18 juillet…"
               [ngModel]="store.ui().tDue" (ngModelChange)="store.patch({ tDue: $event })" />
        <div class="due-chips">
          @for (d of dueChips; track d) {
            <button class="chip" [class.active]="store.ui().tDue === d" (click)="store.patch({ tDue: d })">{{ d }}</button>
          }
        </div>

        <div class="field-label mt">Priorité</div>
        <div class="seg">
          @for (p of prios; track p.k) {
            <button [class.active]="store.ui().tPrio === p.k" (click)="store.patch({ tPrio: p.k })">{{ p.label }}</button>
          }
        </div>

        <div class="field-label mt">Date de planification (option.)</div>
        <div class="plan-row">
          <input class="input" type="date" [ngModel]="store.ui().tPlanned" (ngModelChange)="store.patch({ tPlanned: $event })" />
          @if (store.ui().tPlanned) { <button class="btn btn-soft" (click)="store.patch({ tPlanned: '' })">Effacer</button> }
        </div>
        <div class="plan-hint">Une date planifiée fait apparaître la tâche dans le calendrier.</div>

        <div class="actions">
          @if (store.ui().taskEditId) {
            <button class="btn btn-soft del" (click)="store.delTask()"><f-icon name="trash" [size]="18" color="var(--primary)" [width]="2.2" /></button>
          }
          <button class="btn btn-soft grow" (click)="store.patch({ showTask: false })">Annuler</button>
          <button class="btn btn-primary grow2" (click)="store.saveTask()">Enregistrer</button>
        </div>
      </f-modal>
    }

    <!-- List modal -->
    @if (store.ui().listForm) {
      <f-modal [title]="store.ui().listEditId ? 'Modifier la liste' : 'Nouvelle liste'" [maxWidth]="440" (close)="store.patch({ listForm: false })">
        <div class="field-label">Nom de la liste</div>
        <input class="input" placeholder="Ex : Bricolage, Départ en vacances…"
               [ngModel]="store.ui().lName" (ngModelChange)="store.patch({ lName: $event })" />

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

    <!-- Delete confirm -->
    @if (store.ui().listDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ listDelId: null })">
        <div class="confirm">
          <div class="warn"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="confirm-title">Supprimer cette liste ?</div>
          <div class="confirm-sub">« {{ delListName() }} » et ses {{ delListCount() }} tâches seront supprimées. Cette action est définitive.</div>
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
    .chip-l .cc { font-size: 12px; }
    .chip-new { display: flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: var(--r-chip); font-size: 13px; font-weight: 800; cursor: pointer; color: var(--primary); border: 2px dashed var(--line2); }

    .head-row { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .ident { display: flex; align-items: center; gap: 10px; }
    .ident-ic { width: 34px; height: 34px; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .ident-name { font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--ink); }
    .spacer { flex: 1; }

    .quick { display: flex; gap: 12px; margin-bottom: 22px; }
    .quick .input { flex: 1; }
    .add-btn { width: 46px; height: 46px; flex: none; border: none; border-radius: 12px; background: var(--primary); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 8px 16px -8px rgba(229,107,78,.7); }

    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
    :host-context(.shell.narrow) .cols { grid-template-columns: 1fr; }
    @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }
    .col-title { font-size: 13px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 12px; }
    .list { display: flex; flex-direction: column; gap: 12px; }

    .task { display: flex; align-items: center; gap: 14px; background: var(--surface); border-radius: 16px; padding: 16px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); cursor: pointer; }
    .task.done { background: var(--soft2); box-shadow: none; }
    .tick { width: 24px; height: 24px; flex: none; border-radius: 8px; border: 2px solid var(--line2); background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .tick.on { background: var(--sage); border-color: var(--sage); }
    .t-body { flex: 1; min-width: 0; }
    .t-text { font-size: 15px; font-weight: 700; color: var(--ink); }
    .t-text.strike { color: var(--ink3); text-decoration: line-through; }
    .t-meta { display: flex; align-items: center; gap: 7px; margin-top: 5px; flex-wrap: wrap; }
    .t-sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .pill { font-size: 11px; font-weight: 800; padding: 2px 9px; border-radius: 7px; }
    .list-badge { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 800; background: var(--soft2); padding: 2px 8px; border-radius: 6px; }
    .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
    .t-sub.muted { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 3px; }
    .empty { color: var(--ink3); font-weight: 700; font-size: 13.5px; padding: 16px 0; }

    .field-label.mt { margin-top: 18px; }
    .plan-row { display: flex; gap: 10px; align-items: center; }
    .plan-row .input { flex: 1; }
    .plan-hint { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; }
    .seg-wrap { display: flex; flex-wrap: wrap; gap: 9px; }
    .lchip { display: flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 11px; font-size: 13.5px; font-weight: 800; cursor: pointer; background: var(--soft); color: var(--ink); border: 2px solid var(--line2); }
    .lchip.active { background: var(--surface); }
    .members { display: flex; gap: 16px; flex-wrap: wrap; }
    .mem { display: flex; flex-direction: column; align-items: center; gap: 7px; cursor: pointer; }
    .mem-name { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .mem-name.on { color: var(--ink); }
    .due-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .icon-grid { display: flex; flex-wrap: wrap; gap: 9px; }
    .ic-cell { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .ic-cell.on { box-shadow: inset 0 0 0 2px currentColor; }

    .actions { display: flex; gap: 12px; align-items: center; margin-top: 26px; }
    .actions .grow { flex: 1; }
    .actions .grow2 { flex: 1.4; }
    .actions .del { width: 50px; flex: none; padding: 0; }

    .confirm { text-align: center; }
    .warn { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: var(--soft2); display: flex; align-items: center; justify-content: center; }
    .confirm-title { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-sub { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 4px; }
  `],
})
export class TachesScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  readonly tint = tint;
  readonly palette = PALETTE;
  readonly listIcons = LIST_ICONS;
  readonly iconKeys = Object.keys(LIST_ICONS);
  readonly dueChips = ["Aujourd'hui", 'Demain', 'Cette semaine'];
  readonly prios: { k: Prio; label: string }[] = [
    { k: 'low', label: 'Basse' },
    { k: 'med', label: 'Moyenne' },
    { k: 'high', label: 'Haute' },
  ];

  active = computed(() => this.store.ui().activeList);
  lists = computed(() => this.d().taskLists);
  allOpen = computed(() => this.d().tasks.filter((t) => !t.done).length);
  activeObj = computed(() => this.d().taskLists.find((l) => l.id === this.active()) || null);

  private scoped = computed<TaskItem[]>(() => {
    const a = this.active();
    return a === 'all' ? this.d().tasks : this.d().tasks.filter((t) => t.listId === a);
  });
  open = computed(() => this.scoped().filter((t) => !t.done));
  done = computed(() => this.scoped().filter((t) => t.done));

  delListName = computed(() => this.d().taskLists.find((l) => l.id === this.store.ui().listDelId)?.name || '');
  delListCount = computed(() => this.d().tasks.filter((t) => t.listId === this.store.ui().listDelId).length);

  iconOf(l: TaskList): string { return LIST_ICONS[l.icon] || LIST_ICONS['checklist']; }
  undoneCount(listId: string): number { return this.d().tasks.filter((t) => t.listId === listId && !t.done).length; }
  private list(id: string): TaskList | undefined { return this.d().taskLists.find((l) => l.id === id); }
  listColor(id: string): string { return this.list(id)?.color || 'var(--primary)'; }
  listName(id: string): string { return this.list(id)?.name || ''; }
  prioColor(p: Prio): string { return p === 'low' ? '#7A9B76' : p === 'high' ? '#E56B4E' : '#F0B24B'; }
  prioLabel(p: Prio): string { return p === 'low' ? 'Basse' : p === 'high' ? 'Haute' : 'Moyenne'; }
}
