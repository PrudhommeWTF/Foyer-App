// Le gabarit des routines : ce qu'un enfant reçoit à son enrôlement, avant que
// ses parents ne l'ajustent. Rien en dur dans le code : le gabarit livré est un
// fichier JSON (backend/config/epopee/routines.json) qu'un foyer remplace par un
// fichier au même chemin dans FOYER_DATA_DIR (epopee/routines.json). Un fichier
// du foyer illisible ou sans routine valable est écarté, nommé au journal, et le
// gabarit livré s'applique.
import fs from 'fs';
import path from 'path';
import { log } from '../log';
import { ROUTINE_KINDS, RewardInput, RoutineKind, exploitInput, rewardInput } from './rules';

export interface StepTpl { title: string; hint: string; icon: string; seconds: number; ecus: number; }
export interface RoutineTpl { kind: RoutineKind; title: string; time: string; steps: StepTpl[]; }
export interface ExploitTpl { title: string; ecus: number; }
export interface Gabarit { routines: RoutineTpl[]; exploits: ExploitTpl[]; rewards: RewardInput[]; }

export const GABARIT_FILE = path.join('epopee', 'routines.json');
const SHIPPED = path.join(__dirname, '..', '..', 'config', GABARIT_FILE);

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/**
 * Lit un gabarit. Pur, hors disque : c'est ce qu'on teste. Une étape ou une
 * routine mal formée est écartée et nommée par `warn` ; le reste s'applique.
 * Une seule routine par moment (matin, soir), la première gagne.
 */
export function parseGabarit(raw: unknown, where: string, warn: (l: string) => void): RoutineTpl[] {
  const out: RoutineTpl[] = [];
  const list = (raw as { routines?: unknown })?.routines;
  for (const r of Array.isArray(list) ? list as Record<string, unknown>[] : []) {
    const kind = ROUTINE_KINDS.find((k) => k === r?.['kind']), title = str(r?.['title'], 60);
    const time = typeof r?.['time'] === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r['time']) ? r['time'] : null;
    if (!kind || !title || !time || out.some((x) => x.kind === kind)) { warn(`Épopée : ${where}, routine « ${String(r?.['title'] ?? '?')} » écartée (kind matin ou soir, une par moment, title, time HH:MM).`); continue; }
    const steps: StepTpl[] = [];
    for (const s of Array.isArray(r['steps']) ? r['steps'] as Record<string, unknown>[] : []) {
      const t = str(s?.['title'], 60), icon = str(s?.['icon'], 30), seconds = int(s?.['seconds'], 10, 3600), ecus = int(s?.['ecus'], 0, 3);
      if (!t || !icon || seconds === null || ecus === null) { warn(`Épopée : ${where}, étape « ${String(s?.['title'] ?? '?')} » écartée (title, icon, seconds de 10 à 3600, ecus de 0 à 3).`); continue; }
      steps.push({ title: t, hint: str(s['hint'], 120) ?? '', icon, seconds, ecus });
    }
    if (!steps.length || steps.length > 12) { warn(`Épopée : ${where}, routine « ${title} » écartée (de 1 à 12 étapes valables).`); continue; }
    out.push({ kind, title, time, steps });
  }
  return out;
}

/** Les exploits proposés d'un gabarit (clé « exploits »). Un exploit mal formé est écarté et nommé. */
export function parseExploits(raw: unknown, where: string, warn: (l: string) => void): ExploitTpl[] {
  const out: ExploitTpl[] = [];
  const list = (raw as { exploits?: unknown })?.exploits;
  for (const e of Array.isArray(list) ? list as Record<string, unknown>[] : []) {
    const x = exploitInput(e ?? {});
    if (typeof x === 'string') warn(`Épopée : ${where}, exploit « ${String(e?.['title'] ?? '?')} » écarté (${x})`); else out.push(x);
  }
  return out;
}

/** Les récompenses proposées d'un gabarit (clé « recompenses »). Une récompense mal formée est écartée et nommée. */
export function parseRewards(raw: unknown, where: string, warn: (l: string) => void): RewardInput[] {
  const out: RewardInput[] = [];
  const list = (raw as { recompenses?: unknown })?.recompenses;
  for (const r of Array.isArray(list) ? list as Record<string, unknown>[] : []) {
    const x = rewardInput(r ?? {});
    if (typeof x === 'string') warn(`Épopée : ${where}, récompense « ${String(r?.['title'] ?? '?')} » écartée (${x})`); else out.push(x);
  }
  return out;
}

const read = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Le gabarit en vigueur : celui du foyer s'il en a posé un avec au moins une routine valable, sinon le livré. */
export function loadGabarit(dataDir: string): Gabarit {
  const own = path.join(dataDir, GABARIT_FILE), warn = (l: string): void => log.attention(l);
  if (fs.existsSync(own)) {
    try {
      const raw = read(own), routines = parseGabarit(raw, 'gabarit du foyer', warn);
      if (routines.length) return { routines, exploits: parseExploits(raw, 'gabarit du foyer', warn), rewards: parseRewards(raw, 'gabarit du foyer', warn) };
      log.attention('Épopée : le gabarit du foyer ne contient aucune routine valable, le gabarit livré s’applique.');
    } catch (e) { log.attention(`Épopée : gabarit du foyer illisible (${(e as Error).message}), le gabarit livré s’applique.`); }
  }
  const raw = read(SHIPPED);
  return { routines: parseGabarit(raw, 'gabarit livré', warn), exploits: parseExploits(raw, 'gabarit livré', warn), rewards: parseRewards(raw, 'gabarit livré', warn) };
}
