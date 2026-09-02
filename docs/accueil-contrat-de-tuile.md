# L'accueil : contrat de tuile

Ce document dit comment l'accueil est construit et comment y brancher un
nouveau module. Il existe pour éviter de refaire ce chantier dans un an.

## Le problème qu'on a résolu

L'accueil connaissait l'intérieur des modules. Il lisait leurs données brutes et
refaisait leurs calculs. Chaque évolution d'un module cassait sa tuile en
silence, et un chiffre faux ressemble à un chiffre juste : personne ne s'en
apercevait avant des semaines.

Deux exemples réels, tous les deux corrigés depuis :

- La tuile Finances lisait la synthèse du **mois affiché dans l'écran Finances**
  au lieu de celle du mois en cours. Après une visite dans un mois d'archive,
  l'accueil montrait ce mois-là, avec une étiquette exacte et un chiffre hors
  sujet.
- Un foyer qui n'avait jamais ouvert le module Finances lisait « 0 € », « solde
  0 € ». Aucun compte n'était déclaré : la bonne réponse n'était pas zéro, elle
  était « ce module n'a pas encore servi ».

## Les deux règles

1. **L'accueil ne calcule rien.** Il compose. Une règle métier écrite dans
   `screens/home/` est un défaut de revue. Si l'accueil a besoin d'un chiffre, le
   module le lui fournit ; si le module ne sait pas le produire, on complète le
   module.
2. **Un fournisseur est une fonction pure d'un instantané.** Pas de composant,
   pas d'injection, pas de DOM. C'est ce qui le rend vérifiable au lanceur de
   tests intégré à Node, sans démarrer Angular.

## Les quatre états

Le contrat impose quatre états, et non trois. « En cours de chargement » doit se
distinguer de « il n'y a rien », faute de quoi une tuile en panne se présente
comme une tuile vide.

| État | Ce qu'il veut dire | Ce que l'écran montre |
|---|---|---|
| `loading` | La donnée n'est pas encore là | Un squelette. Jamais un chiffre |
| `ok` | La donnée est là | Le contenu de la tuile |
| `empty` | Il n'y a réellement rien, et c'est normal | Une phrase qui le dit sans alarmer |
| `error` | La donnée est indisponible | Le message, la cause, et « Réessayer » |

Deux nuances se posent sur `ok`, à ne pas confondre :

- `partial` : la donnée **elle-même** est incomplète. Exemple : un mois dont
  certains comptes n'ont pas été importés. La tuile nomme les comptes en cause.
- `stale` : la donnée n'est **plus rafraîchie**. Le serveur ne répond plus, on
  montre la dernière vue connue en le disant.

Interdits, sans exception : afficher `0` quand la valeur est inconnue, afficher
la dernière valeur connue sans dire qu'elle est ancienne, masquer une erreur
derrière un état vide.

## Les deux plans de données

L'accueil ne fait **aucune cascade de requêtes**. Il lit deux plans, chargés en
parallèle :

| Plan | Source | Requêtes | Tuiles servies |
|---|---|---|---|
| `document` | `GET /api/state`, déjà chargé par la session | 0 | Agenda, Tâches, Repas, Courses, Messagerie |
| `finances` | `/api/finances/*` | 1 (bootstrap du module) | Finances |

C'est pour cela qu'il n'y a **pas** d'endpoint `/api/dashboard`. Un agrégateur
côté serveur renverrait une seconde fois le document du foyer, déjà en mémoire,
sur l'écran le plus ouvert de l'application. Il couplerait aussi le backend à
la liste des tuiles, et surtout il créerait un point de panne unique : une tuile
Finances en erreur ne doit pas empêcher l'agenda de s'afficher.

Un plan qui tombe met en erreur **ses** tuiles, et elles seules. Le « Réessayer »
d'une tuile recharge son plan, pas les autres.

## Brancher un nouveau module : la marche à suivre

Cinq étapes, dont aucune ne touche au composant d'accueil.

### 1. Écrire le fournisseur

`frontend/src/app/core/tiles/<module>.tile.ts` :

```ts
import { TileProvider, TileState, empty, fromSource, ok } from './contract';

export interface EnergieTileData { releves: number; }

export const energieTile = {
  id: 'energie',
  title: 'Relevés',
  screen: 'finances',      // vérifié par un test contre la navigation
  link: 'Ouvrir',
  source: 'finances',      // le plan dont dépend la tuile
  state: (ctx): TileState<EnergieTileData> => fromSource(ctx.fin, (f, asOf) =>
    f.releves.length ? ok({ releves: f.releves.length }, asOf)
                     : empty('Aucun relevé enregistré.')),
} satisfies TileProvider<EnergieTileData>;
```

Le `satisfies` n'est pas décoratif : il conserve le type littéral de `id`, ce qui
rend l'étape 4 vérifiable à la compilation.

Un fournisseur ne calcule pas la règle métier, il **appelle** celle du module.
Si la règle n'existe que dans le store, sous forme de méthode Angular, il faut
l'extraire dans un fichier pur du module et faire déléguer le store, pour qu'il
n'y ait qu'une implémentation. C'est ce qui a été fait pour `core/agenda.ts` et
`core/meals.ts`.

### 2. L'ajouter au registre

`frontend/src/app/core/tiles/registry.ts`. L'ordre de la liste est l'ordre
d'affichage par défaut.

### 3. Écrire le composant de rendu

`frontend/src/app/screens/home/<module>.ts`, en héritant de `HomeTile<T>` :

```ts
@Component({
  selector: 'tile-energie',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent],
  template: `
    <f-tile [title]="tile().title" [link]="tile().link" [state]="state()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) { <div>{{ d.releves }} relevés</div> }
    </f-tile>
  `,
})
export class EnergieTile extends HomeTile<EnergieTileData> {}
```

`data()` vaut `null` hors de l'état `ok` : il est structurellement impossible
qu'un gabarit lise une donnée absente. Le composant ne filtre pas, ne trie pas,
ne compte pas : il met en forme, et branche les gestes sur le store de son
module.

### 4. Le déclarer dans la table de rendu

`frontend/src/app/screens/home/tiles.ts`. Cette table est indexée sur `TileId`,
le type dérivé du registre : **oublier le composant d'une tuile ne compile pas**.
Sans cela, la tuile disparaîtrait de la page sans un mot.

### 5. Écrire les tests

`frontend/src/app/core/tiles/tiles.test.ts` couvre automatiquement toute tuile
ajoutée au registre, sur les quatre états. Ajoute en plus les tests propres à ta
règle, c'est-à-dire ce que la tuile dit réellement.

## Ce que l'isolation des pannes garantit, et ce qu'elle ne garantit pas

Trois barrières :

1. `safeState()` appelle chaque fournisseur dans un `try/catch`. Une exception
   devient une tuile en erreur, nommée, journalisée. Les autres tuiles vivent.
2. Chaque tuile est un composant `OnPush` distinct.
3. Un test vérifie qu'un fournisseur qui lève ne casse pas le rendu de la page.

**La limite, dite franchement :** Angular n'a pas de barrière d'erreur au rendu.
Une exception dans le gabarit d'une tuile n'est pas rattrapable. C'est pour cela
que les composants de tuile sont réduits à de la mise en forme d'un `TileState`
déjà validé : leur surface de panne est presque nulle, et tout ce qui peut
échouer se trouve dans le chemin de données, qui est protégé.

## Quand le serveur ne répond pas au démarrage

Un serveur injoignable n'est pas une session invalide. Avant, le jeton était jeté
dans les deux cas, ce qui renvoyait à l'écran de connexion pendant un simple
redémarrage du conteneur, sans rien expliquer. Désormais `ApiError` porte le code
HTTP, `status` valant 0 quand le serveur n'a pas répondu du tout : la session est
gardée, et l'accueil se rend avec ses tuiles en erreur.

Dans cet état, le châssis (barre latérale, barre du haut, barre d'onglets) ne
s'affiche pas et toutes les destinations mènent à l'accueil : c'est le seul écran
conçu pour dire qu'il ne peut pas charger, et proposer de réessayer. Le reste se
tait plutôt que d'afficher une famille vide.

## Diagnostic

Quand une tuile est rouge, elle affiche déjà le module et la cause à l'écran.
Pour retrouver la même chose dans les journaux :

```sh
# LXC / systemd
journalctl -u foyer -f | grep 'accueil'

# Docker
docker compose logs -f foyer | grep 'accueil'
```

Trois formes de lignes :

```
[foyer] accueil : source document indisponible : Document du foyer : Le serveur ne répond pas.
[foyer] accueil : source finances indisponible : Finances : Erreur 500
[foyer] accueil : tuile energie (source finances) a échoué : Cannot read properties of undefined
```

La première nomme le plan, la troisième nomme la tuile fautive et la cause.

Ces lignes sont écrites par le navigateur : les pannes du client ne remontent pas
au serveur, on les lit dans la console (Safari : Réglages, Avancé, menu
Développement). Les journaux du conteneur portent la cause côté serveur, qui est
l'autre moitié de l'histoire. Les deux messages sont identiques, donc
rapprochables.

## Le jour et l'heure

`FoyerStore.todayStr()` est le jour courant **dans le fuseau du foyer**
(`Europe/Paris`, fixe), et il est réactif : une horloge interne le fait avancer
chaque minute, et au réveil de l'onglet. Une application laissée ouverte la nuit
bascule donc seule sur le lendemain, sans rechargement.

Le choix de la minute plutôt que d'un réveil calé sur minuit est délibéré : il
est insensible aux changements d'heure, et sans coût mesurable, un jour inchangé
rendant la même chaîne, ce qui arrête net la propagation du signal.

## Ce que ce socle ne fait pas encore

Pour éviter toute ambiguïté sur l'état réel du chantier :

- **Pas d'actions rapides** au-delà de celles qui existaient déjà (cocher une
  tâche, cocher un article). Ni report, ni saisie libre, ni annulation.
- **Pas de contextualisation.** L'ordre des tuiles est celui du registre, il ne
  dépend ni de l'heure ni du type de jour.
- **Les tuiles manquantes le sont toujours** : contrats et échéances, énergie,
  économies, emploi du temps, documents.
- **La règle des tâches n'a pas changé.** La tuile montre les tâches ouvertes,
  toutes listes confondues, sans tenir compte de leur date. Elle est honnête,
  elle n'est pas encore utile.
- **La concurrence sur le document n'est pas réglée.** `PUT /api/state` réécrit
  le document entier, dernier arrivé gagne. Deux téléphones qui cochent deux
  tâches à quelques secondes d'intervalle peuvent encore se perdre l'un l'autre.
  Les courses, elles, sont protégées (écriture opération par opération).
