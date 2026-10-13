# Module « École » (ÉcoleDirecte) : état des lieux

Document à valider avant tout code. Sources lues le 13/10/2026 :
`hacf-fr/hass-ecoledirecte` (`main` @ `15d50f8`, épingle `ecoledirecte==0.3.2`),
bibliothèque `hacf-fr/ecoledirecte_api` 0.3.2 et 0.4.0 (`client.py`, `const.py`),
`EduWireApps/ecoledirecte-api-docs` (@ `39e3a15`). Le brief cite `briefs/colis.md` :
**ce fichier n'existe pas dans le dépôt** (ni module Colis). Je reprends ses principes
tels que le brief les décrit (santé, trois états, fixtures).

## 1. Flux d'authentification (corrigé d'après le code)

Toutes les requêtes sont des `POST` avec `?verbe=…&v=<version>` et un corps
`application/x-www-form-urlencoded` de la forme brute `data=<JSON>`, sauf la première.

1. `GET /v3/login.awp?v=<ver>&gtk=1` : lire le cookie `GTK`, le renvoyer en en-tête `x-gtk`
   (et en cookie) sur le login. Exigé depuis mars 2025, sinon « mot de passe incorrect ».
2. `POST /v3/login.awp?v=<ver>`. **Sans appareil connu** : `{"identifiant","motdepasse","isReLogin":false}`,
   **sans** `uuid` ni `fa`. **Avec appareil connu** : le même plus `"cn","cv"` **au premier niveau et**
   dans `"fa":[{"cn","cv"}]`, et `"uuid":""`. Identifiant et mot de passe sont **percent-encodés à
   l'intérieur** du JSON (détail que ta lecture n'avait pas).
3. Jeton : en-tête de réponse **`x-token`**, renvoyé en en-tête `x-token`. Il **change** à chaque
   appel de double authentification. **Nouveau depuis août 2026** : un en-tête `2FA-Token`, à renvoyer
   tel quel s'il est présent.
4. Code 250 : garder le jeton du 250, `POST /v3/connexion/doubleauth.awp?verbe=get` (corps `data={}`)
   renvoie `question` et `propositions[]` en base64 ; `?verbe=post` avec
   `data={"choix":"<base64 du texte choisi>"}` renvoie `cn`, `cv`. Puis on refait 1 et 2 avec `fa`.
5. Comptes famille avec plusieurs établissements : `POST /v3/renewtoken.awp?verbe=post` avec
   `{"idUser":<idLogin>,"uuid":""}` pour passer d'un enfant rattaché à un autre `idLogin`.

Codes : 200 OK ; **210** pas de données (vacances, pas une erreur) ; 250 QCM ; 505 identifiants ;
517 version refusée ; 520 jeton invalide ; **525** jeton expiré ; **535** établissement indisponible
(transitoire) ; tout autre code ou corps non JSON = erreur, code brut conservé.
En-têtes : `User-Agent` de navigateur, `Origin: https://www.ecoledirecte.com`,
`Referer: https://www.ecoledirecte.com/`, `Accept-Language: fr-FR`. Le jeton est lié au
User-Agent : on n'en change jamais en cours de session.

**Ce que Foyer fait différemment de HA**, qui retente la connexion à chaque rafraîchissement tant
qu'un QCM est en attente (le comportement qui fait bloquer les comptes) : au premier 250, Foyer
récupère la question **une fois**, la stocke (`pending_qcm`), met le compte en état « question à
répondre » et **n'émet plus aucune requête** pour ce compte jusqu'à la réponse de l'administrateur.
Le jeton du 250 n'est gardé qu'en mémoire ; si la réponse arrive après son expiration, Foyer refait
une connexion, et si la question a changé, il affiche la nouvelle au lieu de répondre à l'aveugle.
Une connexion neuve par cycle et par compte (avec l'appareil de confiance, comme l'application
officielle à chaque ouverture), jamais plus ; le jeton n'est gardé qu'en mémoire, le temps du cycle.

## 2. Version d'API, URL, en-têtes, secrets

- La version actuelle est **4.102.0** (pas 4.101.4 : elle a bougé six fois en un an). Réglages de
  déploiement en lecture seule dans Paramètres : `FOYER_ED_API_BASE` (défaut
  `https://api.ecoledirecte.com`), `FOYER_ED_API_VERSION` (défaut `4.102.0`), `FOYER_ED_USER_AGENT`.
  Défauts dans le registre, rien dans le client. 517 : « ÉcoleDirecte refuse la version d'API 4.102.0 (517) ».
- **Le type `secret` du registre ne convient pas** : il ne vit que dans une variable d'environnement,
  ne s'écrit jamais depuis l'interface. Aucun chiffrement symétrique n'existe aujourd'hui (les jetons
  d'API sont hachés, irréversibles). Je retiens **AES-256-GCM** avec une clé dédiée
  **`FOYER_SECRET_KEY`** (32 octets, `openssl rand -base64 32`), **pas** dérivée de `FOYER_JWT_SECRET` :
  faire tourner le secret JWT après un incident ne doit pas détruire les identifiants. En LXC, le
  script de mise à jour la génère dans `/etc/foyer/foyer.env` si elle manque ; en Docker, une ligne à
  ajouter (documentée). Chaque valeur chiffrée porte l'empreinte de la clé : **clé absente** = la
  section École dit « clé de chiffrement absente » et refuse d'enregistrer ; **clé changée** ou base
  restaurée ailleurs = « identifiants à ressaisir », le compte se met en pause, rien ne plante.
  Conséquence à accepter : `cn`/`cv` sont perdus aussi, **le QCM reviendra** après ressaisie.

## 3. Points d'entrée

| Version | Point d'entrée | Champs utiles | À nettoyer |
|---|---|---|---|
| P1 | `/Eleves/{id}/cahierdetexte.awp?verbe=get` | par date : `idDevoir`, `matiere`, `donneLe`, `effectue`, `interrogation` | |
| P1 | `/Eleves/{id}/cahierdetexte/{AAAA-MM-JJ}.awp?verbe=get` | `matieres[]` : `nomProf`, `aFaire.contenu`, `aFaire.documents[]` | `contenu` = HTML en base64 : décodé, nettoyé, liens gardés |
| P1 | `/Eleves/{id}/cahierdetexte.awp?verbe=put` | `{"idDevoirsEffectues":[id],"idDevoirsNonEffectues":[]}` (ou l'inverse) | |
| P1 | `/E/{id}/emploidutemps.awp?verbe=get` (`dateDebut`, `dateFin`, `avecTrous:false`) | `start_date`/`end_date` (« AAAA-MM-JJ HH:MM », heure de Paris), `matiere`, `prof`, `salle`, `typeCours`, `isAnnule`, `isModifie` | |
| P2 | `/eleves/{id}/notes.awp?verbe=get` (`anneeScolaire`) | `notes[]` : `valeur` (texte, « 14,5 », « Abs »), `noteSur`, `coef`, `moyenneClasse`, `minClasse`, `maxClasse`, `nonSignificatif`, `libelleMatiere`, `devoir`, `date` ; `periodes[].ensembleMatieres.disciplines[].moyenne` | virgules décimales ; `noteSur:"0"` = évaluation par compétences |
| P2 | `/eleves/{id}/viescolaire.awp?verbe=get` | `absencesRetards[]`, `sanctionsEncouragements[]` : `typeElement`, `date`, `displayDate`, `libelle`, `motif`, `justifie` | |
| P3 | messagerie `/familles\|eleves/{id}/messages.awp`, formulaires `/edforms.awp?verbe=list`, cantine `/comptes/sansdetails.awp` (`comptes[].solde`), espaces de travail, menus | | messages en HTML base64 |
| Jamais | vie de la classe | la doc communautaire la décrit vide | |

Coût par cycle et par élève : 1 liste + le détail des jours qui ont changé (nouveau `idDevoir`, ou
demain et après-demain à chaque cycle, les autres jours toutes les 6 h) + 1 emploi du temps. Effet
visible : une modification d'énoncé pour dans dix jours peut mettre jusqu'à 6 h à apparaître.

## 4. Ce que je reprends, et deux écarts avec le brief

Repris tel quel : runner `storage/migrate.ts` (table `ed_meta`), `employes/http.ts`, structure
schema/repo/routes/backup, gardes `requireAdmin`/`requireMember`/`requireAdulte`, `log.info`/`log.attention`,
`applyTaskOps`, `notify()` et son journal anti-doublon `hh_notif_sent`, `setExternalDayExtras('ecole', …)`,
`McpCtx` et `adultes`, filtrage MCP par préfixe `ecole_`. La sauvegarde globale (`VACUUM INTO`) emporte
les tables `ed_` d'office ; export/restauration de module JSON comme Employés.

- **`ecoleActif` devient `modEcole`**, le drapeau du mécanisme de modules existant (masque partout,
  403, MCP retiré, données gardées, remise à zéro), mais **désactivé par défaut**, ce qui demande
  d'adapter `modules.ts` (tous les autres sont activés par défaut). Un seul interrupteur au lieu de deux.
- **Il n'y a pas de registre de tuiles d'accueil.** L'accueil est codé en dur (`home.ts`). J'ajoute
  École comme Finances et Repas y sont déjà ; un vrai registre serait une PR à part.
- Pause : `ecolePauseDebut`/`ecolePauseFin` (22:00 / 06:00) plus un troisième réglage
  `ecoleDimancheDebut` (16:00), sinon la règle du dimanche serait en dur.
- Le planificateur tourne chaque minute et sans état : la synchronisation y est une boucle à part,
  avec verrou (jamais deux cycles en même temps, un compte après l'autre).

**Emploi du temps : faisable sans réécrire.** Tous les consommateurs (vue semaine, `presence.ts`,
couverts) reçoivent un tableau de créneaux ; j'y ajoute des créneaux importés en lecture seule
(`id` préfixé `ed:`, ponctuels, étiquetés « ÉcoleDirecte », annulés barrés), sans jamais toucher au
document. Une limite de `presence.ts` : il ne connaît que des créneaux « absent » qui couvrent l'heure
du repas. Je dérive donc par jour une plage « à l'école » du premier au dernier cours non annulé, et
il faut savoir si l'enfant mange à la cantine : **une case « demi-pensionnaire » par élève** (défaut
oui ; non = matin et après-midi séparés, midi à la maison). Les créneaux manuels (car) coexistent.

## 5. Devoirs en tâches : ce que le module Tâches permet vraiment

- `TaskList.kind` existe : j'ajoute `'devoirs'`. Mais **les listes s'écrivent par `PUT /state`**, pas
  par opérations : le serveur crée la liste lui-même, et `PUT /state` refuse de supprimer ou renommer
  une liste `devoirs` (comme les sous-arbres figés). L'interface masque « + », renommer, supprimer.
- Provenance : `TaskItem` a déjà `contractId` (lien vers un contrat Finances). J'ajoute de même
  **`edId`**. L'énoncé complet en texte va dans **`note`**, qui existe ; l'énoncé mis en forme et les
  pièces jointes restent dans l'écran École.
- **`TaskItem` n'a pas d'archivage**, et l'opération `remove` efface sans trace. Donc : une tâche
  supprimée par l'utilisateur ne revient jamais (`ed_homework.task_id` pointe dans le vide, la
  synchronisation le note et ne recrée pas). Pour éviter des devoirs en retard pour toujours, je
  propose que **la synchronisation retire la tâche projetée 7 jours après la date de rendu** ;
  `ed_homework` garde tout (historique dans l'écran École). C'est contraire à ta règle « pas de
  suppression par la synchronisation » : la seule autre voie est d'ajouter un archivage aux tâches,
  qui touche toutes les vues du module. **À trancher.**
- `done` : un crochet sur `done`/`reopen` dans `applyTaskOps` pose `done_local` et un drapeau
  « à transmettre ». À chaque cycle : d'abord envoyer les changements locaux, ensuite lire. ÉcoleDirecte
  ne fait que cocher (faux → vrai, opération `done` attribuée « via ÉcoleDirecte »), et seulement s'il
  n'y a rien en attente pour ce devoir : pas de boucle, pas de décochage silencieux. Un décochage
  volontaire dans Foyer est transmis (`idDevoirsNonEffectues`). Échec d'envoi : coché, « non transmis ».
- Devoir modifié : titre, échéance et `note` mis à jour par `edit`, `done` intact, « modifié le … ».
- **Visibilité :** les tâches vivent dans le document, que tout membre connecté reçoit en entier. Le
  403 entre frères vaut pour `/api/ecole/*` (énoncés mis en forme, emploi du temps, notes, vie
  scolaire) ; **les titres de devoirs projetés en tâches restent lisibles par le frère**, comme toute
  tâche partagée. Je juge ça acceptable (notes et absences ne sont jamais projetées) ; sinon il faut
  renoncer à la projection.

## 6. Tests

Client à `fetch` injectable, testé avec `node:test` sur des fixtures JSON dans
`backend/test/fixtures/ecole/` : connexion, GTK, 250 puis QCM, 505, 517, 520/525, 210, 535, `2FA-Token`,
synchronisation (upsert, archivage, projection, `done` dans les deux sens, première synchronisation
muette). Aucun réseau en CI. **Les premières fixtures seront construites d'après le code de référence**,
pas captées sur vos comptes : `npm run ecole:sonde -- --compte <id> [--fixtures]` fait une vraie
connexion, affiche codes et structures, et avec `--fixtures` écrit des réponses anonymisées
(noms, identifiants, jetons, `cn`/`cv` remplacés) à relire avant commit.

## Décisions attendues

1. Clé dédiée `FOYER_SECRET_KEY` (et QCM à refaire si elle est perdue).
2. `modEcole` désactivé par défaut à la place de `ecoleActif`.
3. Retrait des tâches de devoirs 7 jours après la date de rendu, ou archivage des tâches (plus lourd).
4. Titres de devoirs visibles entre frères via les Tâches.
5. Case « demi-pensionnaire » par élève pour la présence du midi.
