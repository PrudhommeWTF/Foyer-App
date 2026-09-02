/**
 * Écriture concurrente du document du foyer.
 *
 * `PUT /api/state` réécrivait le document entier en « dernier arrivé gagne ».
 * À deux sur l'application, cela se traduisait par des pertes muettes : le
 * téléphone qui enregistre à 12 h 00 min 03 s écrase ce que l'autre a écrit à
 * 12 h 00 min 01 s, avec un document qui ne le contenait pas. Une tâche cochée
 * se décochait toute seule, un événement disparaissait, et rien ne le disait.
 *
 * Le remède tient en un numéro de version, que le serveur incrémente à chaque
 * écriture et que `GET /api/state` renvoyait déjà : un client annonce la version
 * sur laquelle il a travaillé, et le serveur refuse d'écrire par-dessus une
 * version plus récente. Le refus n'est pas une erreur pour l'utilisateur : le
 * client rejoue ses modifications sur le document renvoyé et réessaie.
 *
 * La lecture de la version et l'écriture qui suit ont lieu dans le même appel,
 * sans await entre les deux : better-sqlite3 est synchrone et Node mono-thread,
 * donc aucune écriture ne peut se glisser entre le contrôle et l'enregistrement.
 */

export interface StateConflict {
  error: string;
  /** La version que le serveur détient réellement. */
  version: number;
  /** Et le document qui va avec, pour que le client rejoue dessus sans second aller-retour. */
  state: unknown;
}

/**
 * Le client écrit-il sur la version qu'il détient ?
 *
 * Une version absente est acceptée : c'est un onglet chargé avant la mise à
 * jour, qui ignore ce mécanisme. Le refuser le bloquerait sans qu'il sache
 * pourquoi, jusqu'à ce que quelqu'un pense à recharger la page.
 */
export function isUpToDate(clientVersion: unknown, currentVersion: number): boolean {
  if (typeof clientVersion !== 'number' || !Number.isFinite(clientVersion)) return true;
  return clientVersion >= currentVersion;
}

/** Le corps du refus : ce que le serveur détient, pour permettre le rejeu. */
export function conflictOf(current: { state: unknown; version: number }): StateConflict {
  return {
    error: 'Quelqu’un d’autre a enregistré entre-temps. Vos modifications ont été rejouées sur la version la plus récente.',
    version: current.version,
    state: current.state,
  };
}
