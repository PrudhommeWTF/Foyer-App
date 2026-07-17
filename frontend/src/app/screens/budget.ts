import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { CAT_ICONS, CAT_PALETTE } from '../core/constants';
import { fmtAmt, fmtInt, monthLabelFor } from '../core/helpers';
import { Transaction } from '../core/models';

interface Delta { txt: string; color: string; }

@Component({
  selector: 'screen-budget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <div class="cols">
        <div class="main">
          <!-- SYNTHÈSE -->
          <div class="synth">
            <div class="synth-top">
              <div class="nav">
                <button class="nav-btn" (click)="prevMonth()"><f-icon name="chevronLeft" [size]="17" color="#fff" [width]="2.2" /></button>
                <div class="nav-label">
                  <div class="nav-month f-display">{{ monthLabel() }}</div>
                  <div class="nav-tag">{{ monthTag() }}</div>
                </div>
                <button class="nav-btn" [class.off]="monthOffset() >= 0" [disabled]="monthOffset() >= 0" (click)="nextMonth()"><f-icon name="chevronRight" [size]="17" color="#fff" [width]="2.2" /></button>
              </div>
              @if (cmp(); as c) {
                <div class="cmp">
                  <f-icon [name]="cmpUp() ? 'arrowUp' : 'arrowDown'" [size]="15" [color]="c.color" [width]="2.4" />
                  <span [style.color]="c.color">{{ c.txt }}</span>
                </div>
              }
            </div>
            <div class="overline light">Dépensé</div>
            <div class="big f-display">{{ fmtInt(spent()) }} €</div>
            <div class="sub">sur {{ fmtInt(total()) }} € de budget · {{ prevMonthLabel() }} : {{ fmtInt(spentPrev()) }} €</div>
            <div class="pbar"><div class="pfill" [style.width.%]="barW()" [style.background]="barColor()"></div></div>
            <div class="mini">
              <div><div class="overline light">Revenus</div><div class="mini-val f-display" style="color:#8FBF86">+{{ fmtInt(income()) }} €</div></div>
              <div><div class="overline light">Dépenses</div><div class="mini-val f-display" style="color:#F0A98B">−{{ fmtInt(spent()) }} €</div></div>
              <div><div class="overline light">Solde</div><div class="mini-val f-display" [style.color]="balance() >= 0 ? '#8FBF86' : 'var(--primary)'">{{ fmtInt(balance()) }} €</div></div>
            </div>
          </div>

          <!-- CATÉGORIES -->
          <div class="sec-head">
            <div class="overline">Par catégorie</div>
            <button class="add" (click)="store.newCat()"><f-icon name="plus" [size]="15" color="var(--primary)" [width]="2.6" />Nouvelle catégorie</button>
          </div>
          <div class="cat-grid">
            @for (c of d().bcats; track c.id) {
              <div class="cat-card">
                <div class="cat-top">
                  <div class="cat-id">
                    <div class="cat-chip" [style.background]="store.tint(c.color)"><f-icon [path]="CAT_ICONS[c.icon] || CAT_ICONS['facture']" [size]="18" [color]="c.color" [width]="2" /></div>
                    <span class="cat-name">{{ c.name }}</span>
                  </div>
                  <div class="cat-acts">
                    <button class="icon-btn sm" (click)="store.editCat(c.id)"><f-icon name="edit" [size]="14" color="var(--ink2)" /></button>
                    <button class="icon-btn sm" (click)="store.patch({ catDelId: c.id })"><f-icon name="trash" [size]="14" color="var(--primary)" /></button>
                  </div>
                </div>
                <div class="cat-line">
                  <span class="cat-amt">{{ fmtInt(catSpent(c.id)) }} / {{ fmtInt(c.budget) }} €</span>
                  <span class="cat-pct" [style.color]="catOver(c) ? 'var(--primary)' : 'var(--ink3)'">{{ catPct(c) }}%</span>
                </div>
                <div class="pbar sm"><div class="pfill" [style.width.%]="catBarW(c)" [style.background]="catOver(c) ? 'var(--primary)' : c.color"></div></div>
                @if (catDelta(c); as dl) { <div class="cat-delta" [style.color]="dl.color">{{ dl.txt }}</div> }
              </div>
            }
          </div>
        </div>

        <!-- TRANSACTIONS -->
        <div class="side">
          <div class="sec-head">
            <div class="overline">Transactions</div>
            <button class="add" (click)="store.newTx()"><f-icon name="plus" [size]="15" color="var(--primary)" [width]="2.6" />Ajouter</button>
          </div>
          <div class="tx-list">
            @for (t of txMonth(); track t.id) {
              <div class="tx" (click)="store.editTx(t.id)">
                <div class="tx-chip" [style.background]="t.income ? '#EDF2EB' : store.tint(catColor(t.catId))">
                  @if (t.income) {
                    <f-icon name="arrowUp" [size]="18" color="#7A9B76" [width]="2.2" />
                  } @else {
                    <f-icon [path]="CAT_ICONS[catIconKey(t.catId)] || CAT_ICONS['facture']" [size]="18" [color]="catColor(t.catId)" [width]="2.2" />
                  }
                </div>
                <div class="tx-body">
                  <div class="tx-name">{{ t.name }}</div>
                  <div class="tx-meta">{{ t.income ? 'Revenu' : catName(t.catId) }} · {{ t.date }}</div>
                </div>
                <div class="tx-amt" [style.color]="t.income ? '#7A9B76' : 'var(--ink)'">{{ (t.income ? '+' : '−') + fmtAmt(t.amount) }} €</div>
              </div>
            } @empty {
              <div class="tx-empty">Aucune transaction</div>
            }
          </div>
        </div>
      </div>
    </div>

    <!-- CATEGORY MODAL -->
    @if (store.ui().catForm) {
      <f-modal [title]="store.ui().catEditId ? 'Modifier la catégorie' : 'Nouvelle catégorie'" [maxWidth]="460" (close)="store.patch({ catForm: false })">
        <div class="frow">
          <div class="fgrow">
            <div class="field-label">Nom</div>
            <input class="input" [ngModel]="store.ui().cName" (ngModelChange)="store.patch({ cName: $event })" placeholder="Ex : Santé" />
          </div>
          <div class="fnarrow">
            <div class="field-label">Budget €</div>
            <input class="input" [ngModel]="store.ui().cBudget" (ngModelChange)="store.patch({ cBudget: $event })" placeholder="300" inputmode="numeric" />
          </div>
        </div>
        <div class="field-label">Couleur</div>
        <div class="swatch-row">
          @for (col of CAT_PALETTE; track col) {
            <div class="swatch" [style.background]="col" [class.on]="store.ui().cColor === col" (click)="store.patch({ cColor: col })"></div>
          }
        </div>
        <div class="field-label">Icône</div>
        <div class="icon-grid">
          @for (k of catIconKeys; track k) {
            <div class="icon-opt" [class.on]="store.ui().cIcon === k" (click)="store.patch({ cIcon: k })">
              <f-icon [path]="CAT_ICONS[k]" [size]="20" [color]="store.ui().cIcon === k ? '#fff' : 'var(--ink2)'" [width]="2" />
            </div>
          }
        </div>
        <div class="modal-acts">
          <button class="btn btn-soft" (click)="store.patch({ catForm: false })">Annuler</button>
          <button class="btn btn-primary grow" (click)="store.saveCat()">{{ store.ui().catEditId ? 'Enregistrer' : 'Créer' }}</button>
        </div>
      </f-modal>
    }

    <!-- TRANSACTION MODAL -->
    @if (store.ui().txForm) {
      <f-modal [title]="store.ui().txEditId ? 'Modifier la transaction' : 'Nouvelle transaction'" [maxWidth]="480" (close)="store.patch({ txForm: false })">
        <div class="seg type-seg">
          <button [class.active]="!store.ui().txIncome" (click)="store.patch({ txIncome: false })">Dépense</button>
          <button [class.active]="store.ui().txIncome" (click)="store.patch({ txIncome: true })">Revenu</button>
        </div>
        <div class="frow">
          <div class="fgrow">
            <div class="field-label">Libellé</div>
            <input class="input" [ngModel]="store.ui().txName" (ngModelChange)="store.patch({ txName: $event })" placeholder="Ex : Carrefour" />
          </div>
          <div class="fnarrow">
            <div class="field-label">Montant €</div>
            <input class="input" [ngModel]="store.ui().txAmount" (ngModelChange)="store.patch({ txAmount: $event })" placeholder="84,30" inputmode="decimal" />
          </div>
        </div>
        @if (!store.ui().txIncome) {
          <div class="field-label">Catégorie</div>
          <div class="seg cat-seg">
            @for (c of d().bcats; track c.id) {
              <button [class.active]="store.ui().txCatId === c.id" (click)="store.patch({ txCatId: c.id })">
                <span class="dot" [style.background]="c.color"></span>{{ c.name }}
              </button>
            }
          </div>
        }
        <div class="field-label">Date</div>
        <input class="input" [ngModel]="store.ui().txDate" (ngModelChange)="store.patch({ txDate: $event })" placeholder="15 juil." />
        <div class="modal-acts">
          @if (store.ui().txEditId) {
            <button class="btn btn-danger" (click)="store.delTx()"><f-icon name="trash" [size]="16" color="var(--primary)" />Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ txForm: false })">Annuler</button>
          <button class="btn btn-primary" (click)="store.saveTx()">Enregistrer</button>
        </div>
      </f-modal>
    }

    <!-- DELETE CONFIRM -->
    @if (store.ui().catDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ catDelId: null })">
        <div class="confirm">
          <div class="confirm-ic"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="confirm-title f-display">Supprimer cette catégorie ?</div>
          <div class="confirm-txt">« {{ delCatName() }} » sera retirée. Ses transactions passeront en « Sans catégorie ».</div>
          <div class="modal-acts">
            <button class="btn btn-soft grow" (click)="store.patch({ catDelId: null })">Annuler</button>
            <button class="btn btn-primary grow" (click)="store.confirmCatDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .cols { display: flex; gap: 24px; align-items: flex-start; }
    .main { flex: 1; min-width: 0; }
    .side { width: 340px; flex: none; }
    :host-context(.shell.narrow) .cols { flex-direction: column; }
    :host-context(.shell.narrow) .side { width: 100%; }
    @media (max-width: 860px) { .cols { flex-direction: column; } .side { width: 100%; } }

    .synth { background: linear-gradient(135deg, #3A302A, #5A4A3E); border-radius: 24px; padding: 28px; color: #fff; margin-bottom: 22px; box-shadow: 0 18px 34px -18px rgba(58,48,42,.6); }
    .synth-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .nav { display: flex; align-items: center; gap: 12px; }
    .nav-btn { width: 36px; height: 36px; border: none; border-radius: 11px; background: rgba(255,255,255,.14); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .nav-btn.off { opacity: .35; cursor: default; }
    .nav-label { text-align: center; min-width: 160px; }
    .nav-month { font-size: 19px; font-weight: 700; text-transform: capitalize; }
    .nav-tag { font-size: 11px; font-weight: 800; opacity: .6; text-transform: uppercase; letter-spacing: .05em; }
    .cmp { display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,.12); border-radius: 20px; padding: 7px 14px; }
    .cmp span { font-size: 12.5px; font-weight: 800; }
    .overline.light { opacity: .65; }
    .big { font-size: 46px; font-weight: 700; margin: 8px 0 4px; }
    .sub { font-size: 14px; font-weight: 700; opacity: .7; }
    .pbar { height: 10px; background: rgba(255,255,255,.18); border-radius: 8px; margin-top: 18px; overflow: hidden; }
    .pbar.sm { height: 10px; background: var(--line2); margin-top: 0; }
    .pfill { height: 100%; border-radius: 8px; }
    .mini { display: flex; gap: 26px; margin-top: 20px; }
    .mini-val { font-size: 20px; font-weight: 700; }

    .sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .add { display: flex; align-items: center; gap: 7px; background: none; border: none; font-size: 13px; font-weight: 800; color: var(--primary); cursor: pointer; }

    .cat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 20px; }
    :host-context(.shell.narrow) .cat-grid { grid-template-columns: 1fr; }
    @media (max-width: 640px) { .cat-grid { grid-template-columns: 1fr; } }
    .cat-card { background: var(--surface); border-radius: 16px; padding: 16px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .cat-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .cat-id { display: flex; align-items: center; gap: 11px; min-width: 0; }
    .cat-chip { width: 34px; height: 34px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .cat-name { font-size: 15px; font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cat-acts { display: flex; gap: 6px; flex: none; }
    .cat-line { display: flex; justify-content: space-between; margin-bottom: 7px; }
    .cat-amt { font-size: 13.5px; font-weight: 700; color: var(--ink2); }
    .cat-pct { font-size: 12.5px; font-weight: 800; }
    .cat-delta { font-size: 11.5px; font-weight: 800; margin-top: 8px; }

    .tx-list { display: flex; flex-direction: column; gap: 12px; }
    .tx { display: flex; align-items: center; gap: 13px; background: var(--surface); border-radius: 16px; padding: 14px 16px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); cursor: pointer; }
    .tx-chip { width: 38px; height: 38px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .tx-body { flex: 1; min-width: 0; }
    .tx-name { font-weight: 800; font-size: 14.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tx-meta { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .tx-amt { font-size: 15px; font-weight: 800; flex: none; }
    .tx-empty { background: var(--surface); border-radius: 16px; padding: 28px; text-align: center; color: var(--ink3); font-weight: 700; font-size: 14px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }

    .frow { display: flex; gap: 12px; }
    .fgrow { flex: 1; }
    .fnarrow { width: 130px; flex: none; }
    .swatch-row { display: flex; gap: 12px; margin-bottom: 6px; }
    .swatch { width: 40px; height: 40px; border-radius: 12px; cursor: pointer; }
    .swatch.on { box-shadow: 0 0 0 3px var(--surface), 0 0 0 6px currentColor; }
    .swatch.on { outline: none; }
    .icon-grid { display: flex; flex-wrap: wrap; gap: 9px; }
    .icon-opt { width: 40px; height: 40px; border-radius: 12px; background: var(--soft2); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .icon-opt.on { background: var(--primary); }
    .type-seg { margin-bottom: 18px; }
    .cat-seg { flex-wrap: wrap; }
    .cat-seg .dot { width: 9px; height: 9px; border-radius: 3px; display: inline-block; margin-right: 6px; }
    .modal-acts { display: flex; gap: 12px; margin-top: 22px; align-items: center; }
    .modal-acts .grow { flex: 1; }
    .modal-acts .btn-primary.grow { flex: 1.4; }
    .field-label { margin-top: 16px; }
    .frow .field-label:first-child, .type-seg + .frow .field-label { margin-top: 0; }

    .confirm { text-align: center; }
    .confirm-ic { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #FCE9E3; display: flex; align-items: center; justify-content: center; }
    .confirm-title { font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-txt { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 0; }
  `],
})
export class BudgetScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  CAT_ICONS = CAT_ICONS;
  CAT_PALETTE = CAT_PALETTE;
  catIconKeys = Object.keys(CAT_ICONS);
  fmtInt = fmtInt;
  fmtAmt = fmtAmt;

  monthOffset = computed(() => this.store.ui().monthOffset);
  monthLabel = computed(() => monthLabelFor(this.monthOffset()));
  prevMonthLabel = computed(() => monthLabelFor(this.monthOffset() - 1).split(' ')[0]);
  monthTag = computed(() => (this.monthOffset() === 0 ? 'Ce mois-ci' : this.monthOffset() === -1 ? 'Mois dernier' : 'Historique'));

  txMonth = computed(() => this.d().tx.filter((t) => (t.m || 0) === this.monthOffset()));
  txPrev = computed(() => this.d().tx.filter((t) => (t.m || 0) === this.monthOffset() - 1));

  private group(list: Transaction[]): Record<string, number> {
    const o: Record<string, number> = {};
    for (const t of list) { if (!t.income && t.catId) o[t.catId] = (o[t.catId] || 0) + t.amount; }
    return o;
  }
  spentByCat = computed(() => this.group(this.txMonth()));
  prevByCat = computed(() => this.group(this.txPrev()));

  spent = computed(() => this.txMonth().filter((t) => !t.income).reduce((a, t) => a + t.amount, 0));
  spentPrev = computed(() => this.txPrev().filter((t) => !t.income).reduce((a, t) => a + t.amount, 0));
  income = computed(() => this.txMonth().filter((t) => t.income).reduce((a, t) => a + t.amount, 0));
  total = computed(() => this.d().bcats.reduce((a, c) => a + c.budget, 0));
  balance = computed(() => this.income() - this.spent());

  barW = computed(() => (this.total() > 0 ? Math.min(this.spent() / this.total() * 100, 100) : 0));
  barColor = computed(() => (this.spent() > this.total() ? 'var(--primary)' : 'linear-gradient(90deg,#F0B24B,#E56B4E)'));

  cmp = computed(() => this.deltaLabel(this.spent(), this.spentPrev()));
  cmpUp = computed(() => this.spent() > this.spentPrev());

  deltaLabel(cur: number, prev: number): Delta | null {
    if (prev <= 0) return cur > 0 ? { txt: 'nouveau', color: 'var(--primary)' } : null;
    const pct = Math.round((cur - prev) / prev * 100);
    if (pct === 0) return { txt: '= mois préc.', color: 'var(--ink3)' };
    return { txt: (pct > 0 ? '+' : '') + pct + '% vs mois préc.', color: pct > 0 ? 'var(--primary)' : 'var(--sage)' };
  }

  catSpent(id: string): number { return this.spentByCat()[id] || 0; }
  catOver(c: { id: string; budget: number }): boolean { return this.catSpent(c.id) > c.budget; }
  catPct(c: { id: string; budget: number }): number { return c.budget > 0 ? Math.round(this.catSpent(c.id) / c.budget * 100) : 0; }
  catBarW(c: { id: string; budget: number }): number { return c.budget > 0 ? Math.min(this.catSpent(c.id) / c.budget * 100, 100) : 0; }
  catDelta(c: { id: string }): Delta | null { return this.deltaLabel(this.spentByCat()[c.id] || 0, this.prevByCat()[c.id] || 0); }

  catName(id: string | null): string { const c = this.d().bcats.find((x) => x.id === id); return c ? c.name : 'Sans catégorie'; }
  catColor(id: string | null): string { const c = this.d().bcats.find((x) => x.id === id); return c ? c.color : '#B7ABA0'; }
  catIconKey(id: string | null): string { const c = this.d().bcats.find((x) => x.id === id); return c?.icon || 'facture'; }

  delCatName = computed(() => this.d().bcats.find((c) => c.id === this.store.ui().catDelId)?.name || '');

  prevMonth(): void { this.store.patch({ monthOffset: this.monthOffset() - 1 }); }
  nextMonth(): void { this.store.patch({ monthOffset: Math.min(0, this.monthOffset() + 1) }); }
}
