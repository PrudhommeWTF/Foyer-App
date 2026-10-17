// L'export pour l'assurance : le PDF et le zip écrits à la main (relus pour
// vérifier qu'ils sont valides), puis les trois exports par HTTP (adultes
// seulement, CSV lisible en français, facture partagée écrite une seule fois).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fit, pdfString, tablePdf } from '../src/export/pdf';
import { ZipWriter, crc32 } from '../src/export/zip-writer';
import { readZip } from '../src/finances/import/zip';
import { Contexte, Reponse, appel, arreter, demarrer } from './securite-helpers';

describe('PDF écrit à la main', () => {
  it('chaînes en WinAnsi : accents, euro, apostrophe typographique, parenthèses échappées', () => {
    assert.equal(pdfString('Sécurité (été) 12 €'), '(S\xe9curit\xe9 \\(\xe9t\xe9\\) 12 \x80)');
    assert.equal(pdfString('l’œil « ok »'), '(l\x92\x9cil \xab ok \xbb)');
    assert.equal(pdfString('漢'), '(?)', 'un caractère hors WinAnsi ne casse pas le fichier');
  });
  it('une cellule trop longue est coupée avec « … »', () => {
    const s = fit('Réfrigérateur américain double porte avec distributeur', 60, 9);
    assert.ok(s.endsWith('…') && s.length < 30, s);
    assert.equal(fit('Four', 60, 9), 'Four');
  });
  it('structure valide : en-tête, table de références juste, plusieurs pages au besoin', () => {
    const rows = Array.from({ length: 70 }, (_, i) => [`Appareil ${i + 1}`, 'Cuisine']);
    const pdf = tablePdf({ title: 'Inventaire', columns: [{ title: 'Désignation', width: 200 }, { title: 'Pièce', width: 100 }], rows }).toString('latin1');
    assert.ok(pdf.startsWith('%PDF-1.4'));
    assert.ok(pdf.trimEnd().endsWith('%%EOF'));
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    assert.equal(pdf.slice(startxref, startxref + 4), 'xref', 'startxref pointe sur la table');
    // Chaque entrée de la table pointe sur le début de son objet.
    const entries = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    entries.forEach((off, i) => assert.ok(pdf.startsWith(`${i + 1} 0 obj`, off), `objet ${i + 1}`));
    assert.match(pdf, /\/Count 3 /, '70 lignes : trois pages');
  });
});

describe('Zip écrit à la main', () => {
  it('se relit avec le lecteur du dépôt, noms UTF-8, doublons renommés', () => {
    const chunks: Buffer[] = [];
    const z = new ZipWriter({ write: (b: Buffer) => chunks.push(b) });
    z.add('factures/Cuisine - Lave-vaisselle.pdf', Buffer.from('%PDF-1 un'));
    assert.equal(z.add('factures/Cuisine - Lave-vaisselle.pdf', Buffer.from('%PDF-1 deux')), 'factures/Cuisine - Lave-vaisselle (2).pdf');
    z.add('équipements.csv', Buffer.from('a;b\r\n'));
    z.finish();
    const all = readZip(Buffer.concat(chunks), () => true);
    assert.deepEqual([...all.keys()], ['factures/Cuisine - Lave-vaisselle.pdf', 'factures/Cuisine - Lave-vaisselle (2).pdf', 'équipements.csv']);
    assert.equal(all.get('factures/Cuisine - Lave-vaisselle (2).pdf')!.toString(), '%PDF-1 deux');
  });
  it('CRC-32 conforme', () => { assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926); });
});

describe('Export pour l’assurance (HTTP)', () => {
  let ctx: Contexte;
  before(async () => {
    ctx = await demarrer();
    const A = ctx.jetons.admin;
    const st = (await appel(ctx.base, 'GET', '/state', undefined, A)).json;
    await appel(ctx.base, 'PUT', '/state', { version: st.version, state: { ...st.state, rooms: [{ id: 'p1', name: 'Cuisine', position: 0 }, { id: 'p2', name: 'Salon', position: 1 }] } }, A);
    const mk = async (b: Record<string, unknown>) => (await appel(ctx.base, 'POST', '/equipements/items', b, A)).json.item.id as number;
    const lave = await mk({ name: 'Lave-vaisselle', room_id: 'p1', category: 'electromenager', brand: 'Bosch', model: 'SMV4', serial: 'FD 9901', purchased_on: '2025-03-12', purchase_price: '549,99' });
    const four = await mk({ name: 'Four', room_id: 'p1', brand: 'Whirlpool', vendor: '=HYPERLINK("x")' });
    await mk({ name: 'Ampli', room_id: 'p2', brand: 'Onkyo', model: 'TX-SR444', purchased_on: '2017-11-07' });
    const vieux = await mk({ name: 'Vieux frigo', room_id: 'p1' });
    await appel(ctx.base, 'PUT', `/equipements/items/${vieux}`, { status: 'jete' }, A);
    const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x41)]);
    for (const id of [lave, four]) {
      await fetch(`${ctx.base}/equipements/items/${id}/attachments?kind=facture&filename=cuisine.pdf`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream', authorization: 'Bearer ' + A }, body: new Uint8Array(PDF),
      });
    }
  });
  after(async () => { await arreter(ctx); });

  const brut = async (format: string, jeton: string): Promise<{ status: number; type: string; disp: string; body: Buffer }> => {
    const r = await fetch(`${ctx.base}/equipements/export/assurance.${format}`, { headers: { authorization: 'Bearer ' + jeton } });
    return { status: r.status, type: r.headers.get('content-type') || '', disp: r.headers.get('content-disposition') || '', body: Buffer.from(await r.arrayBuffer()) };
  };

  it('réservé aux adultes', async () => {
    for (const f of ['csv', 'pdf', 'zip']) assert.equal((await brut(f, ctx.jetons.enfant)).status, 403, f);
    assert.equal((await brut('csv', ctx.jetons.membre)).status, 200, 'un adulte non administrateur peut exporter');
    const bad: Reponse = await appel(ctx.base, 'GET', '/equipements/export/assurance.xls', undefined, ctx.jetons.admin);
    assert.equal(bad.status, 400);
  });

  it('CSV : BOM, « ; », dates et prix à la française, appareils jetés exclus, formule neutralisée', async () => {
    const r = await brut('csv', ctx.jetons.admin);
    assert.match(r.type, /text\/csv/);
    assert.match(r.disp, /equipements-assurance-\d{4}-\d{2}-\d{2}\.csv/);
    const txt = r.body.toString('utf-8');
    assert.ok(txt.startsWith('\ufeffPièce;Désignation;'), 'BOM et en-têtes');
    const lines = txt.trim().split('\r\n');
    assert.equal(lines.length, 4, 'en-tête + 3 appareils (le frigo jeté ne compte plus)');
    assert.equal(lines[1].split(';').slice(0, 8).join(';'), 'Cuisine;Four;Autre;Whirlpool;;;;', 'trié par pièce puis par nom');
    assert.ok(lines[1].includes(';"\'=HYPERLINK(""x"")";'), 'une formule venue d’un champ ne s’exécute pas dans le tableur');
    assert.match(lines[2], /^Cuisine;Lave-vaisselle;Électroménager;Bosch;SMV4;FD 9901;12\/03\/2025;549,99;/);
    assert.match(lines[2], /;factures\/Cuisine - Four\.pdf$/, 'la facture partagée renvoie au même fichier');
    assert.match(lines[3], /^Salon;Ampli;/);
  });

  it('PDF : un vrai PDF, téléchargeable', async () => {
    const r = await brut('pdf', ctx.jetons.admin);
    assert.equal(r.type, 'application/pdf');
    assert.ok(r.body.toString('latin1').startsWith('%PDF-1.4'));
    assert.match(r.body.toString('latin1'), /Inventaire des \xe9quipements/);
  });

  it('zip : CSV, PDF, et la facture partagée écrite une seule fois', async () => {
    const r = await brut('zip', ctx.jetons.admin);
    assert.equal(r.type, 'application/zip');
    const all = readZip(r.body, () => true);
    assert.deepEqual([...all.keys()], ['equipements.csv', 'equipements.pdf', 'factures/Cuisine - Four.pdf']);
    assert.ok(all.get('factures/Cuisine - Four.pdf')!.toString('latin1').startsWith('%PDF-1.7'));
  });
});
