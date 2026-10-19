# Portail enfant et module « Tables » : état des lieux

État du code au 19/10/2026 (`main` = `ba07119`). Document à valider avant toute PR.

## A1. La session basculée

### Ce que le code fait aujourd'hui, et pourquoi « sans modifier les gardes » n'est pas tenable tel quel

Une session, c'est un **compte** (`users.id`) ; le membre est retrouvé ensuite par `users.member_id` (`resolveMember`, `auth/session.ts`). Un enfant sans identifiants n'a **pas de ligne `users`** : il n'existe que dans le document. Il faut donc qu'une session puisse désigner un membre sans compte, et cela se règle à **un seul endroit** (`auth` + `resolveMember`). Toutes les gardes en aval (`requireMember`, `requireAdulte`, `requireAdmin`, `requireModule`, filtres École par élève, outils MCP `adultes`) lisent `currentMember(req)` et marchent alors sans changement.

Le piège : si la session basculée gardait `req.user.id` = Nolwenn, toutes les routes « de compte » agiraient sur **le compte de Nolwenn** depuis l'iPad de Raphaël (`/me/credentials`, `/me/totp/*`, création de jetons d'API, consentement OAuth d'un assistant, abonnement push). D'où la forme ci-dessous.

### Le jeton

Signé avec le secret des sessions, mais d'un type distinct (`typ: 'sw'`), jamais rendu dans le corps d'une réponse (cookie seul) :

| Claim | Contenu |
|---|---|
| `typ` | `'sw'` : jamais confondu avec un jeton ordinaire |
| `mid` | identifiant du **membre** enfant (pas de compte nécessaire) |
| `via` | `users.id` du parent qui a basculé |
| `vtv` | `token_version` du parent au moment de la bascule |
| `sid` | ligne du journal des bascules (`auth_switches`) |
| `at` | moment de la bascule |
| `iat`/`exp` | durée = `sessionDays`, comme une session normale |

À chaque requête, `auth` accepte ce jeton seulement si : la ligne `sid` est **encore ouverte**, le parent existe et sa `token_version` vaut `vtv`, le membre `mid` existe et est **toujours `enfant: true`**. Conséquences voulues : changer le mot de passe de Nolwenn ferme aussi les sessions d'enfant qu'elle a ouvertes ; décocher « enfant » sur la fiche de Raphaël ferme sa session basculée au lieu d'en faire un adulte ; un parent peut **fermer à distance** la session de l'iPad depuis Paramètres → Membres (la ligne `sid` se ferme). Un compte enfant éventuel n'entre pas en jeu : la session basculée est celle du membre.

`req.user` porte alors un identifiant de compte nul (aucune ligne ne correspond, les routes de compte répondent 401) **et** une garde explicite `denySwitched` ferme : `/me/credentials`, `/me/totp/*`, `/api/tokens*`, l'autorisation OAuth, `POST /auth/switch/:id`, `POST /push/subscribe` (voir A1 push). `denyToken` reste ce qu'il est (refus des jetons d'API) et s'ajoute sur les deux routes de bascule : pas de bascule par jeton ni par MCP.

`GET /me` en session basculée : `{ memberId, name, enfant: true, admin: false, email: null, totp: false, switched: { via: <memberId parent>, viaName, at, sid } }`. Le renouvellement à mi-vie réémet un jeton `sw` aux mêmes claims, jamais un jeton du parent.

### Routes

- `POST /auth/switch/:memberId` : `auth, denyToken, denySwitched, requireAdulte`. Cible = membre du foyer `enfant: true`, sinon 403. Écrit la ligne `auth_switches` (parent, enfant, User-Agent court, écran d'origine, moment), **remplace** le cookie (un seul cookie, toujours persistant, même si le parent ne s'était pas « souvenu » : sinon iOS perdrait la session à la fermeture de l'app), `log.info`.
- `POST /auth/switch/back` `{ password }` : `authLimiter`, mêmes compteurs `parCompte` (clé = adresse du parent) et `parAdresse` que `/auth/login`, même `verifier`, même leurre de temps, même message neutre (« Mot de passe incorrect. »). Sans TOTP : succès = cookie parent réémis (`ouvrirSession`), ligne fermée, réponse avec l'écran d'origine. Avec TOTP : réponse `{ totp: true, challenge }`, défi signé par le secret du second facteur et lié au `sid`, puis `POST /auth/switch/back/totp` `{ challenge, code }`, copie du flux `/auth/login/totp` (pas déjà consommé, codes de secours). Échec = le cookie de l'enfant n'est pas touché.
- `POST /auth/logout` en session basculée : efface le cookie et ferme la ligne (« session fermée »), écran de connexion.

**À savoir (recette « trois mauvais mots de passe »)** : avec les seuils actuels, l'attente commence au 6ᵉ échec (`franchise: 5`, puis 30 s qui doublent jusqu'à 15 min). Au 3ᵉ, le compteur tourne mais rien ne se voit encore. Et le compteur est celui du **compte** : Gaëtan qui s'acharne sur l'iPad retarde aussi une **nouvelle** connexion de Nolwenn sur un autre appareil (ses sessions ouvertes ne sont pas touchées). C'est le prix de « même limitation que `/auth/login` », et je le recommande tel quel.

### La file hors ligne, le point délicat

Aujourd'hui : trois files persistées dans le stockage local **sans propriétaire** (`foyer.shopQueue`, `foyer.taskQueue`, `foyer.placeQueue`), plus les modifications du document en attente (`pending`) et le document gardé hors ligne (IndexedDB). Le serveur attribue une opération à la session qui l'envoie : une coche de Nolwenn restée en file et envoyée après la bascule serait **écrite au nom de Raphaël**. Le service worker a le même défaut (`pushsubscriptionchange` se réabonne avec le cookie du moment).

Ce que je propose, trois verrous :

1. **Vider avant de basculer, dans les deux sens.** Le client envoie `pending` et les trois files (et la file Tables, B) ; s'il reste quoi que ce soit, la bascule est **refusée** : « Des changements n'ont pas encore été envoyés. Réessayez quand l'appareil est en ligne. » La bascule et le retour demandent le réseau de toute façon.
2. **Files rangées par propriétaire** : `foyer.taskQueue.<memberId>`, etc. Une file qui aurait survécu (onglet tué au mauvais moment) dort sous sa clé et ne repart que quand ce membre est de nouveau la session. L'ancienne clé sans suffixe est reprise une fois au premier démarrage.
3. **Contrôle serveur** : chaque opération porte `by: <memberId>` ; le serveur refuse (409, gardée en file) une opération dont `by` n'est pas le membre de la session. Défense en profondeur, peu coûteuse.

Après une bascule réussie : document gardé effacé, puis **rechargement complet de la page**. C'est la seule façon sûre de ne rien laisser en mémoire (store Finances, URL de photos, état d'administration) : un enfant qui fouille ne trouve rien.

### Notifications push : réponse à ta question

**Non, un appareil ne porte pas deux abonnements.** Un navigateur (une PWA) n'a qu'un abonnement push, et la table `hh_push_subs` a `endpoint` unique avec `ON CONFLICT … SET member_id = excluded.member_id` : si Raphaël « activait les rappels » sur l'iPhone de Nolwenn, l'abonnement **passerait** à Raphaël et Nolwenn ne recevrait plus rien sur son téléphone. Le cas du cabinet serait cassé.

Donc dans cette version : **pas de push en session d'enfant** (carte d'activation absente, `POST /push/subscribe` refusé, réabonnement du service worker sans effet). L'abonnement du parent reste intact.

**Conséquence visible à arbitrer** : les rappels du parent continuent d'arriver sur l'appareil basculé. Sur l'iPhone 10 minutes, c'est voulu ; sur l'iPad familial resté « Raphaël » toute la semaine, l'écran verrouillé afficherait les rappels de Nolwenn (échéance de contrat, tâches). Ma recommandation : ne pas abonner un parent sur l'iPad familial (je le dirai dans la doc et dans le menu de bascule si l'appareil est abonné). Deux rappels par membre sur un même appareil demanderaient de changer le schéma (clé `endpoint + member_id`) et d'accepter ce mélange : à reporter.

### Une autre conséquence visible : la déconnexion après inactivité

`inactivityHours` (défaut 12 h) ferme la session dans le navigateur : l'iPad « Raphaël » serait sur l'écran de connexion chaque matin, et Raphaël ne peut pas se connecter. **Je recommande d'exempter les sessions basculées** (droits d'enfant, rien à protéger de plus, et c'est le but du portail).

## A2. Ce qu'un enfant voit aujourd'hui

- **Menu et grille d'accueil** : 12 écrans (tout sauf Finances, Employé, Paramètres) : Calendrier, Listes de courses, Tâches, Planning des repas, Recettes, Emploi du temps, Entretien, Équipements, Lieux, Contacts, Cartes de fidélité, École. Petites tuiles d'adulte.
- **Accueil** : fil d'activité de toute la famille (« Nolwenn a ajouté … »), agenda, tâches, repas, carte École, carte Entretien, carte d'invitation aux notifications.

**Écart avec ton cas réel** : tu décris « son accueil, son emploi du temps, ses devoirs, ses tâches, ses exercices, et rien d'autre ». Aujourd'hui, un enfant voit les Contacts (adresses, téléphones), les cartes de fidélité, l'Équipement, et le fil d'activité des parents. Et franchement : le **document entier** part à tout membre, enfant compris (`GET /api/state` n'est pas filtré). Masquer des écrans ne cache rien à qui lit l'API ; un « colis surprise » noté dans l'agenda ou une tâche est lisible par un enfant aujourd'hui, avec ou sans ce chantier. Filtrer le document par rôle est un chantier à part (et il touche Courses, Tâches, Lieux qui s'écrivent par opérations) ; je ne l'inclus pas.

Ce que je propose pour l'accueil enfant, sans nouvelle page :

| Point | Proposition |
|---|---|
| Grille | Pour un enfant : seulement **Emploi du temps, École, Tâches, Tables, Calendrier** (module éteint = absent), tuiles de 96 px minimum, libellés « Mon emploi du temps », « Mes devoirs », « Mes tâches », « Mes tables ». Les autres écrans restent ouverts par le menu (droits inchangés). |
| Fil d'activité | Masqué pour un enfant (il raconte les gestes des parents). |
| Tâches | Filtrées sur « les miennes » par défaut. |
| Cartes vides | Une carte sans contenu ne s'affiche pas (pas de « rien aujourd'hui » en série). |
| Notifications | Carte d'invitation masquée en session basculée (A1). |

**Question 1** : menu enfant restreint à ces cinq écrans aussi (ma recommandation, c'est ce que tu décris), ou seulement la grille d'accueil ?

## B1. Modèle de maîtrise

Ta proposition (Leitner 0 à 5, couple commutatif `a ≤ b`, montée sur bonne rapide, immobile sur lente, −2 sur fausse, espacement 1/3/7/14/30 jours) est la bonne base. Trois corrections, sinon elle ment :

1. **Une seule montée par couple et par échéance.** Sans cela, 6 × 7 et 7 × 6 posés trois fois dans la même session amènent le couple au niveau 4 en dix minutes. Règle : une bonne réponse rapide fait monter **seulement si le couple était dû** (`next_at` passé) ; sinon elle compte dans `good_count` sans bouger le niveau. Une fausse fait toujours descendre et rend le couple dû tout de suite.
2. **L'ordre des réponses compte** : une session faite hors ligne mardi peut arriver après celle de mercredi. À la réception, je recalcule les couples touchés depuis toutes leurs réponses, dans l'ordre de `asked_at`. `tab_mastery` est donc toujours une fonction exacte de `tab_answers`, et la commande `tables:recalcul` fait la même chose pour tout un membre.
3. **Le résultat d'une réponse est figé à la réponse** (`bon`/`lent`/`faux`, selon le barème du jour). Le recalcul repart des résultats stockés, jamais des millisecondes : changer le barème ne réécrit pas le passé. Reclasser l'historique avec un nouveau barème existe, mais seulement par l'option explicite `--reclasser`, journalisée.

**Calendrier réel qui en découle** (visible) : niveau 1 le jour même, 2 après 1 jour, 3 après 3 jours de plus, 4 après 7 de plus. « Acquise = niveau 4 » veut dire **11 jours minimum** pour la première case verte. Je recommande un seuil par défaut au **niveau 3** (4 jours, au moins 3 bonnes réponses dont la dernière rapide), réglable dans la configuration et affiché dans l'aide. **Question 2** : 3 ou 4 ?

Tirage d'une session : dus d'abord, puis jamais vus de la plage (au plus un tiers de la session, pour ne pas noyer l'enfant), puis révision au hasard ; **toujours dans la plage du programme** (la consigne de janvier ne ressert pas les tables 6 à 9 à Gaëtan). Hors ligne, le tirage se fait sur la dernière copie connue de la grille de l'enfant. L'horloge de l'iPad fait foi pour `asked_at`, bornée côté serveur (pas de réponse dans le futur). États affichés : pas encore vue, pas assez de données, en cours, acquise.

## B2. Barème de temps (`backend/config/tables-bareme.json`)

Valeurs de départ, à ajuster à l'usage (je n'ai pas de source qui les fonde ; mestables.fr adapte à l'année de naissance sans publier ses valeurs) :

| Âge | Accordé | « Rapide » sous |
|---|---|---|
| 6 ans | 10 s | 5 s |
| 7 ans | 9 s | 4,5 s |
| 8 ans | 8 s | 4 s |
| 9 ans | 7 s | 3,5 s |
| 10 ans | 6 s | 3 s |
| 11 à 14 ans | 5 s | 2,5 s |
| 15 ans et plus | 4 s | 2 s |
| sans date de naissance | 8 s | 4 s, et l'onglet Suivi le signale |

Le parent surcharge par enfant dans le programme. Une réponse après la barre est acceptée, classée « lent », et le texte « un peu lent » accompagne toujours la couleur.

## B3. Bilan pour la maîtresse

Une page A4 par enfant et par période : en-tête (prénom, période, programme en cours), tableau par table (questions, réussite, lentes), opérations encore fragiles, comparaison avec la période précédente, la grille en cases colorées, pied « Foyer ». Le générateur réutilisable est `export/pdf.ts` (celui des Équipements, le module Employé n'en a pas) : il ne sait faire qu'**un** tableau en paysage, sans couleur. Il faut l'étendre (plusieurs blocs, portrait, cases pleines) : petit, et je l'inclus dans la PR 5. Aucune donnée d'un autre membre n'entre dans la requête, qui ne lit que `member_id` = l'enfant.

## Autres points à savoir avant de commencer

- **Projection en tâche (P2)** : la liste « Devoirs de … » n'existe que si le module École est activé **et** l'enfant associé à ÉcoleDirecte (`modEcole` est désactivé par défaut), et elle est verrouillée aux seules projections d'ÉcoleDirecte (`tasks/ops.ts`). Sans École, pas de tâche projetée ; je n'invente pas une seconde liste.
- **Jeton MCP de Raphaël (recette B)** : un jeton d'API appartient à un compte. Un enfant sans identifiants n'en a pas ; il faut lui créer un compte pour ce test.
- **Sauvegarde** : les tables `tab_*` et `auth_switches` sont dans `foyer.db`, donc dans l'instantané `VACUUM INTO` existant ; la procédure de `docs/sauvegarde-restauration.md` les couvre sans changement. Je redonnerai les commandes avant la PR 3.
- **Pas de tiret cadratin** : respecté dans tout le chantier.

## Ce que j'attends de toi

1. Valider la forme du jeton et les trois verrous de la file hors ligne.
2. Push : « pas de push en session d'enfant » et rappels du parent visibles sur l'appareil basculé : d'accord ?
3. Exempter les sessions basculées de la déconnexion après inactivité : d'accord ?
4. Question 1 (menu enfant restreint) et question 2 (seuil d'acquisition 3 ou 4).
