import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../core/icon';
import { TileComponent } from '../../shared/tile';
import { FinancesStore, fmtEurosInt } from '../../core/finances.store';
import { FinancesTileData } from '../../core/tiles/finances.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-finances',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent, IconComponent, FormsModule],
  template: `
    <f-tile [title]="tile().title" [badge]="badge()" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="amt f-display">{{ eur(d.expense) }} €@if (d.budgetTotal > 0) { <span class="total"> / {{ eur(d.budgetTotal) }} €</span> }</div>
        @if (d.budgetTotal > 0) {
          <div class="bar"><div class="bar-fill" [style.width.%]="barW(d.expense, d.budgetTotal)"></div></div>
          <div class="note">
            {{ d.expense <= d.budgetTotal
              ? 'Il reste ' + eur(d.budgetTotal - d.expense) + ' € sur le budget de référence'
              : 'Budget de référence dépassé de ' + eur(d.expense - d.budgetTotal) + ' €' }}
          </div>
        } @else {
          <div class="note">{{ eur(d.income) }} € de ressources ce mois-ci</div>
        }
        @if (d.balance !== null) {
          <div class="solde">Comptes courants : <b>{{ eur(d.balance) }} €</b></div>
        }

        <!--
          La dépense en espèces : la seule qui n'arrive jamais par un import
          bancaire, donc la seule qui manque toujours au total du mois. Sans
          catégorie, c'est le travail des règles ; sans compte à choisir quand il
          n'y en a qu'un, parce que choisir pour rien est un tap de trop.
        -->
        @if (d.accounts.length) {
          @if (form()) {
            <div class="cash">
              <div class="row">
                <input class="input sm" inputmode="decimal" [ngModel]="amount()" (ngModelChange)="amount.set($event)"
                       placeholder="Montant" (keydown.enter)="save()" (keydown.escape)="cancel()" />
                <input class="input sm" [ngModel]="label()" (ngModelChange)="label.set($event)"
                       placeholder="Quoi ?" (keydown.enter)="save()" (keydown.escape)="cancel()" />
              </div>
              @if (d.accounts.length > 1) {
                <select class="input sm" [ngModel]="account()" (ngModelChange)="account.set(+$event)">
                  @for (a of d.accounts; track a.id) { <option [value]="a.id">{{ a.name }}</option> }
                </select>
              }
              <div class="row">
                <button class="btn-cash" [disabled]="!ready() || fin.quickBusy()" (click)="save()">
                  {{ fin.quickBusy() ? 'Enregistrement…' : 'Enregistrer sur ' + accountName(d.accounts) }}
                </button>
                <button class="btn-cancel" (click)="cancel()">Annuler</button>
              </div>
            </div>
          } @else {
            <button class="opener" (click)="openForm(d.accounts)">
              <f-icon name="plus" [size]="14" color="var(--ink2)" [width]="2.6" /> Dépense en espèces
            </button>
          }
        }
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .amt { font-size: 28px; font-weight: 700; color: var(--ink); }
    .total { font-size: 15px; color: var(--ink3); font-weight: 700; }
    .bar { height: 9px; background: var(--line2); border-radius: 8px; margin-top: 12px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, #F0B24B, #E56B4E); border-radius: 8px; }
    .note { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 8px; }
    .solde { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--line); }
    .solde b { color: var(--ink); }

    .opener {
      display: flex; align-items: center; gap: 7px; width: 100%; justify-content: center; margin-top: 12px;
      border: 1px dashed var(--line2); background: transparent; cursor: pointer;
      border-radius: 12px; padding: 9px; font-size: 12.5px; font-weight: 800; color: var(--ink2);
    }
    .cash { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
    .row { display: flex; gap: 8px; }
    .input.sm { flex: 1; min-width: 0; padding: 9px 12px; font-size: 13.5px; }
    .btn-cash {
      flex: 1; border: none; cursor: pointer; border-radius: 11px; padding: 9px 12px;
      background: var(--sage); color: #fff; font-size: 12.5px; font-weight: 800;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .btn-cash:disabled { background: var(--line2); cursor: default; }
    .btn-cancel { flex: none; border: none; cursor: pointer; border-radius: 11px; padding: 9px 12px;
                  background: var(--soft2); color: var(--ink2); font-size: 12.5px; font-weight: 800; }
  `],
})
export class FinancesTile extends HomeTile<FinancesTileData> {
  fin = inject(FinancesStore);

  readonly badge = computed(() => this.data()?.monthLabel ?? '');
  eur = fmtEurosInt;
  barW(expense: number, budget: number): number { return budget > 0 ? Math.min(expense / budget * 100, 100) : 0; }

  readonly form = signal(false);
  readonly amount = signal('');
  readonly label = signal('');
  readonly account = signal(0);
  /** Un montant qui n'est pas un nombre n'enregistre rien : le dire par le bouton. */
  readonly ready = computed(() => /\d/.test(this.amount()) && !isNaN(this.parsed()));

  private parsed(): number { return parseFloat(this.amount().replace(',', '.')); }

  openForm(accounts: { id: number; name: string }[]): void {
    this.account.set(accounts[0]?.id ?? 0);
    this.amount.set('');
    this.label.set('');
    this.form.set(true);
  }
  cancel(): void { this.form.set(false); }

  accountName(accounts: { id: number; name: string }[]): string {
    return accounts.find((a) => a.id === this.account())?.name ?? 'le compte';
  }

  save(): void {
    if (!this.ready() || this.fin.quickBusy()) return;
    void this.fin.quickExpense(this.account(), this.amount(), this.label());
    this.form.set(false);
  }
}
