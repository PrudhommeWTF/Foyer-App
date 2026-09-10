import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { relTime } from '../core/activity';

/**
 * Ligne d'attribution sous une fiche : qui l'a créée, et qui l'a modifiée en
 * dernier. Les dates sont relatives (« il y a 3 min », « hier »), comme le fil
 * d'activité de l'accueil. Rien ne s'affiche tant qu'aucun horodatage n'est
 * connu (fiches d'avant le suivi). L'accord (« Créé » / « Créée ») suit `fem`,
 * pour que la tâche soit féminine et l'événement masculin.
 */
@Component({
  selector: 'f-stamp',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (createdAt() || modLine()) {
      <div class="stamp">
        @if (createdAt(); as c) { <div>{{ fem() ? 'Créée' : 'Créé' }}{{ createdBy() ? ' par ' + createdBy() : '' }} · {{ rel(c) }}</div> }
        @if (modLine()) { <div>{{ fem() ? 'Modifiée' : 'Modifié' }}{{ modifiedBy() ? ' par ' + modifiedBy() : '' }} · {{ rel(modifiedAt()!) }}</div> }
      </div>
    }
  `,
  styles: [`
    .stamp { margin-top: 4px; font-size: 12px; line-height: 1.55; color: var(--ink3); }
  `],
})
export class StampComponent {
  /** Nom du créateur, déjà résolu (vide si inconnu ou membre disparu). */
  readonly createdBy = input('');
  readonly createdAt = input<string | null | undefined>(null);
  /** Nom du dernier modificateur, déjà résolu. */
  readonly modifiedBy = input('');
  readonly modifiedAt = input<string | null | undefined>(null);
  /** Accord au féminin (une tâche) plutôt qu'au masculin (un événement). */
  readonly fem = input(false);
  // Figé à l'ouverture : la fiche vit le temps d'une modale, pas besoin d'une horloge vive.
  private readonly now = Date.now();
  /** La ligne « modifié » n'a de sens que si la retouche est postérieure à la création. */
  readonly modLine = computed(() => { const up = this.modifiedAt(); return !!up && up !== this.createdAt(); });
  rel(iso: string): string { return relTime(iso, this.now); }
}
