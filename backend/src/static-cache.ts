// Ce que le navigateur a le droit de garder, et pour combien de temps.
//
// Une application servie sans consigne de cache se met à jour « quand le
// navigateur veut bien ». Sur iOS, cela peut vouloir dire jamais : le téléphone
// continue d'afficher la version d'avant, indéfiniment, alors que le serveur a
// été mis à jour. Le symptôme est déroutant, parce que tout est correct des deux
// côtés, et qu'il n'y a rien à corriger dans le code.
//
// D'où deux consignes opposées, et c'est la structure du build Angular qui les
// rend sûres toutes les deux :
//
//   - **Les fichiers empreints** (`main-A1B2C3D4.js`) portent le condensé de leur
//     contenu dans leur nom. Un même nom désigne donc toujours les mêmes octets :
//     ils se gardent un an, sans revalidation, et une nouvelle version arrive
//     sous un nouveau nom.
//   - **`index.html` ne se garde jamais.** C'est lui qui nomme les fichiers
//     empreints : le garder en cache, c'est garder toute l'application avec.
//
// Tout le reste (images, polices, manifeste) est revalidé à chaque fois : c'est
// prudent, et le volume est négligeable.

/** Un an, la valeur maximale que la RFC 9111 recommande d'annoncer. */
const AN = 31536000;

/**
 * Nom de fichier produit par le build avec une empreinte de contenu. Angular
 * écrit `main-NDQ3IISW.js` ; huit caractères au minimum, pour ne pas confondre
 * avec un nom écrit à la main comme `foyer-app.js`.
 */
const EMPREINTE = /-[A-Za-z0-9_]{8,}\.(?:js|css)$/;

/** Valeur de l'en-tête Cache-Control à servir pour ce fichier. */
export function cacheControlFor(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() || '';
  if (base.endsWith('.html')) return 'no-store, must-revalidate';
  if (EMPREINTE.test(base)) return `public, max-age=${AN}, immutable`;
  return 'public, max-age=0, must-revalidate';
}
