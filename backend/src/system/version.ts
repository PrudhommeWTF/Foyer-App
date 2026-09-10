// Version exécutée et disponibilité d'une mise à jour : ce que /system/version,
// /system/update-check et /system/update dérivent, sorti de server.ts pour vivre
// avec le reste du sous-système « exploitation ». Rien ici ne tient d'état du
// serveur : tout se relit de la configuration (variables d'environnement et
// réglage du canal), pour qu'un helper posé ou un canal changé se voie sans
// redémarrage.
import fs from 'fs';
import path from 'path';
import { effectiveSetting } from '../settings/repo';
import { selfUpdateCapacite as capaciteSelfUpdate } from './self-update';
import { Canal, fetchRelease } from './releases';

/** Le dépôt d'où viennent les releases (surchargée en test/fork par l'environnement). */
export const GITHUB_REPO = process.env.FOYER_GITHUB_REPO || 'PrudhommeWTF/Foyer-App';

// La version ne change pas pendant la vie du processus : on la calcule une fois.
// Elle était relue (et le package.json avec) à chaque appel de /system/version,
// /system/update-check, /system/status et /system/update-status.
let versionCache: string | null = null;
export function currentVersion(): string {
  return (versionCache ??= computeVersion());
}
function computeVersion(): string {
  // Source de vérité : la variable FOYER_VERSION (injectée par Docker au build et
  // par l'installeur LXC dans /etc/foyer/foyer.env). Le fichier <data>/version d'antan
  // a disparu : l'installeur comme l'auto-mise à jour le suppriment. À défaut, la
  // version de package.json.
  if (process.env.FOYER_VERSION) return process.env.FOYER_VERSION.replace(/^v/, '');
  try { const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8')); return String(pkg.version); } catch { /* ignore */ }
  return '0.0.0';
}

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'Foyer-App' };
  if (process.env.FOYER_GITHUB_TOKEN) headers['Authorization'] = 'Bearer ' + process.env.FOYER_GITHUB_TOKEN;
  return headers;
}

/**
 * La capacité de la machine à se mettre à jour elle-même, relue à chaque appel :
 * un helper posé ou retiré entre deux requêtes doit se voir sans redémarrage.
 */
export const selfUpdateCapacite = () => capaciteSelfUpdate({
  refus: process.env.FOYER_SELF_UPDATE,
  helper: process.env.FOYER_SELF_UPDATE_HELPER,
});

/** Le canal choisi par le foyer, tel qu'il s'applique vraiment. */
export const canalCourant = (): Canal => (effectiveSetting('updateChannel') === 'prerelease' ? 'prerelease' : 'latest');

export const chercherRelease = (): Promise<Awaited<ReturnType<typeof fetchRelease>>> =>
  fetchRelease(GITHUB_REPO, canalCourant(), ghHeaders());
