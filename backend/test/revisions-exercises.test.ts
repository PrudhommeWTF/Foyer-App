// Le registre des exercices du module Révisions : chaque définition tient le
// contrat (des paramètres que le formulaire engendré sait afficher, une matière
// déclarée, une icône qui existe), l'exercice Tables sur des cas fixés, et le
// socle qui ne mélange jamais deux exercices.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { ExerciseContext, NO_CONTEXT, PARAM_TYPES, ParamDecl, defaults, readParams } from '../src/revisions/exercises/contract';
import { shippedLists } from '../src/revisions/content';
import { EXERCISES, exerciseById } from '../src/revisions/exercises';
import { TABLES, TablesQuestion } from '../src/revisions/exercises/tables';
import { DICTEE } from '../src/revisions/exercises/dictee';
import { MasteryCfg, Result } from '../src/revisions/mastery';
import { migrateRevisions } from '../src/revisions/schema';
import {
  AnswerIn, activeProgram, activePrograms, initRevisionsRepo, masteryOf, masteryRows, recomputeMember, recordSession, setProgram,
} from '../src/revisions/repo';

const ROOT = path.join(__dirname, '..', '..');
const shippedMatieres = (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'revisions', 'matieres.json'), 'utf8')) as { matieres: { id: string }[] }).matieres;
const icons = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'app', 'core', 'constants.ts'), 'utf8');

/** Un générateur pseudo-aléatoire fixé : les mêmes tirages à chaque passage. */
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };

describe('le registre', () => {
  it('des identifiants uniques, une matière déclarée, une icône qui existe', () => {
    assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length);
    for (const e of EXERCISES) {
      assert.match(e.id, /^[a-z][a-z0-9-]*$/, e.id);
      assert.ok(shippedMatieres.some((m) => m.id === e.matiere), `${e.id} : matière « ${e.matiere} » absente de config/revisions/matieres.json`);
      assert.match(icons, new RegExp(`\\n\\s*'?${e.icon}'?:`), `${e.id} : icône « ${e.icon} » absente de core/constants.ts`);
      assert.equal(exerciseById(e.id), e);
    }
    assert.equal(exerciseById('inconnu'), undefined);
  });

  it('chaque paramètre est d’un type que le formulaire engendré sait afficher, et bien déclaré', () => {
    for (const e of EXERCISES) {
      const keys = new Set<string>();
      for (const d of e.params as ParamDecl[]) {
        const where = `${e.id}.${d.key}`;
        assert.ok((PARAM_TYPES as readonly string[]).includes(d.type), `${where} : type « ${d.type} » inconnu du formulaire (${PARAM_TYPES.join(', ')})`);
        assert.ok(d.label.trim(), `${where} : un libellé pour le formulaire`);
        assert.ok(!keys.has(d.key), `${where} : clé en double`);
        if (d.type === 'enum') assert.ok(d.options.length >= 2 && d.options.some((o) => o.value === d.default), `${where} : au moins deux choix, dont le défaut`);
        if (d.type === 'int') assert.ok(d.min <= d.default && d.default <= d.max, `${where} : défaut dans les bornes`);
        if (d.type === 'content') assert.ok(d.item.trim() && d.items.trim(), `${where} : le nom d’un élément, pour le formulaire`);
        if (d.type === 'range') {
          assert.ok(d.min <= d.default[0] && d.default[0] <= d.default[1] && d.default[1] <= d.max, `${where} : défaut dans les bornes`);
          if (d.maxFrom !== undefined) {
            const top = e.params.find((x) => x.key === d.maxFrom);
            assert.ok(top?.type === 'int' && keys.has(d.maxFrom), `${where} : « maxFrom » désigne un entier déclaré avant`);
          }
        }
        keys.add(d.key);
      }
      // Avec le contenu livré : un exercice à listes doit en livrer au moins une qui pose une question.
      const ctx = { lists: shippedLists(os.tmpdir(), e.id) };
      assert.deepEqual(readParams(e, {}, ctx), defaults(e, ctx), `${e.id} : les défauts se relisent tels quels`);
      assert.ok(e.universe(defaults(e, ctx), ctx).length > 0, `${e.id} : les défauts posent au moins une question`);
    }
  });

  it('readParams nomme le paramètre refusé, en français', () => {
    assert.throws(() => readParams(TABLES, { operation: 'division' }), /« Opération »/);
    assert.throws(() => readParams(TABLES, { max: 13 }), /« Dernière table proposée » : un nombre entier de 10 à 12/);
    assert.throws(() => readParams(TABLES, { tables: [6, 11] }), /« Tables travaillées » : de 0 à 10/);
    assert.deepEqual(readParams(TABLES, { max: 12, tables: [6, 11] }).tables, [6, 11], 'la borne haute suit la dernière table');
    assert.throws(() => readParams(TABLES, { tables: [7, 6] }), /première borne avant la seconde/);
    assert.throws(() => readParams(TABLES, { bothDirections: 'oui' }), /oui ou non/);
    assert.equal(readParams(TABLES, { inconnu: 1 }).inconnu, undefined, 'une clé non déclarée est ignorée');
  });
});

describe('l’exercice Tables', () => {
  const p = readParams(TABLES, { tables: [2, 5] });

  it('l’univers : chaque table de la plage par 0 à 10, sans doublon commutatif', () => {
    const u = TABLES.universe(p, NO_CONTEXT);
    assert.equal(u.length, 4 * 11 - 6, 'les six couples entre deux tables de la plage ne comptent qu’une fois');
    assert.ok(u.includes('mult:3x4') && !u.includes('mult:4x3'));
    assert.ok(u.includes('mult:0x2') && u.includes('mult:5x10'));
    assert.equal(TABLES.universe(readParams(TABLES, { operation: 'add', tables: [7, 7] }), NO_CONTEXT).length, 11);
  });

  it('une question par item, dans un sens ou l’autre, toujours le même item', () => {
    const rand = seeded(42);
    const sens = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const q = TABLES.question('mult:3x8', p, rand);
      assert.equal(TABLES.itemKey(q), 'mult:3x8');
      sens.add(TABLES.text(q));
    }
    assert.deepEqual([...sens].sort(), ['3 × 8', '8 × 3']);
    const unSens = readParams(TABLES, { tables: [8, 8], bothDirections: false });
    for (let i = 0; i < 10; i++) assert.equal(TABLES.text(TABLES.question('mult:3x8', unSens, rand)), '8 × 3', 'la table travaillée en premier');
  });

  it('la correction : le nombre attendu, sans zéro en tête ni espace', () => {
    const q: TablesQuestion = { op: 'mult', a: 6, b: 7 };
    assert.deepEqual(TABLES.check(q, '42'), { ok: true, expected: '42' });
    assert.equal(TABLES.check(q, ' 042 ').ok, true);
    assert.equal(TABLES.check(q, '41').ok, false);
    assert.equal(TABLES.check(q, '4 2').ok, false);
    assert.equal(TABLES.check(q, '').ok, false);
    assert.deepEqual(TABLES.check({ op: 'mult', a: 0, b: 9 }, '0'), { ok: true, expected: '0' });
    assert.deepEqual(TABLES.check({ op: 'add', a: 6, b: 7 }, '13'), { ok: true, expected: '13' });
  });

  it('relit une question reçue, et refuse ce qui n’en est pas une', () => {
    assert.deepEqual(TABLES.parse({ op: 'mult', a: 7, b: 6 }, p), { op: 'mult', a: 7, b: 6 });
    for (const bad of [null, {}, { op: 'div', a: 1, b: 2 }, { op: 'mult', a: 6, b: 77 }, { op: 'mult', a: -1, b: 2 }, { op: 'mult', a: 1.5, b: 2 }, { op: 'mult', a: '6', b: 7 }]) {
      assert.equal(TABLES.parse(bad, p), null, JSON.stringify(bad));
    }
  });

  it('le libellé, les groupes du suivi, la grille, le mode Apprendre et le résumé', () => {
    assert.equal(TABLES.itemLabel('mult:6x7'), '6 × 7');
    assert.deepEqual(TABLES.groups('mult:3x4', p, NO_CONTEXT), ['Table de 3', 'Table de 4']);
    assert.deepEqual(TABLES.groups('mult:3x9', p, NO_CONTEXT), ['Table de 3']);
    assert.deepEqual(TABLES.groups('mult:3x3', p, NO_CONTEXT), ['Table de 3']);
    const g = TABLES.grid!(p);
    assert.equal(g.rows.length, 11);
    assert.equal(g.corner, '×');
    assert.equal(g.keyAt(7, 6), 'mult:6x7');
    const learn = TABLES.learn!(readParams(TABLES, { tables: [7, 9] }), NO_CONTEXT);
    assert.deepEqual(learn.map(TABLES.text), Array.from({ length: 10 }, (_, i) => `7 × ${i + 1}`));
    assert.equal(TABLES.spoken!({ op: 'mult', a: 7, b: 3 }), '7 fois 3, 21');
    assert.equal(TABLES.summary(readParams(TABLES, { tables: [6, 9] }), NO_CONTEXT), 'Les tables de 6 à 9, multiplication');
    assert.equal(TABLES.summary(readParams(TABLES, { operation: 'add', tables: [4, 4] }), NO_CONTEXT), 'La table de 4, addition');
  });

  it('les questions à trous : un item à part, posé seulement si le programme les demande, jamais avec un 0 en multiplication', () => {
    const sans = TABLES.universe(readParams(TABLES, { tables: [6, 6] }), NO_CONTEXT);
    assert.ok(!sans.some((k) => k.endsWith(':trou')), 'par défaut, pas de trou');
    const avec = TABLES.universe(readParams(TABLES, { tables: [6, 6], trous: true }), NO_CONTEXT);
    assert.equal(avec.length, sans.length * 2 - 1, 'chaque couple a son trou, sauf 0 × 6');
    assert.ok(avec.includes('mult:6x7:trou') && !avec.includes('mult:0x6:trou'));
    assert.ok(TABLES.universe(readParams(TABLES, { operation: 'add', tables: [6, 6], trous: true }), NO_CONTEXT).includes('add:0x6:trou'), 'en addition, 0 + ? = 6 a une seule réponse');
    assert.equal(TABLES.prerequisite!('mult:6x7:trou'), 'mult:6x7');
    assert.equal(TABLES.prerequisite!('mult:6x7'), null);
    assert.equal(TABLES.itemLabel('mult:6x7:trou'), '6 × 7, à trous');
    assert.deepEqual(TABLES.groups('mult:6x7:trou', readParams(TABLES, { tables: [6, 6], trous: true }), NO_CONTEXT), ['Table de 6, à trous']);
    assert.equal(TABLES.summary(readParams(TABLES, { tables: [6, 6], trous: true }), NO_CONTEXT), 'La table de 6, multiplication, avec trous');
  });

  it('une question à trous : l’énoncé, la case au bon endroit, la réponse est le facteur manquant', () => {
    const a: TablesQuestion = { op: 'mult', a: 6, b: 7, hole: 'a' }, b: TablesQuestion = { op: 'mult', a: 6, b: 7, hole: 'b' };
    assert.equal(TABLES.text(a), '? × 7 = 42');
    assert.equal(TABLES.text(b), '6 × ? = 42');
    assert.deepEqual(TABLES.ask!(a), { before: '', after: '× 7 = 42' });
    assert.deepEqual(TABLES.ask!(b), { before: '6 ×', after: '= 42' });
    assert.deepEqual(TABLES.ask!({ op: 'mult', a: 6, b: 7 }), { before: '6 × 7 =', after: '' });
    assert.deepEqual(TABLES.check(a, '6'), { ok: true, expected: '6' });
    assert.deepEqual(TABLES.check(b, '7'), { ok: true, expected: '7' });
    assert.equal(TABLES.check(b, '42').ok, false);
    assert.equal(TABLES.itemKey(a), 'mult:6x7:trou');
    assert.deepEqual(TABLES.parse({ op: 'mult', a: 6, b: 7, hole: 'b' }, p), b);
    assert.equal(TABLES.parse({ op: 'mult', a: 6, b: 7, hole: 'c' }, p), null);
    const pt = readParams(TABLES, { tables: [6, 6], trous: true }), rand = seeded(9), trous = new Set<string>();
    for (let i = 0; i < 40; i++) { const q = TABLES.question('mult:6x7:trou', pt, rand); assert.equal(TABLES.itemKey(q), 'mult:6x7:trou'); trous.add(TABLES.text(q)); }
    assert.deepEqual([...trous].sort(), ['6 × ? = 42', '7 × ? = 42', '? × 6 = 42', '? × 7 = 42']);
  });
});

describe('l’exercice Dictée de mots', () => {
  const ctx: ExerciseContext = { lists: [
    { id: 'semaine', label: 'Semaine 12', items: ['oiseau', ' école ', 'aujourd’hui', 'oiseau', 'c’est-à-dire', '42', 'trop long ' + 'x'.repeat(40)], source: 'foyer' },
    { id: 'vieille', label: 'Ancienne', items: ['hier'], source: 'foyer', archived: true },
  ] };
  const p = readParams(DICTEE, { liste: 'semaine' }, ctx);

  it('l’univers : les mots de la liste, nettoyés, sans doublon ni ce qui n’est pas un mot', () => {
    assert.deepEqual(DICTEE.universe(p, ctx), ['mot:oiseau', 'mot:école', 'mot:aujourd\'hui', 'mot:c\'est-à-dire']);
    assert.equal(DICTEE.summary(p, ctx), 'La liste « Semaine 12 » (4 mots)');
    assert.deepEqual(DICTEE.groups('mot:oiseau', p, ctx), ['Liste « Semaine 12 »']);
    assert.deepEqual(DICTEE.learn!(p, ctx).map(DICTEE.text), ['oiseau', 'école', 'aujourd\'hui', 'c\'est-à-dire']);
    assert.equal(DICTEE.spoken!({ mot: 'école' }), 'école');
  });

  it('la correction : les accents comptent, pas la casse, les espaces ni l’apostrophe', () => {
    const q = { mot: 'école' };
    assert.deepEqual(DICTEE.check(q, 'école'), { ok: true, expected: 'école' });
    assert.equal(DICTEE.check(q, ' École ').ok, true);
    assert.equal(DICTEE.check(q, 'ecole').ok, false, 'l’accent est ce qu’on apprend');
    assert.equal(DICTEE.check({ mot: 'aujourd\'hui' }, 'aujourd’hui').ok, true);
    assert.equal(DICTEE.check({ mot: 'parce que' }, 'parce  que').ok, true);
    assert.equal(DICTEE.check(q, '').ok, false);
  });

  it('relit une question reçue, et refuse ce qui n’est pas un mot', () => {
    assert.deepEqual(DICTEE.parse({ mot: ' oiseau ' }, p), { mot: 'oiseau' });
    for (const bad of [null, {}, { mot: '' }, { mot: '42' }, { mot: 'x'.repeat(41) }, { mot: 7 }]) assert.equal(DICTEE.parse(bad, p), null, JSON.stringify(bad));
    assert.equal(DICTEE.itemKey({ mot: 'oiseau' }), 'mot:oiseau');
  });

  it('le paramètre de liste : la première non archivée par défaut, une archivée reste lisible, une inconnue est refusée', () => {
    assert.equal(defaults(DICTEE, ctx)['liste'], 'semaine');
    assert.equal(readParams(DICTEE, { liste: 'vieille' }, ctx)['liste'], 'vieille');
    assert.throws(() => readParams(DICTEE, { liste: 'inconnue' }, ctx), /« Liste de mots » : cette liste n’existe pas/);
    assert.throws(() => readParams(DICTEE, {}, NO_CONTEXT), /aucune liste disponible/);
    assert.equal(DICTEE.summary(readParams(DICTEE, { liste: 'vieille' }, ctx), NO_CONTEXT), 'Aucune liste de mots');
  });
});

describe('le socle ne mélange pas deux exercices', () => {
  // Deux exercices fictifs qui emploient la même clé d'item : le socle ne doit
  // les distinguer que par leur identifiant, jamais par ce qu'il saurait d'eux.
  const db = new Database(':memory:');
  migrateRevisions(db);
  initRevisionsRepo(db);
  const cfg: MasteryCfg = { espacementJours: [0, 1, 3, 7, 14, 30], descenteSiFaux: 2, niveauAcquis: 3, bonnesMin: 3 };
  const jour = (d: number): string => new Date(Date.UTC(2026, 9, 12 + d, 17)).toISOString();
  let n = 0;
  const envoyer = (exerciseId: string, results: Result[], d: number, mode: 'entrainer' | 'apprendre' = 'entrainer') => recordSession({
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, memberId: 'm2', exerciseId, programId: null, mode, params: {},
    startedAt: jour(d), endedAt: jour(d), aborted: false, allowedMs: 8000, fastMs: 4000, device: '', via: null,
    answers: results.map((result): AnswerIn => ({ itemKey: 'k', question: { k: 1 }, expected: '1', given: '1', ms: 1000, askedAt: jour(d), result })),
  }, cfg);

  it('la même clé dans deux exercices fait deux maîtrises', () => {
    envoyer('fictif-a', ['bon'], 0);
    envoyer('fictif-a', ['bon'], 1);
    envoyer('fictif-b', ['faux'], 1);
    assert.equal(masteryOf('m2', 'fictif-a', 'k')!.level, 2);
    assert.equal(masteryOf('m2', 'fictif-b', 'k')!.level, 0);
    assert.equal(masteryOf('m2', 'fictif-b', 'k')!.wrong, 1);
    assert.deepEqual(masteryRows('m2', 'fictif-c'), []);
  });

  it('recalculer un exercice laisse l’autre tel quel', () => {
    const b = masteryOf('m2', 'fictif-b', 'k');
    db.prepare("UPDATE rev_mastery SET level = 5 WHERE exercise_id = 'fictif-b'").run();
    const out = recomputeMember('m2', 'fictif-a', () => cfg);
    assert.equal(out.items, 1);
    assert.equal(masteryOf('m2', 'fictif-b', 'k')!.level, 5, 'fictif-b n’a pas été touché');
    recomputeMember('m2', null, () => cfg);
    assert.deepEqual(masteryOf('m2', 'fictif-b', 'k'), b, 'tous les exercices : chacun depuis ses réponses');
  });

  it('chaque exercice a ses propres règles de maîtrise', () => {
    const seen: string[] = [];
    recomputeMember('m2', null, (ex) => { seen.push(ex); return ex === 'fictif-a' ? { ...cfg, descenteSiFaux: 1 } : cfg; });
    assert.deepEqual(seen.sort(), ['fictif-a', 'fictif-b']);
  });

  it('reclasser ne touche ni l’autre exercice ni le mode Apprendre', () => {
    const appris = envoyer('fictif-a', ['bon'], 2, 'apprendre').session.id;
    const out = recomputeMember('m2', 'fictif-a', () => cfg, () => 500);
    assert.equal(out.reclassified, 2, 'les deux bonnes de fictif-a, en 1 s, dépassent un seuil de 0,5 s');
    assert.equal((db.prepare('SELECT result FROM rev_answers WHERE session_id = ?').get(appris) as { result: string }).result, 'bon');
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM rev_answers WHERE exercise_id = 'fictif-b' AND result = 'faux'").get() as { n: number }).n, 1);
  });

  it('un programme actif par exercice, remplacé seulement dans le sien', () => {
    const base = { memberId: 'm2', questions: 10, secondsAllowed: null, fastSeconds: null, dailyGoal: 1, setBy: 'm1' };
    const a1 = setProgram({ ...base, exerciseId: 'fictif-a', params: { n: 1 } });
    setProgram({ ...base, exerciseId: 'fictif-b', params: { n: 2 } });
    const a2 = setProgram({ ...base, exerciseId: 'fictif-a', params: { n: 3 } });
    assert.deepEqual(activePrograms('m2').map((p) => [p.exercise_id, JSON.parse(p.params_json).n]), [['fictif-a', 3], ['fictif-b', 2]]);
    assert.equal(activeProgram('m2', 'fictif-a')!.id, a2.id);
    assert.equal((db.prepare('SELECT active FROM rev_programs WHERE id = ?').get(a1.id) as { active: number }).active, 0);
  });
});
