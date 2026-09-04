// Récupération de la page d'une recette.
//
// C'est la seule sortie réseau que le foyer s'autorise, en dehors des vacances
// scolaires et de la vérification de version : elle est déclenchée par un geste
// explicite, journalisée, et coupable par configuration.
//
// Elle demande de la prudence, parce que le serveur va chercher une adresse
// fournie par l'utilisateur. Foyer tourne dans un LXC, sur un réseau domestique
// où vivent d'autres services : sans garde-fou, un lien collé ferait de l'API
// une porte d'entrée vers le routeur, l'hyperviseur ou les métadonnées du
// conteneur. D'où les trois protections ci-dessous.
//
//   1. **Les adresses privées sont refusées**, après résolution DNS. Vérifier le
//      nom ne suffit pas : rien n'empêche un domaine public de pointer sur
//      192.168.1.1.
//   2. **Les redirections sont suivies à la main**, chaque étape étant revérifiée.
//      Une page publique qui redirige vers 127.0.0.1 est le contournement
//      classique de la protection précédente.
//   3. **La taille et la durée sont bornées.** Un flux sans fin ne doit pas
//      remplir la mémoire du conteneur.
import dns from 'dns/promises';
import net from 'net';
import { log } from '../log';

export class FetchError extends Error {}

/** Une page de recette pèse quelques centaines de kilooctets ; au-delà, ce n'en est pas une. */
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 4;

/**
 * Se présenter honnêtement : un site a le droit de savoir qui le lit, et de
 * retrouver le projet derrière.
 *
 * En ASCII pur, délibérément. La version précédente portait une apostrophe
 * typographique (U+2019), invisible à l'œil et supérieure à 255 : « fetch »
 * refusait de construire la requête, et AUCUN import n'a jamais pu aboutir. Un
 * en-tête est un détail de protocole, pas un texte d'interface : il n'a aucune
 * raison de sortir de l'ASCII.
 */
const USER_AGENT = 'Foyer/1.0 (+https://github.com/PrudhommeWTF/Foyer-App; self-hosted family app; user-initiated recipe import)';

/**
 * Une adresse IP que le serveur n'a rien à aller chercher : boucle locale,
 * réseaux privés, lien-local (dont 169.254.169.254, les métadonnées des
 * hébergeurs), multicast et adresses réservées.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;              // lien-local et métadonnées
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT
    if (a === 192 && b === 0) return true;                // documentation et IETF
    if (a >= 224) return true;                            // multicast et réservé
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (s === '::' || s === '::1') return true;
    if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true;
    if (s.startsWith('ff')) return true;                  // multicast
    // Adresse IPv4 encapsulée : on la juge sur sa partie v4.
    const m = /(?:^::ffff:|^::)((?:\d{1,3}\.){3}\d{1,3})$/.exec(s);
    if (m) return isPrivateAddress(m[1]);
    return false;
  }
  // Ni v4 ni v6 : on ne sait pas, donc on refuse.
  return true;
}

/**
 * Valide une URL avant d'aller la chercher. Rend l'URL analysée, ou lève une
 * FetchError dont le message est destiné à l'utilisateur.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw.trim()); }
  catch { throw new FetchError('Ce n’est pas une adresse valide. Collez le lien complet de la page, en commençant par https://'); }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new FetchError('Seules les adresses http et https peuvent être importées.');
  }
  if (url.username || url.password) {
    throw new FetchError('Une adresse contenant un identifiant ne peut pas être importée.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  // Une adresse IP écrite en clair est jugée directement, sans résolution.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new FetchError('Cette adresse pointe sur le réseau local : elle ne peut pas être importée.');
    return url;
  }

  let addresses: { address: string }[];
  try { addresses = await dns.lookup(host, { all: true }); }
  catch { throw new FetchError(`Le nom de domaine « ${host} » est introuvable. Vérifiez le lien, et que le serveur a bien accès à Internet.`); }

  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new FetchError('Cette adresse pointe sur le réseau local : elle ne peut pas être importée.');
  }
  return url;
}

/**
 * Lit le corps de la réponse en s'arrêtant net au-delà de la limite. Un
 * `await res.text()` avalerait tout ce que le serveur d'en face veut envoyer.
 */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const body = res.body;
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => { /* le flux part de toute façon */ });
      throw new FetchError('La page est trop volumineuse pour être importée (plus de 3 Mo).');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Traductions des pannes réseau les plus courantes. Un code brut ne dit rien à
 * qui exploite le serveur : la panne se répare autrement selon qu'il manque une
 * route, que le certificat est refusé ou que le site a coupé la connexion.
 */
const PANNES: Record<string, string> = {
  ENOTFOUND: 'le nom de domaine ne se résout pas depuis le serveur',
  EAI_AGAIN: 'la résolution du nom a échoué (DNS injoignable ou saturé)',
  ECONNREFUSED: 'le site a refusé la connexion',
  ECONNRESET: 'le site a coupé la connexion en cours de route',
  EHOSTUNREACH: 'aucune route vers le site depuis le serveur',
  ENETUNREACH: 'aucune route vers le site depuis le serveur (vérifiez notamment l’IPv6)',
  ETIMEDOUT: 'la connexion a expiré',
  UND_ERR_CONNECT_TIMEOUT: 'la connexion a expiré',
  EPROTO: 'échec de la négociation TLS',
  CERT_HAS_EXPIRED: 'le certificat du site est expiré',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'le certificat du site n’a pas pu être vérifié',
  SELF_SIGNED_CERT_IN_CHAIN: 'le certificat du site est auto-signé',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'le certificat du site est auto-signé',
};

/**
 * Ce que Node sait réellement de la panne. Sans cela, tout échec se résume à
 * « site injoignable », qui ne dit ni quoi vérifier ni chez qui.
 */
export function networkReason(e: unknown): string {
  const err = e as { name?: string; cause?: { code?: string; message?: string; errors?: unknown[] } };
  if (err?.name === 'TimeoutError') return 'le site n’a pas répondu à temps';
  const cause = err?.cause;
  if (!cause) {
    // Aucune cause : la requête n'a même pas atteint le réseau. C'est un défaut
    // de Foyer, pas une panne du site, et le confondre avec « injoignable » fait
    // chercher des heures du mauvais côté. Vécu une fois, plus jamais.
    return 'la requête n’a pas pu être émise (' + ((e as Error)?.message || 'raison inconnue') + ')';
  }

  // Plusieurs adresses essayées, IPv4 puis IPv6 : Node agrège les échecs, et
  // c'est exactement la trace d'une pile IPv6 annoncée mais non routée.
  if (Array.isArray(cause.errors) && cause.errors.length) {
    const codes = [...new Set(cause.errors
      .map((x) => (x as { code?: string; message?: string })?.code || (x as { message?: string })?.message)
      .filter(Boolean) as string[])];
    return codes.map((c) => PANNES[c] || c).join(', ');
  }
  const code = cause.code;
  if (code) return PANNES[code] || code;
  if (cause.message) return cause.message;
  return 'connexion impossible';
}

export interface FetchedPage { url: string; body: Buffer; contentType: string }

/**
 * Va chercher une page, en suivant les redirections une par une et en
 * revalidant chaque étape. `accept` indique au serveur ce qu'on sait lire.
 */
export async function fetchPublic(raw: string, accept: string): Promise<FetchedPage> {
  let current = await assertPublicUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'fr-FR,fr;q=0.9' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      // Trace complète côté serveur : c'est là que l'exploitant ira chercher la
      // pile d'appels, la réponse à l'écran devant rester une phrase.
      log.attention(`Recettes : échec réseau sur ${current.href}`, e);
      throw new FetchError(`Import impossible : ${networkReason(e)} (${current.hostname}).`);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new FetchError('Le site a répondu par une redirection incomplète.');
      // Chaque saut repasse par la validation : une page publique qui renvoie
      // vers 127.0.0.1 est le contournement classique.
      current = await assertPublicUrl(new URL(location, current).href);
      continue;
    }

    if (res.status === 403 || res.status === 401) {
      throw new FetchError('Le site refuse la lecture automatique de cette page. Vous pouvez saisir la recette à la main.');
    }
    if (res.status === 404) throw new FetchError('Cette page n’existe pas ou plus sur le site.');
    if (!res.ok) throw new FetchError(`Le site a répondu une erreur ${res.status}.`);

    const declared = parseInt(res.headers.get('content-length') || '', 10);
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new FetchError('La page est trop volumineuse pour être importée (plus de 3 Mo).');
    }

    return {
      url: current.href,
      body: await readCapped(res, MAX_BYTES),
      contentType: (res.headers.get('content-type') || '').toLowerCase(),
    };
  }

  throw new FetchError('Le site enchaîne trop de redirections.');
}
