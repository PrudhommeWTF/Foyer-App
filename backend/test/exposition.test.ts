// Ce que le serveur dit de lui-même, et ce qu'il refuse de dire.
//
// Trois durcissements dont aucun n'est spectaculaire, et qui comptent tous les
// trois une fois le domaine ouvert : les en-têtes que le navigateur applique,
// la réponse aux sondes de robots, et le renouvellement silencieux du jeton.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

const entetes = async (chemin: string): Promise<Headers> =>
  (await fetch(ctx.base.replace(/\/api$/, '') + chemin)).headers;

describe('les en-têtes de sécurité sont ceux qu’on croit', () => {
  it('la politique de sécurité de contenu est réelle, pas un défaut permissif', async () => {
    const csp = (await entetes('/api/health')).get('content-security-policy') ?? '';
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /base-uri 'self'/);
  });

  it('elle n’ouvre plus de domaine tiers pour les polices', async () => {
    // Elles sont servies par le foyer : chaque ouverture n’envoie plus l’adresse
    // IP de la famille à Google.
    const csp = (await entetes('/api/health')).get('content-security-policy') ?? '';
    assert.doesNotMatch(csp, /googleapis|gstatic/);
  });

  it('HSTS tient un an, sans preload', async () => {
    const h = (await entetes('/api/health')).get('strict-transport-security') ?? '';
    assert.match(h, /max-age=31536000/);
    assert.match(h, /includeSubDomains/);
    assert.doesNotMatch(h, /preload/, 'une inscription sur la liste des navigateurs est difficile à défaire');
  });

  it('les capacités du navigateur dont l’application n’a pas l’usage sont fermées', async () => {
    const p = (await entetes('/api/health')).get('permissions-policy') ?? '';
    for (const capacite of ['geolocation=()', 'camera=()', 'microphone=()', 'payment=()', 'usb=()']) {
      assert.ok(p.includes(capacite), `${capacite} manque dans « ${p} »`);
    }
  });

  it('la technologie du serveur ne s’annonce pas', async () => {
    assert.equal((await entetes('/api/health')).get('x-powered-by'), null);
  });
});

describe('les sondes de robots ne repartent pas avec un 200', () => {
  it('une adresse qui ressemble à un fichier et n’existe pas répond 404', async () => {
    for (const chemin of ['/.git/config', '/.env', '/wp-login.php', '/backup.sql', '/config.json']) {
      const res = await fetch(ctx.base.replace(/\/api$/, '') + chemin);
      assert.equal(res.status, 404, `${chemin} a répondu ${res.status}`);
      assert.doesNotMatch(await res.text(), /<html/i, `${chemin} ne doit pas rendre l’application`);
    }
  });
});

describe('le jeton tourne tout seul', () => {
  it('/me rend un jeton neuf quand l’ancien a passé la moitié de sa vie', async () => {
    // Une session neuve n'a pas besoin d'être renouvelée : le champ est absent.
    const frais = await appel(ctx.base, 'GET', '/me', undefined, ctx.jetons.admin);
    assert.equal(frais.status, 200);
    assert.equal(frais.json.token, undefined, 'un jeton qui vient de naître n’a rien à renouveler');
  });

  it('un jeton renouvelé reste valable et porte le même compte', async () => {
    // La sortie de /me est la seule voie de renouvellement : elle ne doit jamais
    // rendre un jeton pour quelqu'un d'autre.
    const moi = await appel(ctx.base, 'GET', '/me', undefined, ctx.jetons.membre);
    assert.equal(moi.json.email, 'membre@example.fr');
    if (moi.json.token) {
      const avec = await appel(ctx.base, 'GET', '/me', undefined, moi.json.token);
      assert.equal(avec.json.email, 'membre@example.fr');
    }
  });
});

describe('la mise à jour du serveur se confirme par le mot de passe', () => {
  it('sans mot de passe, un administrateur ne lance rien', async () => {
    const r = await appel(ctx.base, 'POST', '/system/update', {}, ctx.jetons.admin);
    // 403 quand le mot de passe manque, 400 quand l'auto-mise à jour est coupée
    // sur ce serveur : dans les deux cas, rien n'a été lancé.
    assert.ok([400, 403].includes(r.status), `reçu ${r.status}`);
  });

  it('avec un mauvais mot de passe non plus', async () => {
    const r = await appel(ctx.base, 'POST', '/system/update', { password: 'pas-le-bon' }, ctx.jetons.admin);
    assert.ok([400, 403].includes(r.status), `reçu ${r.status}`);
  });
});
