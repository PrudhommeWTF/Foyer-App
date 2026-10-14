import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS, PALETTE, tint } from '../../core/constants';
import { KIND_LABELS, KIND_ORDER } from '../../core/tasks';
import { ListKind, TaskList } from '../../core/models';
import { KIND_ICONS, TaskListFields, taskListData, taskListFields } from '../../core/task-list-form';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/**
 * Le formulaire d'une liste de tâches dans la fiche : nom, type, qui la voit,
 * l'ordre des tâches, la couleur et l'icône ; pour une préparation, pour qui,
 * le départ, le rappel et le lieu de destination.
 */
@Component({
  selector: 'app-task-list-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @let v = f();
    <div class="field-label">Nom de la liste</div>
    <input class="input" placeholder="Ex : Bricolage, Valise, Idées…" [ngModel]="v.name" (ngModelChange)="set({ name: $event })" />

    <div class="field-label mt">Type</div>
    <div class="seg wrap">
      @for (k of kinds; track k) {
        <button type="button" [class.active]="v.kind === k" (click)="pickKind(k)">{{ kindLabel(k) }}</button>
      }
    </div>
    <div class="plan-hint">{{ kindHint(v.kind) }}</div>

    @if (v.kind === 'preparation') {
      <div class="field-label mt">Pour qui</div>
      <div class="seg-wrap">
        <button type="button" class="seg-opt" [class.on]="!v.forMember" (click)="set({ forMember: null })">Personne</button>
        @for (m of store.d().members; track m.id) {
          <button type="button" class="seg-opt" [class.on]="v.forMember === m.id" (click)="set({ forMember: m.id })">
            <span class="s-dot" [style.background]="m.color"></span>{{ m.name }}
          </button>
        }
      </div>

      <div class="prep-two">
        <div class="grow">
          <div class="field-label">Date de départ</div>
          <input class="input" type="date" [ngModel]="v.departure" (ngModelChange)="set({ departure: $event || '' })" />
        </div>
        <div class="prep-remind">
          <div class="field-label">Rappel</div>
          <div class="remind-row">
            <span>J -</span>
            <input class="input" type="number" min="1" max="30" [ngModel]="v.remind" (ngModelChange)="set({ remind: +$event })" />
          </div>
        </div>
      </div>
      <div class="plan-hint">Un rappel {{ v.remind }} jour{{ v.remind > 1 ? 's' : '' }} avant le départ, tant qu'il reste des affaires à préparer. La liste est partagée : l'enfant peut cocher son sac.</div>

      @if (store.placesInOrder().length) {
        <div class="field-label mt">Lieu de destination <span class="opt">(facultatif)</span></div>
        <div class="seg-wrap">
          <button type="button" class="seg-opt" [class.on]="!v.placeId" (click)="set({ placeId: '' })">Aucun</button>
          @for (p of store.placesInOrder(); track p.id) {
            <button type="button" class="seg-opt" [class.on]="v.placeId === p.id" (click)="set({ placeId: p.id })">
              <span class="s-dot" [style.background]="p.color"></span>{{ p.name }}
            </button>
          }
        </div>
        <div class="plan-hint">L’écran montrera ce qui est déjà sur place, pour ne pas l’emporter, et proposera d’ajouter ce qui reste à la maison.</div>
      }
    } @else {
      <div class="field-label mt">Qui la voit</div>
      <div class="seg">
        <button type="button" [class.active]="v.scope === 'shared'" (click)="set({ scope: 'shared' })">Tout le foyer</button>
        <button type="button" [class.active]="v.scope !== 'shared'" (click)="set({ scope: store.currentMemberId() || 'shared' })">Moi seulement</button>
      </div>
      @if (v.scope !== 'shared') { <div class="plan-hint">Cachée aux autres membres, pas chiffrée.</div> }

      @if (v.kind === 'taches' || v.kind === 'corvees') {
        <div class="field-label mt">Ordre des tâches</div>
        <div class="seg">
          <button type="button" [class.active]="v.order !== 'manuel'" (click)="set({ order: 'echeance' })">Par échéance</button>
          <button type="button" [class.active]="v.order === 'manuel'" (click)="set({ order: 'manuel' })">Manuel</button>
        </div>
        <div class="plan-hint">{{ v.order === 'manuel' ? 'Vous rangez les tâches à la main (glisser-déposer ou à la voix). Les tâches en retard remontent quand même par date, pour ne pas être enterrées.' : 'Les tâches se rangent par date (aujourd’hui, en retard, à venir), l’ordre manuel départageant.' }}</div>
      }
    }

    <div class="field-label mt">Couleur</div>
    <div class="swatch-row">
      @for (c of palette; track c) {
        <button type="button" class="swatch" [style.background]="c" [style.box-shadow]="v.color === c ? '0 0 0 3px var(--surface),0 0 0 5px ' + c : 'none'"
                (click)="set({ color: c })" [attr.aria-label]="'Couleur ' + ($index + 1)" [attr.aria-pressed]="v.color === c"></button>
      }
    </div>

    <div class="field-label mt">Icône</div>
    <div class="icon-grid">
      @for (k of iconKeys; track k) {
        <button type="button" class="ic-cell" [style.background]="v.icon === k ? tint(v.color) : 'var(--soft)'" (click)="set({ icon: k })" [attr.aria-pressed]="v.icon === k" [attr.aria-label]="k">
          <f-icon [path]="listIcons[k]" [size]="20" [color]="v.icon === k ? v.color : 'var(--ink2)'" [width]="2" />
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .field-label.mt { margin-top: 18px; }
    .seg.wrap { flex-wrap: wrap; }
    .plan-hint { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; }
    .opt { color: var(--ink3); font-weight: 700; text-transform: none; letter-spacing: 0; }
    .seg-wrap { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
    .seg-opt { display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; border: 2px solid transparent; border-radius: 11px; font: inherit; font-size: 13px; font-weight: 800; cursor: pointer; background: var(--soft2); color: var(--ink2); }
    .seg-opt.on { background: var(--primary); color: #fff; }
    .seg-opt .s-dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
    .prep-two { display: flex; gap: 14px; margin-top: 18px; flex-wrap: wrap; }
    .prep-two .grow { flex: 1; min-width: 160px; }
    .prep-two .grow .input { width: 100%; box-sizing: border-box; }
    .prep-remind { width: 130px; }
    .remind-row { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 800; color: var(--ink2); }
    .remind-row .input { width: 68px; }
    .icon-grid { display: flex; flex-wrap: wrap; gap: 9px; }
    .ic-cell { width: 42px; height: 42px; border: none; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  `],
})
export class TaskListForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  readonly item = input<TaskList | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly kinds = KIND_ORDER;
  readonly palette = PALETTE;
  readonly listIcons = LIST_ICONS;
  readonly iconKeys = Object.keys(LIST_ICONS);
  readonly tint = tint;

  readonly f = signal<TaskListFields>(taskListFields(null));
  private initial = '';
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);

  ngOnInit(): void { this.f.set(taskListFields(this.item())); this.initial = JSON.stringify(this.f()); }
  submit(scope?: string): ItemResult {
    const data = taskListData(this.f());
    if (typeof data === 'string') { this.store.toast(data); return { kind: 'invalid' }; }
    return this.store.saveTaskList(this.item()?.id ?? null, data, scope);
  }
  set(p: Partial<TaskListFields>): void { this.f.update((f) => ({ ...f, ...p })); }

  kindLabel(k: ListKind): string { return KIND_LABELS[k]; }
  kindHint(k: ListKind): string {
    return k === 'taches' ? 'L’affaire du jour : compte dans « Toutes » et sur l’accueil.'
      : k === 'corvees' ? 'Des cases à cocher, lisibles par un enfant. Hors de « Toutes » et de l’accueil.'
      : k === 'preparation' ? 'Le trousseau d’un départ : rempli à l’avance, coché au moment de partir, remis à zéro pour la fois suivante. Visible par l’enfant.'
      : 'Valise, fournitures, idées : une liste qu’on refait. Hors de « Toutes » et de l’accueil.';
  }
  /** Changer de type propose l'icône par défaut du type, tant qu'on n'en a pas choisi une autre exprès. */
  pickKind(k: ListKind): void {
    const wasDefault = Object.values(KIND_ICONS).includes(this.f().icon);
    this.set({ kind: k, ...(wasDefault ? { icon: KIND_ICONS[k] } : {}) });
  }
}
