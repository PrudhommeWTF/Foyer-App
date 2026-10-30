import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AttentionInput, euros, homeAttention, homeBrief } from './home-attention';

// Vendredi 30 octobre 2026 : toutes les sources éteintes, chaque test allume la sienne.
const TODAY = '2026-10-30';
const base = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  today: TODAY, fmt: (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7),
  gestes: null, finances: null, preps: null, repas: null, ecole: null, contrats: null, releves: null, stocks: null, equipements: null, cesu: null,
  ...over,
});
const repasDays = (planned: Record<string, boolean>) => ['2026-10-30', '2026-10-31', '2026-11-01'].flatMap((date) =>
  ['midi', 'soir'].map((key) => ({ date, key, planned: !!planned[date + '-' + key] })));

describe('homeAttention', () => {
  it('ne produit rien quand toutes les sources sont éteintes', () => {
    assert.deepEqual(homeAttention(base()), []);
  });

  it('gestes : en retard (crit), dus d’ici deux jours (warn), plus loin rien', () => {
    const out = homeAttention(base({ gestes: [
      { id: 'a', text: 'Ramonage', due: '2026-10-31', late: false, doneToday: false },
      { id: 'b', text: 'Filtre', due: '2026-10-27', late: true, doneToday: false },
      { id: 'c', text: 'Gouttières', due: '2026-11-04', late: false, doneToday: false },
    ] }));
    assert.deepEqual(out.map((x) => [x.title, x.sub, x.tone]), [
      ['Filtre', 'En retard de 3 j', 'crit'],
      ['Ramonage', 'À faire d’ici demain', 'warn'],
    ]);
    assert.equal(out[0].action.kind, 'geste-done');
  });

  it('un geste coché aujourd’hui le dit au lieu du bouton', () => {
    const [g] = homeAttention(base({ gestes: [{ id: 'a', text: 'Ramonage', due: TODAY, late: false, doneToday: true }] }));
    assert.equal(g.done, true);
    assert.equal(g.sub, 'Fait aujourd’hui');
  });

  it('finances : seulement quand le reste pour finir le mois est négatif', () => {
    assert.deepEqual(homeAttention(base({ finances: { remaining: 12, fixedDue: 300 } })), []);
    const [f] = homeAttention(base({ finances: { remaining: -157, fixedDue: 1240 } }));
    assert.equal(f.title, `Il manque ${euros(157)} pour finir le mois`);
    assert.equal(f.sub, `Charges fixes à venir : ${euros(1240)}`);
    assert.equal(f.tone, 'crit');
  });

  it('départ proche : seulement s’il reste des affaires', () => {
    const out = homeAttention(base({ preps: [
      { listId: 'l1', name: 'Méribel', forMember: false, days: 2, remaining: 5 },
      { listId: 'l2', name: 'Raphaël', forMember: true, days: 1, remaining: 0 },
    ] }));
    assert.deepEqual(out.map((x) => [x.title, x.sub]), [['Départ pour Méribel dans 2 jours', '5 affaires à préparer']]);
  });

  it('repas : rien ce soir, ou plus de la moitié à prévoir sur trois jours', () => {
    const empty = homeAttention(base({ repas: repasDays({}) }));
    assert.deepEqual(empty.map((x) => [x.title, x.sub]), [['Aucun repas prévu ce week-end', '6 repas à planifier, dont ce soir']]);
    const soir = homeAttention(base({ repas: repasDays({ '2026-10-30-midi': true, '2026-10-31-midi': true, '2026-10-31-soir': true, '2026-11-01-midi': true, '2026-11-01-soir': true }) }));
    assert.equal(soir[0].title, 'Rien de prévu ce soir');
    const half = homeAttention(base({ repas: repasDays({ '2026-10-30-soir': true, '2026-10-31-midi': true, '2026-10-31-soir': true }) }));
    assert.deepEqual(half, [], 'la moitié pile ne suffit pas');
  });

  it('école : interro du prochain jour de classe, et synchro en échec', () => {
    const out = homeAttention(base({ ecole: { syncKo: 'ÉcoleDirecte indisponible depuis hier', tests: [
      { id: '42', student: 'Raphaël', subject: 'Mathématiques', day: 'lundi', due: '2026-11-02', count: 3 },
      { id: '43', student: 'Gaëtan', subject: 'Anglais', day: 'lundi', due: '2026-11-02', count: 1 },
    ] } }));
    assert.deepEqual(out.map((x) => x.title), ['ÉcoleDirecte ne répond plus', 'Interro de mathématiques lundi · Raphaël', 'Interro d’anglais lundi · Gaëtan']);
    assert.equal(out[0].tone, 'crit');
    assert.equal(out[1].sub, '3 devoirs en tout pour lundi');
  });

  it('contrats : préavis dans les 30 jours seulement', () => {
    const out = homeAttention(base({ contrats: [
      { contractId: 1, name: 'assurance auto', date: '2026-11-12', daysAway: 13 },
      { contractId: 2, name: 'box', date: '2027-01-12', daysAway: 74 },
    ] }));
    assert.deepEqual(out.map((x) => x.title), ['Préavis assurance auto avant le 12/11']);
  });

  it('relevés, stocks, équipements et CESU', () => {
    const out = homeAttention(base({
      releves: [{ contractId: 3, name: 'électrique', daysSince: 40 }],
      stocks: [{ id: 's', article: 'sel régénérant', onList: false }, { id: 't', article: 'filtre', onList: true }],
      equipements: [{ id: 9, name: 'Lave-linge', panne: true, until: null }, { id: 8, name: 'Four', panne: false, until: null }],
      cesu: [{ month: '2026-09', who: 'Ménage', due: '2026-10-05' }, { month: '2026-10', who: 'Ménage', due: '2026-11-05' }],
    }));
    assert.deepEqual(out.map((x) => [x.rank, x.title]), [
      [7, 'Relevé du compteur électrique'],
      [8, 'Sel régénérant à racheter'],
      [9, 'Lave-linge en panne'],
      [10, 'Déclaration CESU de septembre'],
    ]);
  });

  it('trie par rang puis par échéance', () => {
    const out = homeAttention(base({
      contrats: [{ contractId: 1, name: 'B', date: '2026-11-20', daysAway: 21 }, { contractId: 2, name: 'A', date: '2026-11-05', daysAway: 6 }],
      gestes: [{ id: 'g', text: 'Geste', due: TODAY, late: false, doneToday: false }],
      finances: { remaining: -1, fixedDue: 0 },
    }));
    assert.deepEqual(out.map((x) => x.id), ['geste-g', 'finances', 'preavis-2-2026-11-05', 'preavis-1-2026-11-20']);
  });

  it('une action faite retire la carte : le geste coché avance son échéance', () => {
    const avant = homeAttention(base({ gestes: [{ id: 'a', text: 'Ramonage', due: '2026-10-31', late: false, doneToday: false }] }));
    const apres = homeAttention(base({ gestes: [{ id: 'a', text: 'Ramonage', due: '2027-10-31', late: false, doneToday: false }] }));
    assert.equal(avant.length, 1);
    assert.equal(apres.length, 0);
  });
});

describe('homeBrief', () => {
  const txt = (r: ReturnType<typeof homeBrief>) => r.map((p) => (p.b ? `**${p.text}**` : p.text)).join('');
  it('compose les clauses avec les accords', () => {
    assert.equal(txt(homeBrief(2, 4, true)), 'Aujourd’hui : **2 rendez-vous**, **4 choses à régler** et aucun repas prévu ce soir.');
    assert.equal(txt(homeBrief(1, 1, false)), 'Aujourd’hui : **1 rendez-vous** et **1 chose à régler**.');
    assert.equal(txt(homeBrief(0, 3, false)), 'Aujourd’hui : aucun rendez-vous et **3 choses à régler**.');
    assert.equal(txt(homeBrief(2, 0, false)), 'Aujourd’hui : **2 rendez-vous** et rien à régler.');
  });
  it('journée calme quand tout est à zéro', () => {
    assert.equal(txt(homeBrief(0, 0, false)), 'Journée calme : rien de prévu, rien à régler.');
    assert.equal(txt(homeBrief(0, 0, true)), 'Aujourd’hui : aucun rendez-vous, rien à régler et aucun repas prévu ce soir.');
  });
});
