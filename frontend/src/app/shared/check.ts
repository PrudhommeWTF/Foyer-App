import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../core/icon';

/**
 * Case à cocher, présentation seule. Un seul style pour tout le foyer, à la
 * place des quatre variantes qui traînaient (case native, carré, rond vert).
 * Elle ne gère pas le clic : le parent l'enveloppe dans un libellé ou une ligne
 * cliquable et tient l'état, la case ne fait que le montrer.
 */
@Component({
  selector: 'f-check',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <span class="box" [class.on]="checked()" role="checkbox" [attr.aria-checked]="checked()">
      @if (checked()) { <f-icon name="check" [size]="12" color="#fff" [width]="3.4" /> }
    </span>
  `,
  styles: [`
    .box { width: 20px; height: 20px; flex: none; border: 2px solid var(--line2); border-radius: 6px; background: var(--surface); display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; }
    .box.on { background: var(--primary); border-color: var(--primary); }
  `],
})
export class CheckComponent {
  readonly checked = input(false);
}
