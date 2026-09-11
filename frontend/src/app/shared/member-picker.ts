import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AvatarComponent } from './avatar';
import { Member } from '../core/models';

/**
 * Sélecteur de membres en pastilles, cochables. Le même geste servait dans les
 * Comptes et les Contrats du module Finances, dupliqué mot pour mot : il vit
 * désormais ici. Le parent tient la liste des sélectionnés et réagit au
 * basculement, la primitive ne connaît que l'affichage.
 */
@Component({
  selector: 'f-member-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarComponent],
  template: `
    <div class="picker">
      @for (m of members(); track m.id) {
        <button type="button" class="pick" [class.on]="selected().includes(m.id)"
                [style.border-color]="selected().includes(m.id) ? m.color : 'transparent'"
                (click)="toggle.emit(m.id)">
          <f-avatar [ini]="m.ini" [color]="m.color" [size]="22" />
          {{ m.name }}
        </button>
      } @empty {
        <div class="mp-empty">Aucun membre déclaré dans le foyer.</div>
      }
    </div>
  `,
  styles: [`
    .picker { display: flex; gap: 8px; flex-wrap: wrap; }
    .pick { display: inline-flex; align-items: center; gap: 7px; border: 2px solid transparent; border-radius: 20px; padding: 4px 12px 4px 4px; background: var(--soft2); font-family: inherit; font-size: 12.5px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .pick.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh-card); }
    .mp-empty { font-size: 12.5px; font-weight: 700; color: var(--ink3); }
  `],
})
export class MemberPickerComponent {
  readonly members = input<Member[]>([]);
  /** Identifiants des membres sélectionnés (le parent en est propriétaire). */
  readonly selected = input<string[]>([]);
  /** Identifiant du membre dont on bascule la sélection. */
  readonly toggle = output<string>();
}
