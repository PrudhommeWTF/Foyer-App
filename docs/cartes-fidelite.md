# Cartes de fidélité

Le module range les cartes de fidélité du foyer et réaffiche leur code, QR ou
code-barres, pour le présenter en caisse. Une carte est saisie une fois, partagée
par tout le foyer, et retrouvée sur n'importe quel téléphone connecté.

## Le principe : du texte, jamais un fichier

Une carte de fidélité **est** un code (un numéro et sa symbologie). Le module ne
stocke donc que ce code, en texte, dans le document d'état (`cards[]`), à côté du
nom et de la couleur du logo. **Rien ne va sur le disque** : c'est la différence
assumée avec l'ancien module Documents, retiré parce qu'il faisait grossir
l'espace. Le code se **redessine** à l'affichage, il n'est pas rangé comme une
image.

```ts
interface LoyaltyCard {
  id: string;
  name: string;    // « Carrefour »
  code: string;    // la valeur brute du code
  format: CardFormat;  // comment le redessiner (voir plus bas)
  color: string;   // la couleur du monogramme
  note?: string;   // numéro d'adhérent, expiration…
}
```

## Le logo : un monogramme, pas une marque

Par défaut, le logo est un **monogramme** : les initiales du nom, dans une couleur
tirée du nom lui-même (stable, la même enseigne garde la même pastille). La couleur
est suggérée mais modifiable ; dès qu'on la choisit, le nom ne la repropose plus.
Le monogramme n'est jamais vide (au moins un « ? ») et marche hors ligne.

En plus, un bouton **« Chercher un logo en ligne »** propose de vrais logos tirés
du **nom** de l'enseigne. C'est une requête sortante (elle envoie le nom saisi),
donc **coupable par le réglage `cardLogoSearch`** ; éteint, le bouton disparaît et
seul le monogramme reste. Le **nom** donne des domaines via l'autocomplétion
d'entreprises de Clearbit (`autocomplete.clearbit.com`, gratuite, sans clé) ;
l'image de chaque domaine est ensuite son **favicon**, récupéré chez des services
par domaine (DuckDuckGo d'abord, Google en repli). L'ancien service de logos de
Clearbit (`logo.clearbit.com`) a été fermé par HubSpot, d'où le favicon. **Hôtes
fixes**, jamais une URL choisie par l'utilisateur : pas de SSRF. Le serveur relaie
la recherche (la CSP interdit au navigateur d'appeler ou d'afficher une ressource
externe) et renvoie les images **en data-URI**. Une panne, un service indisponible
ou retiré : aucune option n'est proposée, le monogramme tient lieu de logo.

Le logo choisi est gardé **en data-URI dans le document d'état**, jamais sur le
disque : la carte reste affichable hors ligne, et le module garde son principe
(tout dans le document). Les images sont bornées (refus au-delà de 60 Ko) pour ne
pas alourdir le document réenvoyé à chaque sauvegarde. Formats acceptés : PNG,
JPEG, WebP, GIF et l'ICO des favicons ; pas de SVG (inutile ici, et une image
vectorielle peut porter du script). Un favicon étant petit, le logo peut paraître
un peu doux à grande taille, mais reste reconnaissable.

## Import : la caméra d'abord, une photo en repli

Deux chemins mènent au même endroit (code + format pré-remplis) :

1. **Scanner avec la caméra** (`@zxing/browser`, lecture en direct). C'est le plus
   simple, mais la caméra n'est accessible qu'en **contexte sécurisé** : HTTPS, ou
   `localhost`. En HTTP simple sur une IP de réseau local, le navigateur la refuse.
   Le module le dit clairement et renvoie vers le second chemin.
2. **Importer une photo** (même lecteur, sur une image). Marche **partout**, sans
   caméra ni HTTPS : on prend le code en photo, ou on choisit une image existante.

À défaut, le code et le format se saisissent à la main.

## Formats

On lit et on réaffiche les symbologies qu'une carte de fidélité porte en
pratique : QR Code, EAN-13, EAN-8, UPC-A, Code 128, Code 39, entrelacé 2/5 et
Codabar. Un scan qui rend un format hors de cette liste est ignoré plutôt que
rangé : mieux vaut refuser que garder une carte qu'on ne saurait pas remontrer.
Le rendu se fait avec **bwip-js** (`toSVG`), posé en `data:` dans une balise
`<img>`. Un code qui ne correspond pas à sa symbologie (mauvais nombre de
chiffres pour un EAN-13, par exemple) ne fait pas un écran vide : le numéro
s'affiche en clair, avec une invite à vérifier le format.

## Chargement à la demande

Les deux librairies (lecture et rendu) sont **chargées dynamiquement**, seulement
au moment de scanner ou d'ouvrir une carte. Elles ne pèsent pas sur le premier
chargement de l'application, qui reste identique.

## Fichiers

| Fichier | Ce qu'il tient |
|---|---|
| `frontend/src/app/core/cards.ts` | Le noyau pur : formats, correspondance vers bwip-js, traduction depuis le scanner, monogramme (initiales et couleur). |
| `frontend/src/app/core/cards.test.ts` | Formats, traduction d'un format de scan, monogramme stable. |
| `frontend/src/app/screens/fidelite.ts` | L'écran : liste, affichage plein écran du code, saisie, scan caméra, import photo et recherche de logo. |
| `frontend/src/app/core/models.ts` | `LoyaltyCard` (dont `logo`), `CardFormat`, le champ `cards` du document. |
| `backend/src/logos.ts` | La recherche de logo relayée : autocomplétion Clearbit + lecture des images, en data-URI, avec dégradation silencieuse. |
| `backend/test/logos.test.ts` | Le parseur des candidats et le garde sous deux caractères. |

Les cartes vivent dans le document d'état, enregistré par `PUT /api/state` comme
le reste ; la validation vérifie seulement la charpente (`cards` est une liste,
ses fiches ont un identifiant texte). La seule route dédiée est
`GET /api/cards/logos?name=…`, coupable par le réglage `cardLogoSearch`, qui relaie
la recherche de logo (voir `logos.ts`).
