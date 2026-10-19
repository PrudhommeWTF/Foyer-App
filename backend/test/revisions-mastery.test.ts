// Le modèle de maîtrise du module Révisions, commun à tous les exercices :
// montée, descente, espacement, acquisition, et l'ordre des réponses qui seul compte.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MasteryCfg, classify, replay, status, step } from '../src/revisions/mastery';

const cfg: MasteryCfg = { espacementJours: [0, 1, 3, 7, 14, 30], descenteSiFaux: 2, niveauAcquis: 3, bonnesMin: 3 };
const jour = (d: number, h = 18): string => new Date(Date.UTC(2026, 9, 19 + d, h, 0, 0)).toISOString();

describe('une réponse', () => {
  it('juste et rapide fait monter un couple dû, et fixe la révision selon le niveau', () => {
    const m = step(undefined, 'bon', jour(0), cfg);
    assert.equal(m.level, 1);
    assert.equal(m.nextAt, jour(1), 'niveau 1 : revoir dans un jour');
    const m2 = step(m, 'bon', jour(1), cfg);
    assert.equal(m2.level, 2);
    assert.equal(m2.nextAt, jour(4), 'niveau 2 : dans trois jours');
    assert.equal(step(m2, 'bon', jour(4), cfg).nextAt, jour(11), 'niveau 3 : dans sept jours');
  });

  it('juste et rapide ne fait pas monter un couple qui n’est pas encore dû', () => {
    let m = step(undefined, 'bon', jour(0), cfg);
    m = step(m, 'bon', jour(0, 19), cfg);
    m = step(m, 'bon', jour(0, 20), cfg);
    assert.equal(m.level, 1, 'trois fois le même soir ne font pas trois niveaux');
    assert.equal(m.good, 3, 'mais les bonnes réponses sont comptées');
  });

  it('juste mais lente ne bouge pas le niveau', () => {
    const m = step(step(undefined, 'bon', jour(0), cfg), 'lent', jour(1), cfg);
    assert.equal(m.level, 1);
    assert.equal(m.nextAt, jour(1), 'toujours dû : à revoir');
    assert.equal(m.lastResult, 'lent');
  });

  it('fausse redescend de deux et rend le couple dû tout de suite', () => {
    let m = step(undefined, 'bon', jour(0), cfg);
    m = step(m, 'bon', jour(1), cfg);
    m = step(m, 'bon', jour(4), cfg);
    assert.equal(m.level, 3);
    const f = step(m, 'faux', jour(5), cfg);
    assert.equal(f.level, 1);
    assert.equal(f.nextAt, jour(5));
    assert.equal(f.wrong, 1);
    assert.equal(step(f, 'faux', jour(5, 19), cfg).level, 0, 'jamais sous zéro');
  });

  it('passée compte comme fausse', () => {
    assert.equal(step(step(undefined, 'bon', jour(0), cfg), 'passe', jour(1), cfg).level, 0);
  });

  it('le niveau plafonne au dernier palier du barème', () => {
    let m;
    for (let d = 0, i = 0; i < 10; i++) { m = step(m, 'bon', jour(d), cfg); d += 40; }
    assert.equal(m!.level, 5);
  });
});

describe('l’état affiché', () => {
  it('« jamais vue » n’est pas « non sue »', () => {
    assert.equal(status(undefined, cfg), 'jamais');
  });

  it('pas assez de données tant qu’il y a moins de réponses que le seuil', () => {
    assert.equal(status(step(undefined, 'bon', jour(0), cfg), cfg), 'peu');
  });

  it('acquise au niveau du barème, avec assez de bonnes réponses et la dernière rapide', () => {
    let m = step(undefined, 'bon', jour(0), cfg);
    m = step(m, 'bon', jour(1), cfg);
    assert.equal(status(m, cfg), 'peu', 'deux réponses sur les trois du seuil : pas assez de données');
    m = step(m, 'bon', jour(4), cfg);
    assert.equal(status(m, cfg), 'acquise', 'niveau 3, trois bonnes, la dernière rapide : quatre jours au plus tôt');
    assert.equal(status(step(m, 'lent', jour(5), cfg), cfg), 'en-cours', 'une réponse lente retire « acquise » sans toucher au niveau');
  });

  it('le seuil d’acquisition se lit dans le barème, pas dans le code', () => {
    let m = step(undefined, 'bon', jour(0), cfg);
    m = step(m, 'bon', jour(1), cfg);
    m = step(m, 'bon', jour(4), cfg);
    assert.equal(status(m, { ...cfg, niveauAcquis: 4 }), 'en-cours');
  });
});

describe('l’ordre', () => {
  it('rejouer dans le désordre donne la même maîtrise que dans l’ordre', () => {
    const r = [{ result: 'bon' as const, at: jour(0) }, { result: 'faux' as const, at: jour(1) }, { result: 'bon' as const, at: jour(2) }, { result: 'bon' as const, at: jour(3) }];
    assert.deepEqual(replay([r[3], r[1], r[0], r[2]], cfg), replay(r, cfg));
  });
});

describe('la correction', () => {
  it('juste et vite : bonne ; juste après le seuil : lente ; fausse ; passée', () => {
    assert.equal(classify(true, '42', 3000, 4000), 'bon');
    assert.equal(classify(true, '42', 4001, 4000), 'lent');
    assert.equal(classify(false, '41', 1000, 4000), 'faux');
    assert.equal(classify(false, null, 9000, 4000), 'passe');
  });
});
