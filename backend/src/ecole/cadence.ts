// Quand Foyer a le droit de contacter ÉcoleDirecte. Pur : l'heure murale de
// Paris et les réglages entrent, une décision sort. Testé sans base ni horloge.
//
// Trois règles, toutes réglables (registre, section École) :
//   - au plus une connexion par compte et par intervalle (`ecoleRefreshMin`) ;
//   - pas de connexion la nuit, entre `ecolePauseDebut` et `ecolePauseFin` ;
//   - le dimanche, pas avant `ecoleDimancheDebut`.
// Et une règle qui ne se règle pas : un compte bloqué (question de sécurité,
// identifiants refusés, version refusée, clé perdue), en pause, ou en pause
// automatique ne se connecte pas tout seul.
import { parisWall } from '../notify/reminders';
import type { Account } from './repo';

export interface Cadence { refreshMin: number; pauseFrom: string; pauseTo: string; sundayFrom: string; }

const minutesOf = (hm: string): number => { const [h, m] = hm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** L'heure murale `AAAA-MM-JJTHH:MM` tombe-t-elle dans une pause ? */
export function inQuietWindow(wall: string, c: Cadence): boolean {
  const [day, hm] = wall.split('T');
  const t = minutesOf(hm);
  const from = minutesOf(c.pauseFrom), to = minutesOf(c.pauseTo);
  // La pause de nuit enjambe minuit quand elle commence après sa fin (22:00 → 06:00).
  const night = from === to ? false : from < to ? t >= from && t < to : t >= from || t < to;
  if (night) return true;
  const [y, mo, d] = day.split('-').map(Number);
  const sunday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === 0;
  return sunday && t < minutesOf(c.sundayFrom);
}

/** Le compte peut-il se connecter de lui-même (hors fenêtre de pause) ? */
export function mayRun(a: Pick<Account, 'enabled' | 'blocked' | 'pausedUntil' | 'archivedAt'>, now: Date): boolean {
  return a.enabled && !a.blocked && !a.archivedAt && (!a.pausedUntil || Date.parse(a.pausedUntil) <= now.getTime());
}

/** L'intervalle depuis la dernière tentative est-il écoulé ? */
export function isDue(lastSyncAt: string | null, now: Date, c: Cadence): boolean {
  return !lastSyncAt || now.getTime() - Date.parse(lastSyncAt) >= c.refreshMin * 60_000;
}

/**
 * Le prochain passage prévu, à la minute près, ou null s'il n'y en aura pas sans
 * geste humain. Sert à l'affichage « prochain passage à 14:30 ».
 */
export function nextRunAt(a: Pick<Account, 'enabled' | 'blocked' | 'pausedUntil' | 'archivedAt' | 'lastSyncAt'>, now: Date, c: Cadence): string | null {
  if (!a.enabled || a.blocked || a.archivedAt) return null;
  let t = Math.max(now.getTime(), a.lastSyncAt ? Date.parse(a.lastSyncAt) + c.refreshMin * 60_000 : 0, a.pausedUntil ? Date.parse(a.pausedUntil) : 0);
  t = Math.ceil(t / 60_000) * 60_000;
  // Au plus deux jours de minutes à parcourir : une pause de nuit plus le dimanche matin.
  for (let i = 0; i < 2 * 1440 && inQuietWindow(parisWall(new Date(t)), c); i++) t += 60_000;
  return new Date(t).toISOString();
}
