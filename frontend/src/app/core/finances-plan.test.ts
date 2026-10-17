// Le plan du mois : ce qui reste, ce qui est attendu, ce qui est proposé.
//
// « Reste pour finir le mois » est le chiffre le plus lu des Finances. Une
// charge fixe comptée deux fois ou oubliée le rend faux sans que rien ne le
// signale : ces tests portent d'abord sur ce qui est attendu et ce qui est payé.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { FinCategory, FinContract, FinFlow, FinMonthSummary } from './finances.api';
import { compareToAverage, envelopes, fixedCharges, paceSeries, paceStatus, proposeBudgets, remainingToFinish } from './finances-plan';

const cat = (id: number, over: Partial<FinCategory> = {}): FinCategory =>
  ({ id, parentId: null, name: 'C' + id, monthlyBudget: 0, color: '#000', icon: 'facture', position: id, fixed: false, ...over });
const contract = (id: number, over: Partial<FinContract> = {}): FinContract => ({
  id, name: 'Contrat ' + id, provider: '', kind: 'assurance', assetId: null, accountId: null, categoryId: 1,
  memberIds: [], amountMin: null, amountMax: null, periodicity: 'mensuelle', renewalOn: null, noticeDays: 0,
  endsOn: null, status: 'actif', notes: '', refs: [], ...over,
});
const flow = (over: Partial<FinFlow> = {}): FinFlow => ({ month: '2026-10', days: 31, day: 17, daily: [], previous: [], contracts: [], ...over });
const cost = (contractId: number, lastDate: string, lastAmount: number) => ({ contractId, count: 1, total: lastAmount, lastDate, lastAmount, offRange: false });

const FIXED = [cat(1, { fixed: true }), cat(2)];

test('charges fixes : seuls les contrats actifs des catégories fixes', () => {
  const list = fixedCharges('2026-10', [
    contract(1, { amountMax: 10000 }),
    contract(2, { categoryId: 2, amountMax: 5000 }),
    contract(3, { status: 'resilie', amountMax: 5000 }),
    contract(4, { categoryId: null, amountMax: 5000 }),
  ], FIXED, {}, []);
  assert.deepEqual(list.map((c) => c.contractId), [1]);
});

test('charges fixes : la périodicité se compte depuis le dernier débit, sinon la reconduction', () => {
  const contracts = [
    contract(1, { periodicity: 'trimestrielle', amountMin: 3000 }),
    contract(2, { periodicity: 'trimestrielle', amountMin: 3000 }),
    contract(3, { periodicity: 'annuelle', amountMin: 41200, renewalOn: '2024-10-28' }),
    contract(4, { periodicity: 'annuelle', amountMin: 41200 }),
    contract(5, { periodicity: 'ponctuelle', amountMin: 100 }),
  ];
  const costs = { 1: cost(1, '2026-07-12', 3000), 2: cost(2, '2026-08-12', 3000) };
  const list = fixedCharges('2026-10', contracts, FIXED, costs, []);
  // Juillet + 3 = octobre ; août + 3 = novembre ; annuel calé sur le 28 octobre ;
  // sans repère, un contrat annuel n'est pas deviné ; un ponctuel jamais.
  assert.deepEqual(list.map((c) => c.contractId), [1, 3]);
  assert.equal(list[0].day, 12);
  assert.equal(list[1].day, 28, 'sans débit passé, le jour de la reconduction');
});

test('charges fixes : payée si une opération du mois porte le contrat, avec le montant réel', () => {
  const list = fixedCharges('2026-10', [contract(1, { amountMax: 15000 }), contract(2, { amountMin: 4000 })], FIXED,
    { 2: cost(2, '2026-09-28', 3999) }, [{ contractId: 1, amount: 14230, date: '2026-10-06' }]);
  assert.deepEqual(list, [
    { contractId: 1, name: 'Contrat 1', provider: '', amount: 14230, day: 6, paid: true },
    { contractId: 2, name: 'Contrat 2', provider: '', amount: 4000, day: 28, paid: false },
  ]);
  // Le montant attendu : le maximum annoncé, sinon le minimum, sinon le dernier débit.
  assert.equal(fixedCharges('2026-10', [contract(3)], FIXED, { 3: cost(3, '2026-09-02', 1799) }, [])[0].amount, 1799);
});

test('reste pour finir le mois : ressources, moins dépenses, moins les charges encore attendues', () => {
  const charges = [
    { contractId: 1, name: '', provider: '', amount: 124860, day: 5, paid: true },
    { contractId: 2, name: '', provider: '', amount: 41200, day: 28, paid: false },
  ];
  assert.equal(remainingToFinish({ income: 598000, expense: 288500 }, charges), 598000 - 288500 - 41200);
});

test('enveloppes : catégories racines budgétées et non fixes, triées par tension', () => {
  const cats = [
    cat(1, { monthlyBudget: 90000 }), cat(2, { monthlyBudget: 20000 }), cat(3, { monthlyBudget: 6000 }),
    cat(4, { monthlyBudget: 125000, fixed: true }), cat(5, { parentId: 1, monthlyBudget: 1000 }), cat(6),
  ];
  const f = flow({ daily: [
    { day: 3, categoryId: 1, spent: 53100 }, { day: 13, categoryId: 2, spent: 24130 },
    { day: 16, categoryId: 3, spent: 3200 }, { day: 5, categoryId: 4, spent: 124860 },
  ] });
  const envs = envelopes(cats, f);
  assert.deepEqual(envs.map((e) => e.categoryId), [2, 1, 3]);
  assert.equal(envs[0].left, -4130);
  assert.equal(envs[0].perDay, 0);
  assert.equal(envs[1].left, 36900);
  assert.equal(envs[1].perDay, Math.floor(36900 / 14));
  assert.equal(paceStatus(envs, f), 'crit');
});

test('rythme : cumul par jour, et pastille « à surveiller » au-delà de 5 % du rythme', () => {
  const cats = [cat(1, { monthlyBudget: 31000 })];
  const f = flow({ day: 10, daily: [{ day: 2, categoryId: 1, spent: 5000 }, { day: 9, categoryId: 1, spent: 6000 }, { day: 9, categoryId: null, spent: 999 }] });
  assert.deepEqual(paceSeries(f, [1]), [0, 0, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 11000, 11000]);
  // Rythme au 10 : 10 000 ; 11 000 dépasse les 5 % de marge.
  assert.equal(paceStatus(envelopes(cats, f), f), 'warn');
  assert.equal(paceStatus(envelopes(cats, flow({ day: 10, daily: [{ day: 2, categoryId: 1, spent: 10400 }] })), f), 'ok');
});

const summary = (cats: [number, number][]): FinMonthSummary => ({
  month: '', income: 0, expense: 0, balance: 0, budgetTotal: 0, missing: [], incomplete: false,
  categories: cats.map(([id, spent]) => ({ categoryId: id, name: '', color: '', icon: '', budget: 0, spent })),
});

test('propositions de budgets : moyenne des mois complets, à la dizaine supérieure, hors charges fixes', () => {
  const cats = [cat(1), cat(2), cat(3, { fixed: true }), cat(4, { parentId: 1 }), cat(5)];
  const p = proposeBudgets(cats, [summary([[1, 87000], [2, 18000], [3, 125000]]), summary([[1, 85500], [2, 19950]]), summary([[1, 90000]])]);
  assert.deepEqual(p.map((x) => [x.categoryId, x.budget]), [[1, 88000], [2, 13000]]);
  assert.deepEqual(proposeBudgets(cats, []), []);
});

test('comparaison à la moyenne : au même jour, sur les seuls mois qui ont des données', () => {
  const f = flow({
    day: 17,
    daily: [{ day: 3, categoryId: 1, spent: 53100 }, { day: 20, categoryId: 1, spent: 999 }],
    previous: [
      { month: '2026-09', categoryId: 1, spentToDay: 48000 }, { month: '2026-08', categoryId: 1, spentToDay: 46000 },
      { month: '2026-08', categoryId: 2, spentToDay: 4000 },
    ],
  });
  assert.deepEqual(compareToAverage(f), [{ categoryId: 1, spent: 53100, average: 47000 }, { categoryId: 2, spent: 0, average: 2000 }]);
});
