import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { uid } from '../../core/helpers';
import { ShopItem, ShopState } from '../../core/models';
import { ShopFields, shopFields } from '../../core/shop-item';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/**
 * Le formulaire d'un article dans la fiche : nom, quantité, état, rayon,
 * liste et photo. C'est ici qu'on marque « introuvable », pas par un geste
 * sur la ligne (qui ne fait que cocher). Le brouillon vit ici : rien n'est
 * écrit avant « Sauvegarder », la photo comprise.
 */
@Component({
  selector: 'app-shop-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @let v = f();
    <div class="name-row">
      <div class="grow">
        <div class="field-label">Article</div>
        <input class="input" placeholder="Ex : Pommes" [ngModel]="v.name" (ngModelChange)="setName($event)" />
      </div>
      <div class="qty-f">
        <div class="field-label">Quantité</div>
        <input class="input" placeholder="x1" [ngModel]="v.qty" (ngModelChange)="set({ qty: $event })" />
      </div>
    </div>

    <div class="field-label">État</div>
    <div class="seg mb">
      @for (st of states; track st.k) {
        <button type="button" class="grow" [class.active]="v.state === st.k" (click)="set({ state: st.k })">{{ st.label }}</button>
      }
    </div>

    <div class="field-label">Rayon</div>
    <div class="seg-wrap">
      @for (a of store.aislesInOrder(); track a.id) {
        <button type="button" class="seg-opt" [class.on]="v.aisleId === a.id" (click)="pickAisle(a.id)">
          <span class="s-dot" [style.background]="a.color"></span>{{ a.name }}
        </button>
      }
    </div>
    <div class="field-label">Liste</div>
    <div class="seg-wrap">
      @for (l of store.d().shopLists; track l.id) {
        <button type="button" class="seg-opt" [class.on]="v.listId === l.id" (click)="set({ listId: l.id })">
          <span class="s-dot" [style.background]="l.color"></span>{{ l.name }}
        </button>
      }
    </div>

    <div class="field-label">Photo <span class="opt">(facultatif)</span></div>
    @if (store.photoUrl(v.photoId); as ph) {
      <div class="photo-preview">
        <div class="photo-img" [style.background-image]="'url(' + ph + ')'"></div>
        <button type="button" class="btn btn-soft" (click)="set({ photoId: null })">
          <f-icon name="x" [size]="15" color="var(--ink2)" /> Retirer la photo
        </button>
      </div>
    } @else {
      <label class="photo-upload" [class.busy]="busy()">
        <input type="file" accept="image/*" [disabled]="busy()" (change)="onPhoto($event)">
        <f-icon name="upload" [size]="18" color="var(--ink2)" />
        <span>{{ busy() ? 'Envoi…' : 'Ajouter une photo' }}</span>
      </label>
    }
  `,
  styles: [`
    :host { display: block; }
    .name-row { display: flex; gap: 12px; margin-bottom: 16px; }
    .grow { flex: 1; min-width: 0; }
    .qty-f { width: 110px; flex: none; }
    .mb { margin-bottom: 20px; }
    /* Pleine largeur : sur téléphone, « Introuvable » débordait de son bouton. */
    .seg.mb { display: flex; width: 100%; box-sizing: border-box; }
    .seg .grow { flex: 1; min-width: 0; white-space: nowrap; padding-left: 6px; padding-right: 6px; }
    .seg-wrap { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 22px; }
    .seg-opt { display: flex; align-items: center; gap: 7px; padding: 11px 15px; border-radius: 11px; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; background: var(--soft2); color: var(--ink2); border: 2px solid transparent; }
    .seg-opt.on { background: var(--primary); color: #fff; }
    .s-dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
    .opt { font-weight: 700; color: var(--ink3); text-transform: none; letter-spacing: 0; }
    .photo-upload { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 12px; background: var(--soft); font-size: 13.5px; font-weight: 800; color: var(--ink2); cursor: pointer; margin-bottom: 6px; }
    .photo-upload input { display: none; }
    .photo-upload.busy { opacity: .6; pointer-events: none; }
    .photo-preview { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
    .photo-img { width: 64px; height: 64px; border-radius: 12px; background-size: cover; background-position: center; flex: none; box-shadow: 0 6px 14px -8px rgba(90,60,40,.6); }
  `],
})
export class ShopForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  /** L'article modifié, ou null à la création. */
  readonly item = input<ShopItem | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);

  readonly states: { k: ShopState; label: string }[] = [
    { k: 'a-prendre', label: 'À prendre' },
    { k: 'panier', label: 'Coché' },
    { k: 'indisponible', label: 'Introuvable' },
  ];
  readonly f = signal<ShopFields>(shopFields(null, { aisleId: '', listId: '' }));
  readonly busy = signal(false);
  /** Rayon choisi à la main : sinon, à la création, il suit ce que le nom évoque, comme à la saisie rapide. */
  private aisleTouched = false;
  private initial = '';
  /** Tiré dès l'ouverture : une photo se rattache à l'article avant même sa création. */
  private shopId = '';
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);

  constructor() {
    // La photo du formulaire se télécharge comme les autres, le temps qu'il est ouvert.
    inject(DestroyRef).onDestroy(() => this.store.formPhotoId.set(null));
  }

  ngOnInit(): void {
    const it = this.item();
    this.shopId = it?.id || uid('s');
    const f = shopFields(it, this.store.shopDefaults());
    this.f.set(f);
    this.initial = JSON.stringify(f);
    this.store.formPhotoId.set(f.photoId);
  }

  submit(): ItemResult {
    if (!this.f().name.trim()) { this.store.toast('Donne un nom à l’article'); return { kind: 'invalid' }; }
    return this.store.saveShop(this.shopId, this.f(), !this.item());
  }

  setName(name: string): void {
    this.set(!this.item() && !this.aisleTouched ? { name, aisleId: this.store.resolveAisleForName(name) } : { name });
  }
  pickAisle(id: string): void { this.aisleTouched = true; this.set({ aisleId: id }); }

  set(p: Partial<ShopFields>): void {
    this.f.update((f) => ({ ...f, ...p }));
    if ('photoId' in p) this.store.formPhotoId.set(this.f().photoId);
  }

  async onPhoto(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    // Le champ est vidé : reposer deux fois le même fichier doit relancer l'envoi.
    input.value = '';
    if (!file) return;
    this.busy.set(true);
    const id = await this.store.uploadShopPhoto(this.shopId, file);
    this.busy.set(false);
    if (id) this.set({ photoId: id });
  }
}
