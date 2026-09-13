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

Lecture (jeton `read` ou `write`) : le résumé du jour (`foyer_aujourdhui`), la
liste de courses, les tâches, l'agenda, le planning des repas, la recherche et
le détail des recettes, la liste des membres.

Écriture (jeton `write` seulement) : ajouter des courses, cocher des courses,
créer une tâche, terminer une tâche, créer un événement, importer une recette
depuis une adresse web.

Ce que l'assistant **ne peut pas** faire, quelle que soit la portée : les
**Finances** (lecture comme écriture), les **réglages**, la **gestion des
comptes** et de la sécurité. Il ne peut pas **terminer une tâche récurrente**
(une série se coche dans l'app, qui calcule la prochaine échéance), ni
**supprimer** quoi que ce soit. Chaque écriture est **attribuée** au membre, et
le fil d'activité de l'accueil affiche « (via un assistant) ».

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

Les connecteurs personnalisés de claude.ai et de ChatGPT n'acceptent pas un
en-tête Bearer statique : ils attendent un flux **OAuth**. Ce n'est **pas encore
disponible** dans Foyer (prévu dans une prochaine étape). En attendant, ces
clients ne peuvent pas se brancher ; Foyer ne fournit pas non plus de pont local
`stdio`.

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
- « Mets un rendez-vous mercredi à 9h30 : contrôle technique. »
- « Cherche une recette de gratin et donne-moi les ingrédients. »

Et ce à quoi il répondra qu'il ne peut pas : toucher aux finances, changer un
réglage, terminer une tâche récurrente, ou supprimer quelque chose.

## Sécurité

Un client MCP compromis, c'est **un jeton à révoquer** (dans *Paramètres → Mon
compte*, ou par un administrateur depuis la fiche d'accès du membre), jamais le
foyer ouvert à un inconnu : le jeton agit au nom d'un seul membre, avec ses
droits, sans accès aux finances ni aux réglages. Voir
[`exploitation-securite.md`](exploitation-securite.md).
