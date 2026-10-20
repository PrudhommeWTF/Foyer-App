import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * L'horloge à aiguilles des exercices d'énoncé « horloge » : un cadran avec ses
 * douze heures et ses soixante traits, la petite aiguille qui avance avec les
 * minutes (à 7 h 45, elle est presque sur le 8), la grande sur les minutes.
 * Dessinée en SVG, sans image : elle suit le thème clair ou sombre.
 */
@Component({
  selector: 'rev-clock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="-100 -100 200 200" aria-hidden="true">
      <circle r="96" class="face" />
      @for (t of ticks; track t) {
        <line [attr.y1]="-90" [attr.y2]="t % 5 ? -85 : -79" [attr.transform]="'rotate(' + t * 6 + ')'" [class.big]="!(t % 5)" class="tick" />
      }
      @for (n of numbers; track n.n) { <text [attr.x]="n.x" [attr.y]="n.y" class="num">{{ n.n }}</text> }
      <line y1="10" [attr.y2]="-48" [attr.transform]="'rotate(' + hourAngle() + ')'" class="hand hour" />
      <line y1="14" [attr.y2]="-74" [attr.transform]="'rotate(' + minuteAngle() + ')'" class="hand minute" />
      <circle r="5" class="pin" />
    </svg>
  `,
  styles: [`
    :host { display: block; width: min(240px, 32vh, 62vw); aspect-ratio: 1; }
    svg { width: 100%; height: 100%; display: block; }
    .face { fill: var(--surface); stroke: var(--ink); stroke-width: 4; }
    .tick { stroke: var(--ink3); stroke-width: 1.5; }
    .tick.big { stroke: var(--ink); stroke-width: 3; }
    .num { fill: var(--ink); font-size: 17px; font-weight: 800; text-anchor: middle; dominant-baseline: central; font-family: inherit; }
    .hand { stroke-linecap: round; }
    .hour { stroke: var(--ink); stroke-width: 8; }
    .minute { stroke: var(--primary); stroke-width: 5; }
    .pin { fill: var(--ink); }
  `],
})
export class ClockComponent {
  readonly h = input.required<number>();
  readonly m = input.required<number>();
  readonly ticks = Array.from({ length: 60 }, (_, i) => i);
  readonly numbers = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1, a = (n * 30 * Math.PI) / 180;
    return { n, x: Math.round(Math.sin(a) * 66 * 10) / 10, y: Math.round(-Math.cos(a) * 66 * 10) / 10 };
  });
  readonly hourAngle = computed(() => ((this.h() % 12) + this.m() / 60) * 30);
  readonly minuteAngle = computed(() => this.m() * 6);
}
