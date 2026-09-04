// Le stockage des mots de passe.
//
// bcrypt, sel intégré, coût dans le condensat : le fond était déjà correct. Deux
// choses ne l'étaient pas.
//
// **Le coût.** Dix est bas pour 2026. Douze multiplie par quatre le travail d'un
// attaquant qui aurait obtenu la base, sans que personne ne s'en aperçoive à la
// connexion.
//
// **La forme.** `bcryptjs` est du JavaScript pur : `hashSync` et `compareSync`
// tiennent la boucle d'événements pendant tout le calcul. Mesuré à coût 10 :
// 81 ms où le service ne répond à personne d'autre. À coût 12, ce serait quatre
// fois plus, et la route de connexion est **publique** : une poignée d'appels
// simultanés suffirait à figer l'application pour la famille. Les versions
// asynchrones découpent le travail et rendent la main entre deux tours.
//
// Les deux vont ensemble : monter le coût sans passer en asynchrone aurait
// transformé un durcissement en levier de déni de service.
import bcrypt from 'bcryptjs';

/**
 * Le coût des nouveaux condensats. Les anciens restent valides : bcrypt porte
 * son coût dans le condensat, et un mot de passe haché à 10 se vérifie
 * parfaitement. Voir `aRehacher` pour la remise à niveau silencieuse.
 */
export const COUT = 12;

export const hacher = (motDePasse: string): Promise<string> => bcrypt.hash(motDePasse, COUT);

export const verifier = (motDePasse: string, condensat: string): Promise<boolean> =>
  bcrypt.compare(motDePasse, condensat);

/**
 * Ce condensat mérite-t-il d'être refait ?
 *
 * Vrai quand il a été calculé à un coût inférieur à celui d'aujourd'hui. On le
 * refait au moment de la connexion, seul instant où le mot de passe en clair est
 * disponible : personne n'a rien à faire, et le parc se met à niveau tout seul
 * au fil des connexions. Le condensat change, pas la version du jeton : refaire
 * un calcul ne doit déconnecter personne.
 */
export function aRehacher(condensat: string): boolean {
  const m = /^\$2[aby]?\$(\d{2})\$/.exec(condensat);
  return !!m && parseInt(m[1], 10) < COUT;
}
