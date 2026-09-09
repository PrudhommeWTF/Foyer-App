import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { ModalComponent } from '../shared/modal';
import { LoyaltyCard } from '../core/models';
import { CARD_FORMATS, bwipBcid, cardInitials, formatFromScan, formatLabel, isMatrix } from '../core/cards';
import { PALETTE } from '../core/constants';

/**
 * Cartes de fidélité : la liste par nom, l'affichage plein écran du code (QR ou
 * code-barres, redessiné pour être scanné en caisse) et la saisie, avec un import
 * par la caméra ou par une photo.
 *
 * Les librairies de lecture (@zxing/browser) et de rendu (bwip-js) sont
 * **chargées à la demande** (import dynamique) : elles ne pèsent pas sur le
 * premier chargement, seulement quand on scanne ou qu'on ouvre une carte.
 */
@Component({
  selector: 'screen-fidelite',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <div class="head-row">
        <div class="search">
          <f-icon name="search" [size]="18" color="var(--ink3)" [width]="2.2" />
          <input [ngModel]="store.ui().cardSearch" (ngModelChange)="store.patch({ cardSearch: $event })" placeholder="Rechercher une carte…" />
        </div>
        <button class="btn btn-primary" (click)="store.newCard()"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Nouvelle carte</button>
      </div>

      <div class="grid">
        @for (c of filtered(); track c.id) {
          <button class="card fid" (click)="store.showCard(c.id)">
            @if (c.logo) { <img class="logo-tile" [src]="c.logo" [alt]="c.name" /> }
            @else { <f-avatar [ini]="ini(c.name)" [color]="c.color" [size]="52" /> }
            <div class="info">
              <div class="name">{{ c.name }}</div>
              <div class="fmt">{{ formatLabel(c.format) }}</div>
            </div>
            <f-icon name="chevronRight" [size]="18" color="var(--ink3)" [width]="2.2" />
          </button>
        } @empty {
          <div class="card empty">
            <div class="empty-ico"><f-icon name="card" [size]="30" color="var(--ink3)" [width]="1.8" /></div>
            <div class="empty-title">Aucune carte de fidélité</div>
            <div class="empty-text">Ajoutez vos cartes une fois, et retrouvez leur code sur le téléphone à chaque passage en caisse.</div>
            <button class="btn btn-primary" (click)="store.newCard()"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Ajouter une carte</button>
          </div>
        }
      </div>
    </div>

    <!-- Affichage plein écran : le code, en grand, à présenter en caisse. -->
    @if (shown(); as c) {
      <f-modal [maxWidth]="440" (close)="store.closeCard()">
        <div class="show">
          <div class="show-head">
            @if (c.logo) { <img class="logo-tile" [src]="c.logo" [alt]="c.name" /> }
            @else { <f-avatar [ini]="ini(c.name)" [color]="c.color" [size]="46" /> }
            <div class="sh-name">{{ c.name }}</div>
          </div>
          <div class="code-box">
            @if (codeSvg(); as svg) {
              <img class="code-img" [class.matrix]="isMatrix(c.format)" [src]="svg" [alt]="'Code de ' + c.name" />
            } @else if (codeError()) {
              <div class="code-fallback">
                <div class="cf-title">Ce code ne se redessine pas</div>
                <div class="cf-code">{{ c.code }}</div>
                <div class="cf-hint">Montrez ce numéro, ou vérifiez le format dans la fiche.</div>
              </div>
            } @else {
              <div class="code-loading">Préparation du code…</div>
            }
          </div>
          <div class="code-text">{{ c.code }}</div>
          <div class="modal-actions center">
            <button class="btn btn-soft" (click)="store.editCard(c.id)"><f-icon name="edit" [size]="16" color="var(--ink2)" [width]="2" /> Modifier</button>
            <button class="btn btn-soft danger" (click)="store.patch({ cardDelId: c.id, cardShow: null })"><f-icon name="trash" [size]="16" color="var(--primary)" [width]="2" /> Supprimer</button>
          </div>
        </div>
      </f-modal>
    }

    <!-- Saisie / modification -->
    @if (store.ui().cardForm) {
      <f-modal [title]="formTitle()" [maxWidth]="520" (close)="store.patch({ cardForm: false })">
        <div class="import-row">
          <button class="imp" (click)="store.openScan()"><f-icon name="card" [size]="20" color="#4E93B8" [width]="2" /><span>Scanner<br><b>avec la caméra</b></span></button>
          <button class="imp" (click)="photo.click()"><f-icon name="upload" [size]="20" color="#7A9B76" [width]="2" /><span>Importer<br><b>une photo</b></span></button>
        </div>
        <input #photo type="file" accept="image/*" capture="environment" hidden (change)="onPhoto($event)" />
        @if (photoError()) { <div class="warn">{{ photoError() }}</div> }

        <div class="field">
          <div class="field-label">Nom de l'enseigne</div>
          <input class="input" [ngModel]="store.ui().caName" (ngModelChange)="store.onCardName($event)" placeholder="Ex : Carrefour" />
        </div>
        <div class="field-label" style="margin-top:16px">Logo</div>
        <div class="logo-picker">
          <!-- Le monogramme est toujours là, sélectionné par défaut. -->
          <button class="logo-opt" [class.on]="!store.ui().caLogo" (click)="store.useMonogram()" title="Monogramme (initiales)">
            <f-avatar [ini]="ini(store.ui().caName)" [color]="store.ui().caColor" [size]="46" />
          </button>
          @for (o of store.ui().logoOpts; track o.dataUri) {
            <button class="logo-opt" [class.on]="store.ui().caLogo === o.dataUri" (click)="store.pickCardLogo(o.dataUri)" [title]="o.name">
              <img [src]="o.dataUri" [alt]="o.name" />
            </button>
          }
          @if (store.setting('cardLogoSearch')) {
            <!-- La recherche prend place dans la rangée, à la suite des logos. -->
            <button class="logo-search" [disabled]="store.ui().logoBusy || store.ui().caName.trim().length < 2" (click)="store.searchCardLogos()" title="Chercher un logo en ligne">
              <f-icon name="search" [size]="16" color="var(--ink2)" [width]="2.2" />
              <span>{{ store.ui().logoBusy ? 'Recherche…' : 'Chercher un logo' }}</span>
            </button>
          }
        </div>
        @if (store.setting('cardLogoSearch')) {
          @if (store.ui().logoSearched && !store.ui().logoBusy && !store.ui().logoOpts.length) {
            <div class="hint">Aucun logo trouvé pour ce nom. Le monogramme fera l'affaire.</div>
          }
        } @else {
          <div class="hint">Le monogramme (les initiales dans la couleur choisie) tient lieu de logo. La recherche en ligne est désactivée dans les réglages.</div>
        }

        <div class="field" style="margin-top:16px">
          <div class="field-label">Code de la carte</div>
          <input class="input" [ngModel]="store.ui().caCode" (ngModelChange)="store.patch({ caCode: $event })" placeholder="Scannez, ou saisissez le code" />
        </div>

        <div class="field-label" style="margin-top:16px">Format du code</div>
        <select class="input" [ngModel]="store.ui().caFormat" (ngModelChange)="store.patch({ caFormat: $event })">
          @for (f of formats; track f.id) { <option [value]="f.id">{{ f.label }}</option> }
        </select>

        <div class="field-label" style="margin-top:16px">Couleur du logo</div>
        <div class="swatch-row">
          @for (col of palette; track col) {
            <div class="swatch" [class.on]="store.ui().caColor === col" [style.background]="col"
                 [style.box-shadow]="store.ui().caColor === col ? '0 0 0 3px var(--surface),0 0 0 5px ' + col : 'none'"
                 (click)="store.pickCardColor(col)"></div>
          }
        </div>

        <div class="field" style="margin-top:16px">
          <div class="field-label">Note (option.)</div>
          <input class="input" [ngModel]="store.ui().caNote" (ngModelChange)="store.patch({ caNote: $event })" placeholder="N° d'adhérent, expiration…" />
        </div>

        <div class="modal-actions">
          <button class="btn btn-soft" (click)="store.patch({ cardForm: false })">Annuler</button>
          <button class="btn btn-primary" (click)="store.saveCard()">Enregistrer</button>
        </div>
      </f-modal>
    }

    <!-- Scan caméra -->
    @if (store.ui().scanOpen) {
      <f-modal title="Scanner la carte" [maxWidth]="460" (close)="store.closeScan()">
        <div class="scan">
          @if (scanError()) {
            <div class="scan-error">
              <div class="se-title">Caméra indisponible</div>
              <div class="se-text">{{ scanError() }}</div>
              <div class="se-hint">Fermez et utilisez « Importer une photo » : la lecture d'une image marche partout.</div>
            </div>
          } @else {
            <video #video class="scan-video" playsinline muted></video>
            <div class="scan-hint">Placez le code-barres ou le QR de la carte dans le cadre.</div>
          }
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .head-row { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
    .search { flex: 1; display: flex; align-items: center; gap: 10px; background: var(--surface); border-radius: 14px; padding: 12px 16px; box-shadow: 0 6px 16px -14px rgba(90,60,40,.6); }
    .search input { flex: 1; border: none; background: transparent; font-size: 14.5px; font-weight: 600; color: var(--ink); outline: none; }
    .head-row .btn { flex: none; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
    :host-context(.shell.narrow) .grid { grid-template-columns: 1fr; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }

    .card.fid { display: flex; align-items: center; gap: 14px; padding: 16px 18px; border-radius: 18px; width: 100%; text-align: left; cursor: pointer; border: none; background: var(--surface); box-shadow: 0 8px 20px -18px rgba(90,60,40,.7); }
    .card.fid .info { flex: 1; min-width: 0; }
    .card.fid .name { font-weight: 800; font-size: 15.5px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card.fid .fmt { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 2px; }

    .card.empty { grid-column: 1 / -1; padding: 44px 24px; text-align: center; border-radius: 20px; }
    .empty-ico { width: 60px; height: 60px; margin: 0 auto 16px; border-radius: 50%; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .empty-title { font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--ink); }
    .empty-text { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px auto 20px; max-width: 340px; }

    .show-head { display: flex; align-items: center; gap: 13px; margin-bottom: 18px; }
    .sh-name { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--ink); }
    .code-box { background: #fff; border-radius: 16px; padding: 22px; display: flex; align-items: center; justify-content: center; min-height: 170px; box-shadow: inset 0 0 0 1px var(--line2); }
    .code-img { width: 100%; height: auto; image-rendering: pixelated; }
    .code-img.matrix { max-width: 240px; }
    .code-loading { color: var(--ink3); font-weight: 700; font-size: 14px; }
    .code-fallback { text-align: center; }
    .cf-title { font-weight: 800; color: var(--primary); font-size: 14px; }
    .cf-code { font-size: 22px; font-weight: 800; color: var(--ink); letter-spacing: .04em; margin: 8px 0; word-break: break-all; }
    .cf-hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); }
    .code-text { text-align: center; font-size: 14px; font-weight: 700; color: var(--ink2); letter-spacing: .04em; margin: 14px 0 18px; word-break: break-all; }

    .import-row { display: flex; gap: 12px; margin-bottom: 18px; }
    .imp { flex: 1; display: flex; align-items: center; gap: 11px; padding: 14px 16px; border-radius: 14px; background: var(--soft); border: none; cursor: pointer; font-size: 13px; font-weight: 700; color: var(--ink2); text-align: left; }
    .imp b { color: var(--ink); font-weight: 800; }

    .field { margin-bottom: 4px; }
    select.input { appearance: auto; }

    .logo-tile { width: 52px; height: 52px; border-radius: 14px; object-fit: contain; background: #fff; box-shadow: inset 0 0 0 1px var(--line2); flex: none; }
    .show-head .logo-tile { width: 46px; height: 46px; }
    .logo-picker { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .logo-opt { padding: 3px; border-radius: 14px; background: transparent; border: 2px solid transparent; cursor: pointer; line-height: 0; }
    .logo-opt.on { border-color: var(--primary); }
    .logo-opt img { width: 46px; height: 46px; border-radius: 11px; object-fit: contain; background: #fff; box-shadow: inset 0 0 0 1px var(--line2); }
    .logo-search { display: inline-flex; align-items: center; gap: 8px; height: 52px; padding: 0 16px; border-radius: 14px; background: var(--soft); border: 2px dashed var(--line2); color: var(--ink2); font-size: 13px; font-weight: 700; cursor: pointer; }
    .logo-search:disabled { opacity: .5; cursor: default; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); margin-top: 10px; }

    .swatch-row { display: flex; gap: 12px; }
    .swatch { width: 30px; height: 30px; border-radius: 50%; cursor: pointer; }

    .warn { background: #FDF0DA; color: #9A6A12; font-size: 13px; font-weight: 700; padding: 10px 14px; border-radius: 11px; margin-bottom: 14px; }

    .modal-actions { display: flex; gap: 12px; margin-top: 20px; justify-content: flex-end; }
    .modal-actions.center { justify-content: center; }
    .btn-soft.danger { color: var(--primary); }

    .scan-video { width: 100%; border-radius: 14px; background: #111; aspect-ratio: 4/3; object-fit: cover; }
    .scan-hint { text-align: center; font-size: 13px; font-weight: 700; color: var(--ink3); margin-top: 12px; }
    .scan-error { text-align: center; padding: 10px 4px; }
    .se-title { font-weight: 800; color: var(--primary); font-size: 15px; }
    .se-text { font-size: 13.5px; font-weight: 600; color: var(--ink2); margin: 8px 0; }
    .se-hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); }
  `],
})
export class FideliteScreen implements OnDestroy {
  store = inject(FoyerStore);
  private d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  formats = CARD_FORMATS;
  palette = PALETTE;
  formatLabel = formatLabel;
  isMatrix = isMatrix;
  ini = cardInitials;

  private video = viewChild<ElementRef<HTMLVideoElement>>('video');

  readonly codeSvg = signal<string | null>(null);
  readonly codeError = signal(false);
  readonly scanError = signal<string | null>(null);
  readonly photoError = signal<string | null>(null);

  /** Le lecteur caméra et ses contrôles d'arrêt, gardés pour couper le flux. */
  private scanControls: { stop: () => void } | null = null;

  filtered = computed(() => {
    const q = this.store.ui().cardSearch.trim().toLowerCase();
    const cards = [...this.d().cards].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return q ? cards.filter((c) => c.name.toLowerCase().includes(q)) : cards;
  });

  shown = computed<LoyaltyCard | null>(() => this.d().cards.find((c) => c.id === this.store.ui().cardShow) || null);
  formTitle = computed(() => (this.store.ui().caEditId ? 'Modifier la carte' : 'Nouvelle carte'));

  constructor() {
    // Le code affiché suit la carte ouverte : on le redessine à chaque ouverture,
    // et on l'efface à la fermeture pour ne pas montrer l'ancien une fraction de seconde.
    effect(() => {
      const c = this.shown();
      this.codeSvg.set(null); this.codeError.set(false);
      if (c) void this.renderCode(c);
    });
    // La modale de scan pilote la caméra : ouverte, on démarre ; fermée, on coupe.
    effect(() => {
      const open = this.store.ui().scanOpen;
      if (open) { this.scanError.set(null); queueMicrotask(() => void this.startScan()); }
      else this.stopScan();
    });
  }

  ngOnDestroy(): void { this.stopScan(); }

  /** Rend le code en SVG (bwip-js), posé en data-URI dans une balise <img>. */
  private async renderCode(c: LoyaltyCard): Promise<void> {
    try {
      const bwip = await import('bwip-js/browser');
      const opts = isMatrix(c.format)
        ? { bcid: bwipBcid(c.format), text: c.code, scale: 5, padding: 2 }
        : { bcid: bwipBcid(c.format), text: c.code, scale: 3, height: 16, includetext: true, textxalign: 'center' as const };
      const svg = bwip.toSVG(opts);
      // Si la carte a été fermée entre-temps, ne pas poser un code périmé.
      if (this.store.ui().cardShow !== c.id) return;
      this.codeSvg.set('data:image/svg+xml;utf8,' + encodeURIComponent(svg));
    } catch {
      // Un code qui ne correspond pas à sa symbologie (mauvais nombre de chiffres…)
      // fait échouer le rendu : on montre le numéro en clair plutôt qu'un vide.
      if (this.store.ui().cardShow === c.id) this.codeError.set(true);
    }
  }

  /** Démarre la lecture par la caméra ; sur un code lu et connu, ouvre la saisie pré-remplie. */
  private async startScan(): Promise<void> {
    const video = this.video()?.nativeElement;
    if (!video) return;
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const { BarcodeFormat } = await import('@zxing/library');
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
        if (!result) return;
        const fmt = formatFromScan(BarcodeFormat[result.getBarcodeFormat()]);
        if (!fmt) return; // format lu mais qu'on ne saurait pas réafficher : on ignore.
        this.stopScan();
        this.store.cardFromScan(result.getText(), fmt);
      });
      this.scanControls = controls;
    } catch (e) {
      // Pas de caméra, permission refusée, ou contexte non sécurisé (HTTP simple) :
      // le message renvoie vers l'import d'une photo, qui n'a besoin d'aucun de ça.
      this.scanError.set(this.scanMessage(e as Error));
    }
  }

  private stopScan(): void { this.scanControls?.stop(); this.scanControls = null; }

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
      const reader = new BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(url);
      const fmt = formatFromScan(BarcodeFormat[result.getBarcodeFormat()]);
      if (!fmt) { this.photoError.set('Code lu, mais dans un format qu\'on ne sait pas réafficher.'); return; }
      this.store.patch({ caCode: result.getText(), caFormat: fmt });
    } catch {
      this.photoError.set('Aucun code lisible sur cette image. Cadrez le code bien à plat, net et éclairé.');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
