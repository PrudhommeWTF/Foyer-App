# Brancher un assistant sur Foyer (serveur MCP)

Foyer expose un serveur **MCP** (Model Context Protocol) : un assistant (Claude,
ChatGPT, ou tout client MCP) peut alors **lire et agir dans le foyer au nom d'un
membre**, avec ses droits, et jamais plus. « Ajoute du lait à la liste »,
« qu'est-ce qu'on mange cette semaine ? », « note que je dois appeler le
dentiste vendredi ».

## En bref

- Le point d'entrée est **`/mcp`** (par ex. `https://foyer.exemple.fr/mcp`).
- Il faut **l'activer** : *Paramètres → Accès et comptes → « Ouvrir le serveur
  pour les assistants (MCP) »* (réservé à un administrateur). Éteint (par
  défaut), `/mcp` répond « introuvable ».
- L'assistant s'authentifie avec un **jeton d'accès** que vous créez dans
  *Paramètres → Mon compte* (voir le README, section « Accès par jeton »).
  Portée `read` (lecture) ou `write` (lecture et écriture).
- Le jeton se porte en en-tête **`Authorization: Bearer foyer_…`**. Une session
  de navigateur (cookie) n'ouvre **pas** `/mcp`.

## Ce que l'assistant peut faire

Sur sept domaines, l'assistant fait le même **CRUD** que l'interface web :
le **calendrier**, les **listes de courses**, les **listes de tâches**, le
**planning des repas**, le **carnet de recettes**, l'**emploi du temps** et les
**lieux de vacances**.

Lecture (jeton `read` ou `write`) : le résumé du jour (`foyer_aujourdhui`), la
liste de courses et les **rayons**, les tâches (ouvertes, par échéance, ou
terminées) avec leur rang, l'agenda, le planning des repas, la recherche et le
détail des recettes, l'**emploi du temps** (par membre ou par jour), les **lieux
de vacances** et leur inventaire, la liste des membres.

Un huitième domaine, **Employé à domicile** (le suivi des heures de ménage et la
préparation de la déclaration CESU), est **réservé aux adultes** : ses outils
`menage_*` sont **invisibles et refusés** à un jeton porté par un enfant, du côté
serveur. Un adulte peut demander le récapitulatif d'un mois (heures, salaire net,
chiffres à recopier sur le CESU), lister les présences, noter que l'employé est
venu, ajuster ou retirer une présence, et déclarer, marquer payé, rouvrir ou
marquer « sans présence » un mois. **Le taux horaire et l'employé lui-même ne se
règlent pas par l'assistant** (données sensibles, réservées aux Paramètres).

Un neuvième domaine, **École** (ÉcoleDirecte), n'existe que si le module est
activé (il est éteint par défaut). Ses outils `ecole_*` lisent ce que Foyer a
synchronisé, jamais ÉcoleDirecte en direct :

| Outil | Ce qu'il rend |
|---|---|
| `ecole_devoirs` | Les devoirs de demain (défaut), de la semaine, ou d'une date, par enfant, avec leur `[id]`, l'énoncé, « interrogation », fait ou à faire, et « pas encore transmis » le cas échéant |
| `ecole_devoir_fait` (écriture) | Coche un devoir (ou le décoche avec `fait: false`) : c'est la même coche que la tâche « Devoirs de … », renvoyée à ÉcoleDirecte au passage suivant |
| `ecole_emploi_du_temps` | Les cours importés d'un jour, cours annulés signalés, heure de sortie |
| `ecole_notes` | Les dernières notes, filtrables par matière (« maths » retrouve « Mathématiques ») ou date, et les moyennes de la période **telles que calculées par l'établissement** |
| `ecole_vie_scolaire` | Absences, retards (justifiés ou non), sanctions, encouragements de l'année |
| `ecole_etat` | L'état de la synchronisation : par compte, par enfant, dernière réussite, dernière erreur |

**Un jeton d'enfant ne voit que lui** : sans `enfant`, il reçoit ses propres
devoirs, cours, notes et vie scolaire ; en nommant un frère ou une sœur, il
reçoit « Refusé : ce compte ne donne accès qu'à ce qui vous concerne ». Le
filtre est fait côté serveur, dans chaque outil. Quand la synchronisation est
en échec, chaque réponse le dit avec la date des données : l'assistant ne
présente jamais des devoirs d'avant-hier comme ceux de demain. Les identifiants
ÉcoleDirecte, le réglage des comptes et la question de sécurité ne sont pas
accessibles par l'assistant.

Un dixième domaine, **Entretien de la maison** (cartouche de la carafe,
détecteurs de fumée, chaudière), est ouvert à tout membre et disparaît avec son
module. Ses outils passent par les mêmes opérations que l'écran : une seule
réalisation par jour, prochaine date calculée par le serveur à partir du jour
du geste, stock repris d'un coup, et l'historique garde « via un assistant ».

| Outil | Ce qu'il fait |
|---|---|
| `entretien_liste` | Les gestes d'entretien de la maison d'ici 7 jours (défaut, retards compris), en retard, ou tous, filtrables par pièce ou appareil : `[id]`, fréquence, dernière fois et par qui, prochaine date, stock |
| `entretien_fait` (écriture) | Note un geste fait aujourd'hui (ou à une date), par le membre du jeton, un autre membre ou « le foyer ». Une seule réalisation par jour ; la prochaine date part du jour du geste ; le stock baisse |
| `entretien_creer` (écriture) | Crée un geste : intitulé, fréquence en français (« tous les 6 mois »), pièce (créée au besoin), appareil, consommable, et saison facultative (« de mai à septembre » ; avec « 1 fois par an », c'est une fenêtre : « à faire entre le 01/09 et le 31/10 »). Sans saison, il reste « pas encore noté » jusqu'à la première fois |
| `entretien_stock` (écriture) | « J'en ai racheté 6 » (ajout) ou « il en reste 4 » (comptage), daté |
| `entretien_pause` (écriture) | Met un geste en pause jusqu'à une date (absence, panne) ; il revient seul. Pour ce qui revient chaque année, la saison est le bon outil |

Écriture (jeton `write` seulement), par domaine :

- **Calendrier** (adultes seulement ; un jeton d'enfant lit `agenda` sans pouvoir le modifier) : créer, modifier, supprimer un événement (récurrence comprise). Ces outils visent toujours la série entière ; les occurrences qu'une série saute (modifiées ou supprimées seules dans l'app) n'apparaissent pas dans `agenda`.
- **Courses** : ajouter, changer l'état (à prendre / au panier / introuvable),
  modifier (nom, quantité, rayon, liste), retirer ; créer, renommer, supprimer
  une liste de courses. Le rayon se donne par son nom, sans emoji ni souci
  d'accents ou de casse (« frais », « fruits & légumes ») ; l'outil `rayons`
  liste les noms. Un rayon non reconnu ne bloque pas : l'article est rangé au
  rayon de repli et la réponse le signale au lieu de laisser croire qu'il a été
  appliqué.
- **Tâches** : créer (au besoin en tête), modifier, terminer, rouvrir, ranger
  dans l'ordre du foyer (`tache_deplacer`), supprimer ; créer, renommer,
  archiver, supprimer une liste de tâches.
- **Repas** : poser un repas sur un créneau (recettes et/ou texte, couverts,
  absents), vider un créneau.
- **Recettes** : créer (ingrédients, étapes, portions, temps), modifier,
  supprimer, ou importer depuis une adresse web.
- **Emploi du temps** : créer, modifier, supprimer un créneau (hebdomadaire ou
  ponctuel, période de validité, filtre scolaire/vacances, publication à
  l'agenda).
- **Lieux de vacances** : créer, modifier, supprimer un lieu (inventaire) ;
  ajouter des affaires, changer leur état (sur place / ramenée), les modifier
  (nom, quantité, déplacement vers un autre lieu), les retirer.
- **Employé à domicile** (adultes seulement) : noter une présence
  (`menage_presence_ajouter`), la modifier, la retirer ; déclarer un mois,
  le marquer payé, le rouvrir, ou le marquer sans présence. Pas de réglage du
  taux ni de gestion de l'employé.

L'ordre des tâches : chaque liste porte un ordre manuel (indexation
fractionnaire), indépendant de l'échéance. `taches_liste` rend le **rang** de
chaque tâche (« 3/7 »), et `tache_deplacer` la range **avant** ou **après** une
autre (désignée par son intitulé, correspondance approchée) ou aux extrémités
(« début » / « fin ») **sans jamais toucher à l'échéance**. En cas d'intitulé
ambigu, l'outil rend les candidats au lieu de deviner. Exemple à la voix :
« déplace le relevé des compteurs avant le rendez-vous notaire ».

Ce que l'assistant **ne peut pas** faire, quelle que soit la portée : les
**Finances** (lecture comme écriture), les **réglages**, et la **gestion des
comptes** et de la sécurité. Il ne peut pas **terminer une tâche récurrente** (une série se coche dans l'app, qui calcule la
prochaine échéance). Les **suppressions** sont possibles, listes entières
comprises, exactement comme dans l'app : à manier avec le même soin. Chaque
écriture est **attribuée** au membre, et le fil d'activité de l'accueil affiche
« (via un assistant) ».

### Équipements

Quand le module **Équipements** est actif (il l'est par défaut), six outils
lisent et notent les fiches des appareils de la maison. La garantie est
calculée à la date du jour, avec les règles du foyer, comme dans l'écran.

| Outil | Ce qu'il fait |
|---|---|
| `equipements_liste` | Les appareils avec leur `[id]`, marque et modèle, pièce et garantie (« Sous garantie jusqu'au … »). Filtres : `piece`, `garantie` (`sous_garantie`, `expire_bientot`, `hors_garantie`, `inconnue`), `categorie`, `recherche` (désignation, marque, modèle, numéro de série) |
| `equipement_detail` | La fiche complète (par `id`, ou `nom` s'il est unique) : garantie expliquée, numéro de série, achat, pièces jointes présentes, historique des pannes et réparations |
| `equipement_pieces` | Les pièces de la maison et le nombre d'appareils dans chacune |
| `equipement_creer` (écriture, adultes) | Crée une fiche : `nom` seul suffit, puis `piece`, `marque`, `modele`, `serie`, `achete_le`, `prix`, `garantie_mois` |
| `equipement_modifier` (écriture, adultes) | Change les champs donnés, dont `garantie_fin` (extension) et `statut` |
| `equipement_evenement` (écriture, adultes) | Note une panne, un appel au SAV, une réparation (avec son coût) : une panne passe la fiche « en panne », une réparation la remet « en service » |

**Un enfant lit sans numéro de série ni montant**, et ne crée ni ne modifie
rien : les outils d'écriture lui sont invisibles et refusés. **Aucun fichier ne
sort par l'assistant** : il dit qu'une facture est jointe, elle s'ouvre dans
l'application. Module éteint : les six outils disparaissent.

### Révisions

Quand le module **Révisions** est actif (il l'est par défaut), huit outils
lisent le suivi des enfants, règlent leur programme et gèrent les listes de la
dictée. Ils ne connaissent
aucun exercice en particulier : `revisions_exercices` dit à l'assistant quels
exercices existent et quels paramètres il peut régler.

| Outil | Ce qu'il fait |
|---|---|
| `revisions_exercices` | Les exercices (les tables, les soustractions, la lecture de l'heure, la dictée de mots), leur matière, et les paramètres d'un programme avec leurs bornes et leurs défauts |
| `revisions_progression` | Où en est un enfant (ou chacun, sans `enfant`) : programme, temps par réponse, items acquis, en cours ou pas encore vus, ce qui reste fragile, réussite par groupe sur 4 semaines. `exercice` facultatif |
| `revisions_sessions` | Les sessions depuis `depuis` (défaut : 7 jours) : date, exercice, mode, réglages, bonnes, lentes, fausses |
| `revisions_bilan` (adultes) | Le bilan d'une période (`semaine`, `semaine-derniere`, `mois`, `mois-dernier`) : par matière puis par exercice, réussite comparée à la période précédente, ce qui reste fragile |
| `revisions_programme_definir` (écriture, adultes) | Règle le programme d'un enfant : `params` de l'exercice (ceux qui manquent gardent la valeur en cours), `questions`, `objectif_jour`, `secondes` (ou `null` pour le barème selon l'âge) ; `retirer: true` le retire sans rien effacer |
| `revisions_listes` | Les listes d'un exercice à contenu (la dictée) : livrées et du foyer, archivées signalées, leurs premiers mots, et quels enfants les travaillent |
| `revisions_liste_creer` (écriture, adultes) | Crée une liste du foyer (« la dictée de la semaine ») : `nom`, `mots` (une liste, ou un texte séparé par des virgules ou des retours à la ligne), mêmes règles qu'à l'écran. Pour qu'un enfant la travaille, ensuite `revisions_programme_definir` avec `params` { liste } |
| `revisions_liste_modifier` (écriture, adultes) | Change le `nom` ou les `mots` d'une liste du foyer, ou l'archive (`archiver`) ; jamais d'effacement, et une liste livrée ne se modifie pas ici |

**Un enfant ne voit que lui** : sa progression et ses sessions, ni bilan ni
réglage ; demander ceux de son frère est refusé. Le PDF « Pour la maîtresse »
ne sort pas par l'assistant : il se télécharge depuis l'écran. Module éteint :
les huit outils disparaissent.

## Brancher chaque client

Remplacez `foyer.exemple.fr` par l'adresse de votre instance et `foyer_…` par
votre jeton.

### Claude Code

```sh
claude mcp add --transport http foyer https://foyer.exemple.fr/mcp \
  --header "Authorization: Bearer foyer_votre_secret"
```

### Claude Desktop et Cowork

Dans le fichier de configuration (`Réglages → Développeur → Modifier la
configuration`), ajoutez une entrée `mcpServers` :

```json
{
  "mcpServers": {
    "foyer": {
      "url": "https://foyer.exemple.fr/mcp",
      "headers": { "Authorization": "Bearer foyer_votre_secret" }
    }
  }
}
```

### Autres clients MCP (Cursor, Continue, Home Assistant, …)

Configurez un serveur MCP **HTTP (Streamable HTTP)** avec :

- URL : `https://foyer.exemple.fr/mcp`
- En-tête : `Authorization: Bearer foyer_votre_secret`

### claude.ai (web, iPhone) et ChatGPT

Les connecteurs personnalisés de claude.ai (web et mobile) et de ChatGPT
n'acceptent pas un en-tête Bearer statique : ils passent par **OAuth**. Foyer
est son propre serveur d'autorisation, il n'y a **rien à configurer d'autre**
que deux prérequis :

1. Le réglage **« Ouvrir le serveur pour les assistants (MCP) »** activé
   (*Paramètres → Accès et comptes*).
2. L'**« Adresse publique de Foyer »** renseignée (*Paramètres → Notifications*,
   ou la variable `FOYER_PUBLIC_URL`), par ex. `https://foyer.exemple.fr`. Sans
   elle, OAuth reste éteint (le journal le rappelle).

Ensuite, côté client :

- **claude.ai** : *Paramètres → Connecteurs → Ajouter un connecteur
  personnalisé*, coller l'URL `https://foyer.exemple.fr/api/mcp`.
- **ChatGPT** : *Paramètres → Connecteurs → créer*, même URL.

Le client découvre tout seul l'autorisation (enregistrement dynamique,
découverte), puis **ouvre la page de connexion de Foyer** : email, mot de passe,
code du second facteur si activé, et choix de la portée (lecture seule / lecture
et écriture). Après « Autoriser », le connecteur est relié. L'accès obtenu est,
en base, **un jeton comme les autres** (nommé d'après le client, « claude.ai ») :
il se **révoque dans Paramètres → Mon compte**, au même endroit que les jetons
créés à la main.

Le jeton d'accès dure 30 jours et se renouvelle tout seul (jeton de
rafraîchissement de 90 jours, en rotation). Les adresses de redirection
acceptées à l'enregistrement sont limitées à `https://` (plus `http://localhost`
pour un outil local).

## Vérifier que ça marche

Une fois branché, demandez à l'assistant : **« Que dois-je faire aujourd'hui ? »**
Il doit répondre avec la date, les événements, les tâches et les courses du
foyer. Puis, avec un jeton `write` : **« Ajoute du lait et des œufs à la liste de
courses »** ; les deux articles apparaissent dans l'app, attribués à vous, « via
un assistant ».

## Exemples de phrases qui marchent

- « Qu'est-ce qu'on mange cette semaine ? »
- « Ajoute des pâtes, du café et du beurre aux courses. »
- « Crée une tâche : appeler le dentiste, pour vendredi, pour moi. »
- « Crée en tête de liste : préparer les papiers de la voiture. »
- « Déplace le relevé des compteurs avant le rendez-vous notaire. »
- « Où en est ma liste de tâches ? » (chaque tâche sort avec son rang)
- « Mets un rendez-vous mercredi à 9h30 : contrôle technique. »
- « Décale le contrôle technique à 10h et mets le lieu : garage du centre. »
- « Cherche une recette de gratin et donne-moi les ingrédients. »
- « Note le gratin dauphinois pour le dîner de samedi, on sera 6. »
- « Ajoute au carnet ma recette de cookies (voici les ingrédients et les étapes). »
- « Ajoute la piscine de Léa le mardi de 17h à 18h, et publie-la à l'agenda. »
- « Renomme la liste “Courses” en “Semaine”, et supprime la liste “Test”. »
- « Qu'est-ce qui reste au chalet ? » puis « Note que j'ai ramené les raquettes. »
- « La femme de ménage est venue aujourd'hui, 3 heures. » (adulte)
- « Combien d'heures ce mois-ci, et combien à déclarer sur le CESU ? » (adulte)
- « Marque le mois de septembre comme déclaré. » (adulte)
- « Qu'est-ce que Nolan a comme devoirs pour demain ? » (module École)
- « Léo a-t-il une interrogation cette semaine ? »
- « À quelle heure Nolan sort jeudi ? »
- « Quelles sont les dernières notes de Léo en maths ? »
- « J'ai fini mes exercices de maths, coche-les. » (jeton de l'enfant)
- « J'ai testé l'alarme ce matin. » (module Entretien : noté par vous, via l'assistant)
- « Qu'est-ce qu'il y a à faire dans la maison cette semaine ? »
- « J'ai racheté 6 cartouches Brita. »
- « Mets le pH de la piscine en pause jusqu'au 15 avril. »
- « Le lave-vaisselle fuit depuis ce matin. » (adulte : panne notée, fiche « en panne »)
- « Le lave-vaisselle est-il encore sous garantie ? Donne-moi son numéro de série. »
- « Quelles garanties se terminent bientôt ? »
- « Ajoute l'ampli Onkyo TX-SR444 au salon, acheté le 7 novembre 2017. » (adulte)
- « Où en est Raphaël dans ses tables ? Qu'est-ce qui coince ? » (module Révisions)
- « La maîtresse veut les tables de 2 à 5 pour Gaëtan, 15 questions, deux fois par jour. » (adulte)
- « Fais-moi le bilan de la semaine de Raphaël. » (adulte)
- « Qu'est-ce que j'ai révisé cette semaine ? » (jeton de l'enfant)
- « Mets la dictée de Raphaël sur les mots invariables du CE2, 10 mots par session. » (adulte ; la liste de la semaine, elle, se saisit dans l'écran)

Et ce à quoi il répondra qu'il ne peut pas : toucher aux finances, changer un
réglage, terminer une tâche récurrente, ou supprimer quelque chose. Le suivi de
l'**employé à domicile** n'existe pas non plus pour un enfant : ses outils lui
sont invisibles et refusés. Un enfant qui demande les devoirs ou les notes de
son frère reçoit un refus.

## Sécurité

Un client MCP compromis, c'est **un jeton à révoquer** (dans *Paramètres → Mon
compte*, ou par un administrateur depuis la fiche d'accès du membre), jamais le
foyer ouvert à un inconnu : le jeton agit au nom d'un seul membre, avec ses
droits, sans accès aux finances ni aux réglages. Voir
[`exploitation-securite.md`](exploitation-securite.md).
