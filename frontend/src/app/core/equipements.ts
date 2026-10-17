// Le noyau pur de l'écran Équipements : recherche, regroupement par pièce,
// saisie de la fiche. Sans Angular, pour être éprouvé par les tests.
import type { Room } from './models';
import type { EqpFields, EqpItem } from './equipements.api';
import type { WarrantyState } from './warranty';
import type { DayExtra } from './agenda';
import { CAL_KINDS } from './constants';

/** Minuscules, sans accents ni espaces : « ab 12 CD » trouve « AB12cd ». Les tirets comptent. Même règle que le serveur. */
export const eqpNorm = (s: string): string => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');

/** Désignation, marque, modèle, marque et modèle ensemble, numéro de série (absent pour un enfant). */
export function eqpMatches(it: EqpItem, q: string): boolean {
  const n = eqpNorm(q); if (!n) return true;
  return [it.name, it.brand, it.model, it.brand + it.model, it.serial || ''].some((h) => eqpNorm(h).includes(n));
}

export interface EqpFilter { q: string; room: string; garantie: WarrantyState | ''; }

/** Les fiches filtrées. `room` : '' pour toutes, 'none' pour celles sans pièce (ou dont la pièce a été supprimée). */
export function filterItems(items: EqpItem[], f: EqpFilter, rooms: Room[]): EqpItem[] {
  const known = new Set(rooms.map((r) => r.id));
  return items.filter((it) =>
    (!f.room || (f.room === 'none' ? !it.roomId || !known.has(it.roomId) : it.roomId === f.room))
    && (!f.garantie || it.warranty.state === f.garantie)
    && eqpMatches(it, f.q));
}

export interface RoomGroup { id: string; name: string; items: EqpItem[]; }

/** Par pièce, dans l'ordre des pièces, puis « Sans pièce ». Les pièces vides ne s'affichent pas. */
export function groupByRoom(items: EqpItem[], rooms: Room[]): RoomGroup[] {
  const groups: RoomGroup[] = rooms.map((r) => ({ id: r.id, name: r.name, items: [] }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const none: RoomGroup = { id: 'none', name: 'Sans pièce', items: [] };
  for (const it of items) (it.roomId && byId.get(it.roomId) || none).items.push(it);
  return [...groups, none].filter((g) => g.items.length);
}

/** La couleur de la pastille de garantie. */
export const WARRANTY_TONE: Record<WarrantyState, { bg: string; fg: string }> = {
  sous_garantie: { bg: '#E4F0E1', fg: '#3F7A3A' },
  expire_bientot: { bg: '#FDEBD3', fg: '#A0590D' },
  hors_garantie: { bg: 'var(--soft2)', fg: 'var(--ink3)' },
  inconnue: { bg: 'var(--soft)', fg: 'var(--ink3)' },
};

/**
 * Les repères d'agenda : au dernier jour couvert de chaque garantie encore en
 * cours, pour les appareils toujours là (en service ou en panne). Une garantie
 * inconnue ou déjà finie ne pose rien : l'agenda regarde devant.
 */
export function warrantyDayExtras(items: EqpItem[]): Record<string, DayExtra[]> {
  const out: Record<string, DayExtra[]> = {};
  for (const it of items) {
    const w = it.warranty;
    if (!w.until || (w.state !== 'sous_garantie' && w.state !== 'expire_bientot')) continue;
    if (it.archivedAt || (it.status !== 'en_service' && it.status !== 'en_panne')) continue;
    (out[w.until] ??= []).push({ kind: 'garantie', label: 'Fin de garantie', color: CAL_KINDS['garantie'].color, sub: it.name });
  }
  return out;
}

/**
 * La ligne de la tuile d'accueil : ce qui demande d'agir (appareils en panne,
 * garanties qui expirent dans le délai d'alerte), sinon le simple compte.
 */
export function homeLine(items: EqpItem[], alertDays: number): string {
  const live = items.filter((i) => !i.archivedAt);
  const panne = live.filter((i) => i.status === 'en_panne').length;
  const expire = live.filter((i) => i.warranty.state === 'expire_bientot' && (i.status === 'en_service' || i.status === 'en_panne')).length;
  const parts = [
    panne ? `${panne} appareil${panne > 1 ? 's' : ''} en panne` : '',
    expire ? `${expire} garantie${expire > 1 ? 's expirent' : ' expire'} dans les ${alertDays} jours` : '',
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return live.length ? `${live.length} fiche${live.length > 1 ? 's' : ''}, rien à signaler` : 'Aucune fiche';
}

/** Les pièces proposées quand le foyer n'en a encore aucune. */
export const STARTER_ROOM_NAMES = ['Cuisine', 'Salon', 'Salle de bain', 'Chambre 1', 'Chambre 2', 'Bureau', 'Buanderie', 'Garage', 'Cave', 'Extérieur'];

/** 54999 → « 549,99 € ». */
export const fmtCents = (c: number | null | undefined): string =>
  c == null ? '' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(c / 100);

/** Ce que le formulaire manipule : des chaînes, comme les champs. */
export interface ItemDraft {
  name: string; room: string; category: EqpItem['category']; brand: string; model: string; serial: string;
  purchasedOn: string; price: string; vendor: string; condition: EqpItem['condition'];
  months: string; until: string; warrantyNote: string; notes: string; status: EqpItem['status']; asset: string;
}

export function draftOf(it: EqpItem | null, room = ''): ItemDraft {
  return {
    name: it?.name ?? '', room: it?.roomId ?? room, category: it?.category ?? 'electromenager',
    brand: it?.brand ?? '', model: it?.model ?? '', serial: it?.serial ?? '',
    purchasedOn: it?.purchasedOn ?? '', price: it?.purchasePrice != null ? (it.purchasePrice / 100).toFixed(2).replace('.', ',') : '',
    vendor: it?.vendor ?? '', condition: it?.condition ?? 'neuf',
    months: it?.warrantyMonths != null ? String(it.warrantyMonths) : '', until: it?.warrantyUntil ?? '',
    warrantyNote: it?.warrantyNote ?? '', notes: it?.notes ?? '', status: it?.status ?? 'en_service',
    asset: it?.assetId != null ? String(it.assetId) : '',
  };
}

/** Une durée saisie : entier de 0 à 240, vide = pas de durée, autre chose = invalide. */
export function parseMonths(s: string): number | null | 'invalide' {
  const t = s.trim(); if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n <= 240 ? n : 'invalide';
}

function rawFields(d: ItemDraft): EqpFields {
  return {
    name: d.name.trim(), room_id: d.room || null, category: d.category, brand: d.brand.trim(), model: d.model.trim(),
    purchased_on: d.purchasedOn || null, condition: d.condition,
    warranty_months: parseMonths(d.months) as number | null, warranty_until: d.until || null,
    warranty_note: d.warrantyNote.trim(), notes: d.notes.trim(), status: d.status,
    serial: d.serial.trim(), purchase_price: d.price.trim() || null, vendor: d.vendor.trim(), asset_id: d.asset ? Number(d.asset) : null,
  };
}

/**
 * Le corps à envoyer : à la création tout ce qui est rempli, en modification
 * seulement ce qui a changé (le formulaire est réservé aux adultes). La durée
 * doit avoir été vérifiée (`parseMonths`) avant.
 */
export function fieldsOf(d: ItemDraft, before: ItemDraft | null): EqpFields {
  const all = rawFields(d) as Record<string, unknown>;
  if (!before) return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== '' && v !== null)) as EqpFields;
  const old = rawFields(before) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(all).filter(([k, v]) => old[k] !== v)) as EqpFields;
}
