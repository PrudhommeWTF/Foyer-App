// Le module Atelier code sur ses vraies routes : qui lit et écrit quoi (un enfant
// ne voit que ses projets), l'enregistrement qui refuse d'écraser le travail d'un
// autre appareil, les médias nommés et nettoyés par le serveur, les limites, la
// corbeille que seul un adulte rouvre, et le module éteint puis rallumé sans
// rien perdre.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, brut, demarrer } from './securite-helpers';
import { png } from './equipements-fixtures';

let ctx: Contexte;
let lena = '', camille = '';
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const dessin = (d = 'M0 0 L10 10') => Buffer.from(`<svg ${NS}><path d="${d}"/></svg>`);
const projet = (extra: Record<string, unknown> = {}) => JSON.stringify({ pages: ['page 1'], currentPage: 'page 1', 'page 1': { sprites: [], layers: [] }, ...extra });
const creer = async (jeton: string, name = 'Projet 1') => (await appel(ctx.base, 'POST', '/atelier/projets', { name }, jeton)).json.projet as { id: string; rev: number; memberId: string };
/** Un GET qui rend les octets et les en-têtes, que `appel` ne donne pas. */
const lire = async (chemin: string, jeton: string) => {
  const res = await fetch(ctx.base + chemin, { headers: { authorization: 'Bearer ' + jeton } });
  return { status: res.status, type: res.headers.get('content-type'), csp: res.headers.get('content-security-policy'), nosniff: res.headers.get('x-content-type-options'), corps: Buffer.from(await res.arrayBuffer()) };
};

before(async () => {
  ctx = await demarrer();
  const ms = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin)).json.state.members as { id: string; name: string }[];
  lena = ms.find((m) => m.name === 'Lena')!.id;
  camille = ms.find((m) => m.name === 'Camille')!.id;
});
after(async () => { await arreter(ctx); });

describe('projets : qui lit et écrit quoi', () => {
  let aLena = '', aCamille = '';
  before(async () => { aLena = (await creer(ctx.jetons.enfant, 'Histoire de Lena')).id; aCamille = (await creer(ctx.jetons.membre, 'Essai de Camille')).id; });

  it('un enfant crée, relit, renomme et enregistre son projet', async () => {
    const lu = await appel(ctx.base, 'GET', `/atelier/projets/${aLena}`, undefined, ctx.jetons.enfant);
    assert.equal(lu.status, 200); assert.equal(lu.json.projet.memberId, lena); assert.equal(lu.json.projet.json, null);
    assert.equal((await appel(ctx.base, 'PATCH', `/atelier/projets/${aLena}`, { name: 'Le robot' }, ctx.jetons.enfant)).json.projet.name, 'Le robot');
    const enr = await appel(ctx.base, 'PUT', `/atelier/projets/${aLena}`, { rev: lu.json.projet.rev, name: 'Le robot', json: projet() }, ctx.jetons.enfant);
    assert.equal(enr.status, 200); assert.equal(enr.json.projet.rev, lu.json.projet.rev + 1);
  });

  it('un enfant ne voit que ses projets', async () => {
    const liste = await appel(ctx.base, 'GET', '/atelier/projets', undefined, ctx.jetons.enfant);
    assert.deepEqual(liste.json.projets.map((p: { id: string }) => p.id), [aLena]);
    assert.equal(liste.json.projets[0].json, undefined, 'la liste ne porte pas le JSON des projets');
    assert.equal((await appel(ctx.base, 'GET', `/atelier/projets/${aCamille}`, undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', `/atelier/projets?membre=${camille}`, undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'PUT', `/atelier/projets/${aCamille}`, { rev: 1, name: 'x', json: projet() }, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'DELETE', `/atelier/projets/${aCamille}`, undefined, ctx.jetons.enfant)).status, 403);
  });

  it('un adulte lit les projets d’un enfant, sans pouvoir les modifier', async () => {
    assert.equal((await appel(ctx.base, 'GET', `/atelier/projets/${aLena}`, undefined, ctx.jetons.membre)).status, 200);
    const liste = await appel(ctx.base, 'GET', `/atelier/projets?membre=${lena}`, undefined, ctx.jetons.membre);
    assert.deepEqual(liste.json.projets.map((p: { id: string }) => p.id), [aLena]);
    assert.equal((await appel(ctx.base, 'PUT', `/atelier/projets/${aLena}`, { rev: 2, name: 'x', json: projet() }, ctx.jetons.membre)).status, 403);
    assert.equal((await appel(ctx.base, 'PATCH', `/atelier/projets/${aLena}`, { name: 'x' }, ctx.jetons.membre)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', '/atelier/projets?membre=inconnu', undefined, ctx.jetons.membre)).status, 404);
  });

  it('refuse sans session, sans membre, et avec un jeton d’accès', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/atelier/projets')).status, 401);
    assert.equal((await appel(ctx.base, 'GET', '/atelier/projets', undefined, ctx.jetons.sansMembre)).status, 403);
    const jeton = await appel(ctx.base, 'POST', '/me/tokens', { name: 'Script', scope: 'write', password: 'MotDePasseSolide2' }, ctx.jetons.membre);
    assert.equal(jeton.status, 201, JSON.stringify(jeton.json));
    assert.equal((await appel(ctx.base, 'GET', '/atelier/projets', undefined, jeton.json.token)).status, 403);
  });

  it('un identifiant qui n’existe pas répond 404, pas 500', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/atelier/projets/pas-un-uuid', undefined, ctx.jetons.enfant)).status, 404);
    assert.equal((await appel(ctx.base, 'GET', '/atelier/projets/00000000-0000-4000-8000-000000000000', undefined, ctx.jetons.enfant)).status, 404);
  });
});

describe('enregistrement : jamais d’écrasement silencieux', () => {
  it('le second appareil reçoit un conflit et la version du serveur', async () => {
    const p = await creer(ctx.jetons.enfant, 'Deux appareils');
    const ipad = await appel(ctx.base, 'PUT', `/atelier/projets/${p.id}`, { rev: p.rev, name: 'Depuis l’iPad', json: projet({ a: 1 }) }, ctx.jetons.enfant);
    assert.equal(ipad.status, 200);
    const mac = await appel(ctx.base, 'PUT', `/atelier/projets/${p.id}`, { rev: p.rev, name: 'Depuis le Mac', json: projet({ a: 2 }) }, ctx.jetons.enfant);
    assert.equal(mac.status, 409); assert.equal(mac.json.code, 'conflit'); assert.equal(mac.json.projet.rev, p.rev + 1);
    const lu = await appel(ctx.base, 'GET', `/atelier/projets/${p.id}`, undefined, ctx.jetons.enfant);
    assert.equal(lu.json.projet.name, 'Depuis l’iPad'); assert.equal(JSON.parse(lu.json.projet.json).a, 1);
    // « Garder cette version » : le Mac renvoie avec la version que le serveur lui a rendue.
    const force = await appel(ctx.base, 'PUT', `/atelier/projets/${p.id}`, { rev: mac.json.projet.rev, name: 'Depuis le Mac', json: projet({ a: 2 }) }, ctx.jetons.enfant);
    assert.equal(force.status, 200);
  });

  it('refuse ce qui n’est pas un projet', async () => {
    const p = await creer(ctx.jetons.enfant, 'Forme');
    for (const json of ['{', '[]', '{"pages":"x"}', JSON.stringify({ pages: ['1', '2', '3', '4', '5'] }), 12, undefined]) {
      assert.equal((await appel(ctx.base, 'PUT', `/atelier/projets/${p.id}`, { rev: p.rev, name: 'x', json }, ctx.jetons.enfant)).status, 400, String(json));
    }
    assert.equal((await appel(ctx.base, 'PUT', `/atelier/projets/${p.id}`, { name: 'x', json: projet() }, ctx.jetons.enfant)).status, 400, 'sans rev');
    assert.equal((await appel(ctx.base, 'PUT', `/atelier/projets/${p.id}`, { rev: p.rev, name: 'x', json: projet(), thumbnail: JSON.stringify({ md5: 'a'.repeat(32) + '.png' }) }, ctx.jetons.enfant)).status, 400, 'vignette inconnue');
  });
});

describe('médias', () => {
  it('le serveur nomme le média d’après le contenu qu’il a nettoyé', async () => {
    const sale = Buffer.from(`<svg ${NS} onload="x()"><script>x()</script><path d="M1 1"/></svg>`);
    const r = await brut(ctx.base, '/atelier/medias', sale, ctx.jetons.enfant);
    assert.equal(r.status, 201); assert.match(r.json.name, /^[0-9a-f]{32}\.svg$/);
    const lu = await lire(`/atelier/medias/${r.json.name}`, ctx.jetons.enfant);
    assert.equal(lu.status, 200); assert.equal(lu.corps.toString(), `<svg ${NS}><path d="M1 1"/></svg>`);
    // Servi comme une image inerte, jamais comme un document.
    assert.equal(lu.type, 'image/svg+xml'); assert.equal(lu.nosniff, 'nosniff'); assert.match(lu.csp ?? '', /default-src 'none'.*sandbox/);
    // Le même contenu propre, envoyé sans le script, a le même nom : pas de second fichier.
    const encore = await brut(ctx.base, '/atelier/medias', Buffer.from(`<svg ${NS}><path d="M1 1"/></svg>`), ctx.jetons.enfant);
    assert.equal(encore.status, 200); assert.equal(encore.json.name, r.json.name);
  });

  it('accepte une vignette PNG, refuse le reste', async () => {
    assert.equal((await brut(ctx.base, '/atelier/medias', png(192, 144), ctx.jetons.enfant)).status, 201);
    assert.equal((await brut(ctx.base, '/atelier/medias', png(4000, 3000), ctx.jetons.enfant)).status, 422);
    assert.equal((await brut(ctx.base, '/atelier/medias', Buffer.from('%PDF-1.4 ceci est un pdf'), ctx.jetons.enfant)).status, 415);
    assert.equal((await brut(ctx.base, '/atelier/medias', Buffer.from('<html><script>x</script></html>'), ctx.jetons.enfant)).status, 422);
    assert.equal((await brut(ctx.base, '/atelier/medias', Buffer.from('du texte, rien de plus'), ctx.jetons.enfant)).status, 415);
  });

  it('un média n’est lu que par son propriétaire et par les adultes', async () => {
    const r = await brut(ctx.base, '/atelier/medias', dessin('M2 2'), ctx.jetons.enfant);
    assert.equal((await lire(`/atelier/medias/${r.json.name}`, ctx.jetons.membre)).status, 404, 'un adulte sans ?membre= cherche chez lui');
    assert.equal((await lire(`/atelier/medias/${r.json.name}?membre=${lena}`, ctx.jetons.membre)).status, 200);
    const chezCamille = await brut(ctx.base, '/atelier/medias', dessin('M3 3'), ctx.jetons.membre);
    assert.equal((await lire(`/atelier/medias/${chezCamille.json.name}`, ctx.jetons.enfant)).status, 404);
    assert.equal((await lire(`/atelier/medias/${chezCamille.json.name}?membre=${camille}`, ctx.jetons.enfant)).status, 403);
    assert.equal((await lire('/atelier/medias/..%2F..%2Ffoyer.db', ctx.jetons.enfant)).status, 404);
  });

  it('la route générique des fichiers ne sert pas un média de l’Atelier', async () => {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(path.join(ctx.dir, 'foyer.db'), { readonly: true });
    const id = (db.prepare("SELECT id FROM hh_attachments WHERE owner_kind = 'atelier' LIMIT 1").get() as { id: number }).id;
    db.close();
    assert.equal((await lire(`/files/${id}`, ctx.jetons.admin)).status, 404);
  });

  it('un média cité par un projet ne se retire pas, un média libre si', async () => {
    const p = await creer(ctx.jetons.enfant, 'Avec dessin');
    const cite = (await brut(ctx.base, '/atelier/medias', dessin('M4 4'), ctx.jetons.enfant)).json.name as string;
    const libre = (await brut(ctx.base, '/atelier/medias', dessin('M5 5'), ctx.jetons.enfant)).json.name as string;
    await appel(ctx.base, 'PUT', `/atelier/projets/${p.id}`, { rev: p.rev, name: 'Avec dessin', json: projet({ 'page 1': { sprites: ['a'], a: { md5: cite } } }) }, ctx.jetons.enfant);
    for (const n of [cite, libre]) assert.equal((await appel(ctx.base, 'DELETE', `/atelier/medias/${n}`, undefined, ctx.jetons.enfant)).status, 200);
    assert.equal((await lire(`/atelier/medias/${cite}`, ctx.jetons.enfant)).status, 200);
    assert.equal((await lire(`/atelier/medias/${libre}`, ctx.jetons.enfant)).status, 404);
  });

  it('mes personnages : rangés, relus, retirés, et seulement les siens', async () => {
    const md5 = (await brut(ctx.base, '/atelier/medias', dessin('M6 6'), ctx.jetons.enfant)).json.name as string;
    const ajout = await appel(ctx.base, 'POST', '/atelier/elements', { kind: 'personnage', md5, name: 'Dragon', scale: '0.5', width: '80', height: '90', ext: 'svg' }, ctx.jetons.enfant);
    assert.equal(ajout.status, 201);
    assert.deepEqual((await appel(ctx.base, 'GET', '/atelier/elements?kind=personnage', undefined, ctx.jetons.enfant)).json.elements.map((e: { name: string }) => e.name), ['Dragon']);
    assert.deepEqual((await appel(ctx.base, 'GET', '/atelier/elements?kind=decor', undefined, ctx.jetons.enfant)).json.elements, []);
    assert.equal((await appel(ctx.base, 'POST', '/atelier/elements', { kind: 'personnage', md5: 'f'.repeat(32) + '.svg' }, ctx.jetons.enfant)).status, 400, 'dessin jamais envoyé');
    assert.equal((await appel(ctx.base, 'DELETE', `/atelier/elements/${ajout.json.element.id}`, undefined, ctx.jetons.membre)).status, 404);
    assert.equal((await appel(ctx.base, 'DELETE', `/atelier/elements/${ajout.json.element.id}`, undefined, ctx.jetons.enfant)).status, 200);
    assert.deepEqual((await appel(ctx.base, 'GET', '/atelier/elements?kind=personnage', undefined, ctx.jetons.enfant)).json.elements, []);
  });
});

describe('limites, corbeille, module', () => {
  it('le nombre de projets est plafonné par le réglage, avec un message pour l’enfant', async () => {
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { atelierProjetsMax: 10 } }, ctx.jetons.admin)).status, 200);
    const deja = (await appel(ctx.base, 'GET', '/atelier/contexte', undefined, ctx.jetons.enfant)).json.utilise.projets as number;
    for (let i = deja; i < 10; i++) await creer(ctx.jetons.enfant, `Projet ${i}`);
    const trop = await appel(ctx.base, 'POST', '/atelier/projets', { name: 'De trop' }, ctx.jetons.enfant);
    assert.equal(trop.status, 409); assert.equal(trop.json.code, 'projets_max'); assert.match(trop.json.error, /Supprime un vieux projet/);
  });

  it('supprimer archive : l’enfant ne voit plus le projet, un adulte le restaure', async () => {
    const liste = (await appel(ctx.base, 'GET', '/atelier/projets', undefined, ctx.jetons.enfant)).json.projets as { id: string }[];
    const id = liste[0]!.id;
    assert.equal((await appel(ctx.base, 'DELETE', `/atelier/projets/${id}`, undefined, ctx.jetons.enfant)).status, 200);
    assert.ok(!(await appel(ctx.base, 'GET', '/atelier/projets', undefined, ctx.jetons.enfant)).json.projets.some((p: { id: string }) => p.id === id));
    assert.equal((await appel(ctx.base, 'PUT', `/atelier/projets/${id}`, { rev: 1, name: 'x', json: projet() }, ctx.jetons.enfant)).status, 410);
    assert.equal((await appel(ctx.base, 'GET', '/atelier/projets?corbeille=1', undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', `/atelier/projets/${id}/restaurer`, undefined, ctx.jetons.enfant)).status, 403);
    const corbeille = await appel(ctx.base, 'GET', `/atelier/projets?membre=${lena}&corbeille=1`, undefined, ctx.jetons.membre);
    assert.deepEqual(corbeille.json.projets.map((p: { id: string }) => p.id), [id]);
    assert.equal((await appel(ctx.base, 'POST', `/atelier/projets/${id}/restaurer`, undefined, ctx.jetons.membre)).status, 200);
    assert.ok((await appel(ctx.base, 'GET', '/atelier/projets', undefined, ctx.jetons.enfant)).json.projets.some((p: { id: string }) => p.id === id));
  });

  it('la purge ne retire que ce qui est archivé depuis plus longtemps que le délai', async () => {
    const { purgeArchived, getProject } = await import('../src/atelier/repo');
    const garde = await creer(ctx.jetons.membre, 'À garder');
    const vieux = await creer(ctx.jetons.membre, 'Vieux');
    const m = (await brut(ctx.base, '/atelier/medias', dessin('M7 7'), ctx.jetons.membre)).json.name as string;
    await appel(ctx.base, 'PUT', `/atelier/projets/${vieux.id}`, { rev: vieux.rev, name: 'Vieux', json: projet({ dessin: m }) }, ctx.jetons.membre);
    await appel(ctx.base, 'DELETE', `/atelier/projets/${vieux.id}`, undefined, ctx.jetons.membre);
    assert.deepEqual(purgeArchived(30), { projects: 0, media: 0 }, 'archivé à l’instant : rien ne part');
    assert.ok(getProject(vieux.id));
    // Délai négatif : « archivé depuis plus de -1 jour » est vrai pour tout ce qui est archivé.
    const r = purgeArchived(-1);
    assert.equal(r.projects, 1); assert.ok(r.media >= 1);
    assert.equal(getProject(vieux.id), null); assert.ok(getProject(garde.id));
    assert.equal((await lire(`/atelier/medias/${m}`, ctx.jetons.membre)).status, 404);
  });

  it('module éteint : tout répond 403, rien n’est perdu, tout revient', async () => {
    const avant = (await appel(ctx.base, 'GET', '/atelier/projets', undefined, ctx.jetons.enfant)).json.projets.length as number;
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modAtelier: false } }, ctx.jetons.admin)).status, 200);
    for (const [m, c] of [['GET', '/atelier/projets'], ['GET', '/atelier/contexte'], ['POST', '/atelier/projets']] as const) {
      assert.equal((await appel(ctx.base, m, c, m === 'POST' ? { name: 'x' } : undefined, ctx.jetons.enfant)).status, 403, c);
    }
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modAtelier: true } }, ctx.jetons.admin)).status, 200);
    assert.equal((await appel(ctx.base, 'GET', '/atelier/projets', undefined, ctx.jetons.enfant)).json.projets.length, avant);
  });

  it('la remise à zéro du module efface projets, médias et fichiers', async () => {
    const compte = (await appel(ctx.base, 'GET', '/modules', undefined, ctx.jetons.admin)).json.counts.atelier;
    assert.ok(compte.projets > 0 && compte.medias > 0);
    assert.equal((await appel(ctx.base, 'POST', '/modules/atelier/reset', { confirm: 'SUPPRIMER' }, ctx.jetons.membre)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', '/modules/atelier/reset', { confirm: 'SUPPRIMER' }, ctx.jetons.admin)).status, 200);
    assert.deepEqual((await appel(ctx.base, 'GET', '/modules', undefined, ctx.jetons.admin)).json.counts.atelier, { projets: 0, medias: 0 });
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(path.join(ctx.dir, 'foyer.db'), { readonly: true });
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM hh_attachments WHERE owner_kind = 'atelier'").get() as { n: number }).n, 0);
    db.close();
    assert.ok(fs.existsSync(path.join(ctx.dir, 'foyer.db')));
  });
});
