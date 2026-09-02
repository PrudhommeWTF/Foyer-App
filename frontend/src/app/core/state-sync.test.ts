// Ce que le rejeu doit garantir : personne ne perd son travail parce que
// l'autre a enregistré une seconde plus tôt.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { HouseholdState } from './models';
import { Mutation, asConflict, rebase } from './state-sync';

const doc = (): HouseholdState => ({
  familyName: 'Foyer', members: [], events: [], aisles: [], articles: [],
  shopLists: [], shop: [], taskLists: [], tasks: [
    { id: 't1', text: 'Sortir le verre', who: 'me', due: '', done: false, listId: 'l1', prio: 'med' },
  ],
  msgs: [], contacts: [], folders: [], files: [], meals: {}, recipes: [], sched: [],
  profile: { name: '', role: '', email: '', phone: '', color: '#E56B4E', memberId: '' },
  settings: { dateFmt: 'JJ/MM/AAAA', dark: false, prefNotifs: true },
});

const cocher = (id: string): Mutation => (d) => { const t = d.tasks.find((x) => x.id === id); if (t) t.done = !t.done; };

test('le travail de l’autre est conservé, le mien est rejoué par-dessus', () => {
  // Pendant que je cochais une tâche, l'autre téléphone a créé un événement.
  const serveur = doc();
  serveur.events.push({ id: 'e1', date: '2026-09-02', time: '18:00', title: 'Réunion', who: 'me', recur: 'none' });

  const r = rebase(serveur, [cocher('t1')]);

  assert.equal(r.state.events.length, 1, 'l’événement de l’autre survit');
  assert.equal(r.state.tasks[0].done, true, 'ma coche est appliquée');
  assert.equal(r.replayed, 1);
  assert.equal(r.dropped, 0);
});

test('les mutations sont rejouées dans l’ordre où elles ont été faites', () => {
  const ordre: Mutation[] = [
    (d) => { d.familyName = 'un'; },
    (d) => { d.familyName = 'deux'; },
    (d) => { d.familyName = 'trois'; },
  ];
  assert.equal(rebase(doc(), ordre).state.familyName, 'trois');
});

test('le document du serveur n’est jamais modifié sur place', () => {
  const serveur = doc();
  rebase(serveur, [cocher('t1'), (d) => { d.familyName = 'écrasé'; }]);
  assert.equal(serveur.tasks[0].done, false);
  assert.equal(serveur.familyName, 'Foyer');
});

test('une mutation qui vise ce qui n’existe plus est comptée, pas tue', () => {
  const casse: Mutation = (d) => { (d as unknown as { rien: { la: number } }).rien.la = 1; };
  const r = rebase(doc(), [cocher('t1'), casse, cocher('t1')]);
  assert.equal(r.dropped, 1, 'la mutation impossible est comptée');
  assert.equal(r.replayed, 2, 'et n’empêche pas les autres de passer');
});

test('une mutation dont la cible a été supprimée ailleurs ne fait rien, sans lever', () => {
  const serveur = doc();
  serveur.tasks = [];
  const r = rebase(serveur, [cocher('t1')]);
  assert.equal(r.dropped, 0);
  assert.equal(r.state.tasks.length, 0);
});

test('asConflict ne reconnaît qu’un refus de version bien formé', () => {
  assert.equal(asConflict(409, { version: 4, state: doc() })?.version, 4);
  assert.equal(asConflict(500, { version: 4, state: doc() }), null, 'un autre code n’est pas un conflit');
  assert.equal(asConflict(409, { version: 4 }), null, 'sans document, il n’y a rien à rejouer');
  assert.equal(asConflict(409, { state: doc() }), null, 'sans version, on ne saurait pas quoi réenvoyer');
  assert.equal(asConflict(409, null), null);
  assert.equal(asConflict(409, 'Conflit'), null, 'une page d’erreur HTML n’est pas un conflit exploitable');
});
