import { Directive, ElementRef, HostListener, inject, input, output } from '@angular/core';
import { reorder } from '../core/tasks';

/** Marge (px) sous le bord où le glisser déclenche le défilement, et vitesse max par trame. */
const EDGE = 56;
const MAX_SPEED = 16;

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
  /**
   * Faire défiler le conteneur quand on tire près d'un bord. Pour une longue
   * liste dans une zone défilante (la modale « Ordre des rayons » sur iPhone) ;
   * inutile pour les sous-tâches, d'où le défaut désactivé.
   */
  readonly autoscroll = input(false);

  private from = -1;
  private to = -1;
  private startY = 0;
  private rows: HTMLElement[] = [];
  private rects: DOMRect[] = [];
  private step = 0;
  private grip: HTMLElement | null = null;
  // Défilement automatique : le conteneur défilant, son décalage au début du
  // glisser (pour corriger la géométrie), la dernière ordonnée du doigt et la
  // trame en cours.
  private scroller: HTMLElement | null = null;
  private startScroll = 0;
  private lastY = 0;
  private raf = 0;

  private lines(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(':scope > [data-rid]'));
  }

  /** Le premier ancêtre réellement défilant (la carte de la modale, en pratique). */
  private findScroller(): HTMLElement | null {
    let el: HTMLElement | null = this.host.nativeElement.parentElement;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
      el = el.parentElement;
    }
    return null;
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
    this.lastY = e.clientY;
    this.grip = grip;
    this.scroller = this.autoscroll() ? this.findScroller() : null;
    this.startScroll = this.scroller ? this.scroller.scrollTop : 0;
    grip.setPointerCapture(e.pointerId);
    rows[from].style.position = 'relative';
    rows[from].style.zIndex = '2';
    rows[from].style.opacity = '.9';
  }

  @HostListener('pointermove', ['$event'])
  onMove(e: PointerEvent): void {
    if (this.from < 0) return;
    this.lastY = e.clientY;
    this.layout();
    // Près d'un bord de la zone défilante, on enclenche un défilement continu.
    if (this.scroller) { if (this.edgeSpeed()) this.startAuto(); else this.stopAuto(); }
  }

  /**
   * Replace la ligne tirée sous le doigt et décale les autres pour ouvrir la
   * place. Les rects sont figés au début du glisser ; quand le conteneur défile,
   * on corrige par le décalage de défilement (startScroll) pour que la cible et
   * la ligne tirée restent justes.
   */
  private layout(): void {
    const scrollDelta = this.scroller ? this.scroller.scrollTop - this.startScroll : 0;
    const dy = this.lastY - this.startY;

    // La place visée se lit sous le doigt, pas au centre de la ligne tirée. On
    // compte les autres lignes dont le milieu (corrigé du défilement) est déjà
    // passé : c'est l'indice d'arrivée, la ligne tirée retirée du rang.
    let to = 0;
    for (let i = 0; i < this.rects.length; i++) {
      if (i === this.from) continue;
      if (this.lastY > this.rects[i].top - scrollDelta + this.rects[i].height / 2) to++;
      else break;
    }
    this.to = to;

    for (let i = 0; i < this.rows.length; i++) {
      // La ligne tirée suit le doigt ; comme le contenu a défilé de scrollDelta,
      // on l'ajoute pour qu'elle reste collée au doigt plutôt qu'au contenu.
      if (i === this.from) { this.rows[i].style.transform = `translateY(${dy + scrollDelta}px)`; continue; }
      const shift = to > this.from && i > this.from && i <= to ? -this.step
        : to < this.from && i >= to && i < this.from ? this.step : 0;
      this.rows[i].style.transform = shift ? `translateY(${shift}px)` : '';
    }
  }

  /** La vitesse de défilement voulue (px/trame) selon la proximité d'un bord, bornée. 0 = pas de défilement. */
  private edgeSpeed(): number {
    const s = this.scroller;
    if (!s) return 0;
    const r = s.getBoundingClientRect();
    const max = s.scrollHeight - s.clientHeight;
    if (this.lastY < r.top + EDGE && s.scrollTop > 0) {
      return -Math.ceil(((r.top + EDGE - this.lastY) / EDGE) * MAX_SPEED);
    }
    if (this.lastY > r.bottom - EDGE && s.scrollTop < max) {
      return Math.ceil(((this.lastY - (r.bottom - EDGE)) / EDGE) * MAX_SPEED);
    }
    return 0;
  }

  private startAuto(): void {
    if (this.raf) return;
    const tick = (): void => {
      const v = this.edgeSpeed();
      if (this.from < 0 || !this.scroller || !v) { this.raf = 0; return; }
      this.scroller.scrollTop += v;
      this.layout();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopAuto(): void {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  @HostListener('pointerup', ['$event'])
  @HostListener('pointercancel', ['$event'])
  onUp(e: PointerEvent): void {
    if (this.from < 0) return;
    const { from, to } = this;
    this.stopAuto();
    this.grip?.releasePointerCapture(e.pointerId);
    for (const r of this.rows) { r.style.transform = ''; r.style.position = ''; r.style.zIndex = ''; r.style.opacity = ''; }
    this.from = -1;
    this.rows = [];
    this.grip = null;
    this.scroller = null;
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
