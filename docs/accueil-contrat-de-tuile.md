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
| `empty` | Il n'y a réellement rien, et c'est normal | Une phrase qui le dit sans alarmer, et le geste de démarrage quand le module n'a jamais servi |
| `error` | La donnée est indisponible | Le message, la cause, et « Réessayer » |

Deux nuances se posent sur `ok`, à ne pas confondre :

- `partial` : la donnée **elle-même** est incomplète. Exemple : un mois dont
  certains comptes n'ont pas été importés. La tuile nomme les comptes en cause.
- `stale` : la donnée n'est **plus rafraîchie**. Le serveur ne répond plus, on
  montre la dernière vue connue en le disant.

Interdits, sans exception : afficher `0` quand la valeur est inconnue, afficher
la dernière valeur connue sans dire qu'elle est ancienne, masquer une erreur
derrière un état vide.

Deux vides ne se valent pas, et il faut les distinguer : « aucune tâche
aujourd'hui » pour un foyer qui en a cent, et « aucune tâche » pour un foyer qui
n'a jamais ouvert le module. Le second passe `start` à `empty()` et la tuile
propose son geste de démarrage : une tuile vide n'est pas une tuile morte.

## Les deux plans de données

L'accueil ne fait **aucune cascade de requêtes**. Il lit deux plans, chargés en
parallèle :

| Plan | Source | Requêtes | Tuiles servies |
|---|---|---|---|
| `document` | `GET /api/state`, déjà chargé par la session | 0 | Agenda, Tâches, Repas, Courses, Messagerie |
| `finances` | `GET /api/finances/home?month=AAAA-MM` | 1 | Finances, Échéances, Relevés, Économies (et les échéances de l'agenda) |

`/api/finances/home` est composé **par le module Finances**, dans
`backend/src/finances/routes.ts`, à côté de son propre `/bootstrap`. Il ne rend
que ce qui s'affiche : la synthèse du mois, le solde des comptes courants, les
échéances à venir, les compteurs dont le relevé est attendu, les pistes
d'économies ouvertes, et le nombre de comptes et de contrats déclarés (zéro
voulant dire « module jamais servi », jamais « zéro euro »). Auparavant l'accueil appelait `init()`, c'est-à-dire le
démarrage complet du module (comptes, catégories, soldes, opérations, règles,
contrats), soit six requêtes en cascade, pour afficher un chiffre.

Le mois est passé **par le client** : lui seul connaît le fuseau du foyer, et
c'est ce qui fait que la tuile change de mois toute seule au premier du mois,
sans rechargement. Ces échéances alimentent aussi les notifications et les
repères du calendrier : sans elles ici, ils ne fonctionneraient plus qu'après une
visite dans l'écran Finances.

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
      // Deux vides distincts : rien à faire, ou module jamais servi.
      : f.compteurs ? empty('Compteurs à jour.')
                    : empty('Aucun compteur suivi.', 'Ajouter un compteur')),
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

## Les actions rapides

Les gestes qu'on fait plusieurs fois par jour n'imposent plus d'ouvrir un
module. Six règles, tenues par toutes :

1. **Deux taps au maximum, sans changer de page.** Une saisie repliée n'est
   qu'un bouton : une tuile qui répond « qu'est-ce qu'il y a aujourd'hui » ne
   doit pas être encombrée d'un champ vide.
2. **L'action appelle l'API de son module.** Elle ne réimplémente rien. Cocher
   un article passe par le moteur d'opérations des courses, pas par une écriture
   du document ; une dépense passe par `POST /api/finances/transactions`.
3. **Retour immédiat.** Sur le document du foyer, c'est gratuit : la mutation
   est appliquée en mémoire et part ensuite. Sur les finances, c'est délibérément
   **non optimiste** : un total de dépenses qui bouge puis revient en arrière est
   pire qu'un total qui arrive une seconde plus tard. Le retour immédiat y est
   donné par le formulaire, qui se ferme, et par le message.
4. **Annulation sur tout ce qui disparaît.** Cocher une tâche la retire de la
   tuile, la reporter aussi, remplacer un repas écrase celui qui était prévu :
   les trois offrent « Annuler » pendant sept secondes. Sans cela, un geste fait
   de travers oblige à ouvrir le module pour le défaire, ce que l'action rapide
   cherchait justement à éviter.
5. **Rien de dangereux.** Aucune suppression définitive, aucune validation
   d'import, aucun réglage. La seule suppression permise est l'annulation d'une
   dépense qu'on vient de créer, et elle ne peut viser que cet identifiant-là.
6. **Un échec ne se tait pas.** Un enregistrement qui ne passe pas ne fait pas
   reculer l'écran : les modifications restent, la tuile affiche « Modifications
   non enregistrées », et l'envoi est retenté tout seul (au retour du réseau, au
   réveil de l'onglet, et sur une minuterie).

Le catalogue tenu, tuile par tuile :

| Tuile | Gestes |
|---|---|
| Tâches | Cocher, reporter à demain, créer en saisie libre |
| Courses | Cocher un article, en ajouter un avec suggestion |
| Repas | Remplacer le dîner par une entrée libre |
| Échéances | En faire une tâche du foyer (« j'ai vu, je m'en occupe ») |
| Relevés | Saisir l'index du compteur réclamé |
| Finances | Saisir une dépense en espèces, et l'annuler |

Les suggestions d'article viennent du module, jamais du composant : la primitive
`f-quick-add` affiche ce qu'on lui donne. Elles sont dédoublonnées **par clé
d'article** et non par nom, sans quoi « courgette » serait proposé alors que
« Courgettes » est déjà dans la liste.

### Trois gestes du brief qui ne sont pas là, et pourquoi

- **Marquer un repas réalisé** et **marquer un événement traité** demandent
  chacun un champ nouveau (`done`) dans le modèle, dont rien d'autre ne se
  servirait. Le dépôt interdit le réglage persisté sans consommateur, et une
  case à cocher qui ne change rien est une coquille. Si ces états doivent
  exister, c'est d'abord aux modules Repas et Agenda de dire ce qu'ils en font.
- **Pointer une opération proposée** est un travail de rapprochement bancaire,
  qui se fait par lots devant un relevé, pas entre deux portes sur un téléphone.
  Il est à sa place dans l'écran Finances.

## Écriture à deux

Le document du foyer s'enregistre en entier. Jusqu'ici en « dernier arrivé
gagne » : le téléphone qui enregistrait à 12 h 00 min 03 s écrasait ce que
l'autre avait écrit deux secondes plus tôt, avec un document qui ne le contenait
pas. Une tâche cochée se décochait, un événement disparaissait, et rien ne le
disait.

Trois pièces règlent cela, et le numéro de version circulait déjà dans les deux
sens :

1. Le client annonce à `PUT /api/state` la version sur laquelle il a travaillé.
2. Le serveur refuse (409) d'écrire par-dessus une version plus récente, et
   renvoie **son** document avec le refus (`backend/src/state/concurrency.ts`).
3. Le client **rejoue** ses modifications non acquittées sur ce document et
   réessaie, jusqu'à trois fois (`frontend/src/app/core/state-sync.ts`).

Rejouer plutôt que redemander : « vos modifications ont été perdues, rechargez »
serait une façon polie de perdre quand même. Une mutation est une fonction qui
modifie le document, elle se rejoue telle quelle sur une autre version.

Ce que ce mécanisme ne prétend pas résoudre :

- **Deux personnes qui modifient la même chose.** Cocher une tâche que l'autre
  vient de cocher la décoche, parce que « cocher » est écrit comme une bascule.
  Il n'y a pas de bonne réponse automatique, et le cas est rare ; perdre
  l'événement qu'on vient de créer parce que l'autre a coché une tâche, ça, ce
  n'était pas rare.
- **Une mutation dont la cible a disparu** (l'autre a supprimé la tâche qu'on
  modifiait) est comptée et annoncée par un message, pas tue.
- **Un onglet chargé avant la mise à jour** n'envoie pas de version : le serveur
  l'accepte plutôt que de le bloquer sans qu'il sache pourquoi. Il retrouve la
  protection au premier rechargement.

La liste de courses, elle, ne passe pas par là : elle s'écrit article par
article depuis longtemps, avec sa propre file hors ligne.

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

- **Pas de contextualisation.** L'ordre des tuiles est celui du registre, il ne
  dépend ni de l'heure ni du type de jour.
- **Deux modules restent sans tuile, à dessein.** Les **documents**, parce que le
  modèle n'a aucune date d'expiration : `FileItem` ne porte qu'une date d'ajout en
  texte libre, et fabriquer une échéance à partir de ça serait exactement le genre
  de chiffre plausible et faux que ce chantier existe pour supprimer. Il faudrait
  d'abord ajouter un champ au module Documents. Les **contacts**, parce qu'un
  carnet d'adresses n'a rien à dire d'un jour en particulier ; les contacts
  d'urgence méritent un accès rapide, mais depuis la barre de navigation, pas
  depuis une tuile qui répéterait la même chose tous les jours.
- **Dix tuiles, c'est beaucoup** pour un écran qu'on lit debout en cinq secondes.
  Sur iPhone, un foyer complet fait un peu plus de deux écrans de défilement. La
  première hauteur porte l'agenda, l'emploi du temps et les tâches, ce qui est le
  bon ordre par défaut, mais c'est la contextualisation qui réglera vraiment la
  question, en reléguant ce qui n'a rien à dire au moment où l'on regarde.
