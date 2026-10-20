# Portail enfant : ouvrir la session d'un enfant depuis celle d'un parent

Le soir, un parent ouvre Foyer sur l'iPad, choisit « Ouvrir la session de Raphaël », et l'iPad devient « Raphaël » : son accueil, ses écrans, ses droits, rien d'autre. Pour revenir à la session du parent, il faut son mot de passe (et son code s'il a posé un second facteur). L'enfant n'a besoin ni d'adresse, ni de mot de passe, ni de compte : il suffit qu'il soit membre du foyer avec la case « enfant » cochée.

## À l'usage

- **Ouvrir** : toucher son avatar (en haut sur téléphone, en bas de la barre latérale sur tablette et ordinateur), puis l'enfant sous « Ouvrir la session de… ». Un tap, pas de confirmation. L'application se recharge sur l'accueil de l'enfant.
- **En session d'enfant** : un bandeau en haut, « Raphaël · session ouverte par Nolwenn », et le bouton « Revenir à Nolwenn ». Le reste est l'interface d'un enfant. La session survit à la fermeture de l'application et ne se ferme **pas** après inactivité (réglage « Déconnexion après inactivité ») : un enfant ne saurait pas la rouvrir seul.
- **Revenir** : « Revenir à Nolwenn », son mot de passe, puis le code de son téléphone si elle a un second facteur. L'application se recharge sur l'écran d'où elle était partie. « Se déconnecter » (menu de l'avatar) depuis la session de l'enfant ramène à l'écran de connexion, pas au parent.
- **Passer d'un enfant à l'autre** : revenir au parent, puis ouvrir l'autre session. Deux gestes, c'est voulu : on ne bascule jamais d'une session d'enfant vers une autre.
- **Le journal** : Paramètres → Membres, sous chaque enfant, les trois dernières sessions ouvertes pour lui (« Session ouverte par Nolwenn le 19/10 à 18 h 42 sur iPad »), comment elles se sont refermées, et « Fermer » pour une session restée ouverte.

### Ce qu'un enfant voit

Ceci vaut pour toute session d'enfant, ouverte par un parent ou avec ses propres identifiants.

- **Menu** : Accueil, Calendrier, Tâches, Emploi du temps, École et Révisions (chacun si son module est activé). Les autres écrans (Courses, Repas, Recettes, Contacts, Cartes de fidélité, Équipements, Lieux, Entretien) n'y figurent plus. C'est un menu d'enfant, pas un droit : le serveur ne refuse que les écrans d'adultes (Finances, Employé, Paramètres). Le menu « + » ne propose qu'une tâche ou un créneau.
- **Tâches** : seulement les siennes, celles où il est nommé (sur la tâche ou l'une de ses sous-tâches, qui se montre alors sous sa tâche), et tout ce que contiennent ses listes à lui (sa liste privée, la préparation de sa valise). Une tâche « pour le premier qui passe » n'est pas la sienne. Il ne voit que les listes où il a quelque chose, et les siennes, même vides ; ce qu'il ajoute porte toujours son nom, sinon la tâche lui échapperait aussitôt. Le même filtre vaut pour l'accueil, la recherche, les repères du calendrier et les notifications.
- **Emploi du temps** : seulement le sien, sans filtre à régler ; un nouveau créneau est pour lui. La présence aux repas et les couverts, eux, comptent toujours tout le foyer.
- **Calendrier** : en lecture seule. Il voit tout le calendrier et ouvre le détail d'un événement, mais n'en crée, n'en modifie ni n'en supprime aucun : ni bouton « Ajouter un événement », ni double tap sur un jour, ni Modifier ou Supprimer dans la fiche. Cette fois, c'est **un droit** : `PUT /state` garde les événements du serveur quoi qu'envoie la session d'un enfant (le reste de l'envoi, un créneau par exemple, passe), et les outils d'assistant `evenement_*` sont réservés aux adultes.
- Les filtres des tâches et de l'emploi du temps sont, eux, comme le menu, une affaire d'écran : le document entier arrive sur l'appareil, et les outils d'assistant ne filtrent pas les tâches ni l'emploi du temps d'un jeton d'enfant.
- **Accueil** : de grandes tuiles (« Le calendrier », « Mes tâches », « Mon emploi du temps », « Mes devoirs », « Mes révisions »), puis ses tâches à faire, ses devoirs et les prochains événements. Pas de fil d'activité (il raconte les gestes des parents), et une carte sans rien à dire ne s'affiche pas.

## Ce qui ne change pas : les droits

La session ouverte est celle du **membre enfant**, avec exactement les gardes d'une session d'enfant ordinaire : Finances, Employé à domicile, coûts d'Entretien, Paramètres et administration refusés (403), outils MCP réservés aux adultes refusés. Un enfant qui a par ailleurs un compte peut toujours se connecter seul sur son appareil : les deux chemins mènent aux mêmes droits.

À savoir : le document du foyer (agenda, tâches, contacts, recettes…) part à tout membre, enfant compris, comme avant. Masquer un écran ne cache rien à qui lit l'API ; ce n'est pas l'objet de ce chantier.

## Le jeton de la session basculée

Un cookie `foyer_session` (`HttpOnly`, `SameSite=Lax`), comme une session ordinaire, qu'il **remplace** : il n'y a qu'une session sur l'appareil, et le navigateur ne garde aucune trace de celle du parent (ni second cookie, ni jeton dans le stockage local).

| Claim | Contenu |
|---|---|
| `typ` | `'sw'` : jamais lu comme une session ordinaire, ni l'inverse |
| `mid` | le membre enfant (pas besoin de compte) |
| `via`, `vtv` | le compte du parent et la version de son jeton au moment de la bascule |
| `sid` | la ligne du journal `auth_switches` |
| `at` | le moment de la bascule |

Le serveur revérifie à **chaque requête** : la ligne du journal est encore ouverte, le parent existe avec la même version de jeton et reste un adulte du foyer, l'enfant existe et est **toujours** marqué enfant. Sinon : 401, et l'appareil revient à l'écran de connexion. D'où :

- changer le mot de passe du parent ferme aussi les sessions d'enfant qu'il a ouvertes ;
- décocher « enfant » sur la fiche ferme la session, elle ne devient jamais une session d'adulte ;
- un adulte peut fermer à distance une session restée ouverte (iPad oublié chez les grands-parents).

La session de l'enfant ne porte **aucun compte** : les routes de compte (`/me/credentials`, `/me/totp/*`, `/me/tokens`) et l'abonnement aux notifications répondent 403. Le jeton ne vaut que dans le cookie : envoyé en en-tête `Authorization`, il est refusé. Il dure ce que dure une session (`sessionDays`), se renouvelle à mi-vie comme les autres, et survit à la fermeture de l'application, même si le parent ne s'était pas « souvenu » à la connexion.

## Les routes

| Route | Qui | Effet |
|---|---|---|
| `POST /api/auth/switch/:memberId` | session d'adulte, jamais un jeton d'accès ni la session d'un enfant | ouvre la session de cet enfant. Corps facultatif : `from` (écran d'origine), `tactile` (voir journal). 403 si la cible n'est pas un enfant, 404 si elle n'existe pas. |
| `POST /api/auth/switch/back` | session d'enfant basculée | `{ password }` du parent. Sans second facteur : session du parent rétablie, réponse `{ user, from }`. Avec : `{ totpRequired, challenge }`. |
| `POST /api/auth/switch/back/totp` | session d'enfant basculée | `{ challenge, code }` : code du téléphone ou code de secours. |
| `POST /api/auth/logout` | tous | depuis une session d'enfant : ferme la ligne du journal, retour à l'écran de connexion (pas au parent). |
| `GET /api/members/:id/switches` | adultes | les 20 dernières bascules vers cet enfant : qui, quand, appareil, fin, encore ouverte. |
| `POST /api/members/:id/switches/:sid/close` | adultes | ferme une session d'enfant à distance. |

`GET /api/me` en session basculée : `memberId` de l'enfant, `enfant: true`, `admin: false`, `email: ''`, `totp: false`, et `via` (membre du parent), `viaName`, `switchedAt`. En session ordinaire, ces trois champs valent `null`.

### Le retour et la temporisation

Le mot de passe du parent se vérifie avec la même fonction que la connexion, et **sous les mêmes compteurs** (par adresse du parent et par adresse IP, voir `auth/throttle.ts`) : les cinq premiers échecs ne coûtent rien, puis l'attente commence à 30 s et double jusqu'à 15 min. Message d'échec unique : « Mot de passe incorrect. » Un échec ne touche pas la session de l'enfant.

Conséquence voulue : un enfant qui s'acharne sur l'iPad retarde aussi une **nouvelle** connexion du parent ailleurs (les sessions déjà ouvertes du parent ne sont pas touchées). Deux compteurs séparés doubleraient le nombre d'essais permis.

Avec un second facteur, le défi remis après le mot de passe est lié à **cette** session d'enfant : il ne sert ni à une connexion ordinaire, ni à refermer une autre session d'enfant.

## Le journal

Table `auth_switches` dans `foyer.db` (donc dans les sauvegardes). Chaque bascule est journalisée (`log.info`, préfixe « Portail enfant ») avec le parent, l'enfant et l'appareil, et chaque fin aussi : `retour`, `deconnexion` ou `fermee` (à distance, avec qui l'a fermée).

L'appareil est déduit du User-Agent : iPhone, iPad, Mac, téléphone ou tablette Android, PC Windows… Safari sur iPad se présente par défaut comme un Mac : l'application envoie `tactile: true` quand l'écran est tactile, et un « Mac » tactile est noté iPad. Ce n'est qu'un libellé, il ne décide d'aucun droit.

## Les files hors ligne et le changement de session

Les coches faites sans réseau (courses, tâches, lieux) attendent dans le stockage local du navigateur. Avant ce chantier, ces files n'avaient pas de propriétaire : une coche restée en attente partait sous la session suivante de l'appareil, avec ses droits. C'était déjà vrai quand deux personnes se connectaient l'une après l'autre sur la même tablette.

Désormais :

1. **Chaque file est rangée sous le membre qui l'a remplie** (`foyer.taskQueue.<membre>`, idem `shopQueue` et `placeQueue`). Celle d'un autre membre dort sous son nom et ne repart que quand il redevient la session de l'appareil. L'ancienne file sans propriétaire est reprise une fois par le premier membre qui se présente.
2. **Le serveur vérifie** : chaque lot porte `as` (son propriétaire), et un lot d'un autre membre que la session est refusé en bloc (409). Il reste dans le navigateur ; l'application recharge, ce qui range chaque file sous son membre.
3. **La bascule et le retour envoient d'abord tout ce qui attend** (document et files), et sont refusés s'il reste quelque chose : « Des changements n'ont pas encore été envoyés. Réessayez quand l'appareil est en ligne. » Puis la page est rechargée en entier et le document gardé hors ligne effacé : rien de la session précédente ne reste en mémoire.

Le champ `by` d'une opération (qui a fait le geste) n'est pas ce contrôle : il désigne légitimement un autre membre quand on note « fait par Nolwenn » depuis le téléphone de Thomas.

## Notifications

Un navigateur n'a qu'un abonnement push, et un abonnement appartient à un membre. Le rattacher à l'enfant le retirerait au parent. Dans cette version, la session d'un enfant ne s'abonne donc pas : l'invitation « Recevoir les rappels » n'y apparaît pas, l'application ne redit pas l'abonnement du parent au serveur, et le réabonnement automatique du service worker bute sur le refus du serveur. L'abonnement du parent reste intact. Le menu de l'avatar le rappelle au parent quand cet appareil est abonné.

Conséquence : les rappels du parent continuent d'arriver sur l'appareil pendant la session de l'enfant. Sur le téléphone du parent prêté dix minutes, c'est ce qu'on veut ; sur une tablette familiale qui reste « Raphaël » toute la semaine, l'écran verrouillé montrerait les rappels du parent. **N'abonnez pas un parent sur la tablette familiale.**

## Vérifier depuis le serveur

```bash
# Les bascules du jour, dans le journal du service
journalctl -u foyer --since today | grep 'Portail enfant'

# Les sessions d'enfant encore ouvertes, dans la base (lecture seule)
sqlite3 -readonly /var/lib/foyer/foyer.db \
  "SELECT id, child_member_id, parent_member_id, device, started_at, expires_at
   FROM auth_switches WHERE ended_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now');"

# Fermer toutes les sessions d'enfant d'un coup (iPad perdu, par exemple)
sqlite3 /var/lib/foyer/foyer.db \
  "UPDATE auth_switches SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), end_reason = 'fermee' WHERE ended_at IS NULL;"
```

Les chemins sont ceux d'une installation LXC (`FOYER_DATA_DIR=/var/lib/foyer`). En Docker : `docker compose exec -T foyer sqlite3 /data/foyer.db "…"`. La fermeture vaut dès la requête suivante de l'appareil, sans redémarrer le service.
