import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';
import { IconComponent } from '../core/icon';

/** Un onglet : son libellé, son compteur, et deux nuances (privé, archivé). */
export interface TabItem { id: string; label: string; count?: number; lock?: boolean; muted?: boolean; }

/**
 * Onglets soulignés : du texte, un compteur gris, un trait sous l'actif. Plus
 * de pastilles pleines de couleur. Trop d'onglets pour la largeur : la rangée
 * défile, avec un fondu à droite qui dit qu'il y en a d'autres.
 *
 * Au clavier, un seul arrêt de tabulation (l'onglet actif) et les flèches pour
 * passer d'un onglet à l'autre. Deux emplacements projetés : `[tabsEnd]` juste
 * après la rangée (le « + »), `[tabsAside]` calé à droite (un lien discret).
 */
@Component({
  selector: 'f-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="bar">
      <div class="in" #row role="tablist" [attr.aria-label]="label()" (keydown)="key($event)">
        @for (t of tabs(); track t.id) {
          <button type="button" role="tab" class="tab" [class.on]="t.id === active()" [class.muted]="t.muted"
                  [attr.aria-selected]="t.id === active()" [tabindex]="t.id === active() ? 0 : -1" [attr.data-tab]="t.id"
                  (click)="select.emit(t.id)">
            {{ t.label }}
            @if (t.lock) { <f-icon name="lock" [size]="11" color="var(--ink3)" [width]="2.4" /> }
            @if (t.count !== undefined) { <small>{{ t.count }}</small> }
          </button>
        }
      </div>
      <ng-content select="[tabsEnd]" />
      <ng-content select="[tabsAside]" />
    </div>
  `,
  styles: [`
    :host { display: block; }
    .bar { display: flex; align-items: center; gap: 14px; border-bottom: 1px solid var(--line2); }
    .in { display: flex; gap: 22px; overflow-x: auto; scrollbar-width: none; flex: 0 1 auto; min-width: 0;
          mask-image: linear-gradient(90deg, #000 calc(100% - 28px), transparent); padding-right: 24px; }
    .in::-webkit-scrollbar { display: none; }
    .tab { position: relative; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; flex: none;
           border: none; background: none; padding: 10px 0 11px; font: inherit; font-size: 14px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .tab small { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .tab:hover { color: var(--ink); }
    .tab.muted { color: var(--ink3); }
    .tab.on { color: var(--ink); }
    .tab.on::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; border-radius: 2px; background: var(--ink); }
    .tab:focus-visible { outline: 2px solid var(--ink3); outline-offset: 2px; border-radius: 4px; }
    @media (max-width: 860px) { .in { gap: 18px; } }
  `],
})
export class TabsComponent {
  readonly tabs = input.required<TabItem[]>();
  readonly active = input('');
  /** Le nom de la rangée, pour le lecteur d'écran. */
  readonly label = input('');
  readonly select = output<string>();

  private readonly row = viewChild.required<ElementRef<HTMLElement>>('row');

  constructor() {
    // L'onglet actif est dans le champ dès l'ouverture, même s'il est loin à droite.
    afterNextRender(() => this.row().nativeElement.querySelector<HTMLElement>('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  /** Flèches gauche/droite, Début, Fin : on passe d'onglet en onglet, et l'onglet atteint s'ouvre. */
  key(e: KeyboardEvent): void {
    const list = this.tabs();
    const i = list.findIndex((t) => t.id === this.active());
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
    if (to === null || !list.length) return;
    e.preventDefault();
    const t = list[(to + list.length) % list.length];
    this.select.emit(t.id);
    queueMicrotask(() => this.row().nativeElement.querySelector<HTMLElement>(`[data-tab="${CSS.escape(t.id)}"]`)?.focus());
  }
}
