// La fiche d'élément : la machine d'état (vue, édition, retour, pile) et le
// registre des types (chaque type a un écran valide, un formulaire ou une
// raison de ne pas en avoir).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ITEM_KINDS, ItemRef } from './items';
import { sheetBack, sheetDepth, sheetEdit, sheetOpen, sheetSaved } from './item-sheet';
import { SCREENS } from './constants';
import { SCREEN_MODULE } from './modules';
import { NAV_GROUPS } from '../shell/nav';

// ---- machine d'état ----------------------------------------------------------

test('un tap ouvre la fiche en vue ; une création s’ouvre directement en édition', () => {
  assert.deepEqual(sheetOpen(null, 'event', 'e1'), { kind: 'event', id: 'e1', mode: 'vue' });
  assert.deepEqual(sheetOpen(null, 'event', null, { date: '2026-10-20' }), { kind: 'event', id: null, mode: 'edition', ctx: { date: '2026-10-20' } });
});

test('vue → Modifier → Sauvegarder → vue, sur le même élément', () => {
  const vue = sheetOpen(null, 'event', 'e1', { occ: '2026-10-20' });
  const ed = sheetEdit(vue)!;
  assert.equal(ed.mode, 'edition');
  assert.deepEqual(ed.ctx, { occ: '2026-10-20' }, 'l’occurrence suit la fiche');
  assert.deepEqual(sheetSaved(ed), vue);
});

test('une occurrence détachée de sa série : la fiche suit le nouvel événement', () => {
  const ed = sheetEdit(sheetOpen(null, 'event', 'serie', { occ: '2026-10-20' }));
  assert.deepEqual(sheetSaved(ed, 'seul'), { kind: 'event', id: 'seul', mode: 'vue' });
  assert.deepEqual(sheetSaved(ed, 'serie'), { kind: 'event', id: 'serie', mode: 'vue', ctx: { occ: '2026-10-20' } });
});

test('édition → retour : revient à la vue, sans fermer', () => {
  const vue = sheetOpen(null, 'event', 'e1');
  assert.deepEqual(sheetBack(sheetEdit(vue)), vue);
  assert.equal(sheetBack(vue), null, 'depuis la vue, le retour ferme');
});

test('une création annulée ou enregistrée referme la fiche', () => {
  const cr = sheetOpen(null, 'event', null);
  assert.equal(sheetBack(cr), null);
  assert.equal(sheetSaved(cr), null);
  assert.equal(sheetEdit(cr), cr, 'déjà en édition');
});

test('pile : ouvrir depuis une fiche garde la précédente, en vue, et le retour y ramène', () => {
  const repas = sheetEdit(sheetOpen(null, 'event', 'e1', { occ: '2026-10-20' }));
  const recette = sheetOpen(repas, 'event', 'e2', undefined, true);
  assert.deepEqual(recette.ctx?.prev, { kind: 'event', id: 'e1', mode: 'vue', ctx: { occ: '2026-10-20' } });
  assert.deepEqual(sheetBack(recette), recette.ctx?.prev);
  assert.equal(sheetBack(sheetBack(recette)), null);
});

test('pile : jamais plus de deux niveaux', () => {
  const a = sheetOpen(null, 'event', 'a');
  const b = sheetOpen(a, 'event', 'b', undefined, true);
  const c = sheetOpen(b, 'event', 'c', undefined, true);
  assert.equal(c.ctx?.prev?.id, 'b');
  assert.equal(c.ctx?.prev?.ctx?.prev, undefined, 'a est oublié');
});

test('ouvrir sans empiler remplace la fiche courante', () => {
  const a = sheetOpen(null, 'event', 'a');
  assert.deepEqual(sheetOpen(a, 'event', 'b'), { kind: 'event', id: 'b', mode: 'vue' });
});

test('profondeur d’historique : un cran par niveau, un de plus en édition', () => {
  const vue = sheetOpen(null, 'event', 'e1');
  assert.equal(sheetDepth(null), 0);
  assert.equal(sheetDepth(vue), 1);
  assert.equal(sheetDepth(sheetEdit(vue)), 2);
  assert.equal(sheetDepth(sheetOpen(null, 'event', null)), 1, 'une création n’a pas de vue derrière elle');
  const pile = sheetEdit(sheetOpen(sheetEdit(vue), 'event', 'e2', undefined, true));
  assert.equal(sheetDepth(pile), 3);
  // Chaque retour retire exactement un cran : l'historique et la fiche restent d'accord.
  let cur: ItemRef | null = pile;
  for (let d = 3; d > 0; d--) { assert.equal(sheetDepth(cur), d); cur = sheetBack(cur); }
  assert.equal(cur, null);
});

// ---- registre ----------------------------------------------------------------

test('chaque type mène à un écran qui existe, et dépend du même module que lui', () => {
  for (const m of Object.values(ITEM_KINDS)) {
    assert.ok((SCREENS as readonly string[]).includes(m.screen), `${m.kind} : écran inconnu ${m.screen}`);
    assert.equal(m.module, SCREEN_MODULE[m.screen], `${m.kind} : module incohérent avec l’écran ${m.screen}`);
    assert.ok(m.openLabel.startsWith('Ouvrir dans ') || m.openLabel.startsWith('Voir dans '), m.kind);
  }
});

test('un type sans formulaire dit pourquoi, et n’a pas de suppression', () => {
  for (const m of Object.values(ITEM_KINDS)) {
    if (m.editable) continue;
    assert.ok(m.readOnlyReason, `${m.kind} : lecture seule sans raison`);
    assert.equal(m.removeMode, null, `${m.kind} : lecture seule mais supprimable`);
  }
});

test('les clés du registre sont les types qu’elles déclarent', () => {
  for (const [k, m] of Object.entries(ITEM_KINDS)) assert.equal(m.kind, k);
});

test('la navigation ne mène qu’à des écrans connus, et l’École en fait partie', () => {
  for (const g of NAV_GROUPS) for (const i of g.items) assert.ok((SCREENS as readonly string[]).includes(i.id), i.id);
  assert.ok((SCREENS as readonly string[]).includes('ecole'), 'un rechargement sur École doit y revenir');
});
