# Module Finances, architecture et décisions

Pourquoi le module Finances ne ressemble pas au reste de Foyer, et ce qu'il faut savoir
avant d'y toucher. Le cahier de recette de l'import vit à côté, dans
[`finances-cahier-de-recette.md`](finances-cahier-de-recette.md).

## 1. Deux modèles de persistance, volontairement

| | Reste du foyer | Module Finances |
|---|---|---|
| Stockage | un document JSON dans `household.state` | tables `fin_*` dans le même fichier SQLite |
| API | `GET/PUT /api/state` | `/api/finances/*`, opérations granulaires |
| Écriture | tout le document renvoyé, 700 ms après la frappe | un `INSERT` ou un `UPDATE` ciblé |
| Front | `foyer.store.ts` | `finances.store.ts` |

Le document JSON convient parfaitement aux modules légers (courses, menus, tâches, agenda) :
peu de données, écriture rare, pas d'agrégat. Il ne convient pas aux finances :

- **Volume** : environ 1 200 opérations par an, 6 000 à cinq ans, rechargées et resérialisées
  à chaque écriture de n'importe quel module.
- **Pièces jointes** : `express.json({ limit: '15mb' })` s'applique au document entier. Des
  factures stockées en data-URL dedans finissent par faire échouer **toutes** les sauvegardes,
  de tous les modules, en HTTP 413.
- **Concurrence** : un `PUT` de l'état complet est du dernier arrivé gagne. Deux utilisateurs
  simultanés, l'un perd son travail.
- **Requêtes** : aucun filtre, aucun agrégat, aucun index côté serveur.

Les deux modèles cohabitent. Ce n'est pas une étape intermédiaire vers une migration complète :
c'est le bon outil pour chaque type de données.

## 2. Décisions structurantes

**Les montants sont des entiers, en centimes.** Jamais de nombre à virgule flottante. Sur
plusieurs milliers d'additions, les flottants dérivent (0,1 + 0,2 = 0,30000000000000004). La
conversion se fait une seule fois, à la frontière (saisie ou fichier importé), via
`parseCents()`. L'affichage repasse en euros au dernier moment.

**Les migrations sont versionnées, jamais modifiées après coup.** `fin_meta.schema_version`
porte le numéro appliqué. Au démarrage, `migrateFinances()` applique les migrations manquantes,
chacune dans sa propre transaction. Une migration qui échoue laisse la base sur la version
précédente et écrit un message explicite dans le journal. **Ne modifiez jamais une migration
déjà publiée** : ajoutez-en une nouvelle, sinon les installations existantes divergent.

**Les clés étrangères sont actives** (`PRAGMA foreign_keys = ON`). Supprimer une catégorie
détache ses opérations (`SET NULL`) au lieu de les perdre ; supprimer une catégorie parente
emporte ses sous-catégories (`CASCADE`) mais jamais les opérations.

**Un compte qui porte des opérations ne peut pas être supprimé.** L'API répond 409 avec un
message qui explique quoi faire (archiver). Archiver conserve tout l'historique et sort le
compte des alertes de mois incomplet.

**Les références aux membres sont molles.** `fin_accounts.member_id` pointe vers un
`state.members[].id`, sans contrainte SQL : les deux mondes ne peuvent pas se contraindre l'un
l'autre. Retirer un membre du foyer laisse le compte en place, simplement sans titulaire.

**Les virements internes sortent des recettes et des dépenses**, mais leurs deux lignes restent
en base : les soldes de compte doivent rester justes. Un virement porte `kind = 'virement'` et,
une fois apparié, un `transfer_group` commun aux deux lignes.

**L'empreinte de déduplication est figée à l'écriture.** `dedupe_key` est calculée sur le
libellé **brut** et stockée en dur. Renommer ou recatégoriser une opération ne la change pas,
donc un réimport ultérieur ne la ressuscite pas en double. Les saisies manuelles reçoivent une
empreinte aléatoire (`m:<uuid>`) : elles ne sont jamais dédoublonnées.

## 3. Mois incomplets

Un mois est signalé incomplet dès qu'un compte **actif** n'a aucune opération à partir du
premier jour de ce mois. Le bandeau nomme le compte et la date de sa dernière opération connue.

C'est le mode de panne le plus vicieux du module : sans ce signal, un mois auquel il manque un
compte affiche des chiffres **plausibles** et faux. Le seul moyen d'éteindre l'alerte est
d'archiver le compte, c'est-à-dire de prendre une décision explicite.

**Limite connue de la tranche 1** : l'heuristique regarde la dernière opération, pas la période
réellement couverte par les imports. Un livret qui ne bouge que deux fois par an sera donc
signalé, ce qui est correct dans le cas d'usage visé (les livrets du foyer s'arrêtent
effectivement au 31/12) mais reste une approximation. La tranche 2 enregistrera la fenêtre de
dates couverte par chaque import et remplacera l'heuristique par une réponse exacte.

## 4. Découpage du code

```
backend/src/finances/
  schema.ts    migrations versionnées, appliquées au démarrage par db.ts
  money.ts     centimes, dates, normalisation de libellé (aucune dépendance)
  repo.ts      accès SQLite : requêtes préparées, agrégats, export CSV
  routes.ts    /api/finances, validation et messages d'erreur en français
  types.ts     formes échangées avec le frontend
backend/test/  tests node:test (aucune dépendance ajoutée)

frontend/src/app/core/finances.api.ts     client HTTP
frontend/src/app/core/finances.store.ts   état, adossé au serveur
frontend/src/app/screens/finances/        un fichier par onglet
```

Deux entorses assumées aux conventions du dépôt, justifiées par la taille du module :
`screens/finances/` est un dossier alors que les autres écrans sont un fichier, et l'état d'UI
des Finances vit dans `FinancesUi` plutôt que dans le `UiState` commun (qui aurait gagné
soixante champs).

## 5. Pas de dépendance circulaire entre les stores

`FinancesStore` dépend de `FoyerStore` (membres, couleurs, toasts, fuseau). L'inverse est
interdit. Deux conséquences visibles dans le code :

- les alertes de budget dépassé et de mois incomplet sont **calculées** par `FinancesStore` et
  poussées dans `FoyerStore.externalNotifs`, que le panneau de notifications fusionne ;
- la recherche globale des opérations passe par `FinancesStore.search()` (appel serveur,
  antirebond de 220 ms), et la palette de recherche fusionne les deux listes de résultats.

## 6. Sauvegarde et restauration

Le fichier SQLite est en mode WAL : **copier `foyer.db` seul pendant que le service tourne
donne une sauvegarde corrompue.** Deux méthodes sûres.

### LXC natif

```bash
systemctl stop foyer
tar czf /root/foyer-$(date +%F-%H%M).tar.gz -C /var/lib/foyer .
systemctl start foyer
```

Restauration :

```bash
systemctl stop foyer
rm -rf /var/lib/foyer/*
tar xzf /root/foyer-2026-08-17-1430.tar.gz -C /var/lib/foyer
chown -R foyer:foyer /var/lib/foyer
systemctl start foyer
journalctl -u foyer -n 50 --no-pager
```

### Docker, sans arrêt de service

`VACUUM INTO` écrit un instantané cohérent pendant que la base est utilisée.

```bash
STAMP=$(date +%F-%H%M)
docker compose exec -T foyer node -e "
const db = require('better-sqlite3')('/data/foyer.db');
db.exec(\"VACUUM INTO '/data/foyer-$STAMP.db'\"); db.close();"
docker compose cp foyer:/data/foyer-$STAMP.db ./foyer-$STAMP.db
```

Restauration :

```bash
docker compose stop foyer
docker compose cp ./foyer-2026-08-17-1430.db foyer:/data/foyer.db
docker compose exec -T foyer sh -c 'rm -f /data/foyer.db-wal /data/foyer.db-shm'
docker compose start foyer
docker compose logs -f foyer
```

Supprimer les fichiers `-wal` et `-shm` est indispensable : laissés en place, ils réappliquent
des écritures qui ne correspondent plus à la base restaurée.

### Vérifier une sauvegarde

```bash
sqlite3 foyer-2026-08-17-1430.db "PRAGMA integrity_check;"
sqlite3 foyer-2026-08-17-1430.db "SELECT value FROM fin_meta WHERE key='schema_version';"
sqlite3 foyer-2026-08-17-1430.db "SELECT COUNT(*) FROM fin_transactions;"
```

### Export de secours, sans outil

Le bouton « Exporter en CSV » de l'écran Finances rend toutes les opérations, séparateur
point-virgule, UTF-8 avec BOM (Excel FR et LibreOffice l'ouvrent sans boîte de dialogue).
En ligne de commande :

```bash
TOKEN=$(curl -s -X POST http://localhost:8099/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"vous@example.com","password":"…"}' | jq -r .token)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8099/api/finances/export.csv -o finances.csv
```

## 7. Tests

```bash
cd backend
npm test        # tests node:test (import, agrégats, migrations)
npm run typecheck   # tsc --noUnusedLocals --noUnusedParameters sur src/ et test/
```

Le lanceur est celui intégré à Node 22, exécuté via `tsx` (déjà présent) : aucune dépendance
ajoutée. La CI exécute les deux à chaque push et à chaque pull request.
