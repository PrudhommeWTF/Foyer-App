# Handoff : Foyer — application de gestion familiale

## Overview
**Foyer** est une application de gestion familiale (web/bureau + mobile responsive) qui réunit 11 fonctionnalités pour organiser la vie d'un foyer : calendrier partagé, listes de courses, listes de tâches, messagerie, contacts importants, documents, suivi de budget, planning des repas, carnet de recettes, emploi du temps par membre, et gestion de la famille. Elle inclut une page de connexion, un système de notifications et un écran de paramètres globaux.

Le ton est chaleureux et familial (« la maison, ensemble »). Chaque membre du foyer possède une couleur d'identité.

## About the Design Files
Le fichier de ce bundle (`Foyer Desktop.dc.html`) est une **référence de design réalisée en HTML** — un prototype interactif qui montre l'apparence et le comportement voulus, **pas du code de production à copier tel quel**. Il s'appuie sur un petit runtime maison (`support.js`, non fourni ici et à ne pas recréer) qui n'est qu'un véhicule de prototypage.

La tâche consiste à **recréer ces écrans dans l'environnement du codebase cible** (React, Vue, Svelte, SwiftUI, natif…) en suivant ses conventions, sa librairie de composants et son système de styles. Si aucun environnement n'existe encore, choisir le framework le plus adapté (recommandation : **React + TypeScript + Vite**, state via hooks/`useReducer` ou Zustand, styling via CSS Modules ou Tailwind avec les tokens ci-dessous) et y implémenter les designs.

Ne pas embarquer le HTML ni `support.js` en production.

## Fidelity
**Haute fidélité (hifi).** Couleurs, typographie, espacements, rayons, ombres et interactions sont définitifs et documentés ci-dessous. Recréer l'UI au pixel près avec les composants et patterns du codebase cible. Toutes les données sont des **données de démonstration** (mock) — à remplacer par de vraies sources/API.

## Architecture générale

### Shell applicatif
- **Auth gate** : si non connecté → page de login plein écran ; sinon → app.
- **Layout bureau** (largeur conteneur ≥ 860 px) : `display:flex` — **sidebar fixe 270 px** à gauche + **zone principale fluide** (`flex:1`, `padding:28px 40px`, scroll vertical).
- **Layout mobile** (largeur conteneur < 860 px) : sidebar masquée, contenu pleine largeur, **barre d'onglets fixe en bas (70 px)**, panneaux latéraux passent en pleine largeur et empilés. Le basculement se fait sur la **largeur mesurée du conteneur** (ResizeObserver), pas la largeur de la fenêtre — breakpoint **860 px**.
- **Topbar** (zone principale) : titre de l'écran courant à gauche, puis champ de recherche, avatars des membres (ouvrent la gestion de la famille), cloche de notifications (badge non-lus), bouton **+** (menu déroulant d'ajout global).

### Navigation
Un seul état `screen` (string) pilote l'écran affiché. Valeurs : `home, calendar, courses, taches, messages, contacts, documents, budget, repas, recettes, planning, settings`.

Sidebar groupée en 3 sections :
- **(sans titre)** : Accueil, Calendrier, Listes de courses, Tâches, Messagerie
- **ORGANISATION** : Planning des repas, Carnet de recettes, Suivi de budget, Emploi du temps
- **LE FOYER** : Contacts, Documents

Pied de sidebar : ligne profil (avatar + nom + rôle, ouvre le profil), bouton bascule thème clair/sombre, bouton ⚙ paramètres.

## Design Tokens

### Couleurs de marque (identiques en clair/sombre)
| Rôle | Hex |
|---|---|
| Primaire (terracotta) | `#E56B4E` |
| Primaire foncé (hover/gradient) | `#D9553A` / `#C6492F` / `#C9542F` |
| Sauge (succès, validé, catégories) | `#7A9B76` (foncé `#5F7E5C`) |
| Bleu (accent secondaire) | `#4E93B8` |
| Miel/ambre (accent, alerte douce) | `#F0B24B` |
| Violet (accent) | `#9B6FA8` |
| Rose (accent) | `#C77DA5` |

### Couleurs sémantiques (CSS variables, basculées par thème)
**Thème clair :**
`--bg:#FBF4EA` · `--surface:#ffffff` · `--soft:#FBF4EA` · `--soft2:#F5EEE2` · `--ink:#3A302A` · `--ink2:#8A7E74` · `--ink3:#B7ABA0` · `--line:#EFE3D2` · `--line2:#E0D4C5`

**Thème sombre :**
`--bg:#201A17` · `--surface:#2C2521` · `--soft:#332B26` · `--soft2:#3B322C` · `--ink:#F3E9DD` · `--ink2:#B7A99B` · `--ink3:#867868` · `--line:#3C332D` · `--line2:#4A3F37`

`--ink` = texte principal, `--ink2` = secondaire, `--ink3` = tertiaire/désactivé, `--line` = bordures douces, `--line2` = bordures marquées, `--surface` = cartes, `--soft`/`--soft2` = fonds d'input et puces.
Le thème s'applique en écrivant les variables sur `document.documentElement` (dans le codebase cible : classe `.dark` sur `<html>` ou provider de thème).

### Tons de catégorie (pastilles claires, associées à une couleur d'accent)
`#FCE9E3`(terracotta) · `#EDF2EB`(sauge) · `#E5F0F4`(bleu) · `#FDF0DA`(miel) · `#F2ECF5`(violet).

### Typographie
- **Titres / chiffres clés** : `Bricolage Grotesque` (500–800). Utilisée pour titres d'écran, montants, noms de section.
- **Corps / UI** : `Nunito` (400/600/700/800). Poids par défaut des libellés UI : **700–800** (interface volontairement « grasse »).
- **Signature manuscrite** : `Caveat` (600/700) — uniquement pour le tagline « la maison, ensemble ».
- Échelle observée : titres d'écran ~28–34px/700 ; titres de carte 18–22px/700 ; libellés 13.5–15px/800 ; méta 11–13px/700 ; surétitres UPPERCASE 11–12px/800 letter-spacing .05–.08em.
- `text-wrap:pretty` sur les gros titres.

### Rayons
Boutons/puces `11–14px` · inputs `13–14px` · cartes `20–22px` · grandes modales `24–26px` · avatars `50%` · petites icônes-boutons `8–12px`.

### Ombres
- Carte : `0 12px 28px -20px rgba(90,60,40,.5)`
- Élément flottant léger : `0 6px 16px -14px rgba(90,60,40,.6)`
- Bouton primaire : `0 12px 22px -10px rgba(229,107,78,.6)` (ou `-8px .7`)
- Modale : `0 40px 80px -20px rgba(0,0,0,.5)`
- Barre d'onglets mobile : `0 -8px 24px -18px rgba(30,24,20,.4)`

### Espacements
Grille de base 4px. Paddings récurrents : puces `9px 15px`, inputs `13–14px 16px`, cartes `18–24px`, zone principale `28px 40px`. Gaps : `8–12px` (éléments), `18–24px` (colonnes/cartes).

### Animations (keyframes)
- `fpop` : `scale(.96)→1` + fade, 0.25s — apparition de modale
- `ffade` : fade in, 0.2–0.3s — changement d'écran
- `fslide` : `translateX(100%)→0` — panneau notifications (depuis la droite)
- `ftoastL` : `translateY(16px)→0` + fade — toast (bas droite)
Transitions ponctuelles : `left .2s` sur les knobs de toggle.

## Screens / Views

### 1. Login (`notAuthed`)
- **But** : se connecter au foyer.
- **Layout** : plein écran `display:flex`. Volet gauche (`flex:1`, masqué < 860px) = gradient terracotta `linear-gradient(150deg,#E56B4E,#D9553A 55%,#C6492F)` avec logo en haut, gros titre « Toute la vie du foyer, au même endroit. » (Bricolage 42px/700 blanc), sous-titre, et rangée de puces membres (avatar + prénom). Volet droit (`46%`, `100%` en mobile) = fond `--bg`, carte de formulaire max 380px : logo (mobile seulement), « Bon retour 👋 » (28px/700), champ Email, champ Mot de passe (avec bouton œil afficher/masquer), case « Rester connecté », bouton primaire « Se connecter » pleine largeur, lien « Créer un compte ».
- **Comportement** : « Se connecter » (ou Entrée) → `authed=true`, toast « Bienvenue dans votre foyer ». Aucune validation réelle (démo).

### 2. Accueil / Dashboard (`home`)
- Salutation « Bonjour {prénom} » en Caveat + phrase récap du jour. Bouton « Courses rapides depuis les repas ».
- Cartes : **Aujourd'hui** (agenda du jour, événements colorés par membre), **Tâches** (liste avec cases à cocher, avatar assigné), **Au dîner ce soir** (recette du jour, carte ambre avec CTA « Voir la recette »).

### 3. Calendrier partagé (`calendar`)
- Vues **3 jours / Semaine / Mois** commutables ; navigation période précédente/suivante avec libellé de mois propre.
- Événements colorés par membre, récurrence (`none/daily/weekday/weekly/monthly`) et événements multi-jours (champ date de fin, rendu en barre continue).
- Panneau latéral agenda : clic sur un événement → modale édition/suppression. Ajout via + ou datepicker maison (sélection de plage en 2 clics : 1er = début, 2e = fin).

### 4. Listes de courses (`courses`) — multi-listes
- **Puces de listes** en haut : « Toutes » + une puce par liste (couleur, icône, compteur d'articles non cochés) + « Nouvelle liste ». Chaque liste a `{id,name,color,icon}`.
- **En-tête de liste active** : icône + nom + boutons modifier/supprimer (la suppression retire la liste et ses articles, avec confirmation).
- **Colonne gauche** : champ d'ajout rapide + articles groupés **par rayon** (cartes de catégorie avec modifier/supprimer). Article = `{id,name,qty,cat,done,listId}`. Case à cocher (validé = sauge, texte barré). Clic sur un article → modale édition (nom, quantité, rayon, **liste**).
- **Colonne droite** : carte **Progression** (`{cochés}/{total}` de la liste active) + carte **Générer depuis les repas** (ajoute les ingrédients du planning de la semaine à la liste active, en dédupliquant).
- Modale « Nouvelle/Modifier liste » : nom, couleur (6 choix), icône (grille d'icônes).

### 5. Tâches (`taches`) — multi-listes
- Même modèle que les courses : sélecteur de listes (Toutes + listes avec icône/couleur/compteur), CRUD des listes, filtre. Tâche = `{id,text,who,due,done,prio,listId}`. Priorité (`low/med/high`), assignation à un membre, échéance.

### 6. Messagerie (`messages`)
- Fil de discussion familial (bulles par membre, couleur d'identité). **Envoi de message seul** (pas d'édition/suppression). Champ de saisie + bouton envoyer.

### 7. Contacts importants (`contacts`)
- Recherche live (nom/rôle/téléphone) + filtres par catégorie (Urgences, Santé, École, Famille, Maison, Autre) avec compteurs. Cartes contact : avatar initiales coloré, catégorie, téléphone, email, badge « urgent », actions appeler/modifier/supprimer. CRUD complet (modale formulaire + confirmation de suppression). Contact = `{id,name,role,phone,email,cat,urgent,color,ini}`.

### 8. Documents (`documents`)
- Grille de **dossiers** (couleur, compteur) avec CRUD ; navigation dans un dossier (fil « Tous les dossiers ») ; recherche transverse ; liste de fichiers récents. Fichier = `{id,name,folder,type}` (type PDF/IMG/DOC…). CRUD dossiers (suppression en cascade) et fichiers. Upload = ajout d'entrée (démo, pas de vrai stockage).

### 9. Suivi de budget (`budget`)
- **Synthèse** : dépensé / budget total + barre de progression (rouge si dépassement), revenus / dépenses / solde du mois.
- **Navigation par mois** (mois courant / précédents) avec libellé, et **comparaison mois-1** (ex. « −18% vs mois préc. »).
- **Catégories** (CRUD) : carte par catégorie avec **icône** (14 choix), couleur, budget, barre de progression, dépense recalculée depuis les transactions, delta vs mois précédent. Suppression avec confirmation (réaffecte/retire).
- **Transactions** (CRUD) : liste revenus/dépenses, montant, catégorie, date/mois. Ajout/édition/suppression recalculent les dépenses par catégorie en direct.
- Catégorie = `{id,name,color,icon,budget}` · Transaction = `{id,name,amount,type('in'|'out'),catId,month}`.

### 10. Planning des repas (`repas`)
- Grille **7 jours × 3 créneaux** (matin/midi/soir). Chaque case = recette liée (`rid`) **ou** texte libre. Navigation par semaine (`weekOffset`). CRUD de chaque repas (modale : mode recette/texte). Alimente « Générer depuis les repas » des courses.

### 11. Carnet de recettes (`recettes`)
- Grille de cartes recette (couleur **ou photo uploadée**, temps, niveau). CRUD complet : formulaire nom/temps/difficulté/couleur ou photo/ingrédients (liste dynamique)/étapes (liste dynamique). Modale détail avec édition/suppression. Recette = `{id,name,time,level,color|photo,ingr[],steps[]}`.

### 12. Emploi du temps (`planning`)
- Sélecteur des **membres du foyer** ; pour chacun, grille **7 jours** de créneaux `{id,memberId,day,start,end,label,type}` (type → couleur : école/travail/sport/loisir/santé/repas/autre/repos). Jours vides = « Libre ». CRUD complet des créneaux (modale). Boutons d'ajout par jour + « Nouveau créneau ».

### 13. Paramètres (`settings`)
- Accessible via ⚙ (sidebar). **Trois colonnes** : Général | Membres du foyer | (Apparence + Notifications + Données).
- **Général** : Langue (Français/English/Español/Deutsch), Fuseau horaire, Format de date (JJ/MM/AAAA…), Début de semaine (Lundi/Dimanche), Devise — tous en pickers segmentés (option active = fond terracotta, texte blanc).
- **Membres du foyer** : nom du foyer éditable (+ Enregistrer), bouton Inviter, liste des membres avec badge admin + modifier/supprimer (mêmes handlers que la modale de gestion de la famille).
- **Apparence** : Thème Clair/Sombre (synchronisé avec la bascule de la sidebar).
- **Notifications** : 3 toggles (Notifications push, Résumé hebdomadaire, Partage étendu).
- **Données & confidentialité** : Exporter mes données, Réinitialiser la démo, version/mentions.
- **Se déconnecter** (→ `authed=false`).

### Éléments transverses
- **Menu d'ajout global (+)** : menu déroulant depuis la topbar avec Événement, Tâche, Article de courses, Recette, Transaction, Créneau, Contact, Document, Membre — chaque entrée navigue vers l'écran concerné et ouvre sa modale de création.
- **Notifications** : cloche (badge non-lus) → panneau glissant depuis la **droite** (`fslide`), liste typée par module, « Tout marquer comme lu », clic sur une notif → écran concerné + marquée lue. Notif = `{id,type,title,sub,time,read}` avec icône/teinte par type.
- **Profil** : clic sur la ligne profil de la sidebar → modale (onglets Mon profil / Préférences ; nom, rôle, couleur ; toggles préférences ; déconnexion).
- **Gestion de la famille** : clic sur les avatars de la topbar → modale (nom du foyer éditable, liste des membres avec badge admin + modifier/supprimer, inviter un membre) ; également accessible via la carte « Membres du foyer » des paramètres. Membre = `{id,name,role,color,ini}`.
- **Toasts** : bas droite, fond `#3A302A`, blanc, auto-dismiss ~2.6s.

## Interactions & Behavior
- **Responsive** : bascule bureau/mobile sur la largeur mesurée du conteneur (ResizeObserver), breakpoint 860px. En mobile : sidebar → barre d'onglets basse (Accueil/Agenda/Courses/Tâches + « Plus »), panneaux latéraux empilés, modales en pleine largeur.
- **Thème** : bascule clair/sombre depuis la sidebar ET les paramètres (état partagé unique).
- **Modales** : overlay `rgba(30,24,20,.5)`, clic hors carte = fermer, clic sur la carte = `stopPropagation`, apparition `fpop`.
- **Champs** : validation minimale (titre non vide requis avant création, sinon toast d'erreur).
- Tous les CRUD mettent à jour l'état en mémoire et affichent un toast de confirmation.

## State Management
État unique de type composant racine. Principaux champs :
- Navigation/UI : `screen`, `narrow`, `dark`, `authed`, `addMenuOpen`, `moreOpen`, `notifOpen`, `toast`.
- Login : `loginEmail`, `loginPwd`, `loginPwdShow`, `remember`.
- Données (mock, tableaux) : `events`, `shopLists`+`shop`, `taskLists`+`tasks`, `msgs`, `contacts`, `folders`+`files`, `bcats`+`transactions`(+`month` courant), `meals`, `recipes`, `schedule`+`members`, `notifs`.
- Sélections/filtres : `activeShopList`, `activeList`(tâches), `calView`, `calAnchor`, `weekOffset`, filtres de contacts, mois budget, membre d'emploi du temps sélectionné.
- Formulaires : un jeu de champs temporaires + `*EditId` par entité (null = création, id = édition).
- Paramètres : `setLang`, `setTz`, `setDateFmt`, `setWeekStart`, `setCurrency`, `setThemeMode`, `prefNotifs`, `prefWeekly`, `prefShared`.

Dans le codebase cible : découper par domaine (un slice/reducer/hook par fonctionnalité), remplacer les seeds mock par des appels API. Les valeurs dérivées (progression, totaux budget, comparaison mois-1, groupage par rayon) sont **calculées** à partir de l'état, pas stockées.

## Design Tokens — récap machine
```
colors.brand      = { primary:#E56B4E, primaryDark:#D9553A, sage:#7A9B76, blue:#4E93B8, honey:#F0B24B, violet:#9B6FA8, pink:#C77DA5 }
colors.light      = { bg:#FBF4EA, surface:#ffffff, soft:#FBF4EA, soft2:#F5EEE2, ink:#3A302A, ink2:#8A7E74, ink3:#B7ABA0, line:#EFE3D2, line2:#E0D4C5 }
colors.dark       = { bg:#201A17, surface:#2C2521, soft:#332B26, soft2:#3B322C, ink:#F3E9DD, ink2:#B7A99B, ink3:#867868, line:#3C332D, line2:#4A3F37 }
radius            = { chip:12, input:13, card:20, cardLg:22, modal:24 }
font.display      = 'Bricolage Grotesque'
font.body         = 'Nunito'
font.script       = 'Caveat'
breakpoint.mobile = 860 (largeur du conteneur)
```

## Assets
- **Polices** : Google Fonts — Bricolage Grotesque, Nunito, Caveat.
- **Icônes** : SVG inline dessinés à la main (stroke, 24×24 viewBox). Dans le codebase cible, remplacer par la librairie d'icônes maison (ex. Lucide, dont plusieurs tracés sont proches) en conservant tailles/épaisseurs.
- **Photos de recettes** : uploadées par l'utilisateur (aucun asset fourni) ; à brancher sur le stockage réel.
- Aucun logo bitmap : le logo « maison » est un SVG inline sur fond gradient terracotta.

## Files
- `Foyer Desktop.dc.html` — prototype complet (tous les écrans, toute la logique). Référence unique.

Note : ce fichier référence `./support.js` (runtime de prototypage) qui n'est **pas** inclus et ne doit **pas** être recréé — il ne sert qu'à faire tourner le prototype hors codebase.
