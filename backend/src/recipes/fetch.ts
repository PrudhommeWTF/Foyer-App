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
//   4. **L'adresse vérifiée est celle à laquelle on se connecte.** Vérifier puis
//      laisser la couche réseau résoudre à nouveau laisse une fenêtre : un
//      domaine dont le TTL est très court répond une adresse publique à la
//      vérification et 192.168.1.10 à la requête. C'est la « réidentification
//      DNS », et c'est le contournement qui restait. La connexion est donc
//      ouverte sur l'adresse **déjà validée**, le nom ne servant plus qu'au
//      certificat et à l'en-tête Host.
import dns from 'dns/promises';
import http from 'http';
import https from 'https';
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
    // Bancs d'essai (RFC 2544) : réellement posée sur certains réseaux d'opérateur.
    // Les plages de documentation (198.51.100/24, 203.0.113/24) ne sont PAS
    // bloquées : elles ne sont routables nulle part, les interdire ne protège de
    // rien, et elles servent d'adresses publiques factices dans les tests.
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;                            // multicast et réservé
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (s === '::' || s === '::1') return true;
    if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true;
    if (s.startsWith('ff')) return true;                  // multicast
    if (s.startsWith('2002:')) return true;               // 6to4, qui encapsule du v4
    if (s.startsWith('64:ff9b:')) return true;            // NAT64, qui traduit vers du v4
    // Adresse IPv4 encapsulée : on la juge sur sa partie v4.
    const m = /(?:^::ffff:|^::)((?:\d{1,3}\.){3}\d{1,3})$/.exec(s);
    if (m) return isPrivateAddress(m[1]);
    return false;
  }
  // Ni v4 ni v6 : on ne sait pas, donc on refuse.
  return true;
}

/** Une adresse validée, et **l'adresse IP** sur laquelle on ouvrira la connexion. */
export interface CiblePublique { url: URL; adresse: string }

const REFUS_LOCAL = 'Cette adresse pointe sur le réseau local : elle ne peut pas être importée.';

/**
 * Valide une URL et **épingle** l'adresse à laquelle elle répond.
 *
 * Rendre l'adresse, et non le seul nom, est ce qui ferme la réidentification
 * DNS : c'est sur cette adresse-là que la connexion sera ouverte, et non sur ce
 * qu'une seconde résolution aurait bien voulu répondre entre-temps.
 *
 * Toutes les adresses du nom sont examinées, pas seulement celle qu'on retient :
 * un nom qui répond une adresse publique et une adresse privée est refusé en
 * entier, sinon il suffirait de faire tourner l'ordre des réponses.
 */
export async function resolvePublicUrl(raw: string): Promise<CiblePublique> {
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
  // Une adresse IP écrite en clair est jugée directement, sans résolution : elle
  // est déjà sa propre épingle.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new FetchError(REFUS_LOCAL);
    return { url, adresse: host };
  }

  let addresses: { address: string }[];
  try { addresses = await dns.lookup(host, { all: true }); }
  catch { throw new FetchError(`Le nom de domaine « ${host} » est introuvable. Vérifiez le lien, et que le serveur a bien accès à Internet.`); }

  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new FetchError(REFUS_LOCAL);
  }
  return { url, adresse: addresses[0].address };
}

/**
 * Valide une URL avant d'aller la chercher. Rend l'URL analysée, ou lève une
 * FetchError dont le message est destiné à l'utilisateur.
 *
 * Conservée pour ce qui n'a besoin que du verdict ; ce qui va réellement se
 * connecter passe par `resolvePublicUrl`, qui rend en plus l'adresse épinglée.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  return (await resolvePublicUrl(raw)).url;
}

const TROP_GROS = 'La page est trop volumineuse pour être importée (plus de 3 Mo).';

/**
 * Lit le corps en s'arrêtant net au-delà de la limite : un flux sans fin ne doit
 * pas remplir la mémoire du conteneur. La connexion est coupée dès le
 * dépassement, on ne lit pas le reste pour le jeter ensuite.
 */
function readCapped(res: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    res.on('data', (c: Buffer) => {
      total += c.length;
      if (total > max) { res.destroy(); reject(new FetchError(TROP_GROS)); return; }
      chunks.push(c);
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

/**
 * Une requête ouverte sur **l'adresse déjà validée**, le nom ne servant plus
 * qu'au certificat (SNI et vérification) et à l'en-tête Host.
 *
 * C'est tout l'objet de la protection : `fetch` résout le nom lui-même, donc
 * une seconde fois, et rien ne garantit qu'il obtienne la même réponse que la
 * vérification. En passant l'adresse à la place de l'hôte, il n'y a plus de
 * seconde résolution du tout, et donc plus de fenêtre.
 *
 * `rejectUnauthorized` reste vrai et `servername` porte le vrai nom : épingler
 * l'adresse n'affaiblit en rien la vérification du certificat.
 */
export function requetePinned(url: URL, adresse: string, accept: string): Promise<http.IncomingMessage> {
  const tls = url.protocol === 'https:';
  const options: https.RequestOptions = {
    host: adresse,
    port: url.port ? Number(url.port) : (tls ? 443 : 80),
    path: url.pathname + url.search,
    method: 'GET',
    headers: {
      Host: url.host,
      'User-Agent': USER_AGENT,
      Accept: accept,
      'Accept-Language': 'fr-FR,fr;q=0.9',
      Connection: 'close',
    },
    ...(tls ? { servername: url.hostname, rejectUnauthorized: true } : {}),
  };
  return new Promise((resolve, reject) => {
    const req = (tls ? https : http).request(options, resolve);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(Object.assign(new Error('délai dépassé'), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);
    req.end();
  });
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
  const err = e as { name?: string; code?: string; cause?: { code?: string; message?: string; errors?: unknown[] } };
  if (err?.name === 'TimeoutError') return 'le site n’a pas répondu à temps';
  // Les erreurs de `node:http` portent leur code directement, sans `cause` :
  // depuis que la connexion est ouverte sur une adresse épinglée, c'est la forme
  // courante. Celle de `fetch`, qui emballe dans `cause`, reste traitée en dessous.
  if (err?.code && PANNES[err.code]) return PANNES[err.code];
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
  let cible = await resolvePublicUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url: current, adresse } = cible;
    let res: http.IncomingMessage;
    try {
      res = await requetePinned(current, adresse, accept);
    } catch (e) {
      // Trace complète côté serveur : c'est là que l'exploitant ira chercher la
      // pile d'appels, la réponse à l'écran devant rester une phrase.
      log.attention(`Recettes : échec réseau sur ${current.href}`, e);
      throw new FetchError(`Import impossible : ${networkReason(e)} (${current.hostname}).`);
    }

    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400) {
      const location = res.headers['location'];
      res.resume(); // le corps d'une redirection ne nous intéresse pas
      if (!location) throw new FetchError('Le site a répondu par une redirection incomplète.');
      // Chaque saut repasse par la validation ET par l'épinglage : une page
      // publique qui renvoie vers 127.0.0.1 est le contournement classique, et
      // un nom qui change d'adresse entre deux sauts en est un autre.
      cible = await resolvePublicUrl(new URL(String(location), current).href);
      continue;
    }

    if (status === 403 || status === 401) {
      res.resume();
      throw new FetchError('Le site refuse la lecture automatique de cette page. Vous pouvez saisir la recette à la main.');
    }
    if (status === 404) { res.resume(); throw new FetchError('Cette page n’existe pas ou plus sur le site.'); }
    if (status < 200 || status >= 300) { res.resume(); throw new FetchError(`Le site a répondu une erreur ${status}.`); }

    const declared = parseInt(String(res.headers['content-length'] ?? ''), 10);
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      res.destroy();
      throw new FetchError(TROP_GROS);
    }

    return {
      url: current.href,
      body: await readCapped(res, MAX_BYTES),
      contentType: String(res.headers['content-type'] ?? '').toLowerCase(),
    };
  }

  throw new FetchError('Le site enchaîne trop de redirections.');
}
