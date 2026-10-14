import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { CARD_FORMATS, cardColor, cardInitials, formatFromScan } from '../../core/cards';
import { PALETTE } from '../../core/constants';
import { CardFormat, LoyaltyCard } from '../../core/models';
import { CardFields, cardData, cardFields } from '../../core/contact-card';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/**
 * Le formulaire d'une carte dans la fiche : scanner (la caméra s'ouvre ici
 * même, plus dans une fenêtre à part), importer une photo, ou saisir ; puis
 * le nom, le logo, le format, la couleur et la note. Les lecteurs (@zxing)
 * sont chargés à la demande, seulement quand on scanne.
 */
@Component({
  selector: 'app-card-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent],
  template: `
    @let v = f();
    @if (scanning()) {
      <div class="scan">
        @if (scanError()) {
          <div class="scan-error">
            <div class="se-title">Caméra indisponible</div>
            <div class="se-text">{{ scanError() }}</div>
            <div class="se-hint">Utilisez « Importer une photo » : la lecture d'une image marche partout.</div>
          </div>
        } @else {
          <video #video class="scan-video" playsinline muted></video>
          <div class="scan-hint">Placez le code-barres ou le QR de la carte dans le cadre.</div>
        }
        <button type="button" class="btn btn-soft scan-stop" (click)="stopScan()">Arrêter le scan</button>
      </div>
    } @else {
      <div class="import-row">
        <button type="button" class="imp" (click)="startScan()"><f-icon name="card" [size]="20" color="#4E93B8" [width]="2" /><span>Scanner<br><b>avec la caméra</b></span></button>
        <button type="button" class="imp" (click)="photo.click()"><f-icon name="upload" [size]="20" color="#7A9B76" [width]="2" /><span>Importer<br><b>une photo</b></span></button>
      </div>
    }
    <input #photo type="file" accept="image/*" capture="environment" hidden (change)="onPhoto($event)" />
    @if (photoError()) { <div class="warn">{{ photoError() }}</div> }

    <div class="field-label">Nom de l'enseigne</div>
    <input class="input" [ngModel]="v.name" (ngModelChange)="setName($event)" placeholder="Ex : Carrefour" />

    <div class="field-label mt">Logo</div>
    <div class="logo-picker">
      <!-- Le monogramme est toujours là, sélectionné par défaut. -->
      <button type="button" class="logo-opt" [class.on]="!v.logo" (click)="set({ logo: '' })" title="Monogramme (initiales)">
        <f-avatar [ini]="ini(v.name)" [color]="v.color" [size]="46" />
      </button>
      @for (o of logos(); track o.dataUri) {
        <button type="button" class="logo-opt" [class.on]="v.logo === o.dataUri" (click)="set({ logo: o.dataUri })" [title]="o.name">
          <img [src]="o.dataUri" [alt]="o.name" />
        </button>
      }
      @if (v.logo && !inOpts()) {
        <button type="button" class="logo-opt on" title="Logo actuel"><img [src]="v.logo" [alt]="v.name" /></button>
      }
      @if (store.setting('cardLogoSearch')) {
        <button type="button" class="logo-search" [disabled]="logoBusy() || v.name.trim().length < 2" (click)="searchLogos()" title="Chercher un logo en ligne">
          <f-icon name="search" [size]="16" color="var(--ink2)" [width]="2.2" />
          <span>{{ logoBusy() ? 'Recherche…' : 'Chercher un logo' }}</span>
        </button>
      }
    </div>
    @if (store.setting('cardLogoSearch')) {
      @if (logoSearched() && !logoBusy() && !logos().length) {
        <div class="hint">Aucun logo trouvé pour ce nom. Le monogramme fera l'affaire.</div>
      }
    } @else {
      <div class="hint">Le monogramme (les initiales dans la couleur choisie) tient lieu de logo. La recherche en ligne est désactivée dans les réglages.</div>
    }

    <div class="field-label mt">Code de la carte</div>
    <input class="input" [ngModel]="v.code" (ngModelChange)="set({ code: $event })" placeholder="Scannez, ou saisissez le code" />

    <div class="field-label mt">Format du code</div>
    <select class="input" [ngModel]="v.format" (ngModelChange)="set({ format: $event })">
      @for (fm of formats; track fm.id) { <option [value]="fm.id">{{ fm.label }}</option> }
    </select>

    <div class="field-label mt">Couleur du logo</div>
    <div class="swatch-row">
      @for (col of palette; track col) {
        <button type="button" class="swatch" [style.background]="col" [style.box-shadow]="v.color === col ? '0 0 0 3px var(--surface),0 0 0 5px ' + col : 'none'"
                (click)="pickColor(col)" [attr.aria-label]="'Couleur ' + ($index + 1)" [attr.aria-pressed]="v.color === col"></button>
      }
    </div>

    <div class="field-label mt">Note (option.)</div>
    <input class="input" [ngModel]="v.note" (ngModelChange)="set({ note: $event })" placeholder="N° d'adhérent, expiration…" />
  `,
  styles: [`
    :host { display: block; }
    .mt { margin-top: 16px; }
    select.input { appearance: auto; }
    .import-row { display: flex; gap: 12px; margin-bottom: 18px; }
    .imp { flex: 1; display: flex; align-items: center; gap: 11px; padding: 14px 16px; border-radius: 14px; background: var(--soft); border: none; cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; color: var(--ink2); text-align: left; }
    .imp b { color: var(--ink); font-weight: 800; }
    .scan { margin-bottom: 18px; }
    .scan-video { width: 100%; border-radius: 14px; background: #111; aspect-ratio: 4/3; object-fit: cover; }
    .scan-hint { text-align: center; font-size: 13px; font-weight: 700; color: var(--ink3); margin-top: 10px; }
    .scan-stop { display: flex; margin: 10px auto 0; }
    .scan-error { text-align: center; padding: 10px 4px; }
    .se-title { font-weight: 800; color: var(--primary); font-size: 15px; }
    .se-text { font-size: 13.5px; font-weight: 600; color: var(--ink2); margin: 8px 0; }
    .se-hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); }
    .warn { background: #FDF0DA; color: #9A6A12; font-size: 13px; font-weight: 700; padding: 10px 14px; border-radius: 11px; margin-bottom: 14px; }
    .logo-picker { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .logo-opt { padding: 3px; border-radius: 14px; background: transparent; border: 2px solid transparent; cursor: pointer; line-height: 0; }
    .logo-opt.on { border-color: var(--primary); }
    .logo-opt img { width: 46px; height: 46px; border-radius: 11px; object-fit: contain; background: #fff; box-shadow: inset 0 0 0 1px var(--line2); }
    .logo-search { display: inline-flex; align-items: center; gap: 8px; height: 52px; padding: 0 16px; border-radius: 14px; background: var(--soft); border: 2px dashed var(--line2); color: var(--ink2); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
    .logo-search:disabled { opacity: .5; cursor: default; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); margin-top: 10px; }
    .swatch-row { display: flex; gap: 12px; flex-wrap: wrap; }
  `],
})
export class CardForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  readonly item = input<LoyaltyCard | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly formats = CARD_FORMATS;
  readonly palette = PALETTE;
  readonly ini = cardInitials;

  readonly f = signal<CardFields>(cardFields(null, cardColor('')));
  private initial = '';
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);
  /** La couleur a été choisie à la main : le nom ne la repropose plus. */
  private colorTouched = false;

  readonly logos = signal<{ name: string; domain: string; dataUri: string }[]>([]);
  readonly logoBusy = signal(false);
  /** Une recherche a été lancée : distingue « pas encore cherché » de « rien trouvé ». */
  readonly logoSearched = signal(false);
  /** Le logo retenu n'est pas parmi ceux proposés (celui de la carte enregistrée) : on le montre quand même. */
  readonly inOpts = computed(() => this.logos().some((o) => o.dataUri === this.f().logo));

  readonly scanning = signal(false);
  readonly scanError = signal<string | null>(null);
  readonly photoError = signal<string | null>(null);
  private video = viewChild<ElementRef<HTMLVideoElement>>('video');
  /** Le lecteur caméra et ses contrôles d'arrêt, gardés pour couper le flux. */
  private scanControls: { stop: () => void } | null = null;

  constructor() { inject(DestroyRef).onDestroy(() => this.stopScan()); }

  ngOnInit(): void {
    const c = this.item();
    this.colorTouched = !!c;
    this.f.set(cardFields(c, cardColor('')));
    this.initial = JSON.stringify(this.f());
  }

  submit(): ItemResult {
    const data = cardData(this.f());
    if (typeof data === 'string') { this.store.toast(data); return { kind: 'invalid' }; }
    return this.store.saveCard(this.item()?.id ?? null, data);
  }

  set(p: Partial<CardFields>): void { this.f.update((f) => ({ ...f, ...p })); }
  /** Le nom pilote la couleur suggérée ; changer le nom périme aussi les logos proposés. */
  setName(name: string): void {
    this.set({ name, ...(this.colorTouched ? {} : { color: cardColor(name) }) });
    this.logos.set([]); this.logoSearched.set(false);
  }
  pickColor(color: string): void { this.colorTouched = true; this.set({ color }); }

  async searchLogos(): Promise<void> {
    const name = this.f().name.trim();
    if (name.length < 2) { this.store.toast('Écris d’abord le nom de l’enseigne'); return; }
    this.logoBusy.set(true); this.logoSearched.set(true);
    this.logos.set(await this.store.cardLogos(name));
    this.logoBusy.set(false);
  }

  /** Ouvre la caméra dans le formulaire ; un code lu et connu remplit le code et son format. */
  async startScan(): Promise<void> {
    this.scanError.set(null); this.photoError.set(null);
    this.scanning.set(true);
    // La balise <video> n'existe qu'au rendu suivant.
    await new Promise((r) => setTimeout(r));
    const video = this.video()?.nativeElement;
    if (!video) return;
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const { BarcodeFormat } = await import('@zxing/library');
      const reader = new BrowserMultiFormatReader();
      this.scanControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
        if (!result) return;
        const fmt = formatFromScan(BarcodeFormat[result.getBarcodeFormat()]);
        if (!fmt) return; // format lu mais qu'on ne saurait pas réafficher : on ignore.
        this.read(result.getText(), fmt);
        this.stopScan();
      });
      // Fermé pendant le démarrage : on coupe tout de suite.
      if (!this.scanning()) this.stopScan();
    } catch (e) {
      // Pas de caméra, permission refusée, ou contexte non sécurisé (HTTP simple) :
      // le message renvoie vers l'import d'une photo, qui n'a besoin d'aucun de ça.
      this.scanError.set(this.scanMessage(e as Error));
    }
  }
  stopScan(): void { this.scanControls?.stop(); this.scanControls = null; this.scanning.set(false); }

  private read(code: string, format: CardFormat): void { this.set({ code, format }); this.store.toast('Code lu'); }

  private scanMessage(e: Error): string {
    const n = e?.name || '';
    if (n === 'NotAllowedError') return 'L\'accès à la caméra a été refusé.';
    if (n === 'NotFoundError') return 'Aucune caméra détectée sur cet appareil.';
    if (!window.isSecureContext) return 'La caméra n\'est disponible qu\'en HTTPS (ou sur localhost).';
    return 'La caméra n\'a pas pu démarrer.';
  }

  /** Lecture d'un code depuis une photo : marche partout, sans caméra ni HTTPS. */
  async onPhoto(ev: Event): Promise<void> {
    this.photoError.set(null);
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const { BarcodeFormat } = await import('@zxing/library');
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
      const fmt = formatFromScan(BarcodeFormat[result.getBarcodeFormat()]);
      if (!fmt) { this.photoError.set('Code lu, mais dans un format qu\'on ne sait pas réafficher.'); return; }
      this.read(result.getText(), fmt);
    } catch {
      this.photoError.set('Aucun code lisible sur cette image. Cadrez le code bien à plat, net et éclairé.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
