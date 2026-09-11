import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Interrupteur marche/arrêt. Un seul style pour tout le foyer, là où un réglage
 * bascule d'un geste (activer une règle, par exemple). Contrôlé : le parent tient
 * l'état et réagit au basculement.
 */
@Component({
  selector: 'f-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="toggle" [class.on]="on()" role="switch" [attr.aria-checked]="on()"
            (click)="toggled.emit(!on())"><span class="knob"></span></button>
  `,
  styles: [`
    .toggle { width: 42px; height: 24px; flex: none; border: none; border-radius: 99px; background: var(--soft2); cursor: pointer; padding: 0; position: relative; transition: background .15s; }
    .toggle.on { background: var(--primary); }
    .knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .15s; box-shadow: 0 2px 4px rgba(0,0,0,.25); }
    .toggle.on .knob { left: 21px; }
  `],
})
export class ToggleComponent {
  readonly on = input(false);
  readonly toggled = output<boolean>();
}
