// La surface HTTP des réglages, bout en bout.
//
// Ce qui compte ici n'est pas qu'un bouton soit caché : c'est que **le serveur
// refuse**. Un membre non administrateur qui appelle l'API directement, depuis
// un terminal ou une extension de navigateur, doit se voir opposer un 403, et
// le document ne doit pas bouger d'un octet.
//
// Le reste éprouve l'autre promesse de la tranche : l'écriture est ciblée. Deux
// administrateurs qui règlent deux choses à la même seconde repartent avec les
// deux réglages, pas avec celui du dernier qui a parlé.
import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import express, { Request } from 'express';
import { migrateHousehold } from '../src/storage/schema';
import { initDoc, readDoc } from '../src/state/doc';
import { settingsRouter } from '../src/settings/routes';
import { declOf, householdDefaults, memberDefaults } from '../src/settings/registry';
import { deploymentView, envOverrides, envValueOf, foreignPrefsChanged, settingsChanged } from '../src/settings/repo';

let server: http.Server;
let base: string;
let db: Database.Database;
/** Qui appelle : l'en-tête « x-essai-role » suffit, l'authentification est éprouvée ailleurs. */
let env: Record<string, string | undefined>;

const appel = async (method: string, role: string, body?: unknown): Promise<{ status: number; json: any }> => {
  const res = await fetch(base + '/settings', {
    method,
    headers: { 'content-type': 'application/json', 'x-essai-role': role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
};

const reglages = (): Record<string, unknown> => (readDoc().doc['settings'] || {}) as Record<string, unknown>;
const prefsDe = (id: string): Record<string, unknown> => ((readDoc().doc['prefs'] || {})[id] || {}) as Record<string, unknown>;

beforeEach(async () => {
  db = new Database(':memory:');
  migrateHousehold(db);
  db.exec("CREATE TABLE IF NOT EXISTS household (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.prepare('INSERT INTO household (id, state, version) VALUES (1, ?, 1)').run(JSON.stringify({
    familyName: 'Essai',
    members: [{ id: 'm-admin' }, { id: 'm-adulte' }],
    settings: householdDefaults(),
    prefs: { 'm-admin': memberDefaults(), 'm-adulte': memberDefaults() },
  }));
  initDoc(db);
  env = {};

  const app = express();
  const role = (req: Request): string => String(req.headers['x-essai-role'] || 'enfant');
  app.use('/api/settings', settingsRouter({
    memberId: (req) => (role(req) === 'anonyme' ? null : 'm-' + role(req)),
    isAdmin: (req) => role(req) === 'admin',
    isChild: (req) => role(req) === 'enfant',
    overrides: () => envOverrides(env),
    deployment: () => deploymentView(env),
    appVersion: () => '1.2.3',
  }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api';
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  db.close();
});

describe('réglages : qui a le droit', () => {
  it('un membre non administrateur peut lire les réglages', async () => {
    const { status, json } = await appel('GET', 'adulte');
    assert.equal(status, 200);
    assert.equal(json.canEdit, false, 'canEdit ne parle que des réglages du foyer');
    assert.equal(json.values.showBreakfast, false);
    assert.ok(Array.isArray(json.registry) && json.registry.length, 'la page est engendrée depuis ce qui est renvoyé ici');
    assert.equal('envPort' in json.values, false, 'un réglage de déploiement ne se mêle pas aux valeurs du document');
  });

  it('un membre non administrateur se voit refuser un réglage du foyer, et le document ne bouge pas', async () => {
    const avant = JSON.stringify(reglages());
    const { status, json } = await appel('PATCH', 'adulte', { changes: { showBreakfast: true } });
    assert.equal(status, 403);
    assert.match(json.error, /administrateur/i);
    assert.equal(JSON.stringify(reglages()), avant, 'un refus ne doit rien écrire du tout');
  });

  it('un administrateur écrit un réglage du foyer, et la valeur est bien dans le document', async () => {
    const { status, json } = await appel('PATCH', 'admin', { changes: { showBreakfast: true, academie: 'Rennes' } });
    assert.equal(status, 200);
    assert.deepEqual(json.changed.sort(), ['academie', 'showBreakfast']);
    assert.equal(reglages()['showBreakfast'], true);
    assert.equal(reglages()['academie'], 'Rennes');
  });
});

describe('réglages : les préférences personnelles', () => {
  it('un membre non administrateur écrit les siennes sans rien demander à personne', async () => {
    const { status, json } = await appel('PATCH', 'adulte', { changes: { dark: true } });
    assert.equal(status, 200);
    assert.deepEqual(json.changed, ['dark']);
    assert.equal(prefsDe('m-adulte')['dark'], true);
  });

  it('la préférence de l’un ne touche pas celle de l’autre', async () => {
    await appel('PATCH', 'adulte', { changes: { dark: true } });
    assert.equal(prefsDe('m-adulte')['dark'], true);
    assert.equal(prefsDe('m-admin')['dark'], false, 'le thème de l’un n’impose rien à l’autre');
  });

  it('chacun lit ses propres valeurs', async () => {
    await appel('PATCH', 'adulte', { changes: { dark: true } });
    assert.equal((await appel('GET', 'adulte')).json.values.dark, true);
    assert.equal((await appel('GET', 'admin')).json.values.dark, false);
  });

  it('un compte sans fiche de membre ne peut pas écrire de préférence, et on lui dit pourquoi', async () => {
    const { status, json } = await appel('PATCH', 'anonyme', { changes: { dark: true } });
    assert.equal(status, 403);
    assert.match(json.error, /rattaché à aucun membre/);
  });

  it('un lot mélangeant foyer et personnel est refusé en entier pour un non-administrateur', async () => {
    const { status } = await appel('PATCH', 'adulte', { changes: { dark: true, showBreakfast: true } });
    assert.equal(status, 403);
    assert.equal(prefsDe('m-adulte')['dark'], false, 'la préférence licite du lot n’est pas écrite non plus');
  });
});

describe('réglages : ce qui est refusé, et ce que le refus explique', () => {
  it('une clé inconnue est refusée avec son nom', async () => {
    const { status, json } = await appel('PATCH', 'admin', { changes: { nImporteQuoi: true } });
    assert.equal(status, 422);
    assert.match(json.error, /nImporteQuoi/);
  });

  it('une valeur hors domaine est refusée, et rien du lot n’est écrit', async () => {
    const { status, json } = await appel('PATCH', 'admin', { changes: { showBreakfast: true, academie: 'Marseille' } });
    assert.equal(status, 422);
    assert.equal(json.refused[0].key, 'academie');
    assert.equal(reglages()['showBreakfast'], false, 'un lot est tout ou rien : le réglage valide du même lot n’est pas écrit');
  });

  it('un corps mal formé le dit plutôt que de ne rien faire en silence', async () => {
    assert.equal((await appel('PATCH', 'admin', { changes: [1, 2] })).status, 400);
    assert.equal((await appel('PATCH', 'admin', {})).status, 400);
  });
});

describe('réglages : deux administrateurs à la fois', () => {
  it('chacun n’écrit que sa clé, aucun ne perd celle de l’autre', async () => {
    await appel('PATCH', 'admin', { changes: { academie: 'Rennes' } });
    await appel('PATCH', 'admin', { changes: { showBreakfast: true } });
    assert.equal(reglages()['academie'], 'Rennes', 'le premier réglage a survécu au second');
    assert.equal(reglages()['showBreakfast'], true);
  });

  it('réécrire la même valeur ne fait pas tourner la version du document', async () => {
    await appel('PATCH', 'admin', { changes: { showBreakfast: true } });
    const version = readDoc().version;
    const { json } = await appel('PATCH', 'admin', { changes: { showBreakfast: true } });
    assert.deepEqual(json.changed, [], 'rien n’a changé, donc rien n’est écrit');
    assert.equal(readDoc().version, version, 'les autres appareils n’ont aucune raison de se recharger');
  });
});

describe('réglages : le journal des modifications', () => {
  it('retient qui a changé quoi, et de quelle valeur vers quelle valeur', async () => {
    await appel('PATCH', 'admin', { changes: { showBreakfast: true } });
    const { json } = await appel('GET', 'admin');
    const ligne = json.log[0];
    assert.equal(ligne.key, 'showBreakfast');
    assert.equal(ligne.label, 'Afficher le petit-déjeuner', 'le journal est lisible sans connaître les clés');
    assert.equal(ligne.before, false);
    assert.equal(ligne.after, true);
    assert.equal(ligne.memberId, 'm-admin');
    assert.ok(ligne.at, 'une modification sans date ne réglerait aucune discussion');
  });

  it('une préférence personnelle est journalisée elle aussi, au nom de son membre', async () => {
    await appel('PATCH', 'adulte', { changes: { dark: true } });
    const { json } = await appel('GET', 'admin');
    assert.equal(json.log[0].key, 'dark');
    assert.equal(json.log[0].memberId, 'm-adulte');
  });

  it('une écriture refusée ne laisse aucune trace', async () => {
    await appel('PATCH', 'adulte', { changes: { showBreakfast: true } });
    await appel('PATCH', 'admin', { changes: { academie: 'Marseille' } });
    const { json } = await appel('GET', 'admin');
    assert.deepEqual(json.log, []);
  });
});

describe('réglages : ce que l’environnement impose', () => {
  it('sans variable posée, rien n’est imposé', async () => {
    const { json } = await appel('GET', 'admin');
    assert.deepEqual(json.overrides, {});
  });

  it('une variable posée est signalée à la clé qu’elle écrase, avec sa valeur', async () => {
    env['FOYER_ALLOW_SIGNUP'] = 'false';
    const { json } = await appel('GET', 'admin');
    assert.deepEqual(json.overrides, { signupAllowed: 'false' },
      'l’interface a besoin du nom ET de la valeur pour expliquer le champ grisé');
  });

  it('la valeur renvoyée est celle qui s’applique, pas celle rangée dans le document', async () => {
    // Le foyer a délibérément allumé l'inscription ; la machine, elle, l'impose
    // éteinte. C'est le seul montage où les deux valeurs diffèrent, donc le seul
    // qui prouve laquelle des deux l'écran affiche.
    await appel('PATCH', 'admin', { changes: { signupAllowed: true } });
    process.env.FOYER_ALLOW_SIGNUP = 'false';
    env['FOYER_ALLOW_SIGNUP'] = 'false';
    try {
      const { json } = await appel('GET', 'admin');
      assert.equal(json.values.signupAllowed, false,
        'sinon l’écran montre un interrupteur allumé sous une explication disant qu’il est éteint');
      assert.equal(reglages()['signupAllowed'], true, 'le document, lui, garde ce que le foyer avait choisi');
    } finally { delete process.env.FOYER_ALLOW_SIGNUP; }
  });

  it('un réglage imposé par l’environnement est refusé à l’écriture, en nommant la variable', async () => {
    // Posé avant que la variable n'arrive : ce que le document garde ensuite
    // montre que l'écriture refusée n'a rien changé.
    await appel('PATCH', 'admin', { changes: { signupAllowed: true } });
    env['FOYER_ALLOW_SIGNUP'] = 'false';
    process.env.FOYER_ALLOW_SIGNUP = 'false';
    try {
      const { status, json } = await appel('PATCH', 'admin', { changes: { signupAllowed: true } });
      assert.equal(status, 403);
      assert.match(json.error, /FOYER_ALLOW_SIGNUP/);
      assert.equal(reglages()['signupAllowed'], true, 'rien n’est rangé dans le document : ce serait une valeur sans effet');
    } finally { delete process.env.FOYER_ALLOW_SIGNUP; }
  });

  it('les réglages du serveur sont affichés, et jamais les secrets', async () => {
    env['FOYER_DATA_DIR'] = '/var/lib/foyer';
    env['FOYER_JWT_SECRET'] = 'un-secret-tres-long-et-aleatoire';
    const { json } = await appel('GET', 'admin');
    const par = Object.fromEntries(json.deployment.map((d: { key: string }) => [d.key, d]));
    assert.deepEqual(par['envDataDir'], { key: 'envDataDir', value: '/var/lib/foyer', set: true });
    assert.deepEqual(par['envJwtSecret'], { key: 'envJwtSecret', value: '', set: true },
      'un secret posé se signale, mais ne se relit jamais');
    assert.equal(par['envPort'].set, false, 'non posée : c’est la valeur par défaut qui s’applique');
    assert.equal(par['envPort'].value, '8099');
  });
});

describe('réglages : la lecture de l’environnement', () => {
  const signup = declOf('signupAllowed')!;

  it('une variable absente ou vide ne dit rien', () => {
    assert.equal(envValueOf(signup, {}), null);
    assert.equal(envValueOf(signup, { FOYER_ALLOW_SIGNUP: '' }), null, 'on la pose pour imposer une valeur, pas le vide');
  });

  it('coupe sur les valeurs qu’un administrateur écrit réellement', () => {
    for (const v of ['false', 'FALSE', '0', 'no', 'off']) {
      assert.equal(envValueOf(signup, { FOYER_ALLOW_SIGNUP: v }), false, v);
    }
  });

  it('ne coupe pas sur une valeur affirmative', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', 'on']) {
      assert.equal(envValueOf(signup, { FOYER_ALLOW_SIGNUP: v }), true, v);
    }
  });

  it('une valeur hors domaine est ignorée plutôt que d’imposer n’importe quoi', () => {
    const url = declOf('publicUrl')!;
    const trop = 'https://' + 'x'.repeat(400);
    assert.equal(envValueOf(url, { FOYER_PUBLIC_URL: trop }), null);
    assert.equal(envValueOf(url, { FOYER_PUBLIC_URL: 'https://foyer.exemple.fr' }), 'https://foyer.exemple.fr');
  });
});

describe('réglages : la porte de PUT /api/state', () => {
  const base = householdDefaults();

  it('un enregistrement qui ne touche à rien passe', () => {
    assert.equal(settingsChanged(base, { ...base }), false);
  });

  it('un enregistrement qui change un réglage du foyer est détecté', () => {
    assert.equal(settingsChanged(base, { ...base, showBreakfast: true }), true);
    assert.equal(settingsChanged(base, { ...base, academie: 'Rennes' }), true);
  });

  it('retirer une clé déclarée compte aussi comme une modification', () => {
    const sans = { ...base };
    delete (sans as Record<string, unknown>)['showBreakfast'];
    assert.equal(settingsChanged(base, sans), true);
  });

  it('une préférence personnelle glissée dans « settings » ne fait pas refuser la sauvegarde', () => {
    // Elle ne s'écrit pas par là de toute façon : le serveur remet le bloc
    // d'avant. Ce qui compte est de ne pas transformer un vieux client bavard
    // en compte qui ne peut plus rien enregistrer.
    assert.equal(settingsChanged(base, { ...base, dark: true }), false);
  });

  it('une clé retirée du registre ne fait pas refuser les sauvegardes d’un vieux document', () => {
    // « dateFmt » a existé, puis a été retiré : les documents d'avant le portent
    // encore. Si le garde s'en émouvait, ce foyer ne pourrait plus rien
    // enregistrer du tout.
    assert.equal(settingsChanged({ ...base, dateFmt: 'AAAA-MM-JJ' }, { ...base }), false);
    assert.equal(settingsChanged({ ...base }, { ...base, dateFmt: 'AAAA-MM-JJ' }), false);
  });

  it('un document sans réglages du tout est comparé au défaut sans planter', () => {
    assert.equal(settingsChanged(undefined, undefined), false);
    assert.equal(settingsChanged(null, { showBreakfast: true }), true);
  });
});

describe('réglages : les préférences des autres, dans PUT /api/state', () => {
  const prefs = { 'm-admin': { dark: false }, 'm-adulte': { dark: false } };

  it('modifier les siennes est licite', () => {
    assert.equal(foreignPrefsChanged(prefs, { ...prefs, 'm-adulte': { dark: true } }, 'm-adulte'), false);
  });

  it('modifier celles d’un autre est détecté, même pour un administrateur', () => {
    assert.equal(foreignPrefsChanged(prefs, { ...prefs, 'm-adulte': { dark: true } }, 'm-admin'), true);
  });

  it('en ajouter pour quelqu’un d’autre, ou lui en retirer, est détecté aussi', () => {
    assert.equal(foreignPrefsChanged(prefs, { ...prefs, 'm-tiers': { dark: true } }, 'm-adulte'), true);
    assert.equal(foreignPrefsChanged(prefs, { 'm-adulte': { dark: false } }, 'm-adulte'), true);
  });

  it('un document sans préférences ne bloque rien', () => {
    assert.equal(foreignPrefsChanged(undefined, undefined, 'm-adulte'), false);
    assert.equal(foreignPrefsChanged(undefined, { 'm-adulte': { dark: true } }, 'm-adulte'), false);
  });
});

describe('réglages : un enfant n’entre pas', () => {
  it('même en lecture, l’API lui répond 403', async () => {
    const { status, json } = await appel('GET', 'enfant');
    assert.equal(status, 403);
    assert.match(json.error, /pas accessibles depuis ce compte/);
  });

  it('et il ne peut pas écrire ses propres préférences par cette porte', async () => {
    const { status } = await appel('PATCH', 'enfant', { changes: { dark: true } });
    assert.equal(status, 403);
    assert.equal(prefsDe('m-enfant')['dark'], undefined, 'rien n’a été écrit');
  });

  it('ni exporter la configuration du foyer', async () => {
    const res = await fetch(base + '/settings/export', { headers: { 'x-essai-role': 'enfant' } });
    assert.equal(res.status, 403);
  });
});
