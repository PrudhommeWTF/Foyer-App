import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { CONTACT_CATS, CONTACT_CAT_COLORS, tint } from '../../core/constants';
import { contactIni } from '../../core/helpers';

@Component({
  selector: 'screen-contacts',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent],
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
            <!-- Le haut de la carte ouvre la fiche (la modifier, la supprimer) ; appeler et écrire restent directs. -->
            <button class="top" (click)="store.openItem('contact', c.id)">
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
              <f-icon name="chevronRight" [size]="17" color="var(--ink3)" [width]="2.4" />
            </button>
            <div class="lines">
              <a class="line" [href]="'tel:' + c.phone"><f-icon name="phone" [size]="15" color="var(--ink3)" [width]="2" /><span>{{ c.phone }}</span></a>
              @if (c.email) {
                <a class="line email" [href]="'mailto:' + c.email"><f-icon name="documents" [size]="15" color="var(--ink3)" [width]="2" /><span>{{ c.email }}</span></a>
              }
            </div>
            <div class="actions">
              <a class="call" [href]="'tel:' + c.phone"><f-icon name="phone" [size]="16" color="#5F7E5C" [width]="2" /> Appeler</a>
            </div>
          </div>
        } @empty {
          <div class="card empty">Aucun contact trouvé</div>
        }
      </div>
    </div>

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
    .top { display: flex; align-items: flex-start; gap: 16px; width: 100%; padding: 0; border: none; background: none; font: inherit; text-align: left; cursor: pointer; }
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

    .card.empty { grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--ink3); font-weight: 700; font-size: 15px; }



  `],
})
export class ContactsScreen {
  store = inject(FoyerStore);
  d = this.store.d;

  CONTACT_CAT_COLORS = CONTACT_CAT_COLORS;
  contactIni = contactIni;

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


  chipBg(color: string): string { return color ? tint(color) : 'var(--surface)'; }
  chipColor(color: string): string { return color || 'var(--ink2)'; }
}
