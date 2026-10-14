import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS } from '../../core/constants';
import { Place, PlaceItem } from '../../core/models';

/**
 * Écran des lieux de vacances : ce qui reste d'une fois sur l'autre à la maison
 * de la montagne, au mobil-home du bord de mer. Contrairement à une liste de
 * préparation, un inventaire ne se remet jamais à zéro : il dit ce qui est
 * là-bas. Deux gestes le tiennent à jour, « J'ai laissé » et « J'ai ramené »,
 * visibles et modifiables par tout le foyer.
 */
@Component({
  selector: 'screen-lieux',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="screen-enter">
      <div class="head-row">
        <p class="intro">Ce que le foyer laisse sur place d'une fois sur l'autre. Notez ce qui reste, et d'un geste ce que vous ramenez ou laissez.</p>
        <button class="btn btn-primary new-btn" (click)="store.openPlace()">
          <f-icon name="plus" [size]="17" color="#fff" [width]="2.6" /> Nouveau lieu
        </button>
      </div>

      <!-- État de la synchronisation. Silencieux quand tout va bien. -->
      @if (store.syncOffline() || store.placePending()) {
        <div class="sync" [class.off]="store.syncOffline()">
          <f-icon [name]="store.syncOffline() ? 'x' : 'refresh'" [size]="15" [color]="store.syncOffline() ? '#C6492F' : 'var(--ink2)'" [width]="2.4" />
          @if (store.syncOffline()) {
            <span>Hors ligne. {{ store.placePending() }} modification(s) en attente, elles partiront au retour du réseau.</span>
          } @else {
            <span>Envoi de {{ store.placePending() }} modification(s)…</span>
          }
        </div>
      }

      @for (p of places(); track p.id) {
        <div class="place" [style.border-left]="'4px solid ' + p.color">
          <!-- Tout l'en-tête ouvre la fiche du lieu : le modifier, le supprimer, son inventaire. -->
          <button class="place-head" (click)="store.openItem('place', p.id)">
            <span class="place-ic" [style.background]="p.color"><f-icon [path]="placeIcon(p)" [size]="18" color="#fff" /></span>
            <span class="place-title">
              <span class="place-name f-display">{{ p.name }}</span>
              <span class="place-sub">
                {{ countThere(p.id) }} sur place@if (countHome(p.id)) { <span class="home-n"> · {{ countHome(p.id) }} à la maison</span> }
              </span>
            </span>
            <f-icon name="chevronRight" [size]="17" color="var(--ink3)" [width]="2.4" />
          </button>

          @if (p.note) { <div class="place-note">{{ p.note }}</div> }

          @for (it of items(p.id); track it.id) {
            <div class="row" [class.home]="it.state === 'ici'">
              <span class="st-dot" [class.there]="it.state === 'la-bas'" [title]="it.state === 'la-bas' ? 'Sur place' : 'À la maison'"></span>
              <button class="row-body" (click)="store.openItem('placeItem', it.id)">
                <span class="s-name">{{ it.name }}</span>
                @if (it.qty) { <span class="s-qty">{{ it.qty }}</span> }
              </button>
              @if (it.by) { <span class="who" [style.background]="store.memberColor(it.by)" [title]="whoTitle(it)"></span> }
              @if (it.state === 'la-bas') {
                <button class="gest" (click)="store.setPlaceItemState(it.id, 'ici')">J'ai ramené</button>
              } @else {
                <button class="gest back" (click)="store.setPlaceItemState(it.id, 'la-bas')">J'ai laissé</button>
              }
            </div>
          } @empty {
            <div class="empty-items">Aucune affaire notée pour ce lieu.</div>
          }

          <div class="add">
            <input class="input" placeholder="Ajouter une affaire…" enterkeyhint="done" autocomplete="off" autocapitalize="sentences"
                   [ngModel]="addFor(p.id)" (ngModelChange)="setAdd(p.id, $event)" (keydown.enter)="submitAdd(p.id)">
            <button class="add-btn" (click)="submitAdd(p.id)" aria-label="Ajouter"><f-icon name="plus" [size]="20" color="#fff" [width]="2.6" /></button>
          </div>
        </div>
      } @empty {
        <div class="empty">
          <f-icon name="map-pin" [size]="30" color="var(--ink3)" [width]="1.8" />
          <p>Aucun lieu pour l'instant. Créez la maison de la montagne, le mobil-home du bord de mer, et notez-y ce qui reste sur place.</p>
          <button class="btn btn-primary" (click)="store.openPlace()">
            <f-icon name="plus" [size]="17" color="#fff" [width]="2.6" /> Nouveau lieu
          </button>
        </div>
      }
    </div>

  `,
  styles: [`
    .head-row { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
    .intro { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin: 2px 0; }
    .new-btn { flex: none; display: inline-flex; align-items: center; gap: 7px; }

    .sync { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 13px; background: var(--soft2); color: var(--ink2); font-size: 12.5px; font-weight: 700; margin-bottom: 14px; }
    .sync.off { background: #FCE9E3; color: #C6492F; }

    .place { background: var(--surface); border-radius: var(--r-card); padding: 14px 16px 12px; box-shadow: 0 12px 28px -20px rgba(90,60,40,.5); margin-bottom: 16px; }
    .place-head { display: flex; align-items: center; gap: 11px; width: 100%; padding: 0; border: none; background: none; font: inherit; text-align: left; cursor: pointer; }
    .place-ic { width: 36px; height: 36px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex: none; }
    .place-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .place-name { font-size: 18px; font-weight: 700; color: var(--ink); }
    .place-sub { font-size: 12px; font-weight: 800; color: var(--ink3); }
    .place-sub .home-n { color: var(--terracotta, #C6492F); }
    .place-note { font-size: 13px; font-weight: 600; color: var(--ink2); margin: 8px 0 2px; padding: 8px 12px; background: var(--soft); border-radius: 11px; }

    .row { display: flex; align-items: center; gap: 11px; min-height: 52px; }
    .row + .row { border-top: 1px solid var(--line); }
    .st-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; background: var(--line2); }
    .st-dot.there { background: var(--sage); }
    .row-body { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; border: none; background: none; padding: 14px 0; text-align: left; cursor: pointer; font: inherit; }
    .s-name { flex: 1; min-width: 0; font-size: 15.5px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .row.home .s-name { color: var(--ink3); }
    .s-qty { font-size: 13px; font-weight: 800; color: var(--ink3); flex: none; }
    .who { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    /* Le geste : une pastille étroite, la couleur dit le sens (ramener vs laisser). */
    .gest { flex: none; border: none; border-radius: 10px; padding: 9px 12px; font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; background: var(--soft2); color: var(--ink2); }
    .gest.back { background: #EDF2EB; color: #5F7E5C; }
    .empty-items { color: var(--ink2); font-weight: 700; font-size: 13.5px; padding: 14px 0; }

    .add { display: flex; gap: 10px; margin-top: 10px; }
    .add .input { flex: 1; min-height: 46px; font-size: 15px; }
    .add-btn { width: 46px; height: 46px; flex: none; border: none; border-radius: 13px; background: var(--primary); display: flex; align-items: center; justify-content: center; cursor: pointer; }

    .empty { text-align: center; color: var(--ink2); padding: 40px 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .empty p { font-size: 14px; font-weight: 600; line-height: 1.5; max-width: 420px; margin: 0; }


    @media (min-width: 861px) {
      :host { display: block; max-width: 760px; }
    }
  `],
})
export class LieuxScreen {
  store = inject(FoyerStore);

  readonly LIST_ICONS = LIST_ICONS;

  places = computed(() => this.store.placesInOrder());

  /** Texte du champ d'ajout par lieu : éphémère, propre au composant. */
  private addText = signal<Record<string, string>>({});
  addFor(id: string): string { return this.addText()[id] || ''; }
  setAdd(id: string, v: string): void { this.addText.set({ ...this.addText(), [id]: v }); }
  submitAdd(id: string): void {
    const t = this.addFor(id).trim(); if (!t) return;
    this.store.addPlaceItem(id, t);
    this.setAdd(id, '');
  }

  /** Les affaires d'un lieu, celles restées sur place d'abord, puis par nom. */
  items(placeId: string): PlaceItem[] {
    return this.store.itemsOfPlace(placeId).slice()
      .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name, 'fr') : a.state === 'la-bas' ? -1 : 1));
  }
  countThere(placeId: string): number { return this.store.itemsOfPlace(placeId).filter((i) => i.state === 'la-bas').length; }
  countHome(placeId: string): number { return this.store.itemsOfPlace(placeId).filter((i) => i.state === 'ici').length; }

  placeIcon(p: Place): string { return this.LIST_ICONS[p.icon] || this.LIST_ICONS['voyage']; }
  whoTitle(it: PlaceItem): string { return it.by ? 'Dernier geste : ' + this.store.memberName(it.by) : ''; }
}
