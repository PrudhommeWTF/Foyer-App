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
  /** La valeur effective de chaque clé déclarée, défaut inclus. */
  values: Record<string, boolean | number | string>;
  /** Les clés que le document porte réellement : le reste vient du défaut. */
  stored: string[];
  version: number;
}

const settingsOf = (doc: Doc): Record<string, unknown> =>
  (doc['settings'] && typeof doc['settings'] === 'object' ? doc['settings'] as Record<string, unknown> : {});

/** La valeur effective d'une déclaration dans un document : la sienne, ou le défaut. */
function effective(d: SettingDecl, stored: Record<string, unknown>): boolean | number | string {
  const raw = stored[d.key];
  if (raw === undefined || raw === null) return d.default;
  const checked = checkValue(d, raw);
  return checked.ok ? checked.value : d.default;
}

export function readSettings(): SettingsView {
  const { doc, version } = readDoc();
  const stored = settingsOf(doc);
  const values: Record<string, boolean | number | string> = {};
  for (const d of ALL) values[d.key] = effective(d, stored);
  return { values, stored: ALL.map((d) => d.key).filter((k) => stored[k] !== undefined), version };
}

/** Une clé refusée, et la raison à afficher à côté du champ. */
export interface Refus { key: string; error: string; }

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
export function applySettings(changes: Record<string, unknown>, memberId: string | null): ApplyOutcome {
  const refused: Refus[] = [];
  const retenues: { key: string; value: boolean | number | string }[] = [];
  for (const [key, raw] of Object.entries(changes || {})) {
    const d = declOf(key);
    if (!d) { refused.push({ key, error: `Le réglage « ${key} » n’existe pas.` }); continue; }
    if (d.scope !== 'foyer') { refused.push({ key, error: `Le réglage « ${d.label} » ne se change pas ici.` }); continue; }
    const checked = checkValue(d, raw);
    if (!checked.ok) { refused.push({ key, error: checked.error }); continue; }
    retenues.push({ key, value: checked.value });
  }
  if (refused.length) return { changed: [], refused, values: readSettings().values, version: readSettings().version };

  const database = docDb();
  return database.transaction((): ApplyOutcome => {
    const { doc, version } = readDoc();
    const stored = settingsOf(doc);
    const journal = database.prepare(
      'INSERT INTO hh_settings_log (key, before_json, after_json, member_id) VALUES (?, ?, ?, ?)',
    );
    const changed: string[] = [];
    for (const { key, value } of retenues) {
      const avant = effective(declOf(key)!, stored);
      if (avant === value && stored[key] !== undefined) continue; // rien à écrire, rien à journaliser
      journal.run(key, JSON.stringify(avant), JSON.stringify(value), memberId);
      stored[key] = value;
      changed.push(key);
    }
    if (!changed.length) return { changed, refused, values: readSettings().values, version };
    doc['settings'] = stored;
    return { changed, refused, values: readSettings().values, version: writeDoc(doc) };
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
  const a = (avant && typeof avant === 'object' ? avant : {}) as Record<string, unknown>;
  const b = (apres && typeof apres === 'object' ? apres : {}) as Record<string, unknown>;
  return ALL.some((d) => JSON.stringify(a[d.key]) !== JSON.stringify(b[d.key]));
}
