/**
 * L'état d'une mise à jour, et la façon dont il se périme.
 *
 * `update-status.json` est écrit par deux mains : le backend y pose « running »
 * au moment où il dépose le fichier déclencheur, puis `self-update.sh` le
 * réécrit à chaque étape (téléchargement, compilation, installation). L'interface
 * le lit et, tant qu'il vaut « running », remplace **les deux boutons** du
 * panneau par « Mise à jour en cours… ».
 *
 * D'où la panne : si la mise à jour s'interrompt, ce fichier reste « running »
 * pour toujours. Le service redémarré, la machine rebootée, l'unité systemd
 * jamais déclenchée, une coupure pendant `npm ci` : dans tous ces cas
 * l'application se retrouve définitivement bloquée sur « Mise à jour en cours… »,
 * sans bouton, et sans aucun moyen de s'en sortir depuis l'interface. Il fallait
 * aller supprimer un fichier sur le serveur pour retrouver la main.
 *
 * Le remède : un état « running » qui n'a pas progressé depuis un moment n'en
 * est plus un. Le délai porte sur **le temps sans progression**, pas sur la
 * durée totale, puisque le script réécrit l'horodatage à chaque étape : un quart
 * d'heure sans nouvelle est large pour l'étape la plus lente (un `npm ci` sur un
 * petit conteneur) et court pour retrouver la main.
 */

export interface UpdateStatus {
  state: string;
  message?: string;
  /** Millisecondes depuis l'époque, réécrites à chaque étape du script. */
  ts?: number;
}

/** Temps sans progression au-delà duquel une mise à jour est tenue pour interrompue. */
export const UPDATE_STALE_MS = 15 * 60 * 1000;

/**
 * L'état à servir à l'interface. Une mise à jour sans nouvelles est déclarée
 * interrompue, avec le chemin du journal : c'est la seule chose à lire pour
 * savoir ce qui s'est passé.
 */
export function freshStatus(status: UpdateStatus, now: number, logPath: string, staleMs = UPDATE_STALE_MS): UpdateStatus {
  if (status.state !== 'running') return status;
  // Un horodatage absent vient d'un format antérieur : la mise à jour qu'il
  // décrivait est de toute façon terminée depuis longtemps.
  const age = typeof status.ts === 'number' ? now - status.ts : Infinity;
  if (age <= staleMs) return status;
  return {
    state: 'error',
    message: `Mise à jour interrompue : aucune progression depuis ${sinceLabel(age)}. `
      + `Voir ${logPath}, puis relancez depuis l’application.`,
    ts: status.ts,
  };
}

/** « 22 minutes », « 3 heures », « 6 jours ». En minutes pour tout, c'est illisible. */
export function sinceLabel(ms: number): string {
  if (!Number.isFinite(ms)) return 'un long moment';
  const min = Math.round(ms / 60000);
  if (min < 120) return min + (min > 1 ? ' minutes' : ' minute');
  const h = Math.round(min / 60);
  if (h < 48) return h + ' heures';
  return Math.round(h / 24) + ' jours';
}
