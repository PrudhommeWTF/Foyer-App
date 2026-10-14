import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ALLERGENES } from '../../core/articles';
import { Recipe } from '../../core/models';
import { ItemCtx } from '../../core/items';

/** La fiche d'une recette, en lecture : temps, portions, régimes, ingrédients et étapes. */
@Component({
  selector: 'app-recipe-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let r = item();
    <!-- La photo seulement : sans elle, un aplat de couleur prendrait le tiers de l'écran pour rien. -->
    @if (store.photoUrl(r.photoId); as hero) {
      <div class="dhead" [style.background-image]="'url(' + hero + ')'"></div>
    }
    <div class="dmeta">
      @if (r.prepMin) { <span class="pill"><f-icon name="clock" [size]="14" color="var(--ink2)" /> Préparation {{ r.prepMin }} min</span> }
      @if (r.cookMin) { <span class="pill">Cuisson {{ r.cookMin }} min</span> }
      @if (!r.prepMin && !r.cookMin) { <span class="pill"><f-icon name="clock" [size]="14" color="var(--ink2)" /> Durée non renseignée</span> }
      @if (r.portions) { <span class="pill">{{ r.portions }} personnes</span> }
      <span class="pill">{{ r.level }}</span>
    </div>
    @if (r.source) {
      <a class="source" [href]="r.source" target="_blank" rel="noopener noreferrer">
        <f-icon name="export" [size]="14" color="var(--ink2)" /> Voir la recette d'origine
      </a>
    }

    @if (r.tags?.length || r.rating || fait()) {
      <div class="dtags">
        @if (r.rating) { <span class="d-star">{{ etoiles(r.rating) }}</span> }
        @for (t of r.tags || []; track t) { <span class="d-tag">{{ t }}</span> }
        @if (fait(); as f) { <span class="d-fait">{{ f }}</span> }
      </div>
    }

    @let chk = check();
    @if (chk.content.allerg.length || chk.conflicts.length || chk.content.unchecked.length) {
      <div class="diet">
        @if (chk.conflicts.length) {
          <div class="d-alert">
            <f-icon name="urgent" [size]="17" color="var(--primary)" [width]="2.2" />
            <span><b>Ne convient pas à</b> {{ store.alertLabel(chk.conflicts) }}</span>
          </div>
        }
        @if (chk.content.allerg.length) {
          <div class="d-line">
            <span class="d-lbl">Allergènes</span>
            @for (a of chk.content.allerg; track a) { <span class="d-chip">{{ ALLERGENES[a] }}</span> }
          </div>
        }
        @if (chk.content.unchecked.length) {
          <div class="d-warn">
            {{ chk.content.unchecked.length }} ingrédient(s) que l'application ne reconnaît pas n'ont
            <b>pas été vérifiés</b> : l'absence d'alerte ne vaut pas garantie.
          </div>
        }
      </div>
    }

    <div class="section-t">Ingrédients</div>
    <div class="ingr-list">
      @for (i of r.ingr; track $index) {
        <div class="ingr"><span class="bullet"></span>{{ i }}</div>
      } @empty { <div class="muted">Aucun ingrédient.</div> }
    </div>

    <div class="section-t">Étapes</div>
    <div class="steps">
      @for (s of r.steps; track $index) {
        <div class="step"><span class="num">{{ $index + 1 }}</span><span class="stext">{{ s }}</span></div>
      } @empty { <div class="muted">Aucune étape.</div> }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .dhead { height: 170px; border-radius: 16px; margin-bottom: 16px; background-size: cover; background-position: center; }
    .dmeta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; background: var(--soft); border-radius: 10px; padding: 7px 12px; font-size: 13px; font-weight: 800; color: var(--ink2); }
    .source { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: var(--ink2); margin-bottom: 18px; text-decoration: none; }
    .source:hover { text-decoration: underline; }
    .dtags { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-bottom: 14px; }
    .d-star { color: var(--honey); font-size: 15px; letter-spacing: -1px; }
    .d-tag { background: var(--soft2); color: var(--ink2); border-radius: 9px; padding: 4px 9px; font-size: 12px; font-weight: 800; }
    .d-fait { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .diet { border: 2px solid var(--line2); border-radius: 14px; padding: 12px 14px; margin: 0 0 18px; }
    .d-alert { display: flex; align-items: flex-start; gap: 9px; font-size: 13.5px; font-weight: 700; color: var(--ink); line-height: 1.45; }
    .d-alert b { color: var(--primary); }
    .d-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
    .d-line:first-child { margin-top: 0; }
    .d-lbl { font-size: 11.5px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; margin-right: 2px; }
    .d-chip { background: var(--soft2); color: var(--honey); border-radius: 9px; padding: 4px 9px; font-size: 12px; font-weight: 800; }
    .d-warn { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin-top: 10px; }
    .d-warn b { color: var(--ink); }
    .section-t { font-size: 14px; font-weight: 800; color: #E56B4E; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 12px; }
    .ingr-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 22px; }
    .ingr { display: flex; align-items: center; gap: 10px; font-size: 14.5px; font-weight: 700; color: var(--ink); }
    .bullet { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #7A9B76; }
    .steps { display: flex; flex-direction: column; gap: 14px; margin-bottom: 8px; }
    .step { display: flex; gap: 14px; }
    .step .num { width: 26px; height: 26px; flex: none; border-radius: 50%; background: #E56B4E; color: #fff; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .stext { font-size: 14.5px; font-weight: 600; color: var(--ink); line-height: 1.45; }
    .muted { color: var(--ink3); font-weight: 700; font-size: 13.5px; }
  `],
})
export class RecipeView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<Recipe>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly ALLERGENES = ALLERGENES;
  readonly fait = computed(() => this.store.lastMadeLabel(this.item().id));
  readonly check = computed(() => this.store.recipeCheck(this.item()));
  etoiles(n: number): string { return '★'.repeat(n) + '☆'.repeat(5 - n); }
}
