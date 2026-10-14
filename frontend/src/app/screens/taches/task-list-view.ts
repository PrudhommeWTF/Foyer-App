import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS } from '../../core/constants';
import { KIND_LABELS, openCount } from '../../core/tasks';
import { TaskList } from '../../core/models';
import { ItemCtx } from '../../core/items';

/** La fiche d'une liste de tâches, en lecture : son type, qui la voit, où elle en est ; pour une préparation, le départ et le lieu. */
@Component({
  selector: 'app-task-list-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let l = item();
    <div class="row">
      <span class="ic" [style.background]="l.color"><f-icon [path]="LIST_ICONS[l.icon] || LIST_ICONS['checklist']" [size]="18" color="#fff" [width]="2" /></span>
      <div class="txt"><div class="main">{{ kind() }}</div><div class="sub">{{ who() }}{{ l.archived ? ' · archivée' : '' }}</div></div>
    </div>
    <div class="row">
      <span class="ic"><f-icon name="taches" [size]="17" color="var(--ink2)" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ counts().open ? counts().open + ' à faire' : 'Rien à faire' }}</div>
        @if (counts().done) { <div class="sub">{{ counts().done }} faite{{ counts().done > 1 ? 's' : '' }}</div> }</div>
    </div>
    @if (l.kind === 'taches' || l.kind === 'corvees') {
      <div class="row">
        <span class="ic"><f-icon name="planning" [size]="17" color="var(--ink2)" [width]="2.2" /></span>
        <div class="txt"><div class="main">{{ l.order === 'manuel' ? 'Rangée à la main' : 'Rangée par échéance' }}</div></div>
      </div>
    }
    @if (l.kind === 'preparation') {
      <div class="row">
        <span class="ic"><f-icon name="suitcase" [size]="17" [color]="l.color" [width]="2.2" /></span>
        <div class="txt"><div class="main">{{ departure() }}</div>
          <div class="sub">Rappel {{ l.remindDaysBefore ?? 3 }} jour{{ (l.remindDaysBefore ?? 3) > 1 ? 's' : '' }} avant@if (l.lastResetAt) { · remise à zéro le {{ store.fmtNumDate(l.lastResetAt.slice(0, 10)) }} }</div></div>
      </div>
      @if (place(); as p) {
        <!-- Le lieu de destination s'ouvre par-dessus, et le retour ramène ici. -->
        <button type="button" class="row link" (click)="store.openItem('place', p.id, undefined, true)">
          <span class="ic" [style.background]="p.color"><f-icon name="map-pin" [size]="17" color="#fff" [width]="2.2" /></span>
          <span class="txt"><span class="main">{{ p.name }}</span><span class="sub">Lieu de destination</span></span>
          <f-icon name="chevronRight" [size]="16" color="var(--ink3)" [width]="2.2" />
        </button>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 13px; width: 100%; padding: 11px 0; border: none; background: none; font: inherit; text-align: left; }
    .row + .row { border-top: 1px solid var(--line); }
    .row.link { cursor: pointer; }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .main { font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
  `],
})
export class TaskListView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<TaskList>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly LIST_ICONS = LIST_ICONS;

  readonly kind = computed(() => KIND_LABELS[this.item().kind]);
  readonly who = computed(() => {
    const s = this.item().scope;
    return s === 'shared' ? 'Tout le foyer' : 'Privée, pour ' + (this.store.memberName(s) || 'un membre');
  });
  readonly counts = computed(() => {
    const tasks = this.store.d().tasks.filter((t) => t.listId === this.item().id);
    return { open: openCount(tasks), done: tasks.filter((t) => t.done).length };
  });
  /** « Départ de Léo, samedi 2 novembre » ; sans date, on le dit. */
  readonly departure = computed(() => {
    const l = this.item();
    const who = l.forMember ? 'Départ de ' + this.store.memberName(l.forMember) : 'Départ';
    const date = l.departure ? this.store.fmtLongDate(l.departure) : '';
    return date ? who + ', ' + date.charAt(0).toLowerCase() + date.slice(1) : (l.forMember ? who + ', sans date' : 'Aucune date de départ');
  });
  readonly place = computed(() => { const id = this.item().placeId; return id ? this.store.d().places.find((p) => p.id === id) ?? null : null; });
}
