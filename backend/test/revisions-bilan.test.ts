// Le bilan d'une période du module Révisions, hors base : les jours de Paris,
// la période précédente de même longueur, la réussite par groupe, les items
// fragiles du programme en vigueur, la phrase du dimanche, et le PDF.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BilanInput, addDays, computeBilan, mondayOf, periodLabel, weekDue, weekLine } from '../src/revisions/bilan';
import { MasteryCfg } from '../src/revisions/mastery';
import { MasteryRow } from '../src/revisions/repo';
import { documentPdf, wrap } from '../src/export/pdf';
import { bilanPdf, sessionsCsv } from '../src/revisions/export';

const cfg: MasteryCfg = { espacementJours: [0, 1, 3, 7, 14, 30], descenteSiFaux: 2, niveauAcquis: 3, bonnesMin: 3 };
const params = (from: number, to: number) => JSON.stringify({ operation: 'mult', tables: [from, to] });
const session = (at: string, good: number, wrong: number, p = params(6, 9), mode = 'entrainer') =>
  ({ exercise_id: 'tables', mode: mode as 'entrainer', started_at: at, questions: good + wrong, good, slow: 0, wrong, params_json: p });
const answer = (at: string, key: string, result: 'bon' | 'faux', p = params(6, 9)) => ({ exercise_id: 'tables', item_key: key, result, asked_at: at, params_json: p });
const row = (key: string, extra: Partial<MasteryRow>): MasteryRow =>
  ({ member_id: 'm1', exercise_id: 'tables', item_key: key, level: 1, good_count: 1, wrong_count: 0, last_result: 'bon', last_at: '', next_at: '', ...extra });
const base = (over: Partial<BilanInput> = {}): BilanInput => ({
  member: { id: 'm1', name: 'Raphaël' }, from: '2026-10-12', to: '2026-10-18',
  matieres: [{ id: 'maths', label: 'Mathématiques' }, { id: 'francais', label: 'Français' }],
  sessions: [], answers: [], mastery: () => [], programs: [], cfgOf: () => cfg, ...over,
});

describe('les jours et la période', () => {
  it('lundi, jours décalés, et le libellé qui dit la semaine', () => {
    assert.equal(mondayOf('2026-10-18'), '2026-10-12');
    assert.equal(mondayOf('2026-10-12'), '2026-10-12');
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(periodLabel('2026-10-12', '2026-10-18'), 'Semaine du lundi 12 au dimanche 18 octobre 2026');
    assert.equal(periodLabel('2026-09-28', '2026-10-04'), 'Semaine du lundi 28 septembre au dimanche 4 octobre 2026');
    assert.equal(periodLabel('2026-10-01', '2026-10-31'), 'Du 1er au 31 octobre 2026');
    assert.equal(periodLabel('2026-11-01', '2026-11-01'), 'Le 1er novembre 2026');
    assert.equal(periodLabel('2026-10-14', '2026-10-14'), 'Le 14 octobre 2026');
  });

  it('le bilan du dimanche n’est dû que le dimanche, à partir de l’heure', () => {
    assert.equal(weekDue('2026-10-18T18:29', '18:30'), null);
    assert.deepEqual(weekDue('2026-10-18T18:30', '18:30'), { from: '2026-10-12', to: '2026-10-18' });
    assert.equal(weekDue('2026-10-19T19:00', '18:30'), null, 'le lundi');
  });
});

describe('le calcul', () => {
  it('compte la période au jour de Paris, sans le mode Apprendre, et la compare à la précédente', () => {
    const b = computeBilan(base({
      programs: [{ exercise_id: 'tables', params_json: params(6, 9) }],
      sessions: [
        session('2026-10-11T22:30:00.000Z', 9, 1), // lundi 12 à 0 h 30 à Paris : dans la semaine
        session('2026-10-14T16:00:00.000Z', 8, 2),
        session('2026-10-15T16:00:00.000Z', 10, 0, params(6, 9), 'apprendre'),
        session('2026-10-07T16:00:00.000Z', 5, 5), // semaine d'avant
        session('2026-10-18T22:30:00.000Z', 1, 0), // lundi 19 à Paris : hors période
      ],
      answers: [answer('2026-10-14T16:00:01.000Z', 'mult:6x7', 'bon'), answer('2026-10-14T16:00:02.000Z', 'mult:7x8', 'faux'), answer('2026-10-07T16:00:01.000Z', 'mult:6x7', 'faux')],
    }));
    const e = b.matieres[0].exercises[0];
    assert.equal(b.matieres.length, 1, 'une matière sans exercice n’apparaît pas');
    assert.deepEqual([e.totals.sessions, e.totals.questions, e.totals.pct], [2, 20, 85]);
    assert.deepEqual([e.prev!.sessions, e.prev!.pct], [1, 50]);
    assert.equal(e.summary, 'Les tables de 6 à 9, multiplication');
    assert.deepEqual(e.groups.map((g) => [g.group, g.questions, g.pct, g.prevPct]), [['Table de 6', 1, 100, 0], ['Table de 7', 2, 50, 0], ['Table de 8', 1, 0, null]]);
  });

  it('les fragiles sont ceux du programme en vigueur, jamais un acquis', () => {
    const b = computeBilan(base({
      programs: [{ exercise_id: 'tables', params_json: params(2, 5) }],
      mastery: () => [row('mult:2x3', { wrong_count: 2, level: 0, last_result: 'faux' }), row('mult:7x8', { wrong_count: 3, level: 0 }),
        row('mult:4x5', { level: 4, good_count: 5, wrong_count: 1, last_result: 'bon' })],
    }));
    assert.deepEqual(b.matieres[0].exercises[0].fragiles.map((f) => f.label), ['2 × 3']);
  });

  it('un enfant sans programme ni session n’a rien à dire', () => {
    assert.deepEqual(computeBilan(base()).matieres, []);
  });

  it('la phrase du dimanche reprend le résumé, la réussite et les fragiles ; sans session, elle le dit sans reproche', () => {
    const b = computeBilan(base({
      programs: [{ exercise_id: 'tables', params_json: params(6, 9) }],
      sessions: [session('2026-10-14T16:00:00.000Z', 9, 1)],
      mastery: () => [row('mult:7x8', { wrong_count: 2, level: 0, last_result: 'faux' }), row('mult:6x9', { wrong_count: 1, level: 1, last_result: 'faux' })],
    }));
    assert.equal(weekLine(b), 'Raphaël cette semaine : 1 session, les tables de 6 à 9, multiplication, 90 % de réussite, 7 × 8 et 6 × 9 encore fragiles.');
    assert.equal(weekLine(computeBilan(base({ programs: [{ exercise_id: 'tables', params_json: params(6, 9) }] }))), 'Raphaël cette semaine : pas de session de révisions.');
  });
});

describe('les exports', () => {
  it('le PDF du bilan est un PDF, en français, sans autre nom que celui de l’enfant', () => {
    const b = computeBilan(base({ programs: [{ exercise_id: 'tables', params_json: params(6, 9) }], sessions: [session('2026-10-14T16:00:00.000Z', 9, 1)],
      answers: [answer('2026-10-14T16:00:01.000Z', 'mult:6x7', 'bon')] }));
    const pdf = bilanPdf(b, '2026-10-19').toString('latin1');
    assert.match(pdf, /^%PDF-1\.4/);
    assert.match(pdf, /\(Révisions de Raphaël\)/);
    assert.match(pdf, /Semaine du lundi 12 au dimanche 18 octobre 2026/);
    assert.match(pdf, /Table de 6/);
    assert.match(pdf, /Établi par Foyer le 19\/10\/2026/);
  });

  it('un document long passe à la page suivante, et un paragraphe se coupe en lignes', () => {
    const pdf = documentPdf({ title: 'T', blocks: Array.from({ length: 120 }, (_, i) => ({ p: `Ligne ${i}` })) }).toString('latin1');
    assert.match(pdf, /\/Count 3 /);
    assert.ok(wrap('un mot '.repeat(60), 200, 10).length > 3);
  });

  it('le CSV des sessions : séparateur point-virgule, BOM, en-tête français', () => {
    const csv = sessionsCsv([{ id: 'x', member_id: 'm1', exercise_id: 'tables', program_id: null, mode: 'test', params_json: params(6, 9), started_at: '2026-10-14T16:00:00.000Z',
      ended_at: '2026-10-14T16:03:00.000Z', aborted: 0, questions: 10, good: 8, slow: 1, wrong: 1, avg_ms: 2450, allowed_ms: 8000, fast_ms: 4000, device: '', via: null, received_at: '' }]).toString('utf-8');
    assert.ok(csv.startsWith('﻿Date;Heure;Exercice;Mode;Réglages;'));
    assert.match(csv, /14\/10\/2026;18:00;Tables;Test;Les tables de 6 à 9, multiplication;10;8;1;1;2,5;non\r\n$/);
  });
});
