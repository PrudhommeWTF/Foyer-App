// Les règles que les gestes rapides de l'accueil doivent tenir.
//
// Ces gestes s'exécutent en un tap, souvent debout, sur des données que
// personne ne relit avant de les perdre. Ce qui est vérifié ici est donc moins
// « ça marche » que « ça ne détruit rien en silence » : le remplacement d'un
// repas garde les convives, et l'annulation ramène exactement l'état d'avant.
// Les gestes sur les tâches (coche, report, annulation) sont des opérations
// ciblées, vérifiées dans task-ops.test.ts.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addDaysIso } from './helpers';
import { HouseholdState, MealValue } from './models';
import { Mutation, rebase } from './state-sync';

const TODAY = '2026-09-02';

const doc = (): HouseholdState => ({
  familyName: 'Foyer',
  members: [{ id: 'me', name: 'Thomas', role: 'Papa', color: '#E56B4E', ini: 'TH' }],
  events: [], aisles: [], articles: [], shopLists: [], shop: [], taskLists: [], taskTemplates: [], tasks: [],
  msgs: [], contacts: [], folders: [], files: [], meals: {}, recipes: [], sched: [],
  profile: { memberId: 'm1' },
  settings: {},
});

/** Applique des mutations comme le store le fait, sans Angular. */
const apply = (d: HouseholdState, ...fns: Mutation[]): HouseholdState => rebase(d, fns).state;

test('le report traverse un changement de mois', () => {
  assert.equal(addDaysIso('2026-09-30', 1), '2026-10-01');
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
});

test('remplacer un repas garde les couverts et les absents du créneau', () => {
  const d = doc();
  const avant: MealValue = { items: [{ rid: 'r1' }], pax: 6, away: ['lea'] };
  d.meals = { [TODAY + '-soir']: avant };
  const remplace: MealValue = {
    items: [{ text: 'Pizza' }],
    ...(avant.pax ? { pax: avant.pax } : {}),
    ...(avant.away?.length ? { away: avant.away } : {}),
  };
  const out = apply(d, (x) => { x.meals[TODAY + '-soir'] = remplace; });
  assert.deepEqual(out.meals[TODAY + '-soir'].items, [{ text: 'Pizza' }]);
  assert.equal(out.meals[TODAY + '-soir'].pax, 6, 'ce sont les convives qui décident du nombre de parts, pas le plat');
  assert.deepEqual(out.meals[TODAY + '-soir'].away, ['lea']);
});

test('annuler un remplacement rend le repas d’origine, plats compris', () => {
  const d = doc();
  const avant: MealValue = { items: [{ rid: 'r1' }, { text: 'Tiramisu' }] };
  d.meals = { [TODAY + '-soir']: avant };
  const remplace = apply(d, (x) => { x.meals[TODAY + '-soir'] = { items: [{ text: 'Pizza' }] }; });
  const annule = apply(remplace, (x) => { x.meals[TODAY + '-soir'] = avant; });
  assert.deepEqual(annule.meals[TODAY + '-soir'].items, [{ rid: 'r1' }, { text: 'Tiramisu' }]);
});

test('un créneau vidé emporte son événement d’agenda, qui n’aurait plus d’objet', () => {
  const d = doc();
  const key = TODAY + '-soir';
  d.meals = { [key]: { items: [{ text: 'Pizza' }] } };
  d.events = [{ id: 'e1', date: TODAY, time: '19:30', title: 'Dîner : Pizza', who: 'me', recur: 'none', mealKey: key }];
  const out = apply(d, (x) => {
    delete x.meals[key];
    const i = x.events.findIndex((e) => e.mealKey === key);
    if (i >= 0) x.events.splice(i, 1);
  });
  assert.equal(out.events.length, 0, 'le calendrier n’annonce pas un dîner qui n’existe plus');
});
