import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { FoyerStore } from '../../core/foyer.store';
import { EquipementsStore } from '../../core/equipements.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { tint } from '../../core/constants';
import { EqpItem, WARRANTY_FILTERS, categoryOf, statusLabel } from '../../core/equipements.api';
import { STARTER_ROOM_NAMES, WARRANTY_TONE, filterItems, groupByRoom } from '../../core/equipements';
import { WarrantyState } from '../../core/warranty';

/**
 * L'écran Équipements : une carte par appareil, groupées par pièce, avec la
 * pastille de garantie à la date du jour. En tête, la recherche (marque,
 * modèle, numéro de série, désignation) et deux filtres (pièce, garantie).
 * Le jour d'une panne : chercher, ouvrir la fiche, copier le numéro.
 */
@Component({
  selector: 'screen-equipements',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, NgTemplateOutlet, IconComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <div class="head-row">
        <div class="search">
          <f-icon name="search" [size]="18" color="var(--ink3)" [width]="2.2" />
          <input [ngModel]="q()" (ngModelChange)="q.set($event)" placeholder="Marque, modèle, numéro de série…" />
          @if (q()) { <button class="clear" (click)="q.set('')" aria-label="Effacer"><f-icon name="x" [size]="15" color="var(--ink3)" /></button> }
        </div>
        @if (eqp.canEdit()) {
          <button class="btn btn-primary" (click)="store.openItem('equipment', null)"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> <span class="lbl">Ajouter un équipement</span></button>
        }
      </div>

      <div class="filters">
        <select class="input sel" [ngModel]="room()" (ngModelChange)="room.set($event)" aria-label="Pièce">
          <option value="">Toutes les pièces</option>
          @for (r of store.rooms(); track r.id) { <option [value]="r.id">{{ r.name }}</option> }
          <option value="none">Sans pièce</option>
        </select>
        <select class="input sel" [ngModel]="garantie()" (ngModelChange)="garantie.set($event)" aria-label="Garantie">
          <option value="">Toutes les garanties</option>
          @for (w of warrantyFilters; track w.id) { <option [value]="w.id">{{ w.label }}</option> }
        </select>
        <span class="count">{{ filtered().length }} fiche{{ filtered().length > 1 ? 's' : '' }}</span>
        <div class="menu-wrap">
          <button class="icon-btn" (click)="menu.set(!menu())" aria-label="Plus d’options" [attr.aria-expanded]="menu()">⋯</button>
          @if (menu()) {
            <div class="menu-back" (click)="menu.set(false)"></div>
            <div class="menu" role="menu">
              @if (eqp.canEdit()) {
                <button class="menu-item" (click)="menu.set(false); roomsOpen.set(true)"><f-icon name="home" [size]="16" color="var(--ink2)" [width]="2.2" /> Gérer les pièces</button>
              }
              @if (eqp.canEdit()) {
                <div class="menu-sep"></div>
                <div class="menu-lbl">Pour l’assurance</div>
                <button class="menu-item" (click)="menu.set(false); eqp.exportInsurance('pdf')"><f-icon name="documents" [size]="16" color="var(--ink2)" [width]="2.2" /> Liste en PDF</button>
                <button class="menu-item" (click)="menu.set(false); eqp.exportInsurance('csv')"><f-icon name="export" [size]="16" color="var(--ink2)" [width]="2.2" /> Liste en tableur (CSV)</button>
                <button class="menu-item" (click)="menu.set(false); eqp.exportInsurance('zip')"><f-icon name="download" [size]="16" color="var(--ink2)" [width]="2.2" /> Liste et factures (zip)</button>
                <div class="menu-sep"></div>
              }
              <button class="menu-item" (click)="menu.set(false); eqp.toggleArchived()"><f-icon name="folder" [size]="16" color="var(--ink2)" [width]="2.2" /> {{ eqp.showArchived() ? 'Masquer les fiches archivées' : 'Voir les fiches archivées' }}</button>
            </div>
          }
        </div>
      </div>

      @if (eqp.indispo()) { <div class="card note">Les équipements ne répondent pas pour l’instant. Réessayez dans un moment.</div> }

      @if (!store.rooms().length && eqp.canEdit()) {
        <div class="card note">
          <b>Aucune pièce pour l’instant.</b> Les appareils se rangent par pièce, la même liste que pour l’Entretien.
          <div class="note-act">
            <button class="btn btn-soft" (click)="starterRooms()">Créer les pièces proposées</button>
            <button class="btn btn-ghost" (click)="roomsOpen.set(true)">Les choisir moi-même</button>
          </div>
          <div class="small">{{ starterNames }}</div>
        </div>
      }

      @if (!eqp.items().length && eqp.boot()) {
        <div class="card empty">
          <div class="e-t">Une fiche par appareil de la maison</div>
          <p>La facture, la photo de la plaque signalétique, le numéro de série et la garantie, calculée au jour près.
            Le jour d’une panne, tout ce qu’il faut au SAV est ici.</p>
          @if (eqp.canEdit()) { <button class="btn btn-primary" (click)="store.openItem('equipment', null)">Ajouter le premier</button> }
        </div>
      } @else {
        @for (g of groups(); track g.id) {
          <div class="group">
            <div class="g-head"><span>{{ g.name }}</span><span class="g-n">{{ g.items.length }}</span></div>
            <div class="grid">
              @for (it of g.items; track it.id) { <ng-container *ngTemplateOutlet="cardTpl; context: { $implicit: it }" /> }
            </div>
          </div>
        } @empty {
          @if (eqp.items().length) { <div class="card empty">Aucune fiche ne correspond.</div> }
        }
      }

      @if (eqp.showArchived()) {
        <div class="group">
          <div class="g-head"><span>Fiches archivées</span><span class="g-n">{{ archivedList().length }}</span></div>
          <div class="grid">
            @for (it of archivedList(); track it.id) { <ng-container *ngTemplateOutlet="cardTpl; context: { $implicit: it }" /> }
            @empty { <div class="small">Aucune fiche archivée.</div> }
          </div>
        </div>
      }
    </div>

    <ng-template #cardTpl let-it>
      <button class="card eq" [class.off]="it.archivedAt || it.status === 'remplace' || it.status === 'jete' || it.status === 'donne_vendu'" (click)="open(it)">
        <span class="ic" [style.background]="tintOf(cat(it).color)"><f-icon [name]="cat(it).icon" [size]="19" [color]="cat(it).color" [width]="2.2" /></span>
        <span class="body">
          <span class="name">{{ it.name }}</span>
          @if (it.brand || it.model) { <span class="bm">{{ [it.brand, it.model].filter(ok).join(' · ') }}</span> }
          <span class="tags">
            <span class="pill" [style.background]="tone(it.warranty.state).bg" [style.color]="tone(it.warranty.state).fg">{{ it.warranty.label }}</span>
            @if (it.status !== 'en_service') { <span class="st" [class.bad]="it.status === 'en_panne'">{{ statusLabel(it.status) }}</span> }
          </span>
        </span>
        <f-icon name="chevronRight" [size]="17" color="var(--ink3)" [width]="2.4" />
      </button>
    </ng-template>

    @if (roomsOpen()) {
      <f-modal title="Pièces de la maison" [maxWidth]="460" (close)="roomsOpen.set(false)">
        <p class="hint">Une seule liste pour tout le foyer : Entretien s’en sert aussi. Supprimer une pièce ne supprime aucun appareil, ils passent « Sans pièce ».</p>
        <div class="rooms">
          @for (r of store.rooms(); track r.id; let first = $first, last = $last) {
            <div class="room">
              <input class="input" [ngModel]="r.name" (change)="rename(r.id, $any($event.target).value)" maxlength="60" [attr.aria-label]="'Nom de la pièce ' + r.name" />
              <button class="icon-btn sm" [disabled]="first" (click)="store.moveRoom(r.id, -1)" aria-label="Monter"><f-icon name="arrowUp" [size]="16" /></button>
              <button class="icon-btn sm" [disabled]="last" (click)="store.moveRoom(r.id, 1)" aria-label="Descendre"><f-icon name="arrowDown" [size]="16" /></button>
              <button class="icon-btn sm" (click)="store.removeRoom(r.id)" aria-label="Supprimer"><f-icon name="trash" [size]="16" color="#C6492F" /></button>
            </div>
          }
        </div>
        <div class="room add">
          <input class="input" [ngModel]="newRoom()" (ngModelChange)="newRoom.set($event)" (keydown.enter)="addRoom()" placeholder="Nouvelle pièce" maxlength="60" />
          <button class="btn btn-soft" [disabled]="!newRoom().trim()" (click)="addRoom()">Ajouter</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .head-row { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .search { flex: 1; display: flex; align-items: center; gap: 10px; background: var(--surface); border-radius: 14px; padding: 12px 16px; box-shadow: 0 6px 16px -14px rgba(90,60,40,.6); }
    .search input { flex: 1; min-width: 0; border: none; background: transparent; font-size: 15px; font-weight: 600; color: var(--ink); outline: none; }
    .clear { border: none; background: none; padding: 0; cursor: pointer; display: flex; }
    .head-row .btn { flex: none; }
    @media (max-width: 860px) { .head-row .lbl { display: none; } }
    .filters { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
    .sel { appearance: auto; width: auto; flex: 0 1 220px; min-width: 0; }
    :host-context(.shell.narrow) .sel { flex: 1 1 140px; padding-top: 10px; padding-bottom: 10px; }
    .count { font-size: 13px; font-weight: 800; color: var(--ink3); margin-left: auto; }
    .menu-wrap { position: relative; }
    .icon-btn { font-size: 20px; font-weight: 800; color: var(--ink2); }
    .menu-back { position: fixed; inset: 0; z-index: 40; }
    .menu { position: absolute; right: 0; top: calc(100% + 8px); z-index: 41; min-width: 250px; background: var(--surface); border-radius: 14px; padding: 6px; box-shadow: 0 18px 44px -16px rgba(90,60,40,.55); border: 1px solid var(--line); display: flex; flex-direction: column; }
    .menu-item { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: none; cursor: pointer; font: inherit; font-size: 14px; font-weight: 700; color: var(--ink); text-align: left; padding: 11px 12px; border-radius: 10px; }
    .menu-item:hover { background: var(--soft); }
    .menu-sep { height: 1px; background: var(--line); margin: 5px 6px; }
    .menu-lbl { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; padding: 6px 12px 2px; }
    .card.note { padding: 16px 18px; border-radius: 16px; font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin-bottom: 18px; }
    .note-act { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .small { font-size: 12px; font-weight: 600; color: var(--ink3); margin-top: 8px; }
    .card.empty { padding: 36px 24px; text-align: center; color: var(--ink2); font-weight: 600; font-size: 14px; line-height: 1.55; }
    .e-t { font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--ink); margin-bottom: 6px; }
    .card.empty p { max-width: 460px; margin: 0 auto 16px; }
    .group { margin-bottom: 22px; }
    .g-head { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 10px; }
    .g-n { font-size: 11.5px; background: var(--soft2); color: var(--ink3); border-radius: 10px; padding: 2px 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    :host-context(.shell.narrow) .grid { grid-template-columns: 1fr; }
    .card.eq { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px; border: none; width: 100%; font: inherit; text-align: left; cursor: pointer; }
    .card.eq.off { opacity: .6; }
    .ic { width: 42px; height: 42px; flex: none; border-radius: 13px; display: flex; align-items: center; justify-content: center; }
    .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .name { font-size: 15px; font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bm { font-size: 12.5px; font-weight: 700; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 3px; }
    .pill, .st { font-size: 11.5px; font-weight: 800; padding: 3px 9px; border-radius: 12px; white-space: nowrap; }
    .st { background: var(--soft2); color: var(--ink2); }
    .st.bad { background: #FCE9E3; color: #C6492F; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); line-height: 1.5; margin: 0 0 14px; }
    .rooms { display: flex; flex-direction: column; gap: 8px; }
    .room { display: flex; align-items: center; gap: 6px; }
    .room .input { flex: 1; min-width: 0; }
    .room.add { margin-top: 14px; }
    .icon-btn.sm[disabled] { opacity: .3; }
  `],
})
export class EquipementsScreen {
  readonly store = inject(FoyerStore);
  readonly eqp = inject(EquipementsStore);
  readonly warrantyFilters = WARRANTY_FILTERS;
  readonly statusLabel = statusLabel;
  readonly tintOf = tint;
  readonly ok = Boolean;
  readonly cat = (it: EqpItem) => categoryOf(it.category);
  readonly tone = (s: WarrantyState) => WARRANTY_TONE[s];
  readonly starterNames = STARTER_ROOM_NAMES.join(', ');

  readonly q = signal('');
  readonly room = signal('');
  readonly garantie = signal<WarrantyState | ''>('');
  readonly menu = signal(false);
  readonly roomsOpen = signal(false);
  readonly newRoom = signal('');

  readonly filtered = computed(() => filterItems(this.eqp.items(), { q: this.q(), room: this.room(), garantie: this.garantie() }, this.store.rooms()));
  readonly groups = computed(() => groupByRoom(this.filtered(), this.store.rooms()));
  readonly archivedList = computed(() => filterItems(this.eqp.archived() ?? [], { q: this.q(), room: this.room(), garantie: this.garantie() }, this.store.rooms()));

  constructor() { void this.eqp.reload(); }

  open(it: EqpItem): void { this.store.openItem('equipment', String(it.id)); }
  starterRooms(): void { this.store.addRooms(STARTER_ROOM_NAMES); this.store.toast('Pièces créées : renommez-les ou supprimez-les depuis le menu ⋯'); }
  rename(id: string, name: string): void { const n = name.trim(); if (n) this.store.renameRoom(id, n); }
  addRoom(): void { if (this.store.ensureRoom(this.newRoom())) this.newRoom.set(''); }
}
