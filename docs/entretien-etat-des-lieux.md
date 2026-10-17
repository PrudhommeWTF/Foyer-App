# Entretien : état des lieux (à valider)

Lu sur `main` (e789ef5, 17/10/2026). Aucun code écrit tant que ce document n'est pas validé.

## 0. Trois écarts avec le brief, à lire d'abord

1. **Les briefs cités n'existent pas dans le dépôt**, ni sur aucune branche (`briefs/ecoledirecte.md`, `briefs/equipements.md`, `briefs/courses-liste-simple.md`). Le **module Équipements n'est pas livré** : aucune table `eqp_`. Je me suis appuyé sur le code (projection des devoirs : `edId`, opérations `trusted`, `docs/ecole.md` ; `courses_ajouter` : `mcp/tools.ts`). Conséquence : Entretien est le premier des deux, il **crée le socle des pièces** (§2). Tout ce qui touche un équipement (`equipmentId`, tri par équipement, gestes sur la fiche d'un appareil, archivage proposé au remplacement) **part dans le brief Équipements** : livré maintenant, ce serait un champ sans consommateur, ce que `CLAUDE.md` interdit.
2. **Le moteur de récurrence n'existe que dans le navigateur.** Le serveur reçoit la date suivante avec la coche, il ne la calcule pas ; c'est pourquoi l'outil MCP `tache_terminer` refuse aujourd'hui toute tâche récurrente. Sans changement, « j'ai testé l'alarme ce matin » depuis Claude est impossible. Proposition : le dispositif déjà en place pour le registre des réglages. `recurrence.ts` devient autonome (aucun import) et existe en **deux copies identiques octet pour octet**, frontend et backend, **un test CI échoue à la moindre différence**. Un seul moteur, pas de second calcul. L'alternative est de renoncer à `entretien_fait`.
3. **Les tâches ne passent pas par `state/validate.ts`** : `PUT /api/state` ignore le champ `tasks`, qui ne s'écrit que par opérations. Les champs d'entretien se valident donc dans `tasks/ops.ts` (`readFields`), avec son miroir client `core/task-ops.ts`. `validate.ts` ne reçoit que la nouvelle collection `rooms`.

## 1. La voie Tâches tient, sans champ forcé

| Besoin | Existant | À faire |
|---|---|---|
| Récurrence depuis la réalisation, date fixe, tolérance | `TaskRec` `base: 'done' / 'due'`, `grace` | rien |
| Qui, quand, historique | `history: TaskDone[]` | rien |
| Hors ligne, rejeu, journal | `hh_task_ops`, `opId` | rien |
| Téléphone périmé qui coche la même occurrence | refus si `occ` n'est plus l'échéance courante | rien |
| Deux téléphones **à jour** le même jour | rien : la 2e coche ferait une 2e réalisation | règle « même jour » (§3) |
| Jamais noté | `due: null` passe déjà, mais le rappel est **effacé** faute de date, et l'**annulation de la 1re réalisation ne marche pas** (`reopen` exige une échéance) | deux corrections ciblées, testées |
| Stock, pièce, détail, pause | rien | un objet optionnel `maintenance` |

Une table `ent_` ferait perdre : rappels, coche depuis Tâches, rejeu hors ligne, `taches_*` côté assistant, historique. Je **recommande la voie Tâches**.

## 2. Modèle de données

- `TaskList.kind` accepte `'entretien'`. **Une seule liste, partagée**, créée par migration (foyers existants) et à l'onboarding, non supprimable, type non modifiable. Le serveur la rétablit si un `PUT /state` l'omet : sans cela, la réconciliation actuelle supprimerait ses tâches avec elle.
- Sur `TaskItem`, lu seulement par Entretien :

```
maintenance?: {
  roomId?: string;        // pièce du socle Maison
  howto?: string;         // le détail du geste, 2000 car. max
  stock?: { qty: number; unit: string; use: number; threshold: number; article: string; countedAt: string; alerted?: boolean };
  pausedUntil?: string;   // AAAA-MM-JJ
  catalogId?: string;     // provenance catalogue (« déjà dans vos gestes » dans le choix)
}
```

Écarts au brief : **pas de `place` libre** (« Jardin », « Grenier » se créent comme pièces en un geste : deux façons de dire où, ce sont deux regroupements qui ne se recoupent pas) ; **`use`** ajouté (un test des détecteurs consomme 4 piles, pas 1) ; **`alerted`** pour n'alerter qu'une fois par passage sous le seuil ; `equipmentId` reporté (§0).

- **Socle Maison** : `rooms: { id, name, icon, position }[]` dans le **document**, hors de tout module (toujours présent). Petit, rarement modifié, référencé par des tâches qui vivent dans le document ; Équipements (tables) y pointera par identifiant comme Finances le fait déjà avec `contractId`. Écrit par `PUT /state` (comme les listes), borné à 200 dans `validate.ts`. Pièce supprimée : ses gestes passent « Sans pièce ». En attendant Équipements, l'éditeur des pièces vit dans Entretien.

## 3. « Fait aujourd'hui » = la coche existante

Pas de nouvelle opération pour la réalisation : c'est l'opération `done` actuelle, enrichie côté serveur quand la tâche est dans la liste `entretien`. **Cocher dans Tâches, « Fait aujourd'hui » et l'assistant passent par le même chemin**, dans la même transaction :

- **Même jour, une seule fois** : si la dernière réalisation tombe le même jour (heure de Paris), la coche est acquittée sans effet (ni 2e ligne, ni 2e décrément). Réservé aux gestes d'entretien : une tâche ordinaire garde son comportement.
- **Stock** : `qty -= use` (plancher 0), `countedAt` = ce jour ; la ligne d'historique retient ce qui a été consommé, pour que l'annulation le rende.
- **Seuil franchi** : `alerted` passe à vrai ; avec `entretienCoursesAuto`, l'article part dans la liste principale par la fonction de `courses_ajouter`, extraite dans `shopping/` (sans doublon ; rayon : celui où le foyer a déjà rangé ce nom, sinon le rayon de type « entretien », sinon le repli). « J'en ai racheté » qui repasse au-dessus du seuil remet `alerted` à faux.
- **Fait un autre jour** : même opération, avec la date et le membre choisis, ou personne (« par le foyer »).
- **Annuler** (quelques secondes) : l'opération `reopen` existante, corrigée pour la 1re réalisation ; le stock revient. Un article déjà parti aux courses y **reste** (rien ne se décoche tout seul).

Une seule opération nouvelle, **`stock`**, qui dit une intention et non une valeur : « +6 » (racheté) ou « j'en compte 4 », avec la date. Écrire une quantité absolue écraserait le décrément fait au même moment par l'autre téléphone. Pause : `pausedUntil` et l'échéance posée à cette date (le geste revient seul, le rappel part ce jour-là). Archiver : l'opération `skip` existante qui termine la série sans réalisation, historique gardé.

## 4. « Pas encore noté »

**`due` vide**, comme tu le préfères. Une date inventée (création plus la période) s'afficherait comme une vraie échéance, puis deviendrait « en retard » sans que personne sache quand le geste a été fait. Donc : aucun rappel, jamais compté en retard, rien sur l'accueil. Le réglage de rappel (« le matin ») est **conservé** et s'active à la 1re réalisation. La création propose « Dernière fois : je ne sais pas / le … » : une date donnée devient une vraie réalisation et lance la série. Une date fixe (chaudière chaque octobre, `base: 'due'`) exige une date de départ, demandée à la création.

## 5. Catalogue contre `TaskTemplate`

`TaskTemplate` ne porte que des intitulés (`items: string[]`) pour fabriquer une liste : ni fréquence, ni stock, ni pièce, et il vit dans le document. **Il ne suffit pas.** Catalogue à part :

- `backend/config/entretien-catalogue.json` livré (une trentaine de gestes, plus les pièces proposées au premier usage) ; surcharge `$FOYER_DATA_DIR/entretien-catalogue.json` **fusionnée par `id`** (remplacer, ajouter, `"retire": true` pour masquer). Fichier illisible : message au journal, catalogue livré, l'application continue.
- Entrée : `{ id, titre, howto, famille, piece, rec: { freq, every, base, grace? }, article?: { nom, unite, use, seuil } }`. `famille` (Cuisine, Eau, Chauffage, Sécurité, Piscine, Extérieur, Linge) range la liste de choix.
- `GET /api/entretien/catalogue`. Un geste choisi est une **copie** modifiable, jamais un lien.
- Docker : le dossier `config/` entre dans l'image ; LXC : `install.sh` et `self-update.sh` le copient. Testé dans les deux.

## 6. Ce qui se voit, à trancher

| # | Question | Recommandation |
|---|---|---|
| a | Les gestes comptent-ils dans « Aujourd'hui » et la tuile Tâches ? Aujourd'hui seules les listes `taches` et `devoirs` y comptent, pas les corvées. | **Comme les corvées** : onglet propre dans Tâches, rappels actifs, et l'accueil les montre par la tuile Entretien. Sinon un geste en retard s'affiche deux fois sur l'accueil. |
| b | « Cette semaine » avec un horizon de 14 jours, c'est faux. | Groupe « **Dans les 14 jours** » (suit le réglage) ; accueil « Entretien : 1 en retard, 2 dans les 14 jours ». |
| c | Masquer la liste dans Tâches, module éteint ? | **Oui, c'est simple** (un filtre sur les listes visibles). Je coupe aussi les rappels des gestes : une notification vers un écran absent surprendrait. |
| d | Remise à zéro à la réactivation | Supprime les gestes et leur historique, **garde les pièces** (socle commun). |
| e | Section « Maison » du menu : elle n'existe pas (« Organisation », « Le foyer »). | Entretien dans « **Le foyer** », à côté de Lieux. Pas de section pour un seul écran. |
| f | Une fois le moteur côté serveur, `tache_terminer` pourrait solder les tâches récurrentes ordinaires. | Hors sujet ici : PR séparée si tu la veux. |

Vocabulaire : l'écran dit « pièce », jamais « lieu » (« Lieux » est déjà le module des lieux de vacances).

## 7. Découpage

- **PR 1** (serveur et socle, rien de visible hors réglages) : drapeau `modEntretien`, `kind: 'entretien'`, `rooms`, champs `maintenance`, moteur partagé et son test d'identité, règle du même jour, stock, corrections « jamais noté », opération `stock`, catalogue et surcharge, réglages, migration, tests `tasks-ops` des deux côtés.
- **PR 2** : écran Entretien, création depuis le catalogue, pause, historique, affichage dans Tâches, captures iPhone headless.
- **PR 3** : courses (bouton et automatique), tuile d'accueil, outils MCP `entretien_*`, docs (`entretien.md`, `assistants.md`, `taches.md`), `README`, `CLAUDE.md`.

## 8. Sauvegarde avant la PR 1

**Aucune table nouvelle.** Une seule migration du document, additive et rejouable : elle crée la liste Entretien si elle manque et `rooms: []`. Comme pour toute migration du document, le serveur dépose une copie d'avant migration dans `backups/` (voir `docs/sauvegarde-restauration.md`). Avant de mettre à jour, un instantané à la main, sans arrêter le service :

```bash
# LXC
sqlite3 /var/lib/foyer/foyer.db "VACUUM INTO '/root/foyer-avant-entretien.db'"
sqlite3 /root/foyer-avant-entretien.db "PRAGMA integrity_check;"   # attendu : ok

# Docker (le nom du volume dépend du projet compose : docker volume ls | grep foyer-data)
docker run --rm -v foyer_foyer-data:/data -v /root:/out alpine \
  sh -c "apk add -q sqlite && sqlite3 /data/foyer.db \"VACUUM INTO '/out/foyer-avant-entretien.db'\""
```

Retour arrière : une version antérieure ne connaît pas le type `entretien` ; on ne redescend pas de version sans restaurer cet instantané (`docs/sauvegarde-restauration.md`, §6).
