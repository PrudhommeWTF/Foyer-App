# Équipements : état des lieux validé

Ce que le module reprend de l'existant, et les choix arrêtés avant d'écrire le code. Le fonctionnement et l'exploitation sont dans [`equipements.md`](equipements.md).

## Ce que le brief supposait et qui n'existait pas

- **Pas de générateur de PDF** dans le module Employé (CESU), ni ailleurs. L'export pour l'assurance (tranche 3) en écrit un petit, sans dépendance : tableau A4 en Helvetica, encodage WinAnsi (accents et signe euro).
- **Pas d'écriture de zip** : seul un lecteur existe (`finances/import/zip.ts`). La tranche 3 écrit un zip sans compression (PDF et JPEG le sont déjà), envoyé au fil de l'eau pour ne pas tenir 100 Mo de factures en mémoire.
- **Pas de section « Maison »** dans le menu : l'écran prend place dans « Le foyer », sous « Lieux de vacances ».

## Repris d'`employes/`

`schema.ts` (migrations versionnées, `eqp_meta`), `http.ts`, `repo.ts`, `routes.ts`, `backup.ts` (export, restauration, remise à zéro), drapeau dans `modules.ts` et le registre, `requireModule`, décompte et remise à zéro dans `/api/modules`. Différence : tout membre lit (le routeur est derrière `requireMember`, pas `requireAdulte`), l'écriture est réservée aux adultes route par route, et un filtre de sortie retire à un enfant numéro de série, prix, vendeur et coûts.

## Fichiers

- Octets dans le magasin partagé (`storage/blobs.ts`, `pieces/`, empreinte SHA-256).
- Une ligne par fichier dans `hh_attachments`, nouveau genre `equipment` (`storage/files.ts`).
- Une table de liens `eqp_attachments` (fiche, genre de pièce, fichier) : la facture d'une cuisine complète jointe à six fiches est un fichier et une ligne de `hh_attachments`, six liens.
- `fin_attachments` n'est pas généralisée et Finances n'est pas touché : `blobs.ts` est déjà la couche commune, seules les métadonnées restent propres à chaque module.

Deux pièges corrigés dès la tranche 1 :

1. Le ménage du démarrage (`pruneUnreferencedFiles`) effaçait toute ligne de `hh_attachments` que le document JSON ne cite pas : il tient compte désormais des fichiers cités par `eqp_attachments`. Sans cela, toutes les factures auraient disparu au premier redémarrage.
2. `GET /api/files/:id` sert tout fichier à tout membre : les fichiers `equipment` y répondent 404 et ne passent que par la route du module, qui vérifie le rôle à chaque requête.

## Photos

- Prise de vue directe (`capture="environment"`), réduction dans le navigateur à 2 000 px de côté, JPEG qualité 0,85 ; le redessin efface les métadonnées EXIF, dont la position GPS.
- Safari sur iPhone décode le HEIC et l'envoie en JPEG après réduction. Un navigateur qui ne sait pas le lire (Chrome ou Firefox sur Mac) affiche quoi faire ; le serveur refuse aussi le HEIC pour ce module, avec le même message.
- Le serveur lit les dimensions dans l'en-tête et refuse une photo de plus de 2 000 px : rien de non réduit n'est stocké, même envoyé par l'API.

## Garantie

Fonction pure, calculée à la lecture. Trois états à l'achat au lieu de deux : `neuf`, `occasion_pro` (12 mois) et `occasion_particulier` (pas de garantie légale entre particuliers, donc inconnue tant qu'aucune durée n'est saisie). Un réglage par défaut à 0 veut dire « pas de règle », donc inconnue, jamais « hors garantie dès l'achat ».

## Écarts au brief, validés

- Pas de colonnes `transaction_id` ni `contract_id` avant la tranche 3 : sans usage, elles seraient du code mort, et une migration additive ne coûte rien le moment venu.
- Clé du rappel de fin de garantie : `eqp-garantie|<id>|<date de fin>`, pour qu'une garantie prolongée prévienne à nouveau.
- Pièces de départ créées par la migration et recréées par une remise à zéro. Une pièce qui contient encore des appareils ne s'archive pas.
- Une panne passe la fiche « en panne », une réparation la remet « en service ».
- La fiche passera par le composant de fiche commun (`item-sheet`).

## Écart constaté en cours de route

- Le plafond d'un fichier est fixe (20 Mo) au lieu de suivre le réglage `maxUploadMb` : ce réglage est rangé dans la section Repas, qui disparaît quand on éteint Repas et cuisine, et son libellé parle de photos de recettes. Une photo réduite pèse moins d'un mégaoctet, une facture scannée quelques-uns : un réglage de plus n'apporterait rien.

## Décision après la tranche 1 : une seule liste de pièces

Entretien, fusionné pendant la tranche 1, a posé un socle commun de pièces dans le document du foyer (`rooms`). Garder `eqp_rooms` aurait donné deux listes pour une même maison. Validé : Équipements utilise le socle commun dès la tranche 2. Conséquences visibles :

- une seule liste, modifiable depuis l'écran Équipements, que voit aussi Entretien ;
- une pièce se **supprime** (ses appareils passent « Sans pièce ») au lieu de s'archiver ;
- un foyer neuf naît sans pièce, comme Entretien le voulait ; l'écran Équipements propose la liste de départ en un geste ;
- les installations qui ont connu la tranche 1 voient leurs pièces reprises une fois, au démarrage (voir [`equipements.md`](equipements.md#les-pièces-de-la-maison)).
