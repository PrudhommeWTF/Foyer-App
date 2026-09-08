// Suggestions de lieu pour la saisie d'un événement de l'agenda.
//
// Source : la Base Adresse Nationale (api-adresse.data.gouv.fr), service public
// français, gratuit, sans clé ni compte, même classe de confiance que les
// vacances scolaires (data.education.gouv.fr). C'est une requête sortante,
// déclenchée par la frappe de l'utilisateur et coupable par le réglage
// `placeSuggest`. Le serveur la relaie plutôt que le navigateur, pour garder la
// CSP fermée et ne pas exposer un nouvel hôte au client. Une panne dégrade en
// silence : le champ reste une saisie libre.
import { log } from './log';

const BAN = 'https://api-adresse.data.gouv.fr/search/';
const TIMEOUT_MS = 5000;

/** Les libellés d'adresse d'une réponse BAN, dédupliqués et bornés. */
export function parseBanLabels(json: unknown, limit = 5): string[] {
  const feats = (json as { features?: { properties?: { label?: unknown } }[] } | null)?.features;
  if (!Array.isArray(feats)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of feats) {
    const label = typeof f?.properties?.label === 'string' ? f.properties.label.trim() : '';
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Interroge la BAN. Rend au plus `limit` libellés, ou une liste vide en cas de
 * panne (réseau, service indisponible), pour que le champ ne casse jamais.
 * La BAN exige au moins trois caractères ; en deçà, on ne sort pas.
 */
export async function suggestPlaces(query: string, limit = 5): Promise<string[]> {
  const q = query.trim().slice(0, 120);
  if (q.length < 3) return [];
  const url = `${BAN}?q=${encodeURIComponent(q)}&limit=${limit}&autocomplete=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Foyer' } });
    if (!res.ok) return [];
    return parseBanLabels(await res.json(), limit);
  } catch (e) {
    log.attention('Lieux : suggestion indisponible', e);
    return [];
  }
}
