// La charpente du document du foyer, vérifiée avant enregistrement.
//
// `PUT /api/state` n'exigeait qu'un objet. Tout le reste passait : un tableau
// remplacé par un nombre, quatre mégaoctets de structures arbitraires, un
// identifiant qui n'est pas du texte. Ce n'est pas une fuite, c'est une casse :
// le frontend porte toute la logique métier, et il devient illisible pour toute
// la famille jusqu'à ce que quelqu'un restaure une sauvegarde.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StateInvalide, validateState } from '../src/state/validate';

const refus = (doc: unknown, motif: RegExp): void => {
  assert.throws(() => validateState(doc), (e: Error) => e instanceof StateInvalide && motif.test(e.message),
    `attendu un refus sur ${JSON.stringify(doc).slice(0, 80)}`);
};

describe('ce qui n’a pas la bonne forme est refusé, en le disant', () => {
  it('un document qui n’est pas un objet', () => {
    for (const v of [null, 42, 'texte', [], true]) refus(v, /doit être un objet/);
  });

  it('une collection remplacée par autre chose', () => {
    refus({ members: 42 }, /« members » doit être une liste, reçu un nombre/);
    refus({ events: 'plein' }, /« events » doit être une liste, reçu du texte/);
    refus({ tasks: { a: 1 } }, /« tasks » doit être une liste, reçu un objet/);
  });

  it('une table remplacée par une liste', () => {
    refus({ meals: [] }, /« meals » doit être un objet, reçu une liste/);
    refus({ prefs: 'non' }, /« prefs » doit être un objet/);
  });

  it('une fiche qui n’en est pas une, avec son rang', () => {
    refus({ members: [{ id: 'm1' }, 'pas une fiche'] }, /« members » : l'entrée 2 n'est pas une fiche/);
    refus({ contacts: [null] }, /l'entrée 1 n'est pas une fiche/);
  });

  it('un identifiant qui n’est pas du texte : chaque rapprochement casserait', () => {
    refus({ members: [{ id: 'm1' }, { id: 7 }] }, /« members » : l'entrée 2 a un identifiant qui n'est pas du texte/);
  });

  it('le nom du foyer, et sa longueur', () => {
    refus({ familyName: 12 }, /« familyName » doit être du texte/);
    refus({ familyName: 'x'.repeat(201) }, /dépasse 200 caractères/);
  });

  it('une collection démesurée est bornée, en disant le maximum', () => {
    refus({ members: Array.from({ length: 101 }, (_, i) => ({ id: 'm' + i })) },
      /« members » contient 101 entrées, au-delà du maximum de 100/);
  });

  it('le refus nomme le champ : « document invalide » n’aide personne', () => {
    assert.throws(() => validateState({ aisles: 3 }), (e: Error) => /aisles/.test(e.message));
  });
});

describe('ce qui a la bonne forme passe', () => {
  it('un document vide : un foyer qui vient de naître', () => {
    validateState({});
  });

  it('un document complet et ordinaire', () => {
    validateState({
      familyName: 'Prudhomme',
      members: [{ id: 'me', name: 'Thomas' }, { id: 'm1', name: 'Lena', enfant: true }],
      events: [{ id: 'e1', title: 'Car scolaire', date: '2026-09-07' }],
      meals: { '2026-09-07-soir': { plat: 'gratin' } },
      stock: { farine: '2026-09-01' },
      settings: { dark: false },
      prefs: { me: { dark: true } },
      tasks: [], contacts: [], files: [], recipes: [], sched: [],
    });
  });

  it('les collections absentes ou nulles ne sont pas un défaut', () => {
    validateState({ members: undefined, events: null, familyName: 'Foyer' });
  });

  it('les clés inconnues passent : le document a une histoire', () => {
    // Refuser ce qu'on ne connaît pas bloquerait un client d'une version plus
    // récente que le serveur, et les migrations retirent déjà ces clés au fil
    // de l'eau.
    validateState({ familyName: 'Foyer', champDunAutreTemps: { quoi: 'que ce soit' } });
  });
});
