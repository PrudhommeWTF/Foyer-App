// Le second facteur : un code à six chiffres qui change toutes les trente
// secondes (RFC 6238, « TOTP »), tel que le calculent Google Authenticator,
// Aegis, 1Password, Bitwarden et les autres.
//
// Écrit à la main plutôt qu'importé, comme le lecteur XML et le lecteur ZIP du
// module Finances : la grammaire tient en quarante lignes, elle ne changera
// plus, et une dépendance de plus sur le chemin de la connexion est une surface
// de plus. Node fournit déjà tout ce qu'il faut (HMAC-SHA1, aléa).
//
// Les choix qui comptent, et pourquoi :
//
//   - **SHA-1**, pas SHA-256. Ce n'est pas un oubli : la RFC 6238 le permet,
//     mais les applications d'authentification ne lisent pas toutes le
//     paramètre `algorithm` de l'URI, et celles qui l'ignorent calculeraient un
//     code faux sans rien dire. La solidité de TOTP ne repose pas sur la
//     résistance aux collisions de SHA-1 : elle repose sur le secret et sur la
//     fenêtre de trente secondes.
//   - **Vingt octets de secret**, la taille qu'attend la RFC et que toutes les
//     applications acceptent.
//   - **Une fenêtre de plus ou moins un pas**, soit une minute et demie de
//     tolérance. Les horloges de téléphone dérivent ; refuser un code juste
//     parce que le téléphone a trente secondes d'avance donnerait un second
//     facteur que personne ne garde allumé.
import crypto from 'crypto';

/** Durée d'un pas, en secondes. Trente est ce qu'attendent toutes les applications. */
export const PAS_S = 30;
/** Nombre de chiffres du code. Six, pour la même raison. */
export const CHIFFRES = 6;
/** Tolérance de dérive, en pas de part et d'autre. */
export const DERIVE = 1;

const ALPHABET_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode des octets en base32 (RFC 4648), sans remplissage : la forme qu'attendent les applications. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let valeur = 0;
  let out = '';
  for (const octet of buf) {
    valeur = (valeur << 8) | octet;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET_B32[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET_B32[(valeur << (5 - bits)) & 31];
  return out;
}

/**
 * Décode une base32. Rend null sur un caractère inconnu plutôt que de deviner :
 * un secret mal recopié doit se dire, pas produire des codes silencieusement
 * faux que personne ne saura expliquer.
 */
export function base32Decode(s: string): Buffer | null {
  const propre = s.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (!propre) return null;
  let bits = 0;
  let valeur = 0;
  const out: number[] = [];
  for (const c of propre) {
    const i = ALPHABET_B32.indexOf(c);
    if (i < 0) return null;
    valeur = (valeur << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Un secret neuf : vingt octets d'aléa, rendus en base32. */
export const genererSecret = (): string => base32Encode(crypto.randomBytes(20));

/** Le numéro de pas correspondant à un instant. */
export const pasDe = (nowMs: number): number => Math.floor(nowMs / 1000 / PAS_S);

/**
 * Le code d'un pas donné, pour ce secret. Rend null quand le secret est
 * illisible, ce qui vaut mieux qu'un code faux.
 */
export function codePour(secretB32: string, pas: number): string | null {
  const cle = base32Decode(secretB32);
  if (!cle || !cle.length) return null;

  // Le compteur est un entier de 8 octets, gros-boutiste.
  const compteur = Buffer.alloc(8);
  compteur.writeUInt32BE(Math.floor(pas / 2 ** 32), 0);
  compteur.writeUInt32BE(pas >>> 0, 4);

  const hmac = crypto.createHmac('sha1', cle).update(compteur).digest();
  // Troncature dynamique : les quatre bits de poids faible du dernier octet
  // désignent où lire les quatre octets qui portent le code.
  const decalage = hmac[hmac.length - 1] & 0x0f;
  const binaire = ((hmac[decalage] & 0x7f) << 24)
    | ((hmac[decalage + 1] & 0xff) << 16)
    | ((hmac[decalage + 2] & 0xff) << 8)
    | (hmac[decalage + 3] & 0xff);
  return String(binaire % 10 ** CHIFFRES).padStart(CHIFFRES, '0');
}

/**
 * Vérifie un code et rend **le pas qui l'a validé**, ou null.
 *
 * Rendre le pas plutôt qu'un booléen n'est pas un détail : c'est ce qui permet à
 * l'appelant de refuser un code déjà consommé. Sans cela, quelqu'un qui lit un
 * code par-dessus une épaule a trente secondes pour s'en servir à son tour.
 */
export function verifierCode(secretB32: string, code: string, nowMs: number, derive = DERIVE): number | null {
  const propre = String(code ?? '').replace(/[\s-]/g, '');
  if (!new RegExp(`^\\d{${CHIFFRES}}$`).test(propre)) return null;
  const courant = pasDe(nowMs);
  for (let d = -derive; d <= derive; d++) {
    const attendu = codePour(secretB32, courant + d);
    // Comparaison à temps constant : un code se devine chiffre par chiffre si le
    // temps de réponse dit où la comparaison s'est arrêtée.
    if (attendu && crypto.timingSafeEqual(Buffer.from(attendu), Buffer.from(propre))) {
      return courant + d;
    }
  }
  return null;
}

/**
 * L'URI que lisent les applications d'authentification, et que porte le QR code.
 *
 * `issuer` est repris dans le chemin **et** en paramètre : les applications
 * anciennes lisent l'un, les récentes l'autre, et sans les deux le compte
 * s'affiche sous un nom qui ne dit rien à qui a trois codes à l'écran.
 */
export function otpauthUri(secretB32: string, compte: string, issuer = 'Foyer'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(compte)}`;
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: String(CHIFFRES),
    period: String(PAS_S),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Le secret présenté à l'oeil, par groupes de quatre : on le recopie sans se perdre. */
export const secretLisible = (secretB32: string): string =>
  (secretB32.match(/.{1,4}/g) ?? []).join(' ');

// ---- codes de secours -----------------------------------------------------
//
// Un téléphone se perd, se casse, se réinitialise. Sans codes de secours, le
// second facteur transforme chaque accident en « demander à un administrateur »,
// et l'administrateur qui perd le sien n'a plus personne à qui demander.

/** Combien on en donne, et de quoi ils sont faits. */
export const NB_SECOURS = 10;
const ALPHABET_SECOURS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 : ils se confondent à la main

/** Dix codes de secours, chacun valant une connexion. */
export function genererSecours(n = NB_SECOURS): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const octets = crypto.randomBytes(10);
    let code = '';
    for (const o of octets) code += ALPHABET_SECOURS[o % ALPHABET_SECOURS.length];
    codes.push(code.slice(0, 5) + '-' + code.slice(5));
  }
  return codes;
}

/**
 * L'empreinte d'un code de secours, telle qu'elle est rangée en base.
 *
 * SHA-256 et non bcrypt, à dessein : bcrypt protège un secret **choisi par un
 * humain**, donc devinable, en rendant chaque essai coûteux. Un code de secours
 * fait cinquante bits d'aléa : il n'y a rien à deviner, et hacher dix codes avec
 * bcrypt à chaque connexion coûterait trois secondes pour rien.
 */
export const empreinteSecours = (code: string): string =>
  crypto.createHash('sha256').update(normaliserSecours(code)).digest('hex');

/** Un code de secours recopié à la main : casse et tirets n'ont pas à compter. */
export const normaliserSecours = (code: string): string =>
  String(code ?? '').replace(/[\s-]/g, '').toUpperCase();
