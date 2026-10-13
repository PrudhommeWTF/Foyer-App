// Module École, troisième tranche, sans base ni réseau : lecture des notes et
// de la vie scolaire, et le texte des notifications.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gradeNumber, parseGrades, parseLife } from '../src/ecole/client/data';
import { eveningMessage, gradesMessage, homeworkMessage, lifeMessage, relativeDay } from '../src/ecole/messages';
import { schoolYear } from '../src/ecole/sync';
import { datee } from './ecole-faux-serveur';

describe('École : lecture des notes et de la vie scolaire', () => {
  it('notes : valeur brute gardée, valeur numérique quand c’en est une', () => {
    const { grades } = parseGrades(datee('notes.json').data);
    assert.equal(grades.length, 3);
    assert.deepEqual([grades[0].valueRaw, grades[0].valueNum, grades[0].outOf], ['14,5', 14.5, '20']);
    assert.deepEqual([grades[1].valueRaw, grades[1].valueNum], ['Abs', null]);
    assert.equal(grades[2].notSignificant, true);
    assert.equal(gradeNumber('NN'), null);
    assert.equal(gradeNumber('8'), 8);
  });

  it('moyennes : telles que renvoyées, moyenne générale comprise, une moyenne vide reste vide', () => {
    const { averages } = parseGrades(datee('notes.json').data);
    assert.deepEqual(averages.map((a) => [a.subjectCode, a.average]), [['_GENERALE', '13,25'], ['MATHS', '14,50'], ['AGL1', '']]);
    assert.equal(averages[0].periodLabel, '1er Trimestre');
  });

  it('vie scolaire : absence, retard, une punition est une sanction ; justifié ou non', () => {
    const l = parseLife(datee('viescolaire.json').data);
    assert.deepEqual(l.map((e) => [e.kind, e.justified]), [['absence', true], ['retard', false], ['sanction', null]]);
  });

  it('année scolaire : bascule en août', () => {
    assert.equal(schoolYear('2026-10-14'), '2026-2027');
    assert.equal(schoolYear('2027-07-31'), '2026-2027');
    assert.equal(schoolYear('2027-08-01'), '2027-2028');
  });
});

describe('École : texte des notifications', () => {
  const today = '2026-10-14';
  it('jours relatifs', () => {
    assert.equal(relativeDay('2026-10-14', today), 'aujourd’hui');
    assert.equal(relativeDay('2026-10-13', today), 'hier');
    assert.equal(relativeDay('2026-10-15', today), 'demain');
    assert.equal(relativeDay('2026-10-16', today), 'vendredi');
    assert.equal(relativeDay('2026-11-02', today), 'le 02/11');
  });

  it('une note : « Nolan : 15/20 en histoire » ; plusieurs : regroupées', () => {
    const g = { subject: 'HISTOIRE', valueRaw: '15', valueNum: 15, outOf: '20', label: 'Contrôle', classAverage: '11,2' };
    assert.deepEqual(gradesMessage('Nolan', [g]), { title: 'Nolan : 15/20 en histoire', body: 'Contrôle · moyenne de la classe 11,2' });
    const abs = { ...g, subject: 'ANGLAIS', valueRaw: 'Abs', valueNum: null };
    const m = gradesMessage('Nolan', [g, abs, g]);
    assert.equal(m.title, 'Nolan : 3 nouvelles notes');
    assert.match(m.body, /Abs en anglais/);
  });

  it('vie scolaire : « Léo : retard enregistré aujourd’hui, non justifié »', () => {
    const r = { kind: 'retard' as const, date: today, label: '10 minutes', reason: '', justified: false };
    assert.equal(lifeMessage('Léo', [r], today).title, 'Léo : retard enregistré aujourd’hui, non justifié');
    assert.equal(lifeMessage('Léo', [{ ...r, kind: 'absence', justified: true, date: '2026-10-13' }], today).title, 'Léo : absence enregistrée hier, justifiée');
    assert.equal(lifeMessage('Léo', [r, r], today).title, 'Léo : 2 nouveaux événements de vie scolaire');
  });

  it('devoirs : nouveau devoir, élision ; rappel du soir avec les interrogations', () => {
    assert.equal(homeworkMessage('Nolan', [{ subject: 'ANGLAIS', due: '2026-10-15', isTest: false }], today).title, 'Nolan : nouveau devoir d’anglais pour demain');
    assert.equal(homeworkMessage('Nolan', [{ subject: 'MATHS', due: '2026-10-16', isTest: true }], today).title, 'Nolan : interrogation de maths pour vendredi');
    const e = eveningMessage('Nolan', [{ subject: 'MATHEMATIQUES', due: '', isTest: false }, { subject: 'ANGLAIS', due: '', isTest: true }]);
    assert.deepEqual(e, { title: 'Nolan : 2 devoirs pour demain, dont une interrogation', body: 'Mathematiques · Anglais (interrogation)' });
  });
});
