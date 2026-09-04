# Foyer hors ligne

Ce que l'application fait quand le réseau manque, ce qu'elle ne fait pas, et
pourquoi le cache ne fige pas la version installée.

## Ce qui marche

- **L'application s'ouvre**, même à froid : onglet fermé, téléphone redémarré,
  aucune connexion. Un service worker garde la coquille (le HTML d'entrée et
  les fichiers du build).
- **Le foyer s'affiche**, tel qu'il était à la dernière connexion : le dernier
  document lu est gardé dans **IndexedDB**, avec sa version et la date de cette
  lecture.
- **Un bandeau le dit**, en haut de l'écran : « Hors ligne. Voici votre foyer
  tel qu'il était le 04/09/2026 à 15:41. Vos gestes partiront au retour du
  réseau. » Une application qui s'ouvre sans réseau doit annoncer qu'elle
  montre le passé, sinon elle ment.
- **Cocher, ajouter, reporter, réordonner** continuent de marcher sur les
  courses et les tâches : chaque geste est une opération mise en file dans le
  navigateur, rejouée au retour du réseau (voir [`taches.md`](taches.md)).
- Les autres écrans (agenda, repas, contacts, documents) se lisent et
  **s'éditent** : leurs modifications partent par l'enregistrement du document,
  qui réessaie tout seul jusqu'à passer.

## Ce qui ne marche pas, et se dit

- **Le module Finances** ne s'affiche pas : ses données vivent dans ses propres
  tables, pas dans le document du foyer, et ne sont donc pas gardées. Ses
  tuiles disent « Pas de réseau » au lieu de faire semblant.
- **Les pièces jointes** (documents, photos de recettes) ne se téléchargent
  pas : les octets sont sur le serveur.
- **Les polices** viennent de Google et ne sont pas mises en cache : hors
  ligne, l'interface se rend avec les polices du système. C'est une différence
  d'allure, pas de fonctionnement.
- **Les rappels** continuent d'arriver : ils sont envoyés par le service push,
  pas par l'application. C'est le seul morceau qui n'a pas besoin que le
  téléphone soit connecté à Foyer.

## Le cache ne fige pas la version

C'est le piège classique des applications installables : la coquille est mise
en cache, l'application se fige sur une version, et la mise à jour du serveur
ne se voit jamais. Foyer l'évite par deux règles.

- **Le HTML d'entrée passe par le réseau d'abord.** Le cache ne sert que
  lorsqu'il ne répond pas. Une mise à jour est donc prise au premier
  chargement en ligne, exactement comme avant.
- **Les fichiers du build sont pris dans le cache d'abord**, parce que leur nom
  porte une empreinte de leur contenu : un nouveau build produit de nouveaux
  noms. Il n'y a aucun moyen de servir l'ancien code pour le nouveau HTML.

La coquille est mise de côté **à l'installation** du service worker, et pas au
premier passage : le service worker n'intercepte rien tant qu'il n'est pas
actif, si bien que quelqu'un qui ouvre l'application une fois puis perd le
réseau n'aurait rien du tout. Les noms des fichiers du build changeant à chaque
version, ils ne peuvent pas être écrits dans le service worker : celui-ci lit
le HTML d'entrée et prend ce qu'il référence. C'est exact par construction.

Le cache est borné à 60 entrées, les plus anciennes évincées d'abord : sans
cela, chaque version y laisserait ses fichiers pour toujours.

## Où le document est gardé, et pourquoi là

Dans **IndexedDB**, pas dans le stockage local. Et pas pour la raison qu'on
croit : sur iOS, l'effacement des données de site après sept jours sans visite
frappe les deux de la même façon, et c'est l'**ajout à l'écran d'accueil** qui
en exempte, pas le choix du magasin. Les trois vraies raisons :

- il **libère tout le budget du stockage local** pour les files de courses et
  de tâches, qui elles ne sont pas remplaçables : ce qui n'est pas encore parti
  n'existe nulle part ailleurs ;
- son quota se compte en centaines de mégaoctets, contre environ cinq pour le
  stockage local, partagés avec le reste ;
- il n'écrit pas sur le fil principal : enregistrer un gros document ne fige
  pas l'interface.

L'application demande au passage à ne pas être évincée sous la pression du
disque (`navigator.storage.persist()`). Le navigateur accorde selon ses propres
règles, et refuse sans conséquence : c'est une demande qui ne coûte rien, pas
une garantie.

Un foyer venant d'une version précédente a son document dans le stockage local :
il **remonte tout seul** dans IndexedDB au premier démarrage, et en disparaît.
Le nettoyage se fait à l'écriture, et pas seulement à la relecture : un foyer
qui démarre en ligne ne relit jamais le cache, et l'ancienne copie resterait
sinon pour toujours à occuper la place qu'on cherche à libérer.

## Ce qu'il faut savoir avant de s'en servir

- **Le document du foyer est écrit en clair**, comme l'est déjà le jeton de
  session dans le stockage local. Sur un appareil partagé, c'est à considérer.
  Il est **effacé à la déconnexion**, des deux magasins.
- **Un document trop volumineux n'est pas gardé** (au-delà de 10 Mo). La borne
  ne protège plus un quota partagé mais le coût d'écriture : le document est
  réenregistré à chaque sauvegarde, et au-delà de cet ordre de grandeur c'est
  le document lui-même qui a un problème. Le cas est écrit dans la console.
- **Les pièces jointes ne comptent pas** dans cette taille : elles ont quitté
  le document à la migration 5.

## Vérifier depuis un navigateur

```js
// Ce que le service worker garde
await caches.keys();                                  // ['foyer-shell-v1']
(await (await caches.open('foyer-shell-v1')).keys()).map((r) => r.url);

// De quand date le foyer gardé
const lire = () => new Promise((ok) => {
  const r = indexedDB.open('foyer', 1);
  r.onsuccess = () => {
    const g = r.result.transaction('doc', 'readonly').objectStore('doc').get('household');
    g.onsuccess = () => { r.result.close(); ok(JSON.parse(g.result)); };
  };
});
(await lire()).at;

// Ce qui attend de partir
JSON.parse(localStorage.getItem('foyer.taskQueue') || '[]').length;
JSON.parse(localStorage.getItem('foyer.shopQueue') || '[]').length;

// Les données sont-elles à l'abri d'une éviction ?
await navigator.storage.persisted();
```

Pour repartir de zéro (le service worker se réinstalle au chargement suivant) :

```js
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
for (const n of await caches.keys()) await caches.delete(n);
indexedDB.deleteDatabase('foyer');
localStorage.removeItem('foyer.doc');   // reliquat d'une version précédente
```

## Où vit le code

| Fichier | Rôle |
|---|---|
| `frontend/public/sw.js` | Le service worker : préchargement de la coquille, réseau d'abord pour le HTML, cache d'abord pour le build, et les rappels. |
| `frontend/src/app/core/offline-doc.ts` | Mise en forme et relecture du dernier document (pur, testé), et l'accès à IndexedDB : garde, relecture, reprise de l'ancienne copie, effacement, demande de persistance. |
| `frontend/src/app/core/foyer.store.ts` | Enregistrement du service worker au démarrage, garde du document, reprise depuis le cache quand le réseau manque, effacement à la déconnexion. |
| `frontend/src/app/shell/shell.ts` | Le bandeau qui dit de quand date ce qui est affiché. |

## Tests

| Fichier | Ce qu'il tient |
|---|---|
| `frontend/src/app/core/offline-doc.test.ts` | Un document se garde avec sa version et sa date et se relit à l'identique ; un document trop gros ou impossible à sérialiser n'est pas gardé ; un contenu abîmé, incomplet ou à moitié écrit rend null plutôt que de faire deviner ; la version zéro est une version ; la taille se compte en octets. |

La vérification qui compte se fait au navigateur : premier chargement en ligne,
coupure du réseau, **rechargement complet de la page**, et l'application doit
s'ouvrir sur le foyer daté, accepter une coche, puis l'envoyer au retour du
réseau.
