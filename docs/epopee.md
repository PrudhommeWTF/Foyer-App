# Épopée

Les écus que les enfants gagnent par leurs efforts : une besace par enfant, des routines pas à pas, des récompenses choisies avec les parents. Le module s'inspire des programmes d'entraînement aux habiletés parentales (renforcement positif immédiat, économie de jetons), en particulier des travaux de Russell Barkley. Foyer n'est pas un dispositif médical : il ne pose ni ne stocke aucun diagnostic, et ses réglages portent des noms d'usage (« une consigne à la fois », « sablier »), pas des noms cliniques.

## Où en est le module

**Étape 1 sur 6 : le socle.** Une besace par enfant, les bravos des parents, le journal.

| Fait | Pas encore |
|---|---|
| Enrôler un enfant : sa besace commence avec 5 écus d'amorce | Les routines du matin et du soir, pas à pas, avec sablier et pause « grain de sable » |
| Bravo spontané d'un parent : 1 à 3 écus, avec quelques mots | Le crédit express d'exploits convenus, les demandes de l'enfant |
| Journal de chaque besace, annulation d'un bravo | L'Armurerie : récompenses, quêtes, pacte, souvenirs |
| L'enfant voit sa besace et ce qu'il a gagné | Le parcours d'alliance et le parchemin à imprimer |
| | Le bilan de la semaine pour le conseil de famille |

Hors du plan pour l'instant : le retrait d'écus (« coût de la réponse »), les outils d'assistant, le gain d'écus par une tâche cochée.

## Les règles

Elles sont dans `backend/src/epopee/rules.ts`, pures et testées. Le serveur les applique avant chaque écriture ; l'appareil ne décide d'aucun montant.

- **La besace ne commence jamais vide.** L'enrôlement verse 5 écus d'amorce, une seule fois. Ils forment le **plancher** de la besace : ils ne se reprennent pas.
- **Rien ne s'efface.** Le solde est la somme d'un grand livre en ajout seul. Annuler un bravo, c'est écrire sa contre-écriture ; les deux lignes restent.
- **Une écriture ne s'annule qu'une fois**, une annulation ne s'annule pas, et reprendre des écus ne fait jamais passer la besace sous son plancher (quand l'Armurerie existera : un bravo déjà dépensé ne se reprend plus).
- **Un bravo vaut 1, 2 ou 3 écus.** Le geste porte un identifiant donné par l'appareil : reçu deux fois, il ne compte qu'une fois.
- **Retirer un enfant** de l'Épopée ne supprime rien : réenrôlé, il retrouve sa besace telle quelle, sans seconde amorce.

Décision à venir avec l'Armurerie, déjà arrêtée : le plancher ne protège que des retraits. Échanger un trésor dépense son coût entier, et chaque nouvelle quête repart avec une amorce.

## Ce que Foyer retient

Tables relationnelles `epo_*` dans `foyer.db` (donc dans les sauvegardes), hors du document du foyer :

| Table | Contenu |
|---|---|
| `epo_profiles` | un enfant enrôlé : son plancher, la date, l'adulte qui l'a enrôlé, la date de retrait s'il a été retiré |
| `epo_ledger` | le grand livre : identifiant (uuid), enfant, genre (`amorce`, `bravo`, `annulation`), montant, quelques mots, écriture annulée (`ref`), adulte auteur, instant |

## Qui a le droit de quoi

| | Enfant | Adulte |
|---|---|---|
| sa besace et son journal | lire (sans les bravos annulés à l'écran) | sans objet : seul un membre marqué enfant a une besace |
| ceux d'un autre enfant | refusé (403) | lire |
| enrôler, retirer, donner un bravo, annuler | refusé (403) | oui |

Un jeton d'accès (assistant, script) n'entre pas dans l'API du module. L'écran figure au menu d'un enfant (`ECRANS_ENFANT`), sous « Mon épopée » à l'accueil.

## API

Sous `/api/epopee`, session de navigateur, membre du foyer, module activé (`modEpopee`).

| Route | Effet |
|---|---|
| `GET /membres` | les enfants du foyer et leur besace (`enrolled`, `floor`, `balance`) : tous pour un adulte, soi pour un enfant |
| `GET /membres/:id` | la besace d'un enfant et les 50 dernières écritures de son journal (`cancelled` marque une écriture annulée) |
| `POST /membres/:id/enrolement` | enrôler (adultes). 201 quand l'amorce est versée, 200 ensuite. 400 si le membre n'est pas un enfant |
| `DELETE /membres/:id/enrolement` | retirer de l'Épopée (adultes) ; rien n'est supprimé |
| `POST /membres/:id/bravos` | `{ id (uuid), ecus (1 à 3), note (120 caractères au plus) }` (adultes). 201 à la première réception, 200 et `duplicate: true` ensuite. 409 si l'enfant n'est pas enrôlé |
| `POST /journal/:id/annulation` | annuler une écriture (adultes). 409 avec la raison quand la règle le refuse |

Chaque geste est journalisé (« Épopée : bravo de Nolwenn à Raphaël, +2 écus (« Table mise sans rappel »). »).

## Module éteint, remise à zéro

Désactivé (`modEpopee`), l'écran disparaît et l'API répond 403 ; les besaces et leur journal sont conservés et reviennent à la réactivation. « Repartir à zéro » (`POST /api/modules/epopee/reset`, administrateur, confirmation par saisie) efface profils et grand livre.

## Vérifier depuis le serveur

```bash
# Le solde de chaque enfant, recalculé depuis le grand livre (lecture seule)
sqlite3 -readonly /var/lib/foyer/foyer.db \
  "SELECT member_id, SUM(delta) AS ecus, COUNT(*) AS ecritures FROM epo_ledger GROUP BY member_id;"
```
