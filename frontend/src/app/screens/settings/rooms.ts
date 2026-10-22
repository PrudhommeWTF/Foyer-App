import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { EquipementsStore } from '../../core/equipements.store';
import { IconComponent } from '../../core/icon';
import { STARTER_ROOM_NAMES } from '../../core/equipements';
import { roomUsage, usageLabel } from '../../core/rooms';
import type { Room } from '../../core/models';

/**
 * Les pièces de la maison : une seule liste pour tout le foyer, que rangent
 * Entretien (ses gestes) et Équipements (ses appareils). Elle vit ici, dans
 * Paramètres, parce qu'elle appartient au foyer et pas à un module : on la gère
 * même quand les deux modules sont éteints.
 *
 * Supprimer une pièce ne supprime rien d'autre : ce qui y était rangé passe
 * « Sans pièce ». Quand la pièce n'est pas vide, on le dit avant d'agir.
 */
@Component({
  selector: 'settings-rooms',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @if (!rooms().length) {
      <div class="hint">Aucune pièce pour l’instant. Créez celles proposées en un geste, puis renommez ou supprimez ce qui ne vous ressemble pas.</div>
      <button class="btn btn-soft starter" (click)="starter()">Créer les pièces proposées</button>
      <div class="hint small">{{ starterNames }}</div>
    }
    <div class="rooms">
      @for (r of rooms(); track r.id; let first = $first, last = $last) {
        <div class="room">
          <div class="r-main">
            <input class="input" [ngModel]="r.name" (change)="rename(r, $any($event.target))" (keydown.enter)="$any($event.target).blur()" maxlength="60" [attr.aria-label]="'Nom de la pièce ' + r.name" />
            <div class="r-use">{{ label(r) || 'Vide' }}</div>
          </div>
          <button class="icon-btn sm" [disabled]="first" (click)="store.moveRoom(r.id, -1)" aria-label="Monter"><f-icon name="arrowUp" [size]="16" /></button>
          <button class="icon-btn sm" [disabled]="last" (click)="store.moveRoom(r.id, 1)" aria-label="Descendre"><f-icon name="arrowDown" [size]="16" /></button>
          <button class="icon-btn sm" (click)="askRemove(r)" [attr.aria-label]="'Supprimer ' + r.name"><f-icon name="trash" [size]="16" color="#C6492F" /></button>
        </div>
        @if (confirming() === r.id) {
          <div class="confirm" role="alertdialog">
            <div>Supprimer « {{ r.name }} » ? {{ label(r) }} passer{{ plural(r) ? 'ont' : 'a' }} « Sans pièce » : rien n’est effacé.</div>
            <div class="c-act">
              <button class="btn btn-danger" (click)="remove(r)">Supprimer la pièce</button>
              <button class="btn btn-soft" (click)="confirming.set(null)">Annuler</button>
            </div>
          </div>
        }
      }
    </div>
    <div class="room add">
      <input class="input" [ngModel]="newName()" (ngModelChange)="newName.set($event)" (keydown.enter)="add()" placeholder="Nouvelle pièce : Grenier, Véranda…" maxlength="60" aria-label="Nouvelle pièce" />
      <button class="btn btn-soft" [disabled]="!newName().trim()" (click)="add()">Ajouter</button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); line-height: 1.5; margin-bottom: 10px; }
    .hint.small { font-size: 12px; margin-top: 8px; }
    .starter { margin-bottom: 4px; }
    .rooms { display: flex; flex-direction: column; gap: 8px; }
    .room { display: flex; align-items: center; gap: 6px; }
    .r-main { flex: 1; min-width: 0; }
    .r-main .input { width: 100%; box-sizing: border-box; }
    .r-use { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin: 3px 0 0 4px; }
    .room.add { margin-top: 14px; }
    .room.add .input { flex: 1; min-width: 0; }
    .icon-btn.sm[disabled] { opacity: .3; }
    .confirm { background: #FCE9E3; color: #8E3A28; border-radius: 12px; padding: 12px 14px; font-size: 13px; font-weight: 700; line-height: 1.5; }
    .c-act { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  `],
})
export class SettingsRoomsComponent {
  readonly store = inject(FoyerStore);
  private eqp = inject(EquipementsStore);
  readonly rooms = this.store.rooms;
  readonly starterNames = STARTER_ROOM_NAMES.join(', ');
  readonly newName = signal('');
  /** La pièce dont on confirme la suppression (elle n'est pas vide). */
  readonly confirming = signal<string | null>(null);

  /** Ce que chaque pièce contient, selon les modules allumés. */
  private readonly usage = computed(() => roomUsage(
    this.rooms(),
    this.store.modEquipements() ? this.eqp.items() : [],
    this.store.modEntretien() ? this.store.gestes() : [],
  ));
  label(r: Room): string { return usageLabel(this.usage().get(r.id)); }
  plural(r: Room): boolean { const u = this.usage().get(r.id); return !!u && u.equipements + u.gestes > 1; }

  starter(): void { this.store.addRooms(STARTER_ROOM_NAMES); }
  add(): void { if (this.store.addRoom(this.newName())) this.newName.set(''); }
  /** Un nom refusé (vide, déjà pris) revient à l'ancien dans le champ. */
  rename(r: Room, input: HTMLInputElement): void { if (!this.store.renameRoom(r.id, input.value)) input.value = r.name; }
  askRemove(r: Room): void {
    if (this.label(r)) { this.confirming.set(r.id); return; }
    this.store.removeRoom(r.id);
  }
  remove(r: Room): void { this.confirming.set(null); this.store.removeRoom(r.id); }
}
