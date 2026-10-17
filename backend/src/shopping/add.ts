// Ajouter des articles à une liste de courses, côté serveur : le chemin commun
// de l'outil d'assistant `courses_ajouter` et de l'entretien (un consommable
// passé sous son seuil). Sans doublon : un article déjà « à prendre » dans la
// liste, au nom près (casse et accents ignorés), n'est pas ajouté une seconde
// fois. L'écriture passe par les opérations de courses, journalisées.
import type { HouseholdState, ShopList } from '../models';
import { applyShoppingOps } from './repo';
import { memoryKey } from './memory';
import { FALLBACK_AISLE_NAMES } from './ops';

const norm = (s: string): string => (s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const genId = (p: string): string => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** La liste principale : la première. C'est elle que l'écran Courses ouvre. */
export const mainShopList = (s: HouseholdState): ShopList | null => (s.shopLists || [])[0] || null;

/** Le rayon de repli (« Non classé »), sinon le premier rayon : un article atterrit toujours quelque part. */
export function fallbackAisleId(s: HouseholdState): string | null {
  return ((s.aisles || []).find((a) => FALLBACK_AISLE_NAMES.includes(a.name)) || (s.aisles || [])[0])?.id ?? null;
}

/**
 * Le rayon d'un article sans rayon donné, de la façon la plus tolérante : celui
 * où le foyer l'a déjà rangé (mémoire des courses), sinon le rayon du type
 * demandé (« entretien » pour un consommable), sinon le repli.
 */
export function aisleForName(s: HouseholdState, name: string, kind?: string): string | null {
  const known = (s.shopMemory || {})[memoryKey({ name })]?.aisleId;
  if (known && (s.aisles || []).some((a) => a.id === known)) return known;
  const typed = kind ? (s.aisles || []).find((a) => a.kind === kind) : undefined;
  return typed?.id ?? fallbackAisleId(s);
}

export interface AddLine { name: string; qty?: string; aisleId: string; }
export interface AddResult { added: string[]; already: string[]; }

/** Ajoute des lignes à une liste, sans doublon. Rend ce qui a été ajouté et ce qui y était déjà. */
export function addShopItems(s: HouseholdState, list: ShopList, lines: AddLine[], meta: { by: string | null; via?: string | null }): AddResult {
  const existing = new Set((s.shop || []).filter((i) => i.listId === list.id && i.state === 'a-prendre').map((i) => norm(i.name)));
  const at = new Date().toISOString();
  const ops: unknown[] = [];
  const added: string[] = [];
  const already: string[] = [];
  for (const l of lines) {
    const name = l.name.trim();
    if (!name) continue;
    if (existing.has(norm(name))) { already.push(name); continue; }
    existing.add(norm(name));
    ops.push({ op: 'add', opId: genId('op'), id: genId('it'), name, qty: (l.qty || '').trim(), aisleId: l.aisleId, listId: list.id, by: meta.by, ...(meta.via ? { via: meta.via } : {}), at });
    added.push(name);
  }
  if (ops.length) applyShoppingOps(ops);
  return { added, already };
}

/** Un article est-il déjà « à prendre » dans la liste principale ? */
export function onMainList(s: HouseholdState, name: string): boolean {
  const list = mainShopList(s);
  return !!list && (s.shop || []).some((i) => i.listId === list.id && i.state === 'a-prendre' && norm(i.name) === norm(name));
}
