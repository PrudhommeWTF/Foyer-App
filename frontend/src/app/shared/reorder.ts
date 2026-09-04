import { Directive, ElementRef, HostListener, inject, input, output } from '@angular/core';
import { reorder } from '../core/tasks';

/**
 * Réordonner une liste au doigt, sans dépendance.
 *
 * Le CDK d'Angular ferait la même chose, mais c'est un paquet de plus pour une
 * seule liste : cent lignes de `pointer events` couvrent le besoin et se lisent
 * ici en entier.
 *
 * Deux règles qui décident de tout sur téléphone :
 *
 *   - **On tire par une poignée**, jamais par la ligne. Une ligne qui bouge au
 *     moindre glissement empêche de faire défiler la liste, et cocher devient
 *     un pari. Seule la poignée porte `touch-action: none`.
 *   - **La poignée est un bouton**, et les flèches haut et bas la déplacent
 *     aussi. Sans quoi l'ordre serait hors de portée au clavier, et impossible
 *     à régler pour qui ne peut pas faire un glissement précis.
 *
 * Le conteneur porte `[fReorder]="ids"` ; chaque ligne, `data-rid="<id>"` ;
 * la poignée, `data-grip`. Seules les lignes **filles directes** comptent, ce
 * qui laisse une sous-liste se réordonner pour son compte.
 */
@Directive({ selector: '[fReorder]', standalone: true })
export class ReorderDirective {
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  /** Les identifiants dans l'ordre affiché. */
  readonly ids = input.required<readonly string[]>({ alias: 'fReorder' });
  /** Le nouvel ordre, une fois la ligne lâchée. */
  readonly reordered = output<string[]>();

  private from = -1;
  private to = -1;
  private startY = 0;
  private rows: HTMLElement[] = [];
  private rects: DOMRect[] = [];
  private step = 0;
  private grip: HTMLElement | null = null;

  private lines(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(':scope > [data-rid]'));
  }

  @HostListener('pointerdown', ['$event'])
  onDown(e: PointerEvent): void {
    // Le clic droit et le multi-touch ne réordonnent pas : ils font autre chose.
    if (e.button !== 0 || !e.isPrimary) return;
    const target = e.target as HTMLElement;
    const grip = target.closest<HTMLElement>('[data-grip]');
    if (!grip || !this.host.nativeElement.contains(grip)) return;
    const rows = this.lines();
    const row = target.closest<HTMLElement>('[data-rid]');
    const from = row ? rows.indexOf(row) : -1;
    if (from < 0 || rows.length < 2) return;

    e.preventDefault();
    this.rows = rows;
    this.rects = rows.map((r) => r.getBoundingClientRect());
    // L'écart entre deux lignes fait partie du pas : sans lui, la ligne tirée
    // recouvre sa voisine au lieu de prendre sa place.
    this.step = this.rects[from].height + (this.rects.length > 1 ? Math.max(0, this.rects[1].top - this.rects[0].bottom) : 0);
    this.from = from;
    this.to = from;
    this.startY = e.clientY;
    this.grip = grip;
    grip.setPointerCapture(e.pointerId);
    rows[from].style.position = 'relative';
    rows[from].style.zIndex = '2';
    rows[from].style.opacity = '.9';
  }

  @HostListener('pointermove', ['$event'])
  onMove(e: PointerEvent): void {
    if (this.from < 0) return;
    const dy = e.clientY - this.startY;
    const centre = this.rects[this.from].top + this.rects[this.from].height / 2 + dy;
    const mid = (i: number): number => this.rects[i].top + this.rects[i].height / 2;
    let to = this.from;
    while (to < this.rows.length - 1 && centre > mid(to + 1)) to++;
    while (to > 0 && centre < mid(to - 1)) to--;
    this.to = to;

    for (let i = 0; i < this.rows.length; i++) {
      if (i === this.from) { this.rows[i].style.transform = `translateY(${dy}px)`; continue; }
      const shift = to > this.from && i > this.from && i <= to ? -this.step
        : to < this.from && i >= to && i < this.from ? this.step : 0;
      this.rows[i].style.transform = shift ? `translateY(${shift}px)` : '';
    }
  }

  @HostListener('pointerup', ['$event'])
  @HostListener('pointercancel', ['$event'])
  onUp(e: PointerEvent): void {
    if (this.from < 0) return;
    const { from, to } = this;
    this.grip?.releasePointerCapture(e.pointerId);
    for (const r of this.rows) { r.style.transform = ''; r.style.position = ''; r.style.zIndex = ''; r.style.opacity = ''; }
    this.from = -1;
    this.rows = [];
    this.grip = null;
    if (from !== to) this.reordered.emit(reorder(this.ids(), from, to));
  }

  /** Les flèches déplacent la ligne d'un cran : l'ordre reste réglable au clavier. */
  @HostListener('keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const target = e.target as HTMLElement;
    if (!target.closest('[data-grip]')) return;
    const rows = this.lines();
    const row = target.closest<HTMLElement>('[data-rid]');
    const from = row ? rows.indexOf(row) : -1;
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= rows.length) return;
    e.preventDefault();
    this.reordered.emit(reorder(this.ids(), from, to));
    // Le focus suit la ligne : appuyer trois fois la descend de trois crans.
    setTimeout(() => this.lines()[to]?.querySelector<HTMLElement>('[data-grip]')?.focus(), 0);
  }
}
