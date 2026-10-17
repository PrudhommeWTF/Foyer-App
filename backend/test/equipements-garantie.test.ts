// Garantie d'un équipement (pur) : les quatre états, la règle par défaut neuf et
// occasion, la date de fin saisie, et les bornes (dernier jour, mois courts,
// 29 février, réglage à 0). Plus la lecture des dimensions d'une image.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WarrantyInput, addMonths, computeWarranty } from '../src/equipements/warranty';
import { imageSize } from '../src/storage/image-size';
import { matches, norm } from '../src/equipements/search';
import { jpeg, png } from './equipements-fixtures';
import type { Item } from '../src/equipements/repo';

const R = { defaultMonths: 24, alertDays: 60 };
const neuf = (purchasedOn: string | null, extra: Partial<WarrantyInput> = {}): WarrantyInput =>
  ({ purchasedOn, condition: 'neuf', warrantyMonths: null, warrantyUntil: null, ...extra });

describe('Garantie : les quatre états', () => {
  it('sous garantie, règle par défaut de 24 mois, expliquée', () => {
    const w = computeWarranty(neuf('2025-03-12'), R, '2026-10-17');
    assert.equal(w.state, 'sous_garantie');
    assert.equal(w.until, '2027-03-12');
    assert.equal(w.label, 'Sous garantie jusqu’au 12/03/2027');
    assert.equal(w.explain, '24 mois à partir du 12/03/2025, règle par défaut.');
    assert.equal(w.source, 'defaut');
  });

  it('une durée saisie l’emporte sur la règle, et la date suit', () => {
    const w = computeWarranty(neuf('2025-03-12', { warrantyMonths: 60 }), R, '2026-10-17');
    assert.equal(w.until, '2030-03-12');
    assert.equal(w.explain, '60 mois à partir du 12/03/2025, durée saisie sur la fiche.');
  });

  it('expire bientôt sous le seuil d’alerte, sous garantie au-delà', () => {
    assert.equal(computeWarranty(neuf('2024-12-01'), R, '2026-10-17').state, 'expire_bientot', '45 jours restants');
    assert.equal(computeWarranty(neuf('2024-12-01'), { ...R, alertDays: 30 }, '2026-10-17').state, 'sous_garantie', 'seuil à 30 jours');
    assert.equal(computeWarranty(neuf('2024-12-01'), R, '2026-10-17').label, 'Garantie expire le 01/12/2026');
  });

  it('hors garantie depuis le lendemain du dernier jour', () => {
    const w = computeWarranty(neuf('2017-11-07'), R, '2026-10-17');
    assert.equal(w.state, 'hors_garantie');
    assert.equal(w.label, 'Hors garantie depuis le 08/11/2019');
  });

  it('jamais « hors garantie » sans date d’achat : inconnue', () => {
    const w = computeWarranty(neuf(null), R, '2026-10-17');
    assert.equal(w.state, 'inconnue');
    assert.equal(w.label, 'Garantie inconnue');
    assert.equal(w.until, null);
    assert.equal(computeWarranty(neuf(null, { warrantyMonths: 24 }), R, '2026-10-17').state, 'inconnue', 'une durée sans date ne suffit pas');
    assert.equal(computeWarranty(neuf('2025-13-40'), R, '2026-10-17').state, 'inconnue', 'une date invalide non plus');
  });
});

describe('Garantie : neuf, occasion, date de fin', () => {
  it('occasion chez un professionnel : 12 mois', () => {
    const w = computeWarranty(neuf('2026-01-10', { condition: 'occasion_pro' }), R, '2026-10-17');
    assert.equal(w.until, '2027-01-10');
    assert.equal(w.months, 12);
    assert.match(w.explain, /professionnel/);
  });

  it('occasion entre particuliers : inconnue, sauf durée saisie', () => {
    const w = computeWarranty(neuf('2026-01-10', { condition: 'occasion_particulier' }), R, '2026-10-17');
    assert.equal(w.state, 'inconnue');
    assert.match(w.explain, /particuliers/);
    assert.equal(computeWarranty(neuf('2026-01-10', { condition: 'occasion_particulier', warrantyMonths: 6 }), R, '2026-10-17').until, '2026-07-10');
  });

  it('une date de fin saisie (extension) l’emporte, même sans date d’achat', () => {
    const w = computeWarranty(neuf('2020-01-01', { warrantyMonths: 24, warrantyUntil: '2027-06-30' }), R, '2026-10-17');
    assert.equal(w.state, 'sous_garantie');
    assert.equal(w.until, '2027-06-30');
    assert.equal(w.source, 'date_fin');
    assert.equal(computeWarranty(neuf(null, { warrantyUntil: '2027-06-30' }), R, '2026-10-17').state, 'sous_garantie');
  });

  it('réglage par défaut à 0 : inconnue pour un neuf sans durée', () => {
    assert.equal(computeWarranty(neuf('2025-03-12'), { ...R, defaultMonths: 0 }, '2026-10-17').state, 'inconnue');
  });

  it('une durée saisie à 0 : hors garantie dès le lendemain de l’achat', () => {
    const w = computeWarranty(neuf('2026-10-01', { warrantyMonths: 0 }), R, '2026-10-17');
    assert.equal(w.state, 'hors_garantie');
    assert.equal(w.label, 'Hors garantie depuis le 02/10/2026');
  });
});

describe('Garantie : bornes', () => {
  it('le dernier jour est encore couvert, le lendemain non', () => {
    assert.equal(computeWarranty(neuf('2024-10-17'), R, '2026-10-17').state, 'expire_bientot');
    assert.equal(computeWarranty(neuf('2024-10-17'), R, '2026-10-17').daysLeft, 0);
    assert.equal(computeWarranty(neuf('2024-10-17'), R, '2026-10-18').state, 'hors_garantie');
  });

  it('le seuil d’alerte : à N jours pile, plus « bientôt »', () => {
    // Fin le 2026-12-16 : 60 jours après le 2026-10-17.
    assert.equal(computeWarranty(neuf('2024-12-16'), R, '2026-10-17').daysLeft, 60);
    assert.equal(computeWarranty(neuf('2024-12-16'), R, '2026-10-17').state, 'sous_garantie');
    assert.equal(computeWarranty(neuf('2024-12-15'), R, '2026-10-17').state, 'expire_bientot');
  });

  it('mois courts et 29 février', () => {
    assert.equal(addMonths('2025-01-31', 1), '2025-02-28');
    assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
    assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
    assert.equal(addMonths('2024-02-29', 48), '2028-02-29');
    assert.equal(addMonths('2025-08-31', 24), '2027-08-31');
    assert.equal(addMonths('2025-12-15', 1), '2026-01-15');
  });

  it('la durée maximale (120 mois) se calcule sans débordement', () => {
    assert.equal(computeWarranty(neuf('2025-03-12'), { ...R, defaultMonths: 120 }, '2026-10-17').until, '2035-03-12');
  });
});

describe('Recherche : casse, accents et espaces', () => {
  const ampli = { name: 'Ampli du salon', brand: 'Onkyo', model: 'TX-SR444', serial: 'AB 12 cd 34' } as Item;
  it('trouve par modèle, marque, désignation et numéro de série', () => {
    assert.ok(matches(ampli, 'TX-SR444', false));
    assert.ok(matches(ampli, 'tx-sr 444', false), 'espaces ignorés');
    assert.ok(!matches(ampli, 'txsr444', false), 'le tiret compte');
    assert.ok(matches(ampli, 'onkyo tx', false), 'marque et modèle ensemble');
    assert.ok(matches(ampli, 'ab12CD34', false), 'série sans espaces ni casse');
    assert.ok(!matches(ampli, 'Bosch', false));
    assert.equal(norm('Réfrigérateur  Américain'), 'refrigerateuramericain');
  });
  it('un enfant ne trouve pas par numéro de série (il ne le voit pas)', () => {
    assert.ok(!matches(ampli, 'ab12cd34', true));
  });
});

describe('Dimensions d’une image (en-tête seul)', () => {
  it('PNG, JPEG et WEBP', () => {
    assert.deepEqual(imageSize(png(1600, 1200), 'image/png'), { width: 1600, height: 1200 });
    assert.deepEqual(imageSize(jpeg(4032, 3024), 'image/jpeg'), { width: 4032, height: 3024 });
    const vp8x = Buffer.alloc(30); vp8x.write('RIFF', 0); vp8x.write('WEBP', 8); vp8x.write('VP8X', 12);
    vp8x.writeUIntLE(1999, 24, 3); vp8x.writeUIntLE(999, 27, 3);
    assert.deepEqual(imageSize(vp8x, 'image/webp'), { width: 2000, height: 1000 });
  });
  it('un en-tête illisible rend null', () => {
    assert.equal(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]), 'image/jpeg'), null);
    assert.equal(imageSize(Buffer.alloc(64), 'image/png'), null);
  });
});

describe('Garantie : une seule règle, côté serveur et côté application', () => {
  it('les deux copies de warranty.ts sont identiques (l’aperçu du formulaire ne ment pas)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.join(__dirname, '..', '..');
    assert.equal(
      fs.readFileSync(path.join(root, 'backend', 'src', 'equipements', 'warranty.ts'), 'utf-8'),
      fs.readFileSync(path.join(root, 'frontend', 'src', 'app', 'core', 'warranty.ts'), 'utf-8'),
      'Recopiez backend/src/equipements/warranty.ts sur frontend/src/app/core/warranty.ts.');
  });
});
