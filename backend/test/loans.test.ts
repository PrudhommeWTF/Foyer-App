import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as loans from '../src/finances/loans';
import { Account, LoanTerms } from '../src/finances/types';

/** 200 000 € à 3,00 % sur 20 ans : la mensualité théorique vaut 1 109,20 €. */
const IMMO: LoanTerms = { principal: 20000000, rateBp: 300, payment: 110920, insurance: 2500, firstOn: '2020-04-05' };

const compte = (over: Partial<Account> = {}): Account => ({
  id: 1, name: 'Prêt immobilier', kind: 'credit', memberIds: [],
  openingBalance: 0, openingDate: null, archived: false, position: 0, loan: IMMO, ...over,
});

describe('prêts amortissables', () => {
  it('décompose la première échéance comme le prêteur', () => {
    const rows = loans.schedule(IMMO);
    assert.equal(rows[0].date, '2020-04-05');
    assert.equal(rows[0].interest, 50000, 'intérêts du premier mois : 200 000 × 3 % / 12');
    assert.equal(rows[0].principal, 110920 - 50000);
    assert.equal(rows[0].insurance, 2500, 'l’assurance n’amortit rien, elle s’ajoute');
    assert.equal(rows[0].total, 110920 + 2500);
    assert.equal(rows[0].owed, 20000000 - (110920 - 50000));
  });

  it('solde exactement le capital, sans centime résiduel', () => {
    const rows = loans.schedule(IMMO);
    assert.equal(rows.length, 240, 'vingt ans d’échéances');
    assert.equal(rows[rows.length - 1].owed, 0, 'la dernière échéance solde le prêt');
    assert.equal(rows.reduce((s, r) => s + r.principal, 0), IMMO.principal,
      'la somme des parts de capital vaut exactement le capital emprunté');

    // Toutes les échéances coûtent la mensualité, sauf la dernière, rabotée de
    // ce qu'il fallait pour tomber juste. C'est ce qui évite le centime
    // résiduel, et c'est ce que fait un prêteur.
    const last = rows[rows.length - 1];
    const rabot = IMMO.payment - (last.interest + last.principal);
    assert.ok(rabot > 0 && rabot < IMMO.payment, 'seule la dernière échéance est ajustée');
    const interets = rows.reduce((s, r) => s + r.interest, 0);
    assert.equal(interets + IMMO.principal, (240 * IMMO.payment) - rabot,
      'capital plus intérêts égale la somme réellement versée');
    assert.equal(interets, 6620643, 'soit 66 206,43 € d’intérêts sur vingt ans');
  });

  it('gère un prêt à taux zéro', () => {
    const ptz: LoanTerms = { principal: 3000000, rateBp: 0, payment: 100000, insurance: 0, firstOn: '2024-01-10' };
    const rows = loans.schedule(ptz);
    assert.equal(rows.length, 30);
    assert.equal(rows.every((r) => r.interest === 0), true);
    assert.equal(rows[rows.length - 1].date, '2026-06-10');
  });

  it('refuse une mensualité qui ne couvre pas les intérêts, au lieu de boucler', () => {
    const impossible: LoanTerms = { principal: 20000000, rateBp: 300, payment: 40000, insurance: 0, firstOn: '2020-04-05' };
    assert.throws(() => loans.schedule(impossible), (e: Error) => {
      assert.ok(e instanceof loans.LoanRefused);
      assert.match(e.message, /500,00 €/, 'le message donne le chiffre qui manque');
      return true;
    });
  });

  it('reporte le jour du mois quand il n’existe pas', () => {
    assert.equal(loans.addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(loans.addMonths('2024-01-31', 1), '2024-02-29', 'année bissextile');
    assert.equal(loans.addMonths('2026-12-15', 1), '2027-01-15', 'passage d’année');
    assert.equal(loans.addMonths('2026-03-31', -1), '2026-02-28', 'en arrière aussi');
  });

  it('compte les mois pleins entre deux dates', () => {
    assert.equal(loans.monthsBetween('2020-04-05', '2020-04-05'), 0);
    assert.equal(loans.monthsBetween('2020-04-05', '2020-05-04'), 0, 'un jour avant, le mois n’est pas plein');
    assert.equal(loans.monthsBetween('2020-04-05', '2020-05-05'), 1);
    assert.equal(loans.monthsBetween('2020-04-05', '2021-04-05'), 12);
  });

  it('donne l’état du prêt à une date', () => {
    const v = loans.loanView(compte(), '2026-08-20')!;
    const rows = loans.schedule(IMMO);
    const done = rows.filter((r) => r.date <= '2026-08-20');
    assert.equal(done.length, 77, 'six ans et quelques d’échéances payées');
    assert.equal(v.owed, done[done.length - 1].owed);
    assert.equal(v.repaid, IMMO.principal - v.owed);
    assert.equal(v.paid, 77);
    assert.equal(v.left, 240 - 77);
    assert.equal(v.endsOn, '2040-03-05');
    assert.equal(v.monthly, 110920 + 2500, 'ce qui sort du compte chaque mois, assurance comprise');
    assert.equal(v.next!.date, '2026-09-05');
    assert.ok(v.progress > 0.2 && v.progress < 0.35, 'un quart environ remboursé au bout de six ans');
  });

  it('recale le capital restant dû sur le solde saisi à sa date', () => {
    // Un remboursement anticipé a ramené la dette à 100 000 € au 05/08/2026,
    // là où le tableau d'origine en prévoyait davantage.
    const recale = compte({ openingBalance: -10000000, openingDate: '2026-08-05' });
    const v = loans.loanView(recale, '2026-08-20')!;
    assert.equal(v.owed, 10000000, 'tant que la prochaine échéance n’est pas tombée, la dette est celle saisie');
    assert.ok(v.endsOn < '2040-03-05', 'le prêt se termine plus tôt qu’au tableau d’origine');
    assert.equal(v.repaid, IMMO.principal - 10000000);

    const apres = loans.loanView(recale, '2026-09-10')!;
    assert.equal(apres.owed, 10000000 - (110920 - loans.monthlyInterest(10000000, 300)),
      'la première échéance après le recalage repart du capital saisi');
  });

  it('additionne les intérêts d’une année civile', () => {
    const y = loans.interestPaidIn(compte(), 2026);
    const rows = loans.schedule(IMMO).filter((r) => r.date.startsWith('2026'));
    assert.equal(rows.length, 12);
    assert.equal(y.interest, rows.reduce((s, r) => s + r.interest, 0));
    assert.equal(y.insurance, 12 * 2500);
    assert.deepEqual(loans.loanView(compte(), '2026-08-20')!.thisYear, y,
      'la vue du prêt porte le même chiffre que le calcul annuel');
  });

  it('ne calcule rien pour un compte qui n’est pas un crédit, ou sans termes', () => {
    assert.equal(loans.loanView(compte({ kind: 'courant' })), null);
    assert.equal(loans.loanView(compte({ loan: null })), null);
    assert.deepEqual(loans.loanSchedule(compte({ loan: null })), []);
  });

  it('ne tombe pas sur des termes ingérables, il ne calcule rien', () => {
    const casse = compte({ loan: { ...IMMO, payment: 100 } });
    assert.equal(loans.loanView(casse), null, 'un écran ne doit pas tomber à cause d’une ligne douteuse');
    assert.deepEqual(loans.loanSchedule(casse), []);
  });
});
