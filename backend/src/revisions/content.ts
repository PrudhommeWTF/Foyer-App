// Le contenu des exercices du module Révisions : les listes (de mots, pour la
// dictée) qu'un exercice lit par son paramètre `content`. Jamais dans le code.
//
//   - Livré : backend/config/revisions/<exercice>/*.json, chaque fichier
//     portant `{ "listes": [{ "id", "label", "items": [...] }] }`. Un fichier
//     au même nom dans FOYER_DATA_DIR/revisions/<exercice>/ le remplace, un
//     fichier d'un autre nom s'ajoute. Relus quand ils changent.
//   - Du foyer : saisi par un parent (la dictée de la semaine), dans la table
//     rev_content. Identifiant « foyer-<n> ». Une liste retirée est archivée,
//     jamais effacée : un programme ou une session qui la désigne reste lisible.
import fs from 'fs';
import path from 'path';
import { log } from '../log';
import { ContentList, ExerciseContext, LONG_ITEM_MAX, SHORT_ITEM_MAX } from './exercises/contract';
import { foyerLists } from './repo';

const SHIPPED = path.join(__dirname, '..', '..', 'config', 'revisions');

function readDir(dir: string, where: string): Map<string, ContentList[]> {
  const out = new Map<string, ContentList[]>();
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return out; }
  for (const name of names) {
    try {
      const v = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as { listes?: unknown };
      if (!Array.isArray(v.listes)) throw new Error('« listes » doit être une liste');
      const lists: ContentList[] = [];
      for (const l of v.listes as Record<string, unknown>[]) {
        const id = typeof l?.['id'] === 'string' ? l['id'] : '';
        if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id) || id.startsWith('foyer-') || typeof l['label'] !== 'string' || !Array.isArray(l['items'])) {
          log.attention(`Révisions : ${where}/${name}, une liste écartée (id en minuscules et tirets, label et items attendus).`);
          continue;
        }
        lists.push({ id, label: l['label'].slice(0, 80), items: (l['items'] as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 200), source: 'livre' });
      }
      out.set(name, lists);
    } catch (e) {
      log.attention(`Révisions : contenu illisible (${where}/${name}) : ${(e as Error).message}.`);
    }
  }
  return out;
}

const cache = new Map<string, { stamp: string; lists: ContentList[] }>();
const stampOf = (dir: string): string => {
  try { return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => n + ':' + fs.statSync(path.join(dir, n)).mtimeMs).join('|'); } catch { return 'absent'; }
};

/** Les règles d'une liste du foyer, les mêmes à l'écran (routes.ts) et pour l'assistant (mcp/revisions-tools.ts). */
export const LIST_MAX_ITEMS = 200;
export const LIST_LABEL_RULE = 'Le nom de la liste : de 1 à 60 caractères.';
/** La règle des éléments : des mots de 40 caractères, ou des lignes de 160 pour un exercice à lignes (paramètre `lines`). */
export const listItemsRule = (lines = false): string => `Les éléments : de 1 à ${LIST_MAX_ITEMS}, de ${lines ? LONG_ITEM_MAX : SHORT_ITEM_MAX} caractères au plus chacun.`;
/** Le nom d'une liste, ou null s'il ne tient pas la règle. */
export function cleanListLabel(v: unknown): string | null {
  const l = typeof v === 'string' ? v.trim() : '';
  return l && l.length <= 60 ? l : null;
}
/** Les éléments d'une liste, nettoyés (forme NFC, espaces) et sans doublon, ou null s'ils ne tiennent pas la règle. */
export function cleanListItems(v: unknown, lines = false): string[] | null {
  if (!Array.isArray(v)) return null;
  const items = [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.normalize('NFC').trim().replace(/\s+/g, ' ')).filter(Boolean))];
  return items.length && items.length <= LIST_MAX_ITEMS && items.every((x) => x.length <= (lines ? LONG_ITEM_MAX : SHORT_ITEM_MAX)) ? items : null;
}

/** Les listes livrées d'un exercice, surcharge du foyer comprise. */
export function shippedLists(dataDir: string, exercise: string, shippedRoot = SHIPPED): ContentList[] {
  const a = path.join(shippedRoot, exercise), b = path.join(dataDir, 'revisions', exercise);
  const stamp = stampOf(a) + '#' + stampOf(b);
  const key = a + '|' + b;
  const hit = cache.get(key);
  if (hit?.stamp === stamp) return hit.lists;
  const files = readDir(a, 'contenu livré');
  for (const [name, lists] of readDir(b, 'surcharge du contenu')) files.set(name, lists);
  const seen = new Set<string>();
  const lists = [...files.values()].flat().filter((l) => !seen.has(l.id) && seen.add(l.id));
  cache.set(key, { stamp, lists });
  return lists;
}

/** Tout ce qu'un exercice peut lire : les listes livrées, puis celles du foyer (archivées comprises, marquées). */
export function contextFor(dataDir: string, exercise: string): ExerciseContext {
  return { lists: [...shippedLists(dataDir, exercise), ...foyerLists(exercise)] };
}
