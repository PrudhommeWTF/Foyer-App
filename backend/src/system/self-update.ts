// Le serveur sait-il vraiment se mettre à jour tout seul ?
//
// La réponse venait jusqu'ici de `FOYER_SELF_UPDATE`, posée dans le fichier
// d'environnement par l'installeur : une **déclaration**. Elle pouvait mentir
// dans les deux sens, et elle mentait en Docker, où l'écran conseillait
// « bash deploy/lxc/update.sh », un script qui n'existe pas dans un conteneur.
//
// Ce que la mise à jour depuis l'interface demande réellement, c'est le helper
// root déposé par `deploy/lxc/install.sh` et exécuté par l'unité systemd
// `foyer-update.path`. Sans lui, le bouton écrirait un fichier déclencheur que
// personne ne lit : exactement l'UI coquille que le dépôt s'interdit. On
// regarde donc le disque, plutôt que de croire une variable.
//
// `FOYER_SELF_UPDATE` reste, mais **en interrupteur d'arrêt** : posée à une
// valeur fausse, elle coupe le bouton même si le helper est là. Opt-out, plus
// opt-in : une machine qui a le helper n'a plus rien à déclarer, et une machine
// qui l'a perdu ne prétend plus savoir faire.
//
// Réserve honnête : la présence du fichier ne prouve pas que l'unité systemd
// est active. Le cas « helper présent, unité désactivée » laisse un bouton qui
// ne déclenche rien ; `freshStatus` (update-status.ts) le rattrape en faisant
// expirer une mise à jour « en cours » qui ne progresse pas, donc l'écran ne
// reste pas bloqué.
import fs from 'node:fs';

/**
 * Ce que la machine dit d'elle-même, lu par l'appelant.
 *
 * Ce module ne touche pas `process.env` : les deux variables sont lues dans
 * `server.ts`, en toutes lettres, parce que c'est là que le garde-fou du
 * registre des paramètres vérifie qu'une variable affichée est vraiment lue.
 * Les passer explicitement rend aussi la fonction éprouvable sans bricoler
 * l'environnement du processus de test.
 */
export interface SelfUpdateEnv {
  /** `FOYER_SELF_UPDATE` : l'interrupteur d'arrêt, et rien d'autre. */
  refus?: string;
  /** `FOYER_SELF_UPDATE_HELPER` : où chercher le script, quand ce n'est pas l'endroit habituel. */
  helper?: string;
}

/** Là où `deploy/lxc/install.sh` dépose le helper root. */
export const HELPER_DEFAUT = '/usr/local/sbin/foyer-self-update.sh';
/**
 * Pourquoi la mise à jour depuis l'interface n'est pas possible.
 *
 *   - `coupee`  : quelqu'un l'a explicitement refusée sur cette machine.
 *   - `absente` : la machine n'a pas le dispositif (Docker, ou LXC installé
 *     avec `SELF_UPDATE=false`).
 *
 * Les deux se disent différemment à l'écran : le geste à faire n'est pas le même.
 */
export type SelfUpdateRaison = 'coupee' | 'absente';

export interface SelfUpdateCapacite {
  possible: boolean;
  raison?: SelfUpdateRaison;
  /** Le chemin réellement inspecté, pour qu'un dépannage ne soit pas une devinette. */
  helper: string;
}

/**
 * Ce que la machine sait faire, constaté et non déclaré.
 *
 * Une valeur autre que « faux » dans `FOYER_SELF_UPDATE` ne vaut pas
 * autorisation : elle laisse simplement le constat décider. Une faute de frappe
 * dans le fichier d'environnement ne doit ni activer ni désactiver quoi que ce
 * soit en silence.
 */
export function selfUpdateCapacite(env: SelfUpdateEnv = {}): SelfUpdateCapacite {
  const helper = env.helper || HELPER_DEFAUT;
  const refus = (env.refus || '').trim();
  if (refus && /^(0|false|no|off)$/i.test(refus)) return { possible: false, raison: 'coupee', helper };
  try { if (fs.statSync(helper).isFile()) return { possible: true, helper }; } catch { /* pas de helper */ }
  return { possible: false, raison: 'absente', helper };
}
