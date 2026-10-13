// La configuration du client ÉcoleDirecte, lue dans l'environnement à chaque
// usage. Aucune valeur n'est écrite ici : les défauts vivent dans le registre
// des réglages (section « Serveur et déploiement »), qui les affiche aussi.
//
// Ce fichier n'ouvre pas la base (le registre est pur) : la sonde s'en sert
// sans démarrer le service.
import type { EdConfig } from './client';
import { declOf } from '../settings/registry';

const or = (v: string | undefined, fallback: unknown): string => (v || '').trim() || String(fallback ?? '');

export function edConfig(): EdConfig {
  return {
    base: or(process.env.FOYER_ED_API_BASE, declOf('envEdApiBase')?.default),
    version: or(process.env.FOYER_ED_API_VERSION, declOf('envEdApiVersion')?.default),
    userAgent: or(process.env.FOYER_ED_USER_AGENT, declOf('envEdUserAgent')?.default),
    origin: or(process.env.FOYER_ED_ORIGIN, declOf('envEdOrigin')?.default),
  };
}
