// La semaine type de l'emploi du temps.
//
// Une règle est vérifiée par presque tous ces tests, parce que c'est elle qui
// décide si le module sert à quelque chose : **aucune sélection veut dire tout
// le foyer, jamais rien.** L'écran précédent s'ouvrait filtré sur un membre qui
// n'existait dans aucun foyer réel, et n'affichait donc rien tant qu'on n'avait
// pas cliqué. Un filtre vide qui viderait l'écran est un bug, pas un réglage.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_START, WHO_SHOWN, calendarFacts, dowLabel, filterSlots, gapsOf, knownLabels, matchesWho, nextFreeStart, occursOn, slotsOn, sortSlots, validityLabel, whoBadges } from './schedule';
import { Member, SchedSlot } from './models';

const slot = (over: Partial<SchedSlot> = {}): SchedSlot =>
  ({ id: 's1', who: ['m1'], dow: 4, start: '08:30', end: '16:30', label: 'École', k: 'ecole', rec: 'weekly', ...over });

const membre = (id: string, name: string, color: string): Member =>
  ({ id, name, role: 'Membre', color, ini: name.slice(0, 2).toUpperCase() });

const FOYER = [
  membre('me', 'Thomas', '#E56B4E'),
  membre('m1', 'Léa', '#7A9B76'),
  membre('m2', 'Paul', '#4E93B8'),
  membre('m3', 'Claire', '#9B6FA8'),
];

// ---- jours ------------------------------------------------------------------

test('les jours se nomment de lundi à dimanche, et rien d’autre ne passe', () => {
  assert.equal(dowLabel(1), 'Lundi');
  assert.equal(dowLabel(3), 'Mercredi');
  assert.equal(dowLabel(7), 'Dimanche');
  // Un numéro hors bornes ne doit pas rendre « undefined » dans l'interface.
  assert.equal(dowLabel(0), 'Lundi');
  assert.equal(dowLabel(9), 'Lundi');
});

test('une date se traduit en jour de la semaine type', () => {
  // Le 2026-09-03 est un jeudi, le 2026-09-06 un dimanche.
  const sched = [slot({ id: 'jeu', dow: 4 }), slot({ id: 'dim', dow: 7 })];
  assert.deepEqual(slotsOn(sched, '2026-09-03').map((s) => s.id), ['jeu']);
  assert.deepEqual(slotsOn(sched, '2026-09-06').map((s) => s.id), ['dim']);
});

test('le mercredi n’est un jour particulier pour personne dans le code', () => {
  // Il est le plus atypique du foyer (pas d'école pour l'un, pas de travail pour
  // l'autre, activités l'après-midi), et c'est justement pour cela qu'il ne doit
  // être nulle part un cas à part : il se lit exactement comme les six autres.
  const sched = [1, 2, 3, 4, 5, 6, 7].map((dow) => slot({ id: 'j' + dow, dow }));
  // La semaine du lundi 7 septembre 2026.
  for (const dow of [1, 2, 3, 4, 5, 6, 7]) {
    assert.deepEqual(slotsOn(sched, '2026-09-0' + (6 + dow)).map((s) => s.id), ['j' + dow]);
  }
});

// ---- ordre ------------------------------------------------------------------

test('les créneaux sortent dans l’ordre des heures', () => {
  const sched = [
    slot({ id: 'soir', start: '17:00', end: '18:00' }),
    slot({ id: 'matin', start: '07:50', end: '08:20' }),
    slot({ id: 'midi', start: '12:00', end: '13:30' }),
  ];
  assert.deepEqual(slotsOn(sched, '2026-09-03').map((s) => s.id), ['matin', 'midi', 'soir']);
});

test('deux créneaux à la même heure gardent un ordre stable', () => {
  // Chez nous deux enfants partent à 7h50 : sans critère de repli, ils
  // changeraient de place d'un rendu à l'autre.
  const a = slot({ id: 'a', start: '07:50', end: '08:20', label: 'Car de Paul' });
  const b = slot({ id: 'b', start: '07:50', end: '08:10', label: 'École de Léa' });
  assert.deepEqual(sortSlots([a, b]).map((s) => s.id), ['b', 'a'], 'à heure égale, la fin la plus tôt passe devant');
  assert.deepEqual(sortSlots([b, a]).map((s) => s.id), ['b', 'a'], 'l’ordre ne dépend pas de celui du document');
});

test('un créneau sans heure de fin ne perturbe pas l’ordre', () => {
  const sched = [slot({ id: 'fin', start: '09:00', end: '10:00' }), slot({ id: 'sans', start: '09:00', end: '' })];
  assert.deepEqual(sortSlots(sched).map((s) => s.id), ['sans', 'fin']);
});

// ---- le filtre est un affinage ---------------------------------------------

test('un filtre vide laisse passer tout le foyer', () => {
  const sched = [slot({ id: 'a', who: ['m1'] }), slot({ id: 'b', who: ['m2'] }), slot({ id: 'c', who: ['me', 'm3'] })];
  assert.deepEqual(filterSlots(sched, []).map((s) => s.id), ['a', 'b', 'c']);
});

test('un filtre vide laisse aussi passer les créneaux sans membre', () => {
  // Sinon ils seraient invisibles et donc irréparables : on ne peut pas
  // sélectionner un membre qui n'existe plus.
  const sched = [slot({ id: 'orphelin', who: [] })];
  assert.deepEqual(filterSlots(sched, []).map((s) => s.id), ['orphelin']);
  assert.deepEqual(filterSlots(sched, ['m1']), [], 'mais un filtre actif ne les réclame pas');
});

test('un filtre retient les créneaux d’au moins un des membres choisis', () => {
  const sched = [slot({ id: 'lea', who: ['m1'] }), slot({ id: 'paul', who: ['m2'] }), slot({ id: 'claire', who: ['m3'] })];
  assert.deepEqual(filterSlots(sched, ['m1', 'm2']).map((s) => s.id), ['lea', 'paul']);
});

test('un créneau partagé n’apparaît qu’une fois, quel que soit le filtre', () => {
  // La messe du dimanche concerne tout le monde : c'est une ligne, pas quatre.
  const messe = slot({ id: 'messe', who: ['me', 'm1', 'm2', 'm3'], dow: 7, start: '10:30', label: 'Messe', k: 'loisir' });
  assert.equal(filterSlots([messe], []).length, 1);
  assert.equal(filterSlots([messe], ['m1']).length, 1);
  assert.equal(filterSlots([messe], ['me', 'm1', 'm2', 'm3']).length, 1);
});

test('désélectionner tout le monde revient à la vue complète, pas à un écran vide', () => {
  // C'est la recette de l'utilisateur, écrite en test : je sélectionne un
  // enfant, puis je désélectionne, et je dois retrouver toute la famille.
  const sched = [slot({ id: 'a', who: ['m1'] }), slot({ id: 'b', who: ['m2'] })];
  const affine = filterSlots(sched, ['m1']);
  assert.equal(affine.length, 1);
  assert.equal(filterSlots(sched, []).length, sched.length);
});

test('matchesWho ne se laisse pas piéger par un créneau sans liste de membres', () => {
  const bancal = { ...slot(), who: undefined } as unknown as SchedSlot;
  assert.equal(matchesWho(bancal, []), true);
  assert.equal(matchesWho(bancal, ['m1']), false);
});

// ---- marqueurs d'identité ---------------------------------------------------

test('les marqueurs portent la couleur et les initiales du membre', () => {
  const b = whoBadges(slot({ who: ['m1'] }), FOYER);
  assert.equal(b.length, 1);
  assert.equal(b[0].color, '#7A9B76');
  assert.equal(b[0].ini, 'LÉ');
  assert.equal(b[0].name, 'Léa');
});

test('les marqueurs suivent l’ordre du foyer, pas celui du créneau', () => {
  // Une même personne doit se retrouver à la même place d'une ligne à l'autre.
  const a = whoBadges(slot({ who: ['m3', 'me'] }), FOYER).map((x) => x.id);
  const b = whoBadges(slot({ who: ['me', 'm3'] }), FOYER).map((x) => x.id);
  assert.deepEqual(a, ['me', 'm3']);
  assert.deepEqual(a, b);
});

test('un membre supprimé laisse une pastille grise plutôt que rien', () => {
  const b = whoBadges(slot({ who: ['m1', 'disparu'] }), FOYER);
  assert.deepEqual(b.map((x) => x.id), ['m1', 'disparu']);
  assert.equal(b[1].ini, '?');
  assert.equal(b[1].color, '#8A7E74');
});

test('un créneau sans membre ne rend aucun marqueur', () => {
  assert.deepEqual(whoBadges(slot({ who: [] }), FOYER), []);
});

test('le débordement se compte au-delà de trois membres', () => {
  const b = whoBadges(slot({ who: ['me', 'm1', 'm2', 'm3'] }), FOYER);
  assert.equal(b.length, 4);
  assert.equal(b.length - WHO_SHOWN, 1, 'quatre membres : trois pastilles et un « +1 »');
});

// ---- récurrence, périodes et exceptions -------------------------------------
//
// La recette de l'utilisateur : « je regarde la semaine des vacances scolaires,
// les créneaux d'activité et d'école n'y sont pas ». Et son corollaire, moins
// visible mais plus grave : ils y sont quand même si l'on ne sait pas que ce
// sont les vacances.

/** Vacances de la Toussaint 2026, et le 11 novembre qui tombe dedans côté férié. */
const CAL = calendarFacts([{ start: '2026-10-17', end: '2026-11-02' }]);
/** Source indisponible : la liste est vide, donc rien n'est connu. */
const CAL_INCONNU = calendarFacts([]);

test('un créneau hebdomadaire a lieu chaque semaine, sans période', () => {
  const s = slot({ dow: 4 });
  assert.equal(occursOn(s, '2026-09-03', CAL), true);
  assert.equal(occursOn(s, '2026-09-10', CAL), true);
  assert.equal(occursOn(s, '2026-09-04', CAL), false, 'pas le vendredi');
});

test('un créneau ponctuel n’a lieu qu’à sa date', () => {
  const s = slot({ rec: 'once', date: '2026-09-03', label: 'Médecin', k: 'sante' });
  assert.equal(occursOn(s, '2026-09-03', CAL), true);
  assert.equal(occursOn(s, '2026-09-10', CAL), false, 'un ponctuel ne revient pas la semaine suivante');
});

test('la période de validité borne la série des deux côtés', () => {
  // L'activité démarre à la rentrée et s'arrête en juin : sans période, celle de
  // l'an dernier pollue l'année en cours.
  const s = slot({ dow: 4, from: '2026-09-10', until: '2027-06-30' });
  assert.equal(occursOn(s, '2026-09-03', CAL), false, 'avant le début');
  assert.equal(occursOn(s, '2026-09-10', CAL), true, 'le premier jour est inclus');
  assert.equal(occursOn(s, '2027-06-24', CAL), true);
  assert.equal(occursOn(s, '2027-07-01', CAL), false, 'après la fin');
});

test('une borne de fin au jour même laisse l’occurrence de ce jour', () => {
  const s = slot({ dow: 4, until: '2026-09-03' });
  assert.equal(occursOn(s, '2026-09-03', CAL), true, 'la borne est incluse');
  assert.equal(occursOn(s, '2026-09-10', CAL), false);
});

test('une exception retire une occurrence sans toucher aux autres', () => {
  // « Ce jeudi, pas de tennis. »
  const s = slot({ dow: 4, skip: ['2026-09-10'] });
  assert.equal(occursOn(s, '2026-09-03', CAL), true);
  assert.equal(occursOn(s, '2026-09-10', CAL), false);
  assert.equal(occursOn(s, '2026-09-17', CAL), true, 'la série continue après l’exception');
});

test('un créneau de période scolaire disparaît pendant les vacances', () => {
  const s = slot({ dow: 4, when: 'school' });
  assert.equal(occursOn(s, '2026-09-03', CAL), true);
  assert.equal(occursOn(s, '2026-10-22', CAL), false, 'vacances de la Toussaint');
  assert.equal(occursOn(s, '2026-11-05', CAL), true, 'la rentrée le ramène');
});

test('un créneau de vacances ne paraît que pendant les vacances', () => {
  const s = slot({ dow: 4, when: 'holidays', label: 'Chez les grands-parents' });
  assert.equal(occursOn(s, '2026-09-03', CAL), false);
  assert.equal(occursOn(s, '2026-10-22', CAL), true);
});

test('un jour férié n’est pas un jour d’école', () => {
  // Le 11 novembre 2026 est un mercredi férié, hors vacances de la Toussaint.
  const ecole = slot({ dow: 3, when: 'school' });
  const vacances = slot({ dow: 3, when: 'holidays' });
  assert.equal(occursOn(ecole, '2026-11-11', CAL), false);
  assert.equal(occursOn(vacances, '2026-11-11', CAL), true);
  // Qui travaille certains fériés laisse son créneau sur « toujours ».
  assert.equal(occursOn(slot({ dow: 3 }), '2026-11-11', CAL), true);
});

test('quand les vacances ne sont pas connues, on affiche plutôt que de cacher', () => {
  // Décision assumée : cacher l'école à 7h50 parce qu'une API est tombée est
  // une faute bien pire que d'afficher un créneau en trop.
  const ecole = slot({ dow: 4, when: 'school' });
  assert.equal(occursOn(ecole, '2026-10-22', CAL_INCONNU), true);
  // Et l'inverse aussi : un créneau de vacances n'est pas caché non plus.
  assert.equal(occursOn(slot({ dow: 4, when: 'holidays' }), '2026-09-03', CAL_INCONNU), true);
});

test('sans aucune connaissance du calendrier, le tri par date reste juste', () => {
  // Le repli ne doit pas rendre `slotsOn` inutilisable là où personne ne fournit
  // de calendrier (la tuile d'accueil avant chargement, par exemple).
  const sched = [slot({ id: 'a', dow: 4, when: 'school' }), slot({ id: 'b', dow: 5 })];
  assert.deepEqual(slotsOn(sched, '2026-09-03').map((s) => s.id), ['a']);
});

test('une occurrence détachée remplace celle de sa série', () => {
  // « Cette fois seulement » : la série saute la date, et un ponctuel la reprend
  // avec les nouvelles valeurs.
  const serie = slot({ id: 'serie', dow: 4, start: '17:00', skip: ['2026-09-10'] });
  const detachee = slot({ id: 'exception', dow: 4, rec: 'once', date: '2026-09-10', start: '18:30', srcId: 'serie' });
  const jour = slotsOn([serie, detachee], '2026-09-10', CAL);
  assert.deepEqual(jour.map((s) => s.id), ['exception'], 'une seule des deux, jamais les deux');
  assert.deepEqual(slotsOn([serie, detachee], '2026-09-17', CAL).map((s) => s.id), ['serie']);
});

test('la période se lit en français, ou ne se lit pas du tout', () => {
  const fmt = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  assert.equal(validityLabel(slot(), fmt), '', 'un créneau sans période n’affiche rien');
  assert.equal(validityLabel(slot({ from: '2026-09-01' }), fmt), 'à partir du 01/09');
  assert.equal(validityLabel(slot({ until: '2027-06-30' }), fmt), 'jusqu’au 30/06');
  assert.equal(validityLabel(slot({ from: '2026-09-01', until: '2027-06-30' }), fmt), 'du 01/09 au 30/06');
  assert.equal(validityLabel(slot({ rec: 'once', date: '2026-09-10' }), fmt), '10/09');
});

// ---- trous de la journée et confort de saisie -------------------------------

test('les trous d’une journée se calculent entre les créneaux', () => {
  const jour = [
    slot({ id: 'a', start: '08:30', end: '12:00' }),
    slot({ id: 'b', start: '14:00', end: '16:30' }),
  ];
  assert.deepEqual(gapsOf(jour), [{ start: '12:00', end: '14:00', minutes: 120 }]);
});

test('un créneau sans heure de fin compte comme un instant', () => {
  // Le car de 7h50 n'occupe pas la matinée sous prétexte qu'on n'a pas dit
  // quand il arrive.
  const jour = [slot({ id: 'car', start: '07:50', end: '' }), slot({ id: 'ecole', start: '08:30', end: '16:30' })];
  assert.deepEqual(gapsOf(jour), [{ start: '07:50', end: '08:30', minutes: 40 }]);
});

test('deux créneaux qui se chevauchent ne créent pas de trou', () => {
  const jour = [
    slot({ id: 'a', start: '08:00', end: '17:45' }),
    slot({ id: 'b', start: '09:00', end: '12:00' }),
    slot({ id: 'c', start: '18:30', end: '19:30' }),
  ];
  // Le trou part de 17:45 (la fin la plus tardive) et non de 12:00 (la fin du
  // créneau qui précède dans la liste).
  assert.deepEqual(gapsOf(jour).map((g) => g.start + '-' + g.end), ['17:45-18:30']);
});

test('les trous trop courts sont ignorés', () => {
  // Cinq minutes entre deux cours ne sont pas du temps libre, et les afficher
  // noierait les vrais trous.
  const jour = [slot({ id: 'a', start: '08:00', end: '09:00' }), slot({ id: 'b', start: '09:05', end: '10:00' })];
  assert.deepEqual(gapsOf(jour), []);
  assert.equal(gapsOf(jour, 5).length, 1, 'le seuil est réglable');
});

test('une journée vide ou d’un seul créneau n’a pas de trou', () => {
  assert.deepEqual(gapsOf([]), []);
  assert.deepEqual(gapsOf([slot()]), []);
});

test('l’heure proposée suit le dernier créneau de la journée', () => {
  assert.equal(nextFreeStart([]), DEFAULT_START, 'une journée vide démarre à l’heure par défaut');
  assert.equal(nextFreeStart([slot({ start: '08:30', end: '16:30' })]), '16:30');
  // C'est la fin la plus tardive qui compte, pas celle du dernier commencé.
  assert.equal(nextFreeStart([slot({ start: '08:00', end: '20:30' }), slot({ start: '09:00', end: '12:00' })]), '20:30');
  assert.equal(nextFreeStart([slot({ start: '07:50', end: '' })]), '07:50');
});

test('les intitulés déjà employés sortent, les plus fréquents d’abord', () => {
  const sched = [
    slot({ id: '1', label: 'Car scolaire' }),
    slot({ id: '2', label: 'École' }),
    slot({ id: '3', label: 'École' }),
    slot({ id: '4', label: '  ' }),
  ];
  assert.deepEqual(knownLabels(sched), ['École', 'Car scolaire'], 'un intitulé vide n’est pas une suggestion');
});
