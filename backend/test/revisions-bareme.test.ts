// Le barème du module Révisions : le temps accordé selon l'âge, la surcharge d'un
// programme, les couches commun puis exercice, la surcharge du foyer, et une
// configuration abîmée qui ne casse rien.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Bareme, ageOn, bareme, layer, timingFor } from '../src/revisions/bareme';

const SHIPPED = path.join(__dirname, '..', 'config', 'revisions', 'bareme.json');
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-bareme-'));
const livre = (ex?: string): Bareme => bareme(tmp(), ex, SHIPPED);
/** Écrit la surcharge du foyer, avec une date de modification qui force la relecture. */
let tic = 0;
const surcharge = (dir: string, contenu: string): void => {
  const f = path.join(dir, 'revisions', 'bareme.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenu);
  const t = new Date(Date.now() + 5000 + 1000 * ++tic); fs.utimesSync(f, t, t);
};

describe('l’âge', () => {
  it('se compte en années révolues, anniversaire compris', () => {
    assert.equal(ageOn('2018-03-12', '2026-10-19'), 8);
    assert.equal(ageOn('2018-10-19', '2026-10-19'), 8);
    assert.equal(ageOn('2018-10-20', '2026-10-19'), 7);
    assert.equal(ageOn(null, '2026-10-19'), null);
    assert.equal(ageOn('n’importe quoi', '2026-10-19'), null);
  });
});

describe('le temps accordé', () => {
  it('suit le barème livré selon l’âge', () => {
    const b = livre();
    assert.deepEqual(timingFor(b, { birthday: '2018-03-12', enfant: true }, '2026-10-19'), { allowedMs: 8000, fastMs: 4000, source: 'bareme', age: 8 });
    assert.equal(timingFor(b, { birthday: '2016-01-01', enfant: true }, '2026-10-19').allowedMs, 6000, '10 ans');
    assert.equal(timingFor(b, { birthday: '2022-01-01', enfant: true }, '2026-10-19').allowedMs, 10000, 'plus jeune que la première ligne : la première');
    assert.deepEqual(timingFor(b, { birthday: '1985-05-05', enfant: true }, '2026-10-19'), { allowedMs: 4000, fastMs: 2000, source: 'bareme', age: 41 });
  });

  it('sans date de naissance : « sans âge » pour un enfant (et la source le dit), le temps adulte pour un adulte', () => {
    const t = timingFor(livre(), { birthday: null, enfant: true }, '2026-10-19');
    assert.equal(t.source, 'sans-age');
    assert.equal(t.allowedMs, 8000);
    assert.deepEqual(timingFor(livre(), { birthday: null }, '2026-10-19'), { allowedMs: 4000, fastMs: 2000, source: 'bareme', age: null });
  });

  it('le programme d’un enfant l’emporte, et le seuil rapide ne dépasse jamais le temps accordé', () => {
    const b = livre();
    assert.deepEqual(timingFor(b, { birthday: '2018-03-12', enfant: true }, '2026-10-19', { secondsAllowed: 10, fastSeconds: null }), { allowedMs: 10000, fastMs: 4000, source: 'programme', age: 8 });
    assert.equal(timingFor(b, { birthday: '2018-03-12', enfant: true }, '2026-10-19', { secondsAllowed: 3, fastSeconds: null }).fastMs, 3000);
    assert.equal(timingFor(b, { birthday: '2018-03-12', enfant: true }, '2026-10-19', { secondsAllowed: null, fastSeconds: null }).source, 'bareme');
  });
});

describe('la surcharge du foyer', () => {
  it('remplace ce qu’elle porte, garde le reste, et se relit sans redémarrer', () => {
    const dir = tmp();
    assert.equal(bareme(dir, 'tables', SHIPPED).maitrise.niveauAcquis, 3);
    surcharge(dir, JSON.stringify({ commun: { maitrise: { niveauAcquis: 4 }, adulte: { accorde: 5 } } }));
    const b = bareme(dir, 'tables', SHIPPED);
    assert.equal(b.maitrise.niveauAcquis, 4);
    assert.equal(b.maitrise.bonnesMin, 3, 'le reste de « maitrise » demeure');
    assert.deepEqual(b.adulte, { accorde: 5, rapide: 2 });
    assert.equal(b.ages.length, 6, 'les âges livrés demeurent');
  });

  it('une valeur illisible est écartée et nommée, les autres s’appliquent', () => {
    const lignes: string[] = [];
    const b = layer(livre(), { maitrise: { niveauAcquis: 9, bonnesMin: 2 }, sansAge: { accorde: 3, rapide: 5 } }, 'surcharge', (l) => lignes.push(l));
    assert.equal(b.maitrise.niveauAcquis, 3);
    assert.equal(b.maitrise.bonnesMin, 2);
    assert.deepEqual(b.sansAge, { accorde: 8, rapide: 4 }, 'rapide au-delà du temps accordé : écarté');
    assert.equal(lignes.length, 2);
    assert.match(lignes.join('\n'), /niveauAcquis/);
  });

  it('un fichier qui n’est pas du JSON laisse le barème livré', () => {
    const dir = tmp();
    surcharge(dir, '{ pas du json');
    assert.deepEqual(bareme(dir, 'tables', SHIPPED), livre('tables'));
  });
});

describe('les couches commun et exercice', () => {
  it('la partie d’un exercice précise le commun pour lui seul', () => {
    const dir = tmp();
    surcharge(dir, JSON.stringify({ exercices: { dictee: { adulte: { accorde: 12, rapide: 6 }, maitrise: { bonnesMin: 2 } } } }));
    const d = bareme(dir, 'dictee', SHIPPED), t = bareme(dir, 'tables', SHIPPED);
    assert.deepEqual(d.adulte, { accorde: 12, rapide: 6 });
    assert.equal(d.maitrise.bonnesMin, 2);
    assert.equal(d.maitrise.niveauAcquis, 3, 'le reste vient du commun');
    assert.deepEqual(t, livre('tables'), 'les autres exercices ne bougent pas');
  });

  it('le commun du foyer passe après la partie livrée d’un exercice, la partie du foyer en dernier', () => {
    const shipped = path.join(tmp(), 'bareme.json');
    fs.writeFileSync(shipped, JSON.stringify({ commun: { adulte: { accorde: 4, rapide: 2 } }, exercices: { x: { adulte: { accorde: 9 } } } }));
    const dir = tmp();
    assert.equal(bareme(dir, 'x', shipped).adulte.accorde, 9, 'livré : l’exercice précise le commun');
    surcharge(dir, JSON.stringify({ commun: { adulte: { accorde: 6 } } }));
    assert.equal(bareme(dir, 'x', shipped).adulte.accorde, 6, 'le commun du foyer l’emporte sur le livré');
    surcharge(dir, JSON.stringify({ commun: { adulte: { accorde: 6 } }, exercices: { x: { adulte: { accorde: 11 } } } }));
    assert.equal(bareme(dir, 'x', shipped).adulte.accorde, 11);
  });
});
