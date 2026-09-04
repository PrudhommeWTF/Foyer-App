// Export et import de la configuration du foyer.
//
// La promesse à tenir est celle de la recette : « j'exporte, je change trois
// réglages, je réimporte, je retrouve exactement l'état précédent ». Exactement,
// pas approximativement : c'est ce qui distingue un filet de sécurité d'une
// fausse assurance.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateHousehold } from '../src/storage/schema';
import { initDoc, readDoc } from '../src/state/doc';
import { ImportRefused, exportConfig, importConfig } from '../src/settings/backup';
import { applySettings, readSettings } from '../src/settings/repo';
import { householdDefaults, memberDefaults } from '../src/settings/registry';

let db: Database.Database;

const doc = () => readDoc().doc as Record<string, any>;

beforeEach(() => {
  db = new Database(':memory:');
  migrateHousehold(db);
  db.exec("CREATE TABLE IF NOT EXISTS household (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.prepare('INSERT INTO household (id, state, version) VALUES (1, ?, 1)').run(JSON.stringify({
    familyName: 'Prudhomme',
    members: [{ id: 'me', name: 'Thomas' }, { id: 'm1', name: 'Claire' }],
    settings: householdDefaults(),
    prefs: { me: memberDefaults(), m1: memberDefaults() },
  }));
  initDoc(db);
});

afterEach(() => db.close());

describe('export de la configuration', () => {
  it('porte toutes les clés, valeurs par défaut comprises', () => {
    const dump = exportConfig('1.2.3');
    assert.deepEqual(Object.keys(dump.settings).sort(), Object.keys(householdDefaults()).sort(),
      'sans les clés au défaut, réimporter ne ramènerait pas l’état d’avant');
    assert.deepEqual(Object.keys(dump.prefs).sort(), ['m1', 'me']);
    assert.deepEqual(Object.keys(dump.prefs['me'].values).sort(), Object.keys(memberDefaults()).sort());
  });

  it('se reconnaît six mois plus tard : foyer, date, version', () => {
    const dump = exportConfig('1.2.3', '2026-09-04T10:00:00.000Z');
    assert.equal(dump.format, 'foyer.reglages');
    assert.equal(dump.version, 1);
    assert.equal(dump.household, 'Prudhomme');
    assert.equal(dump.appVersion, '1.2.3');
    assert.equal(dump.generatedAt, '2026-09-04T10:00:00.000Z');
    assert.equal(dump.prefs['m1'].name, 'Claire', 'le prénom rend le fichier lisible à l’oeil');
  });

  it('les préférences exportées sont bien celles de chacun', () => {
    applySettings({ dark: true }, 'm1', false);
    const dump = exportConfig('1.2.3');
    assert.equal(dump.prefs['m1'].values['dark'], true);
    assert.equal(dump.prefs['me'].values['dark'], false);
  });
});

describe('import : le cas de la recette', () => {
  it('j’exporte, je change trois réglages, je réimporte : je retrouve exactement l’état précédent', () => {
    applySettings({ academie: 'Rennes' }, 'me', true);
    applySettings({ dark: true }, 'me', false);
    const avant = exportConfig('1.2.3');
    const etatAvant = JSON.stringify({ s: readSettings('me').values, c: readSettings('m1').values });

    // Trois modifications, de portées différentes.
    applySettings({ academie: 'Paris', showBreakfast: true }, 'me', true);
    applySettings({ dark: false }, 'me', false);
    assert.notEqual(JSON.stringify({ s: readSettings('me').values, c: readSettings('m1').values }), etatAvant);

    const rapport = importConfig(avant, 'me');
    assert.deepEqual(rapport.ecartes, []);
    assert.equal(JSON.stringify({ s: readSettings('me').values, c: readSettings('m1').values }), etatAvant,
      'l’état doit être exactement celui d’avant, réglages du foyer et préférences de chacun');
  });

  it('rejouer le même import ne change plus rien', () => {
    applySettings({ academie: 'Rennes' }, 'me', true);
    const dump = exportConfig('1.2.3');
    importConfig(dump, 'me');
    const second = importConfig(dump, 'me');
    assert.deepEqual(second.applied, [], 'rien à réappliquer : l’import est rejouable sans effet de bord');
  });

  it('le journal nomme celui qui a fait le geste, pas celui dont on restaure les préférences', () => {
    applySettings({ dark: true }, 'm1', false);
    const dump = exportConfig('1.2.3');
    applySettings({ dark: false }, 'm1', false);
    importConfig(dump, 'me');
    const ligne = db.prepare('SELECT key, member_id FROM hh_settings_log ORDER BY id DESC LIMIT 1').get() as { key: string; member_id: string };
    assert.equal(ligne.key, 'dark');
    assert.equal(ligne.member_id, 'me', 'c’est l’administrateur qui a importé');
  });
});

describe('import : ce qu’il refuse, et ce qu’il écarte', () => {
  it('refuse franchement un fichier qui n’en est pas un', () => {
    assert.throws(() => importConfig({ format: 'autre-chose' }, 'me'), ImportRefused);
    assert.throws(() => importConfig(null, 'me'), ImportRefused);
    assert.throws(() => importConfig('{}', 'me'), ImportRefused);
  });

  it('refuse une version qu’il ne sait pas lire, plutôt que d’en appliquer la moitié', () => {
    assert.throws(() => importConfig({ format: 'foyer.reglages', version: 99 }, 'me'),
      (e: Error) => e instanceof ImportRefused && /version 99/.test(e.message));
  });

  it('écarte ligne à ligne, et applique le reste', () => {
    const rapport = importConfig({
      format: 'foyer.reglages', version: 1, generatedAt: '', household: 'Prudhomme',
      settings: { academie: 'Rennes', reglageDisparu: true, showBreakfast: 'peut-être' },
      prefs: { me: { name: 'Thomas', values: { dark: true } } },
    }, 'me');
    assert.deepEqual(rapport.applied.sort(), ['academie', 'dark (Thomas)']);
    assert.deepEqual(rapport.ecartes.map((e) => e.key).sort(), ['reglageDisparu', 'showBreakfast']);
    assert.match(rapport.ecartes.find((e) => e.key === 'reglageDisparu')!.reason, /n’existe plus/);
    assert.equal(doc()['settings']['academie'], 'Rennes', 'ce qui pouvait passer est bien passé');
  });

  it('un membre disparu est écarté en le nommant, sans bloquer les autres', () => {
    const rapport = importConfig({
      format: 'foyer.reglages', version: 1, generatedAt: '', household: '',
      settings: {},
      prefs: {
        me: { name: 'Thomas', values: { dark: true } },
        parti: { name: 'Grand-père', values: { dark: true } },
      },
    }, 'me');
    assert.deepEqual(rapport.applied, ['dark (Thomas)']);
    assert.deepEqual(rapport.ecartes, [{ key: '(toutes)', member: 'Grand-père', reason: 'ce membre n’existe plus dans le foyer' }]);
  });

  it('un réglage imposé par l’environnement est écarté, pas écrasé', () => {
    process.env.FOYER_ALLOW_SIGNUP = 'false';
    try {
      const rapport = importConfig({
        format: 'foyer.reglages', version: 1, generatedAt: '', household: '',
        settings: { signupAllowed: true }, prefs: {},
      }, 'me');
      assert.deepEqual(rapport.applied, []);
      assert.match(rapport.ecartes[0].reason, /FOYER_ALLOW_SIGNUP/);
    } finally { delete process.env.FOYER_ALLOW_SIGNUP; }
  });

  it('un fichier vide s’importe sans rien casser', () => {
    const rapport = importConfig({ format: 'foyer.reglages', version: 1 }, 'me');
    assert.deepEqual(rapport.applied, []);
    assert.deepEqual(rapport.ecartes, []);
  });
});
