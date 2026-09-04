// Accès à la liste de courses dans le document d'état.
//
// Les articles restent dans le même document JSON que le reste du foyer : une
// archive du répertoire de données demeure une sauvegarde complète, il n'y a pas
// une table de plus à connaître. Ce qui change, c'est le chemin d'écriture. Un
// lot d'opérations est lu, appliqué et réécrit dans une seule transaction
// SQLite, donc deux téléphones qui cochent en même temps se sérialisent au lieu
// de s'écraser.
import type { Database } from 'better-sqlite3';
import { docDb, idsOf as ids, initDoc, readDoc, writeDoc } from '../state/doc';
import { ApplyResult, ShopItem, applyOps, reconcile } from './ops';

/** Au-delà, le journal des opérations est élagué : c'est une mémoire courte contre les rejeux, pas un historique. */
const OPS_JOURNAL_MAX = 2000;

export function initShopping(db: Database): void { initDoc(db); }

const items = (doc: Record<string, any>): ShopItem[] => (Array.isArray(doc['shop']) ? doc['shop'] : []);

export interface ShoppingSnapshot { items: ShopItem[]; version: number }

export function getShopping(): ShoppingSnapshot {
  const { doc, version } = readDoc();
  return { items: items(doc), version };
}

export interface ApplyOutcome extends ApplyResult { version: number }

/**
 * Applique un lot et rend l'état résultant. Le lot entier tient dans une
 * transaction : soit tout est écrit, soit rien ne l'est, et jamais un état
 * intermédiaire que l'autre téléphone lirait au milieu.
 */
export function applyShoppingOps(ops: unknown): ApplyOutcome {
  const database = docDb();
  return database.transaction((): ApplyOutcome => {
    const { doc, version } = readDoc();
    const journal = database.prepare('SELECT 1 FROM hh_shop_ops WHERE op_id = ?');
    const result = applyOps(items(doc), ops, {
      aisleIds: ids(doc, 'aisles'),
      listIds: ids(doc, 'shopLists'),
      alreadyApplied: (opId) => !!journal.get(opId),
    });

    // Rien de retenu : ne pas faire tourner le numéro de version pour rien, les
    // autres téléphones se rechargeraient sans raison.
    if (!result.applied.length) return { ...result, version };

    doc['shop'] = result.items;
    const nextVersion = writeDoc(doc);

    const remember = database.prepare('INSERT OR IGNORE INTO hh_shop_ops (op_id) VALUES (?)');
    for (const opId of result.applied) remember.run(opId);
    database.prepare(
      'DELETE FROM hh_shop_ops WHERE op_id NOT IN (SELECT op_id FROM hh_shop_ops ORDER BY applied_at DESC, rowid DESC LIMIT ?)',
    ).run(OPS_JOURNAL_MAX);

    return { ...result, version: nextVersion };
  })();
}

/**
 * Réinjecte la liste du serveur dans un document reçu du client, et rattrape ce
 * que l'édition des rayons et des listes implique pour ses articles.
 *
 * C'est le cœur du dispositif anti-écrasement : le champ `shop` envoyé par un
 * téléphone est ignoré, quel que soit son âge. Un client périmé ne peut donc
 * plus transporter la liste, et aucune coche ne se décoche toute seule.
 */
export function preserveShopping(incoming: Record<string, any>): { movedToFallback: number; dropped: number } {
  const { doc } = readDoc();
  const aisleIds = ids(incoming, 'aisles');
  const listIds = ids(incoming, 'shopLists');

  // Le rayon de repli doit exister dans le document entrant, sinon les articles
  // rescapés atterriraient dans un rayon que l'écran ne sait pas afficher.
  const incomingAisles = Array.isArray(incoming['aisles']) ? incoming['aisles'] : [];
  let fallback = incomingAisles.find((a: any) => a?.name === 'À trier');
  if (!fallback) {
    fallback = { id: 'a-tri', name: 'À trier', color: '#8A7E74', position: incomingAisles.length };
    incomingAisles.push(fallback);
    incoming['aisles'] = incomingAisles;
    aisleIds.add(String(fallback.id));
  }

  const res = reconcile(items(doc), aisleIds, listIds, String(fallback.id));
  incoming['shop'] = res.items;
  return { movedToFallback: res.movedToFallback, dropped: res.dropped };
}
