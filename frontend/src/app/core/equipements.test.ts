// Le noyau de l'écran Équipements : recherche, filtres, regroupement par pièce,
// saisie de la fiche, et le calcul de la réduction des photos.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { draftOf, eqpMatches, fieldsOf, filterItems, groupByRoom, parseMonths } from './equipements';
import { fitWithin, jpegName } from './image-resize';
import type { EqpItem } from './equipements.api';
import type { WarrantyState } from './warranty';

const fiche = (id: number, p: Partial<EqpItem> & { state?: WarrantyState } = {}): EqpItem => ({
  id, roomId: null, assetId: null, name: 'Appareil ' + id, category: 'autre', brand: '', model: '', serial: '',
  purchasedOn: null, purchasePrice: null, vendor: '', condition: 'neuf', warrantyMonths: null, warrantyUntil: null,
  warrantyNote: '', notes: '', status: 'en_service', statusOn: null, replacedBy: null, createdBy: null, createdAt: '',
  updatedBy: null, updatedAt: null, archivedAt: null, roomName: null, attachments: {}, replacedByName: null,
  warranty: { state: p.state ?? 'inconnue', until: null, since: null, daysLeft: null, source: null, months: null, label: '', explain: '' },
  ...p,
});
const rooms = [{ id: 'p1', name: 'Cuisine', position: 0 }, { id: 'p2', name: 'Salon', position: 1 }];

describe('Équipements : recherche et filtres', () => {
  const lave = fiche(1, { name: 'Lave-vaisselle', brand: 'Bosch', serial: 'FD 9901 0042', roomId: 'p1', state: 'sous_garantie' });
  const ampli = fiche(2, { name: 'Ampli', brand: 'Onkyo', model: 'TX-SR444', roomId: 'p2', state: 'hors_garantie' });
  const vieux = fiche(3, { name: 'Radiateur', roomId: 'p-supprimee' });
  const all = [lave, ampli, vieux];

  it('cherche dans désignation, marque, modèle et numéro de série, sans casse ni espaces', () => {
    assert.ok(eqpMatches(ampli, 'TX-SR444'));
    assert.ok(eqpMatches(ampli, 'onkyo tx'));
    assert.ok(eqpMatches(lave, 'fd99010042'));
    assert.ok(eqpMatches(lave, 'BOSCH'));
    assert.ok(!eqpMatches(ampli, 'bosch'));
    assert.ok(eqpMatches(fiche(9, { name: 'Réfrigérateur' }), 'refrige'));
  });

  it('filtre par pièce, « sans pièce » (y compris une pièce supprimée) et état de garantie', () => {
    const f = (room: string, garantie: WarrantyState | '' = '', q = '') => filterItems(all, { q, room, garantie }, rooms).map((i) => i.id);
    assert.deepEqual(f(''), [1, 2, 3]);
    assert.deepEqual(f('p1'), [1]);
    assert.deepEqual(f('none'), [3]);
    assert.deepEqual(f('', 'hors_garantie'), [2]);
    assert.deepEqual(f('', '', 'TX-SR444'), [2]);
  });

  it('regroupe par pièce dans l’ordre des pièces, puis « Sans pièce », sans groupe vide', () => {
    const g = groupByRoom(all, [...rooms, { id: 'p3', name: 'Garage', position: 2 }]);
    assert.deepEqual(g.map((x) => [x.name, x.items.length]), [['Cuisine', 1], ['Salon', 1], ['Sans pièce', 1]]);
  });
});

describe('Équipements : saisie de la fiche', () => {
  it('à la création, seul ce qui est rempli part', () => {
    const d = { ...draftOf(null, 'p1'), name: ' Lave-vaisselle ' };
    assert.deepEqual(fieldsOf(d, null), { name: 'Lave-vaisselle', room_id: 'p1', category: 'electromenager', condition: 'neuf', status: 'en_service' });
  });

  it('en modification, seulement ce qui a changé, et vider une date l’envoie à null', () => {
    const it = fiche(1, { name: 'Four', purchasedOn: '2025-03-12', purchasePrice: 54999, serial: 'X1' });
    const avant = draftOf(it);
    assert.equal(avant.price, '549,99');
    assert.deepEqual(fieldsOf(avant, avant), {}, 'rien de changé, rien n’est envoyé');
    assert.deepEqual(fieldsOf({ ...avant, purchasedOn: '', months: '60' }, avant), { purchased_on: null, warranty_months: 60 });
  });

  it('une durée est un entier de 0 à 240, vide veut dire « pas de durée »', () => {
    assert.equal(parseMonths(''), null);
    assert.equal(parseMonths(' 24 '), 24);
    assert.equal(parseMonths('0'), 0);
    assert.equal(parseMonths('2,5'), 'invalide');
    assert.equal(parseMonths('300'), 'invalide');
  });
});

describe('Photos : réduction avant envoi', () => {
  it('ramène le plus grand côté à 2 000 px, proportions gardées, sans agrandir', () => {
    assert.deepEqual(fitWithin(4032, 3024), { width: 2000, height: 1500 });
    assert.deepEqual(fitWithin(3024, 4032), { width: 1500, height: 2000 });
    assert.deepEqual(fitWithin(1200, 800), { width: 1200, height: 800 });
  });
  it('la photo convertie garde son nom, en .jpg', () => {
    assert.equal(jpegName('IMG_0042.HEIC'), 'IMG_0042.jpg');
    assert.equal(jpegName('plaque'), 'plaque.jpg');
  });
});

describe('Équipements : repères d’agenda', () => {
  it('au dernier jour des garanties en cours, appareils encore là seulement', async () => {
    const { warrantyDayExtras } = await import('./equipements');
    const w = (state: WarrantyState, until: string | null) => ({ state, until, since: null, daysLeft: 1, source: null, months: null, label: '', explain: '' });
    const out = warrantyDayExtras([
      fiche(1, { name: 'Lave-vaisselle', warranty: w('sous_garantie', '2027-03-12') }),
      fiche(2, { name: 'Four', warranty: w('expire_bientot', '2026-12-01') }),
      fiche(3, { name: 'Ampli', warranty: w('hors_garantie', '2019-11-07') }),
      fiche(4, { name: 'Vieux four', status: 'remplace', warranty: w('sous_garantie', '2027-01-01') }),
      fiche(5, { name: 'Robot', warranty: w('inconnue', null) }),
    ]);
    assert.deepEqual(Object.keys(out).sort(), ['2026-12-01', '2027-03-12']);
    assert.equal(out['2027-03-12'][0].sub, 'Lave-vaisselle');
    assert.equal(out['2027-03-12'][0].label, 'Fin de garantie');
  });
});

describe('Équipements : tuile d’accueil', () => {
  it('dit d’abord ce qui demande d’agir, sinon le compte', async () => {
    const { homeLine } = await import('./equipements');
    assert.equal(homeLine([], 60), 'Aucune fiche');
    assert.equal(homeLine([fiche(1), fiche(2, { state: 'sous_garantie' })], 60), '2 fiches, rien à signaler');
    assert.equal(homeLine([fiche(1, { status: 'en_panne' }), fiche(2, { state: 'expire_bientot' }), fiche(3, { state: 'expire_bientot' })], 60),
      '1 appareil en panne · 2 garanties expirent dans les 60 jours');
    assert.equal(homeLine([fiche(1, { state: 'expire_bientot', archivedAt: '2026-01-01' })], 30), 'Aucune fiche', 'une fiche archivée ne compte pas');
  });
});
