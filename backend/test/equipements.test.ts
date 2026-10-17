// Module « Équipements », de bout en bout HTTP : pièces de départ, fiches,
// garantie calculée à la lecture, recherche et filtres, pièces jointes (formats,
// taille, déduplication), filtre enfant côté serveur, historique et statut,
// remplacement, pièces de la maison, module éteint, remise à zéro, sauvegarde et
// restauration, et le ménage des fichiers au démarrage.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, Reponse, appel, arreter, demarrer } from './securite-helpers';
import { jpeg, png } from './equipements-fixtures';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const PDF2 = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x21)]);
const HEIC = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(64, 4)]);

describe('Équipements : HTTP', () => {
  let ctx: Contexte;
  before(async () => { ctx = await demarrer(); });
  after(async () => { await arreter(ctx); });

  const A = () => ctx.jetons.admin;
  const M = () => ctx.jetons.membre;
  const E = () => ctx.jetons.enfant;
  const get = (chemin: string, jeton: string) => appel(ctx.base, 'GET', '/equipements' + chemin, undefined, jeton);
  const post = (chemin: string, body: unknown, jeton = A()) => appel(ctx.base, 'POST', '/equipements' + chemin, body, jeton);
  const put = (chemin: string, body: unknown, jeton = A()) => appel(ctx.base, 'PUT', '/equipements' + chemin, body, jeton);
  const joindre = async (itemId: number, kind: string, corps: Buffer, nom: string, jeton = A()): Promise<Reponse> => {
    const res = await fetch(`${ctx.base}/equipements/items/${itemId}/attachments?kind=${kind}&filename=${encodeURIComponent(nom)}`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer ' + jeton }, body: new Uint8Array(corps),
    });
    return { status: res.status, json: await res.json() };
  };
  const telecharger = (chemin: string, jeton: string) => fetch(ctx.base + chemin, { headers: { authorization: 'Bearer ' + jeton } });
  const piece = async (nom: string): Promise<number> => (await get('/rooms', A())).json.rooms.find((r: { name: string }) => r.name === nom).id;

  let lave = 0; let ampli = 0;

  it('les pièces de départ existent, dans l’ordre', async () => {
    const r = await get('/rooms', M());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const noms = r.json.rooms.map((x: { name: string }) => x.name);
    assert.deepEqual(noms.slice(0, 4), ['Cuisine', 'Salon', 'Salle de bain', 'Chambre 1']);
    assert.equal(noms.length, 10);
  });

  it('création rapide : désignation, pièce, photo de la plaque', async () => {
    const cr = await post('/items', { name: 'Lave-vaisselle', room_id: await piece('Cuisine') });
    assert.equal(cr.status, 201, JSON.stringify(cr.json));
    lave = cr.json.item.id;
    assert.equal(cr.json.item.roomName, 'Cuisine');
    assert.equal(cr.json.item.warranty.state, 'inconnue', 'sans date, la garantie est inconnue');
    const ph = await joindre(lave, 'plaque', jpeg(1600, 1200), 'plaque.jpg');
    assert.equal(ph.status, 201, JSON.stringify(ph.json));
    assert.equal(ph.json.item.attachments.plaque, 1);
  });

  it('la garantie suit la date d’achat et la durée, et redevient inconnue sans date', async () => {
    let r = await put(`/items/${lave}`, { purchased_on: '2025-03-12', brand: 'Bosch', serial: 'FD 9901 0042', purchase_price: '549,99' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.item.warranty.until, '2027-03-12');
    assert.equal(r.json.item.warranty.explain, '24 mois à partir du 12/03/2025, règle par défaut.');
    assert.equal(r.json.item.purchasePrice, 54999, 'le prix est rangé en centimes');
    r = await put(`/items/${lave}`, { warranty_months: 60 });
    assert.equal(r.json.item.warranty.until, '2030-03-12');
    r = await put(`/items/${lave}`, { purchased_on: '' });
    assert.equal(r.json.item.warranty.state, 'inconnue');
    assert.equal(r.json.item.warranty.label, 'Garantie inconnue');
    await put(`/items/${lave}`, { purchased_on: '2025-03-12', warranty_months: null });
  });

  it('le réglage du foyer change la durée par défaut', async () => {
    const set = await appel(ctx.base, 'PATCH', '/settings', { changes: { eqpGarantieDefautMois: 36 } }, A());
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal((await get(`/items/${lave}`, A())).json.item.warranty.until, '2028-03-12');
    await appel(ctx.base, 'PATCH', '/settings', { changes: { eqpGarantieDefautMois: 24 } }, A());
  });

  it('recherche par modèle, filtres pièce et garantie', async () => {
    const cr = await post('/items', { name: 'Ampli', room_id: await piece('Salon'), brand: 'Onkyo', model: 'TX-SR444', purchased_on: '2017-11-07', category: 'multimedia' });
    ampli = cr.json.item.id;
    let r = await get('/items?q=TX-SR444', M());
    assert.deepEqual(r.json.items.map((i: { id: number }) => i.id), [ampli]);
    r = await get('/items?q=fd99010042', M());
    assert.deepEqual(r.json.items.map((i: { id: number }) => i.id), [lave], 'numéro de série sans espaces ni casse');
    r = await get('/items?garantie=hors_garantie', M());
    assert.deepEqual(r.json.items.map((i: { id: number }) => i.id), [ampli]);
    assert.equal(r.json.items[0].warranty.label, 'Hors garantie depuis le 08/11/2019');
    r = await get(`/items?room=${await piece('Cuisine')}`, M());
    assert.deepEqual(r.json.items.map((i: { id: number }) => i.id), [lave]);
    assert.equal((await get('/items?garantie=bidon', M())).status, 400);
  });

  it('formats : HEIC refusé avec un message, PDF refusé comme plaque, photo trop grande refusée', async () => {
    const h = await joindre(lave, 'photo', HEIC, 'IMG_0001.HEIC');
    assert.equal(h.status, 415); assert.match(h.json.error, /HEIC/);
    const p = await joindre(lave, 'plaque', PDF, 'plaque.pdf');
    assert.equal(p.status, 415);
    const g = await joindre(lave, 'photo', jpeg(4032, 3024), 'grande.jpg');
    assert.equal(g.status, 422); assert.match(g.json.error, /4032 × 3024/);
    assert.equal((await joindre(lave, 'photo', png(2000, 1500), 'ok.png')).status, 201, '2 000 px pile passe');
    assert.equal((await joindre(lave, 'photo', Buffer.alloc(80, 7), 'rien.bin')).status, 415);
  });

  it('une facture PDF se télécharge ; la route générique des fichiers l’ignore', async () => {
    const f = await joindre(lave, 'facture', PDF, 'facture Darty.pdf');
    assert.equal(f.status, 201, JSON.stringify(f.json));
    const res = await telecharger(`/equipements/attachments/${f.json.attachment.id}`, M());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PDF);
    assert.equal((await telecharger(`/files/${f.json.attachment.fileId}`, A())).status, 404, 'pas de porte dérobée par /api/files');
    assert.equal((await appel(ctx.base, 'DELETE', `/files/${f.json.attachment.fileId}`, undefined, A())).status, 404);
  });

  it('un enfant lit sans série, prix ni vendeur, et ne peut ouvrir ni facture ni plaque', async () => {
    const d = await get(`/items/${lave}`, E());
    assert.equal(d.status, 200);
    assert.equal(d.json.item.serial, null);
    assert.equal(d.json.item.purchasePrice, null);
    assert.equal(d.json.item.vendor, null);
    assert.ok(!d.json.item.attachmentList.some((a: { kind: string }) => a.kind === 'facture' || a.kind === 'plaque'));
    assert.equal(d.json.item.attachments.facture, undefined, 'même le décompte disparaît');
    assert.ok(!JSON.stringify(d.json).includes('9901'), 'le numéro n’apparaît nulle part dans la réponse');
    const adulte = (await get(`/items/${lave}`, A())).json.item.attachmentList as { id: number; kind: string }[];
    for (const a of adulte) {
      const st = (await telecharger(`/equipements/attachments/${a.id}`, E())).status;
      assert.equal(st, a.kind === 'photo' || a.kind === 'notice' ? 200 : 403, `${a.kind} pour un enfant`);
    }
    assert.equal((await get('/items?q=fd99010042', E())).json.items.length, 0, 'pas de recherche par série');
    assert.equal((await get('/bootstrap', E())).json.canEdit, false);
  });

  it('un enfant n’écrit rien (403)', async () => {
    assert.equal((await post('/items', { name: 'X' }, E())).status, 403);
    assert.equal((await put(`/items/${lave}`, { name: 'X' }, E())).status, 403);
    assert.equal((await post(`/items/${lave}/events`, { kind: 'panne' }, E())).status, 403);
    assert.equal((await joindre(lave, 'photo', png(10, 10), 'x.png', E())).status, 403);
    assert.equal((await post('/rooms', { name: 'X' }, E())).status, 403);
  });

  it('facture groupée : un seul fichier pour plusieurs fiches, retiré quand plus personne ne le cite', async () => {
    const four = (await post('/items', { name: 'Four', room_id: await piece('Cuisine') })).json.item.id;
    const a1 = await joindre(lave, 'facture', PDF2, 'cuisine complète.pdf');
    const a2 = await joindre(four, 'facture', PDF2, 'cuisine complète.pdf');
    assert.equal(a2.json.deduplicated, true);
    assert.equal(a1.json.attachment.fileId, a2.json.attachment.fileId, 'même fichier');
    assert.equal((await joindre(four, 'facture', PDF2, 'encore.pdf')).status, 200, 'déjà joint : rien de doublé');
    await appel(ctx.base, 'DELETE', `/equipements/attachments/${a1.json.attachment.id}`, undefined, A());
    assert.equal((await telecharger(`/equipements/attachments/${a2.json.attachment.id}`, A())).status, 200, 'l’autre fiche garde sa facture');
    await appel(ctx.base, 'DELETE', `/equipements/attachments/${a2.json.attachment.id}`, undefined, A());
    const exp = await get('/export.json', A());
    assert.ok(!exp.json.files.some((f: { id: number }) => f.id === a1.json.attachment.fileId), 'le fichier a quitté le module');
  });

  it('le ménage du démarrage garde les fichiers des équipements', async () => {
    const { pruneUnreferencedFiles } = await import('../src/db');
    pruneUnreferencedFiles();
    const att = (await get(`/items/${lave}`, A())).json.item.attachmentList as { id: number }[];
    assert.ok(att.length >= 2);
    for (const a of att) assert.equal((await telecharger(`/equipements/attachments/${a.id}`, A())).status, 200);
  });

  it('une panne passe la fiche « en panne », une réparation la remet en service', async () => {
    let r = await post(`/items/${lave}/events`, { kind: 'panne', text: 'Fuit depuis ce matin', at: '2026-10-15' });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    assert.equal(r.json.item.status, 'en_panne');
    assert.equal(r.json.item.statusOn, '2026-10-15');
    r = await post(`/items/${lave}/events`, { kind: 'reparation', text: 'Joint changé', cost: '89,00', at: '2026-10-16' });
    assert.equal(r.json.item.status, 'en_service');
    assert.equal(r.json.item.events[0].cost, 8900);
    const enfant = await get(`/items/${lave}`, E());
    assert.equal(enfant.json.item.events.length, 2);
    assert.ok(enfant.json.item.events.every((e: { cost: number | null }) => e.cost === null), 'pas de coût pour un enfant');
    assert.equal((await get('/items?statut=en_panne', M())).json.items.length, 0);
  });

  it('remplacer : l’ancienne fiche reste, grisée, et pointe vers la nouvelle', async () => {
    const neuf = (await post('/items', { name: 'Ampli neuf', room_id: await piece('Salon'), brand: 'Yamaha' })).json.item.id;
    const r = await post(`/items/${ampli}/replace`, { by: neuf, day: '2026-10-17' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.item.status, 'remplace');
    assert.equal(r.json.item.replacedByName, 'Ampli neuf');
    assert.deepEqual((await get(`/items/${neuf}`, M())).json.item.replaces, [{ id: ampli, name: 'Ampli' }]);
    assert.equal((await post(`/items/${neuf}/replace`, { by: ampli }, A())).status, 400, 'pas de boucle');
  });

  it('archiver une fiche la retire de la liste sans l’effacer', async () => {
    await post(`/items/${ampli}/archive`, {});
    assert.ok(!(await get('/items', M())).json.items.some((i: { id: number }) => i.id === ampli));
    assert.ok((await get('/items?archived=1', M())).json.items.some((i: { id: number }) => i.id === ampli));
    assert.equal((await get(`/items/${ampli}`, M())).status, 200);
  });

  it('pièces : renommer, réordonner, archiver seulement une pièce vide', async () => {
    const ch = await piece('Chambre 1');
    const r = await put(`/rooms/${ch}`, { name: 'Chambre de Nolan' });
    assert.equal(r.json.room.name, 'Chambre de Nolan');
    const cuisine = await piece('Cuisine');
    const refus = await post(`/rooms/${cuisine}/archive`, {});
    assert.equal(refus.status, 400); assert.match(refus.json.error, /déplacez-les/);
    const ok = await post(`/rooms/${ch}/archive`, {});
    assert.ok(!ok.json.rooms.some((x: { id: number }) => x.id === ch));
    const ord = await put('/rooms-order', { ids: [await piece('Garage'), cuisine] });
    assert.deepEqual(ord.json.rooms.slice(0, 2).map((x: { name: string }) => x.name), ['Garage', 'Cuisine']);
    assert.equal((await post('/rooms', { name: 'Grenier', icon: 'bidon' })).status, 400);
    assert.equal((await post('/rooms', { name: 'Grenier', icon: 'autre' })).status, 201);
  });

  it('sauvegarde puis restauration du module, fichiers compris', async () => {
    const exp = (await get('/export.json', A())).json;
    assert.equal(exp.format, 1);
    assert.ok(exp.files.length >= 2);
    assert.equal((await post('/restore', { backup: exp }, A())).status, 400, 'confirmation requise');
    assert.equal((await post('/restore', { backup: exp, confirm: 'REMPLACER' }, M())).status, 403, 'administrateur seulement');
    await put(`/items/${lave}`, { name: 'Modifié après la sauvegarde' });
    const r = await post('/restore', { backup: exp, confirm: 'REMPLACER' }, A());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.missingFiles, []);
    const d = (await get(`/items/${lave}`, A())).json.item;
    assert.equal(d.name, 'Lave-vaisselle');
    for (const a of d.attachmentList) assert.equal((await telecharger(`/equipements/attachments/${a.id}`, A())).status, 200, 'fichier retrouvé après restauration');
  });

  it('module éteint : 403 partout ; remise à zéro : fiches effacées, pièces de départ reposées', async () => {
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEquipements: false } }, A());
    assert.equal((await get('/bootstrap', A())).status, 403);
    assert.equal((await get('/items', M())).status, 403);
    const counts = await appel(ctx.base, 'GET', '/modules', undefined, A());
    assert.ok(counts.json.counts.equipements.fiches >= 3, 'les données sont conservées');
    const reset = await appel(ctx.base, 'POST', '/modules/equipements/reset', { confirm: 'SUPPRIMER' }, A());
    assert.equal(reset.status, 200, JSON.stringify(reset.json));
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEquipements: true } }, A());
    const boot = await get('/bootstrap', A());
    assert.equal(boot.status, 200);
    assert.equal(boot.json.items.length, 0);
    assert.equal(boot.json.rooms.length, 10, 'pièces de départ reposées');
    assert.equal(boot.json.rooms[3].name, 'Chambre 1');
  });
});
