// La contextualisation de l'accueil.
//
// Ce qui est vérifié ici tient en une phrase : le contexte réordonne et replie,
// il ne masque jamais, et il ne bouge pas sans raison. Les tests d'ordre sont
// donc autant des tests de **stabilité** que de pertinence.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DayFacts, HomeRules, contextOf, dayKindsOf, momentAt, rankTiles } from './home-context';
import { SchedSlot } from './models';

const MOMENTS = [
  { id: 'tot', label: 'Tôt le matin', from: '05:00' },
  { id: 'matinee', label: 'Matinée', from: '09:00' },
  { id: 'finjournee', label: 'Fin d’après-midi', from: '17:00' },
  { id: 'tard', label: 'Tard le soir', from: '22:00' },
];

const JOURS = [
  { id: 'ferie', label: 'Jour férié', quand: 'ferie' as const },
  { id: 'vacances', label: 'Vacances scolaires', quand: 'vacances' as const },
  { id: 'weekend', label: 'Week-end', quand: 'semaine' as const, jours: [6, 7] },
  { id: 'ecole', label: 'Jour d’école', quand: 'emploiDuTemps' as const, type: 'ecole' },
];

const rules = (regles: HomeRules['regles'], seuilRepli = -20): HomeRules =>
  ({ moments: MOMENTS, typesDeJour: JOURS, regles, seuilRepli });

const creneau = (over: Partial<SchedSlot> = {}): SchedSlot =>
  ({ id: 's1', who: ['m1'], dow: 4, start: '08:30', end: '16:30', label: 'École', k: 'ecole', ...over });

/** Le 2026-09-03 est un jeudi ; le 2026-09-05, un samedi. */
const facts = (over: Partial<DayFacts> = {}): DayFacts =>
  ({ today: '2026-09-03', holiday: false, schoolHoliday: false, sched: [], ...over });

const ORDRE = ['agenda', 'planning', 'taches', 'repas', 'courses', 'finances'];
const ids = (r: ReturnType<typeof rankTiles>): string[] => r.map((x) => x.id);

// ---- moment de la journée ---------------------------------------------------

test('le moment actif est le dernier commencé', () => {
  assert.equal(momentAt(MOMENTS, '07:30')?.id, 'tot');
  assert.equal(momentAt(MOMENTS, '09:00')?.id, 'matinee', 'la borne appartient au moment qui commence');
  assert.equal(momentAt(MOMENTS, '18:00')?.id, 'finjournee');
  assert.equal(momentAt(MOMENTS, '23:59')?.id, 'tard');
});

test('avant le premier moment, c’est encore la veille au soir', () => {
  // À trois heures du matin on n'est pas dans un néant sans règle.
  assert.equal(momentAt(MOMENTS, '03:00')?.id, 'tard');
});

test('sans moment déclaré, il n’y en a pas : rien n’est inventé', () => {
  assert.equal(momentAt([], '08:00'), null);
});

// ---- type de jour -----------------------------------------------------------

test('le type de jour vient des données, pas d’une liste de dates', () => {
  assert.deepEqual(dayKindsOf(JOURS, facts({ holiday: true })).map((d) => d.id), ['ferie']);
  assert.deepEqual(dayKindsOf(JOURS, facts({ schoolHoliday: true })).map((d) => d.id), ['vacances']);
  assert.deepEqual(dayKindsOf(JOURS, facts({ today: '2026-09-05' })).map((d) => d.id), ['weekend']);
  assert.deepEqual(dayKindsOf(JOURS, facts({ sched: [creneau()] })).map((d) => d.id), ['ecole']);
});

test('un créneau d’un autre jour de la semaine type ne fait pas un jour d’école', () => {
  assert.deepEqual(dayKindsOf(JOURS, facts({ sched: [creneau({ dow: 1 })] })), []);
});

test('plusieurs types de jour peuvent valoir ensemble', () => {
  const d = dayKindsOf(JOURS, facts({ today: '2026-09-05', schoolHoliday: true }));
  assert.deepEqual(d.map((x) => x.id), ['vacances', 'weekend']);
});

test('le contexte s’écrit en toutes lettres, pour que l’écran s’explique seul', () => {
  const ctx = contextOf(rules([]), facts({ sched: [creneau()] }), '17:30');
  assert.equal(ctx.label, 'Fin d’après-midi · jour d’école');
});

// ---- classement -------------------------------------------------------------

test('sans règle applicable, l’ordre du registre est conservé tel quel', () => {
  const ctx = contextOf(rules([]), facts(), '15:00');
  assert.deepEqual(ids(rankTiles(rules([]), ORDRE, ctx)), ORDRE);
});

test('le matin, la journée et l’école passent devant', () => {
  const r = rules([
    { tuile: 'agenda', moments: ['tot'], poids: 30, raison: 'Le matin, la journée d’abord' },
    { tuile: 'planning', moments: ['tot'], jours: ['ecole'], poids: 25, raison: 'Ce qui part ce matin' },
  ]);
  const classe = rankTiles(r, ['taches', 'agenda', 'planning', 'repas'], contextOf(r, facts({ sched: [creneau()] }), '07:30'));
  assert.deepEqual(ids(classe), ['agenda', 'planning', 'taches', 'repas']);
  assert.equal(classe[0].raison, 'Le matin, la journée d’abord', 'une tuile remontée dit pourquoi');
});

test('en fin d’après-midi, le repas et les courses remontent', () => {
  const r = rules([
    { tuile: 'repas', moments: ['finjournee'], poids: 35, raison: 'On mange dans deux heures' },
    { tuile: 'courses', moments: ['finjournee'], poids: 30, raison: 'Avant de rentrer' },
  ]);
  assert.deepEqual(ids(rankTiles(r, ORDRE, contextOf(r, facts(), '18:00'))).slice(0, 2), ['repas', 'courses']);
});

test('une règle de jour ne s’applique pas les autres jours', () => {
  const r = rules([{ tuile: 'taches', jours: ['weekend'], poids: 25, raison: 'La maison' }]);
  assert.equal(ids(rankTiles(r, ORDRE, contextOf(r, facts({ today: '2026-09-05' }), '10:00')))[0], 'taches');
  assert.deepEqual(ids(rankTiles(r, ORDRE, contextOf(r, facts(), '10:00'))), ORDRE);
});

test('les poids s’additionnent quand plusieurs règles portent sur la même tuile', () => {
  const r = rules([
    { tuile: 'repas', moments: ['finjournee'], poids: 35, raison: 'On mange bientôt' },
    { tuile: 'repas', jours: ['vacances'], poids: 10, raison: 'Tout le monde est là' },
    { tuile: 'agenda', moments: ['finjournee'], poids: 40, raison: 'La journée' },
  ]);
  const classe = rankTiles(r, ORDRE, contextOf(r, facts({ schoolHoliday: true }), '18:00'));
  assert.equal(ids(classe)[0], 'repas', '35 + 10 passe devant 40');
  assert.equal(classe[0].raison, 'On mange bientôt', 'la raison affichée est celle de la règle la plus lourde');
});

// ---- ce que le contexte n'a pas le droit de faire ---------------------------

test('une tuile reléguée reste sur la page, elle est seulement repliée', () => {
  const r = rules([{ tuile: 'economies', moments: ['tot'], poids: -25 }]);
  const classe = rankTiles(r, [...ORDRE, 'economies'], contextOf(r, facts(), '07:00'));
  assert.equal(classe.length, ORDRE.length + 1, 'rien ne disparaît de la page');
  assert.equal(classe[classe.length - 1].id, 'economies', 'elle passe en dernier');
  assert.equal(classe[classe.length - 1].folded, true, 'et se referme sur son titre');
});

test('le seuil de repli est celui du fichier de règles', () => {
  const juste = rules([{ tuile: 'economies', poids: -20 }], -20);
  const audela = rules([{ tuile: 'economies', poids: -19 }], -20);
  assert.equal(rankTiles(juste, ['economies'], contextOf(juste, facts(), '10:00'))[0].folded, true);
  assert.equal(rankTiles(audela, ['economies'], contextOf(audela, facts(), '10:00'))[0].folded, false);
});

test('une tuile en panne n’est ni repliée ni reléguée : ce qui est cassé doit se voir', () => {
  const r = rules([{ tuile: 'finances', moments: ['tard'], poids: -50 }]);
  const ctx = contextOf(r, facts(), '23:00');
  const sans = rankTiles(r, ORDRE, ctx);
  const avec = rankTiles(r, ORDRE, ctx, ['finances']);
  assert.equal(sans[sans.length - 1].id, 'finances');
  assert.equal(sans[sans.length - 1].folded, true);
  assert.equal(avec.find((x) => x.id === 'finances')?.folded, false);
  // Épinglée, elle ne subit plus la règle : elle reprend simplement sa place du
  // registre, comme si aucun contexte ne s'appliquait.
  assert.deepEqual(avec.map((x) => x.id), ORDRE);
});

test('une tuile non remontée n’affiche aucune raison', () => {
  const r = rules([{ tuile: 'agenda', moments: ['tot'], poids: 30, raison: 'Le matin' }]);
  const classe = rankTiles(r, ORDRE, contextOf(r, facts(), '15:00'));
  assert.ok(classe.every((x) => x.raison === ''), 'pas de justification quand rien n’a bougé');
});

test('le classement est stable : deux appels identiques rendent le même ordre', () => {
  const r = rules([
    { tuile: 'repas', moments: ['finjournee'], poids: 30 },
    { tuile: 'courses', moments: ['finjournee'], poids: 30 },
  ]);
  const ctx = contextOf(r, facts(), '18:00');
  assert.deepEqual(ids(rankTiles(r, ORDRE, ctx)), ids(rankTiles(r, ORDRE, ctx)));
  // À score égal, c'est l'ordre du registre qui départage, jamais le hasard.
  assert.deepEqual(ids(rankTiles(r, ORDRE, ctx)).slice(0, 2), ['repas', 'courses']);
});
