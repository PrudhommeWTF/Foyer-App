import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FinOwnerKind } from '../../core/finances.api';
import { FinancesStore } from '../../core/finances.store';
import { IconComponent } from '../../core/icon';
import { FILE_TYPE_COLORS } from '../../core/constants';
import { fmtBytes } from '../../core/helpers';

/**
 * Les pièces jointes d'un élément ouvert (contrat, opération) : la liste, le
 * téléchargement, la suppression et l'envoi. Une seule fiche est ouverte à la
 * fois, d'où la liste unique `store.attachments()`.
 */
@Component({
  selector: 'fin-attachments',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="pieces">
      @for (a of store.attachments(); track a.id) {
        <div class="piece">
          <f-icon name="documents" [size]="15" [color]="color(a.mime)" [width]="2" />
          <button class="p-name" (click)="store.openAttachment(a)">{{ a.name }}</button>
          <span class="p-size">{{ size(a.size) }}</span>
          <button class="icon-btn sm" aria-label="Supprimer la pièce" (click)="store.deleteAttachment(a.id)">
            <f-icon name="trash" [size]="13" color="var(--primary)" />
          </button>
        </div>
      } @empty {
        <div class="none">{{ empty() }}</div>
      }
    </div>
    <label class="uploader">
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.heic" hidden (change)="pick($event)" [disabled]="store.ui().busy" />
      <f-icon name="upload" [size]="15" color="var(--primary)" [width]="2.4" />
      <span>{{ store.ui().busy ? 'Envoi…' : label() }}</span>
    </label>
    <div class="hint">PDF, JPEG, PNG, WEBP, GIF ou HEIC, 20 Mo au plus. Le type est reconnu au contenu, pas à l'extension.</div>
  `,
  styles: [`
    :host { display: block; }
    .pieces { display: flex; flex-direction: column; gap: 6px; }
    .piece { display: flex; align-items: center; gap: 9px; background: var(--soft); border-radius: 11px; padding: 7px 10px; }
    .p-name { flex: 1; min-width: 0; text-align: left; background: none; border: none; padding: 0; font-family: inherit; font-size: 12.5px; font-weight: 800; color: var(--ink); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .p-name:hover { color: var(--primary); }
    .p-size { flex: none; font-size: 11.5px; font-weight: 700; color: var(--ink3); font-variant-numeric: tabular-nums; }
    .none { font-size: 12.5px; font-weight: 700; color: var(--ink3); }
    .uploader { display: inline-flex; align-items: center; gap: 7px; margin-top: 10px; border-radius: 11px; padding: 8px 13px; background: var(--soft2); font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; }
    .uploader:has(input:disabled) { opacity: .5; cursor: default; }
    .hint { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; line-height: 1.45; }
  `],
})
export class FinAttachments {
  readonly owner = input.required<FinOwnerKind>();
  readonly ownerId = input.required<number>();
  readonly empty = input('Aucune pièce.');
  readonly label = input('Ajouter une pièce');

  readonly store = inject(FinancesStore);

  /** Même code couleur que l'écran Documents : terracotta pour un PDF, vert pour une image. */
  color(mime: string): string { return FILE_TYPE_COLORS[mime === 'application/pdf' ? 'PDF' : 'IMG']; }
  size(bytes: number): string { return fmtBytes(bytes); }

  /** Envoie le fichier choisi, puis vide le champ pour pouvoir renvoyer le même. */
  pick(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    if (file) void this.store.uploadAttachment(this.owner(), this.ownerId(), file);
    el.value = '';
  }
}
