import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { ALLERGENES, RAYONS } from '../core/articles';

/**
 * Reprise des ingrédients que le lecteur n'a rattachés à aucun article.
 *
 * Le taux est affiché en tête et bouge à chaque geste : sans lui, on répare
 * sans savoir si l'on avance, et on abandonne. Chaque forme est montrée avec
 * ce qu'elle coûte (son nombre d'apparitions) et où elle apparaît, parce que
 * reconnaître « parures de légumes » demande souvent de se rappeler la recette.
 *
 * Rien n'est rattaché automatiquement : un rattachement faux se propage à tout
 * le carnet et à toutes les listes suivantes sans que personne le remarque.
 */
@Component({
  selector: 'app-repair-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    @let rep = store.repairReport();
    @let g = store.repairGroup();

    <f-modal [title]="g ? 'Reprendre « ' + g.name + ' »' : 'Ingrédients non reconnus'" [maxWidth]="560"
             (close)="store.patch({ repairOpen: false, repForm: '' })">

      @if (!g) {
        <div class="taux">
          <div class="jauge"><div class="jauge-in" [style.width.%]="rep.rate"></div></div>
          <div class="taux-txt"><b>{{ rep.matched }}</b> ingrédients rattachés sur {{ rep.total }} ({{ rep.rate }} %)</div>
        </div>

        @if (!rep.groups.length && !rep.unreadable.length) {
          <div class="vide">
            <f-icon name="check" [size]="26" color="var(--sage)" [width]="2.4" />
            <div>Tout le carnet est rattaché. Les quantités s'additionnent et les rayons sont justes.</div>
          </div>
        }

        @if (rep.groups.length) {
          <div class="hint bord">
            Une ligne qui n'est pas un ingrédient (un intertitre, une note) n'a pas d'article à
            recevoir : touchez le nom de sa recette pour aller la corriger là-bas.
          </div>
        }

        @for (grp of rep.groups; track grp.form) {
          <div class="grp">
            <div class="grp-top">
              <div class="grp-name">{{ grp.name }}</div>
              <div class="grp-count">{{ grp.count }}&nbsp;fois</div>
            </div>
            <div class="grp-ou">
              @for (u of grp.uses.slice(0, 4); track $index) {
                <button class="lien" (click)="store.openRepairRecipe(u.recipeId)">{{ u.recipeName }}</button>
              }
              @if (grp.uses.length > 4) { <span class="reste">et {{ grp.uses.length - 4 }} autres</span> }
            </div>
            <div class="grp-acts">
              <button class="btn btn-soft" (click)="store.repairPick(grp.form, 'lier')">Rattacher</button>
              <button class="btn btn-soft" (click)="store.repairPick(grp.form, 'creer')">Créer l'article</button>
            </div>
          </div>
        }

        @if (rep.unreadable.length) {
          <div class="warnbox">
            <div class="grp-head">Lignes sans produit</div>
            <div class="hint">Rien ne s'en dégage : elles se corrigent dans la recette, pas ici.</div>
            @for (u of rep.unreadable.slice(0, 8); track $index) {
              <button class="ligne" (click)="store.openRepairRecipe(u.recipeId)">
                <span class="l-raw">{{ u.raw || '(vide)' }}</span><span class="l-rec">{{ u.recipeName }}</span>
              </button>
            }
            @if (rep.unreadable.length > 8) { <div class="hint">et {{ rep.unreadable.length - 8 }} autres.</div> }
          </div>
        }
      }

      @if (g && store.ui().repMode === 'lier') {
        <div class="hint bord">
          « {{ g.name }} » sera ajouté aux synonymes de l'article choisi, pour tout le carnet. La liste de
          courses portera alors le <b>nom de cet article</b> : ne rattachez que ce qui s'achète vraiment
          pareil (« gousse d'ail » et « ail »), et créez un article à part sinon.
        </div>
        <input class="input" [ngModel]="store.ui().repSearch" (ngModelChange)="store.patch({ repSearch: $event })"
               placeholder="Chercher un article…" />
        <div class="choix">
          @for (a of store.repairMatches(); track a.key) {
            <button class="art" (click)="store.repairLink(a.key)">
              <span class="art-n">{{ a.name }}</span><span class="art-r">{{ rayonName(a.rayon) }}</span>
            </button>
          } @empty {
            <div class="hint">Aucun article ne correspond. Créez-le plutôt.</div>
          }
        </div>
        <div class="modal-acts">
          <button class="btn btn-soft" (click)="store.patch({ repForm: '' })">Retour</button>
          <button class="btn btn-primary" (click)="store.repairPick(g.form, 'creer')">Créer l'article</button>
        </div>
      }

      @if (g && store.ui().repMode === 'creer') {
        <label class="field-label">Nom de l'article</label>
        <input class="input" [ngModel]="store.ui().repName" (ngModelChange)="store.patch({ repName: $event })" />
        <div class="hint">« {{ g.name }} » sera reconnu comme cet article dans tout le carnet.</div>

        <label class="field-label" style="margin-top:18px">Rayon</label>
        <div class="seg wrap">
          @for (r of rayons; track r.key) {
            <button [class.active]="store.ui().repRayon === r.key" (click)="store.patch({ repRayon: r.key })">{{ r.name }}</button>
          }
        </div>

        <label class="field-label" style="margin-top:18px">Allergènes</label>
        <div class="chips">
          @for (a of allergenes; track a.key) {
            <button class="chip" [class.on]="store.ui().repAllerg.includes(a.key)" (click)="store.toggleRepairAllerg(a.key)">{{ a.name }}</button>
          }
        </div>

        <button class="placard" [class.on]="store.ui().repPantry" (click)="store.patch({ repPantry: !store.ui().repPantry })">
          <span class="box">@if (store.ui().repPantry) { <f-icon name="check" [size]="13" color="#fff" [width]="3" /> }</span>
          <span>
            <b>Fond de placard</b>
            <span class="sub">Proposé lors d'une génération, mais écarté de la liste par défaut.</span>
          </span>
        </button>

        <div class="modal-acts">
          <button class="btn btn-soft" (click)="store.patch({ repForm: '' })">Retour</button>
          <button class="btn btn-primary" (click)="store.repairCreate()">Créer l'article</button>
        </div>
      }
    </f-modal>
  `,
  styles: [`
    .taux { margin-bottom: 18px; }
    .jauge { height: 8px; border-radius: 4px; background: var(--soft2); overflow: hidden; margin-bottom: 8px; }
    .jauge-in { height: 100%; background: var(--sage); border-radius: 4px; transition: width .3s; }
    .taux-txt { font-size: 13px; font-weight: 700; color: var(--ink2); }
    .taux-txt b { color: var(--ink); }

    .vide { display: flex; align-items: center; gap: 12px; background: var(--soft); border-radius: 14px; padding: 16px; font-size: 14px; font-weight: 700; color: var(--ink2); line-height: 1.45; }

    .grp { border-top: 1px solid var(--line); padding: 12px 0; }
    .grp-top { display: flex; align-items: baseline; gap: 10px; }
    .grp-name { flex: 1; min-width: 0; font-size: 15.5px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .grp-count { font-size: 12.5px; font-weight: 800; color: var(--ink3); flex: none; }
    .grp-ou { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 10px; }
    .lien { border: none; background: var(--soft); border-radius: 9px; padding: 4px 9px; font-family: var(--font-body); font-size: 12px; font-weight: 700; color: var(--ink2); cursor: pointer; }
    .lien:hover { color: var(--primary); }
    .reste { font-size: 12px; font-weight: 700; color: var(--ink3); align-self: center; }
    .grp-acts { display: flex; gap: 8px; }
    .grp-acts .btn { flex: 1; }

    .warnbox { background: var(--soft); border-radius: 14px; padding: 12px 14px; margin-top: 16px; }
    .grp-head { font-family: var(--font-display); font-size: 13px; font-weight: 700; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin: 6px 0 10px; }
    .hint.bord { background: var(--soft); border-radius: 12px; padding: 10px 12px; margin: 0 0 4px; }
    .hint b { color: var(--ink); }
    .ligne { display: flex; width: 100%; align-items: center; gap: 10px; border: none; background: none; border-top: 1px solid var(--line); padding: 9px 0; cursor: pointer; text-align: left; font-family: var(--font-body); }
    .l-raw { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .l-rec { font-size: 12px; font-weight: 700; color: var(--ink3); flex: none; }

    .choix { display: flex; flex-direction: column; margin: 10px 0 4px; max-height: 320px; overflow-y: auto; }
    .art { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: none; border-top: 1px solid var(--line); padding: 11px 2px; cursor: pointer; text-align: left; font-family: var(--font-body); }
    .art:hover { background: var(--soft); }
    .art-n { flex: 1; font-size: 14.5px; font-weight: 700; color: var(--ink); }
    .art-r { font-size: 12px; font-weight: 700; color: var(--ink3); }

    .seg.wrap { flex-wrap: wrap; }
    .chips { display: flex; flex-wrap: wrap; gap: 7px; }
    .chip { border: 2px solid var(--line2); background: transparent; color: var(--ink2); border-radius: 11px; padding: 6px 10px; font-family: var(--font-body); font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .chip.on { background: var(--honey); border-color: var(--honey); color: #fff; }

    .placard { display: flex; align-items: flex-start; gap: 11px; width: 100%; margin-top: 18px; border: 2px solid var(--line2); background: transparent; border-radius: 14px; padding: 12px; cursor: pointer; text-align: left; font-family: var(--font-body); }
    .placard.on { border-color: var(--sage); }
    .placard .box { width: 20px; height: 20px; flex: none; border-radius: 6px; border: 2px solid var(--line2); display: flex; align-items: center; justify-content: center; margin-top: 1px; }
    .placard.on .box { background: var(--sage); border-color: var(--sage); }
    .placard b { display: block; font-size: 14px; color: var(--ink); }
    .placard .sub { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.4; margin-top: 2px; }

    .modal-acts { display: flex; gap: 12px; margin-top: 22px; }
    .modal-acts .btn { flex: 1; }
  `],
})
export class RepairModal {
  store = inject(FoyerStore);
  readonly rayons = RAYONS;
  readonly allergenes = Object.entries(ALLERGENES).map(([key, name]) => ({ key, name }));

  rayonName(key: string): string { return RAYONS.find((r) => r.key === key)?.name ?? key; }
}
