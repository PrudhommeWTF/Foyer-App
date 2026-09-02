// Comment se nomment les échéances d'un contrat.
//
// Les trois libellés sont lus dans quatre endroits qui ne se ressemblent pas :
// une notification, une case de calendrier large de quelques dizaines de pixels,
// une tâche recopiée dans les listes du foyer, et la tuile d'accueil. Les écrire
// une fois est la seule façon qu'ils disent partout la même chose.
import type { FinDeadline, FinDeadlineKind } from './finances.api';

/** Horizon de l'accueil. Deux mois : au-delà, rien n'appelle un geste aujourd'hui. */
export const DEADLINE_HORIZON_DAYS = 60;

export function deadlineLabel(kind: FinDeadlineKind | string): string {
  return kind === 'preavis' ? 'Dernier jour pour résilier'
    : kind === 'renouvellement' ? 'Reconduction tacite'
    : 'Fin du contrat';
}

/** Version courte : une case de calendrier fait quelques dizaines de pixels. */
export function shortDeadlineLabel(kind: FinDeadlineKind | string): string {
  return kind === 'preavis' ? 'Résilier' : kind === 'renouvellement' ? 'Reconduction' : 'Fin';
}

/** « Aujourd'hui », « Demain », « Dans 12 jours ». */
export function inDaysLabel(days: number): string {
  return days <= 0 ? "Aujourd'hui" : days === 1 ? 'Demain' : `Dans ${days} jours`;
}

/**
 * Les échéances qui appellent un geste : à venir, dans l'horizon, les plus
 * proches d'abord.
 *
 * Les échéances passées sont écartées **de l'accueil seulement**. L'écran
 * Contrats les montre, et c'est là leur place : une fenêtre de résiliation
 * manquée explique pourquoi rien n'est possible cette année, mais elle n'appelle
 * plus aucune action, donc elle n'a rien à faire sur un écran qui sert à agir.
 */
export function upcomingDeadlines(deadlines: FinDeadline[], horizon = DEADLINE_HORIZON_DAYS): FinDeadline[] {
  return (deadlines || [])
    .filter((d) => d.daysAway >= 0 && d.daysAway <= horizon)
    .slice()
    .sort((a, b) => a.daysAway - b.daysAway || a.contractName.localeCompare(b.contractName));
}
