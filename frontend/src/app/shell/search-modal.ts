import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore, SearchHit } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { tint } from '../core/constants';

const KIND_LABEL: Record<string, string> = {
  contact: 'Contact', task: 'Tâche', event: 'Agenda', shop: 'Course',
  recipe: 'Recette', file: 'Document', tx: 'Budget', member: 'Membre', message: 'Message',
};

/**
 * Global search palette: fuzzy-ish (accent/case-insensitive) matching across
 * contacts, tasks, events, courses, recipes, documents, budget, members and
 * messages. Selecting a result navigates to its screen and opens its detail.
 */
@Component({
  selector: 'app-search-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="backdrop" (click)="store.closeSearch()"></div>
    <div class="palette">
      <div class="sbar">
        <f-icon name="search" [size]="20" color="var(--ink3)" [width]="2.2" />
        <input #box class="sinput" [ngModel]="store.ui().searchQuery"
               (ngModelChange)="store.patch({ searchQuery: $event })"
               (keydown.enter)="openFirst()" (keydown.escape)="store.closeSearch()"
               placeholder="Rechercher un contact, une tâche, un événement…" />
        <button class="icon-btn sm" (click)="store.closeSearch()"><f-icon name="x" [size]="18" /></button>
      </div>

      @let results = store.searchResults();
      @if (store.ui().searchQuery.trim()) {
        @if (results.length) {
          <div class="list fscroll">
            @for (h of results; track $index) {
              <button class="item" (click)="store.openHit(h)">
                <span class="ic" [style.background]="tintOf(h.color)"><f-icon [name]="h.icon" [size]="17" [color]="h.color" /></span>
                <span class="body">
                  <span class="t">{{ h.title }}</span>
                  <span class="s">{{ h.sub }}</span>
                </span>
                <span class="badge">{{ label(h) }}</span>
              </button>
            }
          </div>
        } @else {
          <div class="empty">Aucun résultat pour « {{ store.ui().searchQuery }} »</div>
        }
      } @else {
        <div class="empty">Tapez pour rechercher dans tout votre foyer.</div>
      }
    </div>
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; z-index: 80; background: rgba(30,24,20,.4); }
    .palette { position: fixed; z-index: 81; top: 84px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); background: var(--surface); border-radius: 20px; box-shadow: 0 30px 80px -30px rgba(0,0,0,.55); overflow: hidden; animation: fpop .18s ease; }
    @keyframes fpop { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
    .sbar { display: flex; align-items: center; gap: 11px; padding: 15px 16px; border-bottom: 1px solid var(--line); }
    .sinput { flex: 1; border: none; outline: none; background: transparent; font-size: 16px; font-weight: 700; color: var(--ink); font-family: inherit; }
    .sinput::placeholder { color: var(--ink3); font-weight: 600; }
    .list { display: flex; flex-direction: column; gap: 4px; padding: 10px; max-height: min(60vh, 460px); overflow-y: auto; }
    .item { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 13px; border: none; background: transparent; cursor: pointer; text-align: left; }
    .item:hover { background: var(--soft); }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .body { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .t { font-size: 14px; font-weight: 800; color: var(--ink); line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .s { font-size: 12px; font-weight: 700; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { flex: none; font-size: 10.5px; font-weight: 800; color: var(--ink3); background: var(--soft2); padding: 3px 9px; border-radius: 20px; }
    .empty { padding: 30px 20px; text-align: center; font-size: 13.5px; font-weight: 700; color: var(--ink3); }
  `],
})
export class SearchModalComponent implements AfterViewInit {
  store = inject(FoyerStore);
  tintOf = tint;
  @ViewChild('box') box?: ElementRef<HTMLInputElement>;

  ngAfterViewInit(): void { setTimeout(() => this.box?.nativeElement.focus(), 0); }

  label(h: SearchHit): string { return KIND_LABEL[h.kind] || ''; }
  openFirst(): void { const r = this.store.searchResults(); if (r.length) this.store.openHit(r[0]); }
}
