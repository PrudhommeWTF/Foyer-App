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

Sur six domaines, l'assistant fait le même **CRUD** que l'interface web :
le **calendrier**, les **listes de courses**, les **listes de tâches**, le
**planning des repas**, le **carnet de recettes** et l'**emploi du temps**.

Lecture (jeton `read` ou `write`) : le résumé du jour (`foyer_aujourdhui`), la
liste de courses et les **rayons**, les tâches (ouvertes, par échéance, ou
terminées) avec leur rang, l'agenda, le planning des repas, la recherche et le
détail des recettes, l'**emploi du temps** (par membre ou par jour), la liste
des membres.

Écriture (jeton `write` seulement), par domaine :

- **Calendrier** : créer, modifier, supprimer un événement (récurrence comprise).
- **Courses** : ajouter, changer l'état (à prendre / au panier / introuvable),
  modifier (nom, quantité, rayon, liste), retirer ; créer, renommer, supprimer
  une liste de courses.
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

L'ordre des tâches : chaque liste porte un ordre manuel (indexation
fractionnaire), indépendant de l'échéance. `taches_liste` rend le **rang** de
chaque tâche (« 3/7 »), et `tache_deplacer` la range **avant** ou **après** une
autre (désignée par son intitulé, correspondance approchée) ou aux extrémités
(« début » / « fin ») **sans jamais toucher à l'échéance**. En cas d'intitulé
ambigu, l'outil rend les candidats au lieu de deviner. Exemple à la voix :
« déplace le relevé des compteurs avant le rendez-vous notaire ».

Ce que l'assistant **ne peut pas** faire, quelle que soit la portée : les
**Finances** (lecture comme écriture), les **réglages**, la **gestion des
comptes** et de la sécurité, et les **lieux de vacances**. Il ne peut pas
**terminer une tâche récurrente** (une série se coche dans l'app, qui calcule la
prochaine échéance). Les **suppressions** sont possibles, listes entières
comprises, exactement comme dans l'app : à manier avec le même soin. Chaque
écriture est **attribuée** au membre, et le fil d'activité de l'accueil affiche
« (via un assistant) ».

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

Et ce à quoi il répondra qu'il ne peut pas : toucher aux finances, changer un
réglage, terminer une tâche récurrente, ou supprimer quelque chose.

## Sécurité

Un client MCP compromis, c'est **un jeton à révoquer** (dans *Paramètres → Mon
compte*, ou par un administrateur depuis la fiche d'accès du membre), jamais le
foyer ouvert à un inconnu : le jeton agit au nom d'un seul membre, avec ses
droits, sans accès aux finances ni aux réglages. Voir
[`exploitation-securite.md`](exploitation-securite.md).
