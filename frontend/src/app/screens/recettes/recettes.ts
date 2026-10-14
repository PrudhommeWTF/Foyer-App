import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';

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
          <button class="btn btn-primary" (click)="store.openItem('recipe', null)">
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
          <div class="rcard" (click)="store.openItem('recipe', r.id)">
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

    <!-- Import d'un carnet : le rapport avant d'écrire -->
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

  `,
  styles: [`
    .rsearch { display: flex; align-items: center; gap: 10px; background: var(--surface); border-radius: 14px; padding: 11px 15px; box-shadow: var(--sh-card); margin-bottom: 14px; }
    .rsearch input { flex: 1; border: none; background: transparent; font-family: var(--font-body); font-size: 14.5px; font-weight: 600; color: var(--ink); outline: none; }
    .rsearch input::placeholder { color: var(--ink3); }
    .rsearch-n { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin: -6px 0 14px 4px; }
    .rstars { color: var(--honey); letter-spacing: -1px; }

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

    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; }

    .modal-actions { display: flex; gap: 12px; align-items: center; }
    .modal-actions .grow { flex: 1; }
    .modal-actions .grow2 { flex: 1.4; }
  `],
})
export class RecettesScreen {
  hits = computed(() => this.store.recipeHits());
  etoiles(n: number): string { return '★'.repeat(n) + '☆'.repeat(5 - n); }
  store = inject(FoyerStore);
  d = this.store.d;

  /** Le champ est réinitialisé : rechoisir le même fichier doit relancer l'import. */
  onImportFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.store.prepareRecipeImport(file);
  }

}
