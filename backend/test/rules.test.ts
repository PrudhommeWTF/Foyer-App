// Moteur de règles : anomalie 6 du cahier de recette. Le cas qui commande tout
// le reste est celui de deux contrats du même fournisseur, au libellé bancaire
// rigoureusement identique, distingués par le seul montant.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import * as imports from '../src/finances/import-repo';
import * as rules from '../src/finances/rules-repo';
import { Candidate, Rule, evaluate, matchRule, planChange } from '../src/finances/rules';
import { parseFile } from '../src/finances/import/parse';
import { resolveAndCollapse, stage } from '../src/finances/import/run';

const FIXTURE = path.join(__dirname, 'fixtures', 'bankin-aout.csv');

const LABELS = {
  jointA: 'Compte Courant Mme N Dupont OU M T Dupont',
  jointB: 'Compte Courant Mle N Martin OU M T Dupont',
  paul: 'Compte Courant M Paul Dupont',
  marie: 'C/C Eurocompte Confort Mme Marie Dupont',
  pro: 'Compte Courant Professionnel Martin Marie (Ei)',
};

let db: Database.Database;
let acc: Record<string, number>;

function reset(): void {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFinances(db);
  repo.initFinancesRepo(db);
  acc = {};
  for (const name of ['Compte joint', 'Compte Paul', 'Compte Marie', 'Cabinet Marie']) {
    acc[name] = repo.createAccount({ name, kind: 'courant', memberId: null, openingBalance: 0, openingDate: null, archived: false }).id;
  }
  repo.addAlias(acc['Compte joint'], LABELS.jointA);
  repo.addAlias(acc['Compte joint'], LABELS.jointB);
  repo.addAlias(acc['Compte Paul'], LABELS.paul);
  repo.addAlias(acc['Compte Marie'], LABELS.marie);
  repo.addAlias(acc['Cabinet Marie'], LABELS.pro);

  const parsed = parseFile(fs.readFileSync(FIXTURE), 'bankin.csv');
  const importId = imports.createDraft('bankin.csv', parsed.format);
  const staged = stage(resolveAndCollapse(parsed.rows), imports.existingByKey);
  imports.commitImport(importId, staged.rows, staged.coverage);
}

const cat = (name: string): number => repo.listCategories().find((c) => c.name === name)!.id;
const sub = (parent: string, name: string): number =>
  repo.createCategory({ parentId: cat(parent), name, monthlyBudget: 0, color: '#7A9B76', icon: 'facture' }).id;

/** Rule that isolates one AXA contract by its amount range. */
const axaRule = (name: string, min: string, max: string, categoryId: number, over: Partial<rules.RuleInput> = {}): rules.RuleInput => ({
  name, enabled: true, matchMode: 'all', stop: false,
  conditions: [
    { field: 'label', op: 'contains', value: 'Prlv Sepa Axa', value2: '' },
    { field: 'amount', op: 'between', value: min, value2: max, },
  ],
  actions: [{ kind: 'category', value: String(categoryId) }],
  ...over,
});

const byLabel = (needle: string) => repo.listTransactions({ q: needle, limit: 100 }).rows;

beforeEach(reset);

describe('anomalie 6 : deux contrats, un seul libellé', () => {
  it('les quatre AXA arrivent sans catégorie, trois au libellé identique', () => {
    const axa = byLabel('Prlv Sepa Axa');
    assert.equal(axa.length, 4);
    assert.ok(axa.every((t) => t.categoryId === null), 'les catégories du fournisseur ne sont pas appliquées');
    const identical = axa.filter((t) => t.label === 'Prlv Sepa Axa');
    assert.equal(identical.length, 3);
    assert.deepEqual(identical.map((t) => t.amount).sort((a, b) => a - b), [-63546, -8169, -4063]);
  });

  it('R6.1 : « libellé contient » ET « montant entre 600 et 700 » ne prend qu’une ligne', () => {
    const habitation = sub('Assurances', 'Habitation');
    const report = rules.applyRules();
    assert.equal(report.changed, 0, 'aucune règle enregistrée pour l’instant');

    rules.createRule(axaRule('AXA habitation', '600', '700', habitation));
    rules.applyRules();

    const tagged = repo.listTransactions({ categoryId: habitation, limit: 100 }).rows;
    assert.equal(tagged.length, 1, 'une seule des quatre lignes AXA');
    assert.equal(tagged[0].amount, -63546);
    // Les trois autres restent intactes.
    assert.equal(byLabel('Prlv Sepa Axa').filter((t) => t.categoryId === null).length, 3);
  });

  it('R6.2 : deux règles concurrentes sur le même libellé se partagent les lignes par montant', () => {
    const habitation = sub('Assurances', 'Habitation');
    const auto = sub('Assurances', 'Véhicule');
    // Le cas Engie transposé : deux fourchettes disjointes sur un libellé commun.
    rules.createRule(axaRule('AXA habitation', '600', '700', habitation));
    rules.createRule(axaRule('AXA véhicule', '30', '90', auto));
    rules.applyRules();

    assert.equal(repo.listTransactions({ categoryId: habitation }).total, 1);
    assert.equal(repo.listTransactions({ categoryId: auto }).total, 2, '-81,69 € et -40,63 €');
    // Le quatrième AXA, « Axa France Vie Sa » à -139,12 €, n’entre dans aucune
    // des deux fourchettes et reste donc à qualifier.
    const reste = byLabel('Prlv Sepa Axa').filter((t) => t.categoryId === null);
    assert.equal(reste.length, 1);
    assert.equal(reste[0].amount, -13912);
  });

  it('R6.3 : la prévisualisation annonce exactement ce qui changera, sans rien écrire', () => {
    const habitation = sub('Assurances', 'Habitation');
    const draft = axaRule('AXA habitation', '600', '700', habitation);

    const preview = rules.previewRule(draft);
    assert.equal(preview.matched, 1);
    assert.equal(preview.wouldChange, 1);
    assert.equal(preview.rows[0].amount, -63546);
    assert.equal(preview.rows[0].newCategoryId, habitation);
    // Rien n’a été enregistré.
    assert.equal(repo.listTransactions({ categoryId: habitation }).total, 0);
    assert.equal(rules.listRules().length, 0);

    // Et ce qu’elle annonçait est bien ce qui se produit.
    rules.createRule(draft);
    assert.equal(rules.applyRules().changed, preview.wouldChange);

    // Rejouée une fois appliquée, la même règle n’annonce plus rien.
    const again = rules.previewRule(draft);
    assert.equal(again.matched, 1);
    assert.equal(again.wouldChange, 0);
    assert.equal(again.rows[0].changes, false);
  });

  it('la prévisualisation d’une étiquette tient compte de celles déjà posées', () => {
    const draft: rules.RuleInput = {
      name: 'Étiquette courses', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Carrefour', value2: '' }],
      actions: [{ kind: 'tag', value: 'quotidien' }],
    };
    const before = rules.previewRule(draft);
    assert.ok(before.wouldChange > 0);

    rules.createRule(draft);
    rules.applyRules();

    const after = rules.previewRule(draft);
    assert.equal(after.matched, before.matched);
    assert.equal(after.wouldChange, 0, 'les étiquettes déjà posées ne comptent pas comme un changement');
    assert.ok(after.rows.every((r) => r.changes === false));
  });

  it('R6.4 : rejouer les règles est idempotent', () => {
    rules.createRule(axaRule('AXA habitation', '600', '700', sub('Assurances', 'Habitation')));
    rules.createRule({
      name: 'Supermarché', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Carrefour', value2: '' }],
      actions: [{ kind: 'category', value: String(cat('Alimentation')) }],
    });

    const first = rules.applyRules();
    assert.ok(first.changed > 0);
    const second = rules.applyRules();
    assert.equal(second.changed, 0, 'le second passage ne touche plus rien');
    const third = rules.applyRules();
    assert.equal(third.changed, 0);
  });

  it('R6.5 : l’ordre des règles et l’arrêt du traitement sont respectés', () => {
    const large = sub('Assurances', 'Toutes assurances');
    const precise = sub('Assurances', 'Habitation');

    // Une règle large d’abord, une précise ensuite : la seconde l’emporte.
    rules.createRule({
      name: 'Toutes les AXA', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Axa', value2: '' }],
      actions: [{ kind: 'category', value: String(large) }],
    });
    rules.createRule(axaRule('AXA habitation', '600', '700', precise));
    rules.applyRules();

    assert.equal(repo.listTransactions({ categoryId: precise }).total, 1, 'la règle la plus tardive gagne');
    assert.equal(repo.listTransactions({ categoryId: large }).total, 3);
  });

  it('R6.5 bis : « arrêter le traitement » empêche les règles suivantes de s’appliquer', () => {
    const large = sub('Assurances', 'Toutes assurances');
    const precise = sub('Assurances', 'Habitation');
    rules.createRule({
      name: 'Toutes les AXA (arrêt)', enabled: true, matchMode: 'all', stop: true,
      conditions: [{ field: 'label', op: 'contains', value: 'Axa', value2: '' }],
      actions: [{ kind: 'category', value: String(large) }],
    });
    rules.createRule(axaRule('AXA habitation', '600', '700', precise));
    rules.applyRules();

    assert.equal(repo.listTransactions({ categoryId: precise }).total, 0, 'la seconde règle n’est jamais atteinte');
    assert.equal(repo.listTransactions({ categoryId: large }).total, 4);
  });

  it('déplacer une règle change le résultat, ce qui rend l’ordre lisible', () => {
    const large = sub('Assurances', 'Toutes assurances');
    const precise = sub('Assurances', 'Habitation');
    const broad = rules.createRule({
      name: 'Toutes les AXA', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Axa', value2: '' }],
      actions: [{ kind: 'category', value: String(large) }],
    });
    rules.createRule(axaRule('AXA habitation', '600', '700', precise));

    rules.moveRule(broad.id, 1); // la règle large passe en second
    rules.applyRules(undefined, false);
    assert.equal(repo.listTransactions({ categoryId: large }).total, 4, 'elle repeint tout, y compris la ligne précise');
    assert.equal(repo.listTransactions({ categoryId: precise }).total, 0);
  });
});

describe('protection du travail manuel', () => {
  it('une catégorie posée à la main survit au rejeu des règles', () => {
    const auto = sub('Assurances', 'Véhicule');
    const vie = sub('Assurances', 'Vie');
    rules.createRule({
      name: 'Toutes les AXA', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Axa', value2: '' }],
      actions: [{ kind: 'category', value: String(auto) }],
    });
    rules.applyRules();
    assert.equal(repo.listTransactions({ categoryId: auto }).total, 4);

    // L’utilisateur corrige une ligne à la main : « Axa France Vie » n’est pas de l’auto.
    const target = byLabel('Axa France Vie').find((t) => t.label.includes('Vie'))!;
    repo.updateTransaction(target.id, {
      accountId: target.accountId, date: target.date, amount: target.amount, kind: target.kind,
      label: target.label, categoryId: vie, notes: '', cleared: false,
    });
    assert.equal(repo.getTransaction(target.id)!.ruleId, null, 'la ligne appartient désormais à l’utilisateur');

    const report = rules.applyRules();
    assert.equal(repo.getTransaction(target.id)!.categoryId, vie, 'la correction manuelle est préservée');
    assert.equal(report.manualKept, 1, 'et le rapport le dit');
  });

  it('« tout réappliquer » écrase explicitement, y compris le manuel', () => {
    const auto = sub('Assurances', 'Véhicule');
    const vie = sub('Assurances', 'Vie');
    rules.createRule({
      name: 'Toutes les AXA', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Axa', value2: '' }],
      actions: [{ kind: 'category', value: String(auto) }],
    });
    const target = byLabel('Prlv Sepa Axa')[0];
    repo.updateTransaction(target.id, {
      accountId: target.accountId, date: target.date, amount: target.amount, kind: target.kind,
      label: target.label, categoryId: vie, notes: '', cleared: false,
    });

    rules.applyRules(undefined, false);
    assert.equal(repo.getTransaction(target.id)!.categoryId, auto);
  });

  it('corriger une règle réattribue les lignes qu’elle avait classées', () => {
    const faux = sub('Assurances', 'Mauvaise catégorie');
    const bon = sub('Assurances', 'Bonne catégorie');
    const rule = rules.createRule(axaRule('AXA habitation', '600', '700', faux));
    rules.applyRules();
    assert.equal(repo.listTransactions({ categoryId: faux }).total, 1);

    rules.updateRule(rule.id, axaRule('AXA habitation', '600', '700', bon));
    rules.applyRules();
    assert.equal(repo.listTransactions({ categoryId: faux }).total, 0, 'la ligne quitte l’ancienne catégorie');
    assert.equal(repo.listTransactions({ categoryId: bon }).total, 1);
  });
});

describe('critères', () => {
  const tx = (over: Partial<Candidate> = {}): Candidate => ({
    id: 1, accountId: 1, date: '2026-08-10', amount: -63546,
    label: 'Prlv Sepa Axa', labelRaw: 'Prlv Sepa Axa', categoryId: null, kind: 'depense', ruleId: null, ...over,
  });
  const rule = (conditions: Rule['conditions'], matchMode: Rule['matchMode'] = 'all'): Rule =>
    ({ id: 1, name: 'r', position: 0, enabled: true, matchMode, stop: false, conditions, actions: [{ kind: 'tag', value: 'x' }] });

  it('compare les montants en valeur absolue, comme on les lit sur un relevé', () => {
    assert.ok(matchRule(tx(), rule([{ field: 'amount', op: 'between', value: '600', value2: '700' }])));
    assert.ok(matchRule(tx(), rule([{ field: 'amount', op: 'gt', value: '600', value2: '' }])));
    assert.ok(!matchRule(tx(), rule([{ field: 'amount', op: 'lt', value: '600', value2: '' }])));
    // Une recette du même montant correspond aussi : c’est « sens » qui tranche.
    assert.ok(matchRule(tx({ amount: 63546 }), rule([{ field: 'amount', op: 'between', value: '600', value2: '700' }])));
  });

  it('distingue dépense et recette', () => {
    assert.ok(matchRule(tx(), rule([{ field: 'sens', op: 'is', value: 'depense', value2: '' }])));
    assert.ok(!matchRule(tx(), rule([{ field: 'sens', op: 'is', value: 'recette', value2: '' }])));
    assert.ok(matchRule(tx({ amount: 100 }), rule([{ field: 'sens', op: 'is', value: 'recette', value2: '' }])));
  });

  it('ignore casse et accents sur le libellé', () => {
    assert.ok(matchRule(tx({ label: 'Prlv Sépa AXA' }), rule([{ field: 'label', op: 'contains', value: 'sepa axa', value2: '' }])));
    assert.ok(matchRule(tx(), rule([{ field: 'label', op: 'startsWith', value: 'prlv', value2: '' }])));
    assert.ok(matchRule(tx(), rule([{ field: 'label', op: 'notContains', value: 'engie', value2: '' }])));
  });

  it('accepte une expression régulière, et ne casse pas sur une regex invalide', () => {
    assert.ok(matchRule(tx(), rule([{ field: 'label', op: 'regex', value: '^Prlv .* Axa$', value2: '' }])));
    assert.ok(!matchRule(tx(), rule([{ field: 'label', op: 'regex', value: '[', value2: '' }])));
  });

  it('filtre par jour du mois, par plage de dates et par compte', () => {
    assert.ok(matchRule(tx(), rule([{ field: 'dayOfMonth', op: 'equals', value: '10', value2: '' }])));
    assert.ok(matchRule(tx(), rule([{ field: 'dayOfMonth', op: 'between', value: '5', value2: '15' }])));
    assert.ok(matchRule(tx(), rule([{ field: 'date', op: 'between', value: '2026-08-01', value2: '2026-08-31' }])));
    assert.ok(!matchRule(tx(), rule([{ field: 'date', op: 'before', value: '2026-08-01', value2: '' }])));
    assert.ok(matchRule(tx(), rule([{ field: 'account', op: 'is', value: '1', value2: '' }])));
    assert.ok(matchRule(tx(), rule([{ field: 'account', op: 'isNot', value: '2', value2: '' }])));
  });

  it('combine en ET ou en OU, explicitement', () => {
    const conditions: Rule['conditions'] = [
      { field: 'label', op: 'contains', value: 'Axa', value2: '' },
      { field: 'amount', op: 'lt', value: '100', value2: '' },
    ];
    assert.ok(!matchRule(tx(), rule(conditions, 'all')), 'le ET échoue sur le montant');
    assert.ok(matchRule(tx(), rule(conditions, 'any')), 'le OU passe grâce au libellé');
  });

  it('une règle sans condition ne correspond à rien', () => {
    assert.ok(!matchRule(tx(), rule([])));
    assert.equal(evaluate(tx(), [rule([])]).length, 0);
  });

  it('une règle désactivée est ignorée', () => {
    const disabled = { ...rule([{ field: 'label', op: 'contains', value: 'Axa', value2: '' }]), enabled: false };
    assert.equal(evaluate(tx(), [disabled]).length, 0);
    assert.equal(planChange(tx(), [disabled]), null);
  });
});

describe('actions', () => {
  it('réécrit le libellé sans toucher au libellé brut, qui porte l’empreinte', () => {
    rules.createRule({
      name: 'Nîmes', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'N?mes Spl Eclat', value2: '' }],
      actions: [{ kind: 'label', value: 'Éclairage public, Nîmes' }],
    });
    rules.applyRules();

    const rows = repo.listTransactions({ q: 'Éclairage public', limit: 10 }).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((t) => t.labelRaw.includes('N?mes')), 'le brut reste intact, la déduplication tient');
  });

  it('pose une étiquette, sans doublon au rejeu', () => {
    rules.createRule({
      name: 'Vacances', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Camping', value2: '' }],
      actions: [{ kind: 'tag', value: 'vacances' }],
    });
    rules.applyRules();
    rules.applyRules();

    const tagged = repo.listTransactions({ tag: 'vacances', limit: 50 });
    assert.ok(tagged.total > 0);
    assert.ok(tagged.rows.every((t) => t.tags.length === 1 && t.tags[0] === 'vacances'));
    assert.equal(rules.listTags().find((t) => t.name === 'vacances')!.count, tagged.total);
    // Une règle qui ne pose qu'une étiquette ne s'approprie pas la ligne : le
    // rejeu suivant doit annoncer zéro modification, pas relister les mêmes.
    assert.equal(rules.applyRules().changed, 0, 'le rejeu est idempotent');
    assert.ok(tagged.rows.every((t) => t.ruleId === null), 'la provenance de la catégorie reste libre');
  });

  it('une étiquette ne prive pas une catégorie manuelle de sa protection', () => {
    const camping = byLabel('Camping')[0];
    const target = repo.updateTransaction(camping.id, {
      accountId: camping.accountId, date: camping.date, amount: camping.amount,
      kind: camping.kind, label: camping.label, categoryId: cat('Loisirs et vacances'),
      notes: '', cleared: false,
    })!;
    assert.equal(target.ruleId, null);

    rules.createRule({
      name: 'Étiquette vacances', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Camping', value2: '' }],
      actions: [{ kind: 'tag', value: 'vacances' }],
    });
    rules.createRule({
      name: 'Camping en divers', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Camping', value2: '' }],
      actions: [{ kind: 'category', value: String(cat('Divers')) }],
    });
    const report = rules.applyRules();

    const after = repo.listTransactions({ q: 'Camping', limit: 10 }).rows.find((t) => t.id === camping.id)!;
    assert.equal(after.categoryId, cat('Loisirs et vacances'), 'la catégorie choisie à la main tient');
    assert.deepEqual(after.tags, ['vacances'], 'mais l’étiquette est bien posée');
    assert.ok(report.manualKept >= 1);
  });

  it('marque une opération comme virement interne, qui sort alors des dépenses', () => {
    // Un remboursement de 10 € le 31/07 sur le compte joint (les trois lignes du
    // fichier sont trois synchronisations du même relevé, déjà repliées).
    const before = repo.monthSummary('2026-07', '2026-08-17');
    rules.createRule({
      name: 'Virement vers un compte non suivi', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Vir Sepa Remb Mini Robot', value2: '' }],
      actions: [{ kind: 'transfer', value: '' }],
    });
    rules.applyRules();

    const after = repo.monthSummary('2026-07', '2026-08-17');
    assert.equal(before.expense - after.expense, 1000, 'les 10 € sortent des dépenses');
    const rows = byLabel('Mini Robot');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'virement');
    assert.equal(rows[0].transferGroup, null, 'sans contrepartie détectée, aucun groupe n’est inventé');
  });
});

describe('rapport de rejeu', () => {
  it('détaille combien de lignes chaque règle a décidées', () => {
    rules.createRule({
      name: 'Supermarché', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'label', op: 'contains', value: 'Carrefour', value2: '' }],
      actions: [{ kind: 'category', value: String(cat('Alimentation')) }],
    });
    rules.createRule(axaRule('AXA habitation', '600', '700', cat('Assurances')));

    const report = rules.applyRules();
    assert.equal(report.examined, 95);
    assert.equal(report.perRule.length, 2);
    assert.equal(report.perRule.reduce((n, r) => n + r.changed, 0), report.changed);
    assert.equal(report.perRule.find((r) => r.name === 'AXA habitation')!.changed, 1);
  });

  it('limite le rejeu à un compte ou à une période', () => {
    rules.createRule({
      name: 'Tout', enabled: true, matchMode: 'all', stop: false,
      conditions: [{ field: 'sens', op: 'is', value: 'depense', value2: '' }],
      actions: [{ kind: 'tag', value: 'depense' }],
    });
    const scoped = rules.applyRules({ accountId: acc['Compte Marie'] });
    assert.equal(scoped.examined, 6);
    assert.ok(scoped.changed > 0 && scoped.changed <= 6);

    const period = rules.applyRules({ from: '2026-08-01', to: '2026-08-03' });
    assert.ok(period.examined < 95);
  });
});
