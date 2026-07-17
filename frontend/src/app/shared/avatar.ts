import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'f-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="avatar" [style.background]="color" [style.width.px]="size" [style.height.px]="size"
    [style.font-size.px]="fontSize" [style.border]="border">{{ ini }}</span>`,
})
export class AvatarComponent {
  @Input() ini = '?';
  @Input() color = '#8A7E74';
  @Input() size = 38;
  @Input() border = 'none';
  get fontSize(): number { return Math.round(this.size * 0.38); }
}
