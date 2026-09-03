// La copie de journée.
//
// Deux propriétés comptent plus que les autres, et ce sont celles que la recette
// vérifie à la main :
//   - une fusion ne crée jamais de doublon ;
//   - un collage en mode remplacer est **intégralement** annulable.
// Le reste des tests protège la seconde règle du module : rien ne disparaît sans
// que le rapport le dise.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PastePlan, applyPaste, planPaste, pasteSummary, signatureOf, undoPaste } from './sched-copy';
import { SchedSlot } from './models';
import { dowLabel } from './schedule';

const slot = (over: Partial<SchedSlot> = {}): SchedSlot =>
  ({ id: 's1', who: ['m1'], dow: 1, start: '08:00', end: '09:00', label: 'École', k: 'ecole', ...over });

/** Identifiants prévisibles : les tests parlent de « c1 », pas d'un tirage. */
const compteur = () => { let n = 0; return () => 'c' + (++n); };

const plan = (sched: SchedSlot[], source: SchedSlot[], over: Partial<Parameters<typeof planPaste>[0]> = {}) =>
  planPaste({ sched, source, targetDows: [2], mode: 'merge', newId: compteur(), ...over });

const apply = (sched: SchedSlot[], p: PastePlan) => applyPaste(sched, p);
const labels = (sched: SchedSlot[]) => sched.map((s) => s.dow + ':' + s.label).sort();

// ---- le geste de base -------------------------------------------------------

test('coller une journée sur une autre recopie ses créneaux, horaires compris', () => {
  const lundi = [
    slot({ id: 'a', dow: 1, start: '07:50', end: '08:05', label: 'Car' }),
    slot({ id: 'b', dow: 1, start: '08:30', end: '16:30', label: 'École' }),
  ];
  const p = plan(lundi, lundi);
  assert.equal(p.added.length, 2);
  assert.deepEqual(p.added.map((s) => s.dow), [2, 2]);
  assert.deepEqual(p.added.map((s) => s.start), ['07:50', '08:30']);
  assert.deepEqual(p.added.map((s) => s.id), ['c1', 'c2'], 'les copies ont leurs propres identifiants');
  assert.equal(p.removed.length, 0, 'une fusion ne supprime rien');
});

test('coller sur plusieurs jours d’un coup écrit chaque jour', () => {
  // La recette de l'utilisateur : je remplis le lundi, je le colle sur mardi,
  // jeudi et vendredi en une fois.
  const lundi = [slot({ id: 'a', dow: 1, label: 'Car' }), slot({ id: 'b', dow: 1, start: '17:45', label: 'Retour' })];
  const p = plan(lundi, lundi, { targetDows: [2, 4, 5] });
  assert.equal(p.added.length, 6);
  assert.deepEqual(p.targets, [2, 4, 5]);
  assert.deepEqual([...new Set(p.added.map((s) => s.dow))].sort(), [2, 4, 5]);
});

test('coller une journée sur elle-même ne fait rien', () => {
  const lundi = [slot({ id: 'a', dow: 1 })];
  const p = plan(lundi, lundi, { targetDows: [1] });
  assert.equal(p.added.length, 0);
  assert.equal(p.removed.length, 0);
  assert.equal(pasteSummary(p, dowLabel), 'Rien à coller');
});

test('les copies ne partagent pas la liste de membres de leur source', () => {
  // Un partage de référence ferait qu'ajouter un membre au créneau collé
  // l'ajouterait aussi à l'original, silencieusement.
  const src = [slot({ id: 'a', who: ['m1', 'm2'] })];
  const p = plan(src, src);
  p.added[0].who.push('m3');
  assert.deepEqual(src[0].who, ['m1', 'm2']);
});

// ---- fusionner ne crée pas de doublon ---------------------------------------

test('une fusion n’écrit pas un créneau déjà identique', () => {
  const lundi = slot({ id: 'a', dow: 1, start: '07:50', label: 'Car' });
  const mardi = slot({ id: 'b', dow: 2, start: '07:50', label: 'Car' });
  const p = plan([lundi, mardi], [lundi]);
  assert.equal(p.added.length, 0);
  assert.equal(p.duplicates, 1);
});

test('une fusion écrit ce qui diffère, même d’une minute', () => {
  const lundi = slot({ id: 'a', dow: 1, start: '07:50', label: 'Car' });
  const mardi = slot({ id: 'b', dow: 2, start: '07:55', label: 'Car' });
  const p = plan([lundi, mardi], [lundi]);
  assert.equal(p.added.length, 1);
  assert.equal(p.duplicates, 0);
});

test('coller deux fois de suite ne double pas la journée', () => {
  // Le geste le plus probable de quelqu'un qui n'est pas sûr d'avoir cliqué.
  const lundi = [slot({ id: 'a', dow: 1, label: 'Car' }), slot({ id: 'b', dow: 1, start: '17:45', label: 'Retour' })];
  let sched = [...lundi];
  sched = apply(sched, planPaste({ sched, source: lundi, targetDows: [2], mode: 'merge', newId: compteur() }));
  assert.equal(sched.length, 4);
  const second = planPaste({ sched, source: lundi, targetDows: [2], mode: 'merge', newId: compteur() });
  assert.equal(second.added.length, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(apply(sched, second).length, 4, 'la seconde passe ne doit rien ajouter');
});

test('un même créneau collé sur trois jours n’est pas dédoublonné entre les jours', () => {
  const src = [slot({ id: 'a', dow: 1 })];
  const p = plan(src, src, { targetDows: [2, 3, 4] });
  assert.equal(p.added.length, 3);
  assert.equal(p.duplicates, 0);
});

// ---- remplacer, et son annulation intégrale ---------------------------------

test('remplacer supprime ce que portait le jour cible et le dit', () => {
  const lundi = slot({ id: 'a', dow: 1, label: 'Car' });
  const mardi1 = slot({ id: 'x', dow: 2, label: 'Piscine' });
  const mardi2 = slot({ id: 'y', dow: 2, label: 'Tennis' });
  const p = plan([lundi, mardi1, mardi2], [lundi], { mode: 'replace' });
  assert.deepEqual(p.removed.map((s) => s.id), ['x', 'y']);
  assert.equal(p.added.length, 1);
  assert.equal(pasteSummary(p, dowLabel), '1 créneau collé sur mardi, 2 remplacés');
});

test('un collage en mode remplacer est intégralement annulable', () => {
  const avant: SchedSlot[] = [
    slot({ id: 'a', dow: 1, label: 'Car' }),
    slot({ id: 'x', dow: 2, label: 'Piscine' }),
    slot({ id: 'y', dow: 2, start: '18:00', label: 'Tennis' }),
  ];
  const p = planPaste({ sched: avant, source: [avant[0]], targetDows: [2], mode: 'replace', newId: compteur() });
  const apres = apply(avant, p);
  assert.deepEqual(labels(apres), ['1:Car', '2:Car']);

  const revenu = undoPaste(apres, p);
  assert.deepEqual(labels(revenu), labels(avant), 'l’emploi du temps doit revenir exactement à son état');
  assert.deepEqual(revenu.map((s) => s.id).sort(), ['a', 'x', 'y']);
});

test('une fusion s’annule aussi, en retirant seulement ce qu’elle a écrit', () => {
  const avant = [slot({ id: 'a', dow: 1 }), slot({ id: 'x', dow: 2, start: '18:00', label: 'Tennis' })];
  const p = planPaste({ sched: avant, source: [avant[0]], targetDows: [2], mode: 'merge', newId: compteur() });
  const apres = apply(avant, p);
  assert.equal(apres.length, 3);
  assert.deepEqual(undoPaste(apres, p).map((s) => s.id).sort(), ['a', 'x']);
});

test('l’annulation ne remet pas un créneau que quelqu’un a recréé entre-temps', () => {
  // Le cas à deux appareils : l'annulation vise des identifiants, elle ne
  // réécrit jamais l'emploi du temps en bloc.
  const avant = [slot({ id: 'a', dow: 1 }), slot({ id: 'x', dow: 2, label: 'Piscine' })];
  const p = planPaste({ sched: avant, source: [avant[0]], targetDows: [2], mode: 'replace', newId: compteur() });
  const apres = apply(avant, p);
  // L'autre téléphone remet « x » pendant les quelques secondes de l'annulation.
  const concurrent = [...apres, slot({ id: 'x', dow: 2, label: 'Piscine' })];
  const revenu = undoPaste(concurrent, p);
  assert.equal(revenu.filter((s) => s.id === 'x').length, 1, 'ni doublon, ni perte');
});

test('l’annulation ne touche pas ce que l’autre appareil a ajouté', () => {
  const avant = [slot({ id: 'a', dow: 1 })];
  const p = planPaste({ sched: avant, source: avant, targetDows: [2], mode: 'merge', newId: compteur() });
  const apres = [...apply(avant, p), slot({ id: 'autre', dow: 5, label: 'Ajouté ailleurs' })];
  const revenu = undoPaste(apres, p);
  assert.ok(revenu.some((s) => s.id === 'autre'), 'la modification concurrente survit à l’annulation');
});

// ---- ce que « remplacer » remplace exactement -------------------------------

test('remplacer ne touche que les membres du collage', () => {
  // Coller la journée de Léa ne doit pas effacer celle de tout le monde.
  const lea = slot({ id: 'a', dow: 1, who: ['lea'], label: 'Collège' });
  const mardiLea = slot({ id: 'x', dow: 2, who: ['lea'], label: 'Piscine' });
  const mardiPaul = slot({ id: 'y', dow: 2, who: ['paul'], label: 'Handball' });
  const p = plan([lea, mardiLea, mardiPaul], [lea], { mode: 'replace' });
  assert.deepEqual(p.removed.map((s) => s.id), ['x']);
  assert.deepEqual(p.scope, ['lea']);
});

test('remplacer emporte les créneaux partagés qui touchent le collage', () => {
  // Un trajet Léa + Paul disparaît quand on remplace la journée de Léa. C'est
  // une perte, donc elle est comptée dans le rapport et le collage s'annule.
  const lea = slot({ id: 'a', dow: 1, who: ['lea'] });
  const partage = slot({ id: 'x', dow: 2, who: ['lea', 'paul'], label: 'Trajet' });
  const p = plan([lea, partage], [lea], { mode: 'replace' });
  assert.deepEqual(p.removed.map((s) => s.id), ['x']);
});

test('un jour vide collé en mode remplacer vide la cible, et le dit', () => {
  const mardi = slot({ id: 'x', dow: 2, label: 'Piscine' });
  const p = planPaste({ sched: [mardi], source: [], targetDows: [2], mode: 'replace', newId: compteur() });
  // Une source vide n'a aucun membre : le remplacement ne vise personne.
  assert.equal(p.added.length, 0);
  assert.equal(p.removed.length, 0, 'sans membre au collage, rien n’est visé');
});

// ---- copier vers un autre membre --------------------------------------------

test('coller pour un autre membre garde les horaires et change la personne', () => {
  // Cas réel : une activité qu'un enfant reprend quand l'autre arrête.
  const src = [slot({ id: 'a', dow: 3, who: ['lea'], start: '14:00', end: '15:30', label: 'Gymnastique' })];
  const p = planPaste({ sched: src, source: src, targetDows: null, mode: 'merge', remap: 'paul', newId: compteur() });
  assert.equal(p.added.length, 1);
  assert.deepEqual(p.added[0].who, ['paul']);
  assert.equal(p.added[0].dow, 3, 'le jour ne bouge pas');
  assert.equal(p.added[0].start, '14:00');
  assert.deepEqual(p.scope, ['paul']);
});

test('coller pour un autre membre le même jour n’est pas pris pour un doublon', () => {
  const src = [slot({ id: 'a', dow: 3, who: ['lea'], label: 'Gym' })];
  const p = planPaste({ sched: src, source: src, targetDows: [3], mode: 'merge', remap: 'paul', newId: compteur() });
  assert.equal(p.added.length, 1, 'le même jour est licite dès lors que la personne change');
});

test('remplacer pour un autre membre ne remplace que sa journée', () => {
  const lea = slot({ id: 'a', dow: 3, who: ['lea'], label: 'Gym' });
  const paul = slot({ id: 'x', dow: 3, who: ['paul'], label: 'Handball' });
  const p = planPaste({ sched: [lea, paul], source: [lea], targetDows: null, mode: 'replace', remap: 'paul', newId: compteur() });
  assert.deepEqual(p.removed.map((s) => s.id), ['x']);
  assert.ok(!p.removed.some((s) => s.id === 'a'), 'la journée d’origine n’est jamais touchée');
});

// ---- signature ---------------------------------------------------------------

test('la signature ignore l’identifiant et l’ordre des membres', () => {
  const a = slot({ id: 'a', who: ['m1', 'm2'] });
  const b = slot({ id: 'b', who: ['m2', 'm1'] });
  assert.equal(signatureOf(a), signatureOf(b));
});

test('la signature distingue le jour, l’heure, le type, l’intitulé et les membres', () => {
  const base = slot();
  const differents = [
    slot({ dow: 3 }), slot({ start: '08:30' }), slot({ end: '10:00' }),
    slot({ k: 'sport' }), slot({ label: 'Autre' }), slot({ who: ['m2'] }),
  ];
  for (const d of differents) assert.notEqual(signatureOf(base), signatureOf(d));
  // Casse et espaces d'un intitulé ne font pas deux créneaux différents.
  assert.equal(signatureOf(base), signatureOf(slot({ label: '  école  ' })));
});

// ---- rapport -----------------------------------------------------------------

test('le rapport dit exactement ce qui a été fait', () => {
  const src = [slot({ id: 'a', dow: 1 }), slot({ id: 'b', dow: 1, start: '18:00', label: 'Sport' })];
  assert.equal(pasteSummary(plan(src, src), dowLabel), '2 créneaux collés sur mardi');
  assert.equal(
    pasteSummary(plan(src, src, { targetDows: [2, 4, 5] }), dowLabel),
    '6 créneaux collés sur 3 jours',
  );
  assert.equal(pasteSummary(plan([], []), dowLabel), 'Rien à coller');
});
