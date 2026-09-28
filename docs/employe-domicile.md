# Employé à domicile : heures et déclaration CESU

Le module suit les heures d'un **employé déclaré au CESU** (une femme de ménage
aujourd'hui, le modèle en accepte plusieurs) et prépare la **déclaration
mensuelle** sur `cesu.urssaf.fr`. L'intention tient en deux gestes : noter en un
tap qu'elle est venue, puis, en fin de mois, lire les chiffres exacts à recopier
(heures en décimal, salaire net) et marquer le mois **déclaré** puis **payé**.

Dans le code et le menu, le module s'appelle **Employé à domicile**. Le foyer
peut suivre **plusieurs employés** (un « contrat » chacun) : une femme de ménage,
un jardinier, une garde d'enfants. Un sélecteur en tête d'écran passe de l'un à
l'autre ; chacun porte sa **catégorie CESU** et son **taux** propre.

## Créer un employé

Un administrateur ajoute un employé depuis l'écran (bouton « Ajouter un
employé ») : **prénom et nom** (stockés en un seul nom), **catégorie CESU** (type
d'emploi : ménage/repassage, garde d'enfants, soutien scolaire, jardinage, petit
bricolage, préparation de repas, assistance aux personnes âgées, assistance
informatique, autre) et **taux horaire net**. Rien d'autre : pas de contrat, pas
de bulletin, la gestion se fait sur le site du CESU.

## Ce que le module fait, et ne fait pas

- **Il fait** : compter les heures, tenir le taux horaire dans le temps, donner
  les chiffres du CESU, suivre l'état d'un mois (ouvert, déclaré, payé, sans
  présence), rappeler la déclaration.
- **Il ne fait pas** : le calcul des **cotisations**, du **coût employeur** ou du
  **crédit d'impôt** (le CESU s'en charge) ; ni contrat de travail, ni bulletin
  de paie, ni gestion des congés. Il ne stocke **aucune donnée personnelle** de
  l'employé au-delà du **nom** et du **rôle** : pas de numéro de sécurité
  sociale, pas d'IBAN, pas d'adresse.

## Réservé aux adultes

Comme les Finances, le module est **adulte uniquement** : les endpoints
`/api/employes/*` passent par `requireAdulte`, la configuration (créer
l'employé, régler le taux) par `requireAdmin`. Un enfant n'a **rien** : pas
d'entrée de menu, pas de repère à l'agenda, `403` sur les endpoints, et les
outils d'assistant `menage_*` lui sont invisibles et refusés côté serveur.

## Architecture : des tables relationnelles, comme les Finances

L'essentiel du foyer vit dans un document JSON unique. Ce module en est
**l'exception**, avec les Finances : il vit dans ses propres tables
relationnelles `emp_*`, hors du document, écrites par des endpoints dédiés. On
ne recharge ni ne réécrit tout le document pour noter une présence.

| Table | Rôle |
|-------|------|
| `emp_employees` | Un employé : nom, catégorie CESU (`role`), actif ou archivé. Plusieurs coexistent. |
| `emp_rates` | L'**historique daté** du taux horaire net (une ligne par changement, avec sa date d'effet). |
| `emp_shifts` | Une **présence** = une ligne (jour, minutes, note). Retirer, c'est archiver, jamais effacer. Porte sa provenance (`created_via` / `updated_via`) quand elle vient d'un assistant. |
| `emp_months` | L'état d'un mois (ouvert, déclaré, payé, sans présence) et ses **totaux figés** à la déclaration. |

Les écritures sont **granulaires** : deux téléphones qui notent deux présences
n'entrent pas en conflit (pas besoin du journal d'opérations des courses). Le
schéma est versionné (`emp_meta`) et migré de façon additive, comme les
Finances. La sauvegarde globale (VACUUM de toute la base) couvre ces tables sans
rien à déclarer ; le module a aussi son export/restauration dédié (administrateur).

## Le taux dans le temps

Le taux n'est **pas** un réglage du foyer : chaque employé porte le sien, daté,
dans `emp_rates`. Il se pose **à la création** (première ligne datée
d'aujourd'hui) puis évolue dans *Paramètres → Employé à domicile*, **par
employé**, avec une **date d'effet** (une nouvelle ligne rejoint `emp_rates`).

Le calcul d'un mois lit **l'historique daté** : chaque présence
est valorisée au **taux en vigueur le jour où elle a eu lieu**. Si le taux change
en cours de mois, le récapitulatif montre les **sous-totaux par taux** (« 6 h à
14,50 €/h ; 5 h à 15,00 €/h »). Un mois **déjà déclaré n'est jamais recalculé** :
ses totaux sont figés à la déclaration, un taux rétroactif ne les touche pas.

## Le mois, de bout en bout

1. **Ouvert** : on note les présences au fil de l'eau. Le bouton **« Elle est
   venue aujourd'hui »** crée une présence à la durée habituelle
   (`empDureeHabituelle`, 3 h par défaut) en un tap, annulable ; la liste par
   semaine permet d'ajuster (date, durée par pas de 15 min, note) ou de retirer.
2. **À déclarer** : le bloc **« À saisir sur le CESU »** donne le **nombre
   d'heures** (en décimal) et le **salaire net**, chacun avec un bouton de copie,
   plus le détail par taux et la mention des congés. On recopie sur
   `cesu.urssaf.fr`, puis **Marquer comme déclaré** : les totaux se figent.
3. **Payé** : une fois le prélèvement CESU passé, **Marquer payé** (le total
   URSSAF réel est notable).
4. **Sans présence** : un mois où l'employé n'est pas venu se marque explicitement,
   ce qui **fait taire le rappel**.

Un mois figé (déclaré ou payé) refuse les modifications de présence, en
indiquant comment le **rouvrir**.

## Le rappel et le repère d'agenda

À partir du jour **`empRappelJour`** du mois (3 par défaut, réglable de 1 à 10),
à 9 h, Foyer envoie un **rappel push** aux adultes tant que le **mois précédent**
a des présences et reste ouvert. Une seule notification par employé et par mois.
Marquer le mois déclaré, payé ou sans présence l'éteint.

Le même mois à déclarer pose un **repère sur l'agenda partagé** (« Déclaration
CESU »), au jour de rappel du mois suivant, visible des seuls adultes. Ni le
rappel ni le repère ne codent en dur la date limite du CESU : c'est
`empRappelJour` qui la règle.

## Assistant (MCP)

Un adulte branché sur l'assistant dispose des outils `menage_*` : lire le mois et
les présences, noter/ajuster/retirer une présence, déclarer/payer/rouvrir/marquer
sans présence. Le **taux** et l'**employé** ne se règlent pas par l'assistant.
Chaque écriture est attribuée au membre (`by`) et au jeton (`via`). Voir
[`assistants.md`](assistants.md).

## Où c'est dans le code

- Backend : `backend/src/employes/` (`schema.ts`, `repo.ts`, `routes.ts`,
  `backup.ts`, `http.ts`), monté sur `/api/employes` derrière `requireAdulte`.
  Rappel : `backend/src/notify/reminders.ts` (`cesuDue`, pur) câblé dans
  `scheduler.ts` et `server.ts`.
- Frontend : `frontend/src/app/screens/employe/` (écran), `core/employes.store.ts`
  (état + repère d'agenda), `core/employes.api.ts`, `core/employe.format.ts`
  (mise en forme CESU, pure et testée). Réglage sur-mesure du taux :
  `screens/settings/employe.ts`.
