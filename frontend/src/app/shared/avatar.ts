import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'f-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="avatar" [style.background]="color()" [style.width.px]="size()" [style.height.px]="size()"
    [style.font-size.px]="fontSize()" [style.border]="border()">{{ ini() }}</span>`,
})
export class AvatarComponent {
  readonly ini = input('?');
  readonly color = input('#8A7E74');
  readonly size = input(38);
  readonly border = input('none');
  readonly fontSize = computed(() => Math.round(this.size() * 0.38));
}
