import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { RECIPE_PALETTE } from '../../core/constants';
import { uid } from '../../core/helpers';
import { Recipe } from '../../core/models';
import { readRecipeText } from '../../core/recipe-text';
import { RecipeFields, recipeData, recipeFields } from '../../core/recipe-form';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/**
 * Le formulaire d'une recette dans la fiche. Une recette neuve peut se remplir
 * depuis une page (import fait par le serveur) ou un texte collé (lu dans le
 * navigateur) ; dans les deux cas rien n'est enregistré avant « Créer ».
 *
 * L'identifiant est tiré à l'ouverture, avant l'enregistrement : une photo a
 * besoin d'un propriétaire pour être rangée, y compris sur une recette qui
 * n'existe pas encore.
 */
@Component({
  selector: 'app-recipe-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @if (!item()) {
      <div class="import">
        <div class="field-label">Importer depuis une page de recette</div>
        <div class="import-row">
          <input class="input" type="url" inputmode="url" autocomplete="off"
                 placeholder="Collez l'adresse d'une recette (Marmiton, 750g…)"
                 [ngModel]="importUrl()" (ngModelChange)="importUrl.set($event)" (keydown.enter)="doImport()">
          <button type="button" class="btn btn-sage" [disabled]="importBusy()" (click)="doImport()">
            {{ importBusy() ? 'Lecture…' : 'Importer' }}
          </button>
        </div>
        <div class="hint">Le serveur va lire la page et remplir le formulaire. Relisez avant d'enregistrer.</div>

        <button type="button" class="paste-open" (click)="pasteOpen.set(!pasteOpen())">
          <f-icon name="copy" [size]="15" color="var(--ink2)" [width]="2" />
          <span>… ou coller le texte d'une recette</span>
          <f-icon [name]="pasteOpen() ? 'chevronDown' : 'chevronRight'" [size]="15" color="var(--ink3)" [width]="2.2" />
        </button>
        @if (pasteOpen()) {
          <textarea class="input paste" rows="7" [ngModel]="paste()" (ngModelChange)="paste.set($event)"
                    placeholder="Collez ici une recette prise sur un carnet, un message ou une photo (votre téléphone sait extraire le texte d'une image)."></textarea>
          <div class="import-row">
            <div class="hint">Rien n'est envoyé : la lecture se fait dans votre navigateur.</div>
            <button type="button" class="btn btn-sage" (click)="applyPaste()">Lire</button>
          </div>
        }
      </div>
    }

    @if (warnings().length) {
      <div class="warn-box mb">
        @for (w of warnings(); track $index) {
          <div class="warn-line"><f-icon name="bell" [size]="14" color="#D9930F" [width]="2.4" /> {{ w }}</div>
        }
      </div>
    }

    <div class="field-label">Nom de la recette</div>
    <input class="input mb" placeholder="Ex : Tarte aux pommes" [ngModel]="f().name" (ngModelChange)="set({ name: $event })">

    <div class="form-row mb">
      <div class="grow">
        <div class="field-label num">Prépa.</div>
        <input class="input" type="number" inputmode="numeric" min="0" placeholder="15" [ngModel]="f().prepMin" (ngModelChange)="set({ prepMin: str($event) })">
      </div>
      <div class="grow">
        <div class="field-label num">Cuisson</div>
        <input class="input" type="number" inputmode="numeric" min="0" placeholder="30" [ngModel]="f().cookMin" (ngModelChange)="set({ cookMin: str($event) })">
      </div>
      <div class="grow">
        <div class="field-label num">Portions</div>
        <input class="input" type="number" inputmode="numeric" min="1" placeholder="4" [ngModel]="f().portions" (ngModelChange)="set({ portions: str($event) })">
      </div>
    </div>
    <div class="hint mb">Durées en minutes. Les portions servent à mettre les courses à l'échelle du nombre de couverts.</div>

    <div class="field-label">Difficulté</div>
    <div class="seg lvl mb">
      @for (l of levels; track l) {
        <button type="button" [class.active]="f().level === l" (click)="set({ level: l })">{{ l }}</button>
      }
    </div>

    <div class="field-label">Note de la famille</div>
    <div class="stars mb">
      @for (n of [1, 2, 3, 4, 5]; track n) {
        <button type="button" class="star" [class.on]="f().rating >= n" (click)="setRating(n)" [attr.aria-label]="n + ' sur 5'">★</button>
      }
      @if (f().rating) { <span class="star-hint">Touchez l'étoile courante pour retirer la note.</span> }
    </div>

    <div class="field-label">Étiquettes</div>
    <div class="tags mb">
      @for (t of f().tags; track t) {
        <button type="button" class="tag" (click)="removeTag(t)">{{ t }} <f-icon name="x" [size]="11" color="#fff" [width]="3" /></button>
      }
      <input class="input tag-in" [ngModel]="tagInput()" (ngModelChange)="tagInput.set($event)"
             (keydown.enter)="addTag()" (blur)="addTag()" placeholder="végétarien, du dimanche…" />
    </div>

    <div class="field-label">Apparence</div>
    <div class="appearance mb">
      <label class="upload" [class.busy]="photoBusy()">
        <input type="file" accept="image/*" [disabled]="photoBusy()" (change)="onPhoto($event)">
        <f-icon name="upload" [size]="18" color="var(--ink2)" />
        <span>{{ photoBusy() ? 'Envoi…' : 'Photo' }}</span>
      </label>
      <div class="swatch-row">
        @for (c of palette; track c) {
          <div class="swatch" [style.background]="store.grad(c)"
               [style.box-shadow]="f().color === c && !f().photoId ? '0 0 0 3px var(--surface), 0 0 0 5px ' + c : ''"
               (click)="set({ color: c, photoId: null })"></div>
        }
      </div>
    </div>
    @if (store.photoUrl(f().photoId); as ph) {
      <div class="preview mb">
        <div class="preview-img" [style.background-image]="'url(' + ph + ')'"></div>
        <button type="button" class="btn btn-soft" (click)="set({ photoId: null })">
          <f-icon name="x" [size]="15" color="var(--ink2)" /> Retirer la photo
        </button>
      </div>
    }

    <div class="section-head">
      <div class="section-t">Ingrédients</div>
      <button type="button" class="add-link" (click)="addRow('ingr')"><f-icon name="plus" [size]="14" color="#7A9B76" [width]="2.6" /> Ajouter un ingrédient</button>
    </div>
    <div class="rows mb">
      @for (row of f().ingr; track row.id) {
        <div class="row-line">
          <input class="input" placeholder="Ex : 3 pommes" [ngModel]="row.val" (ngModelChange)="setRow('ingr', row.id, $event)">
          <button type="button" class="icon-btn sm rem" (click)="removeRow('ingr', row.id)" aria-label="Retirer l'ingrédient"><f-icon name="minus" [size]="16" color="var(--ink2)" /></button>
        </div>
      }
    </div>

    <div class="section-head">
      <div class="section-t">Étapes</div>
      <button type="button" class="add-link" (click)="addRow('steps')"><f-icon name="plus" [size]="14" color="#7A9B76" [width]="2.6" /> Ajouter une étape</button>
    </div>
    <div class="rows">
      @for (row of f().steps; track row.id; let idx = $index) {
        <div class="row-line step-line">
          <span class="num">{{ idx + 1 }}</span>
          <textarea class="input" placeholder="Décrire l'étape…" [ngModel]="row.val" (ngModelChange)="setRow('steps', row.id, $event)"></textarea>
          <button type="button" class="icon-btn sm rem" (click)="removeRow('steps', row.id)" aria-label="Retirer l'étape"><f-icon name="minus" [size]="16" color="var(--ink2)" /></button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mb { margin-bottom: 20px; }
    .import { background: var(--soft); border-radius: 15px; padding: 14px 15px; margin-bottom: 20px; }
    .import-row { display: flex; gap: 10px; }
    .import-row .input { flex: 1; min-width: 0; }
    .import .field-label { margin-bottom: 8px; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; }
    .import .hint { margin-top: 8px; }
    .paste-open { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: none; padding: 10px 0 4px; cursor: pointer; font-family: var(--font-body); font-size: 13px; font-weight: 800; color: var(--ink2); text-align: left; }
    .paste-open span { flex: 1; }
    .paste { width: 100%; resize: vertical; font-family: var(--font-body); font-size: 13.5px; line-height: 1.5; margin-bottom: 8px; }
    .warn-box { background: #FDF0DA; border-radius: 13px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .warn-line { display: flex; align-items: flex-start; gap: 8px; font-size: 12.5px; font-weight: 700; color: #8A6412; line-height: 1.4; }
    /* Trois champs courts sur 390 px : libellés sur une ligne, champs alignés. */
    .form-row { display: flex; gap: 12px; align-items: flex-end; }
    .field-label.num { white-space: nowrap; font-size: 12px; letter-spacing: .02em; }
    .form-row + .hint { margin-top: -12px; }
    .form-row .grow { flex: 1; min-width: 0; }
    .seg.lvl { display: flex; width: 100%; }
    .seg.lvl > button { flex: 1; }
    .stars { display: flex; align-items: center; gap: 4px; }
    .star { border: none; background: none; cursor: pointer; font-size: 26px; line-height: 1; color: var(--line2); padding: 0 2px; }
    .star.on { color: var(--honey); }
    .star-hint { font-size: 12px; font-weight: 600; color: var(--ink3); margin-left: 8px; }
    .tags { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
    .tag { display: inline-flex; align-items: center; gap: 5px; border: none; background: var(--sage); color: #fff; border-radius: 10px; padding: 6px 10px; font-family: var(--font-body); font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .tag-in { flex: 1; min-width: 150px; }
    .appearance { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .upload { display: inline-flex; align-items: center; gap: 8px; padding: 11px 16px; border-radius: 13px; border: 2px dashed var(--line2); background: var(--soft); font-size: 13.5px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .upload input { display: none; }
    .upload.busy { opacity: .6; cursor: progress; }
    .preview { display: flex; align-items: center; gap: 14px; }
    .preview-img { width: 88px; height: 66px; border-radius: 13px; background-size: cover; background-position: center; flex: none; }
    .section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .section-t { font-size: 14px; font-weight: 800; color: #E56B4E; text-transform: uppercase; letter-spacing: .05em; }
    .add-link { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; padding: 0; font: inherit; font-size: 13px; font-weight: 800; color: #7A9B76; cursor: pointer; }
    .rows { display: flex; flex-direction: column; gap: 9px; }
    .row-line { display: flex; gap: 9px; align-items: center; }
    .row-line .input { flex: 1; }
    .step-line { align-items: flex-start; }
    .step-line .num { width: 28px; flex: none; text-align: center; padding-top: 12px; font-family: var(--font-display); font-size: 16px; font-weight: 700; color: #E56B4E; }
    .step-line textarea.input { min-height: 46px; }
    .rem { flex: none; background: var(--soft2); }
  `],
})
export class RecipeForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  readonly item = input<Recipe | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly palette = RECIPE_PALETTE;
  readonly levels = ['Facile', 'Moyen', 'Difficile'] as const;

  private readonly rowId = (p: string): string => uid(p);
  readonly f = signal<RecipeFields>(recipeFields(null, this.rowId));
  private initial = '';
  /** L'identifiant de la recette : celui de la recette modifiée, ou tiré à l'ouverture. */
  private recipeId = '';
  readonly dirty = computed(() => JSON.stringify(recipeData(this.f())) !== this.initial);

  readonly importUrl = signal('');
  readonly importBusy = signal(false);
  readonly warnings = signal<string[]>([]);
  readonly pasteOpen = signal(false);
  readonly paste = signal('');
  readonly tagInput = signal('');
  readonly photoBusy = signal(false);

  constructor() {
    // La photo du formulaire se télécharge comme les autres, le temps qu'il est ouvert.
    inject(DestroyRef).onDestroy(() => this.store.formPhotoId.set(null));
  }

  ngOnInit(): void {
    const r = this.item();
    this.recipeId = r?.id || uid('r');
    const f = recipeFields(r, this.rowId);
    this.f.set(f);
    this.initial = JSON.stringify(recipeData(f));
  }

  submit(): ItemResult {
    const data = recipeData(this.f());
    if (!data) { this.store.toast('Donne un nom à la recette'); return { kind: 'invalid' }; }
    return this.store.saveRecipe(this.recipeId, data, !this.item());
  }

  set(p: Partial<RecipeFields>): void {
    this.f.update((f) => ({ ...f, ...p }));
    if ('photoId' in p) this.store.formPhotoId.set(this.f().photoId);
  }
  /** Un champ numérique rend un nombre, ou null une fois vidé : le formulaire garde du texte. */
  str(v: unknown): string { return v === null || v === undefined ? '' : String(v); }
  addRow(k: 'ingr' | 'steps'): void { this.f.update((f) => ({ ...f, [k]: [...f[k], { id: uid(k === 'ingr' ? 'i' : 'p'), val: '' }] })); }
  setRow(k: 'ingr' | 'steps', id: string, val: string): void { this.f.update((f) => ({ ...f, [k]: f[k].map((x) => (x.id === id ? { ...x, val } : x)) })); }
  removeRow(k: 'ingr' | 'steps', id: string): void { this.f.update((f) => ({ ...f, [k]: f[k].filter((x) => x.id !== id) })); }
  addTag(): void {
    const t = this.tagInput().trim().toLowerCase(); if (!t) return;
    if (!this.f().tags.includes(t)) this.set({ tags: [...this.f().tags, t] });
    this.tagInput.set('');
  }
  removeTag(t: string): void { this.set({ tags: this.f().tags.filter((x) => x !== t) }); }
  /** Un second tap sur l'étoile courante retire la note : sinon elle serait indélébile. */
  setRating(n: number): void { this.set({ rating: this.f().rating === n ? 0 : n }); }

  /** Remplit le formulaire depuis une page de recette. Un import n'efface pas une saisie qu'il n'a pas de quoi remplacer. */
  async doImport(): Promise<void> {
    const url = this.importUrl().trim();
    if (!url) { this.store.toast('Collez l’adresse de la recette'); return; }
    this.importBusy.set(true); this.warnings.set([]);
    try {
      const res = await this.store.importRecipeFrom(url, this.recipeId);
      const r = res.recipe;
      const n = (v?: number | null): string => (v ? String(v) : '');
      this.set({
        name: r.name, portions: n(r.portions), prepMin: n(r.prepMin), cookMin: n(r.cookMin), source: r.source || '',
        ...(r.ingr.length ? { ingr: r.ingr.map((val) => ({ id: uid('i'), val })) } : {}),
        ...(r.steps.length ? { steps: r.steps.map((val) => ({ id: uid('p'), val })) } : {}),
        ...(res.photoId ? { photoId: res.photoId } : {}),
      });
      this.warnings.set(res.warnings);
      this.importUrl.set('');
      this.store.toast('Recette importée, relisez-la avant d’enregistrer');
    } catch (e) {
      // Le message du serveur dit quoi faire : le relayer tel quel.
      this.warnings.set([(e as Error).message]);
    } finally {
      this.importBusy.set(false);
    }
  }

  /** Lit la recette collée et remplit le formulaire : ce qui a été compris se relit, le reste est dit au-dessus. */
  applyPaste(): void {
    const r = readRecipeText(this.paste(), this.store.articleIndex());
    if (!r.ingr.length && !r.steps.length && !r.name) { this.store.toast(r.warnings[0] || 'Rien à lire dans ce texte'); return; }
    this.set({
      ...(r.name ? { name: r.name } : {}),
      ...(r.portions ? { portions: String(r.portions) } : {}),
      ...(r.prepMin ? { prepMin: String(r.prepMin) } : {}),
      ...(r.cookMin ? { cookMin: String(r.cookMin) } : {}),
      ingr: (r.ingr.length ? r.ingr : ['']).map((val) => ({ id: uid('i'), val })),
      steps: (r.steps.length ? r.steps : ['']).map((val) => ({ id: uid('p'), val })),
    });
    this.warnings.set(r.warnings); this.pasteOpen.set(false); this.paste.set('');
    this.store.toast(r.ingr.length + ' ingrédients et ' + r.steps.length + ' étapes lus');
  }

  async onPhoto(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    // Le champ est vidé : reposer deux fois le même fichier doit relancer l'envoi.
    input.value = '';
    if (!file) return;
    this.photoBusy.set(true);
    const id = await this.store.uploadRecipePhoto(this.recipeId, file);
    this.photoBusy.set(false);
    if (id) this.set({ photoId: id });
  }
}
