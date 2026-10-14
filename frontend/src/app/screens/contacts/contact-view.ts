import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { CONTACT_CAT_COLORS } from '../../core/constants';
import { cap, contactIni, parseDay } from '../../core/helpers';
import { Contact } from '../../core/models';
import { ItemCtx } from '../../core/items';

/** La fiche d'un contact, en lecture : qui, comment le joindre (un tap appelle ou écrit), son anniversaire. */
@Component({
  selector: 'app-contact-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent],
  template: `
    @let c = item();
    <div class="who">
      <f-avatar [ini]="contactIni(c.name)" [color]="c.color" [size]="54" />
      <div class="txt">
        @if (c.role) { <div class="main">{{ c.role }}</div> }
        <div class="cat"><span class="dot" [style.background]="catColor()"></span>{{ c.cat }}@if (c.urgent) { <span class="urgent">Urgent</span> }</div>
      </div>
    </div>
    @if (c.phone) {
      <a class="row" [href]="'tel:' + c.phone">
        <span class="ic"><f-icon name="phone" [size]="17" color="#5F7E5C" [width]="2.2" /></span>
        <span class="txt"><span class="main">{{ c.phone }}</span><span class="sub">Appeler</span></span>
      </a>
    }
    @if (c.email) {
      <a class="row" [href]="'mailto:' + c.email">
        <span class="ic"><f-icon name="documents" [size]="17" color="var(--ink2)" [width]="2.2" /></span>
        <span class="txt"><span class="main">{{ c.email }}</span><span class="sub">Écrire</span></span>
      </a>
    }
    @if (birthday(); as b) {
      <div class="row">
        <span class="ic"><f-icon name="cake" [size]="17" color="#C77DA5" [width]="2.2" /></span>
        <span class="txt"><span class="main">{{ b.date }}</span><span class="sub">{{ b.age }}</span></span>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .who { display: flex; align-items: center; gap: 14px; padding: 4px 0 12px; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; border-top: 1px solid var(--line); text-decoration: none; color: inherit; }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .main { font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .cat { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 800; color: var(--ink2); margin-top: 3px; }
    .dot { width: 9px; height: 9px; border-radius: 3px; }
    .urgent { background: var(--primary); color: #fff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 6px; text-transform: uppercase; letter-spacing: .03em; }
  `],
})
export class ContactView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<Contact>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly contactIni = contactIni;

  readonly catColor = computed(() => CONTACT_CAT_COLORS[this.item().cat] || 'var(--ink3)');
  /** La date de naissance, et l'âge qu'elle donne aujourd'hui. */
  readonly birthday = computed(() => {
    const b = this.item().birthday; if (!b) return null;
    const d = parseDay(b), t = parseDay(this.store.todayStr());
    const age = t.getFullYear() - d.getFullYear() - (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate()) ? 1 : 0);
    return { date: cap(d.toLocaleDateString(this.store.locale, { day: 'numeric', month: 'long', year: 'numeric' })), age: age >= 0 ? age + ' an' + (age > 1 ? 's' : '') : 'Anniversaire' };
  });
}
