// La journalisation du service.
//
// Tout passe par ici plutôt que par `console` directement, pour une seule
// raison : pouvoir baisser ou monter le niveau sans redémarrer le service, et
// sans avoir à choisir entre un journal illisible et un journal muet le jour où
// quelque chose ne va pas.
//
// Trois niveaux, et pas quatre :
//
//   - `erreur` : ce qui a échoué. Toujours écrit, quel que soit le réglage.
//   - `info`   : ce que le service a fait et qu'on veut retrouver après coup
//                (migrations, réglages modifiés, rappels envoyés). Le défaut.
//   - `debug`  : le détail qu'on n'allume que pour comprendre un cas précis.
//
// Le niveau est un réglage du foyer, lu à chaque ligne : `journalctl -f -u foyer`
// change de verbosité pendant qu'on le regarde.
//
// La sortie reste `stdout` et `stderr` : c'est ce que systemd et Docker
// collectent, et il n'y a aucune raison d'inventer un fichier de plus à faire
// tourner.

export type LogLevel = 'erreur' | 'info' | 'debug';

const RANG: Record<LogLevel, number> = { erreur: 0, info: 1, debug: 2 };

/**
 * D'où vient le niveau courant. Posé au démarrage par le serveur, une fois la
 * base ouverte : ce module n'a aucune raison de connaître le document du foyer,
 * et le garder ignorant le rend utilisable partout, y compris avant que la base
 * existe.
 */
let source: () => LogLevel = () => 'info';
export function setLogLevelSource(fn: () => LogLevel): void { source = fn; }

/** Le niveau en vigueur, avec repli sur `info` si le réglage est illisible. */
export function level(): LogLevel {
  try { const l = source(); return l in RANG ? l : 'info'; } catch { return 'info'; }
}

const ecrit = (voulu: LogLevel, flux: 'out' | 'err', ligne: string): void => {
  if (RANG[voulu] > RANG[level()]) return;
  // eslint-disable-next-line no-console
  (flux === 'err' ? console.error : console.log)('[foyer] ' + ligne);
};

export const log = {
  /** Une panne, ou ce qui empêche une opération d'aboutir. Jamais filtré. */
  erreur: (ligne: string, e?: unknown): void => {
    ecrit('erreur', 'err', ligne + (e instanceof Error ? ' : ' + e.message : e ? ' : ' + String(e) : ''));
  },
  /** Ce qui a marché et qu'on veut pouvoir retrouver : c'est le niveau par défaut. */
  info: (ligne: string): void => ecrit('info', 'out', ligne),
  /** Un avertissement : quelque chose d'anormal mais qui n'empêche rien. Même niveau qu'info. */
  attention: (ligne: string, e?: unknown): void => {
    ecrit('info', 'err', ligne + (e instanceof Error ? ' : ' + e.message : e ? ' : ' + String(e) : ''));
  },
  /** Le détail qu'on allume pour comprendre un cas précis, et qu'on éteint après. */
  debug: (ligne: string): void => ecrit('debug', 'out', ligne),
};
