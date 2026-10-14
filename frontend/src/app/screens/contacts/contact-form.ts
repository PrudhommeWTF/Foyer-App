import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { CONTACT_CATS, CONTACT_CAT_COLORS, tint } from '../../core/constants';
import { Contact } from '../../core/models';
import { ContactFields, contactData, contactFields } from '../../core/contact-card';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/** Le formulaire d'un contact : nom, rôle, téléphone, email, naissance, catégorie, couleur, urgence. */
@Component({
  selector: 'app-contact-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @let v = f();
    <div class="form-row">
      <div class="field">
        <div class="field-label">Nom</div>
        <input class="input" [ngModel]="v.name" (ngModelChange)="set({ name: $event })" placeholder="Ex : Dr. Martin" />
      </div>
      <div class="field">
        <div class="field-label">Rôle</div>
        <input class="input" [ngModel]="v.role" (ngModelChange)="set({ role: $event })" placeholder="Ex : Dentiste" />
      </div>
    </div>
    <div class="form-row">
      <div class="field">
        <div class="field-label">Téléphone</div>
        <input class="input" type="tel" [ngModel]="v.phone" (ngModelChange)="set({ phone: $event })" placeholder="06 12 34 56 78" />
      </div>
      <div class="field">
        <div class="field-label">Email (option.)</div>
        <input class="input" type="email" [ngModel]="v.email" (ngModelChange)="set({ email: $event })" placeholder="email@exemple.fr" />
      </div>
    </div>
    <div class="field-label">Date de naissance (option.)</div>
    <input class="input mb" type="date" [ngModel]="v.birthday" (ngModelChange)="set({ birthday: $event || '' })" />

    <div class="field-label">Catégorie</div>
    <div class="cat-opts">
      @for (cat of CONTACT_CATS; track cat) {
        <button type="button" class="cat-opt" [class.on]="v.cat === cat"
                [style.border-color]="v.cat === cat ? CONTACT_CAT_COLORS[cat] : 'transparent'"
                [style.background]="tint(CONTACT_CAT_COLORS[cat])" [style.color]="CONTACT_CAT_COLORS[cat]" (click)="set({ cat })">
          <span class="dot" [style.background]="CONTACT_CAT_COLORS[cat]"></span>{{ cat }}
        </button>
      }
    </div>

    <div class="field-label">Couleur</div>
    <div class="swatch-row mb">
      @for (col of colors; track col) {
        <button type="button" class="swatch" [style.background]="col" [style.box-shadow]="v.color === col ? '0 0 0 3px var(--surface),0 0 0 5px ' + col : 'none'"
                (click)="set({ color: col })" [attr.aria-label]="'Couleur ' + ($index + 1)" [attr.aria-pressed]="v.color === col"></button>
      }
    </div>

    <button type="button" class="urgent-toggle" (click)="set({ urgent: !v.urgent })" [attr.aria-pressed]="v.urgent">
      <span class="ut-label"><f-icon name="urgent" [size]="18" color="var(--primary)" [width]="2" /><span>Contact d'urgence</span></span>
      <span class="switch" [class.on]="v.urgent"><span class="knob"></span></span>
    </button>
  `,
  styles: [`
    :host { display: block; }
    .form-row { display: flex; gap: 12px; margin-bottom: 20px; }
    .field { flex: 1; min-width: 0; }
    .field .input { width: 100%; box-sizing: border-box; }
    @media (max-width: 560px) { .form-row { flex-direction: column; gap: 14px; } }
    .mb { margin-bottom: 20px; }
    .cat-opts { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 20px; }
    .cat-opt { display: flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 11px; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; border: 2px solid transparent; }
    .cat-opt .dot { width: 9px; height: 9px; border-radius: 3px; }
    .urgent-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 14px 16px; border: none; border-radius: 13px; background: var(--soft); font: inherit; cursor: pointer; }
    .ut-label { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 800; color: var(--ink); }
    .switch { width: 46px; height: 26px; border-radius: 20px; background: var(--line2); position: relative; transition: background .2s; flex: none; }
    .switch.on { background: var(--primary); }
    .switch .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left .2s; }
    .switch.on .knob { left: 23px; }
  `],
})
export class ContactForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  readonly item = input<Contact | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly CONTACT_CATS = CONTACT_CATS;
  readonly CONTACT_CAT_COLORS = CONTACT_CAT_COLORS;
  readonly tint = tint;
  readonly colors = ['#9B6FA8', '#E56B4E', '#4E93B8', '#F0B24B', '#7A9B76', '#C77DA5'];

  readonly f = signal<ContactFields>(contactFields(null));
  private initial = '';
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);

  ngOnInit(): void { this.f.set(contactFields(this.item())); this.initial = JSON.stringify(this.f()); }
  submit(): ItemResult {
    const data = contactData(this.f());
    if (typeof data === 'string') { this.store.toast(data); return { kind: 'invalid' }; }
    return this.store.saveContact(this.item()?.id ?? null, data);
  }
  set(p: Partial<ContactFields>): void { this.f.update((f) => ({ ...f, ...p })); }
}
