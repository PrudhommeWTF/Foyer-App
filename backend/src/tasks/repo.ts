// Accès aux tâches dans le document d'état.
//
// Un lot d'opérations est lu, appliqué et réécrit dans une seule transaction
// SQLite, donc deux téléphones qui cochent en même temps se sérialisent au lieu
// de s'écraser. Le journal `hh_task_ops` retient les opérations déjà vues :
// une file hors ligne rejouée n'a aucun effet de plus.
import type { Database } from 'better-sqlite3';
import { docDb, idsOf, initDoc, readDoc, writeDoc } from '../state/doc';
import { ApplyResult, TaskItem, applyOps, reconcile } from './ops';

/** Au-delà, le journal des opérations est élagué : c'est une mémoire courte contre les rejeux, pas un historique. */
const OPS_JOURNAL_MAX = 2000;

export function initTasks(db: Database): void { initDoc(db); }

const items = (doc: Record<string, any>): TaskItem[] => (Array.isArray(doc['tasks']) ? doc['tasks'] : []);

export interface TasksSnapshot { items: TaskItem[]; version: number }

export function getTasks(): TasksSnapshot {
  const { doc, version } = readDoc();
  return { items: items(doc), version };
}

export interface ApplyOutcome extends ApplyResult { version: number }

/**
 * Applique un lot et rend l'état résultant. Le lot entier tient dans une
 * transaction : soit tout est écrit, soit rien ne l'est, et jamais un état
 * intermédiaire que l'autre téléphone lirait au milieu.
 */
export function applyTaskOps(ops: unknown): ApplyOutcome {
  const database = docDb();
  return database.transaction((): ApplyOutcome => {
    const { doc, version } = readDoc();
    const journal = database.prepare('SELECT 1 FROM hh_task_ops WHERE op_id = ?');
    const result = applyOps(items(doc), ops, {
      listIds: idsOf(doc, 'taskLists'),
      memberIds: idsOf(doc, 'members'),
      shopListIds: idsOf(doc, 'shopLists'),
      alreadyApplied: (opId) => !!journal.get(opId),
    });

    // Rien de retenu : ne pas faire tourner le numéro de version pour rien, les
    // autres téléphones se rechargeraient sans raison.
    if (!result.applied.length) return { ...result, version };

    doc['tasks'] = result.items;
    const nextVersion = writeDoc(doc);

    const remember = database.prepare('INSERT OR IGNORE INTO hh_task_ops (op_id) VALUES (?)');
    for (const opId of result.applied) remember.run(opId);
    database.prepare(
      'DELETE FROM hh_task_ops WHERE op_id NOT IN (SELECT op_id FROM hh_task_ops ORDER BY applied_at DESC, rowid DESC LIMIT ?)',
    ).run(OPS_JOURNAL_MAX);

    return { ...result, version: nextVersion };
  })();
}

/**
 * Réinjecte les tâches du serveur dans un document reçu du client, et rattrape
 * ce que l'édition des listes, des membres et des listes de courses implique.
 *
 * C'est le cœur du dispositif anti-écrasement : le champ `tasks` envoyé par un
 * téléphone est ignoré, quel que soit son âge. Un client périmé ne peut donc
 * plus transporter les tâches, et aucune coche ne se décoche toute seule.
 */
export function preserveTasks(incoming: Record<string, any>): { dropped: number; unassigned: number; unlinked: number } {
  const { doc } = readDoc();
  const res = reconcile(items(doc), idsOf(incoming, 'taskLists'), idsOf(incoming, 'members'), idsOf(incoming, 'shopLists'));
  incoming['tasks'] = res.items;
  return { dropped: res.dropped, unassigned: res.unassigned, unlinked: res.unlinked };
}
