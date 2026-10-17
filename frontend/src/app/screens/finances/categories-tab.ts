import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ToggleComponent } from '../../shared/toggle';
import { FinancesStore, fmtEuros, fmtEurosInt } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { CheckComponent } from '../../shared/check';
import { ConfirmComponent } from '../../shared/confirm';
import { CAT_ICONS, CAT_PALETTE } from '../../core/constants';

@Component({
  selector: 'fin-categories-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, FormsModule, IconComponent, ModalComponent, ConfirmComponent, CheckComponent, ToggleComponent],
  template: `
    <section class="panel">
      <div class="tbl" role="table" aria-label="Catégories">
        <div class="tr th" role="row">
          <span role="columnheader" class="c-name">Catégorie</span>
          <span role="columnheader" class="num">Budget / mois</span>
          <span role="columnheader" class="num">Moyenne {{ avgMonths() }}</span>
          <span role="columnheader" class="c-fixed">Fixe</span>
          <span role="columnheader"><span class="sr">Actions</span></span>
        </div>
        @for (c of store.rootCategories(); track c.id) {
          <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: c, sub: false }" />
          @for (s of store.childrenOf(c.id); track s.id) {
            <ng-container [ngTemplateOutlet]="row" [ngTemplateOutletContext]="{ $implicit: s, sub: true }" />
          }
          <div class="tr add" role="row"><button class="addsub" (click)="store.newCategory(c.id)">+ Sous-catégorie de {{ c.name }}</button></div>
        } @empty {
          <div class="empty">Aucune catégorie. Créez-en une pour commencer à classer vos opérations.</div>
        }
      </div>
      <div class="foot">
        <button class="addsub strong" (click)="store.newCategory(null)">+ Catégorie</button>
        <span class="hint">Une catégorie « fixe » sort des enveloppes et alimente la liste des charges fixes. Le budget de référence ne bloque rien : il situe le réel.</span>
      </div>
    </section>

    <ng-template #row let-c let-sub="sub">
      @let avg = store.catAverages().averages[c.id] ?? 0;
      @let over = c.monthlyBudget > 0 && avg > c.monthlyBudget * 1.05;
      <div class="tr" role="row" [class.sub]="sub">
        <span class="c-name" role="cell">
          @if (sub) { <span class="dot" [style.background]="c.color"></span> }
          @else { <span class="chip" [style.background]="foyer.tint(c.color)"><f-icon [path]="CAT_ICONS[c.icon] || CAT_ICONS['facture']" [size]="16" [color]="c.color" [width]="2" /></span> }
          <button class="name" (click)="store.editCategory(c.id)" [attr.aria-label]="'Modifier ' + c.name">{{ c.name }}</button>
        </span>
        <span class="num" role="cell">{{ c.monthlyBudget > 0 ? fmtInt(c.monthlyBudget) + ' €' : '·' }}</span>
        <span class="num" role="cell" [class.over]="over">@if (over) {<span aria-hidden="true">⚠ </span>}{{ avg ? fmtInt(avg) + ' €' : '·' }}@if (over) {<span class="sr"> au-dessus du budget</span>}</span>
        <span class="c-fixed" role="cell">
          @if (!sub || !isRootFixed(c.parentId)) {
            <f-toggle [on]="c.fixed" [label]="'Charge fixe : ' + c.name" (toggled)="store.toggleFixed(c.id, $event)" />
          }
        </span>
        <span class="acts" role="cell">
          <button class="icon-btn sm" (click)="store.editCategory(c.id)" [attr.aria-label]="'Modifier ' + c.name"><f-icon name="edit" [size]="13" color="var(--ink2)" /></button>
          <button class="icon-btn sm" (click)="store.patch({ catDelId: c.id })" [attr.aria-label]="'Supprimer ' + c.name"><f-icon name="trash" [size]="13" color="var(--primary)" /></button>
        </span>
      </div>
    </ng-template>

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
        <label class="check" (click)="store.patch({ catFixed: !store.ui().catFixed })">
          <f-check [checked]="store.ui().catFixed" />
          <span>Charge fixe (loyer, prêt, assurance, abonnement) : suivie dans « Charges fixes » d'après ses contrats, hors enveloppes</span>
        </label>
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
      <f-confirm [maxWidth]="420" title="Supprimer cette catégorie ?" (cancel)="store.patch({ catDelId: null })" (confirm)="store.confirmCategoryDel()">
        « {{ delName() }} » sera retirée{{ delChildren() ? ', avec ses ' + delChildren() + ' sous-catégorie' + (delChildren() > 1 ? 's' : '') : '' }}.
        Les opérations concernées sont conservées et repassent en « Sans catégorie ».
      </f-confirm>
    }
  `,
  styles: [`
    .panel { background: var(--surface); border-radius: var(--r-card-lg); padding: 14px 22px 18px; box-shadow: var(--sh-card); }
    .tr { display: grid; grid-template-columns: minmax(0, 1fr) 110px 120px 60px 76px; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
    .th { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); }
    .tr.add { display: block; padding: 4px 0 10px 46px; }
    .c-name { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .tr.sub .c-name { padding-left: 46px; }
    .chip { width: 34px; height: 34px; flex: none; border-radius: 11px; display: grid; place-items: center; }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .name { border: none; background: none; padding: 0; font-family: inherit; font-size: 14.5px; font-weight: 800; color: var(--ink); cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tr.sub .name { font-weight: 700; font-size: 13.5px; }
    .num { text-align: right; font-size: 14px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
    .num.over { color: var(--status-crit); }
    .c-fixed { display: flex; justify-content: center; }
    .acts { display: flex; gap: 4px; justify-content: flex-end; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    @media (max-width: 720px) {
      .tr { grid-template-columns: minmax(0, 1fr) 70px 78px 50px; }
      .acts { display: none; }
      .tr.sub .c-name, .tr.add { padding-left: 22px; }
    }
    /* Sur téléphone, le nom prend toute la ligne, les chiffres passent dessous. */
    @media (max-width: 560px) {
      .tr { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 50px; row-gap: 6px; }
      .c-name { grid-column: 1 / -1; }
      .th .c-name { display: none; }
    }
    .addsub { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; padding: 0; font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; font-family: inherit; }
    .addsub.strong { font-size: 13.5px; }
    .foot { display: flex; align-items: center; gap: 8px 16px; flex-wrap: wrap; margin-top: 14px; }
    .hint { font-size: 12.5px; font-weight: 700; color: var(--ink3); line-height: 1.45; }
    .empty { padding: 24px 0; font-size: 13px; font-weight: 700; color: var(--ink3); }
    .check { display: flex; align-items: flex-start; gap: 10px; margin-top: 16px; font-size: 13px; font-weight: 700; color: var(--ink2); cursor: pointer; }

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
  constructor() { void this.store.loadCategoryAverages(); }

  /** « 3 mois », ou ce qu'il y a de mois complets ; « · » quand il n'y en a aucun. */
  readonly avgMonths = computed(() => { const n = this.store.catAverages().months.length; return n ? `${n} mois` : '(aucun mois complet)'; });
  /** Une sous-catégorie d'une catégorie fixe l'est déjà par sa parente. */
  isRootFixed(parentId: number | null): boolean { return !!parentId && !!this.store.categories().find((c) => c.id === parentId)?.fixed; }

  delChildren = computed(() => {
    const id = this.store.ui().catDelId;
    return id ? this.store.childrenOf(id).length : 0;
  });
}
