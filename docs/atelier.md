# Atelier code

Un atelier de programmation par blocs pour les enfants : un projet est une petite histoire, des personnages sur un décor, chacun animé par des scripts faits de blocs emboîtés. Il est **construit à partir du code source ouvert de ScratchJr** (licence BSD 3 clauses), sans lien avec la Scratch Foundation ; voir [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

Les choix d'architecture et les décisions prises sont dans [`atelier-etat-des-lieux.md`](atelier-etat-des-lieux.md), la recette dans [`atelier-plan-de-test.csv`](atelier-plan-de-test.csv).

## Où en est le module

**Étape 2 sur 9 : les projets s'enregistrent, chaque enfant a les siens.**

| Fait | Pas encore |
|---|---|
| Écran « Atelier code » dans le menu, y compris celui d'un enfant ; module activable | Bibliothèque de personnages et de décors, projets d'exemple |
| Projets par membre : créer, ouvrir, renommer, dupliquer, supprimer | Hors ligne (un projet non enregistré faute de réseau le reste jusqu'au prochain essai, page ouverte) |
| Enregistrement automatique, avec refus d'écraser le travail d'un autre appareil | iPhone en lecture, message de rotation |
| Dessins gardés sur le disque, « mes personnages » retrouvés d'un projet à l'autre | Son enregistré, photo |
| Corbeille : un projet supprimé reste récupérable, puis est purgé | Vue parent (lire les projets d'un enfant, restaurer depuis l'écran), partage |
| Limites réglables : nombre de projets, espace disque | Niveau « Grands codeurs » |

Sur un écran étroit (téléphone), l'écran montre les projets sans permettre de les ouvrir : l'éditeur n'y est pas utilisable.

## Architecture

```
frontend/vendor/atelier/petits/      code tiers adapté (voir son MODIFICATIONS.md)
  src/                               le client JavaScript d'origine, modifié a minima
  src/tablet/Web.js                  le pont web, écrit pour Foyer
  www/                               page, feuilles de style, images, sons, bibliothèque de départ
frontend/scripts/build-atelier.mjs   construction et contrôles
frontend/dist/frontend/browser/atelier/petits/   le résultat, servi par le backend
```

**Une page à part, pas un écran Angular.** L'éditeur d'origine suppose qu'il possède la page entière (styles globaux, mise à l'échelle, gestion directe du tactile). Il vit donc dans sa propre page, servie par Foyer sous la même origine, et **rien de lui n'entre dans le bundle de l'application** : ouvrir Foyer ne télécharge pas un octet de l'Atelier.

**Le pont.** L'application d'origine était une page web dans une coquille native, à qui elle demandait tout : la base, les fichiers, le son, le micro, la caméra. `src/tablet/OS.js` est la façade que l'éditeur appelle ; `src/tablet/Web.js` répond à la place du natif, avec les moyens du navigateur et l'API de Foyer (`/api/atelier/*`, cookie de session).

**La bibliothèque de projets est un écran Foyer** (`frontend/src/app/screens/atelier/`), pas celui de l'application d'origine : c'est lui qui connaît les membres, la corbeille, et demain les deux niveaux.

**Pas de SQL dans le navigateur.** L'original fabriquait ses requêtes SQL côté client. Elles sont remplacées par des opérations nommées (`projectGet`, `projectSave`, `assetList`…) : c'est la liste exacte de ce que l'API devra offrir, et rien d'autre.

## Données

Tables `atl_*` dans `foyer.db`, hors du document du foyer (`backend/src/atelier/`) :

| Table | Contenu |
|---|---|
| `atl_projects` | Un projet : membre, niveau, nom, le JSON **au format de l'éditeur, non modifié**, la vignette, `version` (compteur de concurrence), `archived_at` |
| `atl_media` | Les fichiers d'un membre (dessins SVG, vignettes PNG), par nom. Les octets sont dans `pieces/`, comme toutes les pièces jointes |
| `atl_assets` | « Mes personnages » et « mes décors » |

- **Le serveur nomme les fichiers** : l'empreinte MD5 du contenu qu'il a lui-même nettoyé, plus l'extension. Le nom proposé par l'appareil est ignoré.
- **Enregistrement avec version** : l'éditeur présente la version qu'il a lue. Si un autre appareil a enregistré entre-temps, le serveur répond 409 et l'enfant choisit (« Garder celui-ci » ou « Garder l'autre »).
- **Rien n'est supprimé par un enfant** : supprimer archive. Passé `atelierCorbeilleJours` (30 par défaut), la purge quotidienne efface le projet et les fichiers que plus rien ne cite. Module éteint, la purge ne tourne pas.
- **Qui voit quoi** : un enfant ne lit et n'écrit que ses projets et ses fichiers. Un adulte lit ceux de tous, n'écrit que les siens, et lui seul restaure. Pas d'accès par jeton d'API.

### Exploitation

Espace pris par membre, à comparer au réglage `atelierQuotaMo` :

```bash
sqlite3 /var/lib/foyer/foyer.db "SELECT member_id, COUNT(*) AS fichiers, ROUND(SUM(size)/1048576.0, 1) AS mo FROM atl_media GROUP BY member_id;"
```

Projets dans la corbeille :

```bash
sqlite3 /var/lib/foyer/foyer.db "SELECT id, member_id, name, archived_at FROM atl_projects WHERE archived_at IS NOT NULL ORDER BY archived_at;"
```

Restaurer un projet supprimé, en attendant le bouton de la vue parent (remplacer l'identifiant) :

```bash
sqlite3 /var/lib/foyer/foyer.db "UPDATE atl_projects SET archived_at = NULL WHERE id = 'IDENTIFIANT';"
```

### Sauvegarde et retour en arrière

Les tables sont nouvelles : la mise à jour ne touche à aucune donnée existante. Avant de l'installer, service arrêté :

```bash
systemctl stop foyer
```

```bash
tar -C /var/lib/foyer -czf /root/foyer-avant-atelier-$(date +%F).tgz foyer.db pieces
```

```bash
systemctl start foyer
```

Pour revenir en arrière : arrêter le service, extraire l'archive dans `/var/lib/foyer`, réinstaller la version précédente, redémarrer. La sauvegarde chiffrée habituelle ([`sauvegarde-restauration.md`](sauvegarde-restauration.md)) emporte déjà tout : les tables sont dans `foyer.db`, les fichiers dans `pieces/`.

## Sécurité

- **En-têtes** : la page reçoit la CSP de Foyer, **inchangée** (`script-src 'self'`, pas d'`eval`, `connect-src 'self'`). Les deux `eval` de l'original sont supprimés.
- **Aucune donnée sortante** : statistiques d'usage et partage retirés du code, pas désactivés. Le bundle n'a aucune dépendance à l'exécution.
- **Le build échoue** si le résultat contient une adresse extérieure, un `eval`, du SQL, un reste de statistiques ou un SVG actif. Les contrôles sont dans `build-atelier.mjs`, testés par `build-atelier.test.mjs`.
- **SVG nettoyés** : un dessin reçu est reconstruit à partir d'une liste blanche (ni script, ni gestionnaire d'événement, ni lien sortant, ni `foreignObject`) et servi comme une image inerte (`nosniff`, CSP `sandbox`).
- La page de l'éditeur est statique et servie sans session, comme la coquille de l'application ; toute donnée passe par l'API, qui exige la session. Session fermée, l'éditeur renvoie à Foyer.

Vérifier sur le serveur que rien d'extérieur n'est embarqué (ne doit rien renvoyer hors notice de licence) :

```bash
grep -rIl -i -E "firebase|google-analytics|scratch\.mit\.edu" /opt/foyer/backend/public/atelier/
```

```bash
curl -sI https://<ton foyer>/atelier/petits/editor.html | grep -i -E "content-security-policy|permissions-policy"
```

## Construire

`npm run build` dans `frontend/` construit l'application puis l'Atelier. Pour l'Atelier seul, une fois l'application construite :

```bash
cd frontend && node scripts/build-atelier.mjs
```

La dernière ligne donne le nombre de fichiers et le poids. `atelier/petits/fichiers.json` en garde la liste.

Poids actuel : 244 fichiers, 6,1 Mo sur disque, dont 324 Ko de code. Ces fichiers sont **dans le dépôt git** (6,5 Mo, une fois pour toutes), ce qui alourdit d'autant un clone et une mise à jour.

## Modifier le code tiers

Règle : **adapter, pas réécrire**. Toute modification de `frontend/vendor/atelier/` porte un commentaire `Atelier:` dans le code et une ligne dans `MODIFICATIONS.md`, avec sa raison. Pas de conversion en TypeScript, pas de reformatage : un diff lisible avec l'original vaut plus qu'un code à notre goût.

## Ce que l'usage doit confirmer

Les essais ont été faits dans Chromium seulement (bureau à la souris, et tactile simulé en 1024 × 768). **Safari sur iPad et sur Mac n'a pas été essayé** : c'est le premier point à vérifier, colonnes iPad et Mac du plan de test.
