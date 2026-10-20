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
import { ExerciseContext, LONG_ITEM_MAX, NO_CONTEXT, PARAM_TYPES, ParamDecl, defaults, longItems, readParams, splitItems } from '../src/revisions/exercises/contract';
import { cleanListItems, shippedLists } from '../src/revisions/content';
import { EXERCISES, exerciseById } from '../src/revisions/exercises';
import { TABLES, TablesQuestion } from '../src/revisions/exercises/tables';
import { DICTEE } from '../src/revisions/exercises/dictee';
import { HEURE } from '../src/revisions/exercises/heure';
import { SOUSTRACTIONS } from '../src/revisions/exercises/soustractions';
import { COMPLEMENTS } from '../src/revisions/exercises/complements';
import { DOUBLES } from '../src/revisions/exercises/doubles';
import { COMPARER, situation } from '../src/revisions/exercises/comparer';
import { LETTRES, inWords } from '../src/revisions/exercises/lettres';
import { MONNAIE, money } from '../src/revisions/exercises/monnaie';
import { ACCORDS, readLine as readAccord } from '../src/revisions/exercises/accords';
import { CONJUGAISON, readLine } from '../src/revisions/exercises/conjugaison';
import { ORTHOGRAPHE, readLine as readPhrase } from '../src/revisions/exercises/orthographe';
import { LECTURE, readLine as readQuestion } from '../src/revisions/exercises/lecture';
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

  it('un énoncé « horloge » dit quelle heure dessiner, une vue « grille » sa forme', () => {
    for (const e of EXERCISES) {
      if (e.prompt === 'horloge') assert.equal(typeof e.clock, 'function', `${e.id} : un énoncé horloge déclare clock()`);
      if (e.view === 'grille') assert.equal(typeof e.grid, 'function', `${e.id} : une vue grille déclare grid()`);
      if (e.input === 'choix') assert.equal(typeof e.choices, 'function', `${e.id} : une saisie choix déclare choices()`);
      if (e.prompt === 'passage') assert.equal(typeof e.passage, 'function', `${e.id} : un énoncé passage déclare passage()`);
      if (e.prompt === 'monnaie') assert.equal(typeof e.coins, 'function', `${e.id} : un énoncé monnaie déclare coins()`);
    }
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

describe('l’exercice Compléments', () => {
  const p = (cible: string) => readParams(COMPLEMENTS, { cible });

  it('l’univers suit la cible : 11 vers 10, 21 vers 20, 11 dizaines ou 101 nombres vers 100', () => {
    assert.deepEqual(['dix', 'vingt', 'dizaines', 'cent'].map((c) => COMPLEMENTS.universe(p(c), NO_CONTEXT).length), [11, 21, 11, 101]);
    assert.deepEqual(COMPLEMENTS.universe(p('dizaines'), NO_CONTEXT).slice(0, 3), ['comp:100:0', 'comp:100:10', 'comp:100:20']);
    assert.ok(COMPLEMENTS.universe(p('cent'), NO_CONTEXT).includes('comp:100:30'), '30 + ? = 100 est le même item dans les deux programmes');
    assert.equal(readParams(COMPLEMENTS, {}).cible, 'dix', 'par défaut, vers 10');
  });

  it('l’énoncé, la correction, la relecture, les groupes, le mode Apprendre et le résumé', () => {
    const q = COMPLEMENTS.question('comp:10:3', p('dix'), () => 0);
    assert.equal(COMPLEMENTS.text(q), '3 + ? = 10');
    assert.deepEqual(COMPLEMENTS.ask!(q), { before: '3 +', after: '= 10' });
    assert.deepEqual(COMPLEMENTS.check(q, '7'), { ok: true, expected: '7' });
    assert.equal(COMPLEMENTS.check(q, '13').ok, false);
    assert.deepEqual(COMPLEMENTS.check({ cible: 100, n: 100 }, '0'), { ok: true, expected: '0' });
    assert.deepEqual(COMPLEMENTS.parse({ cible: 20, n: 13 }, p('vingt')), { cible: 20, n: 13 });
    for (const bad of [null, {}, { cible: 30, n: 3 }, { cible: 10, n: 11 }, { cible: 10, n: '3' }]) assert.equal(COMPLEMENTS.parse(bad, p('dix')), null, JSON.stringify(bad));
    assert.equal(COMPLEMENTS.itemLabel('comp:100:30'), '30 + … = 100');
    assert.deepEqual(COMPLEMENTS.groups('comp:20:13', p('vingt'), NO_CONTEXT), ['Compléments à 20']);
    assert.deepEqual(COMPLEMENTS.learn!(p('dix'), NO_CONTEXT).slice(0, 2), [{ cible: 10, n: 0 }, { cible: 10, n: 1 }]);
    assert.equal(COMPLEMENTS.spoken!(q), '3 plus 7, 10');
    assert.equal(COMPLEMENTS.summary(p('dizaines'), NO_CONTEXT), 'Les compléments à 100, par dizaines');
  });
});

describe('l’exercice Doubles et moitiés', () => {
  const p = (operation: string, jusqua: string) => readParams(DOUBLES, { operation, jusqua });

  it('l’univers suit le programme : les doubles de la plage, les moitiés de leurs résultats', () => {
    assert.deepEqual(['dix', 'vingt', 'dizaines', 'cent'].map((j) => DOUBLES.universe(p('doubles', j), NO_CONTEXT).length), [10, 20, 5, 50]);
    assert.deepEqual(DOUBLES.universe(p('moities', 'dix'), NO_CONTEXT).slice(0, 3), ['moit:2', 'moit:4', 'moit:6']);
    assert.deepEqual(DOUBLES.universe(p('deux', 'dizaines'), NO_CONTEXT), ['dbl:10', 'dbl:20', 'dbl:30', 'dbl:40', 'dbl:50', 'moit:20', 'moit:40', 'moit:60', 'moit:80', 'moit:100']);
    assert.ok(DOUBLES.universe(p('doubles', 'cent'), NO_CONTEXT).includes('dbl:30'), 'le double de 30 est le même item dans les deux plages');
    assert.deepEqual([readParams(DOUBLES, {}).operation, readParams(DOUBLES, {}).jusqua], ['doubles', 'dix'], 'par défaut, les doubles de 1 à 10');
  });

  it('l’énoncé, la correction, la relecture, les groupes, le mode Apprendre et le résumé', () => {
    const d = DOUBLES.question('dbl:7', p('doubles', 'dix'), () => 0), m = DOUBLES.question('moit:30', p('moities', 'cent'), () => 0);
    assert.deepEqual([DOUBLES.text(d), DOUBLES.text(m)], ['Double de 7', 'Moitié de 30']);
    assert.deepEqual([DOUBLES.ask!(d), DOUBLES.ask!(m)], [{ before: 'Le double de 7 =', after: '' }, { before: 'La moitié de 30 =', after: '' }]);
    assert.deepEqual(DOUBLES.check(d, '14'), { ok: true, expected: '14' });
    assert.deepEqual(DOUBLES.check(m, '015'), { ok: true, expected: '15' });
    assert.equal(DOUBLES.check(d, '7').ok, false);
    assert.deepEqual(DOUBLES.parse({ op: 'moit', n: 14 }, p('moities', 'dix')), { op: 'moit', n: 14 });
    for (const bad of [null, {}, { op: 'moit', n: 7 }, { op: 'dbl', n: 0 }, { op: 'dbl', n: 51 }, { op: 'tiers', n: 9 }, { op: 'dbl', n: '3' }]) assert.equal(DOUBLES.parse(bad, p('deux', 'cent')), null, JSON.stringify(bad));
    assert.equal(DOUBLES.itemLabel('moit:14'), 'moitié de 14');
    assert.deepEqual([DOUBLES.groups('dbl:7', p('deux', 'dix'), NO_CONTEXT), DOUBLES.groups('moit:14', p('deux', 'dix'), NO_CONTEXT)], [['Doubles'], ['Moitiés']]);
    assert.deepEqual(DOUBLES.learn!(p('deux', 'dix'), NO_CONTEXT).slice(9, 11), [{ op: 'dbl', n: 10 }, { op: 'moit', n: 2 }]);
    assert.deepEqual([DOUBLES.spoken!(d), DOUBLES.spoken!(m)], ['le double de 7, 14', 'la moitié de 30, 15']);
    assert.equal(DOUBLES.summary(p('deux', 'dizaines'), NO_CONTEXT), 'Les doubles et les moitiés des dizaines, de 10 à 50');
  });
});

describe('l’exercice Comparer', () => {
  const p = (jusqua: string) => readParams(COMPARER, { jusqua });
  const PLAGE: Record<string, number> = { vingt: 20, cent: 100, mille: 1000 };

  it('la situation d’une paire, du plus visible au plus piégeux', () => {
    assert.deepEqual([[9, 12], [38, 52], [43, 47], [47, 74], [123, 321], [5, 5], [3, 7], [100, 99]].map(([a, b]) => situation(a, b)),
      ['taille', 'premier', 'suivant', 'inverse', 'inverse', 'egal', 'premier', 'taille']);
  });

  it('l’univers : chaque situation de la plage, < et > séparés ; toute paire de la plage y tombe', () => {
    assert.deepEqual(['vingt', 'cent', 'mille'].map((j) => COMPARER.universe(p(j), NO_CONTEXT).length), [7, 9, 9]);
    assert.ok(!COMPARER.universe(p('vingt'), NO_CONTEXT).some((k) => k.includes('inverse')), 'pas de chiffres inversés jusqu’à 20');
    assert.equal(readParams(COMPARER, {}).jusqua, 'cent');
    const u = new Set(COMPARER.universe(p('vingt'), NO_CONTEXT));
    for (let a = 0; a <= 20; a++) for (let b = 0; b <= 20; b++) assert.ok(u.has(COMPARER.itemKey({ a, b, max: 20 })), `${a} … ${b}`);
  });

  it('le tirage tombe toujours dans l’item demandé, dans la plage', () => {
    for (const j of ['vingt', 'cent', 'mille']) {
      const rand = seeded(11);
      for (const k of COMPARER.universe(p(j), NO_CONTEXT)) for (let i = 0; i < 30; i++) {
        const q = COMPARER.question(k, p(j), rand);
        assert.equal(COMPARER.itemKey(q), k, `${k} : ${q.a} … ${q.b}`);
        assert.ok(q.a <= q.max && q.b <= q.max);
      }
    }
  });

  it('l’énoncé, la correction, la relecture, les groupes, le mode Apprendre et le résumé', () => {
    const q = { a: 47, b: 74, max: 100 };
    assert.equal(COMPARER.text(q), '47 … 74');
    assert.deepEqual(COMPARER.ask!(q), { before: '47', after: '74' });
    assert.deepEqual(COMPARER.choices!(q), ['<', '=', '>'], 'toujours dans le même ordre, comme des touches');
    assert.deepEqual(COMPARER.check(q, '<'), { ok: true, expected: '<' });
    assert.equal(COMPARER.check(q, '>').ok, false);
    assert.equal(COMPARER.itemKey(q), 'cmp:100:inverse:lt');
    assert.deepEqual(['cmp:100:inverse:lt', 'cmp:100:inverse:gt', 'cmp:20:egal:eq', 'cmp:1000:suivant:gt'].map((k) => COMPARER.itemLabel(k)), ['47 < 74', '74 > 47', '8 = 8', '352 > 345']);
    for (const j of ['vingt', 'cent', 'mille']) for (const k of COMPARER.universe(p(j), NO_CONTEXT)) {
      const [a, s, b] = COMPARER.itemLabel(k).split(' ');
      assert.equal(COMPARER.itemKey({ a: +a, b: +b, max: PLAGE[j] }), k, `l’exemple de ${k} est bien dans sa situation`);
      assert.equal(COMPARER.check({ a: +a, b: +b, max: PLAGE[j] }, s).ok, true);
    }
    assert.deepEqual(COMPARER.groups('cmp:100:inverse:gt', p('cent'), NO_CONTEXT), ['Chiffres inversés']);
    assert.deepEqual(COMPARER.parse({ a: 47, b: 74, max: 100 }, p('cent')), q);
    for (const bad of [null, {}, { a: 47, b: 101, max: 100 }, { a: 47, b: 74, max: 1000 }, { a: -1, b: 3, max: 100 }, { a: '4', b: 3, max: 100 }]) assert.equal(COMPARER.parse(bad, p('cent')), null, JSON.stringify(bad));
    const l = COMPARER.learn!(p('cent'), NO_CONTEXT);
    assert.deepEqual(l.map((x) => COMPARER.itemKey(x)), COMPARER.universe(p('cent'), NO_CONTEXT), 'un exemple par item');
    assert.deepEqual(COMPARER.learn!(p('cent'), NO_CONTEXT), l, 'toujours les mêmes exemples');
    assert.equal(COMPARER.spoken!(q), '47 est plus petit que 74');
    assert.equal(COMPARER.summary(p('mille'), NO_CONTEXT), 'La comparaison des nombres jusqu’à 1 000');
  });
});

describe('l’exercice Nombres en lettres', () => {
  const p = (jusqua: string, orthographe = 'rectifiee') => readParams(LETTRES, { jusqua, orthographe });

  it('l’écriture en lettres de 0 à 99, rectifiée ou traditionnelle', () => {
    const cas: [number, string, string][] = [
      [0, 'zéro', 'zéro'], [16, 'seize', 'seize'], [17, 'dix-sept', 'dix-sept'], [21, 'vingt-et-un', 'vingt et un'], [42, 'quarante-deux', 'quarante-deux'],
      [60, 'soixante', 'soixante'], [70, 'soixante-dix', 'soixante-dix'], [71, 'soixante-et-onze', 'soixante et onze'], [77, 'soixante-dix-sept', 'soixante-dix-sept'],
      [80, 'quatre-vingts', 'quatre-vingts'], [81, 'quatre-vingt-un', 'quatre-vingt-un'], [91, 'quatre-vingt-onze', 'quatre-vingt-onze'], [99, 'quatre-vingt-dix-neuf', 'quatre-vingt-dix-neuf'],
    ];
    for (const [n, r, t] of cas) assert.deepEqual([inWords(n), inWords(n, true)], [r, t], String(n));
    assert.equal(new Set(Array.from({ length: 100 }, (_, n) => inWords(n))).size, 100, 'cent écritures distinctes');
  });

  it('l’univers suit la plage ; la grille dizaines × unités le couvre exactement', () => {
    assert.deepEqual(['vingt', 'soixante', 'cent'].map((j) => LETTRES.universe(p(j), NO_CONTEXT).length), [20, 70, 100]);
    assert.equal(readParams(LETTRES, {}).jusqua, 'soixante');
    for (const j of ['vingt', 'soixante', 'cent']) {
      const g = LETTRES.grid!(p(j));
      const cells = g.rows.flatMap((_, r) => g.cols.map((_, c) => g.keyAt(r, c)));
      assert.deepEqual(cells, LETTRES.universe(p(j), NO_CONTEXT), j);
    }
  });

  it('l’énoncé, la correction, les groupes, le mode Apprendre et le résumé', () => {
    const q = LETTRES.question('let:71', p('cent'), () => 0);
    assert.equal(LETTRES.text(q), 'soixante-et-onze');
    assert.equal(LETTRES.text(LETTRES.question('let:71', p('cent', 'traditionnelle'), () => 0)), 'soixante et onze');
    assert.deepEqual(LETTRES.check(q, '71'), { ok: true, expected: '71' });
    assert.equal(LETTRES.check(q, '61').ok, false);
    assert.equal(LETTRES.itemKey(LETTRES.parse({ n: 71 }, p('cent'))!), 'let:71');
    for (const bad of [null, {}, { n: 100 }, { n: -1 }, { n: '7' }]) assert.equal(LETTRES.parse(bad, p('cent')), null, JSON.stringify(bad));
    assert.equal(LETTRES.itemLabel('let:80'), 'quatre-vingts (80)');
    assert.deepEqual([3, 30, 45, 77].map((n) => LETTRES.groups(`let:${n}`, p('cent'), NO_CONTEXT)[0]), ['De zéro à seize', 'Les dizaines', 'De 17 à 69', 'De 70 à 99']);
    assert.equal(LETTRES.learn!(p('vingt'), NO_CONTEXT).length, 20);
    assert.equal(LETTRES.spoken!(q), 'soixante-et-onze');
    assert.equal(LETTRES.summary(p('cent', 'traditionnelle'), NO_CONTEXT), 'Les nombres en lettres de 0 à 99, orthographe traditionnelle');
  });
});

describe('l’exercice Monnaie', () => {
  const p = (plage: string) => readParams(MONNAIE, { plage });

  it('l’univers : chaque total de la plage, au pas de la plus petite pièce', () => {
    assert.deepEqual(['e20', 'e100', 'c'].map((x) => MONNAIE.universe(p(x), NO_CONTEXT).length), [20, 100, 50]);
    assert.deepEqual(MONNAIE.universe(p('c'), NO_CONTEXT).slice(0, 3), ['mon:c:10', 'mon:c:20', 'mon:c:30']);
    assert.equal(readParams(MONNAIE, {}).plage, 'e20');
  });

  it('le tirage fait le bon total, avec les pièces de la plage, dix au plus, du plus gros au plus petit', () => {
    const denoms: Record<string, number[]> = { e20: [100, 200, 500, 1000], e100: [100, 200, 500, 1000, 2000, 5000], c: [10, 20, 50, 100, 200] };
    for (const x of ['e20', 'e100', 'c']) {
      const rand = seeded(3);
      for (const k of MONNAIE.universe(p(x), NO_CONTEXT)) for (let i = 0; i < 10; i++) {
        const q = MONNAIE.question(k, p(x), rand);
        assert.equal(MONNAIE.itemKey(q), k);
        assert.ok(q.coins.length <= 10 && q.coins.every((c) => denoms[x].includes(c)), `${k} : ${q.coins}`);
        assert.deepEqual(q.coins, [...q.coins].sort((a, b) => b - a));
        assert.ok(MONNAIE.parse(q, p(x)), 'relue telle quelle');
      }
    }
  });

  it('la saisie : des euros, ou tous les chiffres en centimes ; la correction et l’affichage', () => {
    const e = { plage: 'e20' as const, coins: [1000, 200, 100] }, c = { plage: 'c' as const, coins: [200, 100, 20, 20] };
    assert.deepEqual(MONNAIE.check(e, '13'), { ok: true, expected: '13 €' });
    assert.equal(MONNAIE.check(e, '1300').ok, false);
    assert.deepEqual(MONNAIE.check(c, '340'), { ok: true, expected: '3,40 €' });
    assert.equal(MONNAIE.check(c, '34').ok, false, 'en centimes, 34 fait 0,34 €');
    assert.deepEqual([MONNAIE.display!('13', e), MONNAIE.display!('34', c), MONNAIE.display!('340', c), MONNAIE.display!('5', c)], ['13 €', '0,34 €', '3,40 €', '0,05 €']);
    assert.equal(MONNAIE.text(c), '2 € + 1 € + 20 c + 20 c');
    assert.deepEqual(MONNAIE.coins!(c), c.coins);
    assert.deepEqual([money(340), money(50, true), money(2000)], ['3,40 €', '50 c', '20 €']);
    assert.equal(MONNAIE.itemLabel('mon:c:340'), '3,40 €');
    assert.deepEqual(['mon:c:90', 'mon:c:340', 'mon:e100:4500'].map((k) => MONNAIE.groups(k, p('c'), NO_CONTEXT)[0]), ['Moins de 1 €', 'De 2 à 5 €', 'De 21 à 50 €']);
    for (const bad of [null, {}, { plage: 'c', coins: [500] }, { plage: 'e20', coins: [100] }, { plage: 'c', coins: [] }, { plage: 'c', coins: Array(11).fill(10) }, { plage: 'c', coins: [200, 200, 200] }]) {
      assert.equal(MONNAIE.parse(bad, p('c')), null, JSON.stringify(bad));
    }
    assert.equal(MONNAIE.summary(p('c'), NO_CONTEXT), 'La monnaie, centimes compris, jusqu’à 5 €');
  });
});

describe('l’exercice Féminin et pluriel', () => {
  const ctx: ExerciseContext = { lists: [
    { id: 'semaine', label: 'Pluriels', source: 'foyer', items: ['un cheval > des chevaux', "l'arbre > les arbres", 'petit > petite', 'pas de flèche', 'un chat > un chat', 'un cheval > des chevaux'] },
  ] };
  const p = readParams(ACCORDS, { liste: 'semaine' }, ctx);

  it('une ligne par mot : le mot de départ, « > », le mot attendu avec son déterminant', () => {
    assert.deepEqual(readAccord('un cheval > des chevaux'), { from: 'un cheval', hint: 'des ', word: 'chevaux' });
    assert.deepEqual(readAccord("un arbre > l'arbre"), { from: 'un arbre', hint: "l'", word: 'arbre' });
    assert.deepEqual(readAccord('petit>petite'), { from: 'petit', hint: '', word: 'petite' });
    for (const bad of ['pas de flèche', 'a > b > c', 'un chat > un chat', '> une', 'un 1 > des 2']) assert.equal(readAccord(bad), null, bad);
    assert.deepEqual(ACCORDS.universe(p, ctx), ['acc:un cheval > des chevaux', "acc:l'arbre > les arbres", 'acc:petit > petite']);
    assert.equal(ACCORDS.summary(p, ctx), 'La liste « Pluriels » (3 mots)');
  });

  it('la question : le déterminant donné, le mot à écrire, avec ou sans déterminant', () => {
    const q = ACCORDS.question('acc:un cheval > des chevaux', p, () => 0);
    assert.deepEqual(ACCORDS.ask!(q), { before: 'un cheval → des', after: '' });
    assert.deepEqual(ACCORDS.check(q, 'Chevaux'), { ok: true, expected: 'chevaux' });
    assert.equal(ACCORDS.check(q, 'des chevaux').ok, true);
    assert.equal(ACCORDS.check(q, 'chevals').ok, false);
    assert.equal(ACCORDS.check(ACCORDS.question('acc:petit > petite', p, () => 0), 'petité').ok, false, 'les accents comptent');
    assert.equal(ACCORDS.text(q), 'un cheval → des chevaux');
    assert.deepEqual(['acc:un cheval > des chevaux', 'acc:petit > petite', "acc:un arbre > l'arbre"].map((k) => ACCORDS.groups(k, p, ctx)[0]), ['des …', 'Sans déterminant', "l' …"]);
    assert.equal(ACCORDS.spoken!(q), 'un cheval, des chevaux');
    assert.ok(new Set(ACCORDS.universe(p, ctx)).has(ACCORDS.itemKey(ACCORDS.parse({ from: 'un cheval', hint: 'des ', word: 'chevaux' }, p)!)));
    assert.ok(!new Set(ACCORDS.universe(p, ctx)).has(ACCORDS.itemKey(ACCORDS.parse({ from: 'un cheval', hint: 'des ', word: 'chevals' }, p)!)), 'un appareil ne change pas le mot attendu');
  });

  it('les listes livrées se lisent toutes, et tiennent dans une liste du foyer', () => {
    const lists = shippedLists(path.join(os.tmpdir(), 'foyer-sans-surcharge'), 'accords');
    assert.ok(lists.length >= 4);
    for (const l of lists) {
      assert.equal(l.items.filter((x) => !readAccord(x)).length, 0, l.id);
      assert.deepEqual(cleanListItems(l.items), l.items, l.id);
    }
  });
});

describe('l’exercice Soustractions', () => {
  const p = readParams(SOUSTRACTIONS, { tables: [7, 7] });

  it('l’univers : pour chaque nombre enlevé, chaque résultat de 0 à 10, jamais commutatif', () => {
    const u = SOUSTRACTIONS.universe(p, NO_CONTEXT);
    assert.equal(u.length, 11);
    assert.deepEqual([u[0], u[10]], ['sub:7-7', 'sub:17-7']);
    assert.equal(SOUSTRACTIONS.universe(readParams(SOUSTRACTIONS, {}), NO_CONTEXT).length, 44, 'par défaut, enlever de 2 à 5');
    assert.throws(() => readParams(SOUSTRACTIONS, { tables: [3, 11] }));
    assert.notEqual(SOUSTRACTIONS.itemKey({ a: 13, b: 7 }), SOUSTRACTIONS.itemKey({ a: 13, b: 6 }));
  });

  it('la correction, la relecture, les groupes, la grille, le mode Apprendre et le résumé', () => {
    assert.deepEqual(SOUSTRACTIONS.check({ a: 13, b: 7 }, '6'), { ok: true, expected: '6' });
    assert.equal(SOUSTRACTIONS.check({ a: 13, b: 7 }, ' 06 ').ok, true);
    assert.equal(SOUSTRACTIONS.check({ a: 13, b: 7 }, '7').ok, false);
    assert.deepEqual(SOUSTRACTIONS.check({ a: 7, b: 7 }, '0'), { ok: true, expected: '0' });
    assert.deepEqual(SOUSTRACTIONS.parse({ a: 13, b: 7 }, p), { a: 13, b: 7 });
    for (const bad of [null, {}, { a: 3, b: 7 }, { a: 19, b: 2 }, { a: 13, b: 11 }, { a: '13', b: 7 }]) assert.equal(SOUSTRACTIONS.parse(bad, p), null, JSON.stringify(bad));
    assert.equal(SOUSTRACTIONS.text({ a: 13, b: 7 }), '13 − 7');
    assert.equal(SOUSTRACTIONS.itemLabel('sub:13-7'), '13 − 7');
    assert.deepEqual(SOUSTRACTIONS.groups('sub:13-7', p, NO_CONTEXT), ['Enlever 7']);
    const g = SOUSTRACTIONS.grid!(p);
    assert.deepEqual([g.rows.length, g.cols.length, g.rows[7], g.corner], [11, 11, '− 7', '=']);
    assert.equal(g.keyAt(7, 3), 'sub:10-7');
    assert.deepEqual(SOUSTRACTIONS.learn!(p, NO_CONTEXT).map(SOUSTRACTIONS.text).slice(0, 3), ['7 − 7', '8 − 7', '9 − 7']);
    assert.equal(SOUSTRACTIONS.spoken!({ a: 13, b: 7 }), '13 moins 7, 6');
    assert.equal(SOUSTRACTIONS.summary(p, NO_CONTEXT), 'Les soustractions, enlever 7');
    assert.equal(SOUSTRACTIONS.summary(readParams(SOUSTRACTIONS, {}), NO_CONTEXT), 'Les soustractions, enlever de 2 à 5');
  });
});

describe('l’exercice Orthographe', () => {
  const ctx: ExerciseContext = { lists: [
    { id: 'semaine', label: 'a ou à', items: ['Il {a/à} un chat.', 'Nous allons {à/a} la piscine.', 'Où {est/et} le chat ?', 'pas de trou', 'Il {a/a} faim.', 'Il {a/à} un chat.'], source: 'foyer' },
  ] };
  const p = readParams(ORTHOGRAPHE, { liste: 'semaine' }, ctx);

  it('une ligne par phrase : un trou, le bon mot d’abord, de un à trois pièges distincts', () => {
    assert.deepEqual(readPhrase('Il {a/à} un chat.'), { before: 'Il', after: 'un chat.', options: ['a', 'à'] });
    assert.deepEqual(readPhrase("C'{est/et/ai} beau."), { before: "C'", after: 'beau.', options: ['est', 'et', 'ai'] });
    for (const bad of ['pas de trou', '{a/à}', 'Il {a} faim.', 'Il {a/a} faim.', 'Il {a/à} {a/à}.', 'Il {a/à/b/c/d} faim.']) assert.equal(readPhrase(bad), null, bad);
    assert.deepEqual(ORTHOGRAPHE.universe(p, ctx), ['orth:Il {a/à} un chat.', 'orth:Nous allons {à/a} la piscine.', 'orth:Où {est/et} le chat ?']);
    assert.equal(ORTHOGRAPHE.summary(p, ctx), 'La liste « a ou à » (3 phrases)');
  });

  it('la question : la phrase autour du trou, les boutons mélangés, le bon mot attendu', () => {
    const q = ORTHOGRAPHE.question('orth:Nous allons {à/a} la piscine.', p, () => 0);
    assert.deepEqual(ORTHOGRAPHE.ask!(q), { before: 'Nous allons', after: 'la piscine.' });
    assert.deepEqual([...ORTHOGRAPHE.choices!(q)].sort(), ['a', 'à']);
    assert.deepEqual(ORTHOGRAPHE.check(q, 'à'), { ok: true, expected: 'à' });
    assert.equal(ORTHOGRAPHE.check(q, 'a').ok, false, 'l’accent compte');
    assert.equal(ORTHOGRAPHE.text(q), 'Nous allons à la piscine.');
    assert.equal(ORTHOGRAPHE.text(ORTHOGRAPHE.question('orth:Où {est/et} le chat ?', p, () => 0)), 'Où est le chat ?', 'l’espace français avant « ? »');
    const ordres = new Set<string>(); const rand = seeded(5);
    for (let i = 0; i < 20; i++) ordres.add(ORTHOGRAPHE.choices!(ORTHOGRAPHE.question('orth:Il {a/à} un chat.', p, rand)).join('/'));
    assert.equal(ordres.size, 2, 'le bon mot n’est pas toujours le premier bouton');
    assert.deepEqual(ORTHOGRAPHE.groups('orth:Il {a/à} un chat.', p, ctx), ['a / à']);
    assert.deepEqual(ORTHOGRAPHE.groups('orth:{On/Ont} va au parc.', p, ctx), ['on / ont'], 'la majuscule ne fait pas un autre groupe');
  });

  it('une question relue n’entre dans l’univers que si elle est celle de la liste, bon mot compris', () => {
    const u = new Set(ORTHOGRAPHE.universe(p, ctx));
    const vraie = ORTHOGRAPHE.parse({ before: 'Il', after: 'un chat.', options: ['a', 'à'], shown: ['à', 'a'] }, p)!;
    assert.ok(u.has(ORTHOGRAPHE.itemKey(vraie)));
    const retournee = ORTHOGRAPHE.parse({ before: 'Il', after: 'un chat.', options: ['à', 'a'], shown: ['à', 'a'] }, p)!;
    assert.ok(!u.has(ORTHOGRAPHE.itemKey(retournee)), 'un appareil ne fait pas du piège la bonne réponse');
    assert.equal(ORTHOGRAPHE.parse({ before: 'Il', after: 'un chat.', options: ['a', 'à'], shown: ['a', 'b'] }, p), null, 'des boutons qui ne sont pas les mots');
  });

  it('les listes livrées se lisent toutes, phrase par phrase', () => {
    const lists = shippedLists(path.join(os.tmpdir(), 'foyer-sans-surcharge'), 'orthographe');
    assert.ok(lists.length >= 6);
    for (const l of lists) assert.equal(l.items.filter((x) => !readPhrase(x)).length, 0, l.id);
  });
});

describe('l’exercice Lecture', () => {
  const texte = 'Inès a sept ans. Son frère Malo a deux ans de plus.';
  const ctx: ExerciseContext = { lists: [
    { id: 'semaine', label: 'Inès et Malo', source: 'foyer', items: [
      `${texte} | Quel âge a Malo ? | neuf ans / sept ans / cinq ans`,
      `${texte} | Qui est le plus jeune ? | Inès / Malo`,
      'Le chat dort. | Qui dort ? | le chat',
      `${texte} | Quel âge a Malo ? | neuf ans / sept ans / cinq ans`,
    ] },
  ] };
  const p = readParams(LECTURE, { liste: 'semaine' }, ctx);
  const cle = `lect:${texte} | Quel âge a Malo ? | neuf ans / sept ans / cinq ans`;

  it('une ligne par question : le texte, la question, de deux à quatre réponses distinctes', () => {
    assert.deepEqual(readQuestion(' Le chat dort.|Qui dort ?|le chat / le chien '), { passage: 'Le chat dort.', question: 'Qui dort ?', options: ['le chat', 'le chien'] });
    assert.deepEqual(readQuestion('Lou a 3 billes, Max en a 5. | Qui en a le plus ? | Max / Lou')?.passage, 'Lou a 3 billes, Max en a 5.', 'virgules et chiffres permis');
    for (const bad of ['Le chat dort.', 'Le chat dort. | Qui dort ?', 'Le chat dort. | Qui dort ? | le chat', 'Le chat dort. | Qui dort ? | le chat / Le chat',
      ' | Qui dort ? | a / b', 'Le chat dort. | Qui dort ? | a / b / c / d / e', 'Le chat / le chien. | Qui dort ? | a / b', 'a | b | c / d | e']) assert.equal(readQuestion(bad), null, bad);
    assert.deepEqual(LECTURE.universe(p, ctx), [cle, `lect:${texte} | Qui est le plus jeune ? | Inès / Malo`], 'sans doublon ni ligne illisible');
    assert.equal(LECTURE.summary(p, ctx), 'La liste « Inès et Malo » (2 questions)');
  });

  it('la question : le texte au-dessus, les boutons mélangés, la bonne réponse attendue', () => {
    const q = LECTURE.question(cle, p, () => 0);
    assert.equal(LECTURE.passage!(q), texte);
    assert.deepEqual(LECTURE.ask!(q), { before: 'Quel âge a Malo ?', after: '' });
    assert.deepEqual([...LECTURE.choices!(q)].sort(), ['cinq ans', 'neuf ans', 'sept ans']);
    assert.deepEqual(LECTURE.check(q, 'Neuf ans'), { ok: true, expected: 'neuf ans' });
    assert.equal(LECTURE.check(q, 'sept ans').ok, false);
    assert.equal(LECTURE.text(q), `${texte} Quel âge a Malo ?`);
    assert.equal(LECTURE.itemLabel(cle), 'Quel âge a Malo ? neuf ans');
    const ordres = new Set<string>(); const rand = seeded(5);
    for (let i = 0; i < 30; i++) ordres.add(LECTURE.choices!(LECTURE.question(cle, p, rand)).join('/'));
    assert.ok(ordres.size > 2, 'la bonne réponse n’est pas toujours le premier bouton');
    assert.deepEqual(LECTURE.groups(cle, p, ctx), [texte.slice(0, 29).trimEnd() + '…'], 'les questions d’un même texte vont ensemble');
    assert.equal(LECTURE.learn, undefined, 'pas de mode Apprendre : on ne recopie pas une réponse de lecture');
  });

  it('une question relue n’entre dans l’univers que si elle est celle de la liste, bonne réponse comprise', () => {
    const u = new Set(LECTURE.universe(p, ctx));
    const vraie = LECTURE.parse({ passage: texte, question: 'Qui est le plus jeune ?', options: ['Inès', 'Malo'], shown: ['Malo', 'Inès'] }, p)!;
    assert.ok(u.has(LECTURE.itemKey(vraie)));
    const retournee = LECTURE.parse({ passage: texte, question: 'Qui est le plus jeune ?', options: ['Malo', 'Inès'], shown: ['Malo', 'Inès'] }, p)!;
    assert.ok(!u.has(LECTURE.itemKey(retournee)), 'un appareil ne fait pas du piège la bonne réponse');
    assert.equal(LECTURE.parse({ passage: texte, question: 'Qui est le plus jeune ?', options: ['Inès', 'Malo'], shown: ['Inès', 'Léo'] }, p), null);
  });

  it('les listes livrées se lisent toutes, et chaque ligne tient dans une liste du foyer', () => {
    const lists = shippedLists(path.join(os.tmpdir(), 'foyer-sans-surcharge'), 'lecture');
    assert.ok(lists.length >= 2);
    for (const l of lists) {
      assert.equal(l.items.filter((x) => !readQuestion(x)).length, 0, l.id);
      assert.ok(l.items.every((x) => x.length <= LONG_ITEM_MAX), `${l.id} : une ligne de plus de ${LONG_ITEM_MAX} caractères`);
    }
  });

  it('des éléments longs : coupés aux seuls retours à la ligne, jusqu’à 240 caractères', () => {
    assert.equal(longItems(LECTURE), true);
    assert.equal(longItems(ORTHOGRAPHE), false);
    assert.deepEqual(splitItems('Lou a 3 billes, Max 5. | Qui ? | Max / Lou\n\nb | c | d / e', true), ['Lou a 3 billes, Max 5. | Qui ? | Max / Lou', 'b | c | d / e']);
    assert.deepEqual(splitItems('oiseau, école;maison\noiseau', false), ['oiseau', 'école', 'maison']);
    assert.equal(cleanListItems(['x'.repeat(41)]), null);
    assert.deepEqual(cleanListItems(['x'.repeat(240)], true), ['x'.repeat(240)]);
    assert.equal(cleanListItems(['x'.repeat(241)], true), null);
  });
});

describe('l’exercice Conjugaison', () => {
  const ctx: ExerciseContext = { lists: [
    { id: 'semaine', label: 'Être au présent', items: ['être (présent) : je suis', 'être (présent) : nous sommes', 'avoir (présent) : j\'ai', 'pas une forme', 'être (présent) : je suis'], source: 'foyer' },
  ] };
  const p = readParams(CONJUGAISON, { liste: 'semaine' }, ctx);

  it('une ligne par forme : verbe, temps, pronom, forme ; ce qui n’a pas cette forme est écarté', () => {
    assert.deepEqual(readLine('être (présent) : nous sommes'), { verbe: 'être', temps: 'présent', pronom: 'nous', forme: 'sommes' });
    assert.deepEqual(readLine('Avoir (passé composé) : j’ai eu'), { verbe: 'avoir', temps: 'passé composé', pronom: 'j\'', forme: 'ai eu' });
    assert.deepEqual(readLine('se laver (présent) : je me lave'), { verbe: 'se laver', temps: 'présent', pronom: 'je', forme: 'me lave' });
    assert.equal(readLine('être présent je suis'), null);
    assert.deepEqual(CONJUGAISON.universe(p, ctx), ['conj:être:présent:je:suis', 'conj:être:présent:nous:sommes', 'conj:avoir:présent:j\':ai'], 'sans doublon ni ligne illisible');
    assert.equal(CONJUGAISON.summary(p, ctx), 'La liste « Être au présent » (3 formes)');
  });

  it('l’énoncé, la correction (avec ou sans pronom, accents comptés), les groupes, le mode Apprendre', () => {
    const q = CONJUGAISON.question('conj:être:présent:nous:sommes', p, () => 0);
    assert.deepEqual(CONJUGAISON.ask!(q), { before: 'être (présent) : nous', after: '' });
    assert.equal(CONJUGAISON.text(q), 'être (présent) : nous sommes');
    assert.deepEqual(CONJUGAISON.check(q, ' Sommes '), { ok: true, expected: 'sommes' });
    assert.equal(CONJUGAISON.check(q, 'nous sommes').ok, true);
    assert.equal(CONJUGAISON.check(q, 'somme').ok, false);
    assert.equal(CONJUGAISON.check(q, '').ok, false);
    const j = CONJUGAISON.question('conj:avoir:présent:j\':ai', p, () => 0);
    assert.equal(CONJUGAISON.ask!(j).before, 'avoir (présent) : j’');
    assert.equal(CONJUGAISON.check(j, 'j’ai').ok, true);
    assert.equal(CONJUGAISON.check({ ...q, forme: 'êtes' }, 'etes').ok, false, 'l’accent compte');
    assert.deepEqual(CONJUGAISON.groups('conj:être:présent:nous:sommes', p, ctx), ['être (présent)']);
    assert.equal(CONJUGAISON.learn!(p, ctx).length, 3);
    assert.equal(CONJUGAISON.spoken!(j), 'j’ai');
  });

  it('une question relue n’entre dans l’univers que si sa forme est celle de la liste', () => {
    const u = new Set(CONJUGAISON.universe(p, ctx));
    const vraie = CONJUGAISON.parse({ verbe: 'être', temps: 'présent', pronom: 'nous', forme: 'sommes' }, p)!;
    const inventee = CONJUGAISON.parse({ verbe: 'être', temps: 'présent', pronom: 'nous', forme: 'n’importe' }, p)!;
    assert.ok(u.has(CONJUGAISON.itemKey(vraie)));
    assert.ok(!u.has(CONJUGAISON.itemKey(inventee)), 'le serveur la refuse');
    assert.equal(CONJUGAISON.parse({ verbe: 'être:x', temps: 'présent', pronom: 'nous', forme: 'sommes' }, p), null);
  });

  it('les listes livrées se lisent toutes, ligne par ligne', () => {
    const lists = shippedLists(path.join(os.tmpdir(), 'foyer-sans-surcharge'), 'conjugaison');
    assert.ok(lists.length >= 6);
    for (const l of lists) assert.equal(l.items.filter((x) => !readLine(x)).length, 0, l.id);
  });
});

describe('l’exercice Lire l’heure', () => {
  const p = (precision: string) => readParams(HEURE, { precision });

  it('l’univers suit la précision : 12 heures pleines, 24 avec les demies, 48 avec les quarts, 144 à cinq minutes', () => {
    assert.deepEqual(['heure', 'demi', 'quart', 'cinq'].map((x) => HEURE.universe(p(x), NO_CONTEXT).length), [12, 24, 48, 144]);
    assert.deepEqual(HEURE.universe(p('demi'), NO_CONTEXT).slice(0, 3), ['heure:1:00', 'heure:1:30', 'heure:2:00']);
    assert.equal(readParams(HEURE, {}).precision, 'demi', 'par défaut, les demies');
    assert.throws(() => readParams(HEURE, { precision: 'seconde' }));
  });

  it('la réponse au pavé : l’heure du cadran ou douze heures plus tard ; les minutes doivent y être', () => {
    const q = { h: 7, m: 45 };
    assert.deepEqual(HEURE.check(q, '745'), { ok: true, expected: '7 h 45' });
    assert.equal(HEURE.check(q, '1945').ok, true, '19 h 45 aussi');
    assert.equal(HEURE.check(q, '845').ok, false);
    assert.equal(HEURE.check(q, '7').ok, false, 'sans les minutes');
    assert.equal(HEURE.check(q, '').ok, false);
    assert.deepEqual(HEURE.check({ h: 3, m: 0 }, '3'), { ok: true, expected: '3 h' });
    assert.equal(HEURE.check({ h: 3, m: 0 }, '300').ok, true);
    assert.equal(HEURE.check({ h: 3, m: 0 }, '15').ok, true, '15 h');
    assert.equal(HEURE.check({ h: 12, m: 15 }, '1215').ok, true);
    assert.equal(HEURE.check({ h: 12, m: 15 }, '015').ok, true, '0 h 15 sur un cadran, c’est 12 h 15');
    assert.equal(HEURE.check({ h: 10, m: 5 }, '1005').ok, true);
    assert.equal(HEURE.check({ h: 1, m: 0 }, '25').ok, false, 'pas d’heure 25');
  });

  it('la saisie s’affiche comme une heure à mesure qu’on tape', () => {
    assert.deepEqual(['7', '74', '745', '1', '10', '100', '1005', '12'].map((t) => HEURE.display!(t)), ['7 h', '7 h 4', '7 h 45', '1 h', '10 h', '1 h 00', '10 h 05', '12 h']);
  });

  it('relit une question reçue ; le cadran, les groupes, la grille, le mode Apprendre et le résumé', () => {
    assert.deepEqual(HEURE.parse({ h: 7, m: 45 }, p('quart')), { h: 7, m: 45 });
    for (const bad of [null, {}, { h: 0, m: 0 }, { h: 13, m: 0 }, { h: 7, m: 7 }, { h: 7, m: 60 }, { h: '7', m: 0 }]) assert.equal(HEURE.parse(bad, p('cinq')), null, JSON.stringify(bad));
    assert.equal(HEURE.itemKey({ h: 7, m: 5 }), 'heure:7:05');
    assert.equal(HEURE.itemLabel('heure:7:05'), '7 h 05');
    assert.deepEqual(HEURE.clock!({ h: 7, m: 45 }), { h: 7, m: 45 });
    assert.deepEqual(['heure:7:00', 'heure:7:30', 'heure:7:15', 'heure:7:45', 'heure:7:20'].map((k) => HEURE.groups(k, p('cinq'), NO_CONTEXT)[0]),
      ['Heures pleines', 'Demies', 'Quarts', 'Quarts', 'Cinq minutes']);
    const g = HEURE.grid!(p('quart'));
    assert.deepEqual([g.rows.length, g.cols], [12, ['00', '15', '30', '45']]);
    assert.equal(g.keyAt(6, 3), 'heure:7:45');
    assert.deepEqual(HEURE.learn!(p('quart'), NO_CONTEXT).map(HEURE.text), ['4 h', '4 h 15', '4 h 30', '4 h 45']);
    assert.equal(HEURE.learn!(p('heure'), NO_CONTEXT).length, 12);
    assert.equal(HEURE.spoken!({ h: 7, m: 45 }), '7 heures 45');
    assert.equal(HEURE.summary(p('quart'), NO_CONTEXT), 'L’heure, au quart d’heure près');
    const rand = seeded(3);
    assert.equal(HEURE.itemKey(HEURE.question('heure:9:30', p('demi'), rand)), 'heure:9:30');
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
