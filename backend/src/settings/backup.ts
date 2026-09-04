// Export et import de la configuration du foyer.
//
// Ce n'est pas une sauvegarde des données : le dossier de données reste la
// référence, et lui seul emporte tout (voir README). C'est l'outil du cas
// précis : remettre ses réglages après une réinstallation, ou revenir en
// arrière après une modification qui a cassé quelque chose, sans restaurer une
// base entière.
//
// Trois partis pris, chacun pour une raison :
//
//   - Le fichier porte **toutes** les clés, valeurs par défaut comprises, et pas
//     seulement celles que le document range. Sans cela, réimporter ne
//     ramènerait pas l'état d'avant : un réglage changé depuis l'export, mais
//     absent du fichier parce qu'il valait son défaut, resterait changé.
//   - Il est **lisible** : du JSON indenté, clés parlantes, avec le nom du foyer
//     et la date pour qu'on reconnaisse le fichier six mois plus tard.
//   - L'import est **rejouable** et ne casse jamais rien : une clé inconnue, une
//     valeur hors domaine ou un membre disparu sont écartés en le disant, le
//     reste passe. Un fichier venu d'une version plus ancienne s'importe donc,
//     amputé de ce qui n'existe plus, et le rapport le nomme.
import { ALL, SettingDecl, checkValue, declOf } from './registry';
import { Doc, readDoc } from '../state/doc';
import { applySettings, envValueOf, readSettings } from './repo';

export const CONFIG_FORMAT = 'foyer.reglages' as const;
export const CONFIG_VERSION = 1 as const;

export interface ConfigBackup {
  format: typeof CONFIG_FORMAT;
  version: typeof CONFIG_VERSION;
  generatedAt: string;
  /** Le nom du foyer et la version de l'application : pour reconnaître le fichier, jamais réappliqués. */
  household: string;
  appVersion: string;
  /** Les réglages partagés, toutes clés déclarées. */
  settings: Record<string, boolean | number | string>;
  /** Les préférences, par identifiant de membre, avec son prénom pour la lisibilité. */
  prefs: Record<string, { name: string; values: Record<string, boolean | number | string> }>;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

const membersOf = (doc: Doc): { id: string; name: string }[] =>
  (Array.isArray(doc['members']) ? doc['members'] : [])
    .map((m: Record<string, unknown>) => ({ id: String(m?.['id'] ?? ''), name: String(m?.['name'] ?? '') }))
    .filter((m) => m.id);

/** Les valeurs d'une portée pour un membre donné, défauts compris. */
function valuesOf(scope: SettingDecl['scope'], memberId: string | null): Record<string, boolean | number | string> {
  const vue = readSettings(memberId);
  const out: Record<string, boolean | number | string> = {};
  for (const d of ALL) if (d.scope === scope) out[d.key] = vue.values[d.key];
  return out;
}

export function exportConfig(appVersion: string, generatedAt = new Date().toISOString()): ConfigBackup {
  const { doc } = readDoc();
  const prefs: ConfigBackup['prefs'] = {};
  for (const m of membersOf(doc)) prefs[m.id] = { name: m.name, values: valuesOf('personnel', m.id) };
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    generatedAt,
    household: String(doc['familyName'] ?? ''),
    appVersion,
    settings: valuesOf('foyer', null),
    prefs,
  };
}

/** Une ligne écartée à l'import, et pourquoi. Le rapport les montre toutes. */
export interface Ecarte { key: string; member?: string; reason: string; }

export interface ImportReport {
  /** Ce qui a réellement changé. Une valeur déjà en place n'y figure pas. */
  applied: string[];
  ecartes: Ecarte[];
  /** Le foyer et la date que portait le fichier, pour les afficher au retour. */
  household: string;
  generatedAt: string;
}

export class ImportRefused extends Error {}

/**
 * Relit un fichier de configuration et l'applique.
 *
 * L'enveloppe est vérifiée franchement : mieux vaut refuser un fichier qu'on ne
 * comprend pas que d'en appliquer la moitié. Passé ce contrôle, plus rien
 * n'échoue en bloc : ce qui ne peut pas s'appliquer est écarté ligne à ligne.
 */
export function importConfig(raw: unknown, byMemberId: string | null): ImportReport {
  const env = obj(raw);
  if (env['format'] !== CONFIG_FORMAT) {
    throw new ImportRefused('Ce fichier n’est pas une configuration Foyer (« format » attendu : ' + CONFIG_FORMAT + ').');
  }
  if (env['version'] !== CONFIG_VERSION) {
    throw new ImportRefused(`Configuration en version ${String(env['version'])}, cette application lit la version ${CONFIG_VERSION}.`);
  }

  const ecartes: Ecarte[] = [];
  const applied: string[] = [];

  // Réglages du foyer, en un seul lot : les refus de droit y sont impossibles
  // (l'appelant est administrateur), et une valeur qui ne va pas est écartée
  // ici plutôt que de faire échouer le lot entier.
  const foyer: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj(env['settings']))) {
    const d = declOf(key);
    if (!d || d.scope !== 'foyer') { ecartes.push({ key, reason: 'ce réglage n’existe plus dans cette version' }); continue; }
    if (envValueOf(d) !== null) { ecartes.push({ key, reason: `imposé par la variable ${d.envOverride} sur ce serveur` }); continue; }
    const checked = checkValue(d, val);
    if (!checked.ok) { ecartes.push({ key, reason: checked.error }); continue; }
    foyer[key] = checked.value;
  }
  if (Object.keys(foyer).length) {
    const out = applySettings(foyer, byMemberId, true);
    applied.push(...out.changed);
    for (const r of out.refused) ecartes.push({ key: r.key, reason: r.error });
  }

  // Préférences : membre par membre, et seulement pour ceux qui existent encore.
  const connus = new Map(membersOf(readDoc().doc).map((m) => [m.id, m.name]));
  for (const [memberId, bloc] of Object.entries(obj(env['prefs']))) {
    const nom = String(obj(bloc)['name'] ?? memberId);
    if (!connus.has(memberId)) {
      ecartes.push({ key: '(toutes)', member: nom, reason: 'ce membre n’existe plus dans le foyer' });
      continue;
    }
    const miennes: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj(obj(bloc)['values']))) {
      const d = declOf(key);
      if (!d || d.scope !== 'personnel') { ecartes.push({ key, member: nom, reason: 'cette préférence n’existe plus dans cette version' }); continue; }
      const checked = checkValue(d, val);
      if (!checked.ok) { ecartes.push({ key, member: nom, reason: checked.error }); continue; }
      miennes[key] = checked.value;
    }
    if (Object.keys(miennes).length) {
      const out = applySettings(miennes, memberId, true, byMemberId);
      applied.push(...out.changed.map((k) => `${k} (${nom})`));
      for (const r of out.refused) ecartes.push({ key: r.key, member: nom, reason: r.error });
    }
  }

  return {
    applied,
    ecartes,
    household: String(env['household'] ?? ''),
    generatedAt: String(env['generatedAt'] ?? ''),
  };
}
