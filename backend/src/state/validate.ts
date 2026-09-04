// La forme minimale que doit avoir un document du foyer pour être enregistré.
//
// `PUT /api/state` n'exigeait qu'un objet : `typeof state === 'object'`. Tout le
// reste passait. Un compte connecté pouvait donc écrire quatre mégaoctets de
// structures arbitraires dans le document, remplacer un tableau par un nombre,
// ou poser mille clés inconnues. Ce n'est pas une fuite, c'est une casse : le
// frontend porte toute la logique métier, et il se rend illisible pour toute la
// famille jusqu'à ce que quelqu'un restaure une sauvegarde.
//
// Ce module ne valide pas le contenu métier, seulement la **charpente** : les
// collections sont des tableaux, les tables sont des objets, le nom du foyer est
// du texte, et rien n'est démesuré. Il **refuse explicitement** plutôt que de
// corriger en silence, comme le demande le cahier des charges : une valeur
// remise d'office est une modification que personne n'a demandée et que rien
// n'affiche.
//
// Les clés inconnues sont laissées passer, à dessein : le document a une
// histoire, les migrations en retirent au fil de l'eau, et refuser ce qu'on ne
// connaît pas bloquerait un client d'une version plus récente que le serveur.

/** Les collections du document, avec ce qu'on accepte d'en garder. */
const TABLEAUX: Record<string, number> = {
  members: 100,
  events: 20_000,
  aisles: 200,
  articles: 20_000,
  shopLists: 200,
  shop: 20_000,
  taskLists: 500,
  taskTemplates: 500,
  tasks: 50_000,
  msgs: 20_000,
  contacts: 5_000,
  folders: 500,
  files: 20_000,
  recipes: 10_000,
  sched: 20_000,
};

/** Les tables indexées par clé : un objet, jamais un tableau. */
const TABLES = ['meals', 'stock', 'prefs', 'settings', 'profile'] as const;

/** Le nombre d'entrées qu'une table peut porter. */
const MAX_ENTREES = 50_000;

export class StateInvalide extends Error {}

const estObjetSimple = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Vérifie la charpente du document, ou lève une StateInvalide dont le message
 * nomme le champ fautif : « le document est invalide » n'aide personne à
 * comprendre ce qu'un client a envoyé de travers.
 */
export function validateState(state: unknown): void {
  if (!estObjetSimple(state)) {
    throw new StateInvalide('Le document du foyer doit être un objet.');
  }
  const doc = state as Record<string, unknown>;

  if (doc['familyName'] !== undefined && typeof doc['familyName'] !== 'string') {
    throw new StateInvalide('« familyName » doit être du texte.');
  }
  if (typeof doc['familyName'] === 'string' && doc['familyName'].length > 200) {
    throw new StateInvalide('« familyName » dépasse 200 caractères.');
  }

  for (const [cle, max] of Object.entries(TABLEAUX)) {
    const v = doc[cle];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v)) {
      throw new StateInvalide(`« ${cle} » doit être une liste, reçu ${nomDuType(v)}.`);
    }
    if (v.length > max) {
      throw new StateInvalide(`« ${cle} » contient ${v.length} entrées, au-delà du maximum de ${max}.`);
    }
    // Une collection d'entités ne porte que des fiches. Un nombre ou une chaîne
    // au milieu fait planter l'écran qui la parcourt, sans rien expliquer.
    const mauvais = v.findIndex((e) => !estObjetSimple(e));
    if (mauvais >= 0) {
      throw new StateInvalide(`« ${cle} » : l'entrée ${mauvais + 1} n'est pas une fiche (reçu ${nomDuType(v[mauvais])}).`);
    }
  }

  for (const cle of TABLES) {
    const v = doc[cle];
    if (v === undefined || v === null) continue;
    if (!estObjetSimple(v)) {
      throw new StateInvalide(`« ${cle} » doit être un objet, reçu ${nomDuType(v)}.`);
    }
    if (Object.keys(v as object).length > MAX_ENTREES) {
      throw new StateInvalide(`« ${cle} » contient trop d'entrées (maximum ${MAX_ENTREES}).`);
    }
  }

  // Les identifiants portent les liens entre collections : un identifiant qui
  // n'est pas du texte casse silencieusement chaque rapprochement.
  for (const cle of ['members', 'events', 'tasks', 'recipes', 'contacts', 'files'] as const) {
    const v = doc[cle];
    if (!Array.isArray(v)) continue;
    const mauvais = v.findIndex((e) => {
      const id = (e as Record<string, unknown>)['id'];
      return id !== undefined && typeof id !== 'string';
    });
    if (mauvais >= 0) {
      throw new StateInvalide(`« ${cle} » : l'entrée ${mauvais + 1} a un identifiant qui n'est pas du texte.`);
    }
  }
}

/** Le type reçu, dit en français, pour que le message serve à corriger l'appel. */
function nomDuType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'une liste';
  const t = typeof v;
  return t === 'object' ? 'un objet' : t === 'string' ? 'du texte' : t === 'number' ? 'un nombre' : t === 'boolean' ? 'un booléen' : t;
}
