import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FinancesStore } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ConfirmComponent } from '../../shared/confirm';

/**
 * Ce qui sort du module et ce qui le remplace : export CSV, sauvegarde JSON,
 * restauration. Le serveur réserve ces routes à un administrateur ; l'onglet le
 * dit plutôt que d'offrir des boutons qui échoueraient.
 */
@Component({
  selector: 'fin-data-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ConfirmComponent],
  template: `
    @if (!foyer.isAdmin()) {
      <div class="card"><div class="sub">L'export et la sauvegarde du module sont réservés à un administrateur du foyer.</div></div>
    } @else {
      <div class="card">
        <div class="card-title sm">Exporter les opérations</div>
        <div class="sub">Toutes vos opérations dans un tableur (CSV), pour les retravailler ailleurs.</div>
        <div class="acts">
          <button class="btn btn-soft" (click)="store.exportCsv()"><f-icon name="export" [size]="16" color="var(--ink2)" /> Exporter (CSV)</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title sm">Sauvegarde du module Finances</div>
        <div class="sub">
          Comptes, catégories, contrats, opérations, règles et étiquettes, en un fichier JSON.
          Ce n'est <strong>pas</strong> une sauvegarde complète : les pièces jointes restent sur le disque du serveur,
          et la sauvegarde du fichier SQLite reste la référence.
        </div>
        <div class="acts">
          <button class="btn btn-soft" (click)="store.exportModule()"><f-icon name="export" [size]="16" color="var(--ink2)" /> Télécharger la sauvegarde</button>
          <label class="btn btn-soft">
            <input type="file" accept="application/json,.json" hidden (change)="onRestorePick($event)" />
            <f-icon name="upload" [size]="16" color="var(--ink2)" /> Restaurer depuis un fichier
          </label>
        </div>
      </div>

      @if (store.ui().restorePending) {
        <f-confirm [maxWidth]="460" icon="urgent" title="Remplacer toutes les données du module ?" confirmLabel="Remplacer"
          [disabled]="store.ui().busy" (cancel)="store.patch({ restorePending: null, restoreName: '' })" (confirm)="store.confirmRestore()">
          <strong>{{ store.ui().restoreName }}</strong> va remplacer l'intégralité du module Finances :
          comptes, opérations, contrats, règles. Ce qui existe aujourd'hui et ne figure pas dans ce
          fichier sera perdu. Le reste du foyer (agenda, courses, tâches) n'est pas touché.
          <br /><br />
          L'opération est en tout ou rien : si le fichier est incohérent, rien ne change.
        </f-confirm>
      }
    }
  `,
  styles: [`
    .card { background: var(--surface); border-radius: 20px; padding: 20px; box-shadow: var(--sh-card); margin-bottom: 18px; }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 4px; line-height: 1.55; max-width: 640px; }
    .acts { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    label.btn { cursor: pointer; }
  `],
})
export class FinancesDataTab {
  readonly store = inject(FinancesStore);
  readonly foyer = inject(FoyerStore);

  /** Read the backup file, without restoring anything: the modal asks first. */
  onRestorePick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.store.stageRestore(file);
    input.value = '';
  }
}
