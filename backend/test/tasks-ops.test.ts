// Le cas qui a fait rester le foyer sur FamilyWall : deux personnes cochent en
// même temps, et une tâche cochée se décochait parce que l'autre appareil avait
// poussé son état. Ces tests fixent le seul comportement acceptable : une coche
// ne se défait jamais toute seule, une tâche ne disparaît jamais en silence.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskItem, TaskOp, applyOps, reconcile } from '../src/tasks/ops';

const ctx = (opts: { applied?: string[]; lists?: string[]; members?: string[]; shopLists?: string[]; docs?: string[] } = {}) => ({
  listIds: new Set(opts.lists ?? ['l1', 'l2']),
  memberIds: new Set(opts.members ?? ['me', 'm1']),
  shopListIds: new Set(opts.shopLists ?? ['cl1']),
  docIds: new Set(opts.docs ?? ['f1']),
  alreadyApplied: (id: string) => (opts.applied ?? []).includes(id),
});

const task = (over: Partial<TaskItem> = {}): TaskItem => ({
  id: 't1', listId: 'l1', text: 'Sortir les poubelles', who: ['me'], due: '2026-09-05', done: false, ...over,
});

/**
 * Fabrique une opération avec un identifiant unique. Le typage est volontairement
 * relâché : plusieurs tests envoient exprès des opérations invalides, ce qu'un
 * client hors ligne ou un peu vieux peut très bien faire.
 */
const op = (o: Record<string, unknown> & { op: string }): TaskOp =>
  ({ opId: 'op-' + Math.random().toString(36).slice(2), ...o }) as unknown as TaskOp;

// ---- l'essentiel : rien ne se décoche tout seul ----------------------------

test('« faite » posée deux fois laisse la tâche faite, et garde qui l’a faite en premier', () => {
  const r1 = applyOps([task()], [op({ op: 'done', id: 't1', by: 'me', at: '2026-09-05T10:00:00Z' })], ctx());
  assert.equal(r1.items[0].done, true);
  const r2 = applyOps(r1.items, [op({ op: 'done', id: 't1', by: 'm1', at: '2026-09-05T10:00:05Z' })], ctx());
  assert.equal(r2.items[0].done, true, 'pas de bascule : la seconde coche ne décoche pas');
  assert.equal(r2.items[0].doneBy, 'me', 'la première coche est l’information vraie');
  assert.equal(r2.applied.length, 1, 'la seconde est acquittée, pas refusée : le client la retire de sa file');
});

test('deux appareils partis du même état : la coche de l’un et la modification de l’autre survivent toutes les deux', () => {
  const depart = [task(), task({ id: 't2', text: 'Appeler le plombier' })];
  // A coche t1 ; B, qui n'a pas vu la coche, renomme t2. Les deux lots arrivent l'un après l'autre.
  const apresA = applyOps(depart, [op({ op: 'done', id: 't1', by: 'me' })], ctx());
  const apresB = applyOps(apresA.items, [op({ op: 'edit', id: 't2', text: 'Rappeler le plombier', by: 'm1' })], ctx());
  assert.equal(apresB.items.find((t) => t.id === 't1')?.done, true, 'la coche de A n’a pas été écrasée par B');
  assert.equal(apresB.items.find((t) => t.id === 't2')?.text, 'Rappeler le plombier');
  assert.equal(apresB.items.length, 2, 'aucune tâche n’a disparu');
});

test('une modification de B sur la tâche que A vient de cocher ne la décoche pas', () => {
  const apresA = applyOps([task()], [op({ op: 'done', id: 't1', by: 'me' })], ctx());
  const apresB = applyOps(apresA.items, [op({ op: 'edit', id: 't1', due: '2026-09-06', by: 'm1' })], ctx());
  assert.equal(apresB.items[0].done, true, 'modifier l’échéance ne dit rien de la coche');
  assert.equal(apresB.items[0].due, '2026-09-06');
});

test('rouvrir puis refaire : l’ordre des intentions est respecté, sans bascule', () => {
  const r = applyOps([task({ done: true, doneBy: 'me', doneAt: 'x' })], [
    op({ op: 'reopen', id: 't1' }),
    op({ op: 'done', id: 't1', by: 'm1', at: '2026-09-06T08:00:00Z' }),
  ], ctx());
  assert.equal(r.items[0].done, true);
  assert.equal(r.items[0].doneBy, 'm1');
});

// ---- rejeu après coupure réseau ---------------------------------------------

test('une opération déjà appliquée est acquittée sans être rejouée', () => {
  const r = applyOps([task()], [{ opId: 'deja', op: 'remove', id: 't1' }], ctx({ applied: ['deja'] }));
  assert.equal(r.items.length, 1, 'la suppression n’est pas rejouée');
  assert.deepEqual(r.applied, ['deja'], 'mais elle est acquittée, pour sortir de la file du client');
});

test('un ajout rejoué après que la tâche a été supprimée ailleurs ne la ressuscite pas', () => {
  // Le journal du serveur connaît l'ajout : il est acquitté, pas rejoué.
  const r = applyOps([], [{ opId: 'ajout', op: 'add', id: 't9', listId: 'l1', text: 'Fantôme' }], ctx({ applied: ['ajout'] }));
  assert.equal(r.items.length, 0);
});

test('un ajout rejoué sous un autre identifiant d’opération ne fait pas de doublon', () => {
  const r = applyOps([task()], [op({ op: 'add', id: 't1', listId: 'l1', text: 'Sortir les poubelles' })], ctx());
  assert.equal(r.items.length, 1);
  assert.equal(r.applied.length, 1);
});

test('un doublon dans le lot lui-même n’est traité, et acquitté, qu’une fois', () => {
  const o = { opId: 'x', op: 'done', id: 't1' };
  const r = applyOps([task()], [o, o], ctx());
  assert.deepEqual(r.applied, ['x']);
});

test('cocher, modifier ou supprimer une tâche disparue est sans objet, pas une erreur', () => {
  const r = applyOps([], [op({ op: 'done', id: 'nope' }), op({ op: 'edit', id: 'nope', text: 'x' }), op({ op: 'remove', id: 'nope' })], ctx());
  assert.equal(r.applied.length, 3);
  assert.equal(r.skipped.length, 0);
});

// ---- ce qui est refusé, et pourquoi ------------------------------------------

test('une opération écartée ne fait pas tomber les autres du lot', () => {
  const r = applyOps([task()], [
    op({ op: 'add', id: 't2', listId: 'perdue', text: 'Nulle part' }),
    op({ op: 'done', id: 't1' }),
  ], ctx());
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /liste/i);
  assert.equal(r.items[0].done, true, 'la coche est passée malgré l’ajout refusé');
});

test('une tâche sans intitulé, une date ou une heure illisibles sont refusées avec la raison', () => {
  const r = applyOps([task()], [
    op({ op: 'add', id: 't2', listId: 'l1', text: '   ' }),
    op({ op: 'edit', id: 't1', due: '5 septembre' }),
    op({ op: 'edit', id: 't1', time: '18h' }),
    op({ op: 'quoi', id: 't1' }),
    { op: 'done', id: 't1' },
  ], ctx());
  assert.equal(r.applied.length, 0);
  assert.deepEqual(r.skipped.map((s) => s.reason.split(' ')[0]), ['Tâche', 'Date', 'Heure', 'Opération', 'Opération']);
  assert.equal(r.items[0].due, '2026-09-05', 'rien n’a été écrit');
});

test('un membre inconnu est retiré de l’affectation sans faire échouer la tâche', () => {
  const r = applyOps([], [op({ op: 'add', id: 't2', listId: 'l1', text: 'Vider le lave-vaisselle', who: ['m1', 'parti', 'm1'] })], ctx());
  assert.deepEqual(r.items[0].who, ['m1'], 'et sans doublon');
});

test('une tâche peut n’être affectée à personne : c’est le premier qui passe', () => {
  const r = applyOps([], [op({ op: 'add', id: 't2', listId: 'l1', text: 'Arroser' })], ctx());
  assert.deepEqual(r.items[0].who, []);
  assert.equal(r.items[0].due, null);
});

test('un lien vers une liste de courses disparue tombe, la tâche reste', () => {
  const r = applyOps([], [op({ op: 'add', id: 't2', listId: 'l1', text: 'Faire les courses', shopListId: 'plus-la' })], ctx());
  assert.equal(r.items.length, 1);
  assert.equal('shopListId' in r.items[0], false);
});

test('un lot illisible est refusé en bloc, avec une raison', () => {
  const r = applyOps([task()], 'n’importe quoi', ctx());
  assert.equal(r.items.length, 1);
  assert.equal(r.skipped.length, 1);
});

// ---- ce que les champs deviennent -------------------------------------------

test('une modification ne touche que les champs qu’elle nomme', () => {
  const r = applyOps([task({ note: 'Bac jaune', cat: 'maison', time: '19:00' })], [op({ op: 'edit', id: 't1', text: 'Poubelles' })], ctx());
  assert.equal(r.items[0].note, 'Bac jaune');
  assert.equal(r.items[0].cat, 'maison');
  assert.equal(r.items[0].time, '19:00');
  assert.deepEqual(r.items[0].who, ['me']);
});

test('vider une note, une heure ou une échéance retire la clé au lieu de laisser une chaîne vide', () => {
  const r = applyOps([task({ note: 'x', time: '19:00' })], [op({ op: 'edit', id: 't1', note: '', time: null, due: '' })], ctx());
  assert.equal('note' in r.items[0], false);
  assert.equal('time' in r.items[0], false);
  assert.equal(r.items[0].due, null);
});

test('l’intitulé et la note sont bornés, une tâche n’est pas un document', () => {
  const r = applyOps([], [op({ op: 'add', id: 't2', listId: 'l1', text: 'a'.repeat(400), note: 'b'.repeat(3000) })], ctx());
  assert.equal(r.items[0].text.length, 300);
  assert.equal(r.items[0].note!.length, 2000);
});

test('un ajout peut arriver déjà fait : c’est ce qui permet d’annuler une suppression', () => {
  const r = applyOps([], [op({ op: 'add', id: 't2', listId: 'l1', text: 'Déjà faite', done: true, doneAt: '2026-09-01T10:00:00Z', doneBy: 'm1' })], ctx());
  assert.equal(r.items[0].done, true);
  assert.equal(r.items[0].doneBy, 'm1');
  assert.equal(r.items[0].doneAt, '2026-09-01T10:00:00Z');
});

// ---- ce que l'édition des listes et des membres implique --------------------

test('une liste supprimée emporte ses tâches, comme l’écran l’annonce', () => {
  const r = reconcile([task(), task({ id: 't2', listId: 'l2' })], new Set(['l1']), new Set(['me']), new Set());
  assert.deepEqual(r.items.map((t) => t.id), ['t1']);
  assert.equal(r.dropped, 1);
});

test('un membre supprimé quitte les affectations ; la tâche reste, sans responsable', () => {
  const r = reconcile([task({ who: ['me', 'm1'] })], new Set(['l1']), new Set(['me']), new Set());
  assert.deepEqual(r.items[0].who, ['me']);
  assert.equal(r.unassigned, 1);
});

test('une liste de courses supprimée retire le lien, pas la tâche', () => {
  const r = reconcile([task({ shopListId: 'cl9' })], new Set(['l1']), new Set(['me']), new Set(['cl1']));
  assert.equal('shopListId' in r.items[0], false);
  assert.equal(r.unlinked, 1);
});

// ---- les séries -------------------------------------------------------------------

const serie = (over: Partial<TaskItem> = {}): TaskItem =>
  task({ id: 'p1', text: 'Tester l’eau de la piscine', due: '2026-09-05', rec: { freq: 'weekly', every: 1, base: 'done' }, ...over });

test('cocher une série solde l’occurrence, garde une trace et avance à la suivante que le client a calculée', () => {
  const r = applyOps([serie()], [op({ op: 'done', id: 'p1', occ: '2026-09-05', next: '2026-09-14', by: 'me', at: '2026-09-07T10:00:00Z' })], ctx());
  const t = r.items[0];
  assert.equal(t.done, false, 'la série reste ouverte');
  assert.equal(t.due, '2026-09-14');
  assert.deepEqual(t.history, [{ at: '2026-09-07T10:00:00Z', by: 'me', due: '2026-09-05' }]);
});

test('deux appareils cochent la même occurrence : la série n’avance qu’une fois', () => {
  const a = applyOps([serie()], [op({ op: 'done', id: 'p1', occ: '2026-09-05', next: '2026-09-14', by: 'me' })], ctx());
  const b = applyOps(a.items, [op({ op: 'done', id: 'p1', occ: '2026-09-05', next: '2026-09-14', by: 'm1' })], ctx());
  assert.equal(b.items[0].due, '2026-09-14', 'pas une seconde avance');
  assert.equal(b.items[0].history!.length, 1);
  assert.equal(b.applied.length, 1, 'acquittée : le client la retire de sa file');
});

test('sans échéance suivante, la série s’arrête : la tâche est faite', () => {
  const r = applyOps([serie()], [op({ op: 'done', id: 'p1', occ: '2026-09-05', next: null, by: 'me' })], ctx());
  assert.equal(r.items[0].done, true);
  assert.equal(r.items[0].history!.length, 1);
});

test('défaire la dernière coche d’une série rétablit l’échéance qu’elle soldait, et pas deux fois', () => {
  const a = applyOps([serie()], [op({ op: 'done', id: 'p1', occ: '2026-09-05', next: '2026-09-14', by: 'me' })], ctx());
  const b = applyOps(a.items, [op({ op: 'reopen', id: 'p1', occ: '2026-09-05' })], ctx());
  assert.equal(b.items[0].due, '2026-09-05');
  assert.deepEqual(b.items[0].history, []);
  const c = applyOps(b.items, [op({ op: 'reopen', id: 'p1', occ: '2026-09-05' })], ctx());
  assert.equal(c.items[0].due, '2026-09-05', 'rejouée, elle ne remonte pas plus loin');
});

test('rouvrir une série arrêtée la relance sur sa dernière échéance', () => {
  const a = applyOps([serie()], [op({ op: 'done', id: 'p1', occ: '2026-09-05', next: null, by: 'me' })], ctx());
  const b = applyOps(a.items, [op({ op: 'reopen', id: 'p1', occ: '2026-09-05' })], ctx());
  assert.equal(b.items[0].done, false);
  assert.equal(b.items[0].due, '2026-09-05');
});

test('passer une occurrence fait avancer la série sans trace, et n’est pas rejouable', () => {
  const a = applyOps([serie()], [op({ op: 'skip', id: 'p1', occ: '2026-09-05', next: '2026-09-12' })], ctx());
  assert.equal(a.items[0].due, '2026-09-12');
  assert.equal(a.items[0].history, undefined);
  const b = applyOps(a.items, [op({ op: 'skip', id: 'p1', occ: '2026-09-05', next: '2026-09-12' })], ctx());
  assert.equal(b.items[0].due, '2026-09-12');
});

test('une échéance suivante illisible est refusée, la série ne bouge pas', () => {
  const r = applyOps([serie()], [op({ op: 'done', id: 'p1', occ: '2026-09-05', next: 'lundi prochain' })], ctx());
  assert.equal(r.skipped.length, 1);
  assert.equal(r.items[0].due, '2026-09-05');
});

test('une règle de récurrence est lue et bornée ; une règle illisible est refusée', () => {
  const r = applyOps([task()], [
    op({ op: 'edit', id: 't1', rec: { freq: 'weekly', every: 2, days: [7, 1, 1, 9], base: 'due', grace: 3, until: '2027-01-01' } }),
  ], ctx());
  assert.deepEqual(r.items[0].rec, { freq: 'weekly', every: 2, days: [1, 7], base: 'due', grace: 3, until: '2027-01-01' });
  const bad = applyOps(r.items, [op({ op: 'edit', id: 't1', rec: { freq: 'parfois' } }), op({ op: 'edit', id: 't1', rec: { freq: 'daily', until: 'demain' } })], ctx());
  assert.equal(bad.skipped.length, 2);
  const off = applyOps(r.items, [op({ op: 'edit', id: 't1', rec: null })], ctx());
  assert.equal('rec' in off.items[0], false, 'retirer la règle retire la clé');
});

test('l’historique est borné : une série de tous les jours ne grossit pas sans fin', () => {
  let items = [serie({ rec: { freq: 'daily', every: 1, base: 'due' }, due: '2026-01-01' })];
  for (let i = 0; i < 230; i++) {
    const d = items[0].due!;
    const n = new Date(d + 'T00:00:00Z'); n.setUTCDate(n.getUTCDate() + 1);
    items = applyOps(items, [op({ op: 'done', id: 'p1', occ: d, next: n.toISOString().slice(0, 10) })], ctx()).items;
  }
  assert.equal(items[0].history!.length, 200);
});

// ---- liens vers un contrat et un document ---------------------------------------

test('un contrat se lie par son numéro, se délie par null, et un numéro illisible est refusé avec la raison', () => {
  const r = applyOps([], [op({ op: 'add', id: 't1', listId: 'l1', text: 'Résilier la box', contractId: 7 })], ctx());
  assert.equal(r.items[0].contractId, 7);
  const r2 = applyOps(r.items, [op({ op: 'edit', id: 't1', contractId: null })], ctx());
  assert.equal('contractId' in r2.items[0], false, 'délié : la clé tombe, elle ne reste pas à null');
  const r3 = applyOps(r.items, [op({ op: 'edit', id: 't1', contractId: 'sept' })], ctx());
  assert.equal(r3.skipped.length, 1);
  assert.match(r3.skipped[0].reason, /Contrat illisible/);
  assert.equal(r3.items[0].contractId, 7, 'la tâche n’a pas bougé');
  const r4 = applyOps(r.items, [op({ op: 'edit', id: 't1', contractId: -2 })], ctx());
  assert.equal(r4.skipped.length, 1, 'un numéro négatif n’est pas un contrat');
});

test('un document inconnu ne fait pas échouer la tâche : le lien tombe, la tâche reste', () => {
  const r = applyOps([], [
    op({ op: 'add', id: 't1', listId: 'l1', text: 'Renvoyer le formulaire signé', docId: 'f1' }),
    op({ op: 'add', id: 't2', listId: 'l1', text: 'Lire le règlement', docId: 'disparu' }),
  ], ctx());
  assert.equal(r.applied.length, 2);
  assert.equal(r.items[0].docId, 'f1');
  assert.equal('docId' in r.items[1], false);
});

test('rattrapage : un document supprimé délie les tâches qui l’ouvraient, sans les toucher autrement', () => {
  const r = reconcile(
    [task({ docId: 'f1', contractId: 3 }), task({ id: 't2', docId: 'f2' })],
    new Set(['l1']), new Set(['me']), new Set(['cl1']), new Set(['f1']),
  );
  assert.equal(r.unlinked, 1);
  assert.equal(r.items[0].docId, 'f1');
  assert.equal(r.items[0].contractId, 3, 'le contrat ne vit pas dans le document : il n’est pas rattrapé ici');
  assert.equal('docId' in r.items[1], false);
});

test('annuler une suppression rend la tâche avec ses liens', () => {
  const r = applyOps([], [op({ op: 'add', id: 't1', listId: 'l1', text: 'Résilier la box', contractId: 7, docId: 'f1', shopListId: 'cl1' })], ctx());
  const gone = applyOps(r.items, [op({ op: 'remove', id: 't1' })], ctx());
  assert.equal(gone.items.length, 0);
  const back = applyOps(gone.items, [op({ op: 'add', ...r.items[0] })], ctx());
  assert.deepEqual({ c: back.items[0].contractId, d: back.items[0].docId, s: back.items[0].shopListId }, { c: 7, d: 'f1', s: 'cl1' });
});
