import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { centsToDecimal, frDateToIso, isIsoDate, isMonth, monthRange, normaliseLabel, parseCents } from '../src/finances/money';

describe('parseCents', () => {
  it('lit les deux séparateurs décimaux', () => {
    assert.equal(parseCents('84.30'), 8430);
    assert.equal(parseCents('84,30'), 8430);
    assert.equal(parseCents('-925.99'), -92599);
    assert.equal(parseCents('-925,99'), -92599);
  });

  it('lit le format brut de Bankin (décimale par un point, un seul chiffre)', () => {
    assert.equal(parseCents('-562.0'), -56200);
    assert.equal(parseCents('1700.0'), 170000);
    assert.equal(parseCents('-0.31'), -31);
    assert.equal(parseCents('-1.7'), -170);
  });

  it('tolère espaces, espaces insécables et symbole euro', () => {
    assert.equal(parseCents('1 234,56 €'), 123456);
    assert.equal(parseCents('1 234,56'), 123456);
    assert.equal(parseCents('12 345 €'), 1234500);
  });

  it('gère les milliers dans les deux conventions', () => {
    assert.equal(parseCents('1.234,56'), 123456);
    assert.equal(parseCents('1,234.56'), 123456);
  });

  it('gère les négatifs entre parenthèses', () => {
    assert.equal(parseCents('(45,40)'), -4540);
  });

  it('renvoie null sur ce qui n’est pas un montant, sans inventer un zéro', () => {
    for (const bad of ['', '   ', 'abc', '€', '-', 'N/A', null, undefined]) {
      assert.equal(parseCents(bad as string), null, `attendu null pour ${JSON.stringify(bad)}`);
    }
  });

  it('n’accumule pas d’erreur de virgule flottante', () => {
    // 0.1 + 0.2 en flottant donne 0.30000000000000004 ; en centimes, 30.
    const total = ['0,10', '0,20'].reduce((a, s) => a + (parseCents(s) as number), 0);
    assert.equal(total, 30);
  });

  it('fait l’aller-retour avec centsToDecimal', () => {
    for (const v of ['-925,99', '0,05', '3500,00', '-0,01']) {
      assert.equal(parseCents(centsToDecimal(parseCents(v) as number)), parseCents(v));
    }
    assert.equal(centsToDecimal(-56200), '-562.00');
    assert.equal(centsToDecimal(5), '0.05');
  });
});

describe('dates', () => {
  it('convertit le format Bankin JJ/MM/AAAA', () => {
    assert.equal(frDateToIso('17/08/2026'), '2026-08-17');
    assert.equal(frDateToIso('3/8/2026'), '2026-08-03');
  });

  it('rejette les jours qui n’existent pas', () => {
    assert.equal(frDateToIso('31/02/2026'), null);
    assert.equal(frDateToIso('2026-08-17'), null);
    assert.equal(frDateToIso('aujourd’hui'), null);
    assert.equal(isIsoDate('2026-02-30'), false);
    assert.equal(isIsoDate('2026-13-01'), false);
    assert.equal(isIsoDate('2026-08-17'), true);
  });

  it('borne les mois, années bissextiles comprises', () => {
    assert.deepEqual(monthRange('2026-08'), { from: '2026-08-01', to: '2026-08-31' });
    assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
    assert.equal(isMonth('2026-13'), false);
    assert.equal(isMonth('2026-08'), true);
  });
});

describe('normaliseLabel', () => {
  it('met en majuscules, retire les accents et réduit les espaces', () => {
    assert.equal(normaliseLabel('  Prlv   Sépa   Engie  '), 'PRLV SEPA ENGIE');
    assert.equal(normaliseLabel('Impôts & Taxes'), 'IMPOTS & TAXES');
  });

  it('conserve le mojibake d’origine bancaire, pour que l’empreinte reste stable', () => {
    // « N?mes » vient de la banque : le corriger ferait changer la clé de
    // déduplication d'un import à l'autre.
    assert.equal(normaliseLabel('CB N?mes Spl Eclat Muroma'), 'CB N?MES SPL ECLAT MUROMA');
  });

  it('est stable d’un appel à l’autre', () => {
    const raw = "Vir Monsieur Thomas Prud Hom Virement De M. Prud Homme Thomas Ma Rie";
    assert.equal(normaliseLabel(raw), normaliseLabel(normaliseLabel(raw)));
  });
});
