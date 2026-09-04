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
export type SettingType = 'bool' | 'int' | 'enum' | 'text' | 'time';

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
  /** Variable d'environnement qui, si elle est posée, l'emporte sur ce réglage. */
  envOverride?: string;
}

export interface SettingSection {
  id: string;
  label: string;
  /** Ce que la section regroupe, affiché sous son titre. */
  desc: string;
}

/** Les sections de la page, dans l'ordre d'affichage. */
export const SECTIONS: readonly SettingSection[] = [
  { id: 'affichage', label: 'Foyer et affichage', desc: 'Ce que voit tout le monde : identité du foyer et thème.' },
  { id: 'calendriers', label: 'Calendriers de référence', desc: 'Vacances scolaires et partage de l’agenda. Plusieurs modules en dépendent.' },
  { id: 'notifications', label: 'Notifications et rappels', desc: 'Ce qui vous interpelle, dans l’application et sur le téléphone.' },
  { id: 'repas', label: 'Repas et cuisine', desc: 'Planning des repas, suggestions et génération des courses.' },
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
    type: 'bool', scope: 'foyer', section: 'affichage', module: 'Affichage',
    label: 'Thème sombre',
    desc: 'Bascule toute l’application en couleurs sombres. Partagé par le foyer : le changer ici change l’affichage de tout le monde.',
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
    type: 'bool', scope: 'foyer', section: 'notifications', module: 'Notifications',
    label: 'Alertes dans l’application',
    desc: 'La cloche en haut de l’écran : agenda du jour, tâches en retard, anniversaires, échéances. Ne coupe pas les rappels envoyés sur le téléphone.',
    default: true,
  },
  {
    key: 'showBreakfast',
    type: 'bool', scope: 'foyer', section: 'repas', module: 'Repas',
    label: 'Afficher le petit-déjeuner',
    desc: 'Ajoute la ligne du matin au planning des repas, et donc à la génération des courses. Les repas déjà saisis sont conservés quand la ligne est masquée.',
    default: false,
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

/** Les clés réellement déclarées. Une faute de frappe ne compile pas. */
export type SettingKey = keyof AllValues & string;
export type SettingValue<K extends SettingKey> = AllValues[K];

/** La forme de `HouseholdState.settings` : tout est facultatif, le défaut prend le relais. */
export type HouseholdSettings = Partial<Pick<AllValues, Extract<Decl, { scope: 'foyer' }>['key']>>;

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

/** Ce que `setting()` sait lire. Un document du foyer en est un. */
export interface SettingsSource { settings?: Readonly<Record<string, unknown>> | null; }

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
 */
export function setting<K extends SettingKey>(key: K, src: SettingsSource | null | undefined): SettingValue<K> {
  const d = BY_KEY[key];
  const raw = src?.settings ? src.settings[key] : undefined;
  if (raw === undefined || raw === null) return d.default as SettingValue<K>;
  const checked = validate(key, raw);
  return (checked.ok ? checked.value : d.default) as SettingValue<K>;
}
