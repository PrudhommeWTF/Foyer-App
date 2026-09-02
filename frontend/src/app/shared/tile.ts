import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TileState } from '../core/tiles/contract';

/**
 * Le cadre commun à toutes les tuiles de l'accueil.
 *
 * Il rend les quatre états d'une tuile de la même façon partout, ce qui est
 * l'essentiel : c'est parce que « en cours de chargement » et « il n'y a rien »
 * se ressemblaient qu'une tuile en panne a pu passer des semaines pour une tuile
 * vide. Le contenu, lui, est projeté par la tuile du module, et n'est écrit que
 * pour l'état `ok`.
 */
@Component({
  selector: 'f-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card">
      <div class="ch">
        <div class="card-title sm">{{ title() }}@if (badge()) { <span class="badge"> · {{ badge() }}</span> }</div>
        @if (link()) { <span class="link" (click)="open.emit()">{{ link() }}</span> }
      </div>

      @if (loading()) {
        <div class="skel" aria-label="Chargement"><span></span><span></span><span></span></div>
      }

      @if (emptyHint()) { <div class="t-empty">{{ emptyHint() }}</div> }

      @if (err(); as e) {
        <div class="t-err">
          <div class="t-err-msg">{{ e.message }}</div>
          <div class="t-err-detail">{{ e.detail }}</div>
          <button class="t-retry" (click)="retry.emit()">Réessayer</button>
        </div>
      }

      @if (partial()) { <div class="t-partial">{{ partial() }}</div> }
      @if (stale()) { <div class="t-stale">{{ stale() }}</div> }

      <ng-content />
    </div>
  `,
  styles: [`
    .ch { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .card-title.sm { font-size: 17px; line-height: 1.25; }
    .badge { color: var(--ink3); font-weight: 700; }
    .link { font-size: 13px; font-weight: 800; color: var(--primary); cursor: pointer; flex: none; padding-top: 2px; }

    /* Chargement : la structure avant la donnée, jamais un zéro en attendant. */
    .skel { display: flex; flex-direction: column; gap: 10px; }
    .skel > span { height: 14px; border-radius: 7px; background: var(--soft2); animation: fskel 1.2s ease-in-out infinite; }
    .skel > span:nth-child(2) { width: 78%; animation-delay: .12s; }
    .skel > span:nth-child(3) { width: 55%; animation-delay: .24s; }

    .t-empty { color: var(--ink2); font-weight: 700; font-size: 13.5px; padding: 6px 0 2px; }

    .t-err { background: var(--soft); border-left: 4px solid var(--primary); border-radius: 12px; padding: 12px 14px; }
    .t-err-msg { font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .t-err-detail { font-size: 11.5px; font-weight: 700; color: var(--ink2); margin-top: 4px; word-break: break-word; }
    .t-retry {
      margin-top: 10px; border: none; cursor: pointer; border-radius: 10px; padding: 7px 13px;
      background: var(--primary); color: #fff; font-size: 12.5px; font-weight: 800;
    }

    .t-partial { font-size: 11.5px; font-weight: 800; color: #B8860B; margin-bottom: 10px; }
    .t-stale { font-size: 11.5px; font-weight: 800; color: var(--ink2); margin-bottom: 10px; }
  `],
})
export class TileComponent {
  readonly title = input('');
  /** Complément du titre : un compte, un mois. Vide quand la tuile n'en a pas. */
  readonly badge = input('');
  readonly link = input('');
  readonly state = input.required<TileState<unknown>>();

  readonly open = output<void>();
  readonly retry = output<void>();

  // Les états sont dérivés plutôt que discriminés dans le gabarit : c'est ce qui
  // garantit qu'aucune branche ne lit `data` quand il n'y en a pas.
  readonly loading = computed(() => this.state().kind === 'loading');
  readonly emptyHint = computed(() => { const s = this.state(); return s.kind === 'empty' ? s.hint : ''; });
  readonly err = computed(() => { const s = this.state(); return s.kind === 'error' ? s : null; });
  readonly partial = computed(() => { const s = this.state(); return s.kind === 'ok' ? s.partial ?? '' : ''; });
  readonly stale = computed(() => { const s = this.state(); return s.kind === 'ok' ? s.stale ?? '' : ''; });
}
