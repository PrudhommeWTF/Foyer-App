import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { FILE_TYPE_COLORS, PALETTE } from '../core/constants';
import { FileType } from '../core/models';

@Component({
  selector: 'screen-documents',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      <div class="toolbar">
        <div class="search">
          <f-icon name="search" [size]="18" color="var(--ink3)" [width]="2.2" />
          <input [ngModel]="store.ui().docSearch" (ngModelChange)="store.patch({ docSearch: $event })" placeholder="Rechercher un document…" />
        </div>
      </div>

      @if (docFolder() === null && !searching()) {
        <div class="folder-grid">
          @for (f of folders(); track f.id) {
            <div class="folder-card">
              <div class="folder-body" (click)="store.patch({ docFolder: f.id, docSearch: '' })">
                <div class="folder-ic" [style.background]="store.tint(f.color)">
                  <f-icon name="folder" [size]="26" [color]="f.color" [width]="2" />
                </div>
                <div class="folder-name">{{ f.name }}</div>
                <div class="folder-count">{{ count(f.id) }} fichiers</div>
              </div>
              <div class="folder-acts">
                <button class="icon-btn sm" (click)="store.editFolder(f.id)"><f-icon name="edit" [size]="14" color="var(--ink2)" /></button>
                <button class="icon-btn sm" (click)="store.patch({ folderDelId: f.id })"><f-icon name="trash" [size]="14" color="var(--primary)" /></button>
              </div>
            </div>
          }
          <button class="folder-new" (click)="store.newFolder()">
            <f-icon name="plus" [size]="22" color="var(--ink2)" />
            <span>Nouveau dossier</span>
          </button>
        </div>
      }

      @if (docFolder() !== null && !searching()) {
        <div class="crumb">
          <span class="crumb-link" (click)="store.patch({ docFolder: null })">Tous les dossiers</span>
          <f-icon name="chevronRight" [size]="15" color="var(--ink3)" />
          <span class="crumb-cur">{{ currentFolderName() }}</span>
        </div>
        <div class="folder-head">
          <button class="btn btn-primary" (click)="store.newFile()"><f-icon name="plus" [size]="18" color="#fff" /> Ajouter un fichier</button>
        </div>
      }

      <div class="list-title overline">{{ listTitle() }}</div>
      <div class="file-list">
        @for (fl of fileList(); track fl.id) {
          <div class="file-row">
            <div class="type-badge" [style.background]="FILE_TYPE_COLORS[fl.type]">{{ fl.type }}</div>
            <div class="file-main">
              <div class="file-name">{{ fl.name }}</div>
              <div class="file-meta">{{ folderName(fl.folderId) }} · {{ fl.date }}</div>
            </div>
            @if (isDataUrl(fl.data)) {
              <a class="icon-btn" [href]="fl.data" [download]="fl.name"><f-icon name="download" [size]="16" color="var(--ink2)" /></a>
            }
            <button class="icon-btn" (click)="store.editFile(fl.id)"><f-icon name="edit" [size]="16" color="var(--ink2)" /></button>
            <button class="icon-btn" (click)="store.patch({ fileDelId: fl.id })"><f-icon name="trash" [size]="16" color="var(--primary)" /></button>
          </div>
        } @empty {
          <div class="file-empty">Aucun fichier ici</div>
        }
      </div>
    </div>

    @if (store.ui().folderForm) {
      <f-modal [title]="store.ui().foEditId ? 'Modifier le dossier' : 'Nouveau dossier'" [maxWidth]="440" (close)="store.patch({ folderForm: false })">
        <label class="field-label">Nom du dossier</label>
        <input class="input" [ngModel]="store.ui().foName" (ngModelChange)="store.patch({ foName: $event })" placeholder="Ex : Véhicules" />
        <label class="field-label" style="margin-top:20px">Couleur</label>
        <div class="swatch-row">
          @for (c of palette; track c) {
            <button class="swatch" [class.active]="store.ui().foColor === c" [style.background]="c" (click)="store.patch({ foColor: c })"></button>
          }
        </div>
        <div class="modal-acts">
          <button class="btn btn-soft" (click)="store.patch({ folderForm: false })">Annuler</button>
          <button class="btn btn-primary" (click)="store.saveFolder()">Enregistrer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().fileForm) {
      <f-modal [title]="store.ui().fiEditId ? 'Modifier le fichier' : 'Ajouter un fichier'" [maxWidth]="500" (close)="store.patch({ fileForm: false })">
        <label class="upload">
          <input type="file" (change)="onUpload($event)" />
          <div class="upload-ic"><f-icon name="upload" [size]="20" color="var(--ink2)" /></div>
          <div>
            <div class="upload-t">Téléverser un fichier</div>
            <div class="upload-s">{{ store.ui().fiData ? 'Fichier chargé ✓' : 'PDF, image, document…' }}</div>
          </div>
        </label>

        <label class="field-label">Nom du fichier</label>
        <input class="input" [ngModel]="store.ui().fiName" (ngModelChange)="store.patch({ fiName: $event })" placeholder="Ex : Passeport — Léa.pdf" />

        <label class="field-label" style="margin-top:20px">Dossier</label>
        <div class="seg">
          @for (f of folders(); track f.id) {
            <button [class.active]="store.ui().fiFolderId === f.id" (click)="store.patch({ fiFolderId: f.id })">{{ f.name }}</button>
          }
        </div>

        <label class="field-label" style="margin-top:20px">Type</label>
        <div class="seg">
          @for (t of fileTypes; track t) {
            <button [class.active]="store.ui().fiType === t" (click)="store.patch({ fiType: t })">{{ t }}</button>
          }
        </div>

        <div class="modal-acts">
          <button class="btn btn-soft" (click)="store.patch({ fileForm: false })">Annuler</button>
          <button class="btn btn-primary" (click)="store.saveFile()">Enregistrer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().folderDelId) {
      <f-modal [title]="'Supprimer ce dossier ?'" [maxWidth]="400" (close)="store.patch({ folderDelId: null })">
        <p class="warn">« {{ delFolderName() }} » et ses {{ delFolderCount() }} fichiers seront supprimés. Cette action est définitive.</p>
        <div class="modal-acts">
          <button class="btn btn-soft" (click)="store.patch({ folderDelId: null })">Annuler</button>
          <button class="btn btn-danger" (click)="store.confirmFolderDel()">Supprimer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().fileDelId) {
      <f-modal [title]="'Supprimer ce fichier ?'" [maxWidth]="400" (close)="store.patch({ fileDelId: null })">
        <p class="warn">« {{ delFileName() }} » sera définitivement supprimé.</p>
        <div class="modal-acts">
          <button class="btn btn-soft" (click)="store.patch({ fileDelId: null })">Annuler</button>
          <button class="btn btn-danger" (click)="store.confirmFileDel()">Supprimer</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .toolbar { display: flex; gap: 14px; margin-bottom: 22px; }
    .search { flex: 1; display: flex; align-items: center; gap: 10px; background: var(--surface); border-radius: 14px; padding: 12px 16px; box-shadow: var(--sh-card); }
    .search input { flex: 1; border: none; background: transparent; font-size: 14.5px; font-weight: 600; color: var(--ink); outline: none; }
    .search input::placeholder { color: var(--ink3); }

    .folder-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px; margin-bottom: 30px; }
    :host-context(.shell.narrow) .folder-grid { grid-template-columns: 1fr; }
    .folder-card { position: relative; background: var(--surface); border-radius: 20px; padding: 22px; box-shadow: var(--sh-card); }
    .folder-body { cursor: pointer; }
    .folder-ic { width: 52px; height: 52px; border-radius: 16px; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; }
    .folder-name { font-weight: 800; font-size: 17px; color: var(--ink); }
    .folder-count { font-size: 13px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .folder-acts { position: absolute; top: 16px; right: 16px; display: flex; gap: 6px; }
    .folder-new { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 150px; background: var(--soft); border: 2px dashed var(--line2); border-radius: 20px; cursor: pointer; color: var(--ink2); font-size: 14px; font-weight: 800; font-family: var(--font-body); }
    .folder-new:hover { background: var(--soft2); }

    .crumb { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 18px; font-size: 14px; font-weight: 800; color: var(--ink2); }
    .crumb-link { cursor: pointer; }
    .crumb-link:hover { color: var(--primary); }
    .crumb-cur { color: var(--ink); }
    .folder-head { margin-bottom: 20px; }

    .list-title { margin-bottom: 14px; }
    .file-list { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
    .file-row { display: flex; align-items: center; gap: 14px; background: var(--surface); border-radius: 16px; padding: 14px 16px; box-shadow: var(--sh-card); }
    .type-badge { width: 44px; height: 44px; flex: none; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; color: #fff; }
    .file-main { flex: 1; min-width: 0; }
    .file-name { font-weight: 800; font-size: 15px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-meta { font-size: 12.5px; font-weight: 700; color: var(--ink3); }
    a.icon-btn { text-decoration: none; }
    .file-empty { background: var(--surface); border-radius: 16px; padding: 36px; text-align: center; color: var(--ink3); font-weight: 700; font-size: 14px; box-shadow: var(--sh-card); }

    .swatch.active { box-shadow: 0 0 0 3px var(--surface), 0 0 0 5px var(--ink3); }
    .upload { display: flex; align-items: center; gap: 14px; padding: 16px; border-radius: 14px; border: 2px dashed var(--line2); background: var(--soft); cursor: pointer; margin-bottom: 20px; }
    .upload input[type=file] { position: absolute; width: 0; height: 0; opacity: 0; }
    .upload-ic { width: 44px; height: 44px; flex: none; border-radius: 12px; background: var(--soft2); display: flex; align-items: center; justify-content: center; }
    .upload-t { font-size: 14px; font-weight: 800; color: var(--ink); }
    .upload-s { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .modal-acts { display: flex; gap: 12px; margin-top: 26px; }
    .modal-acts .btn { flex: 1; }
    .warn { font-size: 14px; font-weight: 600; color: var(--ink2); line-height: 1.4; margin: 0; }
    @media (max-width: 860px) { .folder-grid { grid-template-columns: 1fr; } }
  `],
})
export class DocumentsScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  readonly FILE_TYPE_COLORS = FILE_TYPE_COLORS;
  readonly palette = PALETTE;
  readonly fileTypes: FileType[] = ['PDF', 'IMG', 'DOC', 'XLS', 'AUTRE'];

  folders = computed(() => this.d().folders);
  docFolder = computed(() => this.store.ui().docFolder);
  searching = computed(() => this.store.ui().docSearch.trim().length > 0);

  fileList = computed(() => {
    const q = this.store.ui().docSearch.trim().toLowerCase();
    const files = this.d().files;
    if (q) return files.filter((f) => f.name.toLowerCase().includes(q));
    const fld = this.docFolder();
    if (fld) return files.filter((f) => f.folderId === fld);
    return files;
  });

  currentFolderName = computed(() => this.folderName(this.docFolder()));
  listTitle = computed(() => {
    if (this.searching()) return 'Résultats';
    if (this.docFolder()) return this.currentFolderName();
    return 'Fichiers récents';
  });

  delFolderName = computed(() => this.folderName(this.store.ui().folderDelId));
  delFolderCount = computed(() => {
    const id = this.store.ui().folderDelId;
    return id ? this.count(id) : 0;
  });
  delFileName = computed(() => this.d().files.find((f) => f.id === this.store.ui().fileDelId)?.name ?? '');

  count(folderId: string): number { return this.d().files.filter((f) => f.folderId === folderId).length; }
  folderName(id: string | null): string { return this.d().folders.find((f) => f.id === id)?.name ?? ''; }
  isDataUrl(data?: string | null): boolean { return typeof data === 'string' && data.startsWith('data:'); }

  onUpload(e: Event): void {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) this.store.onFileUpload(f);
  }
}
