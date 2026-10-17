# Inventaire des fonctions du module Finances

Chaque ligne doit être cochée avant de considérer la refonte terminée. Colonne PR : où la fonction est traitée.

Légende : `[x]` fait et vérifié ; `[~]` fait en partie (la PR qui l'a commencé est indiquée dans la colonne Demain) ; `[ ]` à faire, la fonction reste accessible telle qu'avant.

## Navigation (PR 1)

| ✓ | Fonction | Aujourd'hui | Demain | Statut |
|---|---|---|---|---|
| [x] | 7 onglets en 3 groupes | Barre en haut | 6 espaces ; 3 + « ⋯ » sur téléphone | Amélioré |
| [x] | Mois précédent / suivant, « Ce mois-ci / Historique » | Carte du mois (Opérations, Bilan) | Aperçu et Opérations | Conservé |
| [x] | Ressources, Dépenses, Solde du mois | Carte du mois | Aperçu : calcul du chiffre héros | Amélioré |
| [x] | Dépenses du mois sur budget de référence | Carte du mois | Aperçu : rythme des enveloppes | Amélioré |
| [x] | Alerte mois incomplet (comptes et date de fin des données) | Sous la carte du mois | Aperçu « À surveiller » + bandeau Tendances | Déplacé |
| [x] | Erreur de chargement + Réessayer | En tête | En tête de chaque espace | Conservé |
| [x] | Ouverture sur le dernier mois qui a des données | Store | Inchangé | Conservé |

## Opérations (PR 2)

| ✓ | Fonction | Aujourd'hui | Demain | Statut |
|---|---|---|---|---|
| [x] | Recherche toutes périodes | Opérations | Opérations (texte ou montant) | Amélioré |
| [x] | Filtres compte (archivés compris), catégorie, sans catégorie | Opérations | Opérations | Conservé |
| [x] | Filtres étiquette et contrat (pastilles retirables), Effacer | Opérations | Opérations | Conservé |
| [x] | Ligne : icône (virement, recette, catégorie), compte, chemin de catégorie, étiquettes, pointée | Opérations | Tableau groupé par jour | Amélioré |
| [x] | Pagination 50 / page | Opérations | Opérations | Conservé |
| [x] | Saisie / modification : sens, libellé, montant, compte, date, catégorie, contrat, notes, pointée | Fenêtre | Fiche latérale (ordinateur) ou panneau (téléphone) | Amélioré |
| [x] | Suggestion de catégorie (« déjà classé ainsi N× ») | Fenêtre | Fiche, avec le reste de l'enveloppe | Amélioré |
| [x] | Origine de la catégorie (règle X / à la main) | Fenêtre | Fiche | Conservé |
| [x] | Créer une règle depuis une opération | Fenêtre | Fiche | Conservé |
| [x] | Suppression confirmée | Fenêtre | Fiche | Conservé |
| [x] | Filtre « non pointées » | · | Opérations | Nouveau |
| [x] | Libellé d'origine | Seulement dans l'export CSV | Fiche | Enfin affiché |
| [x] | Justificatif sur une opération | Serveur seulement | Fiche | Enfin affiché |
| [x] | À classer en un geste | Filtre « Sans catégorie » | Aperçu (boîte) + pastille Opérations | Amélioré |

## Bilan (PR 1)

| ✓ | Fonction | Aujourd'hui | Demain | Statut |
|---|---|---|---|---|
| [x] | Par rapport au mois précédent | Bilan | Tendances | Déplacé |
| [x] | Moyenne mensuelle (mois complets) | Bilan | Tendances | Déplacé |
| [x] | Cumul de l'année + avertissement « sous-estimé » | Bilan | Tendances | Déplacé |
| [x] | 12 derniers mois (ressources / dépenses, mois incomplets hachurés) | Bilan | Tendances : solde de part et d'autre de zéro, détail au survol | Amélioré |
| [x] | Budgets du mois | Bilan | Aperçu : enveloppes | Amélioré |
| [x] | Plus grosses dépenses du mois (clic → Opérations) | Bilan | Tendances | Déplacé |
| [x] | Dépenses de l'année par catégorie vs budget × mois | Bilan | Tendances | Déplacé |
| [x] | Catégories face à la moyenne au même jour | · | Tendances | Nouveau |

## Comptes (PR 2)

| ✓ | Fonction | Aujourd'hui | Demain | Statut |
|---|---|---|---|---|
| [x] | Types courant / pro / épargne / crédit, titulaires | Comptes | Comptes | Conservé |
| [x] | Solde, couverture (N opérations, jusqu'au…), solde d'ouverture daté | Comptes | Comptes | Conservé |
| [x] | Archivage (sort des alertes), suppression refusée si opérations | Comptes | Comptes (archivés repliés) | Conservé |
| [x] | Alias d'import (ajout, retrait) | Comptes | Fiche du compte | Conservé |
| [x] | Crédit : termes, capital restant dû, % remboursé, échéances restantes | Comptes | Comptes + Aperçu | Amélioré |
| [x] | Tableau d'amortissement | Serveur seulement | Comptes (courbe + tableau) | Enfin affiché |
| [x] | Patrimoine net | · | Comptes | Nouveau |

## Catégories (PR 3)

| ✓ | Fonction | Aujourd'hui | Demain | Statut |
|---|---|---|---|---|
| [x] | Deux niveaux, budget de référence, couleur, icône | Catégories | Organiser › Catégories | Déplacé |
| [x] | Suppression avec sous-catégories | Catégories | Organiser › Catégories | Déplacé |
| [x] | Charge fixe (hors enveloppes) | · | Organiser › Catégories (bascule « Fixe » dans le tableau ; migration : PR 1) | Nouveau |
| [x] | Moyenne réelle en face du budget | · | Organiser › Catégories | Nouveau |

## Contrats, biens, économies (PR 3)

| ✓ | Fonction | Aujourd'hui | Demain | Statut |
|---|---|---|---|---|
| [x] | Échéances 6 mois : préavis, reconduction, fin ; urgence < 30 j ; Tâche | Contrats | Contrats › Échéances + Aperçu | Amélioré |
| [x] | Biens : immobilier / véhicule / autre, vendu, adresse, dates, notes | Contrats | Contrats | Conservé |
| [x] | Contrat : tous les champs, références, personnes, statut | Contrats | Fiche du contrat | Conservé |
| [x] | Coût réel 12 mois, hors fourchette, voir ces opérations | Contrats | Jauge fourchette / dernier prélèvement | Amélioré |
| [x] | Pièces jointes (PDF, images, 20 Mo, doublons) | Contrats | Fiche du contrat | Conservé |
| [x] | Créer une règle pour ce contrat | Contrats | Fiche du contrat | Conservé |
| [x] | Relevés de compteur : index, HP/HC, conso par période, comparaison à un an | Contrats (énergie) | Fiche : graphique kWh/jour | Amélioré |
| [x] | Modifier un relevé | Serveur seulement | Fiche du contrat | Enfin affiché |
| [x] | Relevés en retard | Serveur seulement (/home) | Aperçu « À surveiller » + notification | Enfin affiché |
| [x] | Pistes d'économies : totaux, statuts, Tâche, gain annuel | Contrats | Contrats › Économies | Conservé |

## Règles (PR 3)

| ✓ | Fonction | Aujourd'hui | Demain | Statut |
|---|---|---|---|---|
| [x] | Conditions (libellé, montant, sens, compte, jour, date) et opérateurs | Règles | Organiser › Règles | Déplacé |
| [x] | Toutes / au moins une, actions multiples, ordre, arrêt, activation | Règles | Organiser › Règles (phrases) | Amélioré |
| [x] | Tester (aperçu), Enregistrer et appliquer | Règles | Organiser › Règles | Conservé |
| [x] | Réappliquer sur l'historique, forcer, rapport | Règles | Organiser › Règles | Conservé |
| [x] | Réappliquer sur une période ou un compte | Serveur seulement | Organiser › Règles | Enfin affiché |
| [x] | Étiquettes (compte, clic → Opérations) | Règles | Organiser › Règles | Conservé |

## Import et données (PR 3)

| ✓ | Fonction | Aujourd'hui | Demain | Statut |
|---|---|---|---|---|
| [x] | Formats CSV/Bankin', OFX, CAMT.053, xlsx ; rien avant validation | Import | Organiser › Import + bouton dans Opérations | Déplacé |
| [x] | Rapport : lignes, copies, déjà là, nouvelles ; rejets | Import | Import, en tête de l'étape 2 (le fichier lu) | Conservé |
| [x] | Comptes inconnus à rattacher (alias) | Import | Import, étape 2 | Amélioré |
| [x] | Catégories suggérées après import | Import | Import, étape 3 | Amélioré |
| [x] | Virements internes proposés (confiance), validés, séparer | Import | Import, étape 3 + historique | Amélioré |
| [x] | Historique des imports, annuler, réimporter | Import | Organiser › Import | Conservé |
| [x] | Export CSV, sauvegarde JSON, restauration (admin) | Import | Organiser › Données | Déplacé |

## Hors du module (PR 1-3)

| ✓ | Fonction | Aujourd'hui | Demain | Statut |
|---|---|---|---|---|
| [x] | Tuile d'accueil (revenus, dépenses, solde, compte courant) | Accueil, ordinateur | Accueil, + reste du mois, + téléphone | Amélioré |
| [x] | Notifications : budget dépassé, mois incomplet, préavis | Notifications | Inchangé | Conservé |
| [x] | Échéances dans l'agenda et le flux ICS | Agenda | Inchangé | Conservé |
| [x] | Tâche depuis échéance / économie, lien retour vers le contrat | Tâches | Inchangé | Conservé |
| [x] | Recherche globale, menu « + Opération » | Barre du haut | Inchangé (vers Opérations) | Conservé |
| [x] | Réservé aux adultes, jamais aux jetons, module désactivable | Partout | Inchangé | Conservé |
