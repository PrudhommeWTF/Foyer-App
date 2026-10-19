import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * Le pavé numérique de l'exercice : de grosses touches, jamais le clavier du
 * système (il cache la moitié de l'écran sur iPad et propose des lettres). Le
 * clavier physique d'un Mac marche aussi : c'est l'exercice qui l'écoute.
 */
@Component({
  selector: 'tables-keypad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pad" role="group" aria-label="Pavé numérique">
      @for (k of keys; track k) {
        <button type="button" class="key" (click)="digit.emit(k)" [disabled]="disabled()">{{ k }}</button>
      }
      <button type="button" class="key soft" (click)="erase.emit()" [disabled]="disabled()" aria-label="Effacer">⌫</button>
      <button type="button" class="key" (click)="digit.emit('0')" [disabled]="disabled()">0</button>
      <button type="button" class="key ok" (click)="submit.emit()" [disabled]="disabled() || !canSubmit()">OK</button>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; max-width: 360px; }
    .pad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; width: 100%; }
    .key { min-height: 64px; border: none; border-radius: 18px; background: var(--surface); box-shadow: var(--sh-float); font-family: inherit; font-size: 30px; font-weight: 800; color: var(--ink); cursor: pointer; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
    .key:active:not(:disabled) { background: var(--soft2); }
    .key.soft { background: var(--soft2); color: var(--ink2); font-size: 26px; }
    .key.ok { background: var(--primary); color: #fff; font-size: 24px; }
    .key:disabled { opacity: .45; cursor: default; }
    @media (max-height: 700px) { .key { min-height: 52px; font-size: 26px; } }
  `],
})
export class KeypadComponent {
  readonly disabled = input(false);
  readonly canSubmit = input(true);
  readonly digit = output<string>();
  readonly erase = output<void>();
  readonly submit = output<void>();
  readonly keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
}
