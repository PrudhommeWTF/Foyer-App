import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../core/icon';

/** Rayon de l'anneau dans la boîte de 24, et sa circonférence. */
const R = 10.5;
const C = 2 * Math.PI * R;

/**
 * La case ronde des listes registre (Tâches, Entretien).
 *
 * Elle porte la couleur de la liste, et rien d'autre ne la porte sur la ligne.
 * Pour une tâche récurrente, `progress` (0 à 1) dessine un arc qui part de midi
 * et se referme à l'échéance : c'est le remplaçant de l'ancienne barre en bas de
 * carte. En retard, l'arc passe au rouge. Faite, la case est pleine (sauge).
 *
 * C'est un vrai bouton : la cible fait 40 px même quand la case en dessine 24 ou
 * 18, et le clic ne remonte pas à la ligne (qui, elle, ouvre la fiche).
 */
@Component({
  selector: 'f-ring-check',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <button type="button" class="hit" [style.margin.px]="-(40 - size()) / 2" [disabled]="disabled()"
            [attr.aria-label]="(done() ? 'Rouvrir ' : 'Cocher ') + label()" [attr.aria-pressed]="done()"
            [title]="progress() !== null && !done() ? 'L’anneau se remplit jusqu’à la prochaine échéance' : ''"
            (click)="$event.stopPropagation(); toggle.emit()">
      @if (done()) {
        <span class="full" [style.width.px]="size()" [style.height.px]="size()">
          <f-icon name="check" [size]="size() * .5" color="#fff" [width]="3.4" />
        </span>
      } @else {
        <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" [attr.r]="r" fill="none" [attr.stroke]="track()" [attr.stroke-width]="size() < 24 ? 2.4 : 2" />
          @if (arc(); as a) {
            <circle cx="12" cy="12" [attr.r]="r" fill="none" [attr.stroke]="late() ? 'var(--status-crit)' : color()"
                    stroke-width="2.2" stroke-linecap="round" [attr.stroke-dasharray]="a" transform="rotate(-90 12 12)" />
          }
        </svg>
      }
    </button>
  `,
  styles: [`
    :host { display: inline-flex; flex: none; }
    .hit { width: 40px; height: 40px; flex: none; border: none; background: none; padding: 0; cursor: pointer;
           display: grid; place-items: center; border-radius: 50%; }
    .hit:focus-visible { outline: 2px solid var(--ink3); outline-offset: -6px; }
    .hit:disabled { cursor: default; }
    svg { display: block; }
    .full { border-radius: 50%; background: var(--sage); display: grid; place-items: center; }
  `],
})
export class RingCheckComponent {
  /** La couleur de la liste (ou de la pièce). Par défaut, le gris neutre des sous-tâches. */
  readonly color = input('var(--line2)');
  /** L'avancée vers la prochaine échéance, ou null pour une case pleine de sa couleur. */
  readonly progress = input<number | null>(null);
  readonly late = input(false);
  readonly done = input(false);
  readonly size = input(24);
  /** Ce que la case coche, pour le lecteur d'écran : « Cocher <label> ». */
  readonly label = input('');
  readonly disabled = input(false);
  readonly toggle = output<void>();

  readonly r = R;
  /** Avec une avancée, le cercle de fond n'est qu'une trace : la couleur à 35 % sur la surface. */
  readonly track = computed(() => this.progress() === null ? this.color() : `color-mix(in srgb, ${this.color()} 35%, var(--surface))`);
  readonly arc = computed(() => {
    const p = this.progress();
    return p === null || p <= 0 ? '' : `${C * Math.min(1, p)} ${C}`;
  });
}
