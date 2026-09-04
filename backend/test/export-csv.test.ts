// Une cellule de tableur n'est pas du texte inerte.
//
// Excel et LibreOffice lisent le **contenu** d'une cellule : une valeur qui
// commence par « = », « + », « - », « @ », une tabulation ou un retour chariot y
// est interprétée comme une formule, guillemets ou pas. Les guillemets
// délimitent la cellule, ils n'en changent pas la nature.
//
// Le cas n'est pas théorique dans ce module : le libellé d'une opération vient
// souvent d'un relevé bancaire importé, donc d'une source qu'on ne maîtrise pas.
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';

let db: Database.Database;
let compte: number;

beforeEach(() => {
  db = new Database(':memory:');
  migrateFinances(db);
  repo.initFinancesRepo(db);
  compte = repo.createAccount({ name: 'Compte joint', kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: false, loan: null }).id;
});
afterEach(() => db.close());

const ligneDe = (libelle: string): string => {
  repo.createTransaction({
    accountId: compte, date: '2026-09-01', amount: -1200, kind: 'depense',
    label: libelle, categoryId: null, notes: '', cleared: false,
  });
  return repo.exportCsv().split('\r\n')[1];
};

describe('une formule ne s’exécute pas à l’ouverture du fichier', () => {
  it('la commande classique est désarmée', () => {
    const ligne = ligneDe("=cmd|'/C calc'!A1");
    assert.ok(ligne.includes(`"'=cmd|'/C calc'!A1"`), ligne);
    assert.ok(!ligne.includes('";=cmd'), 'aucune cellule ne doit commencer par un signe égal');
  });

  it('les quatre amorces sont couvertes', () => {
    for (const amorce of ['=', '+', '@']) {
      const ligne = ligneDe(`${amorce}SUM(A1:A9)`);
      assert.ok(ligne.includes(`"'${amorce}SUM(A1:A9)"`), `${amorce} : ${ligne}`);
    }
    // Le tiret aussi, dès que ce qui suit n'est pas un nombre.
    assert.ok(ligneDe('-2+3+cmd|x').includes(`"'-2+3+cmd|x"`));
  });

  it('un libellé ordinaire n’est pas touché', () => {
    const ligne = ligneDe('Supermarché du coin');
    assert.ok(ligne.includes('"Supermarché du coin"'), ligne);
    assert.ok(!ligne.includes("\"'Supermarché"), 'pas d’apostrophe parasite dans un libellé normal');
  });
});

describe('un montant négatif reste un nombre', () => {
  it('les sommes du fichier doivent continuer de fonctionner', () => {
    // C'est le piège de cette correction : « - » est une amorce de formule, mais
    // un montant négatif est le cas ordinaire d'un relevé. Le désarmer le ferait
    // lire comme du texte, et toutes les sommes du fichier tomberaient à zéro.
    const ligne = ligneDe('Assurance habitation');
    assert.ok(ligne.includes('"-12.00"'), ligne);
    assert.ok(!ligne.includes(`"'-12.00"`), 'un montant ne doit pas devenir du texte');
  });

  it('un nombre signé écrit dans un libellé passe aussi', () => {
    assert.ok(ligneDe('-38,11').includes('"-38,11"'));
    assert.ok(ligneDe('+42').includes('"+42"'));
  });
});

describe('le format reste lisible par un tableur français', () => {
  it('BOM, point-virgule, guillemets doublés', () => {
    const ligne = ligneDe('Libellé "curieux" ; avec séparateur');
    assert.ok(repo.exportCsv().startsWith('﻿'));
    assert.ok(ligne.includes('"Libellé ""curieux"" ; avec séparateur"'), ligne);
  });
});
