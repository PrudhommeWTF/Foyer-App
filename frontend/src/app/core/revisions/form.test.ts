// Le formulaire engendré des paramètres : chaque paramètre de chaque exercice
// du registre a un rendu, et changer un paramètre garde les autres valides.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PARAM_TYPES, defaults } from './exercises/contract';
import { EXERCISES } from './exercises';
import { TABLES } from './exercises/tables';
import { FORM_CONTROLS, rangeTop, setParam, steps } from './form';

test('chaque type du contrat a un rendu, et chaque paramètre de chaque exercice aussi', () => {
  assert.deepEqual(Object.keys(FORM_CONTROLS).sort(), [...PARAM_TYPES].sort());
  for (const e of EXERCISES) for (const d of e.params) assert.ok(FORM_CONTROLS[d.type], `${e.id}.${d.key} : type « ${d.type} » sans rendu dans le formulaire`);
});

test('baisser la dernière table ramène les tables travaillées dans la plage', () => {
  let p = setParam(TABLES, defaults(TABLES), 'max', 12);
  p = setParam(TABLES, p, 'tables', [8, 12]);
  assert.deepEqual(p['tables'], [8, 12]);
  p = setParam(TABLES, p, 'max', 10);
  assert.deepEqual(p['tables'], [8, 10]);
});

test('la première borne ne passe jamais après la seconde', () => {
  const p = setParam(TABLES, defaults(TABLES), 'tables', [7, 3]);
  assert.deepEqual(p['tables'], [7, 7]);
});

test('les valeurs proposées suivent les bornes', () => {
  assert.deepEqual(steps(10, 12), [10, 11, 12]);
  const d = TABLES.params.find((x) => x.type === 'range')!;
  assert.equal(d.type === 'range' && rangeTop(d, { max: 11 }), 11);
});
