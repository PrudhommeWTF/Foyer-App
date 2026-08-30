import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { RECIPE_PALETTE } from '../core/constants';
import { ALLERGENES } from '../core/articles';

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
        <div class="head-acts">
          <button class="btn btn-soft" [disabled]="store.exportBusy()" (click)="store.exportRecipes()">
            <f-icon name="export" [size]="17" color="var(--ink2)" [width]="2" />
            {{ store.exportBusy() ? 'Export…' : 'Exporter' }}
          </button>
          <button class="btn btn-soft" (click)="fileInput.click()">
            <f-icon name="upload" [size]="17" color="var(--ink2)" [width]="2" /> Importer
          </button>
          <input #fileInput type="file" accept="application/json,.json" hidden (change)="onImportFile($event)" />
          <button class="btn btn-primary" (click)="store.newRecipe()">
            <f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Nouvelle recette
          </button>
        </div>
      </div>

      <div class="rsearch">
        <f-icon name="search" [size]="18" color="var(--ink3)" [width]="2.2" />
        <input [ngModel]="store.ui().recipeSearch" (ngModelChange)="store.patch({ recipeSearch: $event })"
               placeholder="Chercher : courgette, 20min, végétarien, 4 étoiles…" />
        @if (store.ui().recipeSearch) {
          <button class="icon-btn sm" (click)="store.patch({ recipeSearch: '' })"><f-icon name="x" [size]="15" color="var(--ink2)" /></button>
        }
      </div>
      @if (store.ui().recipeSearch.trim()) {
        <div class="rsearch-n">{{ hits().length }} recette(s) sur {{ d().recipes.length }}</div>
      }

      @let rep = store.repairReport();
      @if (rep.groups.length || rep.unreadable.length) {
        <button class="repair" (click)="store.openRepair()">
          <f-icon name="urgent" [size]="18" color="var(--honey)" [width]="2.2" />
          <span class="rep-txt">
            <b>{{ rep.total - rep.matched }} ingrédients ne sont rattachés à aucun article</b>
            <span>Leurs quantités ne s'additionnent pas et leur rayon est deviné. {{ rep.rate }} % du carnet est rattaché.</span>
          </span>
          <f-icon name="chevronRight" [size]="18" color="var(--ink3)" [width]="2.2" />
        </button>
      }

      <div class="grid">
        @for (h of hits(); track h.recipe.id) {
          @let r = h.recipe;
          <div class="rcard" (click)="store.patch({ openRecipeId: r.id })">
            @let thumb = store.photoUrl(r.photoId);
            <div class="rhead"
                 [style.background]="thumb ? 'url(' + thumb + ')' : store.grad(r.color)"
                 [style.background-size]="'cover'" [style.background-position]="'center'">
              <div class="rscrim"></div>
              <div class="rname f-display">{{ r.name }}</div>
            </div>
            <div class="rfoot">
              <span class="rtime"><f-icon name="clock" [size]="14" color="var(--ink2)" /> {{ store.recipeTime(r) }}</span>
              @if (r.portions) { <span class="rdot">·</span><span>{{ r.portions }} pers.</span> }
              <span class="rdot">·</span>
              <span>{{ r.level }}</span>
              @if (r.rating) { <span class="rdot">·</span><span class="rstars">{{ etoiles(r.rating) }}</span> }
              @let fait = store.lastMadeLabel(r.id);
              @if (fait) { <span class="rdot">·</span><span>{{ fait }}</span> }
            </div>
          </div>
        } @empty {
          <div class="empty">
            {{ store.ui().recipeSearch.trim() ? 'Aucune recette ne correspond.' : 'Aucune recette pour le moment. Ajoutez-en une !' }}
          </div>
        }
      </div>
    </div>

    <!-- Detail modal -->
    @if (openRecipe(); as r) {
      <f-modal [maxWidth]="520" (close)="store.patch({ openRecipeId: null })">
        @let hero = store.photoUrl(r.photoId);
        <div class="dhead"
             [style.background]="hero ? 'url(' + hero + ')' : store.grad(r.color)"
             [style.background-size]="'cover'" [style.background-position]="'center'">
          <div class="rscrim"></div>
          <div class="dname f-display">{{ r.name }}</div>
        </div>
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

        @if (r.tags?.length || r.rating || store.lastMadeLabel(r.id)) {
          <div class="dtags">
            @if (r.rating) { <span class="d-star">{{ etoiles(r.rating) }}</span> }
            @for (t of r.tags || []; track t) { <span class="d-tag">{{ t }}</span> }
            @let fait = store.lastMadeLabel(r.id);
            @if (fait) { <span class="d-fait">{{ fait }}</span> }
          </div>
        }

        @let chk = store.recipeCheck(r);
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

        <div class="modal-actions">
          <button class="btn btn-soft" title="Copier la recette en texte" (click)="store.copyRecipeText(r)">
            <f-icon name="copy" [size]="16" color="var(--ink2)" />
          </button>
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
        @if (!store.ui().editingId) {
          <div class="import">
            <div class="field-label">Importer depuis une page de recette</div>
            <div class="import-row">
              <input class="input" type="url" inputmode="url" autocomplete="off"
                     placeholder="Collez l'adresse d'une recette (Marmiton, 750g…)"
                     [ngModel]="store.ui().fImportUrl" (ngModelChange)="store.patch({ fImportUrl: $event })"
                     (keydown.enter)="doImport()">
              <button class="btn btn-sage" [disabled]="store.ui().fImportBusy" (click)="doImport()">
                {{ store.ui().fImportBusy ? 'Lecture…' : 'Importer' }}
              </button>
            </div>
            <div class="hint">Le serveur va lire la page et remplir le formulaire. Relisez avant d'enregistrer.</div>

            <button class="paste-open" (click)="store.patch({ fPasteOpen: !store.ui().fPasteOpen })">
              <f-icon name="copy" [size]="15" color="var(--ink2)" [width]="2" />
              <span>… ou coller le texte d'une recette</span>
              <f-icon [name]="store.ui().fPasteOpen ? 'chevronDown' : 'chevronRight'" [size]="15" color="var(--ink3)" [width]="2.2" />
            </button>
            @if (store.ui().fPasteOpen) {
              <textarea class="input paste" rows="7" [ngModel]="store.ui().fPaste"
                        (ngModelChange)="store.patch({ fPaste: $event })"
                        placeholder="Collez ici une recette prise sur un carnet, un message ou une photo (votre téléphone sait extraire le texte d'une image)."></textarea>
              <div class="import-row">
                <div class="hint">Rien n'est envoyé : la lecture se fait dans votre navigateur.</div>
                <button class="btn btn-sage" (click)="store.applyPaste()">Lire</button>
              </div>
            }
          </div>
        }

        @if (store.ui().fImportWarnings.length) {
          <div class="warn-box mb">
            @for (w of store.ui().fImportWarnings; track $index) {
              <div class="warn-line"><f-icon name="bell" [size]="14" color="#D9930F" [width]="2.4" /> {{ w }}</div>
            }
          </div>
        }

        <div class="field-label">Nom de la recette</div>
        <input class="input mb" placeholder="Ex : Tarte aux pommes"
               [ngModel]="store.ui().fName" (ngModelChange)="store.patch({ fName: $event })">

        <div class="form-row mb">
          <div class="grow">
            <div class="field-label num">Prépa.</div>
            <input class="input" type="number" inputmode="numeric" min="0" placeholder="15"
                   [ngModel]="store.ui().fPrepMin" (ngModelChange)="store.patch({ fPrepMin: $event })">
          </div>
          <div class="grow">
            <div class="field-label num">Cuisson</div>
            <input class="input" type="number" inputmode="numeric" min="0" placeholder="30"
                   [ngModel]="store.ui().fCookMin" (ngModelChange)="store.patch({ fCookMin: $event })">
          </div>
          <div class="grow">
            <div class="field-label num">Portions</div>
            <input class="input" type="number" inputmode="numeric" min="1" placeholder="4"
                   [ngModel]="store.ui().fPortions" (ngModelChange)="store.patch({ fPortions: $event })">
          </div>
        </div>
        <div class="hint mb">Durées en minutes. Les portions servent à mettre les courses à l'échelle du nombre de couverts.</div>

        <div class="field-label">Difficulté</div>
        <div class="seg lvl mb">
          @for (l of levels; track l) {
            <button [class.active]="store.ui().fLevel === l" (click)="store.patch({ fLevel: l })">{{ l }}</button>
          }
        </div>

        <div class="field-label">Note de la famille</div>
        <div class="stars mb">
          @for (n of [1, 2, 3, 4, 5]; track n) {
            <button class="star" [class.on]="store.ui().fRating >= n" (click)="store.setRating(n)"
                    [attr.aria-label]="n + ' sur 5'">★</button>
          }
          @if (store.ui().fRating) { <span class="star-hint">Touchez l'étoile courante pour retirer la note.</span> }
        </div>

        <div class="field-label">Étiquettes</div>
        <div class="tags mb">
          @for (t of store.ui().fTags; track t) {
            <button class="tag" (click)="store.removeTag(t)">{{ t }} <f-icon name="x" [size]="11" color="#fff" [width]="3" /></button>
          }
          <input class="input tag-in" [ngModel]="store.ui().fTagInput" (ngModelChange)="store.patch({ fTagInput: $event })"
                 (keydown.enter)="store.addTag()" (blur)="store.addTag()" placeholder="végétarien, du dimanche…" />
        </div>

        <div class="field-label">Apparence</div>
        <div class="appearance mb">
          <label class="upload" [class.busy]="store.ui().fPhotoBusy">
            <input type="file" accept="image/*" [disabled]="store.ui().fPhotoBusy" (change)="onPhoto($event)">
            <f-icon name="upload" [size]="18" color="var(--ink2)" />
            <span>{{ store.ui().fPhotoBusy ? 'Envoi…' : 'Photo' }}</span>
          </label>
          <div class="swatch-row">
            @for (c of RECIPE_PALETTE; track c) {
              <div class="swatch" [style.background]="store.grad(c)"
                   [style.box-shadow]="store.ui().fColor === c && !store.ui().fPhotoId ? '0 0 0 3px var(--surface), 0 0 0 5px ' + c : ''"
                   (click)="store.patch({ fColor: c, fPhotoId: null })"></div>
            }
          </div>
        </div>
        @if (store.photoUrl(store.ui().fPhotoId); as ph) {
          <div class="preview mb">
            <div class="preview-img" [style.background-image]="'url(' + ph + ')'"></div>
            <button class="btn btn-soft" (click)="store.patch({ fPhotoId: null })">
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
    @if (store.ui().importOpen) {
      @let rep = store.importReport();
      @if (rep) {
        <f-modal title="Importer des recettes" [maxWidth]="520" (close)="store.patch({ importOpen: false })">
          <div class="imp-bilan">
            @if (rep.nouvelles.length) {
              <div><b>{{ rep.nouvelles.length }}</b> {{ rep.nouvelles.length > 1 ? 'recettes seront ajoutées' : 'recette sera ajoutée' }}@if (rep.photos) {, dont <b>{{ rep.photos }}</b> avec photo}.</div>
            } @else {
              <div>Aucune recette à ajouter.</div>
            }
            @if (rep.deja.length) {
              <div><b>{{ rep.deja.length }}</b> déjà dans le carnet, {{ rep.deja.length > 1 ? 'laissées telles quelles' : 'laissée telle quelle' }}.</div>
            }
          </div>

          @if (rep.nouvelles.length) {
            <div class="field-label">À ajouter</div>
            <div class="imp-list">
              @for (n of rep.nouvelles; track n.id) {
                <div class="imp-row">
                  <span class="imp-name">{{ n.name }}</span>
                  <span class="imp-meta">{{ n.ingr.length }} ingr. · {{ n.steps.length }} {{ n.steps.length > 1 ? 'étapes' : 'étape' }}</span>
                </div>
              }
            </div>
          }

          @if (rep.ignorees.length) {
            <div class="imp-warn">
              <div class="field-label">Entrées écartées</div>
              @for (i of rep.ignorees; track $index) {
                <div class="imp-row"><span class="imp-name">{{ i.nom }}</span><span class="imp-meta">{{ i.raison }}</span></div>
              }
              <div class="hint">Le reste du fichier est importé quand même.</div>
            </div>
          }

          <div class="modal-actions">
            <button class="btn btn-soft grow" (click)="store.patch({ importOpen: false })">Annuler</button>
            <button class="btn btn-primary grow2" [disabled]="!rep.nouvelles.length || store.importBusy()"
                    (click)="store.applyRecipeImport()">
              {{ store.importBusy() ? 'Import…' : 'Ajouter au carnet' }}
            </button>
          </div>
        </f-modal>
      }
    }

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
    .rsearch { display: flex; align-items: center; gap: 10px; background: var(--surface); border-radius: 14px; padding: 11px 15px; box-shadow: var(--sh-card); margin-bottom: 14px; }
    .rsearch input { flex: 1; border: none; background: transparent; font-family: var(--font-body); font-size: 14.5px; font-weight: 600; color: var(--ink); outline: none; }
    .rsearch input::placeholder { color: var(--ink3); }
    .rsearch-n { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin: -6px 0 14px 4px; }
    .rstars { color: var(--honey); letter-spacing: -1px; }

    .paste-open { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: none; padding: 10px 0 4px; cursor: pointer; font-family: var(--font-body); font-size: 13px; font-weight: 800; color: var(--ink2); text-align: left; }
    .paste-open span { flex: 1; }
    .paste { width: 100%; resize: vertical; font-family: var(--font-body); font-size: 13.5px; line-height: 1.5; margin-bottom: 8px; }

    .stars { display: flex; align-items: center; gap: 4px; }
    .star { border: none; background: none; cursor: pointer; font-size: 26px; line-height: 1; color: var(--line2); padding: 0 2px; }
    .star.on { color: var(--honey); }
    .star-hint { font-size: 12px; font-weight: 600; color: var(--ink3); margin-left: 8px; }
    .tags { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
    .tag { display: inline-flex; align-items: center; gap: 5px; border: none; background: var(--sage); color: #fff; border-radius: 10px; padding: 6px 10px; font-family: var(--font-body); font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .tag-in { flex: 1; min-width: 150px; }

    .dtags { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 14px; }
    .d-star { color: var(--honey); font-size: 15px; letter-spacing: -1px; }
    .d-tag { background: var(--soft2); color: var(--ink2); border-radius: 9px; padding: 4px 9px; font-size: 12px; font-weight: 800; }
    .d-fait { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .diet { border: 2px solid var(--line2); border-radius: 14px; padding: 12px 14px; margin: 16px 0 4px; }
    .d-alert { display: flex; align-items: flex-start; gap: 9px; font-size: 13.5px; font-weight: 700; color: var(--ink); line-height: 1.45; }
    .d-alert b { color: var(--primary); }
    .d-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; }
    .d-line:first-child { margin-top: 0; }
    .d-lbl { font-size: 11.5px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; margin-right: 2px; }
    .d-chip { background: var(--soft2); color: var(--honey); border-radius: 9px; padding: 4px 9px; font-size: 12px; font-weight: 800; }
    .d-warn { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin-top: 10px; }
    .d-warn b { color: var(--ink); }
    .repair { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; margin-bottom: 20px; padding: 13px 15px; border: 2px solid var(--line2); background: var(--surface); border-radius: 16px; cursor: pointer; font-family: var(--font-body); }
    .repair:hover { border-color: var(--honey); }
    .rep-txt { flex: 1; min-width: 0; }
    .rep-txt b { display: block; font-size: 14px; font-weight: 800; color: var(--ink); }
    .rep-txt span { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.4; margin-top: 2px; }
    .head-acts { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .imp-bilan { background: var(--soft); border-radius: 13px; padding: 12px 14px; font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.55; margin-bottom: 16px; }
    .imp-bilan b { color: var(--ink); font-weight: 800; }
    .imp-list { display: flex; flex-direction: column; margin-bottom: 18px; max-height: 260px; overflow-y: auto; }
    .imp-row { display: flex; align-items: baseline; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); }
    .imp-name { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .imp-meta { flex: none; font-size: 12px; font-weight: 800; color: var(--ink3); }
    .imp-warn { background: #FCE9E3; border-radius: 13px; padding: 10px 14px 12px; margin-bottom: 18px; }
    .imp-warn .imp-row { border-top-color: rgba(198,73,47,.18); }
    .imp-warn .imp-meta { color: #C6492F; }
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
    .import { background: var(--soft); border-radius: 15px; padding: 14px 15px; margin-bottom: 20px; }
    .import-row { display: flex; gap: 10px; }
    .import-row .input { flex: 1; min-width: 0; }
    .import .field-label { margin-bottom: 8px; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; }
    .import .hint { margin-top: 8px; }
    .warn-box { background: #FDF0DA; border-radius: 13px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .warn-line { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; font-weight: 700; color: #8A6412; line-height: 1.4; }
    .source { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: var(--ink2); margin-bottom: 20px; text-decoration: none; }
    .source:hover { text-decoration: underline; }
    /* Trois champs courts sur 390 px : libellés sur une ligne, champs alignés. */
    .form-row { display: flex; gap: 12px; align-items: flex-end; }
    .field-label.num { white-space: nowrap; font-size: 12px; letter-spacing: .02em; }
    .form-row + .hint { margin-top: -12px; }
    .form-row .grow { flex: 1; min-width: 0; }
    .seg.lvl { display: flex; width: 100%; }
    .seg.lvl > button { flex: 1; }
    .appearance { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .upload { display: inline-flex; align-items: center; gap: 8px; padding: 11px 16px; border-radius: 13px; border: 2px dashed var(--line2); background: var(--soft); font-size: 13.5px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .upload input { display: none; }
    .upload.busy { opacity: .6; cursor: progress; }
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
  readonly ALLERGENES = ALLERGENES;
  hits = computed(() => this.store.recipeHits());
  etoiles(n: number): string { return '★'.repeat(n) + '☆'.repeat(5 - n); }
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  /** Le champ est réinitialisé : rechoisir le même fichier doit relancer l'import. */
  onImportFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.store.prepareRecipeImport(file);
  }

  readonly RECIPE_PALETTE = RECIPE_PALETTE;
  readonly levels = ['Facile', 'Moyen', 'Difficile'] as const;

  openRecipe = computed(() => {
    const id = this.store.ui().openRecipeId;
    return id ? this.d().recipes.find((r) => r.id === id) ?? null : null;
  });

  doImport(): void { void this.store.importRecipe(); }

  onPhoto(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    // Le champ est vidé : reposer deux fois le même fichier doit relancer l'envoi.
    input.value = '';
    if (f) void this.store.onRecipePhoto(f);
  }
}
