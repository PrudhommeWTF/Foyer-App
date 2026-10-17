// Le cas qui a fait rester le foyer sur FamilyWall : deux personnes cochent en
// même temps, et une tâche cochée se décochait parce que l'autre appareil avait
// poussé son état. Ces tests fixent le seul comportement acceptable : une coche
// ne se défait jamais toute seule, une tâche ne disparaît jamais en silence.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskItem, TaskOp, applyOps, reconcile } from '../src/tasks/ops';

const ctx = (opts: { applied?: string[]; lists?: string[]; members?: string[]; shopLists?: string[]; kinds?: Record<string, string> } = {}) => {
  const lists = new Set(opts.lists ?? ['l1', 'l2']);
  const kinds = opts.kinds ?? {};
  return {
    listIds: lists,
    listKind: (id: string) => (lists.has(id) ? (kinds[id] ?? 'taches') : undefined),
    memberIds: new Set(opts.members ?? ['me', 'm1']),
    shopListIds: new Set(opts.shopLists ?? ['cl1']),
    alreadyApplied: (id: string) => (opts.applied ?? []).includes(id),
  };
};

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

test('une retouche estampille « modifié » : dernier auteur et date, sans toucher à la création', () => {
  const depart = [task({ by: 'me', at: '2026-09-01T09:00:00Z' })];
  const r = applyOps(depart, [op({ op: 'edit', id: 't1', text: 'Sortir les poubelles ce soir', by: 'm1', at: '2026-09-03T20:00:00Z' })], ctx());
  assert.equal(r.items[0].upBy, 'm1');
  assert.equal(r.items[0].upAt, '2026-09-03T20:00:00Z');
  assert.equal(r.items[0].by, 'me', 'la création reste celle d’origine');
  assert.equal(r.items[0].at, '2026-09-01T09:00:00Z');
});

test('poser une clé d’ordre seule (restitution) n’estampille pas « modifié »', () => {
  const r = applyOps([task()], [op({ op: 'edit', id: 't1', ord: 'a5', by: 'm1', at: '2026-09-03T20:00:00Z' })], ctx());
  assert.equal(r.items[0].ord, 'a5');
  assert.equal(r.items[0].upBy, undefined, 'ranger une tâche n’est pas une modification à afficher');
  assert.equal(r.items[0].upAt, undefined);
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

test('annuler une suppression rend la tâche avec ses liens', () => {
  const r = applyOps([], [op({ op: 'add', id: 't1', listId: 'l1', text: 'Résilier la box', contractId: 7, shopListId: 'cl1' })], ctx());
  const gone = applyOps(r.items, [op({ op: 'remove', id: 't1' })], ctx());
  assert.equal(gone.items.length, 0);
  const back = applyOps(gone.items, [op({ op: 'add', ...r.items[0] })], ctx());
  assert.deepEqual({ c: back.items[0].contractId, s: back.items[0].shopListId }, { c: 7, s: 'cl1' });
});

// ---- sous-tâches : un seul niveau, jamais d'arborescence ---------------------------

test('une sous-tâche se range sous un parent de la même liste, et le parent ne peut pas en avoir un', () => {
  const r = applyOps([task({ id: 'p' })], [op({ op: 'add', id: 's1', listId: 'l1', text: 'Sortir le bac jaune', parentId: 'p' })], ctx());
  assert.equal(r.items[1].parentId, 'p');
  const deux = applyOps(r.items, [op({ op: 'add', id: 's2', listId: 'l1', text: 'Trop profond', parentId: 's1' })], ctx());
  assert.equal(deux.skipped.length, 1);
  assert.match(deux.skipped[0].reason, /ne peut pas en avoir elle-même/);
  assert.equal(deux.items.length, 2, 'la tâche n’est pas créée du tout : une arborescence ne se crée pas à moitié');
});

test('une tâche qui a des sous-tâches ne peut pas en devenir une', () => {
  const depart = [task({ id: 'p' }), task({ id: 's', parentId: 'p' }), task({ id: 'autre' })];
  const r = applyOps(depart, [op({ op: 'edit', id: 'p', parentId: 'autre' })], ctx());
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /qui a des sous-tâches/);
  assert.equal(r.items[0].parentId, undefined);
});

test('un parent inconnu, disparu ou d’une autre liste est refusé avec la raison', () => {
  const depart = [task({ id: 'p' }), task({ id: 'ailleurs', listId: 'l2' })];
  const inconnu = applyOps(depart, [op({ op: 'add', id: 's', listId: 'l1', text: 'x', parentId: 'fantome' })], ctx());
  assert.match(inconnu.skipped[0].reason, /parente n’existe plus/);
  const autreListe = applyOps(depart, [op({ op: 'add', id: 's', listId: 'l1', text: 'x', parentId: 'ailleurs' })], ctx());
  assert.match(autreListe.skipped[0].reason, /liste de son parent/);
  const soi = applyOps(depart, [op({ op: 'edit', id: 'p', parentId: 'p' })], ctx());
  assert.match(soi.skipped[0].reason, /sa propre sous-tâche/);
});

test('une sous-tâche ne porte ni date, ni heure, ni récurrence, ni rappel : ce sont l’affaire du parent', () => {
  const r = applyOps([task({ id: 'p' })], [op({
    op: 'add', id: 's', listId: 'l1', text: 'Détail', parentId: 'p',
    due: '2026-09-30', time: '08:00', remind: 'eve', rec: { freq: 'weekly', every: 1, base: 'due' },
  })], ctx());
  const s = r.items[1];
  assert.equal(r.applied.length, 1, 'l’ajout passe : ces champs sont ignorés, pas refusés');
  assert.deepEqual({ due: s.due, time: s.time, rec: s.rec, remind: s.remind }, { due: null, time: undefined, rec: undefined, remind: undefined });
});

test('une sous-tâche promue au premier niveau peut de nouveau porter une date', () => {
  const depart = [task({ id: 'p' }), task({ id: 's', parentId: 'p', due: null })];
  const r = applyOps(depart, [op({ op: 'edit', id: 's', parentId: null, due: '2026-09-30' })], ctx());
  assert.equal(r.items[1].parentId, undefined);
  assert.equal(r.items[1].due, '2026-09-30');
});

test('supprimer un parent remonte ses sous-tâches au premier niveau, il n’en disparaît aucune en silence', () => {
  const depart = [task({ id: 'p' }), task({ id: 's1', parentId: 'p' }), task({ id: 's2', parentId: 'p' })];
  const r = applyOps(depart, [op({ op: 'remove', id: 'p' })], ctx());
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items.map((t) => t.parentId), [undefined, undefined]);
});

test('rattrapage : une sous-tâche dont le parent est parti avec sa liste remonte au premier niveau', () => {
  const r = reconcile(
    [task({ id: 'p', listId: 'l2' }), task({ id: 's', listId: 'l1', parentId: 'p' }), task({ id: 'ok' })],
    new Set(['l1']), new Set(['me']), new Set(['cl1']),
  );
  assert.equal(r.dropped, 1, 'le parent part avec sa liste');
  assert.equal(r.orphaned, 1);
  assert.equal(r.items.find((t) => t.id === 's')!.parentId, undefined);
});

// ---- ordre manuel -----------------------------------------------------------------
// La sémantique du rangement (op `move`, concurrence, cent insertions, refus)
// vit dans tasks-ordering.test.ts. Ici, seulement la validation du champ `ord`
// tel qu'un `edit` le pose (chemin de la restitution d'annulation).

test('une clé d’ordre se pose, se retire, et une clé illisible est refusée avec la raison', () => {
  const r = applyOps([task()], [op({ op: 'edit', id: 't1', ord: 'a3' })], ctx());
  assert.equal(r.items[0].ord, 'a3');
  const enleve = applyOps(r.items, [op({ op: 'edit', id: 't1', ord: null })], ctx());
  assert.equal('ord' in enleve.items[0], false, 'null retire la clé, sans la laisser à vide');
  const faux = applyOps(r.items, [op({ op: 'edit', id: 't1', ord: 'clé/illégale' })], ctx());
  assert.equal(faux.skipped.length, 1);
  assert.match(faux.skipped[0].reason, /Clé d’ordre illisible/);
});

// ---- remise à zéro d'une liste de préparation ------------------------------

test('« reset » sur une liste de préparation efface les coches et garde les articles', () => {
  const items = [
    task({ id: 'a1', listId: 'lp', text: 'Doudou', done: true, doneAt: '2026-07-01T10:00:00Z', doneBy: 'me' }),
    task({ id: 'a2', listId: 'lp', text: 'Gourde', done: true, doneAt: '2026-07-01T10:01:00Z', doneBy: 'm1' }),
    task({ id: 'a3', listId: 'lp', text: 'Casquette', done: false }),
  ];
  const r = applyOps(items, [op({ op: 'reset', id: 'lp', at: '2026-07-10T18:00:00Z' })],
    ctx({ lists: ['lp'], kinds: { lp: 'preparation' } }));
  assert.equal(r.applied.length, 1);
  assert.equal(r.items.length, 3, 'les articles restent, seules les coches s’effacent');
  assert.ok(r.items.every((t) => !t.done), 'tout est redevenu à préparer');
  assert.ok(r.items.every((t) => !t.doneAt && !t.doneBy), 'plus aucune trace de coche');
  assert.deepEqual(r.listResets, [{ listId: 'lp', at: '2026-07-10T18:00:00Z' }], 'la liste porte la date du reset');
});

test('« reset » est refusé sur une liste qui n’est pas de préparation', () => {
  const items = [task({ id: 'a1', listId: 'l1', done: true, doneBy: 'me' })];
  const r = applyOps(items, [op({ op: 'reset', id: 'l1' })], ctx());
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.items[0].done, true, 'une liste de tâches garde ses coches');
  assert.deepEqual(r.listResets, []);
});

test('« reset » sur une liste disparue est écarté, sans rien casser', () => {
  const r = applyOps([], [op({ op: 'reset', id: 'nawak' })], ctx({ lists: ['lp'], kinds: { lp: 'preparation' } }));
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped.length, 1);
});

test('« reset » déjà appliqué est acquitté sans être rejoué (file hors ligne)', () => {
  const items = [task({ id: 'a1', listId: 'lp', done: true, doneBy: 'me' })];
  const one = op({ op: 'reset', id: 'lp', at: '2026-07-10T18:00:00Z' });
  const r1 = applyOps(items, [one], ctx({ lists: ['lp'], kinds: { lp: 'preparation' } }));
  assert.equal(r1.items[0].done, false);
  // Rejeu : acquitté, mais pas re-remis à zéro (rien à faire), et sans nouvelle date.
  const r2 = applyOps(r1.items, [one], ctx({ lists: ['lp'], kinds: { lp: 'preparation' }, applied: [one.opId] }));
  assert.equal(r2.applied.length, 1);
  assert.deepEqual(r2.listResets, [], 'un rejeu ne repose pas lastResetAt');
});

// ---- Entretien : « Fait aujourd'hui », une seule fois, et le stock avec ----
//
// Un geste d'entretien est une tâche de la liste Entretien. La coche est la même
// opération `done` que partout ; ces tests fixent ce qu'elle fait de plus.

const entCtx = (opts: { applied?: string[]; rooms?: string[] } = {}) => ({
  ...ctx({ lists: ['l1', 'entretien'], kinds: { entretien: 'entretien' }, applied: opts.applied }),
  roomIds: new Set(opts.rooms ?? ['p-cuisine']),
});
const brita = (over: Partial<TaskItem> = {}): TaskItem => ({
  id: 'g1', listId: 'entretien', text: 'Carafe Brita : changer la cartouche', who: [], due: null, done: false,
  rec: { freq: 'weekly', every: 4, base: 'done' }, remind: 'morning',
  maintenance: { roomId: 'p-cuisine', stock: { qty: 4, unit: 'cartouche', use: 1, threshold: 1, article: 'Cartouche Brita MAXTRA PRO', countedAt: '2026-10-01' } },
  ...over,
});
// 10 h à Paris le 17/10/2026 (heure d'été, UTC+2).
const LE_17 = '2026-10-17T08:00:00.000Z';

test('entretien : « Fait aujourd’hui » sur un geste jamais noté lance la série et prend une cartouche', () => {
  const r = applyOps([brita()], [op({ op: 'done', id: 'g1', occ: '', by: 'thomas', at: LE_17 })], entCtx());
  const g = r.items[0];
  assert.equal(g.due, '2026-11-14', 'quatre semaines après le jour du geste');
  assert.equal(g.done, false, 'une série ne se termine pas');
  assert.deepEqual(g.history, [{ at: LE_17, by: 'thomas', due: null, used: 1 }]);
  assert.equal(g.maintenance?.stock?.qty, 3);
  assert.equal(g.maintenance?.stock?.countedAt, '2026-10-17', 'le stock est daté du geste');
  assert.equal(g.remind, 'morning', 'le rappel choisi avant la première fois est toujours là');
});

test('entretien : deux téléphones à jour notent le même geste le même jour, une seule réalisation et un seul décrément', () => {
  const r1 = applyOps([brita()], [op({ op: 'done', id: 'g1', occ: '', by: 'thomas', at: LE_17 })], entCtx());
  // Nolwenn a rechargé : elle voit la nouvelle échéance, et tape deux minutes plus tard.
  const r2 = applyOps(r1.items, [op({ op: 'done', id: 'g1', occ: '2026-11-14', by: 'nolwenn', at: '2026-10-17T08:02:00.000Z' })], entCtx());
  assert.equal(r2.applied.length, 1, 'acquittée, pas refusée : le téléphone la retire de sa file');
  assert.equal(r2.items[0].history?.length, 1);
  assert.equal(r2.items[0].history?.[0].by, 'thomas', 'la première réalisation reste l’information vraie');
  assert.equal(r2.items[0].maintenance?.stock?.qty, 3, 'pas de second décrément');
  assert.equal(r2.items[0].due, '2026-11-14');
});

test('entretien : un téléphone périmé qui note le même geste est sans objet', () => {
  const r1 = applyOps([brita()], [op({ op: 'done', id: 'g1', occ: '', by: 'thomas', at: LE_17 })], entCtx());
  // Parti hors ligne avant la coche de Thomas : il croit encore le geste jamais noté.
  const r2 = applyOps(r1.items, [op({ op: 'done', id: 'g1', occ: '', by: 'nolwenn', at: '2026-10-18T08:00:00.000Z' })], entCtx());
  assert.equal(r2.items[0].history?.length, 1);
  assert.equal(r2.items[0].maintenance?.stock?.qty, 3);
});

test('entretien : une coche rejouée après une coupure (même opération) ne prend rien de plus', () => {
  const coche = op({ op: 'done', id: 'g1', occ: '', by: 'thomas', at: LE_17 });
  const r1 = applyOps([brita()], [coche], entCtx());
  const r2 = applyOps(r1.items, [coche], entCtx({ applied: [coche.opId] }));
  assert.deepEqual(r2.items, r1.items);
});

test('entretien : pas de retard cumulé, la date suivante part du jour du geste et c’est le serveur qui la calcule', () => {
  const g = brita({ due: '2026-11-14', history: [{ at: LE_17, by: 'thomas', due: null, used: 1 }] });
  // Un client qui enverrait la date théorique (14/11 + 4 semaines) ne l'impose pas.
  const r = applyOps([g], [op({ op: 'done', id: 'g1', occ: '2026-11-14', next: '2026-12-12', by: 'thomas', at: '2026-11-20T09:00:00.000Z' })], entCtx());
  assert.equal(r.items[0].due, '2026-12-18');
});

test('entretien : le jour du geste est celui de Paris, pas celui du serveur', () => {
  // 23 h 30 UTC le 17 : il est 1 h 30 le 18 à Paris.
  const r = applyOps([brita()], [op({ op: 'done', id: 'g1', occ: '', by: 'me', at: '2026-10-17T23:30:00.000Z' })], entCtx());
  assert.equal(r.items[0].due, '2026-11-15');
  assert.equal(r.items[0].maintenance?.stock?.countedAt, '2026-10-18');
});

test('entretien : annuler la toute première réalisation rend « Pas encore noté » et la cartouche', () => {
  const r1 = applyOps([brita()], [op({ op: 'done', id: 'g1', occ: '', by: 'thomas', at: LE_17 })], entCtx());
  const r2 = applyOps(r1.items, [op({ op: 'reopen', id: 'g1', occ: '' })], entCtx());
  const g = r2.items[0];
  assert.equal(g.due, null, 'de nouveau jamais noté');
  assert.deepEqual(g.history, []);
  assert.equal(g.maintenance?.stock?.qty, 4);
});

test('entretien : « Fait un autre jour » par le foyer (grands-parents, aucun membre)', () => {
  const r = applyOps([brita()], [op({ op: 'done', id: 'g1', occ: '', at: '2026-10-12T10:00:00.000Z' })], entCtx());
  assert.equal(r.items[0].history?.[0].by, null);
  assert.equal(r.items[0].due, '2026-11-09');
});

test('entretien : une réalisation antérieure à la dernière notée est refusée, avec la date', () => {
  const g = brita({ due: '2026-11-14', history: [{ at: LE_17, by: 'thomas', due: null, used: 1 }] });
  const r = applyOps([g], [op({ op: 'done', id: 'g1', occ: '2026-11-14', at: '2026-10-10T10:00:00.000Z' })], entCtx());
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /17\/10\/2026/);
  assert.equal(r.items[0].due, '2026-11-14');
});

test('entretien : un stock vide ne descend pas sous zéro, et la réalisation est notée quand même', () => {
  const g = brita({ maintenance: { stock: { qty: 0, unit: 'cartouche', use: 1, threshold: 1, article: 'Cartouche', countedAt: '2026-10-01' } } });
  const r = applyOps([g], [op({ op: 'done', id: 'g1', occ: '', at: LE_17 })], entCtx());
  assert.equal(r.items[0].maintenance?.stock?.qty, 0);
  assert.deepEqual(r.items[0].history?.[0], { at: LE_17, by: null, due: null }, 'rien de pris, rien à rendre');
});

test('entretien : un geste fait pendant sa pause met fin à la pause', () => {
  const g = brita({ due: '2027-04-15', maintenance: { pausedUntil: '2027-04-15' } });
  const r = applyOps([g], [op({ op: 'done', id: 'g1', occ: '2027-04-15', at: LE_17 })], entCtx());
  assert.equal(r.items[0].maintenance, undefined);
  assert.equal(r.items[0].due, '2026-11-14');
});

test('entretien : « j’en ai racheté 6 » s’ajoute, « j’en compte 4 » remplace, avec la date du comptage', () => {
  const r1 = applyOps([brita({ maintenance: { stock: { qty: 3, unit: 'cartouche', use: 1, threshold: 1, article: 'Cartouche', countedAt: '2026-10-17' } } })],
    [op({ op: 'stock', id: 'g1', add: 6, on: '2026-10-20', by: 'me' })], entCtx());
  assert.equal(r1.items[0].maintenance?.stock?.qty, 9);
  assert.equal(r1.items[0].maintenance?.stock?.countedAt, '2026-10-20');
  const r2 = applyOps(r1.items, [op({ op: 'stock', id: 'g1', set: 4, at: LE_17 })], entCtx());
  assert.equal(r2.items[0].maintenance?.stock?.qty, 4);
  assert.equal(r2.items[0].maintenance?.stock?.countedAt, '2026-10-17');
});

test('entretien : un rachat et un geste notés en même temps sur deux téléphones se composent', () => {
  const depart = [brita()];
  const a = applyOps(depart, [op({ op: 'done', id: 'g1', occ: '', at: LE_17 })], entCtx());
  const b = applyOps(a.items, [op({ op: 'stock', id: 'g1', add: 6, at: LE_17 })], entCtx());
  assert.equal(b.items[0].maintenance?.stock?.qty, 9, '4 - 1 + 6 : aucune des deux intentions n’a écrasé l’autre');
});

test('entretien : l’opération de stock refuse ce qui ne se compte pas', () => {
  const sans = applyOps([brita({ maintenance: {} })], [op({ op: 'stock', id: 'g1', add: 1 })], entCtx());
  assert.equal(sans.skipped.length, 1, 'pas de stock sur ce geste');
  const deux = applyOps([brita()], [op({ op: 'stock', id: 'g1', add: 1, set: 3 })], entCtx());
  assert.equal(deux.skipped.length, 1, 'ajouter ou compter, pas les deux');
  const neg = applyOps([brita()], [op({ op: 'stock', id: 'g1', set: -2 })], entCtx());
  assert.equal(neg.skipped.length, 1);
  const moins = applyOps([brita()], [op({ op: 'stock', id: 'g1', add: -10 })], entCtx());
  assert.equal(moins.items[0].maintenance?.stock?.qty, 0, 'on en jette plus qu’il n’y en a : zéro, pas moins');
});

test('entretien : modifier la fiche ne réécrit jamais la quantité d’un stock déjà là', () => {
  // Formulaire ouvert avant le geste noté sur l'autre téléphone : il porte encore 4.
  const r = applyOps([brita({ maintenance: { stock: { qty: 3, unit: 'cartouche', use: 1, threshold: 1, article: 'Cartouche', countedAt: '2026-10-17' } } })],
    [op({ op: 'edit', id: 'g1', maintenance: { stock: { qty: 4, unit: 'cartouches', use: 1, threshold: 2, article: 'Cartouche Brita MAXTRA PRO' } } })], entCtx());
  const st = r.items[0].maintenance?.stock;
  assert.equal(st?.qty, 3);
  assert.equal(st?.threshold, 2, 'le reste de la fiche, lui, est modifié');
  assert.equal(st?.article, 'Cartouche Brita MAXTRA PRO');
});

test('entretien : la création pose le stock donné, daté du jour ; une pièce inconnue tombe sans faire échouer', () => {
  const r = applyOps([], [op({
    op: 'add', id: 'g2', listId: 'entretien', text: 'Lave-vaisselle : sel', at: LE_17,
    rec: { freq: 'monthly', every: 1, base: 'done' },
    maintenance: { roomId: 'p-disparue', howto: 'Quand le voyant s’allume.', catalogId: 'lave-vaisselle-sel', stock: { qty: 2, unit: 'paquet', article: 'Sel régénérant' } },
  })], entCtx());
  const m = r.items[0].maintenance;
  assert.equal(m?.roomId, undefined);
  assert.equal(m?.howto, 'Quand le voyant s’allume.');
  assert.equal(m?.catalogId, 'lave-vaisselle-sel');
  assert.deepEqual(m?.stock, { article: 'Sel régénérant', unit: 'paquet', qty: 2, use: 1, threshold: 0, countedAt: '2026-10-17' });
});

test('entretien : les champs d’entretien ne valent que dans la liste Entretien', () => {
  const r = applyOps([task()], [op({ op: 'edit', id: 't1', maintenance: { howto: 'x' } })], entCtx());
  assert.equal(r.skipped.length, 1);
  assert.equal(r.items[0].maintenance, undefined);
  const bad = applyOps([brita()], [op({ op: 'edit', id: 'g1', maintenance: { stock: { article: 'x', qty: 1.5 } } })], entCtx());
  assert.equal(bad.skipped.length, 1, 'une quantité qui n’est pas entière est une erreur de saisie, nommée');
});

test('une tâche ordinaire garde sa règle : deux coches le même jour sur une série quotidienne avancent deux fois', () => {
  const t = task({ rec: { freq: 'daily', every: 1, base: 'done' }, due: '2026-09-05' });
  const r1 = applyOps([t], [op({ op: 'done', id: 't1', occ: '2026-09-05', next: '2026-09-06', at: '2026-09-05T08:00:00Z' })], ctx());
  const r2 = applyOps(r1.items, [op({ op: 'done', id: 't1', occ: '2026-09-06', next: '2026-09-07', at: '2026-09-05T09:00:00Z' })], ctx());
  assert.equal(r2.items[0].history?.length, 2, 'la règle « une fois par jour » est propre aux gestes d’entretien');
});

test('un rappel sans date est gardé sur une série, retiré sur une tâche ponctuelle', () => {
  const r = applyOps([], [
    op({ op: 'add', id: 'a', listId: 'l1', text: 'Série', rec: { freq: 'weekly', every: 1, base: 'done' }, due: null, remind: 'morning' }),
    op({ op: 'add', id: 'b', listId: 'l1', text: 'Ponctuelle', due: null, remind: 'morning' }),
  ], ctx());
  assert.equal(r.items.find((t) => t.id === 'a')?.remind, 'morning');
  assert.equal(r.items.find((t) => t.id === 'b')?.remind, undefined);
});

test('une pièce supprimée : le geste passe « Sans pièce », il ne disparaît pas', () => {
  const rep = reconcile([brita()], new Set(['entretien']), new Set(['me']), new Set(), new Set());
  assert.equal(rep.items.length, 1);
  assert.equal(rep.items[0].maintenance?.roomId, undefined);
  assert.equal(rep.items[0].maintenance?.stock?.qty, 4, 'le reste de la fiche est intact');
  assert.equal(rep.unlinked, 1);
});
