// L'écran Entretien range et dit les gestes ; ces tests fixent ce qui se voit :
// un geste jamais noté n'est jamais en retard, l'horizon est celui du réglage,
// la fréquence et le stock se lisent en français.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TaskItem } from './models';
import { applyTaskOp, TaskOp } from './task-ops';
import { Catalogue, bulkReady, suggestionsFor, catalogueByFamily, createOp, draftFromCatalogue, draftOf, editOps, freqLabel, gesteGroup, groupLabel, lastDoneLabel, middayOf, nextLabel, realisationRows, HISTORY_MAX, stockLabel, stockLeftLabel, stockLow } from './entretien';

const TODAY = '2026-10-17';
const fmt = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const geste = (over: Partial<TaskItem> = {}): TaskItem => ({
  id: 'g1', listId: 'entretien', text: 'Carafe Brita', who: [], due: null, done: false,
  rec: { freq: 'weekly', every: 4, base: 'done' }, ...over,
});

test('groupes : jamais noté n’est jamais en retard, l’horizon suit le réglage', () => {
  assert.equal(gesteGroup(geste(), TODAY, 14), 'jamais');
  assert.equal(gesteGroup(geste({ due: '2026-10-10' }), TODAY, 14), 'retard');
  assert.equal(gesteGroup(geste({ due: TODAY }), TODAY, 14), 'bientot', 'le jour même n’est pas en retard');
  assert.equal(gesteGroup(geste({ due: '2026-10-31' }), TODAY, 14), 'bientot');
  assert.equal(gesteGroup(geste({ due: '2026-11-01' }), TODAY, 14), 'plustard');
  assert.equal(gesteGroup(geste({ due: '2026-11-01' }), TODAY, 30), 'bientot');
  assert.equal(gesteGroup(geste({ due: '2026-10-10', rec: { freq: 'yearly', every: 1, base: 'due', grace: 30 } }), TODAY, 14), 'bientot', 'dans la souplesse : pas encore en retard');
  assert.equal(gesteGroup(geste({ done: true, due: '2026-10-10' }), TODAY, 14), 'archive');
  assert.equal(groupLabel('bientot', 14), 'Dans les 14 jours');
});

test('fréquence en clair', () => {
  assert.equal(freqLabel({ freq: 'weekly', every: 4, base: 'done' }), 'toutes les 4 semaines');
  assert.equal(freqLabel({ freq: 'monthly', every: 6, base: 'done' }), 'tous les 6 mois');
  assert.equal(freqLabel({ freq: 'yearly', every: 1, base: 'done' }), '1 fois par an');
  assert.equal(freqLabel({ freq: 'yearly', every: 1, base: 'due' }), 'chaque année, à date fixe');
  assert.equal(freqLabel({ freq: 'yearly', every: 5, base: 'done' }), 'tous les 5 ans');
  assert.equal(freqLabel({ freq: 'weekly', every: 1, base: 'done' }), 'chaque semaine');
});

test('dernière fois, prochaine date, pause', () => {
  const name = (id: string) => (id === 'n' ? 'Nolwenn' : '');
  assert.equal(lastDoneLabel(geste(), fmt, name), '');
  assert.equal(lastDoneLabel(geste({ history: [{ at: '2026-09-30T08:00:00Z', by: 'n', due: null }] }), fmt, name), 'Fait le 30/09/2026 par Nolwenn');
  assert.equal(lastDoneLabel(geste({ history: [{ at: middayOf('2026-08-12'), by: null, due: null }] }), fmt, name), 'Fait le 12/08/2026 par le foyer');
  // 23 h 30 UTC le 30/09, c'est le 1er octobre à Paris.
  assert.equal(lastDoneLabel(geste({ history: [{ at: '2026-09-30T23:30:00Z', by: 'n', due: null }] }), fmt, name), 'Fait le 01/10/2026 par Nolwenn');
  assert.equal(nextLabel(geste({ due: '2026-10-28' }), TODAY, fmt), 'Le 28/10/2026');
  assert.equal(nextLabel(geste({ due: '2027-04-15', maintenance: { pausedUntil: '2027-04-15' } }), TODAY, fmt), 'En pause jusqu’au 15/04/2027');
  assert.equal(nextLabel(geste(), TODAY, fmt), '', 'jamais noté : pas de fausse date');
});

test('midi à Paris tombe le bon jour, été comme hiver', () => {
  for (const d of ['2026-07-14', '2026-12-25', '2026-10-25', '2027-03-28']) {
    const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(middayOf(d)));
    assert.equal(t, d);
  }
});

test('stock en clair, et le seuil', () => {
  const s = { qty: 4, unit: 'cartouche', use: 1, threshold: 1, article: 'Cartouche', countedAt: '2026-10-17' };
  assert.equal(stockLabel(s, fmt), 'Stock au 17/10/2026 : 4 cartouches');
  assert.equal(stockLabel({ ...s, qty: 1 }, fmt), 'Stock au 17/10/2026 : 1 cartouche');
  assert.equal(stockLabel({ ...s, qty: 2, unit: 'jeu' }, fmt), 'Stock au 17/10/2026 : 2 jeux');
  assert.equal(stockLow(s), false);
  assert.equal(stockLow({ ...s, qty: 1 }), true);
});

const CATALOGUE: Catalogue = {
  gestes: [
    { id: 'carafe-filtrante', titre: 'Carafe filtrante : changer la cartouche', famille: 'Eau', piece: 'Cuisine', rec: { freq: 'weekly', every: 4, base: 'done' },
      article: { nom: 'Cartouche pour carafe filtrante', unite: 'cartouche', use: 1, seuil: 1 } },
    { id: 'chaudiere-entretien', titre: 'Chaudière : entretien annuel', famille: 'Chauffage et air', rec: { freq: 'yearly', every: 1, base: 'due', grace: 30 } },
  ],
};

test('créer depuis le catalogue : fréquence, stock et catalogue préremplis', () => {
  const d = { ...draftFromCatalogue(CATALOGUE.gestes[0], TODAY, 'p1'), stock: { ...draftFromCatalogue(CATALOGUE.gestes[0], TODAY, 'p1').stock!, qty: 4 } };
  const op = createOp(d, 'g9', TODAY);
  const [g] = applyTaskOp([], { ...op, opId: 'x', at: '2026-10-17T08:00:00Z', by: 'me' } as TaskOp);
  assert.equal(g.listId, 'entretien');
  assert.equal(g.due, null, 'pas encore noté');
  assert.deepEqual(g.rec, { freq: 'weekly', every: 4, base: 'done' });
  assert.equal(g.remind, 'morning', 'le rappel du matin, gardé jusqu’à la première fois');
  assert.equal(g.maintenance?.roomId, 'p1');
  assert.equal(g.maintenance?.catalogId, 'carafe-filtrante');
  assert.deepEqual(g.maintenance?.stock, { qty: 4, unit: 'cartouche', use: 1, threshold: 1, article: 'Cartouche pour carafe filtrante', countedAt: '2026-10-17' });
});

test('date fixe : la chaudière part de la date choisie, avec sa souplesse', () => {
  const op = createOp({ ...draftFromCatalogue(CATALOGUE.gestes[1], TODAY, null), fixedDate: '2026-10-15' }, 'g8', TODAY);
  assert.equal(op.op === 'add' && op.due, '2026-10-15');
  assert.deepEqual(op.op === 'add' && op.rec, { freq: 'yearly', every: 1, base: 'due', grace: 30 });
});

test('modifier : la fiche relue donne le même geste, et une date fixe déplacée devient l’échéance', () => {
  const t = geste({ due: '2026-11-14', maintenance: { roomId: 'p1', howto: 'Indicateur', stock: { qty: 3, unit: 'cartouche', use: 1, threshold: 1, article: 'C', countedAt: TODAY } } });
  const [same] = editOps(t, draftOf(t));
  assert.equal(same.op === 'edit' && same.due, undefined, 'rien de déplacé');
  assert.deepEqual(same.op === 'edit' && same.rec, t.rec);
  const fixe = geste({ due: '2026-10-15', rec: { freq: 'yearly', every: 1, base: 'due' } });
  const [moved] = editOps(fixe, { ...draftOf(fixe), fixedDate: '2026-10-20' });
  assert.equal(moved.op === 'edit' && moved.due, '2026-10-20');
});

test('catalogue : rangé par famille, recherche sans accents', () => {
  assert.deepEqual(catalogueByFamily(CATALOGUE, '').map((f) => f.famille), ['Eau', 'Chauffage et air']);
  assert.deepEqual(catalogueByFamily(CATALOGUE, 'chaudiere').flatMap((f) => f.gestes.map((g) => g.id)), ['chaudiere-entretien']);
  assert.deepEqual(catalogueByFamily(CATALOGUE, 'cartouche').flatMap((f) => f.gestes.map((g) => g.id)), ['carafe-filtrante']);
});

test('noté par un assistant : l’historique le dit', () => {
  const g = geste({ history: [{ at: '2026-10-17T08:00:00Z', by: 'n', due: null, via: 'Claude iPhone' }] });
  assert.equal(lastDoneLabel(g, fmt, () => 'Nolwenn'), 'Fait le 17/10/2026 par Nolwenn (via un assistant)');
});

test('l’appareil rattaché suit le geste : création, relecture, modification', () => {
  const op = createOp({ ...draftFromCatalogue(null, TODAY, null), text: 'Chaudière', equipmentId: 7 }, 'g7', TODAY);
  assert.equal(op.op === 'add' && op.maintenance?.equipmentId, 7);
  const t = geste({ maintenance: { equipmentId: 7 } });
  assert.equal(draftOf(t).equipmentId, 7);
  const [e] = editOps(t, { ...draftOf(t), equipmentId: null });
  assert.equal(e.op === 'edit' && e.maintenance?.equipmentId, null, 'retirer l’appareil s’écrit null');
});

// ---- saisons et fenêtres ----

const PISCINE = { id: 'piscine-ph', titre: 'Piscine : pH', famille: 'Piscine', rec: { freq: 'weekly' as const, every: 1, base: 'done' as const, season: { from: '05-01', to: '09-30' } } };
const RAMONAGE = { id: 'ramonage', titre: 'Ramonage', famille: 'Chauffage et air', rec: { freq: 'yearly' as const, every: 1, base: 'due' as const, season: { from: '09-01', to: '10-31' } } };

test('saison : un geste créé hors saison attend la reprise, dite « Reprend le »', () => {
  const op = createOp(draftFromCatalogue(PISCINE, TODAY, null), 'g6', TODAY);
  assert.equal(op.op === 'add' && op.due, '2027-05-01');
  assert.deepEqual(op.op === 'add' && op.rec, { freq: 'weekly', every: 1, base: 'done', season: { from: '05-01', to: '09-30' } });
  const g = geste({ due: '2027-05-01', rec: PISCINE.rec });
  assert.equal(nextLabel(g, TODAY, fmt), 'Reprend le 01/05/2027');
  assert.equal(gesteGroup(g, TODAY, 14), 'plustard');
  assert.equal(freqLabel(PISCINE.rec), 'chaque semaine, de mai à septembre');
  // En saison, sans dernière fois : pas de fausse date.
  assert.equal((createOp(draftFromCatalogue(PISCINE, '2026-06-10', null), 'g5', '2026-06-10') as { due: string | null }).due, null);
});

test('saison ajoutée à un geste existant : une échéance hors saison passe à la reprise', () => {
  const t = geste({ due: '2026-11-07', rec: { freq: 'weekly', every: 1, base: 'done' } });
  const [e] = editOps(t, { ...draftOf(t), season: { from: '05-01', to: '09-30' } });
  assert.equal(e.op === 'edit' && e.due, '2027-05-01');
  assert.equal(draftOf(geste({ rec: PISCINE.rec })).season?.to, '09-30', 'relue telle quelle');
});

test('fenêtre : le ramonage du catalogue devient une date fixe et sa souplesse', () => {
  const d = draftFromCatalogue(RAMONAGE, TODAY, null);
  assert.equal(d.fixed, true);
  assert.equal(d.fixedDate, '2026-09-01', 'le 17 octobre, la fenêtre de cette année court encore');
  assert.equal(d.grace, 60);
  assert.equal(d.season, null, 'une fenêtre n’est pas une saison de répétition');
  assert.equal(draftFromCatalogue(RAMONAGE, '2026-11-02', null).fixedDate, '2027-09-01', 'passée, la suivante');
  const g = geste({ due: '2026-09-01', rec: { freq: 'yearly', every: 1, base: 'due', grace: 60 } });
  assert.equal(nextLabel(g, TODAY, fmt), 'À faire d’ici le 31/10/2026');
  assert.equal(nextLabel(g, '2026-08-20', fmt), 'Entre le 01/09/2026 et le 31/10/2026');
  assert.equal(gesteGroup(g, TODAY, 14), 'bientot', 'dans la fenêtre : pas en retard');
  assert.equal(gesteGroup(g, '2026-11-01', 14), 'retard');
});

test('le stock restant se dit sur la ligne, sans accord hasardeux', () => {
  const st = (qty: number, unit = 'cartouche') => ({ qty, unit, use: 1, threshold: 1, countedAt: '2026-10-01', article: 'Cartouches' });
  assert.equal(stockLeftLabel(st(1)), 'Encore 1 cartouche');
  assert.equal(stockLeftLabel(st(4)), 'Encore 4 cartouches');
  assert.equal(stockLeftLabel(st(0)), 'Plus de cartouche');
  assert.equal(stockLeftLabel(st(3, '')), 'Encore 3 en stock');
  assert.equal(stockLeftLabel(st(0, '')), 'Stock épuisé');
});

test('historique : une note sur une réalisation annulée reste, marquée annulée', () => {
  const h = [{ at: '2026-09-01T10:00:00Z', by: 'm1', due: null }, { at: '2026-10-01T10:00:00Z', by: null, due: '2026-09-29' }];
  const rows = realisationRows(h, [
    { doneAt: '2026-10-01T10:00:00Z', note: 'ok' },
    { doneAt: '2026-10-10T10:00:00Z', note: 'refaite après annulation' },
  ]);
  assert.deepEqual(rows.map((r) => [r.at.slice(0, 10), r.cancelled, !!r.done, r.extras?.note ?? null]), [
    ['2026-10-10', true, false, 'refaite après annulation'],
    ['2026-10-01', false, true, 'ok'],
    ['2026-09-01', false, true, null],
  ]);
});

test('historique plein : une note plus ancienne que lui n’est pas une annulation', () => {
  const h = Array.from({ length: HISTORY_MAX }, (_, i) => ({ at: `2027-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`, by: null, due: null }));
  const rows = realisationRows(h, [{ doneAt: '2020-05-01T10:00:00Z' }]);
  assert.equal(rows.at(-1)!.cancelled, false);
});

test('création en lot : jamais une date fixe sans fenêtre, dont la date ne se devine pas', () => {
  const e = (rec: Record<string, unknown>) => ({ id: 'x', titre: 'X', famille: 'F', rec } as never);
  assert.equal(bulkReady(e({ freq: 'weekly', every: 4, base: 'done' })), true, 'naît « Pas encore noté »');
  assert.equal(bulkReady(e({ freq: 'yearly', every: 1, base: 'due', season: { from: '09-01', to: '10-31' } })), true, 'naît à sa fenêtre');
  assert.equal(bulkReady(e({ freq: 'yearly', every: 1, base: 'due', grace: 30 })), false, 'la chaudière : sa date se choisit');
});

test('suggestions d’un appareil : par un mot entier de son nom, sans doublon, en rattachant ce qui existe', () => {
  const rec = { freq: 'monthly' as const, every: 1, base: 'done' as const };
  const c: Catalogue = { gestes: [
    { id: 'lv-filtre', titre: 'Lave-vaisselle : filtre', famille: 'Cuisine', rec, appareils: ['lave-vaisselle'] },
    { id: 'lv-sel', titre: 'Lave-vaisselle : sel', famille: 'Cuisine', rec, appareils: ['lave-vaisselle'] },
    { id: 'clim', titre: 'Clim : filtres', famille: 'Air', rec, appareils: ['clim'] },
    { id: 'carafe', titre: 'Carafe', famille: 'Eau', rec },
  ] };
  const lie = geste({ id: 'a', maintenance: { catalogId: 'lv-filtre', equipmentId: 7 } });
  const libre = geste({ id: 'b', maintenance: { catalogId: 'lv-sel' } });
  const s = suggestionsFor('Lave vaisselle Bosch', 7, c, [lie, libre]);
  assert.deepEqual(s.map((x) => [x.entry.id, x.existing?.id ?? null]), [['lv-sel', 'b']], 'le filtre est déjà rattaché ; le sel existe, à rattacher');
  assert.equal(suggestionsFor('Lave-vaisselle', 8, c, [lie, libre]).length, 2, 'un autre lave-vaisselle : le filtre rattaché au premier se propose de nouveau');
  assert.equal(suggestionsFor('Station Climat', 9, c, []).length, 0, '« clim » n’est pas un mot de « Climat »');
  assert.equal(suggestionsFor('Clim du salon', 9, c, []).length, 1);
});

