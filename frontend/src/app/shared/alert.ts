import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../core/icon';

/**
 * Bandeau d'alerte, deux tons : avertissement (miel) et erreur (rouge), avec
 * leur variante en thème sombre. Le même bloc, réécrit un peu partout dans le
 * module Finances avec ses propres couleurs et son propre `:host-context(.dark)`,
 * vit désormais ici. Le contenu (texte, titre, bouton) est projeté par le
 * parent, qui garde la main sur ce qu'il met dedans.
 */
@Component({
  selector: 'f-alert',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="alert" [class.err]="kind() === 'error'">
      <f-icon name="urgent" [size]="18" [color]="kind() === 'error' ? 'var(--primary)' : '#B8860B'" [width]="2.2" />
      <div class="body"><ng-content /></div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .alert { display: flex; align-items: flex-start; gap: 12px; border-radius: 16px; padding: 14px 16px; font-size: 13.5px; font-weight: 700; background: #FDF0DA; color: #7A5C12; }
    .alert.err { background: #FCE9E3; color: #8C3B26; align-items: center; }
    :host-context(.dark) .alert { background: #3A3123; color: #E8C88A; }
    :host-context(.dark) .alert.err { background: #3A2622; color: #F0A98B; }
    .body { flex: 1; min-width: 0; }
  `],
})
export class AlertComponent {
  readonly kind = input<'warn' | 'error'>('warn');
}
