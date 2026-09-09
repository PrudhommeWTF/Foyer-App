// Recherche de logo pour une carte de fidélité.
//
// À la saisie d'une carte, on propose des logos tirés du **nom** de l'enseigne.
// Source : l'autocomplétion d'entreprises de Clearbit (autocomplete.clearbit.com),
// gratuite et sans clé, qui rend une liste de sociétés (nom + domaine) ; le logo
// de chacune se lit ensuite chez logo.clearbit.com. Deux hôtes fixes, jamais une
// URL choisie par l'utilisateur : pas de SSRF possible.
//
// C'est une requête sortante, déclenchée par la frappe et coupable par le réglage
// `cardLogoSearch`. Le serveur la relaie plutôt que le navigateur, pour garder la
// CSP fermée. Une panne (réseau, service indisponible, service retiré) dégrade en
// silence : aucune option n'est proposée, le monogramme tient lieu de logo.
//
// Les images sont renvoyées **en data-URI** : le frontend ne peut afficher qu'une
// ressource `self` ou `data:` (CSP), et une carte doit rester lisible hors ligne
// une fois le logo choisi.
import { log } from './log';

const SUGGEST = 'https://autocomplete.clearbit.com/v1/companies/suggest';
const LOGO = 'https://logo.clearbit.com/';
const TIMEOUT_MS = 5000;
/** Un logo au-delà de cette taille n'a rien à faire dans le document d'état, réenvoyé à chaque sauvegarde. */
const MAX_LOGO_BYTES = 60 * 1024;
/** Les images qu'on accepte d'embarquer. Pas de SVG : inutile ici, et une image vectorielle peut porter du script. */
const IMG_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export interface LogoCandidate { name: string; domain: string; }

/**
 * Les sociétés d'une réponse d'autocomplétion : nom et domaine, dédupliqués par
 * domaine et bornés. Un domaine qui n'en est pas un (chemin, port, texte libre)
 * est écarté : c'est lui qui servira ensuite à construire l'URL du logo.
 */
export function parseLogoCandidates(json: unknown, limit = 5): LogoCandidate[] {
  if (!Array.isArray(json)) return [];
  const out: LogoCandidate[] = [];
  const seen = new Set<string>();
  for (const it of json) {
    const rec = it as { name?: unknown; domain?: unknown };
    const domain = typeof rec?.domain === 'string' ? rec.domain.trim().toLowerCase() : '';
    if (!domain || seen.has(domain)) continue;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) continue;
    seen.add(domain);
    const name = typeof rec?.name === 'string' && rec.name.trim() ? rec.name.trim() : domain;
    out.push({ name, domain });
    if (out.length >= limit) break;
  }
  return out;
}

export interface CardLogo { name: string; domain: string; dataUri: string; }

/** Récupère l'image du logo d'un domaine, en data-URI, ou null si rien d'exploitable. */
async function fetchLogo(domain: string): Promise<string | null> {
  const url = LOGO + encodeURIComponent(domain) + '?size=128';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Foyer' } });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMG_MIMES.includes(mime)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_LOGO_BYTES) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Cherche des logos à partir du nom de l'enseigne. Rend au plus `limit` options
 * (nom, domaine, image en data-URI), ou une liste vide en cas de panne. Les
 * images sont récupérées en parallèle et seules celles qui aboutissent sont
 * gardées.
 */
export async function searchLogos(name: string, limit = 5): Promise<CardLogo[]> {
  const q = name.trim().slice(0, 80);
  if (q.length < 2) return [];
  let candidates: LogoCandidate[];
  try {
    const res = await fetch(`${SUGGEST}?query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Foyer' } });
    if (!res.ok) return [];
    candidates = parseLogoCandidates(await res.json(), limit);
  } catch (e) {
    log.attention('Logos : recherche indisponible', e);
    return [];
  }
  const logos = await Promise.all(candidates.map(async (c) => {
    const dataUri = await fetchLogo(c.domain);
    return dataUri ? { name: c.name, domain: c.domain, dataUri } : null;
  }));
  return logos.filter((x): x is CardLogo => !!x);
}
