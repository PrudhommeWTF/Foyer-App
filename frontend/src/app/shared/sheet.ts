import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, output, signal, viewChild } from '@angular/core';
import { IconComponent } from '../core/icon';

let seq = 0;

/**
 * Le cadre d'une fiche : un panneau qui monte du bas sur téléphone (plein écran
 * en édition), une modale centrée sur grand écran. L'en-tête annonce le titre,
 * le corps défile, le pied reste collé en bas, à portée du pouce, quelle que
 * soit la longueur du contenu, y compris en paysage.
 *
 * Il ne décide de rien : il signale `close` (croix, clic à côté) et `back`
 * (poignée glissée vers le bas), la fiche choisit quoi en faire.
 */
@Component({
  selector: 'f-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="sheet-overlay" (click)="close.emit()">
      <div class="sheet-card" [class.full]="full()" [class.dragging]="drag() > 0" [style.max-width.px]="maxWidth()"
           [style.transform]="drag() ? 'translateY(' + drag() + 'px)' : null"
           role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" (click)="$event.stopPropagation()">
        <div class="grab" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up()" (pointercancel)="cancel()"
             aria-hidden="true"><span></span></div>
        <div class="head">
          <div class="tw">
            @if (kicker()) { <div class="kicker">{{ kicker() }}</div> }
            <h2 class="sheet-title" #title [id]="titleId" tabindex="-1">{{ heading() }}</h2>
          </div>
          <button type="button" class="icon-btn sm" (click)="close.emit()" aria-label="Fermer"><f-icon name="x" [size]="18" /></button>
        </div>
        <div class="body fscroll"><ng-content /></div>
        <div class="foot"><ng-content select="[sheetFoot]" /></div>
      </div>
    </div>
  `,
  styles: [`
    .sheet-overlay { position: fixed; inset: 0; z-index: 70; background: rgba(30, 24, 20, .5);
      display: flex; align-items: center; justify-content: center; padding: 20px; animation: ffade .2s ease; }
    .sheet-card { background: var(--surface); border-radius: var(--r-modal); width: 100%; max-height: 90vh;
      box-shadow: var(--sh-modal); display: flex; flex-direction: column; overflow: hidden; animation: fpop .25s ease; }
    .grab { display: none; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 22px 24px 12px; flex: none; }
    .tw { min-width: 0; }
    .kicker { font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); margin-bottom: 3px; }
    .sheet-title { margin: 0; font-family: var(--font-display); font-size: 21px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; outline: none; }
    .body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 24px 12px; overscroll-behavior: contain; }
    .foot { flex: none; padding: 12px 24px 20px; border-top: 1px solid var(--line); }
    .foot:empty { display: none; }

    /* Téléphone : un panneau qui monte du bas, poignée en tête. */
    @media (max-width: 860px) {
      .sheet-overlay { align-items: flex-end; padding: 0; }
      .sheet-card { max-width: none !important; max-height: 92dvh; border-radius: 22px 22px 0 0; animation: fup .26s cubic-bezier(.2,.8,.2,1); }
      .sheet-card.dragging { transition: none; }
      .sheet-card:not(.dragging) { transition: transform .18s ease; }
      .sheet-card.full { height: 100dvh; max-height: 100dvh; border-radius: 0; }
      .sheet-card.full .grab { padding-top: max(10px, env(safe-area-inset-top)); }
      .grab { display: flex; justify-content: center; padding: 10px 0 2px; touch-action: none; cursor: grab; flex: none; }
      .grab span { width: 40px; height: 5px; border-radius: 999px; background: var(--line2, var(--line)); }
      .head { padding: 8px 18px 10px; }
      .body { padding: 2px 18px 12px; }
      .foot { padding: 12px 18px max(14px, env(safe-area-inset-bottom)); }
    }
    /* Téléphone en paysage : toute la hauteur, les boutons restent visibles. */
    @media (max-width: 960px) and (max-height: 500px) {
      .sheet-overlay { align-items: flex-end; padding: 0; }
      .sheet-card { max-width: none !important; max-height: 100dvh; height: 100dvh; border-radius: 0; }
      .head { padding-top: 12px; }
    }
    @keyframes fup { 0% { transform: translateY(100%); } 100% { transform: translateY(0); } }
  `],
})
export class SheetComponent {
  /** Le titre de la fiche (le nom de l'élément, ou « Modifier l'événement »). */
  readonly heading = input('');
  /** Le type, en petit au-dessus du titre (« Événement »). */
  readonly kicker = input('');
  /** Plein écran sur téléphone : en édition, le clavier a besoin de place. */
  readonly full = input(false);
  readonly maxWidth = input(520);
  readonly close = output<void>();
  readonly back = output<void>();

  readonly titleId = 'sheet-title-' + ++seq;
  private readonly title = viewChild<ElementRef<HTMLElement>>('title');
  /** Le titre prend le focus à l'ouverture : un lecteur d'écran l'annonce, le clavier part de la fiche. */
  constructor() { afterNextRender(() => this.focusTitle()); }
  focusTitle(): void { this.title()?.nativeElement.focus({ preventScroll: true }); }

  // ---- glisser la poignée vers le bas -------------------------------------
  // Le geste retour d'une PWA installée sur iPhone, qui n'en a pas d'autre.
  readonly drag = signal(0);
  private y0: number | null = null;
  down(e: PointerEvent): void { this.y0 = e.clientY; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }
  move(e: PointerEvent): void { if (this.y0 !== null) this.drag.set(Math.max(0, e.clientY - this.y0)); }
  up(): void {
    const far = this.drag() > 90;
    this.cancel();
    if (far) this.back.emit();
  }
  cancel(): void { this.y0 = null; this.drag.set(0); }
}
