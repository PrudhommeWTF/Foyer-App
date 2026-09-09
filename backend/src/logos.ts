// Recherche de logo pour une carte de fidélité.
//
// À la saisie d'une carte, on propose des logos tirés du **nom** de l'enseigne.
// Le nom donne des domaines via l'autocomplétion d'entreprises de Clearbit
// (autocomplete.clearbit.com, gratuite, sans clé) ; l'image de chaque domaine est
// ensuite son **favicon**, récupéré chez des services par domaine (DuckDuckGo,
// puis Google en repli). L'ancien service de logos de Clearbit a été fermé par
// HubSpot, d'où le favicon. Les hôtes sont fixes, jamais une URL choisie par
// l'utilisateur : pas de SSRF possible.
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
/**
 * Sources d'icône **par domaine**, essayées dans l'ordre : la première image
 * valable gagne. L'ancien service de logos de Clearbit (logo.clearbit.com) a été
 * fermé par HubSpot ; on prend le favicon du domaine, qui reste servi partout.
 * DuckDuckGo répond une image directement ; Google redirige (le fetch suit).
 */
const ICON_SOURCES: ((domain: string) => string)[] = [
  (d) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(d)}.ico`,
  (d) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`,
];
const TIMEOUT_MS = 5000;
/** Un logo au-delà de cette taille n'a rien à faire dans le document d'état, réenvoyé à chaque sauvegarde. */
const MAX_LOGO_BYTES = 60 * 1024;
/** Les images qu'on accepte d'embarquer (dont l'ICO des favicons). Pas de SVG : une image vectorielle peut porter du script. */
const IMG_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'];

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

/** L'icône d'un domaine, en data-URI : la première source qui rend une image valable. */
async function fetchLogo(domain: string): Promise<string | null> {
  for (const src of ICON_SOURCES) {
    const dataUri = await fetchIcon(src(domain));
    if (dataUri) return dataUri;
  }
  return null;
}

/** Récupère une image à une URL et la rend en data-URI, ou null si rien d'exploitable. */
async function fetchIcon(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Foyer' }, redirect: 'follow' });
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
  // Deux domaines d'une même enseigne rendent souvent le même favicon : on ne
  // garde qu'une option par image, pour ne pas proposer deux fois la même.
  const seen = new Set<string>();
  const out: CardLogo[] = [];
  for (const x of logos) if (x && !seen.has(x.dataUri)) { seen.add(x.dataUri); out.push(x); }
  return out;
}
