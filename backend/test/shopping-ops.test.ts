// Le cas le plus fréquent et le plus visible du module : deux personnes cochent
// en même temps, l'une au magasin, l'autre à la maison, avec un réseau mobile
// médiocre. Aucun article coché ne doit se décocher tout seul.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ShopItem, ShopOp, applyOps, reconcile } from '../src/shopping/ops';

const ctx = (opts: { applied?: string[]; aisles?: string[]; lists?: string[] } = {}) => ({
  aisleIds: new Set(opts.aisles ?? ['a1', 'a-tri']),
  listIds: new Set(opts.lists ?? ['cl1', 'cl2']),
  alreadyApplied: (id: string) => (opts.applied ?? []).includes(id),
});

const item = (over: Partial<ShopItem> = {}): ShopItem => ({
  id: 's1', name: 'Pommes', qty: '1 kg', aisleId: 'a1', state: 'a-prendre', listId: 'cl1', ...over,
});

/**
 * Fabrique une opération avec un identifiant unique. Le typage est volontairement
 * relâché : plusieurs tests envoient exprès des opérations invalides, ce qu'un
 * client hors ligne ou un peu vieux peut très bien faire.
 */
const op = (o: Record<string, unknown> & { op: string }): ShopOp =>
  ({ opId: 'op-' + Math.random().toString(36).slice(2), ...o }) as unknown as ShopOp;

// ---- l'essentiel : rien ne se décoche tout seul ----------------------------

test('une intention posée deux fois laisse l’article coché', () => {
  // Le piège qu'on évite en n'ayant pas de « bascule » : un rejeu après coupure
  // réseau décocherait ce que l'utilisateur venait de cocher.
  const one = op({ op: 'set-state', id: 's1', state: 'panier' });
  let r = applyOps([item()], [one], ctx());
  assert.equal(r.items[0].state, 'panier');
  r = applyOps(r.items, [one], ctx({ applied: [one.opId] }));
  assert.equal(r.items[0].state, 'panier', 'le rejeu ne doit rien inverser');
  assert.deepEqual(r.applied, [one.opId], 'un rejeu est acquitté, pas rejeté');
});

test('deux téléphones qui cochent des articles différents ne s’écrasent pas', () => {
  const start = [item({ id: 's1' }), item({ id: 's2', name: 'Lait' })];
  // Le téléphone du magasin coche s1, celui de la maison coche s2, chacun
  // n'ayant vu que son propre geste.
  const magasin = applyOps(start, [op({ op: 'set-state', id: 's1', state: 'panier' })], ctx());
  const maison = applyOps(magasin.items, [op({ op: 'set-state', id: 's2', state: 'panier' })], ctx());
  assert.deepEqual(maison.items.map((i) => i.state), ['panier', 'panier']);
});

test('un lot hors ligne de dix coches part d’un coup sans en perdre une', () => {
  const start = Array.from({ length: 10 }, (_, i) => item({ id: 's' + i, name: 'Article ' + i }));
  const batch = start.map((i) => op({ op: 'set-state', id: i.id, state: 'panier' }));
  const r = applyOps(start, batch, ctx());
  assert.equal(r.applied.length, 10);
  assert.equal(r.skipped.length, 0);
  assert.ok(r.items.every((i) => i.state === 'panier'));
});

test('un ajout rejoué ne ressuscite pas un article supprimé entre-temps', () => {
  // Sans le journal des identifiants d'opération, ce scénario ramène un article
  // que quelqu'un venait d'enlever : c'est la raison d'être de `alreadyApplied`.
  const add = op({ op: 'add', id: 's9', name: 'Coriandre', aisleId: 'a1', listId: 'cl1' });
  let r = applyOps([], [add], ctx());
  assert.equal(r.items.length, 1);
  r = applyOps(r.items, [op({ op: 'remove', id: 's9' })], ctx());
  assert.equal(r.items.length, 0);
  r = applyOps(r.items, [add], ctx({ applied: [add.opId] }));
  assert.equal(r.items.length, 0, 'le rejeu de l’ajout doit rester sans effet');
});

test('cocher un article supprimé par l’autre téléphone n’est pas une erreur', () => {
  // Le client est hors ligne, l'article a disparu : l'opération est sans objet,
  // pas fautive. La rejeter ferait tourner la file du client sans fin.
  const o = op({ op: 'set-state', id: 'disparu', state: 'panier' });
  const r = applyOps([item()], [o], ctx());
  assert.deepEqual(r.applied, [o.opId]);
  assert.equal(r.skipped.length, 0);
});

test('un doublon à l’intérieur d’un même lot n’est appliqué qu’une fois', () => {
  const o = op({ op: 'add', id: 's1', name: 'Pain', aisleId: 'a1', listId: 'cl1' });
  const r = applyOps([], [o, o], ctx());
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.applied, [o.opId]);
});

// ---- validation : écarter sans bloquer le reste ----------------------------

test('une opération invalide n’emporte pas les autres opérations du lot', () => {
  const bonne = op({ op: 'set-state', id: 's1', state: 'panier' });
  const mauvaise = op({ op: 'set-state', id: 's1', state: 'zzz' });
  const r = applyOps([item()], [mauvaise, bonne], ctx());
  assert.equal(r.items[0].state, 'panier');
  assert.deepEqual(r.applied, [bonne.opId]);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /État d’article inconnu/);
});

test('un ajout dans une liste ou un rayon disparu est écarté avec sa raison', () => {
  const r = applyOps([], [
    op({ op: 'add', id: 'x1', name: 'Thé', aisleId: 'a1', listId: 'partie' }),
    op({ op: 'add', id: 'x2', name: 'Thé', aisleId: 'parti', listId: 'cl1' }),
  ], ctx());
  assert.equal(r.items.length, 0);
  assert.equal(r.skipped.length, 2);
  assert.match(r.skipped[0].reason, /liste visée n’existe plus/);
  assert.match(r.skipped[1].reason, /rayon visé n’existe plus/);
});

test('un ajout sans nom est refusé plutôt que rangé sous un nom vide', () => {
  const r = applyOps([], [op({ op: 'add', id: 'x1', name: '   ', aisleId: 'a1', listId: 'cl1' })], ctx());
  assert.equal(r.items.length, 0);
  assert.match(r.skipped[0].reason, /sans nom/);
});

test('une opération sans identifiant, inconnue ou illisible est écartée proprement', () => {
  const r = applyOps([item()], [
    { op: 'set-state', id: 's1', state: 'panier' } as unknown as ShopOp,
    op({ op: 'danser', id: 's1' }),
    null as unknown as ShopOp,
  ], ctx());
  assert.equal(r.items[0].state, 'a-prendre');
  assert.equal(r.skipped.length, 3);
  assert.match(r.skipped[1].reason, /Opération inconnue/);
});

test('un lot qui n’est pas un tableau ne fait pas tomber le serveur', () => {
  const r = applyOps([item()], 'des opérations', ctx());
  assert.equal(r.items.length, 1);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped.length, 1);
});

// ---- édition et déplacement -----------------------------------------------

test('l’édition ne touche que les champs fournis', () => {
  const r = applyOps([item()], [op({ op: 'edit', id: 's1', qty: '2 kg' })], ctx());
  assert.equal(r.items[0].qty, '2 kg');
  assert.equal(r.items[0].name, 'Pommes');
  assert.equal(r.items[0].aisleId, 'a1');
});

test('les courses en deux fois : un article passe d’une liste à l’autre', () => {
  // Une partie au drive, le reste au magasin le lendemain.
  const r = applyOps([item()], [op({ op: 'edit', id: 's1', listId: 'cl2' })], ctx());
  assert.equal(r.items[0].listId, 'cl2');
  assert.equal(r.items[0].state, 'a-prendre', 'le déplacement ne change pas l’état');
});

test('l’état retient qui l’a posé et quand', () => {
  const r = applyOps([item()], [{ opId: 'o1', op: 'set-state', id: 's1', state: 'panier', by: 'm2', at: '2026-08-21T18:04:00.000Z' }], ctx());
  assert.equal(r.items[0].by, 'm2');
  assert.equal(r.items[0].at, '2026-08-21T18:04:00.000Z');
});

test('« indisponible » est un état à part entière, pas un article coché', () => {
  const r = applyOps([item()], [op({ op: 'set-state', id: 's1', state: 'indisponible' })], ctx());
  assert.equal(r.items[0].state, 'indisponible');
});

test('les entrées trop longues sont tronquées plutôt que refusées', () => {
  const r = applyOps([], [op({ op: 'add', id: 'x', name: 'a'.repeat(500), aisleId: 'a1', listId: 'cl1' })], ctx());
  assert.equal(r.items[0].name.length, 200);
});

test('la liste d’entrée n’est jamais modifiée sur place', () => {
  const start = [item()];
  applyOps(start, [op({ op: 'set-state', id: 's1', state: 'panier' })], ctx());
  assert.equal(start[0].state, 'a-prendre', 'l’appelant garde son instantané intact');
});

// ---- rattrapage après édition des rayons et des listes ---------------------

test('un rayon supprimé renvoie ses articles dans le rayon de repli', () => {
  const r = reconcile([item({ aisleId: 'parti' })], new Set(['a1', 'a-tri']), new Set(['cl1']), 'a-tri');
  assert.equal(r.items[0].aisleId, 'a-tri');
  assert.equal(r.movedToFallback, 1);
  assert.equal(r.dropped, 0);
});

test('une liste supprimée emporte ses articles, et seulement les siens', () => {
  const r = reconcile(
    [item({ id: 's1', listId: 'cl1' }), item({ id: 's2', listId: 'partie' })],
    new Set(['a1']), new Set(['cl1']), 'a1',
  );
  assert.deepEqual(r.items.map((i) => i.id), ['s1']);
  assert.equal(r.dropped, 1);
});

test('le rattrapage ne touche pas aux articles en règle', () => {
  const start = [item({ state: 'panier', by: 'm1' })];
  const r = reconcile(start, new Set(['a1']), new Set(['cl1']), 'a1');
  assert.deepEqual(r.items, start);
  assert.equal(r.movedToFallback, 0);
});
