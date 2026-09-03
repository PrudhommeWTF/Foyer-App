import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { AvatarComponent } from './avatar';
import { WHO_SHOWN, WhoBadge } from '../core/schedule';

/**
 * Les marqueurs d'identité d'un créneau : pastille de la couleur du membre
 * **et** ses initiales.
 *
 * La couleur seule ne suffit pas. Deux teintes proches se confondent pour qui
 * les distingue mal, et se confondent pour tout le monde sur un écran en plein
 * soleil. Les initiales, elles, se lisent dans les deux cas.
 *
 * Au-delà de trois membres, le débordement est compté plutôt que dessiné : une
 * ligne de créneau doit rester une ligne, y compris sur un téléphone.
 */
@Component({
  selector: 'f-who',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarComponent],
  template: `
    @if (badges.length) {
      <span class="who" [title]="names">
        @for (b of shown; track b.id) {
          <f-avatar [ini]="b.ini" [color]="b.color" [size]="size" border="2px solid var(--surface)" />
        }
        @if (extra > 0) { <span class="more" [style.height.px]="size" [style.min-width.px]="size">+{{ extra }}</span> }
      </span>
    } @else {
      <span class="none">Sans membre</span>
    }
  `,
  styles: [`
    :host { display: inline-flex; min-width: 0; }
    .who { display: inline-flex; align-items: center; }
    .who > :not(:first-child) { margin-left: -6px; }
    .more { display: inline-flex; align-items: center; justify-content: center; padding: 0 5px; margin-left: -6px;
            border-radius: 999px; background: var(--soft2); color: var(--ink2); border: 2px solid var(--surface);
            font-size: 10.5px; font-weight: 800; box-sizing: border-box; }
    .none { font-size: 10.5px; font-weight: 800; color: var(--ink3); background: var(--soft2);
            padding: 3px 8px; border-radius: 8px; white-space: nowrap; }
  `],
})
export class WhoComponent {
  @Input() badges: WhoBadge[] = [];
  @Input() size = 22;

  get shown(): WhoBadge[] { return this.badges.slice(0, WHO_SHOWN); }
  get extra(): number { return Math.max(0, this.badges.length - WHO_SHOWN); }
  /** Les noms au complet pour le survol : le débordement compté reste consultable. */
  get names(): string { return this.badges.map((b) => b.name).join(', '); }
}
