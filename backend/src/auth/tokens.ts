// Le secret d'un jeton d'accès : engendré, présenté une seule fois, puis rangé
// haché. Ce module ne fait que fabriquer et transformer des chaînes ; le SQL vit
// dans db.ts, la vérification du mot de passe et de la portée dans les routes.
//
// Format : `foyer_` suivi de 40 caractères base62 tirés au hasard. Le préfixe
// (`foyer_` + les 8 premiers) sert à reconnaître un jeton dans une liste sans
// jamais réafficher le secret. En base, on ne garde que le SHA-256 du secret :
// une fuite de la base ne rend donc aucun jeton utilisable, seulement révocable.
import crypto from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LONGUEUR = 40;

/** Un caractère base62 sans biais : on rejette les octets qui déborderaient du dernier tour complet. */
function base62(n: number): string {
  const max = 256 - (256 % ALPHABET.length); // 248 : au-delà, l'octet est rejeté pour ne pas favoriser les premiers caractères
  let out = '';
  while (out.length < n) {
    for (const b of crypto.randomBytes((n - out.length) * 2)) {
      if (b < max) { out += ALPHABET[b % ALPHABET.length]; if (out.length === n) break; }
    }
  }
  return out;
}

/** Engendre un nouveau secret. À montrer une fois, jamais à ranger tel quel. */
export function genererJeton(): string {
  return 'foyer_' + base62(LONGUEUR);
}

/** Le condensat rangé en base : SHA-256 du secret, en hexadécimal. */
export function hashJeton(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/** Les premiers caractères, pour l'affichage : `foyer_` + 8 caractères. */
export function prefixeJeton(secret: string): string {
  return secret.slice(0, 'foyer_'.length + 8);
}

/** Un secret a-t-il la forme d'un jeton d'accès ? (préfixe seulement, la validité se lit en base) */
export function estJeton(valeur: string): boolean {
  return valeur.startsWith('foyer_');
}
