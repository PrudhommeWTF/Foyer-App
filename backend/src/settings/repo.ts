// Écriture des réglages du foyer, clé par clé.
//
// Un réglage ne voyage plus dans l'enregistrement du document entier. Deux
// administrateurs qui changent deux réglages différents à la même seconde ne
// s'écrasent donc pas : chacun n'écrit que sa clé, dans une transaction, comme
// les courses et les tâches le font déjà pour la même raison (voir
// shopping/ops.ts). C'est ce qui rend la modification simultanée sans perte.
//
// Toute écriture est journalisée dans `hh_settings_log` : à deux
// administrateurs, savoir qui a changé quoi évite des discussions inutiles.
import { Doc, docDb, readDoc, writeDoc } from '../state/doc';
import { ALL, SettingDecl, checkValue, declOf } from './registry';

/** Les réglages tels qu'ils sont stockés, valeurs par défaut comprises. */
export interface SettingsView {
  /** La valeur effective de chaque clé déclarée pour ce membre, défaut inclus. */
  values: Record<string, boolean | number | string>;
  /** Les clés que le document porte réellement : le reste vient du défaut. */
  stored: string[];
  version: number;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
const settingsOf = (doc: Doc): Record<string, unknown> => obj(doc['settings']);
const prefsOf = (doc: Doc, memberId: string | null): Record<string, unknown> =>
  (memberId ? obj(obj(doc['prefs'])[memberId]) : {});

/** Là où une clé est rangée dans le document, selon sa portée. */
const bucketOf = (doc: Doc, d: SettingDecl, memberId: string | null): Record<string, unknown> =>
  (d.scope === 'personnel' ? prefsOf(doc, memberId) : settingsOf(doc));

/** La valeur effective d'une déclaration : la sienne, ou le défaut. */
function effective(d: SettingDecl, stored: Record<string, unknown>): boolean | number | string {
  const raw = stored[d.key];
  if (raw === undefined || raw === null) return d.default;
  const checked = checkValue(d, raw);
  return checked.ok ? checked.value : d.default;
}

/**
 * Les valeurs telles que **ce membre** les voit : les réglages du foyer, plus
 * ses préférences à lui. Sans membre, les préférences valent leur défaut, ce
 * qui est le cas d'un compte sans fiche de membre.
 */
export function readSettings(memberId: string | null = null): SettingsView {
  const { doc, version } = readDoc();
  const values: Record<string, boolean | number | string> = {};
  const stored: string[] = [];
  for (const d of ALL) {
    // Les réglages de déploiement ne vivent pas dans le document : ils sont
    // servis à part (voir deploymentView). Les mêler ici les ferait passer pour
    // des valeurs du foyer, vides de surcroît.
    if (d.scope === 'deploiement') continue;
    const bucket = bucketOf(doc, d, memberId);
    values[d.key] = effective(d, bucket);
    if (bucket[d.key] !== undefined) stored.push(d.key);
  }
  return { values, stored, version };
}

/**
 * Une clé refusée, et la raison à afficher à côté du champ.
 *
 * `kind` distingue « vous n'avez pas le droit » de « cette valeur ne va pas » :
 * ce n'est pas le même geste pour la personne en face, et l'écran n'a pas à le
 * deviner en lisant le message.
 */
export interface Refus { key: string; error: string; kind: 'droit' | 'valeur'; }

export interface ApplyOutcome {
  /** Les clés réellement écrites. Une valeur identique à l'existante n'y figure pas. */
  changed: string[];
  refused: Refus[];
  values: Record<string, boolean | number | string>;
  version: number;
}

/**
 * Applique un lot de réglages.
 *
 * Rien n'est écrit à moitié : les valeurs sont toutes contrôlées avant la
 * transaction, et une seule clé refusée fait refuser le lot. Un réglage mal
 * choisi ne doit jamais laisser l'application dans un état que personne
 * n'a voulu.
 */
export function applySettings(
  changes: Record<string, unknown>,
  memberId: string | null,
  isAdmin: boolean,
  /**
   * Qui inscrire au journal. Vaut `memberId` sauf à l'import d'une
   * configuration, où l'administrateur restaure les préférences d'un autre : le
   * journal doit nommer celui qui a fait le geste, pas celui qui le subit.
   */
  author: string | null = memberId,
): ApplyOutcome {
  const refused: Refus[] = [];
  const retenues: { decl: SettingDecl; value: boolean | number | string }[] = [];
  for (const [key, raw] of Object.entries(changes || {})) {
    const d = declOf(key);
    if (!d) { refused.push({ key, kind: 'valeur', error: `Le réglage « ${key} » n’existe pas.` }); continue; }
    if (d.scope === 'deploiement') {
      refused.push({ key, kind: 'droit', error: `« ${d.label} » est fixé par le serveur et ne se change pas ici.` });
      continue;
    }
    // Un réglage du foyer engage tout le monde : administrateur uniquement. Une
    // préférence n'engage que soi, et n'a donc rien à demander à personne.
    if (d.scope === 'foyer' && !isAdmin) {
      refused.push({ key, kind: 'droit', error: `« ${d.label} » est un réglage du foyer : seul un administrateur peut le modifier.` });
      continue;
    }
    if (d.scope === 'personnel' && !memberId) {
      refused.push({ key, kind: 'droit', error: `« ${d.label} » est une préférence personnelle : votre compte n’est rattaché à aucun membre du foyer.` });
      continue;
    }
    // Écrire un réglage que l'environnement écrase reviendrait à ranger dans le
    // document une valeur sans effet : exactement le réglage auquel on cesse de
    // croire. On refuse, en nommant la variable et le geste.
    const impose = envValueOf(d);
    if (impose !== null) {
      refused.push({ key, kind: 'droit', error: `« ${d.label} » est imposé par la variable d’environnement ${d.envOverride} (« ${process.env[d.envOverride!]} »). Changez-la dans la configuration du service, puis redémarrez.` });
      continue;
    }
    const checked = checkValue(d, raw);
    if (!checked.ok) { refused.push({ key, kind: 'valeur', error: checked.error }); continue; }
    retenues.push({ decl: d, value: checked.value });
  }
  if (refused.length) {
    const vue = readSettings(memberId);
    return { changed: [], refused, values: vue.values, version: vue.version };
  }

  const database = docDb();
  return database.transaction((): ApplyOutcome => {
    const { doc, version } = readDoc();
    const journal = database.prepare(
      'INSERT INTO hh_settings_log (key, before_json, after_json, member_id) VALUES (?, ?, ?, ?)',
    );
    const settings = settingsOf(doc);
    const prefs = obj(doc['prefs']);
    const miennes = obj(memberId ? prefs[memberId] : undefined);
    const changed: string[] = [];
    for (const { decl, value } of retenues) {
      const bucket = decl.scope === 'personnel' ? miennes : settings;
      const avant = effective(decl, bucket);
      if (avant === value && bucket[decl.key] !== undefined) continue; // rien à écrire, rien à journaliser
      journal.run(decl.key, JSON.stringify(avant), JSON.stringify(value), author);
      bucket[decl.key] = value;
      changed.push(decl.key);
    }
    if (!changed.length) {
      const vue = readSettings(memberId);
      return { changed, refused, values: vue.values, version };
    }
    doc['settings'] = settings;
    if (memberId) { prefs[memberId] = miennes; doc['prefs'] = prefs; }
    const nouvelle = writeDoc(doc);
    return { changed, refused, values: readSettings(memberId).values, version: nouvelle };
  })();
}

export interface LogLine {
  id: number;
  key: string;
  /** Le libellé du réglage au moment de la lecture. Une clé retirée du registre garde sa clé brute. */
  label: string;
  before: boolean | number | string | null;
  after: boolean | number | string;
  memberId: string | null;
  at: string;
}

interface LogRow { id: number; key: string; before_json: string | null; after_json: string; member_id: string | null; at: string; }

const parse = (json: string | null): boolean | number | string | null => {
  if (json === null) return null;
  try { return JSON.parse(json); } catch { return json; }
};

/** Les dernières modifications, la plus récente d'abord. */
export function settingsLog(limit = 50): LogLine[] {
  const rows = docDb().prepare('SELECT * FROM hh_settings_log ORDER BY id DESC LIMIT ?').all(limit) as LogRow[];
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: declOf(r.key)?.label || r.key,
    before: parse(r.before_json),
    after: parse(r.after_json) as boolean | number | string,
    memberId: r.member_id,
    at: r.at,
  }));
}

/**
 * Un enregistrement du document entier essaie-t-il de changer un réglage ?
 *
 * Les réglages ne s'écrivent plus par `PUT /api/state` : ce garde le détecte
 * pour le refuser à un non-administrateur, plutôt que de laisser une porte
 * ouverte que masquer un onglet ne ferme pas.
 *
 * La comparaison porte sur les clés **déclarées** uniquement. Un document
 * ancien qui traîne encore une clé retirée du registre (le format de date, par
 * exemple) ne doit pas passer pour une tentative de modification et faire
 * refuser toutes ses sauvegardes.
 */
export function settingsChanged(avant: unknown, apres: unknown): boolean {
  const a = obj(avant);
  const b = obj(apres);
  return ALL.filter((d) => d.scope === 'foyer').some((d) => JSON.stringify(a[d.key]) !== JSON.stringify(b[d.key]));
}

/**
 * Un enregistrement du document essaie-t-il de changer les préférences de
 * **quelqu'un d'autre** ?
 *
 * Même règle que pour la fiche de membre : chacun n'écrit que la sienne. Sans
 * ce garde, l'écran des Paramètres serait protégé et le document, non.
 */
export function foreignPrefsChanged(avant: unknown, apres: unknown, memberId: string | null): boolean {
  const a = obj(avant);
  const b = obj(apres);
  const ids = new Set([...Object.keys(a), ...Object.keys(b)].filter((id) => id !== memberId));
  return [...ids].some((id) => JSON.stringify(a[id]) !== JSON.stringify(b[id]));
}


/**
 * Ce que l'environnement impose pour cette déclaration, ou `null` quand il ne
 * dit rien.
 *
 * Une variable **vide** (`FOYER_ALLOW_SIGNUP=`) compte pour absente : on la pose
 * pour imposer une valeur, pas pour imposer le vide. Pour un booléen, les
 * formes qu'un administrateur écrit réellement sont acceptées des deux côtés
 * (`false`, `FALSE`, `0`, `no`, `off` contre `true`, `1`, `yes`, `on`), parce
 * qu'un fichier d'environnement se relit à l'oeil et se tape à la main.
 */
export function envValueOf(d: SettingDecl, env: NodeJS.ProcessEnv = process.env): boolean | number | string | null {
  const brut = d.envOverride ? env[d.envOverride] : undefined;
  if (brut === undefined || brut === '') return null;
  if (d.type === 'secret') return brut;
  const lu = d.type === 'bool' ? !/^(0|false|no|off)$/i.test(brut) : brut;
  const checked = checkValue(d, lu);
  return checked.ok ? checked.value : null;
}

/**
 * La valeur effective d'un réglage du foyer, **variable d'environnement
 * comprise**.
 *
 * C'est le seul endroit qui applique la règle de priorité, et c'est pour cela
 * qu'elle ne peut pas diverger entre le code qui décide et l'interface qui
 * explique : `GET /api/settings` lit la même chose pour dire quel champ griser.
 */
export function effectiveSetting(key: string, env: NodeJS.ProcessEnv = process.env): boolean | number | string {
  const d = declOf(key);
  if (!d) throw new Error(`Réglage inconnu : ${key}`);
  const impose = envValueOf(d, env);
  return impose !== null ? impose : readSettings().values[key];
}

/**
 * Ce que l'environnement impose réellement, clé de réglage vers valeur lue.
 * Sert à griser le champ **en le disant**, jamais à griser en silence.
 */
export function envOverrides(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of ALL) {
    if (d.scope !== 'foyer') continue;
    const brut = d.envOverride ? env[d.envOverride] : undefined;
    if (brut !== undefined && brut !== '') out[d.key] = brut;
  }
  return out;
}

/** Les réglages de déploiement, tels qu'ils s'appliquent. Un secret n'est jamais rendu. */
export function deploymentView(env: NodeJS.ProcessEnv = process.env): { key: string; value: string; set: boolean }[] {
  return ALL.filter((d) => d.scope === 'deploiement').map((d) => {
    const pose = envValueOf(d, env) !== null;
    return {
      key: d.key,
      // Un secret ne sort jamais d'ici : seul son état est une information.
      value: d.type === 'secret' ? '' : (pose ? String(envValueOf(d, env)) : String(d.default)),
      set: pose,
    };
  });
}
