// Les helpers de date sont des fonctions pures, testées avec `node:test` comme
// le backend. Aucun import Angular ici : c'est ce qui rend le fichier exécutable
// hors navigateur.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addHourHHMM, contactIni, dstr, isoWeek, keptIni, occursOn, weekDates } from './helpers';
import { EventItem } from './models';

const iso = (offset: number, anchor: string): string[] => weekDates(offset, anchor).map(dstr);

test('weekDates suit la date d’ancrage et non une semaine figée', () => {
  // Le bug corrigé : la fonction renvoyait toujours la semaine du 13/07/2026,
  // quelle que soit la date du jour.
  assert.notDeepEqual(iso(0, '2026-08-21'), iso(0, '2026-07-15'));
  assert.equal(iso(0, '2026-08-21')[0], '2026-08-17');
});

test('la semaine commence le lundi et compte sept jours', () => {
  for (const anchor of ['2026-08-17', '2026-08-19', '2026-08-21', '2026-08-23']) {
    const w = iso(0, anchor);
    assert.equal(w.length, 7);
    assert.equal(w[0], '2026-08-17', 'lundi de la semaine du ' + anchor);
    assert.equal(w[6], '2026-08-23', 'dimanche de la semaine du ' + anchor);
  }
});

test('un dimanche appartient à la semaine qui l’a commencé', () => {
  // Piège classique : getDay() vaut 0 le dimanche, un décalage naïf renvoie la
  // semaine suivante et le planning saute un jour.
  assert.equal(iso(0, '2026-08-23')[0], '2026-08-17');
});

test('le décalage de semaines avance et recule de sept jours', () => {
  assert.equal(iso(1, '2026-08-21')[0], '2026-08-24');
  assert.equal(iso(-1, '2026-08-21')[0], '2026-08-10');
  assert.equal(iso(3, '2026-08-21')[0], '2026-09-07');
});

test('le passage à l’heure d’été ne décale pas les jours', () => {
  // Le changement d'heure français tombe le dernier dimanche de mars : une
  // arithmétique en millisecondes produirait ici un 29/03 à 23h, donc le 28.
  assert.deepEqual(iso(0, '2026-03-30'), [
    '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05',
  ]);
  assert.deepEqual(iso(0, '2026-10-26'), [
    '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
  ]);
});

test('la semaine traverse correctement les fins de mois et d’année', () => {
  assert.equal(iso(0, '2027-01-01')[0], '2026-12-28');
  assert.equal(iso(0, '2028-02-29')[0], '2028-02-28');
});

// Les initiales choisies : le seul moyen d'écrire « JO » quand on s'appelle
// Jonathan, sans que le prochain changement de prénom ne les efface.
test('des initiales qui suivent le prénom continuent de le suivre', () => {
  assert.equal(keptIni({ name: 'Camille', ini: contactIni('Camille') }, 'Camille Dupont'), 'CD');
  assert.equal(keptIni({ name: 'Camille', ini: '' }, 'Léa'), 'LÉ');
  assert.equal(keptIni(null, 'Léa Martin'), 'LM');
});

test('des initiales choisies survivent au changement de prénom', () => {
  // « JO » découlerait de « Jonathan » : ce sont « JJ » et « 🐱 » qu'on a choisis.
  assert.equal(keptIni({ name: 'Jonathan', ini: 'JJ' }, 'Jonathan Prudhomme'), 'JJ');
  assert.equal(keptIni({ name: 'Jonathan', ini: '🐱' }, 'Jo'), '🐱');
});

// ---- récurrence d'un événement d'agenda ------------------------------------

const ev = (over: Partial<EventItem> = {}): EventItem =>
  ({ id: 'e1', date: '2026-09-10', time: '18:00', title: 'Réunion', who: ['me'], recur: 'none', ...over });

test('un événement « toutes les 2 semaines » revient un jeudi sur deux', () => {
  // Jeudi 10 sept. 2026, puis un jeudi sur deux, la phase portée par la date.
  const e = ev({ recur: 'biweekly' });
  assert.equal(occursOn(e, '2026-09-10'), true, 'le jour de départ');
  assert.equal(occursOn(e, '2026-09-17'), false, 'le jeudi suivant saute');
  assert.equal(occursOn(e, '2026-09-24'), true, 'deux semaines plus tard');
  assert.equal(occursOn(e, '2026-09-23'), false, 'un autre jour de la semaine, non');
  assert.equal(occursOn(e, '2026-09-03'), false, 'avant la date de départ, non');
});

test('« chaque semaine » et « toutes les 2 semaines » ne se confondent pas', () => {
  assert.equal(occursOn(ev({ recur: 'weekly' }), '2026-09-17'), true);
  assert.equal(occursOn(ev({ recur: 'biweekly' }), '2026-09-17'), false);
});

// ---- numéro de semaine ISO --------------------------------------------------

test('isoWeek suit la norme ISO 8601 (lundi, semaine du premier jeudi)', () => {
  assert.equal(isoWeek(new Date(2026, 7, 31)), 36, 'lundi 31 août 2026 = semaine 36');
  assert.equal(isoWeek(new Date(2026, 8, 7)), 37, 'lundi 7 sept. 2026 = semaine 37');
  // Le 1er janvier 2027 est un vendredi : il appartient encore à la semaine 53 de 2026.
  assert.equal(isoWeek(new Date(2027, 0, 1)), 53);
  // Le 4 janvier 2027 (lundi) ouvre la semaine 1 de 2027.
  assert.equal(isoWeek(new Date(2027, 0, 4)), 1);
});

// ---- heure + 1h (fin d'événement par défaut) --------------------------------

test('addHourHHMM ajoute une heure, borne à 23:59, ignore une entrée mal formée', () => {
  assert.equal(addHourHHMM('09:00'), '10:00');
  assert.equal(addHourHHMM('08:30'), '09:30');
  assert.equal(addHourHHMM('23:30'), '23:59', 'plus d’une heure déborderait le jour : on borne');
  assert.equal(addHourHHMM('23:00'), '23:59');
  assert.equal(addHourHHMM(''), '');
  assert.equal(addHourHHMM('8h'), '');
});
