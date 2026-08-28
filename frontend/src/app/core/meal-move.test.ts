// Un déplacement raté se remarque au dernier moment, devant le frigo, ou pire :
// à l'heure annoncée par un agenda resté sur l'ancien jour. D'où l'insistance
// sur ce qui accompagne le repas, et sur ce qui ne doit jamais disparaître.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dayOf, moveMeal, slotOf } from './meal-move';
import { EventItem, MealValue } from './models';

const repas = (...noms: string[]): MealValue => ({ items: noms.map((text) => ({ text })) });
const HEURES: Record<string, string> = { matin: '08:00', midi: '12:30', soir: '19:30' };
const titre = (v: MealValue, slot: string): string =>
  (slot === 'soir' ? 'Dîner' : slot === 'midi' ? 'Déjeuner' : 'Petit-déjeuner') + ' : ' + v.items.map((i) => i.text).join(' · ');

const bouger = (meals: Record<string, MealValue>, events: EventItem[], from: string, to: string) =>
  moveMeal(meals, events, from, to, titre, (s) => HEURES[s] || '—');

test('la clé d’un créneau se lit sans ambiguïté', () => {
  assert.equal(dayOf('2026-08-21-soir'), '2026-08-21');
  assert.equal(slotOf('2026-08-21-soir'), 'soir');
  assert.equal(slotOf('2026-08-21-petit-dej'), 'petit-dej');
});

test('un repas déplacé vers un créneau libre laisse l’origine vide', () => {
  const m = { '2026-08-18-midi': repas('Gratin') };
  const r = bouger(m, [], '2026-08-18-midi', '2026-08-20-soir');
  assert.equal(r.moved, true);
  assert.equal(r.swapped, false);
  assert.deepEqual(r.meals['2026-08-20-soir'], repas('Gratin'));
  assert.equal(r.meals['2026-08-18-midi'], undefined);
});

test('un créneau occupé échange plutôt que d’écraser', () => {
  // Un déplacement n'a aucune raison de détruire, et l'échange est presque
  // toujours ce qu'on voulait.
  const m = { '2026-08-18-midi': repas('Gratin'), '2026-08-20-soir': repas('Risotto') };
  const r = bouger(m, [], '2026-08-18-midi', '2026-08-20-soir');
  assert.equal(r.swapped, true);
  assert.deepEqual(r.meals['2026-08-20-soir'], repas('Gratin'));
  assert.deepEqual(r.meals['2026-08-18-midi'], repas('Risotto'));
});

test('les couverts voyagent avec le repas', () => {
  const m: Record<string, MealValue> = { '2026-08-18-soir': { items: [{ text: 'Raclette' }], pax: 9 } };
  const r = bouger(m, [], '2026-08-18-soir', '2026-08-19-soir');
  assert.equal(r.meals['2026-08-19-soir'].pax, 9);
});

test('l’état d’origine n’est pas modifié', () => {
  const m = { '2026-08-18-midi': repas('Gratin') };
  const avant = JSON.stringify(m);
  bouger(m, [], '2026-08-18-midi', '2026-08-20-soir');
  assert.equal(JSON.stringify(m), avant);
});

test('déplacer vers soi-même, ou déplacer du vide, ne fait rien', () => {
  const m = { '2026-08-18-midi': repas('Gratin') };
  assert.equal(bouger(m, [], '2026-08-18-midi', '2026-08-18-midi').moved, false);
  assert.equal(bouger(m, [], '2026-08-19-midi', '2026-08-20-midi').moved, false);
  assert.equal(bouger({ '2026-08-18-midi': { items: [] } }, [], '2026-08-18-midi', '2026-08-20-soir').moved, false);
});

// ---- l'agenda suit ---------------------------------------------------------

const evenement = (mealKey: string, o: Partial<EventItem> = {}): EventItem =>
  ({ id: 'e1', date: dayOf(mealKey), time: '12:30', title: 'Déjeuner : Gratin', who: 'm1', recur: 'none', end: null, mealKey, ...o });

test('l’événement d’agenda suit son repas, jour, heure et titre', () => {
  // Un dîner déplacé qui resterait annoncé au mauvais jour est pire que pas
  // d'agenda du tout : c'est là que quelqu'un se fie au calendrier.
  const m = { '2026-08-18-midi': repas('Gratin') };
  const r = bouger(m, [evenement('2026-08-18-midi')], '2026-08-18-midi', '2026-08-20-soir');
  const e = r.events[0];
  assert.equal(e.mealKey, '2026-08-20-soir');
  assert.equal(e.date, '2026-08-20');
  assert.equal(e.time, '19:30', 'l’heure suit le créneau d’arrivée');
  assert.equal(e.title, 'Dîner : Gratin', 'le titre ne peut pas rester « Déjeuner »');
});

test('un échange fait suivre les deux événements', () => {
  const m = { '2026-08-18-midi': repas('Gratin'), '2026-08-20-soir': repas('Risotto') };
  const evs = [
    evenement('2026-08-18-midi', { id: 'e1' }),
    evenement('2026-08-20-soir', { id: 'e2', title: 'Dîner : Risotto', time: '19:30' }),
  ];
  const r = bouger(m, evs, '2026-08-18-midi', '2026-08-20-soir');
  const parId = Object.fromEntries(r.events.map((e) => [e.id, e]));
  assert.equal(parId['e1'].mealKey, '2026-08-20-soir');
  assert.equal(parId['e1'].title, 'Dîner : Gratin');
  assert.equal(parId['e2'].mealKey, '2026-08-18-midi');
  assert.equal(parId['e2'].title, 'Déjeuner : Risotto');
  assert.equal(parId['e2'].date, '2026-08-18');
});

test('les événements sans rapport ne sont pas touchés', () => {
  const m = { '2026-08-18-midi': repas('Gratin') };
  const autre: EventItem = { id: 'x', date: '2026-08-18', time: '09:00', title: 'Dentiste', who: 'm1', recur: 'none', end: null };
  const r = bouger(m, [autre, evenement('2026-08-18-midi')], '2026-08-18-midi', '2026-08-20-soir');
  assert.deepEqual(r.events[0], autre);
});

test('un événement orphelin ne fait pas planter le déplacement', () => {
  // Le repas a été retiré ailleurs, l'événement pointe dans le vide : la copie
  // doit passer sans exception, quitte à le laisser tel quel.
  const r = bouger({ '2026-08-18-midi': repas('Gratin') }, [evenement('2026-08-20-soir')], '2026-08-18-midi', '2026-08-19-midi');
  assert.equal(r.moved, true);
  assert.equal(r.events[0].mealKey, '2026-08-20-soir');
});
