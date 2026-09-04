// Le registre des paramètres du foyer.
//
// Un paramètre se déclare **ici, une seule fois** : sa clé, son type, sa valeur
// par défaut, sa portée, sa section, son libellé et sa description en français.
// Le code ne lit jamais `settings.x` directement, il appelle `setting('x', doc)`.
// C'est cette contrainte qui rend la dérive détectable, et la CI la détecte
// (voir backend/test/settings-registry.test.ts) :
//
//   - un paramètre déclaré que personne ne lit fait échouer le test ;
//   - une clé lue qui n'est pas déclarée fait échouer le test ;
//   - un accès direct à `.settings.` hors des fichiers autorisés fait échouer le test ;
//   - la moindre différence entre les deux copies de ce fichier fait échouer le test.
//
// **Les deux copies de ce fichier sont identiques octet pour octet :**
//
//   backend/src/settings/registry.ts
//   frontend/src/app/core/settings/registry.ts
//
// Le dépôt fait déjà ce choix pour `models.ts` ; la différence est qu'ici la CI
// le vérifie. Un vrai fichier partagé à la racine imposerait de changer le
// `rootDir` du backend, donc la forme de `dist/`, donc l'unité systemd et
// `self-update.sh` : le prix dépasse le bénéfice. Ce fichier n'importe donc
// rien, pour rester copiable tel quel.
//
// La clé d'un paramètre **est** sa clé de stockage dans `settings` : il n'y a
// aucune migration à écrire pour la renommer, parce qu'on ne la renomme pas.
// Un paramètre nouvellement déclaré n'existe pas dans les documents existants :
// `setting()` rend sa valeur par défaut, et le document n'est réécrit que le
// jour où quelqu'un change la valeur. La reprise est donc rejouable par
// construction, et une installation existante ne casse pas.
//
// `docs/parametres.md` est engendré depuis ce fichier (`npm run docs:settings`
// dans backend/) et la CI vérifie qu'il est à jour.

/**
 * Où vit un paramètre, et qui a le droit de l'écrire.
 *
 *   - `deploiement` : variable d'environnement ou disque. Jamais modifiable
 *     depuis l'interface, affiché en lecture seule pour qu'on sache ce qui
 *     s'applique réellement.
 *   - `foyer`       : partagé, dans le document, écrit par un administrateur.
 *   - `personnel`   : propre à un membre, écrit par lui-même.
 */
export type SettingScope = 'deploiement' | 'foyer' | 'personnel';

/** Le type décide du contrôle de saisie et de la forme du champ engendré. */
export type SettingType = 'bool' | 'int' | 'enum' | 'text' | 'time' | 'secret';

/** Une valeur admise d'un paramètre `enum`, avec son libellé affiché. */
export interface SettingOption { value: string; label: string; }

export interface SettingDecl {
  /** Clé de stockage. Unique dans tout le registre, toutes portées confondues. */
  key: string;
  type: SettingType;
  scope: SettingScope;
  /** Identifiant d'une section de `SECTIONS`. */
  section: string;
  /** Le module propriétaire, tel qu'il se nomme pour l'utilisateur. */
  module: string;
  label: string;
  /**
   * Ce que le réglage change concrètement, et où l'effet se voit. Jamais une
   * reformulation du libellé : c'est le seul texte qui évite d'aller lire le code.
   */
  desc: string;
  default: boolean | number | string;
  /** `enum` : les valeurs admises, dans l'ordre d'affichage. */
  options?: readonly SettingOption[];
  /** `int` : bornes incluses. */
  min?: number;
  max?: number;
  /** `text` : longueur maximale. */
  maxLength?: number;
  /**
   * Le réglage a son propre contrôle dans sa section, écrit à la main.
   *
   * Il reste déclaré ici, donc journalisé, exporté, contrôlé côté serveur et
   * remis à zéro comme les autres : seule sa **saisie** échappe au champ
   * engendré, parce qu'une liste ordonnée ne se règle pas dans une zone de
   * texte. La CI vérifie que la section nomme bien un rendu à la main.
   */
  custom?: boolean;
  /**
   * Variable d'environnement liée au réglage.
   *
   *   - portée `foyer` : si elle est posée, **elle l'emporte**, et l'interface
   *     grise le champ en la nommant, plutôt que de laisser croire qu'un réglage
   *     sans effet est actif.
   *   - portée `deploiement` : c'est la seule source du réglage, obligatoire.
   */
  envOverride?: string;
}

export interface SettingSection {
  id: string;
  label: string;
  /** Ce que la section regroupe, affiché sous son titre. */
  desc: string;
  /** Identifiant d'un groupe de `GROUPS`. */
  group: string;
}

/**
 * Les grands ensembles de la page, dans l'ordre.
 *
 * On va d'abord à soi, puis au foyer, puis aux modules, puis à la machine : du
 * plus personnel au plus technique. Le groupe vit ici parce que la page est
 * engendrée : déclarer une section, c'est décider où elle tombe, sans rouvrir
 * l'écran.
 */
export interface SettingGroup { id: string; label: string; desc: string; }

export const GROUPS: readonly SettingGroup[] = [
  { id: 'moi', label: 'Vous', desc: 'Votre compte, votre affichage, et ce qui vous interpelle.' },
  { id: 'cercle', label: 'Le foyer', desc: 'Ce qui vaut pour tout le monde sous ce toit.' },
  { id: 'modules', label: 'Les modules', desc: 'Le comportement de chaque écran de l’application.' },
  { id: 'machine', label: 'Serveur et exploitation', desc: 'Les accès, la machine, les sauvegardes et les mises à jour.' },
];

/**
 * Les sections de la page, dans l'ordre d'affichage, groupe par groupe.
 *
 * Deux sections ne portent aucun réglage et n'en porteront peut-être jamais :
 * « Mon compte » et « Membres et accès » sont des gestes (changer son mot de
 * passe, ajouter quelqu'un). Elles sont déclarées ici quand même, parce que
 * c'est cette liste qui décide de l'ordre de la page.
 */
export const SECTIONS: readonly SettingSection[] = [
  { id: 'compte', group: 'moi', label: 'Mon compte', desc: 'Votre prénom, vos initiales, votre couleur, votre adresse de connexion et votre mot de passe.' },
  { id: 'affichage', group: 'moi', label: 'Apparence', desc: 'Comment l’application se présente à vous, sur tous vos appareils.' },
  { id: 'notifications', group: 'moi', label: 'Notifications et rappels', desc: 'Ce qui vous interpelle, dans l’application et sur le téléphone.' },
  { id: 'membres', group: 'cercle', label: 'Membres et accès', desc: 'Le nom du foyer, ses membres, et qui peut se connecter.' },
  { id: 'calendriers', group: 'cercle', label: 'Calendriers de référence', desc: 'Vacances scolaires et partage de l’agenda. Plusieurs modules en dépendent.' },
  { id: 'accueil', group: 'modules', label: 'Accueil', desc: 'L’ordre des tuiles de l’écran d’accueil, et ce qui en décide.' },
  { id: 'repas', group: 'modules', label: 'Repas et cuisine', desc: 'Planning des repas, suggestions et génération des courses.' },
  { id: 'courses', group: 'modules', label: 'Courses', desc: 'Génération de la liste depuis les repas, et mémoire de ce qu’on a déjà. L’ordre des rayons et les articles de placard se règlent dans l’écran Courses.' },
  { id: 'taches', group: 'modules', label: 'Tâches', desc: 'Ce qui compte encore comme l’affaire du jour, et ce qui rappelle.' },
  { id: 'finances', group: 'modules', label: 'Finances', desc: 'Ce qui remonte sur l’accueil, et quand un compteur réclame un relevé.' },
  { id: 'documents', group: 'modules', label: 'Documents', desc: 'Ce que le foyer accepte de ranger sur son disque.' },
  { id: 'acces', group: 'machine', label: 'Accès et comptes', desc: 'Qui peut ouvrir un compte, ce que dure une session, et ce que l’application a le droit d’aller chercher dehors.' },
  { id: 'exploitation', group: 'machine', label: 'Exploitation', desc: 'Version, mises à jour, sauvegardes, journal du service et journal des modifications.' },
  { id: 'serveur', group: 'machine', label: 'Serveur et déploiement', desc: 'Ce que la machine impose. Non modifiable ici : ces valeurs se changent dans la configuration du service, puis redémarrage.' },
];

/**
 * Les académies françaises, valeurs admises du réglage `academie`.
 *
 * La zone est indicative : le backend interroge le jeu de données officiel par
 * nom d'académie. La liste vit ici plutôt que dans `constants.ts` pour qu'un
 * seul fichier porte à la fois la valeur admise et son libellé.
 */
const ACADEMIE_OPTIONS: readonly SettingOption[] = [
  { value: '', label: 'Non définie' },
  { value: 'Aix-Marseille', label: 'Aix-Marseille (zone B)' },
  { value: 'Amiens', label: 'Amiens (zone B)' },
  { value: 'Besançon', label: 'Besançon (zone A)' },
  { value: 'Bordeaux', label: 'Bordeaux (zone A)' },
  { value: 'Clermont-Ferrand', label: 'Clermont-Ferrand (zone A)' },
  { value: 'Corse', label: 'Corse' },
  { value: 'Créteil', label: 'Créteil (zone C)' },
  { value: 'Dijon', label: 'Dijon (zone A)' },
  { value: 'Grenoble', label: 'Grenoble (zone A)' },
  { value: 'Lille', label: 'Lille (zone B)' },
  { value: 'Limoges', label: 'Limoges (zone A)' },
  { value: 'Lyon', label: 'Lyon (zone A)' },
  { value: 'Montpellier', label: 'Montpellier (zone C)' },
  { value: 'Nancy-Metz', label: 'Nancy-Metz (zone B)' },
  { value: 'Nantes', label: 'Nantes (zone B)' },
  { value: 'Nice', label: 'Nice (zone B)' },
  { value: 'Normandie', label: 'Normandie (zone B)' },
  { value: 'Orléans-Tours', label: 'Orléans-Tours (zone B)' },
  { value: 'Paris', label: 'Paris (zone C)' },
  { value: 'Poitiers', label: 'Poitiers (zone A)' },
  { value: 'Reims', label: 'Reims (zone B)' },
  { value: 'Rennes', label: 'Rennes (zone B)' },
  { value: 'Strasbourg', label: 'Strasbourg (zone B)' },
  { value: 'Toulouse', label: 'Toulouse (zone C)' },
  { value: 'Versailles', label: 'Versailles (zone C)' },
];

/**
 * Le registre.
 *
 * Ajouter un réglage, c'est ajouter une ligne ici et l'appeler avec
 * `setting()`. La page Paramètres n'est jamais rouverte : elle est engendrée.
 */
export const REGISTRY = [
  {
    key: 'dark',
    type: 'bool', scope: 'personnel', section: 'affichage', module: 'Apparence',
    label: 'Thème sombre',
    desc: 'Bascule l’application en couleurs sombres, sur tous vos appareils. Propre à vous : votre choix ne change rien à l’affichage des autres membres.',
    default: false,
  },
  {
    key: 'academie',
    type: 'enum', scope: 'foyer', section: 'calendriers', module: 'Calendriers',
    label: 'Académie',
    desc: 'Fixe la zone de vacances scolaires. Elle colore le calendrier, décide des créneaux « seulement en période scolaire » de l’emploi du temps, et fait passer l’accueil en rythme de vacances.',
    default: '',
    options: ACADEMIE_OPTIONS,
  },
  {
    key: 'icsTasks',
    type: 'bool', scope: 'foyer', section: 'calendriers', module: 'Calendriers',
    label: 'Inclure les tâches datées dans le flux partagé',
    desc: 'Les tâches à faire qui ont une date apparaissent dans les agendas abonnés au lien ICS, préfixées « Tâche : ». Une tâche faite en disparaît ; une série n’y met que sa prochaine occurrence.',
    default: false,
  },
  {
    key: 'prefNotifs',
    type: 'bool', scope: 'personnel', section: 'notifications', module: 'Notifications',
    label: 'Alertes dans l’application',
    desc: 'La cloche en haut de l’écran : agenda du jour, tâches en retard, anniversaires, échéances. Propre à vous, et sans effet sur les rappels envoyés au téléphone.',
    default: true,
  },
  // ---- notifications : deux canaux, et on ne les confond pas ------------
  //
  // La cloche de l'application et les rappels envoyés au téléphone ne sont pas
  // le même objet : l'une se regarde quand on ouvre Foyer, l'autre interrompt.
  // Les couper ensemble sous un seul interrupteur était le premier mensonge de
  // l'ancienne page.
  {
    key: 'pushPaused',
    type: 'bool', scope: 'foyer', section: 'notifications', module: 'Notifications',
    label: 'Suspendre tous les rappels du foyer',
    desc: 'Coupe d’un geste les rappels envoyés aux téléphones, pour tout le monde : le temps des vacances, d’un déménagement, d’une semaine chargée. Les rappels suspendus ne sont pas rattrapés à la reprise.',
    default: false,
  },
  {
    key: 'quietFrom',
    type: 'time', scope: 'foyer', section: 'notifications', module: 'Notifications',
    label: 'Début des heures de silence',
    desc: 'À partir de cette heure, plus aucun rappel n’arrive sur les téléphones du foyer. Un rappel qui tombe pendant est reporté à la fin du silence, jamais perdu.',
    default: '21:30',
  },
  {
    key: 'quietTo',
    type: 'time', scope: 'foyer', section: 'notifications', module: 'Notifications',
    label: 'Fin des heures de silence',
    desc: 'Heure à laquelle les rappels reprennent, et à laquelle arrivent ceux qui ont été reportés pendant la nuit.',
    default: '07:00',
  },
  {
    key: 'pushReminders',
    type: 'bool', scope: 'personnel', section: 'notifications', module: 'Tâches',
    label: 'Sur le téléphone : rappels de mes tâches',
    desc: 'Le rappel réglé sur une tâche datée (à l’heure, une heure avant, la veille au soir, le matin) arrive sur vos appareils abonnés. Coupé, la tâche garde son rappel mais vous ne le recevez plus.',
    default: true,
  },
  {
    key: 'pushAssigned',
    type: 'bool', scope: 'personnel', section: 'notifications', module: 'Tâches',
    label: 'Sur le téléphone : quand on m’affecte une tâche',
    desc: 'Quelqu’un du foyer vous affecte une tâche : vous êtes prévenu tout de suite, sans attendre d’ouvrir l’application.',
    default: true,
  },
  {
    key: 'notifEvents',
    type: 'bool', scope: 'personnel', section: 'notifications', module: 'Agenda',
    label: 'Dans la cloche : agenda du jour et de demain',
    desc: 'Les événements d’aujourd’hui et de demain apparaissent dans la cloche en haut de l’écran.',
    default: true,
  },
  {
    key: 'notifTasks',
    type: 'bool', scope: 'personnel', section: 'notifications', module: 'Tâches',
    label: 'Dans la cloche : tâches du jour et en retard',
    desc: 'Les tâches datées à faire aujourd’hui et celles qui ont dépassé leur échéance apparaissent dans la cloche.',
    default: true,
  },
  {
    key: 'notifBirthdays',
    type: 'bool', scope: 'personnel', section: 'notifications', module: 'Contacts',
    label: 'Dans la cloche : anniversaires',
    desc: 'Les anniversaires des membres et des contacts, dans les sept jours qui viennent.',
    default: true,
  },
  {
    key: 'notifFinances',
    type: 'bool', scope: 'personnel', section: 'notifications', module: 'Finances',
    label: 'Dans la cloche : budgets et échéances de contrat',
    desc: 'Les budgets dépassés, les fenêtres de résiliation qui approchent et les mois d’opérations incomplets.',
    default: true,
  },
  // ---- repas et cuisine ---------------------------------------------------
  {
    key: 'homeOrder',
    type: 'text', scope: 'foyer', section: 'accueil', module: 'Accueil',
    custom: true,
    label: 'Ordre des tuiles de l’accueil',
    desc: 'Fige l’ordre des tuiles de l’accueil. Tant qu’il est vide, les règles de contexte remontent ce qui compte selon l’heure et le jour ; dès qu’un ordre est choisi, il l’emporte, plus rien ne bouge et plus rien ne se replie. Une tuile ajoutée par une mise à jour vient à la fin.',
    default: '',
    maxLength: 300,
  },
  {
    key: 'mealTimeMorning',
    type: 'time', scope: 'foyer', section: 'repas', module: 'Repas',
    label: 'Heure du petit-déjeuner',
    desc: 'Heure de référence du créneau du matin. Elle décide de l’heure de l’événement créé quand un repas part à l’agenda, et de qui est compté à table selon l’emploi du temps.',
    default: '08:00',
  },
  {
    key: 'mealTimeNoon',
    type: 'time', scope: 'foyer', section: 'repas', module: 'Repas',
    label: 'Heure du déjeuner',
    desc: 'Heure de référence du créneau du midi. Un créneau d’emploi du temps marqué « hors du foyer » qui la couvre retire la personne du décompte des couverts.',
    default: '12:30',
  },
  {
    key: 'mealTimeEvening',
    type: 'time', scope: 'foyer', section: 'repas', module: 'Repas',
    label: 'Heure du dîner',
    desc: 'Heure de référence du créneau du soir. Même rôle que les deux précédentes : l’agenda et le décompte des couverts s’y accrochent.',
    default: '19:30',
  },
  {
    key: 'suggestRepeatDays',
    type: 'int', scope: 'foyer', section: 'repas', module: 'Cuisine',
    label: 'Ne pas resservir un plat avant',
    desc: 'Une recette servie il y a moins de ce nombre de jours est écartée des suggestions du planning. L’écran de suggestion dit combien de recettes il a écartées pour cette raison.',
    default: 15, min: 1, max: 90,
  },
  {
    key: 'suggestForgottenDays',
    type: 'int', scope: 'foyer', section: 'repas', module: 'Cuisine',
    label: 'Considérer un plat comme oublié après',
    desc: 'Passé ce délai sans l’avoir servi, une recette est remise en avant dans les suggestions avec la mention « pas fait depuis longtemps ».',
    default: 21, min: 2, max: 365,
  },
  {
    key: 'suggestQuickMin',
    type: 'int', scope: 'foyer', section: 'repas', module: 'Cuisine',
    label: 'Ce qu’on appelle une recette rapide',
    desc: 'Préparation et cuisson comprises, en minutes. En dessous, la recette est mise en avant les soirs de semaine chargés.',
    default: 25, min: 5, max: 180,
  },
  {
    key: 'showBreakfast',
    type: 'bool', scope: 'foyer', section: 'repas', module: 'Repas',
    label: 'Afficher le petit-déjeuner',
    desc: 'Ajoute la ligne du matin au planning des repas, et donc à la génération des courses. Les repas déjà saisis sont conservés quand la ligne est masquée.',
    default: false,
  },
  {
    key: 'recipeImport',
    type: 'bool', scope: 'foyer', section: 'acces', module: 'Cuisine',
    label: 'Importer une recette depuis une adresse web',
    desc: 'La seule requête sortante de l’application, déclenchée par vous et journalisée : le carnet va lire la page d’une recette pour la recopier. Coupé, le bouton d’import disparaît du carnet.',
    default: true,
    envOverride: 'FOYER_RECIPE_IMPORT',
  },
  {
    key: 'publicUrl',
    type: 'text', scope: 'foyer', section: 'notifications', module: 'Notifications',
    label: 'Adresse publique de Foyer',
    desc: 'L’adresse ouverte quand on touche une notification sur le téléphone, par exemple https://foyer.exemple.fr. Vide, la notification ouvre l’adresse par laquelle l’appareil s’était abonné, ce qui échoue depuis l’extérieur si c’était une adresse locale.',
    default: '',
    maxLength: 300,
    envOverride: 'FOYER_PUBLIC_URL',
  },

  // ---- courses ------------------------------------------------------------
  {
    key: 'stockDays',
    type: 'int', scope: 'foyer', section: 'courses', module: 'Courses',
    label: 'Durée du « j’ai déjà ça »',
    desc: 'Combien de jours un article écarté d’un « j’ai déjà ça » reste hors de la liste engendrée depuis les repas. Passé ce délai il revient, parce qu’un placard se vide. La date du geste reste affichée.',
    default: 21, min: 1, max: 180,
  },

  // ---- tâches -------------------------------------------------------------
  {
    key: 'taskLateDays',
    type: 'int', scope: 'foyer', section: 'taches', module: 'Tâches',
    label: 'Au-delà de ce retard, une tâche passe derrière',
    desc: 'Une tâche en retard depuis plus longtemps cesse d’être l’affaire du jour et descend sous les tâches d’aujourd’hui. Elle n’est ni effacée ni masquée : elle cesse seulement de passer devant.',
    default: 30, min: 1, max: 365,
  },
  {
    key: 'taskDefaultRemind',
    type: 'enum', scope: 'foyer', section: 'taches', module: 'Tâches',
    label: 'Rappel proposé pour une nouvelle tâche datée',
    desc: 'Ce que le formulaire coche d’avance quand on donne une date à une tâche. Cela ne change aucune tâche existante, et reste modifiable tâche par tâche.',
    default: '',
    options: [
      { value: '', label: 'Aucun rappel' },
      { value: 'at', label: 'À l’heure de la tâche' },
      { value: '1h', label: 'Une heure avant' },
      { value: 'eve', label: 'La veille à 18 h' },
      { value: 'morning', label: 'Le matin à 9 h' },
    ],
  },

  // ---- finances -----------------------------------------------------------
  {
    key: 'deadlineHorizonDays',
    type: 'int', scope: 'foyer', section: 'finances', module: 'Finances',
    label: 'Horizon des échéances sur l’accueil',
    desc: 'Une fenêtre de résiliation ou une reconduction plus lointaine que cela n’apparaît pas sur l’accueil : elle n’appelle aucun geste aujourd’hui. L’écran Contrats les montre toutes, quoi qu’il arrive.',
    default: 60, min: 7, max: 365,
  },
  {
    key: 'readingDueDays',
    type: 'int', scope: 'foyer', section: 'finances', module: 'Énergie',
    label: 'Relevé de compteur attendu après',
    desc: 'Passé ce délai sans nouveau relevé, le compteur est signalé comme à relire. Un mois par défaut, et non la périodicité de facturation : celle-ci dit quand le fournisseur prélève, pas quand une dérive devient visible.',
    default: 30, min: 7, max: 365,
  },

  // ---- documents ----------------------------------------------------------
  {
    key: 'maxUploadMb',
    type: 'int', scope: 'foyer', section: 'documents', module: 'Documents',
    label: 'Taille maximale d’un fichier',
    desc: 'En mégaoctets, pour les documents du foyer comme pour les photos de recettes. Le serveur refuse de toute façon au-delà de 20 Mo : c’est son plafond technique, celui-ci est le vôtre, en dessous.',
    default: 20, min: 1, max: 20,
  },

  // ---- accès --------------------------------------------------------------
  {
    key: 'sessionDays',
    type: 'int', scope: 'foyer', section: 'acces', module: 'Accès',
    label: 'Durée de validité d’une session',
    desc: 'Combien de jours une connexion reste valable avant de redemander le mot de passe. Les sessions déjà ouvertes gardent leur durée : c’est à la connexion suivante que la nouvelle valeur s’applique.',
    default: 30, min: 1, max: 365,
  },
  {
    key: 'passwordMinLength',
    type: 'int', scope: 'foyer', section: 'acces', module: 'Accès',
    label: 'Longueur minimale d’un mot de passe',
    desc: 'S’applique à la création d’un accès et à tout changement de mot de passe. Les mots de passe existants ne sont pas invalidés : personne ne se retrouve dehors parce que la règle a changé.',
    default: 6, min: 6, max: 64,
  },

  // ---- exploitation -------------------------------------------------------
  {
    key: 'logLevel',
    type: 'enum', scope: 'foyer', section: 'exploitation', module: 'Exploitation',
    label: 'Niveau de journalisation',
    desc: 'Ce que le service écrit dans son journal, lisible avec « journalctl -u foyer » (LXC) ou « docker compose logs -f foyer ». Le changement est immédiat, sans redémarrage.',
    default: 'info',
    options: [
      { value: 'erreur', label: 'Erreurs seulement' },
      { value: 'info', label: 'Normal : ce que le service a fait' },
      { value: 'debug', label: 'Détaillé : pour comprendre un cas précis' },
    ],
  },
  {
    key: 'backupKeep',
    type: 'int', scope: 'foyer', section: 'exploitation', module: 'Exploitation',
    label: 'Sauvegardes conservées',
    desc: 'Combien d’instantanés de la base sont gardés dans le dossier de données. Au-delà, le plus ancien est effacé à la sauvegarde suivante, pour que le disque ne se remplisse pas tout seul.',
    default: 7, min: 1, max: 60,
  },

  // ---- déploiement : lu, jamais écrit d'ici -------------------------------
  //
  // Ces lignes ne servent pas à régler, elles servent à **savoir ce qui
  // s'applique** sans ouvrir un terminal. Chacune nomme sa variable et le
  // fichier où la changer. Un `secret` n'est jamais relu : l'interface dit
  // seulement s'il est posé.
  {
    key: 'envVersion',
    type: 'text', scope: 'deploiement', section: 'serveur', module: 'Exploitation',
    label: 'Version installée',
    desc: 'La version que ce service exécute. Injectée au build de l’image Docker, ou posée par l’installeur LXC dans /etc/foyer/foyer.env.',
    default: '', envOverride: 'FOYER_VERSION',
  },
  {
    key: 'envDataDir',
    type: 'text', scope: 'deploiement', section: 'serveur', module: 'Exploitation',
    label: 'Dossier des données',
    desc: 'Où vivent la base SQLite, les fichiers, les photos et les sauvegardes de migration. C’est ce dossier qu’il faut archiver pour avoir une sauvegarde complète.',
    default: '', envOverride: 'FOYER_DATA_DIR',
  },
  {
    key: 'envPort',
    type: 'text', scope: 'deploiement', section: 'serveur', module: 'Exploitation',
    label: 'Port d’écoute',
    desc: 'Le port sur lequel le service répond, derrière votre reverse-proxy le cas échéant.',
    default: '8099', envOverride: 'PORT',
  },
  {
    key: 'envJwtSecret',
    type: 'secret', scope: 'deploiement', section: 'serveur', module: 'Accès',
    label: 'Secret de signature des sessions',
    desc: 'Il protège tous les jetons de session : un secret faible laisse forger une session d’administrateur. Jamais affiché, seulement son état. En production, un secret absent ou trop court empêche le démarrage.',
    default: '', envOverride: 'FOYER_JWT_SECRET',
  },
  {
    key: 'envCorsOrigins',
    type: 'text', scope: 'deploiement', section: 'serveur', module: 'Exploitation',
    label: 'Origines cross-origin autorisées',
    desc: 'À laisser vide en mono-conteneur : l’API sert sa propre application, donc aucune requête n’est cross-origin. Ne sert qu’à un déploiement où l’application est servie par un autre hôte.',
    default: '', envOverride: 'FOYER_CORS_ORIGINS',
  },
  {
    key: 'envSelfUpdate',
    type: 'text', scope: 'deploiement', section: 'serveur', module: 'Exploitation',
    label: 'Mise à jour automatique',
    desc: 'Quand elle est active, le bouton « Mettre à jour maintenant » dépose un fichier déclencheur qu’une unité systemd root exécute. Elle ne se change pas ici : une unité systemd en dépend.',
    default: '', envOverride: 'FOYER_SELF_UPDATE',
  },
  {
    key: 'envGithubRepo',
    type: 'text', scope: 'deploiement', section: 'serveur', module: 'Exploitation',
    label: 'Dépôt consulté pour les mises à jour',
    desc: 'Le dépôt GitHub dont les releases sont comparées à la version installée.',
    default: 'PrudhommeWTF/Foyer-App', envOverride: 'FOYER_GITHUB_REPO',
  },
  {
    key: 'envGithubToken',
    type: 'secret', scope: 'deploiement', section: 'serveur', module: 'Exploitation',
    label: 'Jeton GitHub',
    desc: 'Facultatif, et seulement utile pour un dépôt privé ou pour ne pas se faire limiter par GitHub lors des vérifications de version.',
    default: '', envOverride: 'FOYER_GITHUB_TOKEN',
  },
  {
    key: 'envVapidPrivate',
    type: 'secret', scope: 'deploiement', section: 'serveur', module: 'Notifications',
    label: 'Clé privée des rappels (VAPID)',
    desc: 'Sans elle, une paire est engendrée au premier démarrage et gardée en base. En changer invalide tous les appareils déjà abonnés aux rappels.',
    default: '', envOverride: 'FOYER_VAPID_PRIVATE',
  },
] as const satisfies readonly SettingDecl[];

/**
 * Le registre vu comme une simple liste de déclarations.
 *
 * `REGISTRY` porte les types littéraux de chaque entrée, ce qui donne les clés
 * et les types de valeurs au compilateur. Tout ce qui **parcourt** le registre
 * (la page, le serveur, la documentation) passe par `ALL` : sinon un champ
 * facultatif absent d'une entrée ferait échouer la compilation de la boucle.
 */
export const ALL: readonly SettingDecl[] = REGISTRY;

type Decl = (typeof REGISTRY)[number];
type ValueOfType<T> = T extends 'bool' ? boolean : T extends 'int' ? number : string;
type AllValues = { [D in Decl as D['key']]: ValueOfType<D['type']> };

/**
 * Les clés qu'on peut lire avec `setting()`. Une faute de frappe ne compile pas,
 * et une clé de déploiement non plus : elle ne vit pas dans le document, elle
 * vient de l'environnement du serveur.
 */
export type SettingKey = Extract<Decl, { scope: 'foyer' | 'personnel' }>['key'];
export type SettingValue<K extends SettingKey> = AllValues[K];

/** Les réglages fixés par la machine, affichés en lecture seule. */
export const DEPLOYMENT: readonly SettingDecl[] = ALL.filter((d) => d.scope === 'deploiement');

/** La forme de `HouseholdState.settings` : tout est facultatif, le défaut prend le relais. */
export type HouseholdSettings = Partial<Pick<AllValues, Extract<Decl, { scope: 'foyer' }>['key']>>;

/**
 * Les préférences d'un membre, rangées sous `HouseholdState.prefs[idDuMembre]`.
 *
 * Elles vivent dans le document plutôt que dans une table à part : une archive
 * du dossier de données reste une sauvegarde complète, et le serveur n'a qu'une
 * règle à tenir, celle qui existe déjà pour les membres (on ne modifie que la
 * sienne).
 */
export type MemberPrefs = Partial<Pick<AllValues, Extract<Decl, { scope: 'personnel' }>['key']>>;

const BY_KEY: Record<string, SettingDecl> = Object.fromEntries(ALL.map((d) => [d.key, d]));

/** La déclaration d'une clé, ou `undefined` si elle n'existe pas. */
export function declOf(key: string): SettingDecl | undefined { return BY_KEY[key]; }

/** Les paramètres d'une section, dans l'ordre du registre. */
export function sectionSettings(section: string): SettingDecl[] {
  return ALL.filter((d) => d.section === section);
}

/** Ce que porte un document neuf : les valeurs par défaut des réglages du foyer. */
export function householdDefaults(): HouseholdSettings {
  return Object.fromEntries(
    ALL.filter((d) => d.scope === 'foyer').map((d) => [d.key, d.default]),
  ) as HouseholdSettings;
}

/** Les valeurs par défaut des préférences d'un membre. */
export function memberDefaults(): MemberPrefs {
  return Object.fromEntries(
    ALL.filter((d) => d.scope === 'personnel').map((d) => [d.key, d.default]),
  ) as MemberPrefs;
}

/** Ce que `setting()` sait lire. Un document du foyer en est un. */
export interface SettingsSource {
  settings?: Readonly<Record<string, unknown>> | null;
  prefs?: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>> | null;
}

/** Là où la valeur d'une clé est rangée, selon sa portée. */
function bucket(d: SettingDecl, src: SettingsSource | null | undefined, memberId?: string | null): Readonly<Record<string, unknown>> {
  if (d.scope !== 'personnel') return src?.settings || {};
  return (memberId && src?.prefs ? src.prefs[memberId] : undefined) || {};
}

export type Checked = { ok: true; value: boolean | number | string } | { ok: false; error: string };

/**
 * Contrôle d'une valeur pour une déclaration donnée.
 *
 * Le message est destiné à être affiché tel quel à côté du champ : il dit ce
 * qui est attendu, jamais « valeur invalide ». Une valeur refusée n'est pas
 * remplacée en silence, l'appelant décide.
 */
export function checkValue(d: SettingDecl, raw: unknown): Checked {
  switch (d.type) {
    case 'bool':
      if (typeof raw !== 'boolean') return { ok: false, error: 'Attendu : activé ou désactivé.' };
      return { ok: true, value: raw };
    case 'int': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: 'Attendu : un nombre entier.' };
      const min = d.min ?? Number.NEGATIVE_INFINITY;
      const max = d.max ?? Number.POSITIVE_INFINITY;
      if (n < min || n > max) return { ok: false, error: `Attendu : un nombre entre ${d.min} et ${d.max}.` };
      return { ok: true, value: n };
    }
    case 'enum': {
      if (typeof raw !== 'string') return { ok: false, error: 'Attendu : une des valeurs proposées.' };
      const ok = (d.options || []).some((o) => o.value === raw);
      if (!ok) return { ok: false, error: `« ${raw} » n’est pas une valeur proposée pour ce réglage.` };
      return { ok: true, value: raw };
    }
    case 'time': {
      if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return { ok: false, error: 'Attendu : une heure au format HH:MM, par exemple 08:30.' };
      return { ok: true, value: raw };
    }
    case 'text': {
      if (typeof raw !== 'string') return { ok: false, error: 'Attendu : du texte.' };
      const max = d.maxLength ?? 200;
      if (raw.length > max) return { ok: false, error: `Attendu : ${max} caractères au maximum.` };
      return { ok: true, value: raw };
    }
    case 'secret':
      // Un secret ne se relit ni ne s'écrit d'ici : l'interface dit seulement
      // s'il est posé. Le refuser explicitement évite qu'il finisse un jour dans
      // le document, donc dans un export, donc en clair.
      return { ok: false, error: `« ${d.label} » se change dans la configuration du serveur, jamais depuis l’application.` };
  }
}

/** Contrôle d'une valeur pour une clé du registre. */
export function validate(key: string, raw: unknown): Checked {
  const d = BY_KEY[key];
  if (!d) return { ok: false, error: `Le réglage « ${key} » n’existe pas.` };
  return checkValue(d, raw);
}

/**
 * La valeur d'un paramètre, telle que le code doit la lire.
 *
 * Une valeur absente, d'un type inattendu ou hors bornes rend le défaut : un
 * document ancien, tronqué ou bricolé à la main ne doit jamais rendre
 * l'application inutilisable ni empêcher de revenir en arrière.
 *
 * `memberId` n'est lu que pour les réglages de portée personnelle. Sans lui,
 * une préférence rend son défaut plutôt que celle de quelqu'un d'autre.
 */
export function setting<K extends SettingKey>(key: K, src: SettingsSource | null | undefined, memberId?: string | null): SettingValue<K> {
  const d = BY_KEY[key];
  const raw = bucket(d, src, memberId)[key];
  if (raw === undefined || raw === null) return d.default as SettingValue<K>;
  const checked = checkValue(d, raw);
  return (checked.ok ? checked.value : d.default) as SettingValue<K>;
}
