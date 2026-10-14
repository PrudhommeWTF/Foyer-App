import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { LoyaltyCard } from '../../core/models';
import { onColor } from '../../core/cards';

/**
 * Cartes de fidélité : les tuiles, par usage ou par nom. Un tap ouvre la fiche
 * de la carte, qui présente son code en caisse (card-view.ts) ; la saisie, le
 * scan et l'import d'une photo vivent dans son formulaire (card-form.ts).
 */
@Component({
  selector: 'screen-fidelite',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, NgTemplateOutlet],
  template: `
    <div class="screen-enter">
      <div class="head-row">
        <div class="search">
          <f-icon name="search" [size]="18" color="var(--ink3)" [width]="2.2" />
          <input [ngModel]="store.ui().cardSearch" (ngModelChange)="store.patch({ cardSearch: $event })" placeholder="Rechercher une carte…" />
        </div>
        <button class="btn btn-primary" (click)="store.newCard()"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Nouvelle carte</button>
      </div>

      @if (!total()) {
        <div class="card empty">
          <div class="empty-ico"><f-icon name="card" [size]="30" color="var(--ink3)" [width]="1.8" /></div>
          <div class="empty-title">Aucune carte de fidélité</div>
          <div class="empty-text">Ajoutez vos cartes une fois, et retrouvez leur code sur le téléphone à chaque passage en caisse.</div>
          <button class="btn btn-primary" (click)="store.newCard()"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Ajouter une carte</button>
        </div>
      } @else {
        <div class="meta">
          <div class="count">{{ total() }} carte{{ total() > 1 ? 's' : '' }} de fidélité</div>
          @if (store.isAdmin()) {
            <button class="sortby" (click)="store.toggleCardSort()">Trier par {{ sortMode() === 'freq' ? 'nom' : 'usage' }}</button>
          }
        </div>

        @if (searching()) {
          <div class="tiles">
            @for (c of rest(); track c.id) { <ng-container [ngTemplateOutlet]="tile" [ngTemplateOutletContext]="{ $implicit: c }" /> }
            @empty { <div class="nores">Aucune carte pour cette recherche.</div> }
          </div>
        } @else {
          @if (frequent().length) {
            <div class="sep">Fréquemment utilisées</div>
            <div class="tiles">
              @for (c of frequent(); track c.id) { <ng-container [ngTemplateOutlet]="tile" [ngTemplateOutletContext]="{ $implicit: c }" /> }
            </div>
          }
          @if (rest().length) {
            @if (frequent().length) { <div class="sep">Autres cartes</div> }
            <div class="tiles">
              @for (c of rest(); track c.id) { <ng-container [ngTemplateOutlet]="tile" [ngTemplateOutletContext]="{ $implicit: c }" /> }
            </div>
          }
        }
      }
    </div>

    <!-- Une carte : une tuile aux couleurs de l'enseigne, son logo au centre (ou son nom). -->
    <ng-template #tile let-c>
      <button class="tile" [style.background]="c.color" (click)="store.showCard(c.id)" [attr.aria-label]="c.name">
        @if (c.logo) { <img class="tlogo" [src]="c.logo" [alt]="c.name" /> }
        @else { <span class="tname" [style.color]="onColor(c.color)">{{ c.name }}</span> }
      </button>
    </ng-template>

  `,
  styles: [`
    .head-row { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
    .search { flex: 1; display: flex; align-items: center; gap: 10px; background: var(--surface); border-radius: 14px; padding: 12px 16px; box-shadow: 0 6px 16px -14px rgba(90,60,40,.6); }
    .search input { flex: 1; border: none; background: transparent; font-size: 14.5px; font-weight: 600; color: var(--ink); outline: none; }
    .head-row .btn { flex: none; }

    .meta { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .count { font-family: var(--font-display); font-size: 18px; font-weight: 800; color: var(--ink); }
    .sortby { flex: none; background: none; border: none; cursor: pointer; font-size: 13px; font-weight: 800; color: var(--ink2); text-decoration: underline; text-underline-offset: 3px; padding: 4px 2px; }

    .sep { display: flex; align-items: center; gap: 12px; margin: 22px 0 14px; font-size: 13px; font-weight: 800; color: var(--ink3); }
    .sep::before, .sep::after { content: ''; flex: 1; height: 1px; background: var(--line2); }

    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 14px; }
    .tile { position: relative; aspect-ratio: 16 / 10; border-radius: 18px; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 18px; overflow: hidden; box-shadow: 0 10px 24px -18px rgba(90,60,40,.85); }
    .tile:active { transform: scale(.98); }
    .tlogo { max-width: 78%; max-height: 62%; object-fit: contain; }
    .tname { font-family: var(--font-display); font-weight: 800; font-size: 19px; line-height: 1.15; text-align: center; letter-spacing: .01em; word-break: break-word; }
    .nores { grid-column: 1 / -1; text-align: center; padding: 24px; font-size: 14px; font-weight: 700; color: var(--ink3); }

    .card.empty { padding: 44px 24px; text-align: center; border-radius: 20px; background: var(--surface); box-shadow: 0 8px 20px -18px rgba(90,60,40,.7); }
    .empty-ico { width: 60px; height: 60px; margin: 0 auto 16px; border-radius: 50%; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .empty-title { font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--ink); }
    .empty-text { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px auto 20px; max-width: 340px; }

  `],
})
export class FideliteScreen {
  store = inject(FoyerStore);
  private d = this.store.d;

  onColor = onColor;

  total = computed(() => this.d().cards.length);
  private query = computed(() => this.store.ui().cardSearch.trim().toLowerCase());
  searching = computed(() => this.query().length > 0);
  /** Rangement choisi pour le foyer : 'freq' (fréquentes en tête) ou 'nom'. */
  sortMode = computed(() => this.store.setting('cardSort'));
  private byName = (a: LoyaltyCard, b: LoyaltyCard) => a.name.localeCompare(b.name, 'fr');

  /** Les cartes les plus présentées en caisse, en tête et hors recherche (mode 'freq'). Vide sinon. */
  frequent = computed<LoyaltyCard[]>(() => {
    if (this.searching() || this.sortMode() !== 'freq') return [];
    return this.d().cards
      .filter((c) => (c.uses || 0) > 0)
      .sort((a, b) => (b.uses || 0) - (a.uses || 0) || (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))
      .slice(0, 6);
  });

  /** Le reste : à la recherche, les résultats ; sinon les cartes non « fréquentes », par nom. */
  rest = computed<LoyaltyCard[]>(() => {
    const q = this.query();
    const cards = [...this.d().cards];
    if (q) return cards.filter((c) => c.name.toLowerCase().includes(q)).sort(this.byName);
    const freq = new Set(this.frequent().map((c) => c.id));
    return cards.filter((c) => !freq.has(c.id)).sort(this.byName);
  });
}
