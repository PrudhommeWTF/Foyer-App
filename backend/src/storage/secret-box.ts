// Chiffrement réversible des secrets que Foyer doit pouvoir rejouer : les
// identifiants ÉcoleDirecte et l'appareil de confiance qui va avec.
//
// Pourquoi pas le reste de l'outillage : les jetons d'API sont hachés (on ne
// les relit jamais), et le type `secret` du registre ne vit que dans
// l'environnement. Ici il faut relire, donc chiffrer : AES-256-GCM, une clé
// dédiée `FOYER_SECRET_KEY`, jamais dérivée du secret JWT. Faire tourner le
// secret JWT après un incident ne doit pas détruire ces identifiants.
//
// Chaque valeur porte l'empreinte de la clé qui l'a scellée. Clé absente ou
// changée (base restaurée sur une autre machine) : `open` rend null, et
// l'interface dit « identifiants à ressaisir ». Rien ne plante.
import crypto from 'node:crypto';

const MIN_LENGTH = 32;
const PREFIX = 'sb1';

export type KeyState = 'ok' | 'absente' | 'trop-courte';

const raw = (): string => (process.env.FOYER_SECRET_KEY || '').trim();

/** L'état de la clé, pour l'écran : jamais sa valeur. */
export function keyState(): KeyState {
  const k = raw();
  if (!k) return 'absente';
  return k.length < MIN_LENGTH ? 'trop-courte' : 'ok';
}

// La clé saisie est une chaîne (`openssl rand -base64 32` en donne 44
// caractères) : on en tire 32 octets par SHA-256, avec un préfixe propre à cet
// usage, et une empreinte courte, distincte, pour reconnaître la clé d'origine.
const keyOf = (k: string): Buffer => crypto.createHash('sha256').update('foyer-secret-box:' + k).digest();
const fingerprintOf = (k: string): string => crypto.createHash('sha256').update('foyer-secret-fp:' + k).digest('hex').slice(0, 12);

/** Scelle une valeur. Lève une erreur explicite si la clé manque : on n'enregistre jamais en clair. */
export function seal(plain: string): string {
  const k = raw();
  if (keyState() !== 'ok') throw new Error(keyState() === 'absente'
    ? 'Clé de chiffrement absente : posez FOYER_SECRET_KEY (voir docs/ecole.md), puis redémarrez le service.'
    : `Clé de chiffrement trop courte : FOYER_SECRET_KEY doit faire au moins ${MIN_LENGTH} caractères.`);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(k), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [PREFIX, fingerprintOf(k), iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

/** Rouvre une valeur scellée. null si la clé manque, a changé, ou si la valeur est altérée. */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const k = raw();
  const [p, fp, iv, tag, ct] = sealed.split('.');
  if (p !== PREFIX || !ct || keyState() !== 'ok' || fp !== fingerprintOf(k)) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', keyOf(k), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}
