// La sortie réseau se connecte à l'adresse qu'elle a validée, et pas à une autre.
//
// C'était le contournement qui restait après tous les autres gardes : vérifier
// le nom, puis laisser la couche réseau le résoudre une seconde fois, laisse une
// fenêtre. Un domaine dont le TTL est très court répond une adresse publique à
// la vérification et 192.168.1.10 à la requête, et le conteneur va lire le
// Synology ou l'interface du routeur du foyer.
//
// La propriété qui ferme cette fenêtre est simple à formuler : **le nom ne
// décide plus où la connexion s'ouvre**. Il ne sert qu'au certificat et à
// l'en-tête Host. C'est ce que ce fichier vérifie, sur un vrai serveur local.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { FetchError, isPrivateAddress, requetePinned, resolvePublicUrl } from '../src/recipes/fetch';

let serveur: http.Server;
let port: number;
/** Ce que le serveur a réellement reçu : c'est là que se lit l'en-tête Host. */
let recu: { host?: string; url?: string } = {};

before(async () => {
  serveur = http.createServer((req, res) => {
    recu = { host: req.headers.host, url: req.url };
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body>page servie</body></html>');
  });
  await new Promise<void>((r) => serveur.listen(0, '127.0.0.1', r));
  port = (serveur.address() as { port: number }).port;
});
after(async () => { await new Promise<void>((r) => serveur.close(() => r())); });

const lire = (res: http.IncomingMessage): Promise<string> => new Promise((resolve) => {
  let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve(t));
});

describe('la connexion s’ouvre sur l’adresse donnée, pas sur le nom', () => {
  it('le nom ne sert qu’à l’en-tête Host', async () => {
    // Un nom qui ne se résout nulle part : si la connexion passait par lui,
    // elle échouerait. Elle aboutit parce que l'adresse est épinglée.
    const url = new URL(`http://nom-qui-nexiste-pas.invalid:${port}/recette`);
    const res = await requetePinned(url, '127.0.0.1', 'text/html');
    assert.equal(res.statusCode, 200);
    assert.match(await lire(res), /page servie/);
    assert.equal(recu.host, `nom-qui-nexiste-pas.invalid:${port}`, 'le site doit voir son propre nom');
    assert.equal(recu.url, '/recette');
  });

  it('changer l’adresse change la destination, à nom identique', async () => {
    const url = new URL(`http://nom-qui-nexiste-pas.invalid:${port}/x`);
    // Une adresse où personne n'écoute : la requête échoue, ce qui prouve que
    // c'est bien l'adresse, et non le nom, qui décide.
    await assert.rejects(() => requetePinned(url, '127.0.0.2', 'text/html'));
  });
});

describe('l’adresse validée est celle qui est rendue', () => {
  it('une adresse écrite en clair est sa propre épingle', async () => {
    const cible = await resolvePublicUrl('https://203.0.113.10/page');
    assert.equal(cible.adresse, '203.0.113.10');
    assert.equal(cible.url.hostname, '203.0.113.10');
  });

  it('un nom du réseau local est refusé sans qu’aucune connexion parte', async () => {
    for (const u of ['http://192.168.1.1/x', 'http://127.0.0.1/x', 'http://[::1]/x', 'http://169.254.169.254/latest/meta-data/']) {
      await assert.rejects(() => resolvePublicUrl(u), (e: Error) => e instanceof FetchError && /réseau local/.test(e.message), u);
    }
  });

  it('les schémas exotiques et les identifiants dans l’URL sont refusés', async () => {
    await assert.rejects(() => resolvePublicUrl('file:///etc/passwd'), (e: Error) => /http et https/.test(e.message));
    await assert.rejects(() => resolvePublicUrl('gopher://203.0.113.10/'), (e: Error) => /http et https/.test(e.message));
    await assert.rejects(() => resolvePublicUrl('http://user:mdp@203.0.113.10/'), (e: Error) => /identifiant/.test(e.message));
  });
});

describe('les plages que le serveur n’a rien à aller chercher', () => {
  it('les bancs d’essai des opérateurs sont refusés', () => {
    for (const ip of ['198.18.0.1', '198.19.255.254']) assert.equal(isPrivateAddress(ip), true, ip);
  });

  it('le v4 encapsulé dans du v6 est jugé sur sa partie v4', () => {
    for (const ip of ['2002:c0a8:0101::1', '64:ff9b::c0a8:101']) assert.equal(isPrivateAddress(ip), true, ip);
  });

  it('les plages de documentation restent passantes : elles ne mènent nulle part', () => {
    // Les interdire ne protégerait de rien (elles ne sont routables nulle part)
    // et priverait les tests et la documentation d'adresses publiques factices.
    for (const ip of ['203.0.113.10', '198.51.100.7']) assert.equal(isPrivateAddress(ip), false, ip);
  });
});
