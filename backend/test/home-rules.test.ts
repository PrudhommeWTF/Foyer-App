// Les règles de contexte de l'accueil, telles qu'un fichier écrit à la main
// peut les porter.
//
// Ce fichier est édité par un humain avec un éditeur de texte. Ce qui est
// vérifié ici est donc moins « la règle s'applique » que « une erreur de frappe
// se dit clairement et ne casse rien » : un accueil qui s'affiche de travers
// sans expliquer pourquoi est pire qu'un accueil qui garde ses réglages
// d'origine en le disant.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { DEFAULT_RULES, loadRules, rulesPath, validate } from '../src/home/rules';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-regles-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const ecrire = (contenu: unknown): void =>
  fs.writeFileSync(rulesPath(dir), typeof contenu === 'string' ? contenu : JSON.stringify(contenu));

const valide = {
  moments: [{ id: 'matin', label: 'Matin', from: '07:00' }, { id: 'soir', label: 'Soir', from: '18:00' }],
  typesDeJour: [{ id: 'weekend', label: 'Week-end', quand: 'semaine', jours: [6, 7] }],
  regles: [{ tuile: 'agenda', moments: ['matin'], poids: 30, raison: 'Le matin, la journée d’abord' }],
  seuilRepli: -15,
};

describe('loadRules', () => {
  it('sans fichier, applique les défauts et le dit', () => {
    const o = loadRules(dir);
    assert.equal(o.source, 'defaut');
    assert.deepEqual(o.errors, []);
    assert.equal(o.rules, DEFAULT_RULES);
  });

  it('lit un fichier valide et le dit', () => {
    ecrire(valide);
    const o = loadRules(dir);
    assert.equal(o.source, 'fichier');
    assert.equal(o.rules.regles.length, 1);
    assert.equal(o.rules.seuilRepli, -15);
  });

  it('un JSON illisible ne casse rien, mais ne passe pas inaperçu', () => {
    ecrire('{ ceci n’est pas du JSON');
    const o = loadRules(dir);
    assert.equal(o.source, 'defaut', 'les défauts reprennent la main');
    assert.equal(o.errors.length, 1);
    assert.match(o.errors[0], /JSON illisible/);
  });

  it('une seule règle fautive écarte tout le fichier, plutôt que d’en appliquer la moitié', () => {
    // Un jeu de règles appliqué à moitié donne un écran que personne ne sait
    // expliquer : c'est exactement ce qu'on cherche à éviter.
    ecrire({ ...valide, regles: [...valide.regles, { tuile: 'taches', moments: ['inexistant'], poids: 10 }] });
    const o = loadRules(dir);
    assert.equal(o.source, 'defaut');
    assert.match(o.errors[0], /moment « inexistant » inconnu/);
  });
});

describe('validate', () => {
  it('exige au moins un moment de la journée', () => {
    const { rules, errors } = validate({ ...valide, moments: [] });
    assert.equal(rules, null);
    assert.ok(errors.some((e) => /au moins un/.test(e)));
  });

  it('refuse une heure qui n’en est pas une, en nommant la ligne', () => {
    const { errors } = validate({ ...valide, moments: [{ id: 'x', label: 'X', from: '25:00' }] });
    assert.ok(errors.some((e) => e.startsWith('moments[0]')), errors.join(' | '));
  });

  it('refuse un jour de la semaine hors de 1 à 7', () => {
    const { errors } = validate({ ...valide, typesDeJour: [{ id: 'w', label: 'W', quand: 'semaine', jours: [0, 8] }] });
    assert.ok(errors.some((e) => /typesDeJour\[0\]/.test(e)));
  });

  it('refuse un « quand » qui n’existe pas', () => {
    const { errors } = validate({ ...valide, typesDeJour: [{ id: 'x', label: 'X', quand: 'meteo' }] });
    assert.ok(errors.some((e) => /ferie, vacances, semaine ou emploiDuTemps/.test(e)));
  });

  it('refuse une règle sans poids : une règle sans effet est une règle oubliée', () => {
    const { errors } = validate({ ...valide, regles: [{ tuile: 'agenda' }] });
    assert.ok(errors.some((e) => /« poids »/.test(e)));
  });

  it('accepte une règle sans moment ni jour : elle vaut alors tout le temps', () => {
    const { rules } = validate({ ...valide, regles: [{ tuile: 'agenda', poids: 5 }] });
    assert.equal(rules?.regles.length, 1);
  });
});

describe('règles par défaut', () => {
  it('sont elles-mêmes valides : ce qui est livré doit passer son propre contrôle', () => {
    const { rules, errors } = validate(JSON.parse(JSON.stringify(DEFAULT_RULES)));
    assert.deepEqual(errors, []);
    assert.ok(rules);
  });

  it('couvrent la journée sans trou, du premier moment au dernier', () => {
    const froms = DEFAULT_RULES.moments.map((m) => m.from);
    assert.deepEqual(froms, [...froms].sort(), 'les moments sont dans l’ordre des heures');
  });
});
