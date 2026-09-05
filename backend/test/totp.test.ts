// Le calcul du second facteur, éprouvé contre les vecteurs de la RFC 6238.
//
// C'est le seul endroit de l'application où « ça marche chez moi » ne suffit
// pas : un code doit valoir exactement ce que calcule l'application du
// téléphone, sinon personne ne peut se connecter et la panne est
// incompréhensible. Les vecteurs de la RFC sont la référence commune.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import {
  CHIFFRES, DERIVE, PAS_S, base32Decode, base32Encode, codePour, empreinteSecours,
  genererSecours, genererSecret, normaliserSecours, otpauthUri, pasDe, secretLisible, verifierCode,
} from '../src/auth/totp';

/** Le secret des vecteurs de la RFC 6238 : la chaîne ASCII « 12345678901234567890 ». */
const SECRET_RFC = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('les vecteurs de la RFC 6238', () => {
  // Table 1 de la RFC, colonne SHA-1, ramenée à six chiffres (la RFC en publie
  // huit ; les six de poids faible sont ceux qu'affichent les applications).
  const vecteurs: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ];

  for (const [secondes, attendu] of vecteurs) {
    it(`à t=${secondes}, le code est ${attendu}`, () => {
      assert.equal(codePour(SECRET_RFC, Math.floor(secondes / PAS_S)), attendu);
    });
  }

  it('le pas au-delà de 2^32 secondes est correct : le compteur tient sur 64 bits', () => {
    // t=20000000000 dépasse ce qu'un entier 32 bits peut porter. Un compteur
    // écrit sur quatre octets donnerait un code faux à partir de 2038, et
    // personne ne comprendrait pourquoi.
    assert.equal(codePour(SECRET_RFC, pasDe(20000000000 * 1000)), '353130');
  });
});

describe('la base32, dans les deux sens', () => {
  it('encode et décode sans rien perdre', () => {
    for (const n of [1, 5, 10, 20, 32]) {
      const octets = crypto.randomBytes(n);
      assert.deepEqual(base32Decode(base32Encode(octets)), octets, `${n} octets`);
    }
  });

  it('suit le RFC 4648 sur les exemples connus', () => {
    assert.equal(base32Encode(Buffer.from('f')), 'MY');
    assert.equal(base32Encode(Buffer.from('fo')), 'MZXQ');
    assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  });

  it('tolère les espaces et la casse d’un secret recopié à la main', () => {
    assert.deepEqual(base32Decode('mzxw 6ytb-oi'), Buffer.from('foobar'));
  });

  it('refuse un caractère inconnu plutôt que de deviner', () => {
    // Deviner produirait des codes silencieusement faux, et une panne que
    // personne ne saurait expliquer.
    for (const v of ['MZXW6YT!', '01234567', '', '   ']) assert.equal(base32Decode(v), null, v);
  });
});

describe('la vérification d’un code', () => {
  const T = 1_700_000_000_000;

  it('accepte le code du moment', () => {
    const secret = genererSecret();
    const code = codePour(secret, pasDe(T))!;
    assert.equal(verifierCode(secret, code, T), pasDe(T));
  });

  it('tolère une horloge de téléphone qui dérive', () => {
    const secret = genererSecret();
    for (const d of [-DERIVE, 0, DERIVE]) {
      const code = codePour(secret, pasDe(T) + d)!;
      assert.equal(verifierCode(secret, code, T), pasDe(T) + d, `dérive ${d}`);
    }
  });

  it('refuse au-delà de la fenêtre', () => {
    const secret = genererSecret();
    for (const d of [-(DERIVE + 1), DERIVE + 1, 10, -10]) {
      assert.equal(verifierCode(secret, codePour(secret, pasDe(T) + d)!, T), null, `dérive ${d}`);
    }
  });

  it('rend le pas, pas un simple oui : c’est ce qui permet de refuser un rejeu', () => {
    const secret = genererSecret();
    const pas = verifierCode(secret, codePour(secret, pasDe(T))!, T);
    assert.equal(typeof pas, 'number');
    assert.equal(pas, pasDe(T));
  });

  it('refuse ce qui n’a pas la forme d’un code', () => {
    const secret = genererSecret();
    for (const v of ['', '12345', '1234567', 'abcdef', '12 34 56', null as unknown as string]) {
      assert.equal(verifierCode(secret, v, T), null, String(v));
    }
  });

  it('accepte un code recopié avec un espace au milieu', () => {
    const secret = genererSecret();
    const code = codePour(secret, pasDe(T))!;
    assert.equal(verifierCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`, T), pasDe(T));
  });

  it('un code juste pour un autre secret ne passe pas', () => {
    const a = genererSecret();
    const b = genererSecret();
    assert.equal(verifierCode(b, codePour(a, pasDe(T))!, T), null);
  });
});

describe('l’URI que lit l’application du téléphone', () => {
  it('porte le secret, l’émetteur, et les paramètres du calcul', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'thomas@example.fr');
    assert.match(uri, /^otpauth:\/\/totp\/Foyer:thomas%40example\.fr\?/);
    const q = new URL(uri.replace('otpauth://', 'https://')).searchParams;
    assert.equal(q.get('secret'), 'JBSWY3DPEHPK3PXP');
    assert.equal(q.get('issuer'), 'Foyer');
    assert.equal(q.get('algorithm'), 'SHA1');
    assert.equal(q.get('digits'), String(CHIFFRES));
    assert.equal(q.get('period'), String(PAS_S));
  });

  it('l’émetteur est dans le chemin ET en paramètre : les applications ne lisent pas le même', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'lena@example.fr');
    assert.ok(uri.includes('/Foyer:'));
    assert.ok(uri.includes('issuer=Foyer'));
  });

  it('le secret se relit à l’oeil, par groupes de quatre', () => {
    assert.equal(secretLisible('JBSWY3DPEHPK3PXP'), 'JBSW Y3DP EHPK 3PXP');
  });
});

describe('les codes de secours', () => {
  it('dix codes, tous différents', () => {
    const codes = genererSecours();
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
  });

  it('ne portent aucun caractère qui se confonde à la main', () => {
    // Ni I ni 1, ni O ni 0 : ils se recopient de travers, et un code de secours
    // se recopie précisément le jour où l'on est déjà contrarié.
    for (const c of genererSecours().join('')) assert.ok(!'IO01'.includes(c), `« ${c} » se confond`);
  });

  it('portent assez d’aléa pour qu’il n’y ait rien à deviner', () => {
    // Dix caractères parmi trente-deux, soit cinquante bits. C'est ce qui
    // justifie de les hacher en SHA-256 plutôt qu'en bcrypt.
    for (const code of genererSecours()) assert.equal(normaliserSecours(code).length, 10);
  });

  it('se recopient sans que la casse ni les tirets ne comptent', () => {
    const code = genererSecours(1)[0];
    assert.equal(empreinteSecours(code.toLowerCase().replace('-', ' ')), empreinteSecours(code));
  });

  it('l’empreinte ne rend pas le code', () => {
    const code = genererSecours(1)[0];
    const e = empreinteSecours(code);
    assert.match(e, /^[0-9a-f]{64}$/);
    assert.ok(!e.includes(normaliserSecours(code)));
  });
});
