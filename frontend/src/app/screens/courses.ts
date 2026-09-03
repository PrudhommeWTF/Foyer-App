import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { LIST_ICONS, PALETTE } from '../core/constants';
import { RAYONS } from '../core/articles';
import { Aisle, ShopItem, ShopState } from '../core/models';

interface AisleGroup { aisle: Aisle; items: ShopItem[]; }

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
  imports: [FormsModule, IconComponent, ModalComponent],
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
      </div>

      <!-- Ajout rapide : trois taps au maximum, champ puis suggestion ou Entrée -->
      <div class="quick">
        <input class="input" placeholder="Ajouter un article…" enterkeyhint="done"
               autocomplete="off" autocapitalize="sentences"
               [ngModel]="store.ui().newShop" (ngModelChange)="store.patch({ newShop: $event })"
               (keydown.enter)="store.addShopQuick()">
        <button class="add-btn" (click)="store.addShopQuick()" aria-label="Ajouter">
          <f-icon name="plus" [size]="22" color="#fff" [width]="2.6" />
        </button>
      </div>
      @if (suggestions().length) {
        <div class="sugg">
          @for (sg of suggestions(); track sg) {
            <button class="sugg-chip" (click)="addSuggestion(sg)">{{ sg }}</button>
          }
        </div>
      }

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

      <div class="prog">
        <div class="prog-txt">{{ progress().done }} / {{ progress().total }} articles pris</div>
        <div class="bar"><div class="bar-fill" [style.width.%]="progress().pct"></div></div>
      </div>

      <div class="by-head">
        <span class="overline">Par rayon</span>
        <span class="acts">
          <span class="mini-link" (click)="store.patch({ aisleOrderOpen: true })"><f-icon name="planning" [size]="14" color="var(--ink2)" [width]="2.4" /> Ordre</span>
          <span class="mini-link" (click)="store.newAisle()"><f-icon name="plus" [size]="14" color="#E56B4E" [width]="2.6" /> Rayon</span>
          <span class="mini-link" (click)="store.exportShoppingCsv()"><f-icon name="export" [size]="14" color="var(--ink2)" [width]="2.4" /> Exporter</span>
          @if (active() !== 'all') {
            <span class="mini-link" (click)="store.addShoppingTask()">
              <f-icon name="checklist" [size]="14" color="var(--ink2)" [width]="2.4" />
              {{ store.shoppingTask(active()) ? 'Dans les tâches' : 'En tâche' }}
            </span>
          }
        </span>
      </div>

      <!-- À prendre, dans l'ordre des allées -->
      @for (g of todo(); track g.aisle.id) {
        <div class="cat" [style.border-left]="'4px solid ' + g.aisle.color">
          <div class="cat-head">
            <div class="cat-name"><span class="dot" [style.background]="g.aisle.color"></span>{{ g.aisle.name }}</div>
            <span class="cat-n">{{ g.items.length }}</span>
          </div>
          @for (it of g.items; track it.id) {
            <div class="row" [class.unavail]="it.state === 'indisponible'">
              <button class="tick" [class.unavail]="it.state === 'indisponible'" (click)="store.toggleShop(it.id)"
                      [attr.aria-label]="'Cocher ' + it.name">
                @if (it.state === 'indisponible') { <f-icon name="x" [size]="15" color="#C6492F" [width]="3" /> }
              </button>
              <button class="row-body" (click)="store.editShop(it.id)">
                <span class="s-name">{{ it.name }}</span>
                @if (it.qty) { <span class="s-qty">{{ it.qty }}</span> }
              </button>
            </div>
          }
        </div>
      } @empty {
        <div class="empty">
          @if (progress().total) { Tout est dans le panier. } @else { Aucun article dans cette liste. }
        </div>
      }

      <!-- Déjà pris, regroupés en bas -->
      @if (picked().length) {
        <div class="done-head">
          <span class="overline">Dans le panier ({{ picked().length }})</span>
          @if (activeList(); as al) {
            <span class="mini-link" (click)="store.clearPicked(al.id)"><f-icon name="trash" [size]="14" color="var(--ink2)" [width]="2.4" /> Vider</span>
          }
        </div>
        <div class="cat done-cat">
          @for (it of picked(); track it.id) {
            <div class="row">
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
        </div>
      }

      <div class="gen-card" (click)="store.prepareList(store.weekDays())">
        <f-icon name="bolt" [size]="22" color="#fff" />
        <div class="gen-t">Générer depuis les repas</div>
        <div class="gen-s">Ajoute les ingrédients des repas prévus cette semaine</div>
      </div>
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
          <button class="btn btn-soft grow" (click)="store.patch({ aiForm: false })">Annuler</button>
          <button class="btn btn-primary grow2" (click)="store.saveAisle()">Enregistrer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().shopListDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ shopListDelId: null })">
        <div class="confirm">
          <div class="warn"><f-icon name="trash" [size]="26" color="#E56B4E" /></div>
          <div class="confirm-t f-display">Supprimer cette liste ?</div>
          <div class="confirm-s">Cette liste et ses articles seront supprimés. Cette action est définitive.</div>
          <div class="modal-actions">
            <button class="btn btn-soft grow" (click)="store.patch({ shopListDelId: null })">Annuler</button>
            <button class="btn btn-danger grow" (click)="store.confirmShopListDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }

    @if (store.ui().aisleDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ aisleDelId: null })">
        <div class="confirm">
          <div class="warn"><f-icon name="trash" [size]="26" color="#E56B4E" /></div>
          <div class="confirm-t f-display">Supprimer ce rayon ?</div>
          <div class="confirm-s">Ce rayon sera supprimé. Ses articles passeront dans « À trier ».</div>
          <div class="modal-actions">
            <button class="btn btn-soft grow" (click)="store.patch({ aisleDelId: null })">Annuler</button>
            <button class="btn btn-danger grow" (click)="store.confirmAisleDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
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
    .sugg-chip { border: none; background: var(--soft2); color: var(--ink2); border-radius: 12px; padding: 9px 14px; font-size: 13.5px; font-weight: 800; cursor: pointer; }

    .sync { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 13px; background: var(--soft2); color: var(--ink2); font-size: 12.5px; font-weight: 700; margin-bottom: 14px; }
    .sync.off { background: #FCE9E3; color: #C6492F; }

    .list-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .list-ic { width: 34px; height: 34px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex: none; }
    .list-name { font-size: 19px; font-weight: 700; color: var(--ink); flex: 1; min-width: 0; }
    .head-acts { display: flex; gap: 6px; }

    .prog { margin-bottom: 18px; }
    .prog-txt { font-size: 12.5px; font-weight: 800; color: var(--ink2); margin-bottom: 7px; }
    .bar { height: 8px; background: var(--line2); border-radius: 8px; overflow: hidden; }
    .bar-fill { height: 100%; background: var(--sage); border-radius: 8px; transition: width .3s ease; }

    .by-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .by-head .acts { display: flex; gap: 14px; }
    .mini-link { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 800; color: var(--ink2); cursor: pointer; }

    .cat { background: var(--surface); border-radius: var(--r-card); padding: 12px 14px 6px; box-shadow: 0 12px 28px -20px rgba(90,60,40,.5); margin-bottom: 14px; }
    .cat-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .cat-name { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 13.5px; font-weight: 700; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; }
    .cat-name .dot { width: 10px; height: 10px; border-radius: 3px; }
    .cat-n { font-size: 12px; font-weight: 800; color: var(--ink3); }
    .done-cat { opacity: .75; }
    .done-head { display: flex; align-items: center; justify-content: space-between; margin: 22px 0 12px; }

    /* La ligne fait 52 px : la coche et le corps sont deux cibles distinctes,
       assez larges pour être visées d'une main dans un magasin. */
    .row { display: flex; align-items: center; gap: 12px; min-height: 52px; }
    .row + .row { border-top: 1px solid var(--line); }
    .tick { width: 30px; height: 30px; flex: none; border-radius: 9px; border: 2px solid var(--line2); background: transparent; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
    .tick.on { background: var(--sage); border-color: var(--sage); }
    .tick.unavail { border-color: #E9B4A6; background: #FCE9E3; }
    .row-body { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; border: none; background: none; padding: 14px 0; text-align: left; cursor: pointer; font: inherit; }
    .s-name { flex: 1; min-width: 0; font-size: 15.5px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .s-name.done { color: var(--ink3); text-decoration: line-through; }
    .row.unavail .s-name { color: #C6492F; }
    .s-qty { font-size: 13px; font-weight: 800; color: var(--ink3); flex: none; }
    .who { width: 10px; height: 10px; border-radius: 50%; flex: none; }
    .empty { color: var(--ink2); font-weight: 700; font-size: 14px; padding: 24px 0; }

    .gen-card { background: linear-gradient(135deg,#7A9B76,#5F7E5C); border-radius: var(--r-card-lg); padding: 20px; cursor: pointer; box-shadow: 0 14px 26px -14px rgba(95,126,92,.6); margin-top: 24px; }
    .gen-t { color: #fff; font-weight: 800; font-size: 16px; margin-top: 8px; }
    .gen-s { color: #fff; opacity: .85; font-size: 13px; font-weight: 600; margin-top: 4px; }

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
    .confirm { text-align: center; }
    .warn { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #FCE9E3; display: flex; align-items: center; justify-content: center; }
    .confirm-t { font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-s { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 22px; }

    /* Sur large écran, la liste reste une colonne lisible plutôt que de s'étirer. */
    @media (min-width: 861px) {
      :host { display: block; max-width: 760px; }
    }
  `],
})
export class CoursesScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  readonly LIST_ICONS = LIST_ICONS;
  readonly RAYONS = RAYONS;
  readonly PALETTE = PALETTE;
  readonly iconKeys = Object.keys(LIST_ICONS);
  readonly states: { k: ShopState; label: string }[] = [
    { k: 'a-prendre', label: 'À prendre' },
    { k: 'panier', label: 'Pris' },
    { k: 'indisponible', label: 'Indispo.' },
  ];

  active = computed(() => this.store.ui().activeShopList);
  lists = computed(() => this.d().shopLists);
  allCount = computed(() => this.d().shop.filter((x) => x.state === 'a-prendre').length);
  activeList = computed(() => { const a = this.active(); return a === 'all' ? null : this.d().shopLists.find((l) => l.id === a) ?? null; });

  scope = computed(() => { const a = this.active(); return a === 'all' ? this.d().shop : this.d().shop.filter((x) => x.listId === a); });

  /** À prendre et introuvables, groupés par rayon, dans l'ordre des allées. */
  todo = computed<AisleGroup[]>(() => {
    const scope = this.scope().filter((x) => x.state !== 'panier');
    return this.store.aislesInOrder()
      .map((aisle) => ({ aisle, items: scope.filter((x) => x.aisleId === aisle.id) }))
      .filter((g) => g.items.length);
  });

  /** Les articles pris restent visibles, en bas : c'est ce qu'on relit en caisse. */
  picked = computed(() => this.scope().filter((x) => x.state === 'panier'));

  progress = computed(() => {
    const s = this.scope();
    const total = s.length; const done = s.filter((x) => x.state === 'panier').length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  });

  /**
   * Suggestions tirées de ce que le foyer achète déjà, dès les premières lettres.
   * Le référentiel d'articles arrive à la tranche suivante ; en attendant, les
   * articles passés sont une source honnête et sans surprise.
   */
  suggestions = computed(() => {
    const q = this.store.ui().newShop.trim().toLowerCase();
    if (q.length < 2) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const it of this.d().shop) {
      const n = it.name.trim();
      const k = n.toLowerCase();
      if (k === q || seen.has(k) || !k.includes(q)) continue;
      seen.add(k);
      out.push(n);
      if (out.length === 4) break;
    }
    return out;
  });

  addSuggestion(name: string): void {
    this.store.patch({ newShop: name });
    this.store.addShopQuick();
  }

  countFor(id: string): number { return this.d().shop.filter((x) => x.listId === id && x.state === 'a-prendre').length; }

  whoColor(it: ShopItem): string | null { return it.by ? this.store.memberColor(it.by) : null; }
  whoName(it: ShopItem): string { return it.by ? 'Coché par ' + this.store.memberName(it.by) : ''; }
}
