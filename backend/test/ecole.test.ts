// Module École, de bout en bout : les vraies routes de src/server.ts, leurs
// vrais gardes, et un faux serveur ÉcoleDirecte local. On y rejoue la recette
// de la première tranche : saisir un compte, répondre une fois à la question de
// sécurité, retrouver les élèves associés d'après leur prénom, ne plus jamais
// revoir la question ; et tout ce qui doit casser proprement (505, 517, pannes
// répétées, clé de chiffrement changée), sans jamais marteler le serveur.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
import { FauxEd, fauxEcoleDirecte } from './ecole-faux-serveur';

const CLE = 'cle-de-chiffrement-de-test-de-plus-de-32-caracteres';
const MDP = 'mot de passe & 100%';

describe('École : configuration ÉcoleDirecte (HTTP)', () => {
  let ctx: Contexte;
  let ed: FauxEd;
  let svc: typeof import('../src/ecole/service');
  let sql: typeof import('../src/db')['db'];
  let wall: typeof import('../src/notify/reminders')['parisWall'];

  before(async () => {
    ed = await fauxEcoleDirecte();
    process.env.FOYER_SECRET_KEY = CLE;
    process.env.FOYER_ED_API_BASE = ed.base;
    ctx = await demarrer();
    // Après demarrer : src/db.ts ouvre la base au chargement, d'après l'environnement.
    svc = await import('../src/ecole/service');
    sql = (await import('../src/db')).db;
    wall = (await import('../src/notify/reminders')).parisWall;
  });
  after(async () => { await arreter(ctx); await ed.fermer(); });

  const A = () => ctx.jetons.admin;
  /** Un instant de semaine, en journée à Paris, au moins `minutes` après maintenant : hors de toute pause. */
  const jourOuvre = (minutes: number): Date => {
    for (let t = Date.now() + minutes * 60_000; ; t += 15 * 60_000) {
      const w = wall(new Date(t));
      const h = Number(w.slice(11, 13));
      if (new Date(w.slice(0, 10) + 'T00:00:00Z').getUTCDay() !== 0 && h >= 9 && h < 20) return new Date(t);
    }
  };
  /** Fait comme si la dernière tentative datait d'hier : le bouton n'attend plus sa minute. */
  const vieillir = (id: number): void => { sql.prepare("UPDATE ed_accounts SET last_sync_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(id); };
  const etat = async () => (await appel(ctx.base, 'GET', '/ecole/etat', undefined, A())).json;
  const compte = async (id: number) => (await etat()).accounts.find((a: { id: number }) => a.id === id);

  let famille = 0;
  let eleve = 0;

  it('module désactivé par défaut : 403, et le planificateur ne fait rien', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/ecole/etat', undefined, A())).status, 403);
    assert.equal(await svc.ecoleTick(jourOuvre(0)), 0);
    assert.equal(ed.requetes.length, 0, 'aucune requête vers ÉcoleDirecte');
  });

  it('activé : réservé aux administrateurs', async () => {
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { modEcole: true } }, A())).status, 200);
    assert.equal((await appel(ctx.base, 'GET', '/ecole/etat', undefined, A())).status, 200);
    assert.equal((await appel(ctx.base, 'GET', '/ecole/etat', undefined, ctx.jetons.membre)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', '/ecole/etat', undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'POST', '/ecole/comptes', { label: 'x', identifiant: 'x', motdepasse: 'x' }, ctx.jetons.membre)).status, 403);
  });

  it('nouveau compte : la question de sécurité s’affiche en clair, et rien d’autre ne part', async () => {
    const r = await appel(ctx.base, 'POST', '/ecole/comptes', { label: 'Collège', identifiant: 'parent.famille', motdepasse: MDP }, A());
    assert.equal(r.status, 201, JSON.stringify(r.json));
    famille = r.json.account.id;
    assert.equal(r.json.result.kind, 'qcm');
    assert.equal(r.json.result.question, 'Quelle est la ville de naissance de votre enfant ?');
    assert.deepEqual(r.json.result.propositions, ['PARIS', 'RENNES', 'SAINT-ÉTIENNE', 'LYON']);
    assert.equal(r.json.account.state, 'qcm');
    assert.ok(r.json.account.alertedAt, 'les administrateurs sont prévenus');

    const avant = ed.requetes.length;
    assert.equal(await svc.ecoleTick(jourOuvre(60)), 0, 'question en attente : le planificateur ne se connecte pas');
    assert.equal((await appel(ctx.base, 'POST', `/ecole/comptes/${famille}/connexion`, {}, A())).status, 400);
    assert.equal(ed.requetes.length, avant, 'aucune requête tant que la question attend');
  });

  it('mauvaise réponse : refusée, la question reste ; bonne réponse : appareil de confiance, élèves, associations proposées', async () => {
    const faux = await appel(ctx.base, 'POST', `/ecole/comptes/${famille}/qcm`, { choix: 0 }, A());
    assert.equal(faux.json.result.kind, 'erreur');
    assert.match(faux.json.result.message, /refusée/);
    assert.equal(faux.json.account.state, 'qcm');

    // La session du 250 a été perdue avec la mauvaise réponse : Foyer se reconnecte pour reposer la question.
    const bon = await appel(ctx.base, 'POST', `/ecole/comptes/${famille}/qcm`, { choix: 2 }, A());
    assert.equal(bon.json.result.kind, 'ok', JSON.stringify(bon.json));
    const a = bon.json.account;
    assert.equal(a.state, 'ok');
    assert.ok(a.trustedSince, 'appareil de confiance connu depuis…');
    assert.equal(a.pendingQcm, null);
    assert.equal(a.alertedAt, null, 'incident clos');
    assert.deepEqual(a.students.map((s: { firstName: string; className: string; schoolName: string; linkState: string }) => [s.firstName, s.className, s.schoolName, s.linkState]),
      [['Léna', '5EME B', 'COLLEGE EXEMPLE', 'propose'], ['Nolan-Pierre', 'SECONDE A', 'LYCEE EXEMPLE', 'aucun']]);
    const lena = (await appel(ctx.base, 'GET', '/state', undefined, A())).json.state.members.find((m: { name: string }) => m.name === 'Lena');
    assert.equal(a.students[0].memberId, lena.id, 'Léna proposée pour Lena, sans accent ni casse');
  });

  it('aucun secret ne sort des routes, ni de la base en clair', async () => {
    const tout = JSON.stringify(await etat());
    for (const s of ['parent.famille', MDP, 'CN-ANONYME', 'CV-ANONYME', 'tok-']) assert.ok(!tout.includes(s), `« ${s} » ne doit pas sortir`);
    const ligne = JSON.stringify(sql.prepare('SELECT * FROM ed_accounts WHERE id = ?').get(famille));
    for (const s of ['parent.famille', 'mot de passe', 'CN-ANONYME']) assert.ok(!ligne.includes(s), `« ${s} » chiffré en base`);
  });

  it('confirmer d’un tap, associer à la main, ignorer', async () => {
    const a = await compte(famille);
    const [lena, nolan] = a.students;
    const ok = await appel(ctx.base, 'PUT', `/ecole/eleves/${lena.id}`, { action: 'confirmer' }, A());
    assert.equal(ok.json.account.students[0].linkState, 'confirme');
    assert.equal(ok.json.account.students[0].matchSource, 'prenom');
    const membres = (await appel(ctx.base, 'GET', '/state', undefined, A())).json.state.members;
    const camille = membres.find((m: { name: string }) => m.name === 'Camille').id;
    const man = await appel(ctx.base, 'PUT', `/ecole/eleves/${nolan.id}`, { action: 'associer', memberId: camille }, A());
    assert.equal(man.json.account.students[1].matchSource, 'manuel');
    assert.equal((await appel(ctx.base, 'PUT', `/ecole/eleves/${nolan.id}`, { action: 'associer', memberId: 'inconnu' }, A())).status, 400);
    assert.equal((await appel(ctx.base, 'PUT', `/ecole/eleves/${nolan.id}`, { action: 'confirmer' }, A())).status, 400, 'rien à confirmer');
  });

  it('connexions suivantes (redémarrage compris) : l’appareil de confiance part, la question ne revient pas', async () => {
    const avant = ed.connexions('parent.famille').length;
    assert.equal(await svc.ecoleTick(jourOuvre(40)), 1, 'une seule connexion pour le compte dû');
    const apres = ed.connexions('parent.famille');
    assert.equal(apres.length, avant + 1, 'une connexion par passage, pas plus');
    assert.deepEqual(apres.at(-1)!.data!['fa'], [{ cn: 'CN-ANONYME-0123456789', cv: 'CV-ANONYME-9876543210' }]);
    const depuis = ed.requetes.slice(ed.requetes.lastIndexOf(apres.at(-1)!));
    assert.ok(!depuis.some((q) => q.path.includes('doubleauth')), 'pas de double authentification');
    assert.equal((await compte(famille)).state, 'ok');
    const apresCo = await compte(famille);
    assert.ok(Date.parse(apresCo.nextRunAt) - Date.parse(apresCo.lastSyncAt) >= 30 * 60_000, 'pas deux fois dans l’intervalle');
    // Le bouton : une tentative par minute au plus.
    assert.equal((await appel(ctx.base, 'POST', `/ecole/comptes/${famille}/connexion`, {}, A())).status, 429);
  });

  it('identifiants refusés (505) : bloqué, une seule alerte, aucune nouvelle tentative avant ressaisie', async () => {
    const r = await appel(ctx.base, 'POST', '/ecole/comptes', { label: 'École de Camille', identifiant: 'eleve.camille', motdepasse: 'faux' }, A());
    eleve = r.json.account.id;
    assert.equal(r.json.result.kind, 'erreur');
    assert.match(r.json.result.message, /\(505\)/);
    assert.equal(r.json.account.state, 'identifiants');
    assert.equal(r.json.account.lastError.code, 505);
    const alerte = r.json.account.alertedAt;
    assert.ok(alerte);

    vieillir(eleve);
    await svc.ecoleTick(jourOuvre(120));
    assert.equal(ed.connexions('eleve.camille').length, 1, 'aucune retentative automatique');
    assert.equal((await appel(ctx.base, 'POST', `/ecole/comptes/${eleve}/connexion`, {}, A())).status, 400, 'ni à la main');
    assert.equal((await compte(eleve)).alertedAt, alerte, 'une seule alerte');

    const fix = await appel(ctx.base, 'PUT', `/ecole/comptes/${eleve}`, { identifiant: 'eleve.camille', motdepasse: 'bon-mot-de-passe' }, A());
    assert.equal(fix.json.result.kind, 'ok');
    assert.equal(fix.json.account.state, 'ok');
    assert.equal(fix.json.account.accountType, 'eleve');
  });

  it('pannes passagères : trois de suite, pause automatique de 6 h, une alerte, plus rien pendant la pause', async () => {
    ed.panne['eleve.camille'] = '500';
    const n0 = ed.connexions('eleve.camille').length;
    for (let i = 1; i <= 3; i++) { vieillir(eleve); await svc.connect(eleve); }
    assert.equal(ed.connexions('eleve.camille').length, n0 + 3);
    const a = await compte(eleve);
    assert.equal(a.state, 'pause-auto');
    assert.equal(a.consecutiveFailures, 3);
    assert.ok(Date.parse(a.pausedUntil) - Date.now() > 5.9 * 3600_000);
    assert.ok(a.alertedAt);
    assert.match((await etat()).journal[0].message, /pause automatique de 6 h/);

    vieillir(eleve);
    await svc.ecoleTick(new Date(Date.now() + 60_000));
    assert.equal(ed.connexions('eleve.camille').length, n0 + 3, 'en pause : rien ne part');

    delete ed.panne['eleve.camille'];
    await appel(ctx.base, 'POST', `/ecole/comptes/${eleve}/pause`, { pause: false }, A());
    vieillir(eleve);
    const ok = await appel(ctx.base, 'POST', `/ecole/comptes/${eleve}/connexion`, {}, A());
    assert.equal(ok.json.account.state, 'ok');
    assert.equal(ok.json.account.consecutiveFailures, 0);
  });

  it('pause à la main : le planificateur saute le compte', async () => {
    await appel(ctx.base, 'POST', `/ecole/comptes/${eleve}/pause`, { pause: true }, A());
    assert.equal((await compte(eleve)).state, 'pause');
    assert.equal((await compte(eleve)).nextRunAt, null);
    const n = ed.connexions('eleve.camille').length;
    vieillir(eleve);
    await svc.ecoleTick(jourOuvre(300));
    assert.equal(ed.connexions('eleve.camille').length, n);
  });

  it('version d’API refusée (517) : message clair, bloqué, et reprise seule quand la version change', async () => {
    process.env.FOYER_ED_API_VERSION = '1.0.0';
    vieillir(famille);
    const r = await appel(ctx.base, 'POST', `/ecole/comptes/${famille}/connexion`, {}, A());
    assert.equal(r.json.result.kind, 'erreur');
    assert.match(r.json.result.message, /ÉcoleDirecte refuse la version d’API 1\.0\.0 \(517\)/);
    assert.equal(r.json.account.state, 'version');
    assert.ok(r.json.account.lastOkAt, 'la dernière réussite reste datée');
    const n = ed.connexions('parent.famille').length;
    vieillir(famille);
    await svc.ecoleTick(jourOuvre(400));
    assert.equal(ed.requetes.filter((q) => q.query.get('v') === '1.0.0').length >= 1, true);
    assert.equal(ed.connexions('parent.famille').length, n, 'bloqué : rien ne repart avec la même version');

    delete process.env.FOYER_ED_API_VERSION;
    vieillir(famille);
    await svc.ecoleTick(jourOuvre(500));
    assert.equal((await compte(famille)).state, 'ok', 'nouvelle version : le compte reprend seul');
  });

  it('clé de chiffrement changée : « identifiants à ressaisir », sans planter ; la bonne clé remise, ça repart', async () => {
    process.env.FOYER_SECRET_KEY = 'une-tout-autre-cle-de-chiffrement-de-plus-de-32';
    assert.equal((await compte(famille)).state, 'cle');
    const n = ed.requetes.length;
    vieillir(famille);
    await svc.ecoleTick(jourOuvre(600));
    assert.equal(ed.requetes.length, n, 'pas de connexion sans identifiants lisibles');
    assert.equal((await compte(famille)).state, 'cle');
    assert.equal((await appel(ctx.base, 'POST', `/ecole/comptes/${famille}/connexion`, {}, A())).status, 400);

    process.env.FOYER_SECRET_KEY = CLE;
    vieillir(famille);
    await svc.ecoleTick(jourOuvre(700));
    assert.equal((await compte(famille)).state, 'ok');
  });

  it('sonde : une vraie connexion hors service, base en lecture seule, fixtures anonymisées', async () => {
    const out = path.join(ctx.dir, 'fixtures-sonde');
    // Asynchrone : le faux serveur tourne dans ce processus, il doit pouvoir répondre.
    const sonde = async (...a: string[]): Promise<string> => (await promisify(execFile)(process.execPath, ['--import', 'tsx', path.join(__dirname, '..', 'src', 'ecole', 'sonde.ts'), ...a],
      { env: { ...process.env, FOYER_DB_PATH: path.join(ctx.dir, 'foyer.db') }, encoding: 'utf-8' })).stdout;
    assert.match(await sonde('--liste'), /Collège/);
    const n = ed.connexions('parent.famille').length;
    const txt = await sonde('--compte', String(famille), '--fixtures', out);
    assert.match(txt, /Connexion réussie : 1 compte\(s\)/);
    assert.match(txt, /Léna · 5EME B · COLLEGE EXEMPLE/);
    assert.ok(!txt.includes(MDP) && !txt.includes('tok-ok') && !txt.includes('CN-ANONYME'), 'ni mot de passe, ni jeton, ni cn');
    assert.equal(ed.connexions('parent.famille').length, n + 1);
    assert.deepEqual(ed.connexions('parent.famille').at(-1)!.data!['fa'], [{ cn: 'CN-ANONYME-0123456789', cv: 'CV-ANONYME-9876543210' }], 'avec l’appareil de confiance');
    const fix = fs.readFileSync(path.join(out, 'connexion.json'), 'utf-8');
    assert.ok(!fix.includes('Léna') && !fix.includes('COLLEGE EXEMPLE') && !fix.includes('3000001'), 'anonymisée');
    assert.match(fix, /"typeCompte": "1"/, 'la structure reste');
  });

  it('nuit : rien ne part ; sauvegarde du module : secrets chiffrés ; remise à zéro du module', async () => {
    const nuit = (() => { for (let t = Date.now(); ; t += 15 * 60_000) { const h = Number(wall(new Date(t)).slice(11, 13)); if (h === 23) return new Date(t); } })();
    vieillir(famille);
    assert.equal(await svc.ecoleTick(nuit), 0);

    const exp = await appel(ctx.base, 'GET', '/ecole/export.json', undefined, A());
    assert.equal(exp.status, 200);
    assert.equal(exp.json.counts.ed_accounts, 2);
    assert.ok(!JSON.stringify(exp.json).includes(MDP) && !JSON.stringify(exp.json).includes('parent.famille'), 'chiffré dans la sauvegarde');
    const back = await appel(ctx.base, 'POST', '/ecole/restore', { confirm: 'REMPLACER', backup: exp.json }, A());
    assert.equal(back.status, 200, JSON.stringify(back.json));
    assert.equal((await compte(famille)).state, 'ok', 'restaurée sur la même clé : intacte');

    assert.equal((await appel(ctx.base, 'GET', '/modules', undefined, A())).json.counts.ecole.comptes, 2);
    await appel(ctx.base, 'DELETE', `/ecole/comptes/${eleve}`, undefined, A());
    const ligne = sql.prepare('SELECT login_enc, password_enc, archived_at FROM ed_accounts WHERE id = ?').get(eleve) as Record<string, unknown>;
    assert.equal(ligne['login_enc'], null, 'retiré : secrets effacés');
    assert.ok(ligne['archived_at']);
    assert.equal((await etat()).accounts.length, 1);

    assert.equal((await appel(ctx.base, 'POST', '/modules/ecole/reset', { confirm: 'SUPPRIMER' }, A())).status, 200);
    assert.equal((await appel(ctx.base, 'GET', '/modules', undefined, A())).json.counts.ecole.comptes, 0);
  });
});
