import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bwipBcid, cardColor, cardInitials, formatFromScan, formatLabel, isMatrix } from './cards';
import { PALETTE } from './constants';

describe('cards : formats', () => {
  it('donne un bcid bwip-js pour chaque format connu', () => {
    assert.equal(bwipBcid('qr'), 'qrcode');
    assert.equal(bwipBcid('ean13'), 'ean13');
    assert.equal(bwipBcid('itf'), 'interleaved2of5');
    assert.equal(bwipBcid('codabar'), 'rationalizedCodabar');
  });

  it('distingue une matrice d’un code à barres', () => {
    assert.equal(isMatrix('qr'), true);
    assert.equal(isMatrix('ean13'), false);
  });

  it('rend un libellé lisible, et le format brut s’il est inconnu', () => {
    assert.equal(formatLabel('qr'), 'QR Code');
    assert.equal(formatLabel('bidon'), 'bidon');
  });
});

describe('cards : traduction depuis le scanner', () => {
  it('traduit les formats zxing courants', () => {
    assert.equal(formatFromScan('QR_CODE'), 'qr');
    assert.equal(formatFromScan('EAN_13'), 'ean13');
    assert.equal(formatFromScan('CODE_128'), 'code128');
    // UPC_E, plus rare, est rangé comme un UPC-A pour le réafficher.
    assert.equal(formatFromScan('UPC_E'), 'upca');
  });

  it('rend null pour un format lu qu’on ne saurait pas réafficher', () => {
    assert.equal(formatFromScan('PDF_417'), null);
    assert.equal(formatFromScan('AZTEC'), null);
  });
});

describe('cards : monogramme', () => {
  it('tire des initiales, une ou deux lettres, jamais vides', () => {
    assert.equal(cardInitials('Carrefour'), 'CA');
    assert.equal(cardInitials('Grand Frais'), 'GF');
    assert.equal(cardInitials('  '), '?');
  });

  it('tire une couleur stable de la palette à partir du nom', () => {
    const a = cardColor('Carrefour');
    assert.ok(PALETTE.includes(a), 'la couleur vient de la palette');
    assert.equal(cardColor('Carrefour'), a, 'le même nom donne toujours la même couleur');
    assert.equal(cardColor('CARREFOUR '), a, 'insensible à la casse et aux espaces de bord');
  });
});
