import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DashboardStore } from '../../core/dashboard.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { TILE_RENDERERS } from './tiles';

/**
 * L'accueil.
 *
 * Il compose, il ne calcule pas. Aucune règle métier ne doit apparaître dans ce
 * fichier : chaque chiffre vient du fournisseur de son module, chaque tuile se
 * rend elle-même, et ajouter une tuile se fait en déclarant un fournisseur
 * (voir docs/accueil-contrat-de-tuile.md), sans rouvrir cet écran.
 */
@Component({
  selector: 'screen-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgComponentOutlet, IconComponent],
  template: `
    <div class="screen-enter">
      <div class="screen-head">
        <div>
          <div class="hello f-script">{{ hello() }}</div>
          <!--
            Le contexte est écrit en toutes lettres. C'est ce qui permet de dire
            « ah, c'est pour ça » devant un écran qui n'est pas dans le même
            ordre qu'hier soir, sans avoir à lire une ligne de code.
          -->
          <div class="screen-sub">{{ store.fmtLongDate(store.todayStr()) }}@if (contexte()) { · {{ contexte() }} }</div>
          <!--
            Un fichier de règles refusé ne doit pas se découvrir dans les
            journaux : celui qui l'a écrit doit le voir en ouvrant la page.
          -->
          @if (reglesKo()) { <div class="regles-ko">{{ reglesKo() }}</div> }
        </div>
        @if (store.data()) {
          <button class="btn btn-sage" (click)="store.prepareList(store.weekDays())">
            <f-icon name="bolt" [size]="20" color="#fff" /> Courses de cette semaine depuis les repas
          </button>
        }
      </div>

      <div class="grid">
        @for (t of tiles(); track t.id) {
          <div class="cell" [class.wide]="t.span === 'wide'">
            <ng-container *ngComponentOutlet="t.component; inputs: t.inputs" />
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .hello { font-size: 40px; color: var(--primary); line-height: .9; font-weight: 700; }
    .regles-ko { font-size: 12px; font-weight: 800; color: #B8860B; margin-top: 6px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; align-items: start; }
    :host-context(.shell.narrow) .grid { grid-template-columns: 1fr; }
    .cell { display: grid; min-width: 0; }
    .cell.wide { grid-column: span 2; }
    :host-context(.shell.narrow) .cell.wide { grid-column: auto; }
  `],
})
export class HomeScreen {
  store = inject(FoyerStore);
  dash = inject(DashboardStore);

  /** « Fin d'après-midi · jour d'école ». Vide tant que les règles ne sont pas là. */
  readonly contexte = computed(() => this.dash.context()?.label ?? '');

  /** Le fichier de règles a été refusé : le dire ici, pas seulement au journal. */
  readonly reglesKo = computed(() => {
    const r = this.dash.rules();
    if (!r?.errors.length) return '';
    return `Règles de contexte ignorées (${r.errors.length} erreur${r.errors.length > 1 ? 's' : ''} dans accueil.json), `
      + 'réglages d’origine appliqués.';
  });

  /** Sans membre connu (document pas encore chargé), on salue sans nommer personne. */
  readonly hello = computed(() => { const n = this.store.me()?.name; return n ? 'Bonjour ' + n : 'Bonjour'; });

  readonly tiles = computed(() => this.dash.tiles().map((t) => {
    const render = TILE_RENDERERS[t.provider.id];
    return {
      id: t.provider.id, component: render.component,
      // Une tuile repliée ne mérite plus deux colonnes : elle tient sur son titre.
      span: t.folded ? undefined : render.span,
      inputs: { tile: t.provider, state: t.state, raison: t.raison, collapsed: t.folded },
    };
  }));
}
