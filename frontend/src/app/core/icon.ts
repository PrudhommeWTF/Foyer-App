import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICONS } from './constants';

/**
 * Inline stroke icon. Pass a named icon (`name`) from the ICONS map, or a raw
 * SVG path string (`path`) for dynamic category/list icons.
 */
@Component({
  selector: 'f-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none"
         [attr.stroke]="color()" [attr.stroke-width]="width()" stroke-linecap="round" stroke-linejoin="round"
         style="display:block;flex:none">
      <path [attr.d]="d()" />
    </svg>
  `,
})
export class IconComponent {
  readonly name = input('');
  readonly path = input('');
  readonly size = input<number | string>(21);
  readonly color = input('currentColor');
  readonly width = input<number | string>(2);

  readonly d = computed(() => this.path() || ICONS[this.name()] || '');
}
