// Le barème du module Tables : le temps accordé par réponse et le seuil
// « rapide » selon l'âge, et les règles de la maîtrise. Rien en dur dans le
// code : le barème livré est un fichier JSON (backend/config/tables-bareme.json)
// qu'un foyer adapte par un fichier du même nom dans FOYER_DATA_DIR. La
// surcharge remplace les clés qu'elle porte (« ages » en bloc, les champs de
// « adulte », « sansAge » et « maitrise » un par un) et se relit dès qu'elle
// change. Une valeur illisible est écartée et nommée au journal ; le reste
// s'applique.
import fs from 'fs';
import path from 'path';
import { log } from '../log';
import type { MasteryCfg } from './mastery';

export interface Timing { accorde: number; rapide: number; }
export interface AgeRow extends Timing { jusqua: number; }
export interface Bareme { ages: AgeRow[]; adulte: Timing; sansAge: Timing; maitrise: MasteryCfg; }

export const BAREME_FILE = 'tables-bareme.json';
const SHIPPED = path.join(__dirname, '..', '..', 'config', BAREME_FILE);

/** Le dernier recours, si même le fichier livré est illisible : les valeurs de départ documentées. */
const SECOURS: Bareme = {
  ages: [{ jusqua: 8, accorde: 8, rapide: 4 }, { jusqua: 10, accorde: 6, rapide: 3 }],
  adulte: { accorde: 4, rapide: 2 },
  sansAge: { accorde: 8, rapide: 4 },
  maitrise: { espacementJours: [0, 1, 3, 7, 14, 30], descenteSiFaux: 2, niveauAcquis: 3, bonnesMin: 3 },
};

const num = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const int = (v: unknown, min: number, max: number): number | null => (num(v, min, max) !== null && Number.isInteger(v) ? (v as number) : null);

function timing(raw: unknown, where: string, warn: (l: string) => void): Timing | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const accorde = num(o['accorde'], 1, 120), rapide = num(o['rapide'], 0.5, 120);
  if (accorde === null || rapide === null || rapide > accorde) {
    warn(`Tables : ${where} écarté (accorde entre 1 et 120 s, rapide entre 0,5 s et accorde).`);
    return null;
  }
  return { accorde, rapide };
}

/**
 * Applique une couche (le fichier livré, puis la surcharge) sur un barème.
 * Pur, hors disque : c'est ce qu'on teste. `warn` reçoit une ligne par valeur écartée.
 */
export function layer(base: Bareme, raw: Record<string, unknown>, where: string, warn: (l: string) => void): Bareme {
  const out: Bareme = { ...base, maitrise: { ...base.maitrise } };
  if (raw['ages'] !== undefined) {
    const rows: AgeRow[] = [];
    for (const r of Array.isArray(raw['ages']) ? raw['ages'] : []) {
      const j = int((r as Record<string, unknown>)?.['jusqua'], 1, 120);
      const t = timing(r, `${where}, ligne d’âge ${String((r as Record<string, unknown>)?.['jusqua'] ?? '?')}`, warn);
      if (j === null && t) warn(`Tables : ${where}, ligne d’âge sans « jusqua » entier, écartée.`);
      if (j !== null && t) rows.push({ jusqua: j, ...t });
    }
    if (rows.length) out.ages = rows.sort((x, y) => x.jusqua - y.jusqua);
    else warn(`Tables : ${where}, aucune ligne d’âge lisible ; les précédentes restent.`);
  }
  for (const k of ['adulte', 'sansAge'] as const) {
    if (raw[k] === undefined) continue;
    const t = timing({ ...out[k], ...(raw[k] as object) }, `${where}, « ${k} »`, warn);
    if (t) out[k] = t;
  }
  const m = raw['maitrise'] as Record<string, unknown> | undefined;
  if (m && typeof m === 'object') {
    const esp = m['espacementJours'];
    if (esp !== undefined) {
      const ok = Array.isArray(esp) && esp.length >= 2 && esp.length <= 10 && esp.every((d, i) => int(d, 0, 365) !== null && (i === 0 || d >= esp[i - 1]));
      if (ok) out.maitrise.espacementJours = esp as number[];
      else warn(`Tables : ${where}, « espacementJours » écarté (2 à 10 nombres de jours croissants, entre 0 et 365).`);
    }
    const top = out.maitrise.espacementJours.length - 1;
    for (const [k, min, max] of [['descenteSiFaux', 1, top], ['niveauAcquis', 1, top], ['bonnesMin', 1, 50]] as const) {
      if (m[k] === undefined) continue;
      const v = int(m[k], min, max);
      if (v === null) warn(`Tables : ${where}, « ${k} » écarté (entier entre ${min} et ${max}).`);
      else out.maitrise[k] = v;
    }
    out.maitrise.niveauAcquis = Math.min(out.maitrise.niveauAcquis, top);
    out.maitrise.descenteSiFaux = Math.min(out.maitrise.descenteSiFaux, top);
  }
  return out;
}

function readJson(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  const v = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('le fichier ne contient pas un objet JSON');
  return v as Record<string, unknown>;
}

let cache: { key: string; value: Bareme } | null = null;

/** Le barème en vigueur : le livré, puis la surcharge du foyer s'il y en a une. */
export function bareme(dataDir: string, shippedFile = SHIPPED): Bareme {
  const overrideFile = path.join(dataDir, BAREME_FILE);
  let stamp = 'absent';
  try { stamp = String(fs.statSync(overrideFile).mtimeMs); } catch { /* pas de surcharge */ }
  const key = shippedFile + '|' + overrideFile + '|' + stamp;
  if (cache?.key === key) return cache.value;
  const warn = (l: string): void => log.attention(l);
  let value = SECOURS;
  try { const s = readJson(shippedFile); if (s) value = layer(value, s, 'barème livré', warn); } catch (e) {
    log.attention(`Tables : barème livré illisible (${shippedFile}) : ${(e as Error).message}. Valeurs de secours appliquées.`);
  }
  try {
    const o = readJson(overrideFile);
    if (o) { value = layer(value, o, 'surcharge', warn); log.info(`Tables : barème chargé avec la surcharge ${overrideFile}.`); }
  } catch (e) {
    log.attention(`Tables : surcharge du barème illisible (${overrideFile}) : ${(e as Error).message}. Le barème livré s'applique seul.`);
  }
  cache = { key, value };
  return value;
}

/** L'âge révolu à une date (AAAA-MM-JJ), ou null sans date de naissance lisible. */
export function ageOn(birthday: string | null | undefined, day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday || '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), m[2], m[3]];
  const age = Number(day.slice(0, 4)) - y - (day.slice(5) < `${mo}-${d}` ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
}

export type TimingSource = 'programme' | 'bareme' | 'sans-age';

/**
 * Le temps accordé et le seuil rapide d'un membre, en millisecondes : ceux du
 * programme quand un parent les a fixés, sinon le barème selon l'âge au jour dit.
 * Sans date de naissance, un adulte a le temps d'un adulte ; « sansAge » ne vaut
 * que pour un enfant.
 */
export function timingFor(b: Bareme, who: { birthday?: string | null; enfant?: boolean }, day: string,
  program?: { secondsAllowed: number | null; fastSeconds: number | null } | null,
): { allowedMs: number; fastMs: number; source: TimingSource; age: number | null } {
  const age = ageOn(who.birthday, day);
  // Avant la première ligne, la première s'applique (elle est trouvée) ; après la dernière, l'adulte.
  const base = age === null ? (who.enfant ? b.sansAge : b.adulte) : (b.ages.find((r) => age <= r.jusqua) ?? b.adulte);
  const fromProgram = program && (program.secondsAllowed !== null || program.fastSeconds !== null);
  const accorde = program?.secondsAllowed ?? base.accorde;
  const rapide = Math.min(program?.fastSeconds ?? base.rapide, accorde);
  return { allowedMs: Math.round(accorde * 1000), fastMs: Math.round(rapide * 1000), source: fromProgram ? 'programme' : age === null && who.enfant ? 'sans-age' : 'bareme', age };
}
