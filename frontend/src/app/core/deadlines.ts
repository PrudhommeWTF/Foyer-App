// Comment se nomment les échéances d'un contrat.
//
// Les deux libellés (long et court) sont lus dans trois endroits qui ne se
// ressemblent pas : une notification, une case de calendrier large de quelques
// dizaines de pixels, et une tâche recopiée dans les listes du foyer. Les écrire
// une fois est la seule façon qu'ils disent partout la même chose.
import type { FinDeadlineKind } from './finances.api';

export function deadlineLabel(kind: FinDeadlineKind | string): string {
  return kind === 'preavis' ? 'Dernier jour pour résilier'
    : kind === 'renouvellement' ? 'Reconduction tacite'
    : 'Fin du contrat';
}

/** Version courte : une case de calendrier fait quelques dizaines de pixels. */
export function shortDeadlineLabel(kind: FinDeadlineKind | string): string {
  return kind === 'preavis' ? 'Résilier' : kind === 'renouvellement' ? 'Reconduction' : 'Fin';
}
