import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinancesStore, fmtEuros, fmtEurosInt } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { CAT_ICONS, CAT_PALETTE } from '../../core/constants';

@Component({
  selector: 'fin-categories-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <div class="bar">
      <div class="hint">Le budget mensuel de référence sert de repère : il ne bloque rien, il situe le réel. Les dépenses d'une sous-catégorie remontent sur sa parente.</div>
      <div class="spacer"></div>
      <button class="btn btn-primary" (click)="store.newCategory(null)"><f-icon name="plus" [size]="16" color="#fff" [width]="2.6" /> Nouvelle catégorie</button>
    </div>

    <div class="grid">
      @for (c of store.rootCategories(); track c.id) {
        <div class="card">
          <div class="top">
            <div class="idz">
              <div class="chip" [style.background]="foyer.tint(c.color)"><f-icon [path]="CAT_ICONS[c.icon] || CAT_ICONS['facture']" [size]="18" [color]="c.color" [width]="2" /></div>
              <div>
                <div class="name">{{ c.name }}</div>
                <div class="budget">{{ c.monthlyBudget > 0 ? fmtInt(c.monthlyBudget) + ' € par mois' : 'sans budget de référence' }}</div>
              </div>
            </div>
            <div class="acts">
              <button class="icon-btn sm" (click)="store.editCategory(c.id)" aria-label="Modifier"><f-icon name="edit" [size]="14" color="var(--ink2)" /></button>
              <button class="icon-btn sm" (click)="store.patch({ catDelId: c.id })" aria-label="Supprimer"><f-icon name="trash" [size]="14" color="var(--primary)" /></button>
            </div>
          </div>

          @if (store.childrenOf(c.id); as subs) {
            @if (subs.length) {
              <div class="subs">
                @for (s of subs; track s.id) {
                  <div class="sub">
                    <span class="sub-dot" [style.background]="s.color"></span>
                    <span class="sub-name">{{ s.name }}</span>
                    @if (s.monthlyBudget > 0) { <span class="sub-budget">{{ fmtInt(s.monthlyBudget) }} €</span> }
                    <button class="icon-btn sm" (click)="store.editCategory(s.id)" aria-label="Modifier"><f-icon name="edit" [size]="13" color="var(--ink3)" /></button>
                    <button class="icon-btn sm" (click)="store.patch({ catDelId: s.id })" aria-label="Supprimer"><f-icon name="trash" [size]="13" color="var(--primary)" /></button>
                  </div>
                }
              </div>
            }
          }
          <button class="addsub" (click)="store.newCategory(c.id)"><f-icon name="plus" [size]="13" color="var(--primary)" [width]="2.8" /> Sous-catégorie</button>
        </div>
      } @empty {
        <div class="empty">
          <div class="empty-title">Aucune catégorie</div>
          <div class="empty-txt">Créez-en une pour commencer à classer vos opérations.</div>
        </div>
      }
    </div>

    <!-- FORMULAIRE DE CATÉGORIE -->
    @if (store.ui().catForm) {
      <f-modal [title]="modalTitle()" [maxWidth]="470" (close)="store.patch({ catForm: false })">
        @if (parentName(); as p) { <div class="parent">Sous-catégorie de « {{ p }} »</div> }
        <div class="frow">
          <div class="fgrow">
            <div class="field-label first">Nom</div>
            <input class="input" [ngModel]="store.ui().catName" (ngModelChange)="store.patch({ catName: $event })" placeholder="Ex : Assurances" />
          </div>
          <div class="fnarrow">
            <div class="field-label first">Budget €/mois</div>
            <input class="input" [ngModel]="store.ui().catBudget" (ngModelChange)="store.patch({ catBudget: $event })" placeholder="300" inputmode="decimal" />
          </div>
        </div>
        <div class="field-label">Couleur</div>
        <div class="swatch-row">
          @for (col of CAT_PALETTE; track col) {
            <div class="swatch" [style.background]="col" [class.on]="store.ui().catColor === col" (click)="store.patch({ catColor: col })"></div>
          }
        </div>
        <div class="field-label">Icône</div>
        <div class="icon-grid">
          @for (k of iconKeys; track k) {
            <div class="icon-opt" [class.on]="store.ui().catIcon === k" (click)="store.patch({ catIcon: k })">
              <f-icon [path]="CAT_ICONS[k]" [size]="20" [color]="store.ui().catIcon === k ? '#fff' : 'var(--ink2)'" [width]="2" />
            </div>
          }
        </div>
        <div class="modal-acts">
          <button class="btn btn-soft" (click)="store.patch({ catForm: false })">Annuler</button>
          <button class="btn btn-primary grow" [disabled]="store.ui().busy" (click)="store.saveCategory()">{{ store.ui().catId ? 'Enregistrer' : 'Créer' }}</button>
        </div>
      </f-modal>
    }

    @if (store.ui().catDelId) {
      <f-modal [maxWidth]="420" (close)="store.patch({ catDelId: null })">
        <div class="confirm">
          <div class="confirm-ic"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="confirm-title f-display">Supprimer cette catégorie ?</div>
          <div class="confirm-txt">
            « {{ delName() }} » sera retirée{{ delChildren() ? ', avec ses ' + delChildren() + ' sous-catégorie' + (delChildren() > 1 ? 's' : '') : '' }}.
            Les opérations concernées sont conservées et repassent en « Sans catégorie ».
          </div>
          <div class="modal-acts">
            <button class="btn btn-soft grow" (click)="store.patch({ catDelId: null })">Annuler</button>
            <button class="btn btn-primary grow" (click)="store.confirmCategoryDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
    .spacer { flex: 1; }
    .hint { font-size: 12.5px; font-weight: 700; color: var(--ink3); max-width: 560px; line-height: 1.45; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    :host-context(.shell.narrow) .grid { grid-template-columns: 1fr; }
    .card { background: var(--surface); border-radius: 18px; padding: 16px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .idz { display: flex; align-items: center; gap: 11px; min-width: 0; }
    .chip { width: 34px; height: 34px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .name { font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .budget { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 1px; }
    .acts { display: flex; gap: 5px; flex: none; }

    .subs { display: flex; flex-direction: column; gap: 5px; margin-top: 12px; padding-top: 11px; border-top: 1px solid var(--line); }
    .sub { display: flex; align-items: center; gap: 8px; }
    .sub-dot { width: 8px; height: 8px; flex: none; border-radius: 3px; }
    .sub-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub-budget { font-size: 11.5px; font-weight: 800; color: var(--ink3); }
    .addsub { display: flex; align-items: center; gap: 6px; margin-top: 12px; background: none; border: none; padding: 0; font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; font-family: inherit; }
    .empty { grid-column: 1 / -1; background: var(--surface); border-radius: 16px; padding: 34px 24px; text-align: center; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .empty-title { font-size: 15px; font-weight: 800; color: var(--ink); }
    .empty-txt { font-size: 13px; font-weight: 700; color: var(--ink3); margin-top: 6px; }

    .parent { font-size: 12.5px; font-weight: 800; color: var(--ink3); margin-bottom: 14px; }
    .frow { display: flex; gap: 12px; }
    .fgrow { flex: 1; min-width: 0; }
    .fnarrow { width: 140px; flex: none; }
    @media (max-width: 520px) { .frow { flex-direction: column; } .fnarrow { width: 100%; } }
    .field-label { margin-top: 16px; }
    .field-label.first { margin-top: 0; }
    .swatch-row { display: flex; gap: 11px; flex-wrap: wrap; }
    .swatch { width: 38px; height: 38px; border-radius: 12px; cursor: pointer; }
    .swatch.on { box-shadow: 0 0 0 3px var(--surface), 0 0 0 6px currentColor; }
    .icon-grid { display: flex; flex-wrap: wrap; gap: 9px; }
    .icon-opt { width: 40px; height: 40px; border-radius: 12px; background: var(--soft2); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .icon-opt.on { background: var(--primary); }
    .modal-acts { display: flex; gap: 12px; margin-top: 22px; align-items: center; }
    .modal-acts .grow { flex: 1; }
    .confirm { text-align: center; }
    .confirm-ic { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #FCE9E3; display: flex; align-items: center; justify-content: center; }
    .confirm-title { font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-txt { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 0; line-height: 1.5; }
  `],
})
export class FinancesCategoriesTab {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  CAT_ICONS = CAT_ICONS;
  CAT_PALETTE = CAT_PALETTE;
  iconKeys = Object.keys(CAT_ICONS);
  fmt = fmtEuros;
  fmtInt = fmtEurosInt;

  parentName = computed(() => {
    const p = this.store.ui().catParent;
    return p ? this.store.categories().find((c) => c.id === p)?.name || '' : '';
  });
  modalTitle = computed(() => {
    if (this.store.ui().catId) return 'Modifier la catégorie';
    return this.store.ui().catParent ? 'Nouvelle sous-catégorie' : 'Nouvelle catégorie';
  });
  delName = computed(() => this.store.categories().find((c) => c.id === this.store.ui().catDelId)?.name || '');
  delChildren = computed(() => {
    const id = this.store.ui().catDelId;
    return id ? this.store.childrenOf(id).length : 0;
  });
}
