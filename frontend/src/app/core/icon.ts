import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
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
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none"
         [attr.stroke]="color" [attr.stroke-width]="width" stroke-linecap="round" stroke-linejoin="round"
         style="display:block;flex:none">
      <path [attr.d]="d" />
    </svg>
  `,
})
export class IconComponent {
  @Input() name = '';
  @Input() path = '';
  @Input() size: number | string = 21;
  @Input() color = 'currentColor';
  @Input() width: number | string = 2;

  get d(): string {
    return this.path || ICONS[this.name] || '';
  }
}
