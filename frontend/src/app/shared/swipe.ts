import { Directive, DestroyRef, ElementRef, NgZone, inject, output } from '@angular/core';

/**
 * Glisser une ligne au doigt pour agir, sur téléphone.
 *
 * Vers la **droite**, l'action positive (terminer) ; vers la **gauche**,
 * l'action destructive (supprimer). Seul le doigt déclenche : à la souris, rien
 * ne bouge, le bureau garde son clic et le glisser de la poignée de rangement.
 *
 * Trois règles décident du geste :
 *
 *   - Il ne part **jamais d'une commande** (coche, lien, poignée) : chacune a le
 *     sien. On lit l'axe au premier mouvement ; vertical, on rend la main au
 *     défilement, horizontal, on prend la ligne.
 *   - `touch-action: pan-y` sur l'élément laisse le défilement vertical au
 *     navigateur et l'horizontal à nous, et `preventDefault` sur le mouvement
 *     horizontal évite le clic qui suivrait sans lui.
 *   - Passé un **seuil**, l'action part au relâchement ; sinon la ligne revient.
 *
 * L'élément glisse (`transform`) ; son parent porte `data-swipe="left|right"` et
 * la classe `swipe-commit`, de quoi révéler un fond coloré et son icône. Les
 * écouteurs vivent hors de la zone Angular : un glissement ne déclenche pas de
 * détection de changements, seule l'action au bout en déclenche une.
 */
@Directive({ selector: '[fSwipe]', standalone: true })
export class SwipeDirective {
  private readonly el: HTMLElement = inject(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  /** Glissé à droite : terminer. */
  readonly swipeRight = output<void>();
  /** Glissé à gauche : supprimer. */
  readonly swipeLeft = output<void>();

  private active = false;
  private x0 = 0; private y0 = 0; private dx = 0;
  private axis: '' | 'h' | 'v' = '';
  private width = 0;

  constructor() {
    const el = this.el;
    const start = (e: TouchEvent) => this.onStart(e);
    const move = (e: TouchEvent) => this.onMove(e);
    const end = () => this.onEnd();
    this.zone.runOutsideAngular(() => {
      el.addEventListener('touchstart', start, { passive: true });
      el.addEventListener('touchmove', move, { passive: false });
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
    });
    inject(DestroyRef).onDestroy(() => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    });
  }

  private wrap(): HTMLElement | null { return this.el.parentElement; }
  /** Le point de bascule : un bon tiers de la ligne, sans jamais descendre trop bas. */
  private threshold(): number { return Math.max(84, this.width * 0.35); }

  private onStart(e: TouchEvent): void {
    if (e.touches.length !== 1) { this.active = false; return; }
    // Une commande de la ligne (coche, lien, poignée) garde son propre geste.
    if ((e.target as HTMLElement).closest('button, a, [data-grip]')) return;
    const t = e.touches[0];
    this.active = true; this.axis = ''; this.dx = 0;
    this.x0 = t.clientX; this.y0 = t.clientY;
    this.width = this.el.getBoundingClientRect().width;
    this.el.style.transition = 'none';
  }

  private onMove(e: TouchEvent): void {
    if (!this.active) return;
    const t = e.touches[0];
    const dx = t.clientX - this.x0, dy = t.clientY - this.y0;
    if (this.axis === '') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // pas encore tranché
      this.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      if (this.axis === 'v') { this.active = false; return; } // au défilement
    }
    e.preventDefault();
    this.dx = Math.max(-this.width, Math.min(this.width, dx));
    this.el.style.transform = `translateX(${this.dx}px)`;
    const wrap = this.wrap();
    if (wrap) {
      wrap.dataset['swipe'] = this.dx > 0 ? 'right' : 'left';
      wrap.classList.toggle('swipe-commit', Math.abs(this.dx) >= this.threshold());
    }
  }

  private onEnd(): void {
    if (!this.active) return;
    this.active = false;
    const commit = this.axis === 'h' && Math.abs(this.dx) >= this.threshold();
    const right = this.dx > 0;
    if (commit) {
      // La ligne file dans le sens du geste, puis l'action part : elle porte son
      // propre « Annuler », et la ligne quitte le rendu dans la foulée.
      this.el.style.transition = 'transform .16s ease-in';
      this.el.style.transform = `translateX(${right ? this.width : -this.width}px)`;
      setTimeout(() => {
        this.zone.run(() => (right ? this.swipeRight : this.swipeLeft).emit());
        this.reset();
      }, 150);
    } else {
      this.el.style.transition = 'transform .18s ease';
      this.el.style.transform = '';
      this.reset();
    }
  }

  private reset(): void {
    const wrap = this.wrap();
    if (wrap) { delete wrap.dataset['swipe']; wrap.classList.remove('swipe-commit'); }
  }
}
