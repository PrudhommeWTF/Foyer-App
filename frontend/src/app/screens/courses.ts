import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { ConfirmComponent } from '../shared/confirm';
import { LIST_ICONS, PALETTE } from '../core/constants';
import { RAYONS, normaliseName } from '../core/articles';
import { cap } from '../core/helpers';
import { searchArticles } from '../core/ingredient-repair';
import { Aisle, Rayon, ShopItem, ShopState } from '../core/models';

/**
 * Une suggestion d'ajout. `id` désigne un article déjà dans la liste active (le
 * choisir le décoche plutôt que d'en créer un doublon) ; sinon c'est un nom à
 * ajouter, connu du référentiel (`key` + `rayon`), déjà acheté (`aisleId` du
 * rayon mémorisé), ou libre.
 */
interface ShopSuggestion { name: string; key?: string; rayon?: Rayon; id?: string; checked?: boolean; aisleId?: string | null; }

interface ShopGroup { aisle: Aisle; toTake: ShopItem[]; checked: ShopItem[]; }

/**
 * Écran des courses, pensé pour le magasin avant le bureau : une colonne, des
 * cibles larges, une coche en un tap sans confirmation, et les articles pris
 * regroupés en bas plutôt que disparus (les retrouver est ce qu'on fait à la
 * caisse quand on doute d'en avoir pris un).
 */
@Component({
  selector: 'screen-courses',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent, ConfirmComponent],
  template: `
    <div class="screen-enter">
      <!-- Listes -->
      <div class="chips">
        <div class="chip-l" [class.active]="active() === 'all'"
             [style.background]="active() === 'all' ? '#8A7E74' : ''"
             [style.color]="active() === 'all' ? '#fff' : ''"
             (click)="store.patch({ activeShopList: 'all' })">
          <f-icon name="courses" [size]="16" [color]="active() === 'all' ? '#fff' : 'var(--ink2)'" />
          <span>Toutes</span>
          <span class="cnt" [style.color]="active() === 'all' ? 'rgba(255,255,255,.85)' : 'var(--ink3)'">{{ allCount() }}</span>
        </div>
        @for (l of lists(); track l.id) {
          <div class="chip-l" [class.active]="active() === l.id"
               [style.background]="active() === l.id ? l.color : ''"
               [style.color]="active() === l.id ? '#fff' : ''"
               (click)="store.patch({ activeShopList: l.id })">
            <f-icon [path]="LIST_ICONS[l.icon]" [size]="16" [color]="active() === l.id ? '#fff' : l.color" />
            <span>{{ l.name }}</span>
            <span class="cnt" [style.color]="active() === l.id ? 'rgba(255,255,255,.85)' : 'var(--ink3)'">{{ countFor(l.id) }}</span>
          </div>
        }
        <div class="chip-new" (click)="store.newShopList()">
          <f-icon name="plus" [size]="15" color="#E56B4E" [width]="2.6" /> Nouvelle liste
        </div>
        @if (store.weekHasMeals()) {
          <button class="chip-gen" (click)="store.prepareList(store.weekDays())" title="Ajoute les ingrédients des repas prévus cette semaine">
            <f-icon name="bolt" [size]="15" color="#fff" [width]="2.4" /> Générer depuis le planning des repas
          </button>
        }
      </div>

      <!-- État de la synchronisation. Silencieux quand tout va bien. -->
      @if (store.syncOffline() || store.shopPending()) {
        <div class="sync" [class.off]="store.syncOffline()">
          <f-icon [name]="store.syncOffline() ? 'x' : 'refresh'" [size]="15" [color]="store.syncOffline() ? '#C6492F' : 'var(--ink2)'" [width]="2.4" />
          @if (store.syncOffline()) {
            <span>Hors ligne. {{ store.shopPending() }} modification(s) en attente, elles partiront au retour du réseau.</span>
          } @else {
            <span>Envoi de {{ store.shopPending() }} modification(s)…</span>
          }
        </div>
      }

      <!-- En-tête de la liste active -->
      @if (activeList(); as al) {
        <div class="list-head">
          <div class="list-ic" [style.background]="al.color"><f-icon [path]="LIST_ICONS[al.icon]" [size]="18" color="#fff" /></div>
          <span class="list-name f-display">{{ al.name }}</span>
          <div class="head-acts">
            <button class="icon-btn sm" (click)="store.editShopList(al.id)" aria-label="Modifier la liste"><f-icon name="edit" [size]="16" color="var(--ink2)" /></button>
            <button class="icon-btn sm" (click)="store.patch({ shopListDelId: al.id })" aria-label="Supprimer la liste"><f-icon name="trash" [size]="16" color="#E56B4E" /></button>
          </div>
        </div>
      }

      <!-- Ajout rapide, placé sous le nom de la liste comme la saisie d'une
           tâche : le champ, puis suggestion ou Entrée. Au focus, les attributs
           (quantité, rayon, liste) se règlent dessous, sans ouvrir la fiche. -->
      <div class="quick">
        <input class="input" placeholder="Ajouter un article…" enterkeyhint="done"
               autocomplete="off" autocapitalize="sentences"
               [ngModel]="store.ui().newShop" (ngModelChange)="store.patch({ newShop: $event })"
               (focus)="qaOpen()" (keydown.enter)="addQuick()" (keydown.escape)="qaClose()">
        <button class="add-btn" (click)="addQuick()" aria-label="Ajouter">
          <f-icon name="plus" [size]="22" color="#fff" [width]="2.6" />
        </button>
      </div>
      @if (suggestions().length) {
        <div class="sugg">
          @for (sg of suggestions(); track sg.name) {
            <button class="sugg-chip" [class.known]="sg.key" (click)="addSuggestion(sg)">
              @if (sg.key) { <span class="s-dot" [style.background]="suggAisleColor(sg)"></span> }
              {{ sg.name }}
            </button>
          }
        </div>
      }

      @if (qaExpanded()) {
        <div class="qa-more">
          <div class="qa-field qa-qty">
            <span class="field-label">Quantité</span>
            <input class="input" placeholder="x1" enterkeyhint="done" autocomplete="off"
                   [ngModel]="qaQty()" (ngModelChange)="qaQty.set($event)" (keydown.enter)="addQuick()" (keydown.escape)="qaClose()">
          </div>
          <div class="qa-field">
            <span class="field-label">Rayon</span>
            <div class="seg-wrap qa-seg">
              @for (a of store.aislesInOrder(); track a.id) {
                <div class="seg-opt" [class.on]="qaAisle() === a.id" (click)="pickAisle(a.id)">
                  <span class="s-dot" [style.background]="a.color"></span>{{ a.name }}
                </div>
              }
            </div>
          </div>
          <div class="qa-field">
            <span class="field-label">Liste</span>
            <div class="seg-wrap qa-seg">
              @for (l of lists(); track l.id) {
                <div class="seg-opt" [class.on]="qaList() === l.id" (click)="qaList.set(l.id)">
                  <span class="s-dot" [style.background]="l.color"></span>{{ l.name }}
                </div>
              }
            </div>
          </div>
        </div>
      }

      <div class="by-head">
        <span class="overline">Par rayon</span>
        <span class="acts">
          @if (active() !== 'all') {
            <span class="mini-link" (click)="store.addShoppingTask()">
              <f-icon name="checklist" [size]="14" color="var(--ink2)" [width]="2.4" />
              {{ store.shoppingTask(active()) ? 'Dans les tâches' : 'En tâche' }}
            </span>
          }
          <!-- Un seul menu « Affichage » : la préférence d'appareil (masquer les
               cochés), le geste destructif (les supprimer), et le reste. -->
          <div class="menu-wrap">
            <button class="mini-link" (click)="menuOpen.set(!menuOpen())" [attr.aria-expanded]="menuOpen()" aria-label="Affichage">
              <f-icon name="settings" [size]="15" color="var(--ink2)" [width]="2.2" /> Affichage
            </button>
            @if (menuOpen()) {
              <div class="menu-back" (click)="menuOpen.set(false)"></div>
              <div class="menu" role="menu">
                <button class="menu-item" role="menuitemcheckbox" [attr.aria-checked]="store.shopHideChecked()" (click)="store.toggleShopHideChecked()">
                  <f-icon [name]="store.shopHideChecked() ? 'eyeOff' : 'eye'" [size]="16" color="var(--ink2)" [width]="2.2" />
                  Masquer les articles cochés
                  @if (store.shopHideChecked()) { <f-icon name="check" [size]="15" color="var(--sage)" [width]="3" class="menu-on" /> }
                </button>
                <button class="menu-item" [disabled]="!checkedTotal()" (click)="menuOpen.set(false); askClear.set(true)">
                  <f-icon name="trash" [size]="16" color="#E56B4E" [width]="2.2" /> Supprimer les articles cochés
                  @if (checkedTotal()) { <span class="menu-cnt">{{ checkedTotal() }}</span> }
                </button>
                <div class="menu-sep"></div>
                <button class="menu-item" (click)="menuOpen.set(false); store.patch({ aisleOrderOpen: true })"><f-icon name="planning" [size]="16" color="var(--ink2)" [width]="2.2" /> Ordre des rayons</button>
                <button class="menu-item" (click)="menuOpen.set(false); store.newAisle()"><f-icon name="plus" [size]="16" color="#E56B4E" [width]="2.6" /> Nouveau rayon</button>
                <button class="menu-item" (click)="menuOpen.set(false); store.exportShoppingCsv()"><f-icon name="export" [size]="16" color="var(--ink2)" [width]="2.2" /> Exporter</button>
              </div>
            }
          </div>
        </span>
      </div>

      <!-- Tout coché et masqué : on le dit, et on propose de les revoir. -->
      @if (scope().length && !toTakeTotal() && store.shopHideChecked()) {
        <div class="all-done">
          <span>Tout est coché.</span>
          <button class="mini-link" (click)="store.toggleShopHideChecked()"><f-icon name="eye" [size]="14" color="var(--ink2)" [width]="2.2" /> Afficher les cochés</button>
        </div>
      }

      <!-- La liste, par rayon. Un article coché reste dans son rayon, en bas,
           grisé et barré : il n'est pas déplacé dans un panier. -->
      @for (g of groups(); track g.aisle.id) {
        <div class="cat" [style.border-left]="'4px solid ' + g.aisle.color">
          <div class="cat-head">
            <button class="cat-name-btn" (click)="store.toggleAisleCollapse(g.aisle.id)" [attr.aria-expanded]="!store.aisleCollapsed(g.aisle.id)">
              <f-icon [name]="store.aisleCollapsed(g.aisle.id) ? 'chevronRight' : 'chevronDown'" [size]="15" color="var(--ink3)" [width]="2.4" />
              <span class="dot" [style.background]="g.aisle.color"></span>
              <span class="cat-label">{{ g.aisle.name }}</span>
            </button>
            <span class="cat-counts">
              @if (g.toTake.length) { <span class="cat-n">{{ g.toTake.length }} à prendre</span> }
            </span>
          </div>
          @if (!store.aisleCollapsed(g.aisle.id)) {
            @for (it of g.toTake; track it.id) {
              <div class="row" [class.unavail]="it.state === 'indisponible'">
                <button class="tick" [class.unavail]="it.state === 'indisponible'" (click)="store.toggleShop(it.id)"
                        [attr.aria-label]="'Cocher ' + it.name">
                  @if (it.state === 'indisponible') { <f-icon name="x" [size]="15" color="#C6492F" [width]="3" /> }
                </button>
                <button class="row-body" (click)="store.editShop(it.id)">
                  @if (store.photoUrl(it.photoId); as ph) { <span class="s-thumb" [style.background-image]="'url(' + ph + ')'"></span> }
                  <span class="s-name">{{ it.name }}</span>
                  @if (it.state === 'indisponible') { <span class="s-flag">introuvable</span> }
                  @if (it.qty) { <span class="s-qty">{{ it.qty }}</span> }
                </button>
                @if (whoColor(it); as c) { <span class="who" [style.background]="c" [title]="whoName(it)"></span> }
              </div>
              <!-- Rayon « À trier » : un tap range l'article et apprend son rayon. -->
              @if (isTriage(g.aisle)) {
                <div class="tri-chips">
                  @for (a of otherAisles(); track a.id) {
                    <button class="tri-chip" (click)="store.rangeShopItem(it.id, a.id)">
                      <span class="s-dot" [style.background]="a.color"></span>{{ a.name }}
                    </button>
                  }
                </div>
              }
            }
            @for (it of g.checked; track it.id) {
              <div class="row done">
                <button class="tick on" (click)="store.toggleShop(it.id)" [attr.aria-label]="'Décocher ' + it.name">
                  <f-icon name="check" [size]="14" color="#fff" [width]="3.4" />
                </button>
                <button class="row-body" (click)="store.editShop(it.id)">
                  <span class="s-name done">{{ it.name }}</span>
                  @if (it.qty) { <span class="s-qty">{{ it.qty }}</span> }
                </button>
                @if (whoColor(it); as c) { <span class="who" [style.background]="c" [title]="whoName(it)"></span> }
              </div>
            }
          }
        </div>
      } @empty {
        <div class="empty">Ajoutez un premier article.</div>
      }

    </div>

    <!-- Article -->
    @if (store.ui().showShop) {
      <f-modal [title]="store.ui().shEditId ? 'Modifier l\\'article' : 'Nouvel article'" [maxWidth]="440" (close)="store.patch({ showShop: false })">
        <div class="modal-row">
          <div class="grow">
            <div class="field-label">Article</div>
            <input class="input" placeholder="Ex : Pommes" [ngModel]="store.ui().shTitle" (ngModelChange)="store.patch({ shTitle: $event })" (keydown.enter)="store.saveShop()">
          </div>
          <div class="qty-f">
            <div class="field-label">Quantité</div>
            <input class="input" placeholder="x1" [ngModel]="store.ui().shQty" (ngModelChange)="store.patch({ shQty: $event })" (keydown.enter)="store.saveShop()">
          </div>
        </div>

        <div class="field-label">État</div>
        <div class="seg mb">
          @for (st of states; track st.k) {
            <button class="grow" [class.active]="store.ui().shState === st.k" (click)="store.patch({ shState: st.k })">{{ st.label }}</button>
          }
        </div>

        <div class="field-label">Rayon</div>
        <div class="seg-wrap">
          @for (a of store.aislesInOrder(); track a.id) {
            <div class="seg-opt" [class.on]="store.ui().shAisleId === a.id" (click)="store.patch({ shAisleId: a.id })">
              <span class="s-dot" [style.background]="a.color"></span>{{ a.name }}
            </div>
          }
        </div>
        <div class="field-label">Liste</div>
        <div class="seg-wrap">
          @for (l of lists(); track l.id) {
            <div class="seg-opt" [class.on]="store.ui().shListId === l.id" (click)="store.patch({ shListId: l.id })">
              <span class="s-dot" [style.background]="l.color"></span>{{ l.name }}
            </div>
          }
        </div>

        <div class="field-label">Photo <span class="opt">(facultatif)</span></div>
        @if (store.photoUrl(store.ui().shPhotoId); as ph) {
          <div class="photo-preview">
            <div class="photo-img" [style.background-image]="'url(' + ph + ')'"></div>
            <button class="btn btn-soft" (click)="store.removeShopPhoto()">
              <f-icon name="x" [size]="15" color="var(--ink2)" /> Retirer la photo
            </button>
          </div>
        } @else {
          <label class="photo-upload" [class.busy]="store.ui().shPhotoBusy">
            <input type="file" accept="image/*" [disabled]="store.ui().shPhotoBusy" (change)="onShopPhoto($event)">
            <f-icon name="upload" [size]="18" color="var(--ink2)" />
            <span>{{ store.ui().shPhotoBusy ? 'Envoi…' : 'Ajouter une photo' }}</span>
          </label>
        }

        <div class="modal-actions">
          @if (store.ui().shEditId) {
            <button class="icon-btn del-btn" (click)="store.delShop()" aria-label="Supprimer"><f-icon name="trash" [size]="18" color="#E56B4E" /></button>
          }
          <button class="btn btn-soft grow" (click)="store.patch({ showShop: false })">Annuler</button>
          <button class="btn btn-primary grow2" (click)="store.saveShop()">Enregistrer</button>
        </div>
      </f-modal>
    }

    <!-- Ordre des rayons -->
    @if (store.ui().aisleOrderOpen) {
      <f-modal title="Ordre des rayons" [maxWidth]="440" (close)="store.patch({ aisleOrderOpen: false })">
        <div class="hint mb">Rangez les rayons dans l'ordre où vous les parcourez en magasin. La liste de courses suit cet ordre.</div>
        <div class="order-list">
          @for (a of store.aislesInOrder(); track a.id; let i = $index, last = $last) {
            <div class="order-row">
              <span class="s-dot" [style.background]="a.color"></span>
              <span class="order-name">{{ a.name }}</span>
              <button class="icon-btn sm" (click)="store.editAisle(a.id)" aria-label="Modifier le rayon" title="Modifier">
                <f-icon name="edit" [size]="15" color="var(--ink2)" [width]="2.2" />
              </button>
              <button class="icon-btn sm" [disabled]="i === 0" (click)="store.moveAisle(a.id, -1)" aria-label="Monter">
                <f-icon name="chevronLeft" [size]="16" color="var(--ink2)" [width]="2.4" class="up" />
              </button>
              <button class="icon-btn sm" [disabled]="last" (click)="store.moveAisle(a.id, 1)" aria-label="Descendre">
                <f-icon name="chevronRight" [size]="16" color="var(--ink2)" [width]="2.4" class="down" />
              </button>
            </div>
          }
        </div>
        <div class="modal-actions" style="margin-top:18px">
          <button class="btn btn-primary grow" (click)="store.patch({ aisleOrderOpen: false })">Terminé</button>
        </div>
      </f-modal>
    }

    <!-- Liste -->
    @if (store.ui().shopListForm) {
      <f-modal [title]="store.ui().clEditId ? 'Modifier la liste' : 'Nouvelle liste'" [maxWidth]="460" (close)="store.patch({ shopListForm: false })">
        <div class="field-label">Nom de la liste</div>
        <input class="input mb" placeholder="Ex : Drive, Boulangerie…" [ngModel]="store.ui().clName" (ngModelChange)="store.patch({ clName: $event })">
        <div class="field-label">Couleur</div>
        <div class="swatch-row mb">
          @for (c of PALETTE; track c) {
            <div class="swatch" [style.background]="c" [style.box-shadow]="store.ui().clColor === c ? '0 0 0 3px var(--surface), 0 0 0 5px ' + c : ''" (click)="store.patch({ clColor: c })"></div>
          }
        </div>
        <div class="field-label">Icône</div>
        <div class="icon-grid mb">
          @for (k of iconKeys; track k) {
            <div class="icon-cell" [style.background]="store.ui().clIcon === k ? store.ui().clColor : 'var(--soft2)'" (click)="store.patch({ clIcon: k })">
              <f-icon [path]="LIST_ICONS[k]" [size]="20" [color]="store.ui().clIcon === k ? '#fff' : 'var(--ink2)'" />
            </div>
          }
        </div>
        <div class="modal-actions">
          <button class="btn btn-soft grow" (click)="store.patch({ shopListForm: false })">Annuler</button>
          <button class="btn btn-primary grow2" (click)="store.saveShopList()">Enregistrer</button>
        </div>
      </f-modal>
    }

    <!-- Rayon -->
    @if (store.ui().aiForm) {
      <f-modal [title]="store.ui().aiEditId ? 'Modifier le rayon' : 'Nouveau rayon'" [maxWidth]="440" (close)="store.patch({ aiForm: false })">
        <div class="field-label">Nom du rayon</div>
        <input class="input mb" placeholder="Ex : Boulangerie, Surgelés…" [ngModel]="store.ui().aiName" (ngModelChange)="store.patch({ aiName: $event })">
        <div class="field-label">Couleur</div>
        <div class="swatch-row mb">
          @for (c of PALETTE; track c) {
            <div class="swatch" [style.background]="c" [style.box-shadow]="store.ui().aiColor === c ? '0 0 0 3px var(--surface), 0 0 0 5px ' + c : ''" (click)="store.patch({ aiColor: c })"></div>
          }
        </div>
        <div class="field-label">Type de rayon</div>
        <div class="hint mb2">Sert à ranger automatiquement les ingrédients générés depuis les repas. Facultatif : sans lui, le nom du rayon suffit souvent.</div>
        <div class="seg-wrap">
          <div class="seg-opt" [class.on]="!store.ui().aiKind" (click)="store.patch({ aiKind: '' })">Aucun</div>
          @for (r of RAYONS; track r.key) {
            <div class="seg-opt" [class.on]="store.ui().aiKind === r.key" (click)="store.patch({ aiKind: r.key })">{{ r.name }}</div>
          }
        </div>
        <div class="modal-actions">
          @if (store.ui().aiEditId && store.ui().aiEditId !== store.defaultAisleId()) {
            <button class="icon-btn del-btn" (click)="askDeleteAisle()" aria-label="Supprimer le rayon"><f-icon name="trash" [size]="18" color="#E56B4E" /></button>
          }
          <button class="btn btn-soft grow" (click)="store.patch({ aiForm: false })">Annuler</button>
          <button class="btn btn-primary grow2" (click)="store.saveAisle()">Enregistrer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().shopListDelId) {
      <f-confirm title="Supprimer cette liste ?" (cancel)="store.patch({ shopListDelId: null })" (confirm)="store.confirmShopListDel()">
        Cette liste et ses articles seront supprimés. Cette action est définitive.
      </f-confirm>
    }

    @if (store.ui().aisleDelId) {
      <f-confirm title="Supprimer ce rayon ?" (cancel)="store.patch({ aisleDelId: null })" (confirm)="store.confirmAisleDel()">
        Ce rayon sera supprimé. Ses articles passeront dans le rayon de repli.
      </f-confirm>
    }

    <!-- Seul geste destructif de l'écran, donc le seul à confirmer. -->
    @if (askClear()) {
      <f-confirm title="Supprimer les articles cochés ?" confirmLabel="Supprimer" (cancel)="askClear.set(false)" (confirm)="confirmClear()">
        {{ checkedTotal() }} article{{ checkedTotal() > 1 ? 's' : '' }} coché{{ checkedTotal() > 1 ? 's' : '' }} {{ checkedTotal() > 1 ? 'seront supprimés' : 'sera supprimé' }}. {{ checkedTotal() > 1 ? 'Ils resteront proposés' : 'Il restera proposé' }} à la saisie.
      </f-confirm>
    }
  `,
  styles: [`
    .chips { display: flex; gap: 9px; flex-wrap: wrap; align-items: center; margin-bottom: 16px; }
    .chip-l { display: flex; align-items: center; gap: 8px; padding: 11px 15px; border-radius: var(--r-chip); font-size: 13.5px; font-weight: 800; cursor: pointer; background: var(--surface); color: var(--ink2); box-shadow: 0 6px 14px -12px rgba(90,60,40,.6); }
    .chip-l .cnt { font-size: 12px; }
    .chip-new { display: flex; align-items: center; gap: 6px; padding: 11px 14px; border-radius: var(--r-chip); font-size: 13px; font-weight: 800; cursor: pointer; color: #E56B4E; border: 2px dashed var(--line2); }

    /* Ajout rapide : le champ et son bouton font 52 px de haut, utilisables au pouce. */
    .quick { display: flex; gap: 10px; margin-bottom: 10px; }
    .quick .input { flex: 1; min-height: 52px; font-size: 16px; }
    .add-btn { width: 52px; height: 52px; flex: none; border: none; border-radius: 15px; background: var(--primary); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .sugg { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
    .sugg-chip { display: inline-flex; align-items: center; gap: 7px; border: none; background: var(--soft2); color: var(--ink2); border-radius: 12px; padding: 9px 14px; font-size: 13.5px; font-weight: 800; cursor: pointer; }
    .sugg-chip.known { color: var(--ink); }

    .sync { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 13px; background: var(--soft2); color: var(--ink2); font-size: 12.5px; font-weight: 700; margin-bottom: 14px; }
    .sync.off { background: #FCE9E3; color: #C6492F; }

    .list-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .list-ic { width: 34px; height: 34px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex: none; }
    .list-name { font-size: 19px; font-weight: 700; color: var(--ink); flex: 1; min-width: 0; }
    .head-acts { display: flex; gap: 6px; }

    .by-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .by-head .acts { display: flex; gap: 14px; align-items: center; }
    .mini-link { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 800; color: var(--ink2); cursor: pointer; border: none; background: none; font: inherit; padding: 0; }

    /* Menu « Affichage » : un seul popover, aligné à droite sous son bouton. */
    .menu-wrap { position: relative; }
    .menu-back { position: fixed; inset: 0; z-index: 40; }
    .menu { position: absolute; right: 0; top: calc(100% + 8px); z-index: 41; min-width: 250px; background: var(--surface); border-radius: 14px; padding: 6px; box-shadow: 0 18px 44px -16px rgba(90,60,40,.55); border: 1px solid var(--line); display: flex; flex-direction: column; }
    .menu-item { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: none; cursor: pointer; font: inherit; font-size: 14px; font-weight: 700; color: var(--ink); text-align: left; padding: 11px 12px; border-radius: 10px; }
    .menu-item:hover { background: var(--soft); }
    .menu-item[disabled] { opacity: .4; cursor: default; }
    .menu-item .menu-on { margin-left: auto; }
    .menu-item .menu-cnt { margin-left: auto; font-size: 12px; font-weight: 800; color: var(--ink3); background: var(--soft2); border-radius: 7px; padding: 1px 8px; }
    .menu-sep { height: 1px; background: var(--line); margin: 5px 8px; }

    .all-done { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-radius: 13px; background: var(--soft2); color: var(--ink2); font-size: 13.5px; font-weight: 800; margin-bottom: 14px; }

    .cat { background: var(--surface); border-radius: var(--r-card); padding: 12px 14px 6px; box-shadow: 0 12px 28px -20px rgba(90,60,40,.5); margin-bottom: 14px; }
    .cat-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
    .cat-name-btn { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; border: none; background: transparent; padding: 4px 0; cursor: pointer; font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; text-align: left; }
    .cat-name-btn .dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
    .cat-label { min-width: 0; overflow-wrap: anywhere; }
    .cat-counts { display: flex; align-items: center; gap: 4px; flex: none; }
    .cat-n { font-size: 12px; font-weight: 800; color: var(--ink3); white-space: nowrap; }

    /* La ligne fait 52 px : la coche et le corps sont deux cibles distinctes,
       assez larges pour être visées d'une main dans un magasin. */
    .row { display: flex; align-items: center; gap: 12px; min-height: 52px; }
    .row + .row { border-top: 1px solid var(--line); }
    .row.done { opacity: .7; }
    /* Étiquette « introuvable » dans la ligne, discrète, non cochée. */
    .s-flag { flex: none; font-size: 11px; font-weight: 800; color: #C6492F; background: #FCE9E3; border-radius: 6px; padding: 1px 7px; }
    /* Puces de rangement sous un article « À trier » : une seule rangée qui
       défile à l'horizontale, pour ne pas pousser la liste hors de vue quand le
       foyer a beaucoup de rayons. Indentée sous le libellé. */
    .tri-chips { display: flex; flex-wrap: nowrap; gap: 6px; padding: 0 0 10px 42px; margin-top: -2px; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .tri-chips::-webkit-scrollbar { display: none; }
    .tri-chip { display: inline-flex; align-items: center; gap: 5px; flex: none; white-space: nowrap; border: none; background: var(--soft2); color: var(--ink2); border-radius: 9px; padding: 6px 10px; font-size: 12.5px; font-weight: 800; cursor: pointer; font-family: inherit; }
    .tick { width: 30px; height: 30px; flex: none; border-radius: 9px; border: 2px solid var(--line2); background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
    .tick.on { background: var(--sage); border-color: var(--sage); }
    .tick.unavail { border-color: #E9B4A6; background: #FCE9E3; }
    .row-body { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; border: none; background: none; padding: 14px 0; text-align: left; cursor: pointer; font: inherit; }
    .s-name { flex: 1; min-width: 0; font-size: 15.5px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .s-name.done { color: var(--ink3); text-decoration: line-through; }
    .row.unavail .s-name { color: #C6492F; }
    .s-qty { font-size: 13px; font-weight: 800; color: var(--ink3); flex: none; }
    /* Vignette du produit dans la liste, et sélecteur de photo dans la fiche. */
    .s-thumb { flex: none; width: 30px; height: 30px; border-radius: 8px; background-size: cover; background-position: center; box-shadow: 0 2px 6px -3px rgba(90,60,40,.6); }
    .opt { font-weight: 700; color: var(--ink3); text-transform: none; letter-spacing: 0; }
    .photo-upload { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 12px; background: var(--soft); font-size: 13.5px; font-weight: 800; color: var(--ink2); cursor: pointer; margin-bottom: 6px; }
    .photo-upload input { display: none; }
    .photo-upload.busy { opacity: .6; pointer-events: none; }
    .photo-preview { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
    .photo-img { width: 64px; height: 64px; border-radius: 12px; background-size: cover; background-position: center; flex: none; box-shadow: 0 6px 14px -8px rgba(90,60,40,.6); }
    .who { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    .empty { color: var(--ink2); font-weight: 700; font-size: 14px; padding: 24px 0; }

    /* Bouton « Générer », en tête à droite de « Nouvelle liste » : une pastille
       pleine (vert repas) pour se distinguer des puces de liste et de l'action
       en pointillés « Nouvelle liste ». */
    .chip-gen { display: inline-flex; align-items: center; gap: 7px; padding: 11px 15px; border: none; border-radius: var(--r-chip); font-size: 13px; font-weight: 800; cursor: pointer; color: #fff; background: linear-gradient(135deg,#7A9B76,#5F7E5C); box-shadow: 0 8px 18px -12px rgba(95,126,92,.7); font-family: inherit; }

    /* Le repli d'attributs sous le champ d'ajout, révélé au focus. */
    .qa-more { display: flex; flex-direction: column; gap: 4px; padding: 14px; margin-bottom: 14px; background: var(--surface); border-radius: var(--r-card); box-shadow: 0 12px 28px -20px rgba(90,60,40,.5); }
    .qa-field { display: flex; flex-direction: column; }
    .qa-qty .input { max-width: 140px; }
    /* Marge basse réduite : ici les rangées s'enchaînent, contrairement à la fiche. */
    .qa-seg { margin-bottom: 8px; }

    .order-list { display: flex; flex-direction: column; gap: 8px; }
    .order-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 13px; background: var(--soft); }
    .order-name { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .order-row .icon-btn[disabled] { opacity: .3; }
    .up { transform: rotate(90deg); }
    .down { transform: rotate(90deg); }
    .hint { font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.45; }
    .mb2 { margin-bottom: 10px; }

    .modal-row { display: flex; gap: 12px; margin-bottom: 16px; }
    .modal-row .grow { flex: 1; }
    .qty-f { width: 110px; }
    .mb { margin-bottom: 20px; }
    .seg .grow { flex: 1; }
    .seg-wrap { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 22px; }
    .seg-opt { display: flex; align-items: center; gap: 7px; padding: 11px 15px; border-radius: 11px; font-size: 13.5px; font-weight: 800; cursor: pointer; background: var(--soft2); color: var(--ink2); border: 2px solid transparent; }
    .seg-opt.on { background: var(--primary); color: #fff; }
    .s-dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
    .icon-grid { display: flex; flex-wrap: wrap; gap: 9px; }
    .icon-cell { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .modal-actions { display: flex; gap: 12px; align-items: center; }
    .modal-actions .grow { flex: 1; }
    .modal-actions .grow2 { flex: 1.4; }
    .del-btn { width: 50px; height: 50px; flex: none; border-radius: 13px; background: var(--soft2); }

    /* Sur large écran, la liste reste une colonne lisible plutôt que de s'étirer. */
    @media (min-width: 861px) {
      :host { display: block; max-width: 760px; }
    }
  `],
})
export class CoursesScreen {
  store = inject(FoyerStore);
  d = this.store.d;

  readonly LIST_ICONS = LIST_ICONS;
  readonly RAYONS = RAYONS;
  readonly PALETTE = PALETTE;
  readonly iconKeys = Object.keys(LIST_ICONS);
  // Le sélecteur d'état de la fiche : c'est là qu'on marque « introuvable », pas
  // par un geste sur la ligne (qui ne fait que cocher). « panier » reste la
  // valeur en base, lue « coché » à l'écran.
  readonly states: { k: ShopState; label: string }[] = [
    { k: 'a-prendre', label: 'À prendre' },
    { k: 'panier', label: 'Coché' },
    { k: 'indisponible', label: 'Introuvable' },
  ];

  /** Menu « Affichage » ouvert. Éphémère, propre à ce composant. */
  readonly menuOpen = signal(false);
  /** Confirmation « Supprimer les cochés » ouverte. */
  readonly askClear = signal(false);

  active = computed(() => this.store.ui().activeShopList);
  lists = computed(() => this.d().shopLists);
  allCount = computed(() => this.d().shop.filter((x) => x.state === 'a-prendre').length);
  activeList = computed(() => { const a = this.active(); return a === 'all' ? null : this.d().shopLists.find((l) => l.id === a) ?? null; });

  scope = computed(() => { const a = this.active(); return a === 'all' ? this.d().shop : this.d().shop.filter((x) => x.listId === a); });

  /**
   * La liste par rayon, dans l'ordre des allées. Chaque rayon porte ses articles
   * à prendre (non cochés, introuvables compris) puis, en bas, ses cochés. Les
   * cochés sont masqués selon la préférence d'appareil (menu « Affichage ») : un
   * rayon dont tout est coché disparaît alors de la vue, plutôt qu'un en-tête vide.
   */
  groups = computed<ShopGroup[]>(() => {
    const hide = this.store.shopHideChecked();
    const scope = this.scope();
    return this.store.aislesInOrder().map((aisle) => {
      const inAisle = scope.filter((x) => x.aisleId === aisle.id);
      const toTake = inAisle.filter((x) => x.state !== 'panier');
      const checked = hide ? [] : inAisle.filter((x) => x.state === 'panier');
      return { aisle, toTake, checked };
    }).filter((g) => g.toTake.length || g.checked.length);
  });

  /** Nombre d'articles encore à prendre (non cochés), toutes allées de la vue. */
  toTakeTotal = computed(() => this.scope().filter((x) => x.state !== 'panier').length);
  /** Nombre d'articles cochés de la vue : ce que « Supprimer les cochés » emporte. */
  checkedTotal = computed(() => this.scope().filter((x) => x.state === 'panier').length);

  /** Le rayon « À trier » (repli) : ses lignes gagnent des puces de rangement. */
  isTriage(aisle: Aisle): boolean { return aisle.id === this.store.defaultAisleId(); }
  /** Les rayons où ranger un article « à trier » : tous sauf le repli lui-même. */
  otherAisles = computed<Aisle[]>(() => this.store.aislesInOrder().filter((a) => a.id !== this.store.defaultAisleId()));
  /** Supprime les cochés de la vue (liste active, ou toutes si « Toutes »). */
  confirmClear(): void {
    this.askClear.set(false);
    const a = this.active();
    if (a === 'all') for (const l of this.lists()) this.store.clearPicked(l.id);
    else this.store.clearPicked(a);
  }

  /**
   * Suggestions dès la première lettre, dans cet ordre : les articles de la liste
   * (cochés compris, pour en décocher un plutôt que d'en créer un doublon), puis
   * la mémoire des noms déjà achetés (ce que le foyer achète vraiment passe avant
   * ce que la base connaît), puis le référentiel intégré. Cinq puces au plus.
   */
  suggestions = computed<ShopSuggestion[]>(() => {
    const nq = normaliseName(this.store.ui().newShop);
    if (!nq) return [];
    const seen = new Set<string>();
    const out: ShopSuggestion[] = [];
    // Rend vrai quand la liste est pleine, pour arrêter tôt.
    const add = (s: ShopSuggestion, key: string): boolean => {
      if (seen.has(key)) return false;
      seen.add(key);
      out.push(s);
      return out.length >= 5;
    };
    // 1) Les articles de la liste active (cochés compris).
    for (const it of this.scope()) {
      const nn = normaliseName(it.name);
      if (!nn.includes(nq)) continue;
      if (add({ name: it.name, id: it.id, checked: it.state === 'panier' }, nn)) return out;
    }
    // 2) La mémoire des noms déjà achetés. Le rayon mémorisé n'est repris que s'il existe encore.
    for (const e of Object.values(this.d().shopMemory || {})) {
      const nn = normaliseName(e.name);
      if (!nn.includes(nq)) continue;
      const aisleId = e.aisleId && this.d().aisles.some((a) => a.id === e.aisleId) ? e.aisleId : null;
      if (add({ name: cap(e.name), key: e.art || undefined, aisleId }, nn)) return out;
    }
    // 3) Le référentiel : base intégrée + ce que le foyer a appris.
    for (const a of searchArticles(this.store.articleIndex(), this.d().articles || [], this.store.ui().newShop.trim(), 8)) {
      if (add({ name: cap(a.name), key: a.key, rayon: a.rayon }, normaliseName(a.name))) return out;
    }
    return out;
  });

  /** Couleur du rayon où atterrira un article connu : l'aperçu de l'info complétée sur la puce. */
  suggAisleColor(sg: ShopSuggestion): string {
    const id = this.store.resolveAisleForName(sg.name);
    return this.d().aisles.find((a) => a.id === id)?.color || 'var(--ink3)';
  }

  // Repli d'attributs de l'ajout rapide (quantité, rayon, liste), révélé quand
  // le champ prend le focus, comme la saisie d'une tâche. L'état vit dans le
  // composant : il est éphémère et ne concerne que cette saisie en cours.
  readonly qaFocused = signal(false);
  readonly qaQty = signal('');
  readonly qaList = signal('');
  /** Rayon forcé à la main, ou `null` : dans ce cas on suit ce que le nom évoque. */
  readonly qaAisleOverride = signal<string | null>(null);
  /** Le rayon retenu : le choix manuel, sinon celui déduit du nom (référentiel + appris). */
  readonly qaAisle = computed(() => this.qaAisleOverride() ?? this.store.resolveAisleForName(this.store.ui().newShop));
  /** Ouvert tant que le champ est actif ou qu'un article est en train d'être saisi. */
  readonly qaExpanded = computed(() => this.qaFocused() || !!this.store.ui().newShop.trim());

  /** Focus du champ : on déplie et on garnit la liste de sa valeur par défaut. */
  qaOpen(): void {
    if (!this.qaList()) this.qaList.set(this.store.activeShopListId());
    this.qaFocused.set(true);
  }
  qaClose(): void { this.qaFocused.set(false); this.qaAisleOverride.set(null); }
  pickAisle(id: string): void { this.qaAisleOverride.set(id); }

  /**
   * Ajoute l'article au rayon retenu (choisi ou déduit du nom) et à la liste. Un
   * rayon choisi à la main est retenu pour ce nom, comme le module Finances
   * retient la catégorie d'un libellé. On vide le nom, la quantité et le choix de
   * rayon (le suivant se déduira de son propre nom), la liste reste.
   */
  addQuick(): void {
    const name = this.store.ui().newShop.trim();
    if (!name) return;
    // Un nom déjà dans la liste visée ne crée pas de doublon : coché, on le
    // décoche ; à prendre, on le dit et on ne touche à rien.
    const listId = this.qaList() || this.store.activeShopListId();
    const existing = this.d().shop.find((x) => x.listId === listId && normaliseName(x.name) === normaliseName(name));
    if (existing) { this.toggleExisting(existing.id); return; }
    this.commitAdd(name);
  }
  /** Choisir une suggestion : un article de la liste se décoche, un nom s'ajoute. */
  addSuggestion(sg: ShopSuggestion): void {
    if (sg.id) { this.toggleExisting(sg.id); return; }
    this.commitAdd(sg.name, sg.key, sg.aisleId);
  }

  /** Décoche un article déjà présent, ou signale qu'il est déjà à prendre. */
  private toggleExisting(id: string): void {
    const it = this.d().shop.find((x) => x.id === id);
    if (it) {
      if (it.state === 'panier') { this.store.setShopState(id, 'a-prendre'); this.store.toast(it.name + ' remis dans la liste'); }
      else this.store.toast('Déjà dans la liste');
    }
    this.clearQuick();
  }

  private commitAdd(name: string, art?: string, aisleId?: string | null): void {
    const forced = this.qaAisleOverride();
    const aisle = forced ?? aisleId ?? this.store.resolveAisleForName(name);
    if (this.store.addShop(name, { qty: this.qaQty(), aisleId: aisle, listId: this.qaList() || undefined, art })) {
      if (forced) this.store.learnAisle(name, forced);
      this.clearQuick();
    }
  }

  private clearQuick(): void {
    this.store.patch({ newShop: '' });
    this.qaQty.set('');
    this.qaAisleOverride.set(null);
  }

  /** Ferme la fiche du rayon et demande confirmation de sa suppression. */
  askDeleteAisle(): void { const id = this.store.ui().aiEditId; if (id) this.store.patch({ aiForm: false, aisleDelId: id }); }

  countFor(id: string): number { return this.d().shop.filter((x) => x.listId === id && x.state === 'a-prendre').length; }

  whoColor(it: ShopItem): string | null { return it.by ? this.store.memberColor(it.by) : null; }
  whoName(it: ShopItem): string { return it.by ? 'Coché par ' + this.store.memberName(it.by) : ''; }

  /** Une photo choisie pour l'article en cours : on la téléverse et on la retient. */
  onShopPhoto(e: Event): void {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    // Le champ est vidé : reposer deux fois le même fichier doit relancer l'envoi.
    input.value = '';
    if (f) void this.store.onShopPhoto(f);
  }
}
