// La liste Entretien : une seule par foyer, partagée, qui porte les gestes
// d'entretien de la maison (voir docs/entretien.md).
//
// Ses tâches sont des tâches comme les autres (récurrence, rappels, coche,
// historique, rejeu hors ligne) : Entretien n'est pas un moteur de plus, c'est
// une vue et quelques champs (`maintenance`, voir tasks/ops.ts). Ce fichier ne
// tient que ce qui fait d'elle une liste à part : elle existe toujours, elle
// est unique, et un client ne peut ni la retirer ni en changer le type. Sans ce
// garde, l'enregistrement du document qui l'omettrait emporterait avec elle
// tous les gestes et leur historique (la réconciliation des tâches retire les
// tâches d'une liste disparue).

/** Identifiant fixe : la migration, l'onboarding et ce garde s'accordent sans se chercher. */
export const ENTRETIEN_LIST_ID = 'entretien';

type Doc = Record<string, any>;

/** La liste telle qu'elle naît. Sa couleur et son icône restent au choix du foyer. */
export const entretienList = (position: number): Doc =>
  ({ id: ENTRETIEN_LIST_ID, name: 'Entretien', color: '#7A9B76', icon: 'outils', kind: 'entretien', scope: 'shared', position });

/**
 * Remet la liste Entretien telle que le serveur la tient, dans un document reçu
 * d'un client, avant que les tâches ne soient rapprochées des listes. Rend le
 * nombre de corrections, pour le journal.
 *
 *   - absente : remise (telle qu'elle était, ou neuve) ;
 *   - présente : nom, type, portée partagée et « non archivée » rétablis ;
 *   - une autre liste qui se dirait `entretien` redevient une liste de tâches :
 *     il n'y en a qu'une.
 */
export function preserveEntretienList(incoming: Doc, current: Doc): number {
  const before: Doc[] = Array.isArray(current['taskLists']) ? current['taskLists'] : [];
  const next: Doc[] = Array.isArray(incoming['taskLists']) ? incoming['taskLists'] : (incoming['taskLists'] = []);
  let fixed = 0;
  for (const l of next) if (l?.kind === 'entretien' && l.id !== ENTRETIEN_LIST_ID) { l.kind = 'taches'; fixed++; }
  const i = next.findIndex((l) => l?.id === ENTRETIEN_LIST_ID);
  if (i < 0) {
    next.push(before.find((l) => l?.id === ENTRETIEN_LIST_ID) ?? entretienList(next.length));
    return fixed + 1;
  }
  const l = next[i];
  if (l.name !== 'Entretien' || l.kind !== 'entretien' || l.scope !== 'shared' || l.archived) {
    next[i] = { ...l, name: 'Entretien', kind: 'entretien', scope: 'shared' };
    delete next[i].archived;
    fixed++;
  }
  return fixed;
}
