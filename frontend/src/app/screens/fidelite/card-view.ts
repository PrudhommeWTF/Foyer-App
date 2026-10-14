import { ChangeDetectionStrategy, Component, computed, effect, input, signal, untracked } from '@angular/core';
import { AvatarComponent } from '../../shared/avatar';
import { bwipBcid, cardInitials, CARD_FORMATS, isMatrix } from '../../core/cards';
import { LoyaltyCard } from '../../core/models';
import { ItemCtx } from '../../core/items';

/**
 * La fiche d'une carte, en lecture : c'est elle qu'on présente en caisse. Le
 * code est redessiné (QR ou code-barres) par bwip-js, chargé à la demande pour
 * ne pas peser sur le premier chargement.
 */
@Component({
  selector: 'app-card-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarComponent],
  template: `
    @let c = item();
    <div class="show-head">
      @if (c.logo) { <img class="logo-tile" [src]="c.logo" [alt]="c.name" /> }
      @else { <f-avatar [ini]="ini(c.name)" [color]="c.color" [size]="46" /> }
      <div class="sh-sub">{{ formatLabel() }}</div>
    </div>
    <div class="code-box">
      @if (svg(); as s) {
        <img class="code-img" [class.matrix]="isMatrix(c.format)" [src]="s" [alt]="'Code de ' + c.name" />
      } @else if (error()) {
        <div class="code-fallback">
          <div class="cf-title">Ce code ne se redessine pas</div>
          <div class="cf-code">{{ c.code }}</div>
          <div class="cf-hint">Montrez ce numéro, ou vérifiez le format en modifiant la carte.</div>
        </div>
      } @else {
        <div class="code-loading">Préparation du code…</div>
      }
    </div>
    <div class="code-text">{{ c.code }}</div>
    @if (c.note) { <div class="note">{{ c.note }}</div> }
  `,
  styles: [`
    :host { display: block; }
    .show-head { display: flex; align-items: center; gap: 13px; margin-bottom: 16px; }
    .sh-sub { font-size: 13px; font-weight: 800; color: var(--ink3); }
    .logo-tile { width: 46px; height: 46px; border-radius: 14px; object-fit: contain; background: #fff; box-shadow: inset 0 0 0 1px var(--line2); flex: none; }
    /* Toujours sur fond blanc, même en thème sombre : c'est ce que lit la douchette. */
    .code-box { background: #fff; border-radius: 16px; padding: 22px; display: flex; align-items: center; justify-content: center; min-height: 170px; box-shadow: inset 0 0 0 1px var(--line2); }
    .code-img { width: 100%; height: auto; image-rendering: pixelated; }
    .code-img.matrix { max-width: 240px; }
    .code-loading { color: #8A7E74; font-weight: 700; font-size: 14px; }
    .code-fallback { text-align: center; }
    .cf-title { font-weight: 800; color: var(--primary); font-size: 14px; }
    .cf-code { font-size: 22px; font-weight: 800; color: #2B2420; letter-spacing: .04em; margin: 8px 0; word-break: break-all; }
    .cf-hint { font-size: 12.5px; font-weight: 600; color: #8A7E74; }
    .code-text { text-align: center; font-size: 14px; font-weight: 700; color: var(--ink2); letter-spacing: .04em; margin: 14px 0 6px; word-break: break-all; }
    .note { margin-top: 8px; padding: 9px 12px; border-radius: 12px; background: var(--soft); font-size: 13px; font-weight: 600; color: var(--ink2); overflow-wrap: anywhere; }
  `],
})
export class CardView {
  readonly item = input.required<LoyaltyCard>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly ini = cardInitials;
  readonly isMatrix = isMatrix;

  readonly svg = signal<string | null>(null);
  readonly error = signal(false);
  readonly formatLabel = computed(() => CARD_FORMATS.find((f) => f.id === this.item().format)?.label || '');
  /** Ce qui se dessine : le code et son format. Un compteur d'usage qui bouge ne redessine rien. */
  private readonly what = computed(() => this.item().format + '|' + this.item().code, { equal: (a, b) => a === b });

  constructor() {
    effect(() => {
      const key = this.what();
      this.svg.set(null); this.error.set(false);
      untracked(() => void this.render(key));
    });
  }

  /** Rend le code en SVG, posé en data-URI dans une balise <img>. */
  private async render(key: string): Promise<void> {
    const c = this.item();
    try {
      const bwip = await import('bwip-js/browser');
      const opts = isMatrix(c.format)
        ? { bcid: bwipBcid(c.format), text: c.code, scale: 5, padding: 2 }
        : { bcid: bwipBcid(c.format), text: c.code, scale: 3, height: 16, includetext: true, textxalign: 'center' as const };
      const svg = bwip.toSVG(opts);
      // La carte a changé entre-temps : ne pas poser un code périmé.
      if (this.what() !== key) return;
      this.svg.set('data:image/svg+xml;utf8,' + encodeURIComponent(svg));
    } catch {
      // Un code qui ne correspond pas à sa symbologie fait échouer le rendu :
      // on montre le numéro en clair plutôt qu'un vide.
      if (this.what() === key) this.error.set(true);
    }
  }
}
