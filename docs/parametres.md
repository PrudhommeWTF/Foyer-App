<!-- Fichier engendré par `cd backend && npm run docs:settings`. Ne pas modifier à la main : la CI compare. -->

# Paramètres de Foyer

Tous les réglages de l’application, leur portée, leur valeur par défaut et le module qui les
consomme. Cette page est **engendrée depuis le registre** (`backend/src/settings/registry.ts`,
copie identique dans `frontend/src/app/core/settings/registry.ts`), donc elle ne peut pas mentir.

## Les trois portées

| Portée | Où c’est écrit | Qui peut le changer |
|---|---|---|
| **Déploiement** | variables d’environnement (`/etc/foyer/foyer.env` en LXC, `docker-compose.yml` en Docker) | l’administrateur du serveur, suivi d’un redémarrage du service |
| **Foyer** | document du foyer, clé `settings` | un administrateur du foyer, depuis l’application |
| **Personnel** | document du foyer, par membre | le membre lui-même, depuis l’application |

Un réglage appartient à **une seule** portée. Quand une variable d’environnement
l’emporte sur un réglage du foyer, la colonne « Variable prioritaire » la nomme, et
l’interface grise le champ en l’expliquant.

## Foyer et affichage

Ce que voit tout le monde : identité du foyer, format des dates, thème.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `dark` | Thème sombre | Foyer | oui / non | désactivé | — | Affichage | — |

- **Thème sombre** (`dark`) : Bascule toute l’application en couleurs sombres. Partagé par le foyer : le changer ici change l’affichage de tout le monde.

## Calendriers de référence

Vacances scolaires et partage de l’agenda. Plusieurs modules en dépendent.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `academie` | Académie | Foyer | liste | _(vide)_ | _(vide)_, `Aix-Marseille`, `Amiens`, `Besançon`, `Bordeaux`, `Clermont-Ferrand`, `Corse`, `Créteil`, `Dijon`, `Grenoble`, `Lille`, `Limoges`, `Lyon`, `Montpellier`, `Nancy-Metz`, `Nantes`, `Nice`, `Normandie`, `Orléans-Tours`, `Paris`, `Poitiers`, `Reims`, `Rennes`, `Strasbourg`, `Toulouse`, `Versailles` | Calendriers | — |
| `icsTasks` | Inclure les tâches datées dans le flux partagé | Foyer | oui / non | désactivé | — | Calendriers | — |

- **Académie** (`academie`) : Fixe la zone de vacances scolaires. Elle colore le calendrier, décide des créneaux « seulement en période scolaire » de l’emploi du temps, et fait passer l’accueil en rythme de vacances.
- **Inclure les tâches datées dans le flux partagé** (`icsTasks`) : Les tâches à faire qui ont une date apparaissent dans les agendas abonnés au lien ICS, préfixées « Tâche : ». Une tâche faite en disparaît ; une série n’y met que sa prochaine occurrence.

## Notifications et rappels

Ce qui vous interpelle, dans l’application et sur le téléphone.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `prefNotifs` | Alertes dans l’application | Foyer | oui / non | activé | — | Notifications | — |

- **Alertes dans l’application** (`prefNotifs`) : La cloche en haut de l’écran : agenda du jour, tâches en retard, anniversaires, échéances. Ne coupe pas les rappels envoyés sur le téléphone.

## Repas et cuisine

Planning des repas, suggestions et génération des courses.

| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |
|---|---|---|---|---|---|---|---|
| `showBreakfast` | Afficher le petit-déjeuner | Foyer | oui / non | désactivé | — | Repas | — |

- **Afficher le petit-déjeuner** (`showBreakfast`) : Ajoute la ligne du matin au planning des repas, et donc à la génération des courses. Les repas déjà saisis sont conservés quand la ligne est masquée.

## Ajouter un réglage

1. Déclarer une entrée dans `backend/src/settings/registry.ts`.
2. Recopier le fichier à l’identique dans `frontend/src/app/core/settings/registry.ts`.
3. Le lire dans le code avec `setting('maCle', doc)` (côté serveur) ou `store.setting('maCle')` (côté application).
4. Régénérer cette page : `cd backend && npm run docs:settings`.

La page Paramètres n’est pas à modifier : elle est engendrée depuis le registre.
Un réglage déclaré que personne ne lit, ou une clé lue qui n’est pas déclarée, **fait échouer la CI**.
