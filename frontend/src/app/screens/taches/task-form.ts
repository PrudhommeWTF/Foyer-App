import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ReorderDirective } from '../../shared/reorder';
import { TaskItem } from '../../core/models';
import { subProgress, subtasksOf } from '../../core/tasks';
import { draftFields, taskDraftChanges } from '../../core/task-ops';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';
import { TaskComposerComponent } from './composer';

/**
 * Le formulaire d'une tâche dans la fiche : la saisie habituelle
 * (`app-task-composer`, sans son pied), et pour une tâche existante ses
 * sous-tâches, qu'on ajoute, coche, range ou retire sur place.
 */
@Component({
  selector: 'app-task-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ReorderDirective, TaskComposerComponent],
  template: `
    <app-task-composer [task]="item()" [embedded]="true" />
    @if (item(); as t) {
      @if (!t.parentId) {
        <!-- Un seul niveau : une sous-tâche n'a pas de bloc à elle. -->
        <div class="subs-edit">
          <div class="field-label">Sous-tâches{{ progress() ? ' · ' + progress() : '' }}</div>
          <div class="sub-list" [fReorder]="subIds()" (reordered)="store.reorderTasks($event)">
            @for (sb of subs(); track sb.id) {
              <div class="sub-edit" [attr.data-rid]="sb.id">
                <button type="button" class="grip" data-grip [attr.aria-label]="'Déplacer ' + sb.text">
                  <f-icon name="grip" [size]="16" color="var(--ink3)" [width]="2.8" />
                </button>
                <button type="button" class="tick" [class.on]="sb.done" (click)="store.toggleTask(sb.id)" [attr.aria-label]="(sb.done ? 'Rouvrir ' : 'Cocher ') + sb.text">
                  @if (sb.done) { <f-icon name="check" [size]="11" color="#fff" [width]="3.4" /> }
                </button>
                <span class="sub-text" [class.strike]="sb.done">{{ sb.text }}</span>
                <button type="button" class="icon-btn sm" (click)="store.removeTask(sb.id)" [attr.aria-label]="'Supprimer ' + sb.text">
                  <f-icon name="trash" [size]="14" color="var(--primary)" [width]="2" />
                </button>
              </div>
            }
          </div>
          <input class="input sub-add" placeholder="Ajouter une sous-tâche…" enterkeyhint="done" autocomplete="off"
                 [ngModel]="subText()" (ngModelChange)="subText.set($event)" (keydown.enter)="addSub(t.id)" />
          <div class="plan-hint">Une sous-tâche porte un intitulé et des membres, pas de date ni de rappel : ceux du parent suffisent.</div>
        </div>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .subs-edit { margin-top: 20px; }
    .sub-list { display: flex; flex-direction: column; gap: 6px; }
    .sub-edit { display: flex; align-items: center; gap: 9px; background: var(--soft); border-radius: 12px; padding: 8px 12px; }
    .grip { flex: none; border: none; background: transparent; cursor: grab; padding: 4px; margin-left: -4px; border-radius: 7px; touch-action: none; display: flex; align-items: center; }
    .tick { width: 18px; height: 18px; flex: none; border-radius: 6px; border: 2px solid var(--line2); background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; position: relative; }
    .tick::before { content: ''; position: absolute; inset: -10px; }
    .tick.on { background: var(--sage); border-color: var(--sage); }
    .sub-text { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: var(--ink2); overflow-wrap: anywhere; }
    .sub-text.strike { color: var(--ink3); text-decoration: line-through; }
    .sub-add { margin-top: 10px; padding: 9px 12px; font-size: 13.5px; }
    .plan-hint { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; }
  `],
})
export class TaskForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  readonly item = input<TaskItem | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);

  private readonly composer = viewChild.required(TaskComposerComponent);
  /** La tâche telle qu'à l'ouverture : c'est contre elle que se mesure « quelque chose a changé ». */
  private base: TaskItem | null = null;
  ngOnInit(): void { this.base = untracked(() => this.item()); }

  readonly dirty = computed(() => {
    const d = this.composer().draft();
    return this.base ? taskDraftChanges(this.base, d) : !!d.text;
  });

  submit(scope?: string): ItemResult {
    const d = this.composer().draft();
    if (!d.text) { this.store.toast('Donne un intitulé à la tâche'); return { kind: 'invalid' }; }
    const t = this.item();
    if (!t) {
      if (!this.store.createTask(d)) return { kind: 'invalid' };
      this.store.toast('Tâche ajoutée');
      return { kind: 'done' };
    }
    // Rien de changé : rien n'est envoyé.
    if (!taskDraftChanges(t, d)) return { kind: 'done' };
    if (t.rec && !scope) {
      return { kind: 'ask', question: 'Appliquer la modification à :', choices: [
        { scope: 'one', label: 'Cette occurrence seulement' }, { scope: 'all', label: 'Toute la série' }] };
    }
    const copy = this.store.updateTask(t.id, draftFields(d), scope === 'one' ? 'one' : 'all');
    if (scope !== 'one') this.store.toast(t.rec || d.rec ? 'Série modifiée' : 'Tâche modifiée');
    return copy ? { kind: 'done', id: copy } : { kind: 'done' };
  }

  // ---- sous-tâches : chaque geste part tout de suite, comme dans la liste ----
  readonly subText = signal('');
  readonly subs = computed(() => { const t = this.item(); return t ? subtasksOf(this.store.d().tasks, t.id) : []; });
  readonly subIds = computed(() => this.subs().map((sb) => sb.id));
  readonly progress = computed(() => { const p = subProgress(this.subs()); return p ? `${p.done}/${p.total}` : ''; });
  addSub(parentId: string): void { if (this.store.addSubtask(parentId, this.subText())) this.subText.set(''); }
}
