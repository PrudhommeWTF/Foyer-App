# L'accueil : les règles de contexte

L'accueil met en avant ce qui compte au moment où on l'ouvre : l'agenda et
l'école le matin, le repas et les courses en fin d'après-midi, le lendemain le
soir, la maison et l'administratif le week-end.

Ce qui compte n'est pas une affaire de code : c'est le rythme d'une maison, et
il change. Ces règles sont donc **des données**, dans un fichier que vous
modifiez avec un éditeur de texte, sans recompiler ni redéployer.

## L'ordre choisi à la main l'emporte

Tout ce qui suit décrit le classement **automatique**, celui qui s'applique tant
que personne n'a fixé d'ordre.

Dans **Paramètres, Accueil**, un administrateur peut ranger les tuiles lui-même.
Dès qu'il le fait, son ordre gagne : les règles de ce fichier ne reclassent plus
rien, plus aucune tuile ne se replie, et aucune raison ne s'affiche. L'accueil le
dit sous le bonjour (« ordre choisi dans les Paramètres ») pour qu'on ne cherche
pas la panne du côté de ce fichier, qui n'y est pour rien.

L'ordre est enregistré dans le réglage `homeOrder` (voir `parametres.md`) : une
liste d'identifiants de tuiles séparés par des virgules. Vide, c'est le
classement automatique qui reprend, et le bouton « Revenir à l'ordre
automatique » ne fait rien d'autre que le vider. Une tuile ajoutée par une mise
à jour n'est nommée nulle part dans cet ordre : elle apparaît **à la fin**,
plutôt que de manquer sans un mot.

## Le fichier

```
<répertoire de données>/accueil.json
```

Soit, selon l'installation :

| Installation | Chemin |
|---|---|
| LXC / systemd | `/var/lib/foyer/accueil.json` |
| Docker | le volume monté sur `/data`, donc `/data/accueil.json` dans le conteneur |

Le répertoire est celui de `FOYER_DATA_DIR`, à côté de `foyer.db`.

**Sans ce fichier, les règles par défaut s'appliquent.** Elles sont écrites dans
`backend/src/home/rules.ts` et conviennent à un foyer avec enfants scolarisés.

Le fichier est **relu à chaque ouverture de la page** : modifiez-le, rechargez
l'accueil, c'est appliqué. Aucun redémarrage du service.

## Ce qui se passe si le fichier est mauvais

Rien ne casse, et rien ne se tait :

- Les règles par défaut reprennent la main, **entièrement**. Un jeu de règles
  appliqué à moitié donnerait un écran que personne ne saurait expliquer.
- L'accueil affiche « Règles de contexte ignorées (N erreurs dans accueil.json),
  réglages d'origine appliqués ».
- Le journal du service nomme chaque erreur, avec la ligne concernée :

```sh
journalctl -u foyer -f | grep 'accueil'
# ou
docker compose logs -f foyer | grep 'accueil'
```

```
[foyer] accueil : /var/lib/foyer/accueil.json ignoré, règles par défaut appliquées :
  moments[0] : « id », « label » et « from » (HH:MM) sont requis. |
  regles[3] (tuile « courses ») : moment « soir » inconnu(s).
```

Pour vérifier un fichier sans ouvrir l'application :

```sh
curl -s -H "Authorization: Bearer $JETON" http://localhost:8099/api/home/rules | jq '{source, errors}'
```

`source` vaut `fichier` quand le vôtre s'applique, `defaut` sinon.

Pour **partir des règles actuelles** plutôt que d'écrire de zéro :

```sh
curl -s -H "Authorization: Bearer $JETON" http://localhost:8099/api/home/rules \
  | jq .rules > /var/lib/foyer/accueil.json
```

## Le format

```jsonc
{
  "moments": [
    { "id": "tot",        "label": "Tôt le matin",     "from": "05:00" },
    { "id": "matinee",    "label": "Matinée",          "from": "09:00" },
    { "id": "midi",       "label": "Midi",             "from": "11:30" },
    { "id": "apresmidi",  "label": "Après-midi",       "from": "14:00" },
    { "id": "finjournee", "label": "Fin d'après-midi", "from": "17:00" },
    { "id": "soiree",     "label": "Soirée",           "from": "19:30" },
    { "id": "tard",       "label": "Tard le soir",     "from": "22:00" }
  ],

  "typesDeJour": [
    { "id": "ferie",    "label": "Jour férié",         "quand": "ferie" },
    { "id": "vacances", "label": "Vacances scolaires", "quand": "vacances" },
    { "id": "weekend",  "label": "Week-end",           "quand": "semaine", "jours": [6, 7] },
    { "id": "ecole",    "label": "Jour d'école",       "quand": "emploiDuTemps", "type": "ecole" },
    { "id": "travail",  "label": "Jour de travail",    "quand": "emploiDuTemps", "type": "travail" }
  ],

  "regles": [
    { "tuile": "agenda", "moments": ["tot", "matinee"], "poids": 30,
      "raison": "Le matin, la journée d'abord" },
    { "tuile": "planning", "moments": ["tot"], "jours": ["ecole"], "poids": 30,
      "raison": "Jour d'école : ce qui part ce matin" },
    { "tuile": "economies", "moments": ["tot", "matinee"], "poids": -25 }
  ],

  "seuilRepli": -20
}
```

Le JSON n'accepte pas de commentaires : retirez-les si vous copiez cet exemple.

### `moments`

Le moment actif est **le dernier dont l'heure de début est passée**. Avant le
premier de la liste, c'est le dernier qui vaut : à trois heures du matin on est
encore dans la soirée de la veille, pas dans un néant sans règle.

`from` est au format `HH:MM`, à l'heure du foyer (`Europe/Paris`). Il en faut au
moins un.

### `typesDeJour`

`quand` dit d'où vient la réponse. Quatre sources, toutes tirées de données
réelles, jamais d'une liste de dates qui périmerait l'année prochaine :

| `quand` | Ce qu'il regarde |
|---|---|
| `ferie` | Les jours fériés de France métropolitaine, calculés (Pâques comprise) |
| `vacances` | Les vacances scolaires de l'**académie configurée** dans les réglages, récupérées auprès de `data.education.gouv.fr` |
| `semaine` | Les jours listés dans `jours` : lundi = 1, dimanche = 7 |
| `emploiDuTemps` | Un créneau du type `type` existe aujourd'hui dans l'emploi du temps du foyer (`ecole`, `travail`, `sport`, `loisir`, `sante`, `repas`, `autre`) |

`emploiDuTemps` est ce qui donne « jour d'école » et « jour de présence chez le
client » sans rien saisir de plus : c'est l'emploi du temps de la famille qui le
dit.

Plusieurs types peuvent valoir en même temps (un samedi de vacances est à la
fois `weekend` et `vacances`).

### `regles`

| Champ | Rôle |
|---|---|
| `tuile` | L'identifiant de la tuile : `agenda`, `planning`, `taches`, `repas`, `courses`, `finances`, `echeances`, `energie`, `economies`, `messages` |
| `moments` | Les moments concernés. **Absent = tous les moments** |
| `jours` | Les types de jour concernés. **Absent = tous les jours** |
| `poids` | Positif pour remonter, négatif pour reléguer. Les poids des règles applicables **s'additionnent** |
| `raison` | Affichée sur la tuile quand elle a été remontée |

Écrivez toujours une `raison` sur une règle positive. Sans elle, l'écran bouge
sans dire pourquoi, et un écran comme celui-là est un écran qu'on cesse de
regarder.

À score égal, c'est l'ordre de déclaration des tuiles dans l'application qui
départage. Jamais le hasard : le même contexte donne toujours le même écran.

### `seuilRepli`

En dessous de ce score, une tuile est **repliée** : son titre et son compteur
restent visibles, son contenu se déplie d'un tap. Elle n'est **jamais** retirée
de la page.

## Les trois garde-fous

Ils ne sont pas configurables, et c'est volontaire.

1. **Le contexte réordonne et replie, il ne masque jamais.** Toutes les tuiles
   restent sur la page, à un défilement de là. Un ordre choisi à la main ne les
   masque pas non plus : il les range, il n'en retire aucune.
2. **L'ordre ne dépend que du jour et du moment.** Il est figé et n'est refait
   qu'au franchissement d'une frontière. Une tuile ne bouge donc **jamais**
   parce qu'une donnée vient d'arriver : l'écran est stable entre deux moments
   de la journée.
3. **Une tuile en panne n'est ni repliée ni reléguée.** Ce qui est cassé doit se
   voir, quelle que soit l'heure.

Le contexte actif est écrit en toutes lettres sous le bonjour : « Mercredi
2 septembre · Fin d'après-midi · jour d'école ». C'est ce qui permet de dire
« ah, c'est pour ça » devant un écran qui n'est pas dans le même ordre qu'hier
soir, sans lire une ligne de code.

## Ce que le contexte ne sait pas faire

Dit franchement, pour que vous ne le cherchiez pas :

- **« Jour de garde des enfants »** n'est modélisable par rien aujourd'hui.
  L'emploi du temps dit qui est hors du foyer à telle heure, ce qui n'est pas la
  même chose. Il faudrait un champ dédié, dans le module Membres, pour que la
  règle existe.
- **Les événements saillants** (une échéance proche, une tâche en retard) ne
  déplacent pas les tuiles. C'est un écart assumé au cahier des charges : un
  ordre qui change quand une donnée arrive est exactement l'écran imprévisible
  qu'on cherchait à éviter. La saillance est traitée **à l'intérieur** des
  tuiles, où elle ne déplace rien : un préavis de résiliation s'affiche en rouge,
  une alerte alimentaire aussi.
- **Aucun réglage par utilisateur.** Une seule vue, la même pour tout le foyer,
  comme demandé. L'ordre choisi à la main est lui aussi celui du foyer, pas
  celui d'un membre.
- **Pas de demi-mesure entre l'ordre choisi et les règles.** Un ordre fixé les
  éteint entièrement plutôt que de les laisser bousculer ce qu'on vient de
  ranger. Pour retrouver le classement automatique, videz l'ordre.

## Recette

1. Ouvrez l'accueil à 7 h 30, à 18 h et à 22 h. L'ordre des tuiles diffère, et
   la ligne sous le bonjour dit pourquoi.
2. Mettez `"poids": 50` sur la tuile `messages` pour le moment `matinee`,
   rechargez : la messagerie passe en tête, avec votre raison écrite dessus.
3. Cassez volontairement le fichier (une virgule en trop) et rechargez :
   l'accueil s'affiche normalement, avec un avertissement, et le journal nomme
   l'erreur.
