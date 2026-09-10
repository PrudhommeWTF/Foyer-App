// Faut-il proposer l'activation des rappels sur l'accueil ?
//
// La règle est extraite du store pour être vérifiée sans Angular : c'est une
// décision à trois entrées (l'état du canal, l'app installée ou non, un report
// éventuel) qui gagne à être testée seule.

/** L'état du canal Web Push sur cet appareil, tel que `initPush()` le calcule. */
export type PushSupport = 'checking' | 'unsupported' | 'install' | 'denied' | 'off' | 'on';

/**
 * Vrai seulement si le canal est prêt mais éteint (`off`), si l'app tourne
 * installée (écran d'accueil), et si aucun report n'est en cours. `snoozeUntil`
 * est en millisecondes depuis l'époque, 0 quand il n'y a aucun report ; un
 * report déjà dépassé (`now >= snoozeUntil`) ne compte plus.
 */
export function pushInviteVisible(support: PushSupport, installed: boolean, snoozeUntil: number, now: number): boolean {
  if (support !== 'off' || !installed) return false;
  return !(snoozeUntil && now < snoozeUntil);
}
