import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { ModalComponent } from '../shared/modal';
import { CONTACT_CATS, CONTACT_CAT_COLORS, tint } from '../core/constants';
import { contactIni } from '../core/helpers';

@Component({
  selector: 'screen-contacts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <div class="head-row">
        <div class="search">
          <f-icon name="search" [size]="18" color="var(--ink3)" [width]="2.2" />
          <input [ngModel]="store.ui().contactSearch" (ngModelChange)="store.patch({ contactSearch: $event })" placeholder="Rechercher un contact…" />
        </div>
        <button class="btn btn-primary" (click)="store.newContact()"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Nouveau contact</button>
      </div>

      <div class="chips">
        @for (chip of catChips(); track chip.name) {
          <div class="chip-cat" [class.active]="store.ui().contactCat === chip.name"
               [style.background]="store.ui().contactCat === chip.name ? 'var(--primary)' : chipBg(chip.color)"
               [style.color]="store.ui().contactCat === chip.name ? '#fff' : chipColor(chip.color)"
               (click)="store.patch({ contactCat: chip.name })">
            {{ chip.name }}<span class="ct">{{ chip.count }}</span>
          </div>
        }
      </div>

      <div class="grid">
        @for (c of filtered(); track c.id) {
          <div class="card contact">
            <div class="top">
              <f-avatar [ini]="contactIni(c.name)" [color]="c.color" [size]="54" />
              <div class="info">
                <div class="name-row">
                  <span class="name">{{ c.name }}</span>
                  @if (c.urgent) { <span class="badge-urgent">Urgent</span> }
                </div>
                <div class="role">{{ c.role }}</div>
                <div class="cat-row">
                  <span class="cat-dot" [style.background]="CONTACT_CAT_COLORS[c.cat]"></span>
                  <span class="cat-name">{{ c.cat }}</span>
                </div>
              </div>
            </div>
            <div class="lines">
              <a class="line" [href]="'tel:' + c.phone"><f-icon name="phone" [size]="15" color="var(--ink3)" [width]="2" /><span>{{ c.phone }}</span></a>
              @if (c.email) {
                <a class="line email" [href]="'mailto:' + c.email"><f-icon name="documents" [size]="15" color="var(--ink3)" [width]="2" /><span>{{ c.email }}</span></a>
              }
            </div>
            <div class="actions">
              <a class="call" [href]="'tel:' + c.phone"><f-icon name="phone" [size]="16" color="#5F7E5C" [width]="2" /> Appeler</a>
              <button class="icon-btn" (click)="store.editContact(c.id)"><f-icon name="edit" [size]="17" color="var(--ink2)" [width]="2" /></button>
              <button class="icon-btn" (click)="store.patch({ contactDelId: c.id })"><f-icon name="trash" [size]="17" color="var(--primary)" [width]="2" /></button>
            </div>
          </div>
        } @empty {
          <div class="card empty">Aucun contact trouvé</div>
        }
      </div>
    </div>

    @if (store.ui().contactForm) {
      <f-modal [title]="formTitle()" [maxWidth]="520" (close)="store.patch({ contactForm: false })">
        <div class="form-row">
          <div class="field">
            <div class="field-label">Nom</div>
            <input class="input" [ngModel]="store.ui().coName" (ngModelChange)="store.patch({ coName: $event })" placeholder="Ex : Dr. Martin" />
          </div>
          <div class="field">
            <div class="field-label">Rôle</div>
            <input class="input" [ngModel]="store.ui().coRole" (ngModelChange)="store.patch({ coRole: $event })" placeholder="Ex : Dentiste" />
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <div class="field-label">Téléphone</div>
            <input class="input" [ngModel]="store.ui().coPhone" (ngModelChange)="store.patch({ coPhone: $event })" placeholder="06 12 34 56 78" />
          </div>
          <div class="field">
            <div class="field-label">Email (option.)</div>
            <input class="input" [ngModel]="store.ui().coEmail" (ngModelChange)="store.patch({ coEmail: $event })" placeholder="email@exemple.fr" />
          </div>
        </div>

        <div class="field-label">Catégorie</div>
        <div class="cat-opts">
          @for (cat of CONTACT_CATS; track cat) {
            <div class="cat-opt" [class.on]="store.ui().coCat === cat"
                 [style.border-color]="store.ui().coCat === cat ? CONTACT_CAT_COLORS[cat] : 'transparent'"
                 [style.background]="tint(CONTACT_CAT_COLORS[cat])" [style.color]="CONTACT_CAT_COLORS[cat]"
                 (click)="store.patch({ coCat: cat })">
              <span class="dot" [style.background]="CONTACT_CAT_COLORS[cat]"></span>{{ cat }}
            </div>
          }
        </div>

        <div class="field-label">Couleur</div>
        <div class="swatch-row">
          @for (col of colors; track col) {
            <div class="swatch" [class.on]="store.ui().coColor === col" [style.background]="col"
                 [style.box-shadow]="store.ui().coColor === col ? '0 0 0 3px var(--surface),0 0 0 5px ' + col : 'none'"
                 (click)="store.patch({ coColor: col })"></div>
          }
        </div>

        <div class="urgent-toggle" (click)="store.patch({ coUrgent: !store.ui().coUrgent })">
          <div class="ut-label"><f-icon name="urgent" [size]="18" color="var(--primary)" [width]="2" /><span>Contact d'urgence</span></div>
          <div class="switch" [class.on]="store.ui().coUrgent"><div class="knob"></div></div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-soft" (click)="store.patch({ contactForm: false })">Annuler</button>
          <button class="btn btn-primary" (click)="store.saveContact()">Enregistrer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().contactDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ contactDelId: null })">
        <div class="del-box">
          <div class="del-ico"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="del-title">Supprimer ce contact ?</div>
          <div class="del-text">« {{ delName() }} » sera retiré de vos contacts. Cette action est définitive.</div>
          <div class="modal-actions">
            <button class="btn btn-soft btn-block" (click)="store.patch({ contactDelId: null })">Annuler</button>
            <button class="btn btn-danger btn-block" (click)="store.confirmContactDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .head-row { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
    .search { flex: 1; display: flex; align-items: center; gap: 10px; background: var(--surface); border-radius: 14px; padding: 12px 16px; box-shadow: 0 6px 16px -14px rgba(90,60,40,.6); }
    .search input { flex: 1; border: none; background: transparent; font-size: 14.5px; font-weight: 600; color: var(--ink); outline: none; }
    .head-row .btn { flex: none; }

    .chips { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 22px; }
    .chip-cat { display: flex; align-items: center; gap: 7px; padding: 9px 15px; border-radius: 12px; font-size: 13px; font-weight: 800; cursor: pointer; box-shadow: 0 6px 14px -12px rgba(90,60,40,.6); }
    .chip-cat .ct { opacity: .6; font-size: 12px; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
    :host-context(.shell.narrow) .grid { grid-template-columns: 1fr; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }

    .card.contact { padding: 20px; border-radius: 20px; }
    .top { display: flex; align-items: flex-start; gap: 16px; }
    .info { flex: 1; min-width: 0; }
    .name-row { display: flex; align-items: center; gap: 8px; }
    .name { font-weight: 800; font-size: 16px; color: var(--ink); }
    .badge-urgent { background: var(--primary); color: #fff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 6px; text-transform: uppercase; letter-spacing: .03em; }
    .role { font-size: 13px; font-weight: 700; color: var(--ink2); }
    .cat-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
    .cat-dot { width: 8px; height: 8px; border-radius: 3px; }
    .cat-name { font-size: 12px; font-weight: 800; color: var(--ink3); }

    .lines { display: flex; flex-direction: column; gap: 6px; margin: 16px 0 14px; }
    .line { display: flex; align-items: center; gap: 9px; font-size: 13.5px; font-weight: 700; color: var(--ink); text-decoration: none; }
    .line.email { font-size: 13px; font-weight: 700; color: var(--ink2); overflow: hidden; }
    .line.email span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .actions { display: flex; gap: 8px; }
    .call { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 10px; border-radius: 12px; background: #EDF2EB; color: #5F7E5C; font-size: 13px; font-weight: 800; cursor: pointer; text-decoration: none; }
    .actions .icon-btn { width: 42px; height: 42px; border-radius: 12px; background: var(--soft2); }

    .card.empty { grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--ink3); font-weight: 700; font-size: 15px; }

    .form-row { display: flex; gap: 12px; margin-bottom: 20px; }
    .field { flex: 1; min-width: 0; }
    .cat-opts { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 20px; }
    .cat-opt { display: flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 11px; font-size: 13.5px; font-weight: 800; cursor: pointer; border: 2px solid transparent; }
    .cat-opt .dot { width: 9px; height: 9px; border-radius: 3px; }

    .urgent-toggle { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-radius: 13px; background: var(--soft); cursor: pointer; margin: 4px 0 8px; }
    .ut-label { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 800; color: var(--ink); }
    .switch { width: 46px; height: 26px; border-radius: 20px; background: var(--line2); position: relative; transition: background .2s; flex: none; }
    .switch.on { background: var(--primary); }
    .switch .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left .2s; }
    .switch.on .knob { left: 23px; }

    .modal-actions { display: flex; gap: 12px; margin-top: 8px; justify-content: flex-end; }

    .del-box { text-align: center; }
    .del-ico { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .del-title { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--ink); }
    .del-text { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 22px; }
    .del-box .modal-actions { justify-content: stretch; }
  `],
})
export class ContactsScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  CONTACT_CATS = CONTACT_CATS;
  CONTACT_CAT_COLORS = CONTACT_CAT_COLORS;
  contactIni = contactIni;
  tint = tint;
  colors = ['#9B6FA8', '#E56B4E', '#4E93B8', '#F0B24B', '#7A9B76', '#C77DA5'];

  catChips = computed(() => {
    const cs = this.d().contacts;
    const chips: { name: string; count: number; color: string }[] = [{ name: 'Tous', count: cs.length, color: '' }];
    for (const cat of CONTACT_CATS) chips.push({ name: cat, count: cs.filter((c) => c.cat === cat).length, color: CONTACT_CAT_COLORS[cat] });
    return chips;
  });

  filtered = computed(() => {
    const q = this.store.ui().contactSearch.trim().toLowerCase();
    const cat = this.store.ui().contactCat;
    return this.d().contacts.filter((c) => {
      if (cat !== 'Tous' && c.cat !== cat) return false;
      if (!q) return true;
      return `${c.name} ${c.role} ${c.phone}`.toLowerCase().includes(q);
    });
  });

  formTitle = computed(() => (this.store.ui().coEditId ? 'Modifier le contact' : 'Nouveau contact'));
  delName = computed(() => this.d().contacts.find((c) => c.id === this.store.ui().contactDelId)?.name || '');

  chipBg(color: string): string { return color ? tint(color) : 'var(--surface)'; }
  chipColor(color: string): string { return color || 'var(--ink2)'; }
}
