// Accès aux lieux et à leurs affaires dans le document d'état.
//
// Comme les courses et les tâches, ces deux sous-arbres restent dans le même
// document JSON que le reste du foyer : une archive du répertoire de données
// demeure une sauvegarde complète. Ce qui change, c'est le chemin d'écriture. Un
// lot d'opérations est lu, appliqué et réécrit dans une seule transaction
// SQLite, donc deux téléphones qui notent en même temps se sérialisent au lieu
// de s'écraser. Le journal `hh_place_ops` retient les opérations déjà vues :
// une file hors ligne rejouée n'a aucun effet de plus.
import type { Database } from 'better-sqlite3';
import { docDb, initDoc, readDoc, writeDoc } from '../state/doc';
import { ApplyResult, Place, PlaceItem, applyOps } from './ops';

/** Au-delà, le journal des opérations est élagué : mémoire courte contre les rejeux, pas un historique. */
const OPS_JOURNAL_MAX = 2000;

export function initPlaces(db: Database): void { initDoc(db); }

const places = (doc: Record<string, any>): Place[] => (Array.isArray(doc['places']) ? doc['places'] : []);
const items = (doc: Record<string, any>): PlaceItem[] => (Array.isArray(doc['placeItems']) ? doc['placeItems'] : []);
/** Lieux et affaires d'un document déjà lu, pour partager un seul parse (voir /live). */
export const placesOf = places;
export const placeItemsOf = items;

export interface PlacesSnapshot { places: Place[]; items: PlaceItem[]; version: number }

export function getPlaces(): PlacesSnapshot {
  const { doc, version } = readDoc();
  return { places: places(doc), items: items(doc), version };
}

export interface ApplyOutcome extends ApplyResult { version: number }

/**
 * Applique un lot et rend l'état résultant. Le lot entier tient dans une
 * transaction : soit tout est écrit, soit rien ne l'est, et jamais un état
 * intermédiaire que l'autre téléphone lirait au milieu.
 */
export function applyPlaceOps(ops: unknown): ApplyOutcome {
  const database = docDb();
  return database.transaction((): ApplyOutcome => {
    const { doc, version } = readDoc();
    const journal = database.prepare('SELECT 1 FROM hh_place_ops WHERE op_id = ?');
    const result = applyOps(places(doc), items(doc), ops, {
      alreadyApplied: (opId) => !!journal.get(opId),
    });

    // Rien de retenu : ne pas faire tourner le numéro de version pour rien, les
    // autres téléphones se rechargeraient sans raison.
    if (!result.applied.length) return { ...result, version };

    doc['places'] = result.places;
    doc['placeItems'] = result.items;
    const nextVersion = writeDoc(doc);

    const remember = database.prepare('INSERT OR IGNORE INTO hh_place_ops (op_id) VALUES (?)');
    for (const opId of result.applied) remember.run(opId);
    database.prepare(
      'DELETE FROM hh_place_ops WHERE op_id NOT IN (SELECT op_id FROM hh_place_ops ORDER BY applied_at DESC, rowid DESC LIMIT ?)',
    ).run(OPS_JOURNAL_MAX);

    return { ...result, version: nextVersion };
  })();
}

/**
 * Réinjecte les lieux et leurs affaires du serveur dans un document reçu du
 * client : le champ `places` comme `placeItems` envoyés par un téléphone sont
 * ignorés, quel que soit leur âge. Un client périmé ne peut donc pas les
 * transporter, et aucun geste ne s'annule tout seul.
 *
 * Rien à rattraper ici, contrairement aux courses : lieux et affaires ne citent
 * aucune autre collection du document, et une suppression de lieu emporte déjà
 * ses affaires côté opérations.
 */
export function preservePlaces(incoming: Record<string, any>, current?: Record<string, any>): void {
  // L'appelant a souvent déjà le document du serveur en main : le réutiliser
  // plutôt que de le reparser.
  const doc = current ?? readDoc().doc;
  incoming['places'] = places(doc);
  incoming['placeItems'] = items(doc);
}
