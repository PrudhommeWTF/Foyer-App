// Le catalogue des gestes d'entretien : ce que « Nouveau geste » propose de
// choisir, jamais imposé (un geste choisi est une copie, modifiable).
//
// Rien en dur dans le code : le catalogue livré est un fichier JSON
// (backend/config/entretien-catalogue.json), et un foyer l'adapte par un
// fichier du même nom dans FOYER_DATA_DIR, **fusionné** par identifiant :
// une entrée de même `id` remplace, une nouvelle s'ajoute, `"retire": true`
// masque. Le fichier de surcharge est relu dès qu'il change, sans redémarrer
// le service.
//
// Une entrée mal formée est écartée et nommée au journal, les autres restent ;
// un fichier illisible laisse le catalogue livré. Le catalogue est une aide à
// la saisie : il ne doit jamais empêcher l'application de démarrer.
import fs from 'fs';
import path from 'path';
import { log } from '../log';
import { isSeasonDay } from '../tasks/recurrence';

/** `season` (MM-JJ à MM-JJ) : la saison d'un geste répété, ou la fenêtre annuelle d'un geste à date fixe (le formulaire en fait l'échéance et la souplesse). */
export interface CatalogueRec { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; every: number; base: 'due' | 'done'; grace?: number; season?: { from: string; to: string }; }
export interface CatalogueArticle { nom: string; unite: string; use: number; seuil: number; }
export interface CatalogueEntry {
  id: string; titre: string; howto?: string;
  /** Regroupe la liste de choix : « Cuisine », « Eau », « Sécurité »… */
  famille: string;
  /** La pièce suggérée, par son nom. */
  piece?: string;
  rec: CatalogueRec;
  /** Le consommable éventuel : ce qui entre dans la liste de courses. */
  article?: CatalogueArticle;
}
export interface Catalogue { gestes: CatalogueEntry[]; }

export const CATALOGUE_FILE = 'entretien-catalogue.json';
const SHIPPED = path.join(__dirname, '..', '..', 'config', CATALOGUE_FILE);

const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Une entrée telle qu'on la sert, ou la raison de l'écarter. */
export function readEntry(raw: unknown): { entry: CatalogueEntry } | { reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'entrée qui n’est pas un objet' };
  const o = raw as Record<string, unknown>;
  const id = text(o['id'], 80);
  if (!/^[a-z0-9-]+$/.test(id)) return { reason: `identifiant « ${String(o['id'] ?? '')} » invalide (minuscules, chiffres et tirets)` };
  const titre = text(o['titre'], 300);
  if (!titre) return { reason: `« ${id} » : titre vide` };
  const r = (o['rec'] ?? {}) as Record<string, unknown>;
  const every = int(r['every'], 1, 99);
  if (!FREQS.includes(String(r['freq'])) || every === null || (r['base'] !== 'due' && r['base'] !== 'done')) {
    return { reason: `« ${id} » : fréquence illisible (freq daily/weekly/monthly/yearly, every 1 à 99, base due/done)` };
  }
  const rec: CatalogueRec = { freq: r['freq'] as CatalogueRec['freq'], every, base: r['base'] };
  if (r['grace'] !== undefined) {
    const g = int(r['grace'], 1, 365);
    if (g === null) return { reason: `« ${id} » : souplesse (grace) entre 1 et 365 jours` };
    rec.grace = g;
  }
  if (r['season'] !== undefined) {
    const se = (r['season'] ?? {}) as Record<string, unknown>;
    if (!isSeasonDay(se['from']) || !isSeasonDay(se['to'])) return { reason: `« ${id} » : saison illisible (season { from: "MM-JJ", to: "MM-JJ" })` };
    rec.season = { from: se['from'], to: se['to'] };
  }
  const entry: CatalogueEntry = { id, titre, famille: text(o['famille'], 40) || 'Maison', rec };
  const howto = text(o['howto'], 2000); if (howto) entry.howto = howto;
  const piece = text(o['piece'], 60); if (piece) entry.piece = piece;
  if (o['article'] !== undefined) {
    const a = (o['article'] ?? {}) as Record<string, unknown>;
    const nom = text(a['nom'], 120);
    const use = a['use'] === undefined ? 1 : int(a['use'], 1, 99);
    const seuil = a['seuil'] === undefined ? 0 : int(a['seuil'], 0, 9999);
    if (!nom || use === null || seuil === null) return { reason: `« ${id} » : article illisible (nom, use 1 à 99, seuil 0 à 9999)` };
    entry.article = { nom, unite: text(a['unite'], 30), use, seuil };
  }
  return { entry };
}

/** Lit un fichier de catalogue. Null s'il n'existe pas ; lève s'il est illisible. */
function readFile(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  const v = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('le fichier ne contient pas un objet JSON');
  return v as Record<string, unknown>;
}

/**
 * Fusionne le catalogue livré et la surcharge du foyer. Pur, hors disque :
 * c'est ce qu'on teste. `warn` reçoit une ligne par entrée écartée.
 */
export function mergeCatalogue(shipped: Record<string, unknown>, override: Record<string, unknown> | null, warn: (line: string) => void): Catalogue {
  const byId = new Map<string, CatalogueEntry>();
  const take = (list: unknown, where: string): void => {
    for (const raw of Array.isArray(list) ? list : []) {
      const o = (raw ?? {}) as Record<string, unknown>;
      if (o['retire'] === true && typeof o['id'] === 'string') { byId.delete(o['id']); continue; }
      const r = readEntry(raw);
      if ('reason' in r) warn(`Entretien : geste écarté du catalogue (${where}) : ${r.reason}.`);
      else byId.set(r.entry.id, r.entry);
    }
  };
  take(shipped['gestes'], 'catalogue livré');
  if (override) take(override['gestes'], 'surcharge');
  return { gestes: [...byId.values()] };
}

let cache: { key: string; value: Catalogue } | null = null;

/**
 * Le catalogue en vigueur. Relu quand le fichier de surcharge apparaît, change
 * ou disparaît (sa date de modification fait partie de la clé du cache).
 */
export function catalogue(dataDir: string, shippedFile = SHIPPED): Catalogue {
  const overrideFile = path.join(dataDir, CATALOGUE_FILE);
  let stamp = 'absent';
  try { stamp = String(fs.statSync(overrideFile).mtimeMs); } catch { /* pas de surcharge */ }
  const key = shippedFile + '|' + stamp;
  if (cache?.key === key) return cache.value;

  let shipped: Record<string, unknown> = {};
  try { shipped = readFile(shippedFile) ?? {}; } catch (e) {
    log.attention(`Entretien : catalogue livré illisible (${shippedFile}) : ${(e as Error).message}. Aucun geste proposé.`);
  }
  let override: Record<string, unknown> | null = null;
  try { override = readFile(overrideFile); } catch (e) {
    log.attention(`Entretien : surcharge du catalogue illisible (${overrideFile}) : ${(e as Error).message}. Le catalogue livré s'applique seul.`);
  }
  const value = mergeCatalogue(shipped, override, (line) => log.attention(line));
  if (override) log.info(`Entretien : catalogue chargé avec la surcharge ${overrideFile} (${value.gestes.length} gestes).`);
  cache = { key, value };
  return value;
}
