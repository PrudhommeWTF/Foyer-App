// Client ÉcoleDirecte, sur le faux serveur : le flux de connexion tel que le
// vrai l'exige (GTK, jeton qui tourne, question de sécurité en base64,
// appareil de confiance), et chaque code d'erreur rangé dans la bonne famille.
// Aucun appel réseau hors de 127.0.0.1.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { EdClient, EdConfig, EdError, encodeCredential } from '../src/ecole/client';
import { FauxEd, fauxEcoleDirecte } from './ecole-faux-serveur';

const UA = 'Mozilla/5.0 (test) Foyer';

describe('ÉcoleDirecte : encodage des identifiants', () => {
  it('reprend urllib.parse.quote(s, safe="~()*!.\'%\\\\") : % et \\ restent tels quels', () => {
    assert.equal(encodeCredential('a b&c+d'), 'a%20b%26c%2Bd');
    assert.equal(encodeCredential('100%'), '100%');
    assert.equal(encodeCredential('a\\b'), 'a\\b');
    assert.equal(encodeCredential('é"'), '%C3%A9%22');
    assert.equal(encodeCredential("~()*!.'"), "~()*!.'");
  });
});

describe('ÉcoleDirecte : client', () => {
  let ed: FauxEd;
  let cfg: EdConfig;
  before(async () => {
    ed = await fauxEcoleDirecte();
    cfg = { base: ed.base, version: '4.102.0', userAgent: UA, origin: 'https://www.ecoledirecte.com' };
  });
  after(async () => { await ed.fermer(); });

  it('compte élève sans question : GTK, en-têtes de navigateur, corps sans fa', async () => {
    const out = await new EdClient(cfg).login('eleve.camille', 'bon-mot-de-passe');
    assert.equal(out.kind, 'ok');
    if (out.kind !== 'ok') return;
    assert.equal(out.session.token, 'tok-ok');
    assert.deepEqual(out.accounts.map((a) => a.type), ['eleve']);
    assert.deepEqual(out.accounts[0].students, [{ edId: 3000003, idLogin: 1000002, firstName: 'Camille', lastName: 'FAMILLE', className: 'CM2', schoolName: 'ECOLE EXEMPLE', modules: ['CAHIER_DE_TEXTES'] }]);

    const [gtk, login] = ed.requetes.slice(-2);
    assert.equal(gtk.method, 'GET');
    assert.equal(gtk.query.get('gtk'), '1');
    assert.equal(login.query.get('v'), '4.102.0');
    assert.equal(login.headers['user-agent'], UA);
    assert.equal(login.headers['origin'], 'https://www.ecoledirecte.com');
    assert.equal(login.headers['referer'], 'https://www.ecoledirecte.com/');
    assert.equal(login.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.match(String(login.headers['cookie']), /GTK=gtk-123/);
    assert.ok(login.raw.startsWith('data={'), 'corps brut « data=<JSON> »');
    assert.deepEqual(Object.keys(login.data!).sort(), ['identifiant', 'isReLogin', 'motdepasse'], 'ni uuid ni fa sans appareil connu');
    assert.equal(login.data!['isReLogin'], false);
  });

  it('question de sécurité : décodée, réponse en base64, jeton qui tourne, puis reconnexion avec fa', async () => {
    const c = new EdClient(cfg);
    const out = await c.login('parent.famille', 'mot de passe & 100%');
    assert.equal(out.kind, 'qcm');
    if (out.kind !== 'qcm') return;
    assert.equal(out.question, 'Quelle est la ville de naissance de votre enfant ?');
    assert.deepEqual(out.propositions, ['PARIS', 'RENNES', 'SAINT-ÉTIENNE', 'LYON']);
    const get = ed.requetes.at(-1)!;
    assert.equal(get.headers['2fa-token'], 'deux-fa', 'l’en-tête 2FA-Token reçu repart tel quel');

    const trusted = await c.answerQcm(out.challenge, 'SAINT-ÉTIENNE');
    assert.deepEqual(trusted, { cn: 'CN-ANONYME-0123456789', cv: 'CV-ANONYME-9876543210' });
    assert.equal(Buffer.from(String(ed.requetes.at(-1)!.data!['choix']), 'base64').toString('utf8'), 'SAINT-ÉTIENNE');

    const again = await c.login('parent.famille', 'mot de passe & 100%', trusted);
    assert.equal(again.kind, 'ok', 'plus de question avec l’appareil de confiance');
    const login = ed.requetes.at(-1)!;
    assert.equal(login.data!['cn'], trusted.cn);
    assert.equal(login.data!['cv'], trusted.cv);
    assert.equal(login.data!['uuid'], '');
    assert.deepEqual(login.data!['fa'], [trusted]);
    if (again.kind !== 'ok') return;
    const st = again.accounts[0].students;
    assert.deepEqual(st.map((e) => [e.firstName, e.className, e.schoolName]), [['Léna', '5EME B', 'COLLEGE EXEMPLE'], ['Nolan-Pierre', 'SECONDE A', 'LYCEE EXEMPLE']]);
    assert.deepEqual(st[0].modules, ['CAHIER_DE_TEXTES', 'NOTES', 'EDT', 'VIE_SCOLAIRE'], 'les modules désactivés sont écartés');
  });

  it('mauvaise réponse à la question : erreur, pas d’appareil de confiance', async () => {
    const c = new EdClient(cfg);
    const out = await c.login('parent.famille', 'mot de passe & 100%');
    assert.equal(out.kind, 'qcm');
    if (out.kind !== 'qcm') return;
    await assert.rejects(c.answerQcm(out.challenge, 'PARIS'), (e: EdError) => e.kind === 'inattendu' && e.code === 516);
  });

  const famille = async (c: EdConfig, id = 'parent.famille', mdp = 'mot de passe & 100%'): Promise<EdError> => {
    try { await new EdClient(c).login(id, mdp); } catch (e) { return e as EdError; }
    throw new Error('une erreur était attendue');
  };

  it('chaque code dans sa famille, avec un message lisible', async () => {
    const e505 = await famille(cfg, 'parent.famille', 'faux');
    assert.equal(e505.kind, 'identifiants'); assert.equal(e505.code, 505);
    assert.match(e505.message, /refuse l’identifiant ou le mot de passe \(505\)/);
    assert.doesNotMatch(e505.message, /faux|parent\.famille/, 'ni identifiant ni mot de passe dans un message');

    const e517 = await famille({ ...cfg, version: '1.0.0' });
    assert.equal(e517.kind, 'version');
    assert.match(e517.message, /refuse la version d’API 1\.0\.0 \(517\)/);

    ed.panne['parent.famille'] = '535';
    assert.equal((await famille(cfg)).kind, 'indisponible');
    ed.panne['parent.famille'] = '500';
    const e500 = await famille(cfg);
    assert.equal(e500.kind, 'indisponible'); assert.equal(e500.httpStatus, 500);
    ed.panne['parent.famille'] = 'html';
    assert.match((await famille(cfg)).message, /Réponse illisible/);
    delete ed.panne['parent.famille'];

    const gtk = await famille({ ...cfg, base: ed.base + '/rien' });
    assert.equal(gtk.kind, 'gtk', 'pas de cookie GTK : le flux a changé, on le dit');
  });

  it('serveur injoignable : erreur passagère, pas d’exception brute', async () => {
    const e = await famille({ ...cfg, base: 'http://127.0.0.1:9', timeoutMs: 2000 });
    assert.equal(e.kind, 'indisponible');
    assert.match(e.message, /injoignable/);
  });
});
