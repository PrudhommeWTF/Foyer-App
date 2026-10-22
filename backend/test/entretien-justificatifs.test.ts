// La note et les justificatifs d'une réalisation d'entretien, et le carnet
// d'entretien : un enfant écrit une note mais ne voit aucun justificatif ni le
// carnet ; un justificatif n'est servi que par le module ; annuler une
// réalisation ne perd ni sa note ni son attestation ; un geste supprimé emporte
// ses notes, et ses fichiers partent au ménage du démarrage.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, Reponse, appel, arreter, demarrer } from './securite-helpers';
import { jpeg } from './equipements-fixtures';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x22)]);

describe('Entretien : notes, justificatifs et carnet', () => {
  let ctx: Contexte;
  before(async () => { ctx = await demarrer(); });
  after(async () => { await arreter(ctx); });

  const A = () => ctx.jetons.admin;
  const M = () => ctx.jetons.membre;
  const E = () => ctx.jetons.enfant;
  let n = 0;
  const ops = async (list: Record<string, unknown>[], jeton = M()) => {
    const r = await appel(ctx.base, 'POST', '/tasks/ops', { ops: list.map((o) => ({ opId: 'j-' + (++n), ...o })) }, jeton);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  };
  const geste = async (id: string) => ((await appel(ctx.base, 'GET', '/state', undefined, A())).json.state.tasks as { id: string; due: string; history?: { at: string }[] }[]).find((t) => t.id === id)!;
  const url = (id: string, at: string) => `/entretien/gestes/${id}/realisations/${encodeURIComponent(at)}`;
  const noter = (id: string, at: string, note: string, jeton = M()) => appel(ctx.base, 'PUT', url(id, at) + '/note', { note }, jeton);
  const lire = (id: string, jeton = M()) => appel(ctx.base, 'GET', `/entretien/gestes/${id}/realisations`, undefined, jeton);
  const joindre = async (id: string, at: string, corps: Buffer, nom: string, jeton = M()): Promise<Reponse> => {
    const res = await fetch(`${ctx.base}${url(id, at)}/justificatifs?filename=${encodeURIComponent(nom)}`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer ' + jeton }, body: new Uint8Array(corps),
    });
    return { status: res.status, json: await res.json() };
  };
  const telecharger = (chemin: string, jeton: string) => fetch(ctx.base + chemin, { headers: { authorization: 'Bearer ' + jeton } });
  const jour = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

  let fait = '';
  let attestation = 0;

  it('une note se pose sur une réalisation, par un adulte comme par un enfant', async () => {
    const st = (await appel(ctx.base, 'GET', '/state', undefined, A())).json;
    await appel(ctx.base, 'PUT', '/state', { state: { ...st.state, rooms: [{ id: 'chauf', name: 'Chaufferie', position: 0 }] }, version: st.version }, A());
    await ops([{ op: 'add', id: 'chaudiere', listId: 'entretien', text: 'Chaudière : entretien annuel', who: [], due: null,
      rec: { freq: 'yearly', every: 1, base: 'done' }, maintenance: { roomId: 'chauf' } }]);
    await ops([{ op: 'done', id: 'chaudiere', occ: '', at: `${jour(2)}T09:00:00Z` }]);
    fait = (await geste('chaudiere')).history![0].at;

    assert.equal((await noter('chaudiere', fait, 'Brûleur nettoyé, rien à signaler')).status, 200);
    const r = await noter('chaudiere', fait, 'Brûleur nettoyé, rien à signaler. Le technicien repasse en 2027.', E());
    assert.equal(r.status, 200, 'un enfant écrit une note');
    assert.equal(r.json.realisations[0].note, 'Brûleur nettoyé, rien à signaler. Le technicien repasse en 2027.');
    assert.equal((await noter('chaudiere', '2020-01-01T00:00:00.000Z', 'inventée')).status, 404, 'pas de note sur une réalisation inconnue');
    assert.equal((await noter('inconnu', fait, 'x')).status, 404);
    assert.equal((await noter('chaudiere', fait, 'x'.repeat(1001))).status, 400);
  });

  it('un justificatif : photo réduite ou PDF, adultes seulement, jamais par la route générique', async () => {
    assert.equal((await joindre('chaudiere', fait, PDF, 'attestation.pdf', E())).status, 403, 'un enfant ne joint pas de justificatif');
    assert.equal((await joindre('chaudiere', fait, jpeg(4032, 3024), 'grande.jpg')).status, 422);
    assert.equal((await joindre('chaudiere', fait, Buffer.alloc(80, 7), 'rien.bin')).status, 415);
    assert.equal((await joindre('chaudiere', '2020-01-01T00:00:00.000Z', PDF, 'a.pdf')).status, 404);

    const j = await joindre('chaudiere', fait, PDF, 'attestation chaudière.pdf');
    assert.equal(j.status, 201, JSON.stringify(j.json));
    attestation = j.json.file.id;
    assert.equal(j.json.realisations[0].files[0].name, 'attestation chaudière.pdf');

    const res = await telecharger(`/entretien/justificatifs/${attestation}`, M());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PDF);
    assert.equal((await telecharger(`/entretien/justificatifs/${attestation}`, E())).status, 403);
    assert.equal((await telecharger(`/files/${attestation}`, A())).status, 404, 'pas de porte dérobée par /api/files');
  });

  it('un enfant lit les notes, sans justificatif ni leur nombre', async () => {
    const e = (await lire('chaudiere', E())).json.realisations;
    assert.equal(e.length, 1);
    assert.equal(e[0].files, undefined);
    const m = (await lire('chaudiere')).json.realisations;
    assert.equal(m[0].files.length, 1);
  });

  it('annuler la réalisation garde sa note et son attestation', async () => {
    // La réalisation soldait « Pas encore noté » : l'occurrence rouverte est vide.
    await ops([{ op: 'reopen', id: 'chaudiere', occ: '' }]);
    assert.equal((await geste('chaudiere')).history?.length ?? 0, 0);
    const r = (await lire('chaudiere')).json.realisations;
    assert.equal(r.length, 1, 'toujours là');
    assert.equal(r[0].files.length, 1);
    assert.equal((await telecharger(`/entretien/justificatifs/${attestation}`, A())).status, 200);
    assert.equal((await noter('chaudiere', fait, 'Annulée par erreur, refaite ensuite')).status, 200, 'la note d’une réalisation annulée se modifie encore');
    assert.equal((await joindre('chaudiere', fait, PDF, 'autre.pdf')).status, 404, 'mais on n’y ajoute pas de fichier');
  });

  it('le carnet : PDF et zip avec les justificatifs, pour les adultes', async () => {
    await ops([{ op: 'done', id: 'chaudiere', occ: '', at: `${jour(1)}T09:00:00Z` }]);
    const at = (await geste('chaudiere')).history![0].at;
    await joindre('chaudiere', at, jpeg(800, 600), 'certificat.jpg');

    assert.equal((await telecharger('/entretien/carnet.pdf', E())).status, 403);
    assert.equal((await telecharger('/entretien/carnet.pdf?periode=3', A())).status, 400);
    const pdf = await telecharger('/entretien/carnet.pdf?periode=tout', A());
    assert.equal(pdf.status, 200);
    const body = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    assert.ok(body.startsWith('%PDF-'));
    assert.match(body, /Chaufferie/);
    assert.match(body, /annul/, 'la réalisation annulée y figure, avec sa note');

    const zip = await telecharger('/entretien/carnet.zip', A());
    assert.equal(zip.status, 200);
    const z = Buffer.from(await zip.arrayBuffer()).toString('latin1');
    assert.match(z, /carnet-entretien\.pdf/);
    assert.match(z, /justificatifs\/Chaufferie - Chaudi.+ - \d{4}-\d{2}-\d{2}\.pdf/);
    assert.match(z, /justificatifs\/Chaufferie - Chaudi.+ - \d{4}-\d{2}-\d{2}\.jpg/);
  });

  it('module éteint : 403 partout', async () => {
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEntretien: false } }, A());
    assert.equal((await lire('chaudiere')).status, 403);
    assert.equal((await telecharger(`/entretien/justificatifs/${attestation}`, A())).status, 403);
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEntretien: true } }, A());
  });

  it('un geste supprimé emporte ses notes ; ses fichiers partent au ménage du démarrage', async () => {
    await ops([{ op: 'add', id: 'ramonage', listId: 'entretien', text: 'Ramonage', who: [], due: null, rec: { freq: 'yearly', every: 1, base: 'done' } }]);
    await ops([{ op: 'done', id: 'ramonage', occ: '', at: `${jour(1)}T09:00:00Z` }]);
    const at = (await geste('ramonage')).history![0].at;
    const garde = (await joindre('ramonage', at, PDF, 'certificat ramonage.pdf')).json.file.id;
    const c = await appel(ctx.base, 'GET', '/modules', undefined, A());
    assert.equal(c.json.counts.entretien.justificatifs, 3, 'la confirmation d’une remise à zéro les compte');

    await ops([{ op: 'remove', id: 'chaudiere' }]);
    assert.equal((await lire('chaudiere')).status, 404);
    const { pruneUnreferencedFiles } = await import('../src/db');
    pruneUnreferencedFiles();
    assert.equal((await telecharger(`/files/${attestation}`, A())).status, 404);
    const { get } = await import('../src/storage/files');
    assert.equal(get(attestation), null, 'le fichier du geste supprimé est parti');
    assert.ok(get(garde), 'celui du ramonage est resté');
    assert.equal((await telecharger(`/entretien/justificatifs/${garde}`, A())).status, 200);
  });
});
