import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { LIST_ICONS, PALETTE } from '../core/constants';
import { ShopItem } from '../core/models';

interface AisleGroup { id: string | null; name: string; color: string; editable: boolean; items: ShopItem[]; }

@Component({
  selector: 'screen-courses',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <!-- List chips -->
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

      <!-- Active-list header -->
      @if (activeList(); as al) {
        <div class="list-head">
          <div class="list-id">
            <div class="list-ic" [style.background]="al.color"><f-icon [path]="LIST_ICONS[al.icon]" [size]="18" color="#fff" /></div>
            <span class="list-name f-display">{{ al.name }}</span>
          </div>
          <button class="icon-btn sm" (click)="store.editShopList(al.id)"><f-icon name="edit" [size]="15" color="var(--ink2)" /></button>
          <button class="icon-btn sm" (click)="store.patch({ shopListDelId: al.id })"><f-icon name="trash" [size]="15" color="#E56B4E" /></button>
        </div>
      }

      <div class="panels">
        <!-- LEFT -->
        <div class="col-left">
          <div class="quick">
            <input class="input" placeholder="Ajouter un article…"
                   [ngModel]="store.ui().newShop" (ngModelChange)="store.patch({ newShop: $event })"
                   (keydown.enter)="store.addShopQuick()">
            <button class="btn btn-primary" (click)="store.addShopQuick()"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Ajouter</button>
          </div>

          <div class="by-head">
            <span class="overline">Par rayon</span>
            <span class="add-aisle" (click)="store.newAisle()"><f-icon name="plus" [size]="14" color="#E56B4E" [width]="2.6" /> Rayon</span>
          </div>

          <div class="cats">
            @for (g of groups(); track g.name) {
              <div class="cat-card" [style.border-left]="'4px solid ' + g.color">
                <div class="cat-head">
                  <div class="cat-name"><span class="dot" [style.background]="g.color"></span>{{ g.name }}</div>
                  @if (g.editable && g.id) {
                    <div class="cat-acts">
                      <span class="mini" (click)="store.editAisle(g.id)"><f-icon name="edit" [size]="13" color="var(--ink2)" /></span>
                      <span class="mini" (click)="store.patch({ aisleDelId: g.id })"><f-icon name="trash" [size]="13" color="#E56B4E" /></span>
                    </div>
                  }
                </div>
                @for (it of g.items; track it.id) {
                  <div class="shop-row" (click)="store.editShop(it.id)">
                    <span class="tick" [class.on]="it.done" (click)="$event.stopPropagation(); store.toggleShop(it.id)">
                      @if (it.done) { <f-icon name="check" [size]="12" color="#fff" [width]="3.6" /> }
                    </span>
                    <span class="s-name" [class.done]="it.done">{{ it.name }}</span>
                    <span class="s-qty">{{ it.qty }}</span>
                  </div>
                }
              </div>
            } @empty { <div class="empty">Aucun article dans cette liste.</div> }
          </div>
        </div>

        <!-- RIGHT -->
        <div class="col-right">
          <div class="card prog-card">
            <div class="card-title sm">Progression</div>
            <div class="prog-n f-display">{{ progress().done }}<span class="prog-tot">/{{ progress().total }}</span></div>
            <div class="prog-lbl">articles cochés</div>
            <div class="bar"><div class="bar-fill" [style.width.%]="progress().pct"></div></div>
          </div>
          <div class="gen-card" (click)="store.generateList()">
            <f-icon name="bolt" [size]="24" color="#fff" />
            <div class="gen-t">Générer depuis les repas</div>
            <div class="gen-s">Ajoute tous les ingrédients du planning de la semaine en un clic</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Shop item modal -->
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
        <div class="field-label">Rayon</div>
        <div class="seg-wrap">
          @for (a of d().aisles; track a.id) {
            <div class="seg-opt" [class.on]="store.ui().shCat === a.name" (click)="store.patch({ shCat: a.name })">{{ a.name }}</div>
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
            <button class="icon-btn del-btn" (click)="store.delShop()"><f-icon name="trash" [size]="18" color="#E56B4E" /></button>
          }
          <button class="btn btn-soft grow" (click)="store.patch({ showShop: false })">Annuler</button>
          <button class="btn btn-primary grow2" (click)="store.saveShop()">Enregistrer</button>
        </div>
      </f-modal>
    }

    <!-- Shop list modal -->
    @if (store.ui().shopListForm) {
      <f-modal [title]="store.ui().clEditId ? 'Modifier la liste' : 'Nouvelle liste'" [maxWidth]="460" (close)="store.patch({ shopListForm: false })">
        <div class="field-label">Nom de la liste</div>
        <input class="input mb" placeholder="Ex : Courses Auchan" [ngModel]="store.ui().clName" (ngModelChange)="store.patch({ clName: $event })">
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

    <!-- Aisle modal -->
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
        <div class="modal-actions">
          <button class="btn btn-soft grow" (click)="store.patch({ aiForm: false })">Annuler</button>
          <button class="btn btn-primary grow2" (click)="store.saveAisle()">Enregistrer</button>
        </div>
      </f-modal>
    }

    <!-- Delete list confirm -->
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

    <!-- Delete aisle confirm -->
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
    .chips { display: flex; gap: 9px; flex-wrap: wrap; align-items: center; margin-bottom: 18px; }
    .chip-l { display: flex; align-items: center; gap: 8px; padding: 9px 15px; border-radius: var(--r-chip); font-size: 13.5px; font-weight: 800; cursor: pointer; background: var(--surface); color: var(--ink2); box-shadow: 0 6px 14px -12px rgba(90,60,40,.6); }
    .chip-l .cnt { font-size: 12px; }
    .chip-new { display: flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: var(--r-chip); font-size: 13px; font-weight: 800; cursor: pointer; color: #E56B4E; border: 2px dashed var(--line2); }
    .list-head { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
    .list-id { display: flex; align-items: center; gap: 10px; }
    .list-ic { width: 34px; height: 34px; border-radius: 11px; display: flex; align-items: center; justify-content: center; }
    .list-name { font-size: 19px; font-weight: 700; color: var(--ink); }

    .panels { display: flex; gap: 24px; align-items: flex-start; }
    .col-left { flex: 1; min-width: 0; }
    .col-right { width: 300px; flex: none; }
    :host-context(.shell.narrow) .panels { flex-direction: column; }
    :host-context(.shell.narrow) .col-right { width: 100%; }
    @media (max-width: 860px) { .panels { flex-direction: column; } .col-right { width: 100%; } }

    .quick { display: flex; gap: 12px; margin-bottom: 22px; }
    .quick .input { flex: 1; }
    .by-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .add-aisle { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #E56B4E; cursor: pointer; }

    .cats { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
    :host-context(.shell.narrow) .cats { grid-template-columns: 1fr; }
    @media (max-width: 860px) { .cats { grid-template-columns: 1fr; } }
    .cat-card { background: var(--surface); border-radius: var(--r-card); padding: 16px 18px; box-shadow: 0 12px 28px -20px rgba(90,60,40,.5); }
    .cat-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .cat-name { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; }
    .cat-name .dot { width: 10px; height: 10px; border-radius: 3px; }
    .cat-acts { display: flex; gap: 6px; }
    .mini { width: 26px; height: 26px; border-radius: 8px; background: var(--soft2); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .shop-row { display: flex; align-items: center; gap: 12px; padding: 9px 0; cursor: pointer; }
    .tick { width: 22px; height: 22px; flex: none; border-radius: 7px; border: 2px solid var(--line2); background: transparent; display: flex; align-items: center; justify-content: center; }
    .tick.on { background: var(--sage); border-color: var(--sage); }
    .s-name { flex: 1; font-size: 14.5px; font-weight: 700; color: var(--ink); }
    .s-name.done { color: var(--ink3); text-decoration: line-through; }
    .s-qty { font-size: 13px; font-weight: 700; color: var(--ink3); }
    .empty { grid-column: 1 / -1; color: var(--ink2); font-weight: 700; font-size: 14px; padding: 24px 0; }

    .prog-card { margin-bottom: 16px; }
    .prog-n { font-size: 34px; font-weight: 700; color: #E56B4E; margin: 6px 0 2px; }
    .prog-tot { font-size: 18px; color: var(--ink3); }
    .prog-lbl { font-size: 13px; font-weight: 700; color: var(--ink2); }
    .bar { height: 9px; background: var(--line2); border-radius: 8px; margin-top: 14px; overflow: hidden; }
    .bar-fill { height: 100%; background: var(--sage); border-radius: 8px; transition: width .3s ease; }
    .gen-card { background: linear-gradient(135deg,#7A9B76,#5F7E5C); border-radius: var(--r-card-lg); padding: 22px; cursor: pointer; box-shadow: 0 14px 26px -14px rgba(95,126,92,.6); }
    .gen-t { color: #fff; font-weight: 800; font-size: 16px; margin-top: 10px; }
    .gen-s { color: #fff; opacity: .85; font-size: 13px; font-weight: 600; margin-top: 4px; }

    .modal-row { display: flex; gap: 12px; margin-bottom: 16px; }
    .modal-row .grow { flex: 1; }
    .qty-f { width: 110px; }
    .mb { margin-bottom: 20px; }
    .seg-wrap { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 22px; }
    .seg-opt { display: flex; align-items: center; gap: 7px; padding: 9px 15px; border-radius: 11px; font-size: 13.5px; font-weight: 800; cursor: pointer; background: var(--soft2); color: var(--ink2); border: 2px solid transparent; }
    .seg-opt.on { background: var(--primary); color: #fff; }
    .s-dot { width: 9px; height: 9px; border-radius: 3px; }
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
  `],
})
export class CoursesScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  readonly LIST_ICONS = LIST_ICONS;
  readonly PALETTE = PALETTE;
  readonly iconKeys = Object.keys(LIST_ICONS);

  active = computed(() => this.store.ui().activeShopList);
  lists = computed(() => this.d().shopLists);
  allCount = computed(() => this.d().shop.filter((x) => !x.done).length);
  activeList = computed(() => { const a = this.active(); return a === 'all' ? null : this.d().shopLists.find((l) => l.id === a) ?? null; });

  scope = computed(() => { const a = this.active(); return a === 'all' ? this.d().shop : this.d().shop.filter((x) => x.listId === a); });

  groups = computed<AisleGroup[]>(() => {
    const scope = this.scope();
    const aisles = this.d().aisles;
    const names = new Set(aisles.map((a) => a.name));
    const out: AisleGroup[] = [];
    for (const a of aisles) {
      const items = scope.filter((x) => x.cat === a.name);
      if (items.length) out.push({ id: a.id, name: a.name, color: a.color, editable: true, items });
    }
    const extra = new Map<string, ShopItem[]>();
    for (const it of scope) {
      if (!names.has(it.cat)) { const arr = extra.get(it.cat) ?? []; arr.push(it); extra.set(it.cat, arr); }
    }
    for (const [name, items] of extra) out.push({ id: null, name, color: '#8A7E74', editable: false, items });
    return out;
  });

  progress = computed(() => {
    const s = this.scope();
    const total = s.length; const done = s.filter((x) => x.done).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  });

  countFor(id: string): number { return this.d().shop.filter((x) => x.listId === id && !x.done).length; }
}
