import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { RECIPE_PALETTE } from '../core/constants';

@Component({
  selector: 'screen-recettes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <div class="screen-head">
        <div>
          <h1>Carnet de recettes</h1>
          <div class="screen-sub">{{ d().recipes.length }} recettes dans le carnet</div>
        </div>
        <button class="btn btn-primary" (click)="store.newRecipe()">
          <f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Nouvelle recette
        </button>
      </div>

      <div class="grid">
        @for (r of d().recipes; track r.id) {
          <div class="rcard" (click)="store.patch({ openRecipeId: r.id })">
            <div class="rhead"
                 [style.background]="r.photo ? 'url(' + r.photo + ')' : store.grad(r.color)"
                 [style.background-size]="'cover'" [style.background-position]="'center'">
              <div class="rscrim"></div>
              <div class="rname f-display">{{ r.name }}</div>
            </div>
            <div class="rfoot">
              <span class="rtime"><f-icon name="clock" [size]="14" color="var(--ink2)" /> {{ r.time }}</span>
              <span class="rdot">·</span>
              <span>{{ r.level }}</span>
              <span class="rdot">·</span>
              <span>{{ r.ingr.length }} ingrédients</span>
            </div>
          </div>
        } @empty {
          <div class="empty">Aucune recette pour le moment. Ajoutez-en une !</div>
        }
      </div>
    </div>

    <!-- Detail modal -->
    @if (openRecipe(); as r) {
      <f-modal [maxWidth]="520" (close)="store.patch({ openRecipeId: null })">
        <div class="dhead"
             [style.background]="r.photo ? 'url(' + r.photo + ')' : store.grad(r.color)"
             [style.background-size]="'cover'" [style.background-position]="'center'">
          <div class="rscrim"></div>
          <div class="dname f-display">{{ r.name }}</div>
        </div>
        <div class="dmeta">
          <span class="pill"><f-icon name="clock" [size]="14" color="var(--ink2)" /> {{ r.time }}</span>
          <span class="pill">{{ r.level }}</span>
        </div>

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

        <div class="modal-actions">
          <button class="btn btn-soft grow" (click)="store.editRecipe(r.id)">
            <f-icon name="edit" [size]="16" color="var(--ink2)" /> Modifier
          </button>
          <button class="btn btn-danger" (click)="store.patch({ confirmDelId: r.id })">
            <f-icon name="trash" [size]="16" color="#fff" /> Supprimer
          </button>
        </div>
      </f-modal>
    }

    <!-- Form modal -->
    @if (store.ui().recipeForm) {
      <f-modal [title]="store.ui().editingId ? 'Modifier la recette' : 'Nouvelle recette'" [maxWidth]="560" (close)="store.patch({ recipeForm: false })">
        <div class="field-label">Nom de la recette</div>
        <input class="input mb" placeholder="Ex : Tarte aux pommes"
               [ngModel]="store.ui().fName" (ngModelChange)="store.patch({ fName: $event })">

        <div class="form-row mb">
          <div class="grow">
            <div class="field-label">Temps</div>
            <input class="input" placeholder="45 min"
                   [ngModel]="store.ui().fTime" (ngModelChange)="store.patch({ fTime: $event })">
          </div>
          <div class="grow">
            <div class="field-label">Difficulté</div>
            <div class="seg lvl">
              @for (l of levels; track l) {
                <button [class.active]="store.ui().fLevel === l" (click)="store.patch({ fLevel: l })">{{ l }}</button>
              }
            </div>
          </div>
        </div>

        <div class="field-label">Apparence</div>
        <div class="appearance mb">
          <label class="upload">
            <input type="file" accept="image/*" (change)="onPhoto($event)">
            <f-icon name="upload" [size]="18" color="var(--ink2)" />
            <span>Photo</span>
          </label>
          <div class="swatch-row">
            @for (c of RECIPE_PALETTE; track c) {
              <div class="swatch" [style.background]="store.grad(c)"
                   [style.box-shadow]="store.ui().fColor === c && !store.ui().fPhoto ? '0 0 0 3px var(--surface), 0 0 0 5px ' + c : ''"
                   (click)="store.patch({ fColor: c, fPhoto: null })"></div>
            }
          </div>
        </div>
        @if (store.ui().fPhoto; as ph) {
          <div class="preview mb">
            <div class="preview-img" [style.background-image]="'url(' + ph + ')'"></div>
            <button class="btn btn-soft" (click)="store.patch({ fPhoto: null })">
              <f-icon name="x" [size]="15" color="var(--ink2)" /> Retirer la photo
            </button>
          </div>
        }

        <div class="section-head">
          <div class="section-t sm">Ingrédients</div>
          <span class="add-link" (click)="store.addIngr()"><f-icon name="plus" [size]="14" color="#7A9B76" [width]="2.6" /> Ajouter un ingrédient</span>
        </div>
        <div class="rows mb">
          @for (row of store.ui().fIngr; track row.id) {
            <div class="row-line">
              <input class="input" placeholder="Ex : 3 pommes"
                     [ngModel]="row.val" (ngModelChange)="store.setIngr(row.id, $event)">
              <button class="icon-btn sm rem" (click)="store.removeIngr(row.id)"><f-icon name="minus" [size]="16" color="var(--ink2)" /></button>
            </div>
          }
        </div>

        <div class="section-head">
          <div class="section-t sm">Étapes</div>
          <span class="add-link" (click)="store.addStep()"><f-icon name="plus" [size]="14" color="#7A9B76" [width]="2.6" /> Ajouter une étape</span>
        </div>
        <div class="rows mb">
          @for (row of store.ui().fSteps; track row.id; let idx = $index) {
            <div class="row-line step-line">
              <span class="num">{{ idx + 1 }}</span>
              <textarea class="input" placeholder="Décrire l'étape…"
                        [ngModel]="row.val" (ngModelChange)="store.setStep(row.id, $event)"></textarea>
              <button class="icon-btn sm rem" (click)="store.removeStep(row.id)"><f-icon name="minus" [size]="16" color="var(--ink2)" /></button>
            </div>
          }
        </div>

        <div class="modal-actions">
          <button class="btn btn-soft grow" (click)="store.patch({ recipeForm: false })">Annuler</button>
          <button class="btn btn-primary grow2" (click)="store.saveRecipe()">Enregistrer</button>
        </div>
      </f-modal>
    }

    <!-- Delete confirm -->
    @if (store.ui().confirmDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ confirmDelId: null })">
        <div class="confirm">
          <div class="warn"><f-icon name="trash" [size]="26" color="#E56B4E" /></div>
          <div class="confirm-t f-display">Supprimer cette recette ?</div>
          <div class="confirm-s">Cette recette sera retirée du carnet. Cette action est définitive.</div>
          <div class="modal-actions">
            <button class="btn btn-soft grow" (click)="store.patch({ confirmDelId: null })">Annuler</button>
            <button class="btn btn-danger grow" (click)="store.confirmRecipeDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px; align-items: start; }
    :host-context(.shell.narrow) .grid { grid-template-columns: 1fr; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }

    .rcard { background: var(--surface); border-radius: var(--r-card); overflow: hidden; cursor: pointer; box-shadow: 0 14px 30px -22px rgba(90,60,40,.6); }
    .rhead { height: 140px; position: relative; display: flex; align-items: flex-end; padding: 14px; }
    .rscrim { position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,.5), rgba(0,0,0,0) 60%); }
    .rname { position: relative; color: #fff; font-size: 18px; font-weight: 700; line-height: 1.15; text-shadow: 0 2px 10px rgba(0,0,0,.4); }
    .rfoot { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 13px 16px 16px; font-size: 13px; font-weight: 700; color: var(--ink2); }
    .rtime { display: inline-flex; align-items: center; gap: 5px; }
    .rdot { color: var(--ink3); }
    .empty { grid-column: 1 / -1; color: var(--ink2); font-weight: 700; font-size: 14px; padding: 30px 0; }

    /* detail */
    .dhead { height: 180px; position: relative; display: flex; align-items: flex-end; padding: 18px; margin: -26px -26px 18px; }
    .dname { position: relative; color: #fff; font-size: 26px; font-weight: 700; text-shadow: 0 2px 12px rgba(0,0,0,.45); }
    .dmeta { display: flex; gap: 10px; margin-bottom: 22px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; background: var(--soft); border-radius: 10px; padding: 7px 14px; font-size: 13px; font-weight: 800; color: var(--ink2); }
    .section-t { font-size: 14px; font-weight: 800; color: #E56B4E; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 12px; }
    .section-t.sm { margin-bottom: 0; }
    .ingr-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
    .ingr { display: flex; align-items: center; gap: 10px; font-size: 14.5px; font-weight: 700; color: var(--ink); }
    .bullet { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #7A9B76; }
    .steps { display: flex; flex-direction: column; gap: 14px; margin-bottom: 24px; }
    .step { display: flex; gap: 14px; }
    .step .num { width: 26px; height: 26px; flex: none; border-radius: 50%; background: #E56B4E; color: #fff; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .stext { font-size: 14.5px; font-weight: 600; color: var(--ink); line-height: 1.45; }

    /* form */
    .mb { margin-bottom: 20px; }
    .form-row { display: flex; gap: 16px; }
    .form-row .grow { flex: 1; min-width: 0; }
    .seg.lvl { display: flex; width: 100%; }
    .seg.lvl > button { flex: 1; }
    .appearance { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .upload { display: inline-flex; align-items: center; gap: 8px; padding: 11px 16px; border-radius: 13px; border: 2px dashed var(--line2); background: var(--soft); font-size: 13.5px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .upload input { display: none; }
    .preview { display: flex; align-items: center; gap: 14px; }
    .preview-img { width: 88px; height: 66px; border-radius: 13px; background-size: cover; background-position: center; flex: none; }
    .section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .add-link { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #7A9B76; cursor: pointer; }
    .rows { display: flex; flex-direction: column; gap: 9px; }
    .row-line { display: flex; gap: 9px; align-items: center; }
    .row-line .input { flex: 1; }
    .step-line { align-items: flex-start; }
    .step-line .num { width: 28px; flex: none; text-align: center; padding-top: 12px; font-family: var(--font-display); font-size: 16px; font-weight: 700; color: #E56B4E; }
    .step-line textarea.input { min-height: 46px; }
    .rem { flex: none; background: var(--soft2); }

    .modal-actions { display: flex; gap: 12px; align-items: center; }
    .modal-actions .grow { flex: 1; }
    .modal-actions .grow2 { flex: 1.4; }
    .confirm { text-align: center; }
    .warn { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #FCE9E3; display: flex; align-items: center; justify-content: center; }
    .confirm-t { font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-s { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 22px; }
  `],
})
export class RecettesScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  readonly RECIPE_PALETTE = RECIPE_PALETTE;
  readonly levels = ['Facile', 'Moyen', 'Difficile'] as const;

  openRecipe = computed(() => {
    const id = this.store.ui().openRecipeId;
    return id ? this.d().recipes.find((r) => r.id === id) ?? null : null;
  });

  onPhoto(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) this.store.onRecipePhoto(f);
  }
}
