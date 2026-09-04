// Gardes de la seule sortie réseau du module Cuisine.
//
// Foyer tourne sur un réseau domestique où vivent un hyperviseur, un routeur et
// d'autres services. Le serveur va chercher une adresse que l'utilisateur colle :
// sans ces gardes, l'API deviendrait une porte d'entrée vers le LAN. Ces tests
// portent sur cette frontière, pas sur le confort d'usage.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FetchError, assertPublicUrl, isPrivateAddress, networkReason } from '../src/recipes/fetch';

const refuse = async (url: string, motif: RegExp): Promise<void> => {
  await assert.rejects(
    () => assertPublicUrl(url),
    (e: Error) => e instanceof FetchError && motif.test(e.message),
    url,
  );
};

describe('adresses que le serveur ne doit pas aller chercher', () => {
  it('refuse la boucle locale, en v4 comme en v6', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '0.0.0.0', '::1', '::']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  it('refuse les réseaux privés du RFC 1918', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  it('refuse le lien-local, dont les métadonnées d’hébergeur', () => {
    // 169.254.169.254 sert les identifiants d'instance chez la plupart des
    // hébergeurs : c'est la cible classique de ce genre d'attaque.
    for (const ip of ['169.254.169.254', '169.254.0.1', 'fe80::1']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  it('refuse le CGNAT, le multicast et les plages réservées', () => {
    for (const ip of ['100.64.0.1', '224.0.0.1', '255.255.255.255', 'ff02::1']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  it('refuse l’IPv6 privé et l’IPv4 encapsulée dans de l’IPv6', () => {
    // ::ffff:127.0.0.1 est de la boucle locale déguisée.
    for (const ip of ['fd00::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:192.168.0.1']) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  it('refuse ce qui n’est pas une adresse : dans le doute, non', () => {
    for (const v of ['', 'localhost', 'pas-une-ip', '1.2.3', '999.1.1.1']) {
      assert.equal(isPrivateAddress(v), true, v);
    }
  });

  it('accepte les adresses publiques', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700::1111']) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });
});

describe('validation d’une URL collée', () => {
  it('refuse une adresse IP privée écrite en clair, sans résolution DNS', async () => {
    await refuse('http://192.168.1.1/admin', /réseau local/);
    await refuse('http://127.0.0.1:8099/api/state', /réseau local/);
    await refuse('http://[::1]/x', /réseau local/);
    await refuse('http://169.254.169.254/latest/meta-data/', /réseau local/);
  });

  it('refuse les protocoles qui ne sont pas du web', async () => {
    for (const u of ['file:///etc/passwd', 'ftp://exemple.test/x', 'gopher://exemple.test/']) {
      await refuse(u, /http et https/);
    }
  });

  it('refuse une adresse portant un identifiant', async () => {
    // http://user:pass@hote fait fuiter des identifiants dans les journaux et
    // sert aussi à masquer le vrai hôte à l'œil nu.
    await refuse('https://admin:motdepasse@exemple.test/x', /identifiant/);
  });

  it('refuse ce qui n’est pas une adresse, en disant quoi faire', async () => {
    await refuse('gratin de courgettes', /Collez le lien complet/);
    await refuse('', /Collez le lien complet/);
  });

  it('refuse un nom de domaine introuvable, en nommant le domaine', async () => {
    await refuse(
      'https://domaine-qui-nexiste-vraiment-pas-' + 'x'.repeat(30) + '.invalid/r',
      /introuvable/,
    );
  });

  it('résout « localhost » et le refuse comme adresse locale', async () => {
    // Vérifier le nom ne suffirait pas : c'est la résolution qui tranche.
    await refuse('http://localhost:8099/', /réseau local|introuvable/);
  });
});

describe('ce que le message dit quand le réseau lâche', () => {
  // Sans cela, toute panne se résume à « site injoignable », qui ne dit ni quoi
  // vérifier ni chez qui. L'exploitant est seul devant son conteneur.
  const echec = (cause: unknown, name = 'TypeError'): string =>
    networkReason(Object.assign(new Error('fetch failed'), { name, cause }));

  it('traduit les codes système en une phrase actionnable', () => {
    assert.match(echec({ code: 'ENOTFOUND' }), /ne se résout pas/);
    assert.match(echec({ code: 'ECONNREFUSED' }), /refusé la connexion/);
    assert.match(echec({ code: 'ECONNRESET' }), /coupé la connexion/);
    assert.match(echec({ code: 'CERT_HAS_EXPIRED' }), /certificat.*expiré/);
    assert.match(echec({ code: 'EPROTO' }), /TLS/);
  });

  it('oriente vers l’IPv6 quand aucune route n’existe', () => {
    // Panne classique en LXC : une adresse IPv6 annoncée, mais pas routée.
    assert.match(echec({ code: 'ENETUNREACH' }), /IPv6/);
  });

  it('rassemble les échecs quand plusieurs adresses ont été essayées', () => {
    // Node tente l'IPv4 puis l'IPv6 et agrège : c'est la trace la plus parlante
    // d'une pile IPv6 cassée, et elle serait perdue sans ce traitement.
    const msg = echec({ errors: [{ code: 'ENETUNREACH' }, { code: 'ETIMEDOUT' }, { code: 'ENETUNREACH' }] });
    assert.match(msg, /route/);
    assert.match(msg, /expiré/);
    assert.equal(msg.split(', ').length, 2, 'les doublons sont fondus');
  });

  it('rend le code brut plutôt que rien quand il est inconnu', () => {
    assert.equal(echec({ code: 'EMACHIN' }), 'EMACHIN');
    assert.equal(echec({ message: 'bad port' }), 'bad port');
  });

  it('distingue le délai dépassé du reste', () => {
    assert.match(echec(undefined, 'TimeoutError'), /n’a pas répondu à temps/);
  });

  it('dénonce une requête que Foyer n’a pas su construire', () => {
    // Le cas vécu : le User-Agent portait une apostrophe typographique, « fetch »
    // levait sans jamais toucher au réseau, et le message parlait de site
    // injoignable. Des heures cherchées du mauvais côté. Une erreur sans cause
    // n'est pas une panne du site, et doit le dire.
    assert.match(
      networkReason(Object.assign(new Error('Cannot convert argument to a ByteString'), { name: 'TypeError' })),
      /n’a pas pu être émise.*ByteString/,
    );
    assert.match(networkReason(new Error('vide')), /n’a pas pu être émise/);
    assert.match(networkReason(null), /n’a pas pu être émise|connexion impossible/);
  });
});
