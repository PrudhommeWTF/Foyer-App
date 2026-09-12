// Les inventaires par lieu : ce qui reste à la maison de la montagne d'une fois
// sur l'autre. Comme les courses, deux téléphones peuvent noter en même temps
// (« J'ai laissé les skis », « J'ai ramené la doudoune ») sans s'écraser, et un
// lot rejoué après une coupure réseau ne refait rien. Un seul flux d'opérations
// porte à la fois les lieux et leurs affaires.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Place, PlaceItem, PlaceOp, applyOps } from '../src/places/ops';

const ctx = (applied: string[] = []) => ({ alreadyApplied: (id: string) => applied.includes(id) });

const place = (over: Partial<Place> = {}): Place =>
  ({ id: 'p1', name: 'Montagne', color: '#4E93B8', icon: 'map-pin', position: 0, ...over });
const item = (over: Partial<PlaceItem> = {}): PlaceItem =>
  ({ id: 'i1', placeId: 'p1', name: 'Skis', qty: '', state: 'la-bas', ...over });

/** Une opération avec un identifiant unique ; typage relâché, comme pour les courses. */
const op = (o: Record<string, unknown> & { op: string }): PlaceOp =>
  ({ opId: 'op-' + Math.random().toString(36).slice(2), ...o }) as unknown as PlaceOp;

// ---- lieux -----------------------------------------------------------------

test('créer un lieu lui donne des valeurs par défaut et une position', () => {
  const r = applyOps([place()], [], [op({ op: 'place-add', id: 'p2', name: 'Bord de mer' })], ctx());
  assert.equal(r.places.length, 2);
  const p = r.places[1];
  assert.equal(p.name, 'Bord de mer');
  assert.equal(p.icon, 'map-pin');
  assert.equal(p.color, '#4E93B8');
  assert.equal(p.position, 1, 'la position suit le nombre de lieux existants');
});

test('un lieu supprimé emporte ses affaires, et seulement les siennes', () => {
  const places = [place({ id: 'p1' }), place({ id: 'p2', name: 'Mer' })];
  const items = [item({ id: 'i1', placeId: 'p1' }), item({ id: 'i2', placeId: 'p2' })];
  const r = applyOps(places, items, [op({ op: 'place-remove', id: 'p1' })], ctx());
  assert.deepEqual(r.places.map((p) => p.id), ['p2']);
  assert.deepEqual(r.items.map((i) => i.id), ['i2'], 'les affaires de p1 partent, celles de p2 restent');
});

test('renommer un lieu ne touche qu’au champ fourni', () => {
  const r = applyOps([place({ note: 'code 1234' })], [], [op({ op: 'place-edit', id: 'p1', name: 'Montagne (Serre Che)' })], ctx());
  assert.equal(r.places[0].name, 'Montagne (Serre Che)');
  assert.equal(r.places[0].note, 'code 1234', 'la note est conservée');
});

test('une note vidée disparaît de la fiche', () => {
  const r = applyOps([place({ note: 'ancienne note' })], [], [op({ op: 'place-edit', id: 'p1', note: '  ' })], ctx());
  assert.equal(r.places[0].note, undefined);
});

// ---- affaires : les deux gestes, sans écrasement ---------------------------

test('« J’ai laissé » puis « J’ai ramené » : l’état suit le dernier geste', () => {
  let r = applyOps([place()], [item({ state: 'ici' })], [op({ op: 'set-state', id: 'i1', state: 'la-bas' })], ctx());
  assert.equal(r.items[0].state, 'la-bas');
  r = applyOps(r.places, r.items, [op({ op: 'set-state', id: 'i1', state: 'ici' })], ctx());
  assert.equal(r.items[0].state, 'ici');
});

test('une intention posée deux fois ne s’inverse pas au rejeu', () => {
  const one = op({ op: 'set-state', id: 'i1', state: 'ici' });
  let r = applyOps([place()], [item()], [one], ctx());
  assert.equal(r.items[0].state, 'ici');
  r = applyOps(r.places, r.items, [one], ctx([one.opId]));
  assert.equal(r.items[0].state, 'ici', 'le rejeu ne rebascule pas');
  assert.deepEqual(r.applied, [one.opId], 'un rejeu est acquitté, pas rejeté');
});

test('deux téléphones qui notent des affaires différentes ne s’écrasent pas', () => {
  const items = [item({ id: 'i1', name: 'Skis' }), item({ id: 'i2', name: 'Doudoune', state: 'la-bas' })];
  const un = applyOps([place()], items, [op({ op: 'set-state', id: 'i1', state: 'ici' })], ctx());
  const deux = applyOps(un.places, un.items, [op({ op: 'set-state', id: 'i2', state: 'ici' })], ctx());
  assert.deepEqual(deux.items.map((i) => i.state), ['ici', 'ici']);
});

test('une affaire ajoutée est là-bas par défaut : on note ce qui reste', () => {
  const r = applyOps([place()], [], [op({ op: 'add', id: 'i9', placeId: 'p1', name: 'Raquettes' })], ctx());
  assert.equal(r.items[0].state, 'la-bas');
});

test('un ajout rejoué ne ressuscite pas une affaire supprimée entre-temps', () => {
  const add = op({ op: 'add', id: 'i9', placeId: 'p1', name: 'Luge' });
  let r = applyOps([place()], [], [add], ctx());
  assert.equal(r.items.length, 1);
  r = applyOps(r.places, r.items, [op({ op: 'remove', id: 'i9' })], ctx());
  assert.equal(r.items.length, 0);
  r = applyOps(r.places, r.items, [add], ctx([add.opId]));
  assert.equal(r.items.length, 0, 'le rejeu de l’ajout reste sans effet');
});

test('déplacer une affaire d’un lieu à l’autre', () => {
  const r = applyOps([place({ id: 'p1' }), place({ id: 'p2', name: 'Mer' })], [item()], [op({ op: 'edit', id: 'i1', placeId: 'p2' })], ctx());
  assert.equal(r.items[0].placeId, 'p2');
  assert.equal(r.items[0].state, 'la-bas', 'le déplacement ne change pas l’état');
});

test('l’état retient qui l’a posé et quand', () => {
  const r = applyOps([place()], [item()], [{ opId: 'o1', op: 'set-state', id: 'i1', state: 'ici', by: 'm2', at: '2026-08-21T18:04:00.000Z' }], ctx());
  assert.equal(r.items[0].by, 'm2');
  assert.equal(r.items[0].at, '2026-08-21T18:04:00.000Z');
});

// ---- validation : écarter sans bloquer le reste ----------------------------

test('ajouter une affaire dans un lieu disparu est écarté avec sa raison', () => {
  const r = applyOps([place()], [], [op({ op: 'add', id: 'x1', placeId: 'parti', name: 'Tente' })], ctx());
  assert.equal(r.items.length, 0);
  assert.match(r.skipped[0].reason, /lieu visé n’existe plus/);
});

test('noter une affaire supprimée par l’autre téléphone n’est pas une erreur', () => {
  const o = op({ op: 'set-state', id: 'disparue', state: 'ici' });
  const r = applyOps([place()], [item()], [o], ctx());
  assert.deepEqual(r.applied, [o.opId]);
  assert.equal(r.skipped.length, 0);
});

test('un état inconnu est écarté sans emporter le reste du lot', () => {
  const bonne = op({ op: 'set-state', id: 'i1', state: 'ici' });
  const mauvaise = op({ op: 'set-state', id: 'i1', state: 'perdue' });
  const r = applyOps([place()], [item()], [mauvaise, bonne], ctx());
  assert.equal(r.items[0].state, 'ici');
  assert.deepEqual(r.applied, [bonne.opId]);
  assert.match(r.skipped[0].reason, /État d’affaire inconnu/);
});

test('un lieu ou une affaire sans nom est refusé plutôt que rangé sous un nom vide', () => {
  const r = applyOps([], [], [
    op({ op: 'place-add', id: 'p9', name: '  ' }),
    op({ op: 'add', id: 'i9', placeId: 'p1', name: '' }),
  ], ctx());
  assert.equal(r.places.length, 0);
  assert.equal(r.items.length, 0);
  assert.equal(r.skipped.length, 2);
  assert.ok(r.skipped.every((s) => /sans nom/.test(s.reason)));
});

test('un doublon à l’intérieur d’un même lot n’est appliqué qu’une fois', () => {
  const o = op({ op: 'place-add', id: 'p1', name: 'Camping' });
  const r = applyOps([], [], [o, o], ctx());
  assert.equal(r.places.length, 1);
  assert.deepEqual(r.applied, [o.opId]);
});

test('une opération inconnue, sans identifiant ou illisible est écartée proprement', () => {
  const r = applyOps([place()], [item()], [
    { op: 'set-state', id: 'i1', state: 'ici' } as unknown as PlaceOp,
    op({ op: 'danser', id: 'i1' }),
    null as unknown as PlaceOp,
  ], ctx());
  assert.equal(r.items[0].state, 'la-bas');
  assert.equal(r.skipped.length, 3);
  assert.match(r.skipped[1].reason, /Opération inconnue/);
});

test('un lot qui n’est pas un tableau ne fait pas tomber le serveur', () => {
  const r = applyOps([place()], [item()], 'des opérations', ctx());
  assert.equal(r.places.length, 1);
  assert.equal(r.items.length, 1);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped.length, 1);
});

test('les entrées trop longues sont tronquées plutôt que refusées', () => {
  const r = applyOps([place()], [], [op({ op: 'add', id: 'x', placeId: 'p1', name: 'a'.repeat(500) })], ctx());
  assert.equal(r.items[0].name.length, 200);
});

test('les tableaux d’entrée ne sont jamais modifiés sur place', () => {
  const places = [place()];
  const items = [item()];
  applyOps(places, items, [op({ op: 'set-state', id: 'i1', state: 'ici' })], ctx());
  assert.equal(items[0].state, 'la-bas', 'l’appelant garde son instantané intact');
  assert.equal(places.length, 1);
});
