// Le portail enfant, éprouvé sur les vraies routes : un parent ouvre la session
// d'un enfant sur son appareil, et la reprend avec son mot de passe.
//
// Ce que ce fichier doit prouver, c'est qu'il n'y a **rien de nouveau dans les
// droits** : la session ouverte est celle de l'enfant, elle bute sur les mêmes
// refus qu'un compte enfant, elle ne touche jamais au compte du parent, et l'on
// n'en sort qu'avec le mot de passe du parent (et son code s'il en a un), sous
// les mêmes compteurs que la connexion.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
import { codePour, pasDe } from '../src/auth/totp';

let ctx: Contexte;

/** Les membres ajoutés pour l'occasion : deux enfants sans compte, trois adultes avec. */
const RAPH = 'raph', GAET = 'gaet', NOLW = 'nolw', MARC = 'marc', PAUL = 'paul';
const MDP_NOLW = 'MotDePasseNolwenn1';
const MDP_MARC = 'MotDePasseMarc1';
const MDP_PAUL = 'MotDePassePauline1';
const MDP_CAMILLE = 'MotDePasseSolide2';
const UA_IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

interface Rep { status: number; json: any; cookie: string | null }

/**
 * Une requête comme la fait le navigateur : la session dans le cookie. Rend le
 * cookie de session reposé par le serveur (chaîne vide s'il l'a effacé, null
 * s'il n'y a pas touché).
 */
async function nav(method: string, chemin: string, body?: unknown, cookie?: string, extra: Record<string, string> = {}): Promise<Rep> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extra };
  if (cookie) headers['cookie'] = 'foyer_session=' + cookie;
  const res = await fetch(ctx.base + chemin, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const texte = await res.text();
  let json: unknown = null;
  try { json = texte ? JSON.parse(texte) : null; } catch { json = texte; }
  const pose = res.headers.getSetCookie().find((c) => c.startsWith('foyer_session='));
  return { status: res.status, json, cookie: pose === undefined ? null : decodeURIComponent(pose.slice('foyer_session='.length).split(';')[0]) };
}

async function connecter(email: string, password: string): Promise<string> {
  const r = await nav('POST', '/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.cookie!;
}

/** Ouvre la session de `enfant` depuis la session `parent`, et rend le cookie de l'enfant. */
async function basculer(parent: string, enfant: string, body: unknown = {}): Promise<string> {
  const r = await nav('POST', `/auth/switch/${enfant}`, body, parent);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.cookie, 'un cookie de session neuf remplace celui du parent');
  return r.cookie!;
}

let nolwenn: string;

before(async () => {
  ctx = await demarrer();
  const etat = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin);
  const nouveaux = [
    { id: RAPH, name: 'Raphaël', role: '', color: '#4E93B8', ini: 'R', enfant: true },
    { id: GAET, name: 'Gaëtan', role: '', color: '#7A9B76', ini: 'G', enfant: true },
    { id: NOLW, name: 'Nolwenn', role: '', color: '#E56B4E', ini: 'N' },
    { id: MARC, name: 'Marc', role: '', color: '#9B6FA8', ini: 'M' },
    { id: PAUL, name: 'Pauline', role: '', color: '#F0B24B', ini: 'P' },
  ];
  const ajout = await appel(ctx.base, 'PUT', '/state', {
    version: etat.json.version, state: { ...etat.json.state, members: [...etat.json.state.members, ...nouveaux] },
  }, ctx.jetons.admin);
  assert.equal(ajout.status, 200, JSON.stringify(ajout.json));
  for (const [id, email, password] of [[NOLW, 'nolwenn@example.fr', MDP_NOLW], [MARC, 'marc@example.fr', MDP_MARC], [PAUL, 'pauline@example.fr', MDP_PAUL]]) {
    const ouvert = await appel(ctx.base, 'POST', `/members/${id}/account`, { email, password }, ctx.jetons.admin);
    assert.equal(ouvert.status, 201, JSON.stringify(ouvert.json));
  }
  nolwenn = await connecter('nolwenn@example.fr', MDP_NOLW);
});
after(async () => { await arreter(ctx); });

describe('ouvrir la session d’un enfant', () => {
  it('un adulte ouvre la session d’un enfant qui n’a pas de compte', async () => {
    const r = await nav('POST', `/auth/switch/${RAPH}`, { from: 'calendar' }, nolwenn);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.memberId, RAPH);
    assert.equal(r.json.token, undefined, 'le jeton de l’enfant ne voyage que dans le cookie');
    const me = await nav('GET', '/me', undefined, r.cookie!);
    assert.equal(me.status, 200);
    assert.equal(me.json.memberId, RAPH);
    assert.equal(me.json.enfant, true);
    assert.equal(me.json.admin, false);
    assert.equal(me.json.via, NOLW);
    assert.equal(me.json.viaName, 'Nolwenn');
    assert.ok(Date.parse(me.json.switchedAt) > 0);
    assert.equal(me.json.email, '', 'pas d’adresse : la session n’a pas de compte');
  });

  it('une session ordinaire dit qu’elle n’est pas basculée', async () => {
    const me = await nav('GET', '/me', undefined, nolwenn);
    assert.equal(me.json.memberId, NOLW);
    assert.equal(me.json.via, null);
    assert.equal(me.json.switchedAt, null);
  });

  it('la cible doit être un enfant du foyer', async () => {
    assert.equal((await nav('POST', '/auth/switch/m1', {}, nolwenn)).status, 403, 'un adulte');
    assert.equal((await nav('POST', `/auth/switch/${MARC}`, {}, nolwenn)).status, 403, 'un autre parent');
    assert.equal((await nav('POST', '/auth/switch/inconnu', {}, nolwenn)).status, 404);
  });

  it('un compte enfant ordinaire n’ouvre aucune session', async () => {
    const r = await appel(ctx.base, 'POST', `/auth/switch/${RAPH}`, {}, ctx.jetons.enfant);
    assert.equal(r.status, 403);
  });

  it('un jeton d’accès (assistant, script) n’ouvre aucune session', async () => {
    const t = await appel(ctx.base, 'POST', '/me/tokens', { name: 'Assistant', scope: 'write', password: 'MotDePasseSolide1' }, ctx.jetons.admin);
    assert.equal(t.status, 201, JSON.stringify(t.json));
    const r = await appel(ctx.base, 'POST', `/auth/switch/${RAPH}`, {}, t.json.token);
    assert.equal(r.status, 403);
  });

  it('sans session, rien', async () => {
    assert.equal((await nav('POST', `/auth/switch/${RAPH}`, {})).status, 401);
  });
});

describe('la session d’un enfant a les droits d’un enfant, et aucun autre', () => {
  let raph: string;
  before(async () => { raph = await basculer(await connecter('nolwenn@example.fr', MDP_NOLW), RAPH); });

  const adultes: [string, string][] = [
    ['GET', '/finances/bootstrap'], ['GET', '/finances/transactions'], ['GET', '/employes/bootstrap'],
    ['GET', '/entretien/couts'], ['GET', '/members/accounts'], ['GET', '/system/status'], ['GET', '/settings/export'],
  ];
  for (const [method, chemin] of adultes) {
    it(`${method} ${chemin} → 403`, async () => {
      assert.equal((await nav(method, chemin, undefined, raph)).status, 403);
    });
  }

  it('le document du foyer reste lisible, comme pour tout enfant', async () => {
    assert.equal((await nav('GET', '/state', undefined, raph)).status, 200);
  });

  it('aucune route de compte n’agit sur celui du parent', async () => {
    const tentatives: [string, string, unknown][] = [
      ['PUT', '/me/credentials', { currentPassword: MDP_NOLW, password: 'NouveauMotDePasse9' }],
      ['POST', '/me/totp/start', { password: MDP_NOLW }],
      ['POST', '/me/tokens', { name: 'Volé', scope: 'write' }],
      ['GET', '/me/tokens', undefined],
      ['POST', '/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'a', auth: 'b' } } }],
    ];
    for (const [method, chemin, body] of tentatives) {
      assert.equal((await nav(method, chemin, body, raph)).status, 403, `${method} ${chemin}`);
    }
    // Le mot de passe de Nolwenn n'a pas bougé.
    await connecter('nolwenn@example.fr', MDP_NOLW);
  });

  it('aucune bascule depuis la session d’un enfant, ni vers un enfant ni vers un adulte', async () => {
    for (const cible of [GAET, RAPH, NOLW, 'm1']) {
      assert.equal((await nav('POST', `/auth/switch/${cible}`, {}, raph)).status, 403, cible);
    }
  });

  it('le jeton de l’enfant ne vaut pas en en-tête Authorization', async () => {
    assert.equal((await appel(ctx.base, 'GET', '/me', undefined, raph)).status, 401);
  });

  it('la bascule n’est pas un retour : sans session d’enfant, le retour répond 409', async () => {
    assert.equal((await nav('POST', '/auth/switch/back', { password: MDP_NOLW }, nolwenn)).status, 409);
  });
});

describe('revenir au parent', () => {
  it('un mauvais mot de passe laisse la session de l’enfant, avec un message neutre', async () => {
    const raph = await basculer(await connecter('nolwenn@example.fr', MDP_NOLW), RAPH);
    for (let i = 0; i < 3; i++) {
      const r = await nav('POST', '/auth/switch/back', { password: 'pas le bon' }, raph);
      assert.equal(r.status, 401);
      assert.equal(r.json.error, 'Mot de passe incorrect.');
      assert.equal(r.cookie, null, 'le cookie de l’enfant n’est pas touché');
    }
    assert.equal((await nav('GET', '/me', undefined, raph)).json.memberId, RAPH);
  });

  it('le bon mot de passe rend la session du parent, et l’écran d’où il était parti', async () => {
    const raph = await basculer(await connecter('nolwenn@example.fr', MDP_NOLW), RAPH, { from: 'calendar' });
    const r = await nav('POST', '/auth/switch/back', { password: MDP_NOLW }, raph);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.from, 'calendar');
    assert.equal(r.json.token, undefined);
    const me = await nav('GET', '/me', undefined, r.cookie!);
    assert.equal(me.json.memberId, NOLW);
    assert.equal(me.json.via, null);
    assert.equal((await nav('GET', '/me', undefined, raph)).status, 401, 'la session de l’enfant est refermée');
  });

  describe('avec un second facteur', () => {
    let secret = '';
    /**
     * Un code du pas courant, rendu de nouveau utilisable. Le serveur refuse un
     * pas déjà consommé, et la fenêtre n'en tolère qu'un d'écart : sans cette
     * remise à zéro, ce fichier attendrait trente secondes entre deux codes.
     */
    const codeFrais = async (): Promise<string> => {
      const db = await import('../src/db');
      db.setTotpLastStep(ctx.ids.membre, 0);
      return codePour(secret, pasDe(Date.now()))!;
    };
    before(async () => {
      const start = await appel(ctx.base, 'POST', '/me/totp/start', { password: MDP_CAMILLE }, ctx.jetons.membre);
      secret = start.json.secret;
      const on = await appel(ctx.base, 'POST', '/me/totp/enable', { code: codePour(secret, pasDe(Date.now()))! }, ctx.jetons.membre);
      assert.equal(on.status, 200, JSON.stringify(on.json));
    });

    it('le mot de passe, puis le code', async () => {
      const camille = await nav('POST', '/auth/login', { email: 'membre@example.fr', password: MDP_CAMILLE });
      assert.equal(camille.json.totpRequired, true);
      const fin = await nav('POST', '/auth/login/totp', { challenge: camille.json.challenge, code: await codeFrais() });
      assert.equal(fin.status, 200, JSON.stringify(fin.json));
      const raph = await basculer(fin.cookie!, RAPH, { from: 'taches' });

      const premier = await nav('POST', '/auth/switch/back', { password: MDP_CAMILLE }, raph);
      assert.equal(premier.status, 200);
      assert.equal(premier.json.totpRequired, true);
      assert.equal(premier.cookie, null, 'le mot de passe seul ne rend rien');

      // Le défi du retour n'ouvre pas une connexion ordinaire.
      assert.equal((await nav('POST', '/auth/login/totp', { challenge: premier.json.challenge, code: '000000' })).status, 401);

      const faux = await nav('POST', '/auth/switch/back/totp', { challenge: premier.json.challenge, code: '000000' }, raph);
      assert.equal(faux.status, 401);
      assert.equal(faux.cookie, null);
      assert.equal((await nav('GET', '/me', undefined, raph)).json.memberId, RAPH);

      const bon = await nav('POST', '/auth/switch/back/totp', { challenge: premier.json.challenge, code: await codeFrais() }, raph);
      assert.equal(bon.status, 200, JSON.stringify(bon.json));
      assert.equal(bon.json.from, 'taches');
      assert.equal((await nav('GET', '/me', undefined, bon.cookie!)).json.memberId, 'm1');
    });

    it('le défi d’une session ne sert pas à une autre', async () => {
      const raph = await basculer(await connecter('nolwenn@example.fr', MDP_NOLW), RAPH);
      const camille = await nav('POST', '/auth/login', { email: 'membre@example.fr', password: MDP_CAMILLE });
      const fin = await nav('POST', '/auth/login/totp', { challenge: camille.json.challenge, code: await codeFrais() });
      const gaet = await basculer(fin.cookie!, GAET);
      const defi = (await nav('POST', '/auth/switch/back', { password: MDP_CAMILLE }, gaet)).json.challenge;
      const r = await nav('POST', '/auth/switch/back/totp', { challenge: defi, code: await codeFrais() }, raph);
      assert.equal(r.status, 401, 'le défi né de la session de Gaëtan ne referme pas celle de Raphaël');
    });
  });
});

describe('le journal des bascules', () => {
  it('retient qui, quand, sur quel appareil, et comment la session s’est refermée', async () => {
    const parent = await connecter('nolwenn@example.fr', MDP_NOLW);
    const r = await nav('POST', `/auth/switch/${GAET}`, { tactile: true }, parent, { 'user-agent': UA_IPAD });
    const ouverte = (await appel(ctx.base, 'GET', `/members/${GAET}/switches`, undefined, ctx.jetons.admin)).json.switches[0];
    assert.equal(ouverte.byName, 'Nolwenn');
    assert.equal(ouverte.device, 'iPad', 'un « Mac » tactile est un iPad');
    assert.equal(ouverte.open, true);
    await nav('POST', '/auth/switch/back', { password: MDP_NOLW }, r.cookie!);
    const fermee = (await appel(ctx.base, 'GET', `/members/${GAET}/switches`, undefined, ctx.jetons.admin)).json.switches[0];
    assert.equal(fermee.id, ouverte.id);
    assert.equal(fermee.open, false);
    assert.equal(fermee.endReason, 'retour');
  });

  it('n’est lisible que par un adulte', async () => {
    assert.equal((await appel(ctx.base, 'GET', `/members/${GAET}/switches`, undefined, ctx.jetons.enfant)).status, 403);
  });

  it('se déconnecter depuis la session de l’enfant la referme, et ne ramène pas au parent', async () => {
    const raph = await basculer(await connecter('nolwenn@example.fr', MDP_NOLW), RAPH);
    const r = await nav('POST', '/auth/logout', undefined, raph);
    assert.equal(r.cookie, '', 'le cookie est effacé, aucun autre n’est posé');
    assert.equal((await nav('GET', '/me', undefined, raph)).status, 401);
    const derniere = (await appel(ctx.base, 'GET', `/members/${RAPH}/switches`, undefined, ctx.jetons.admin)).json.switches[0];
    assert.equal(derniere.endReason, 'deconnexion');
  });

  it('un adulte ferme à distance une session restée ouverte', async () => {
    const raph = await basculer(await connecter('nolwenn@example.fr', MDP_NOLW), RAPH);
    const sid = (await appel(ctx.base, 'GET', `/members/${RAPH}/switches`, undefined, ctx.jetons.admin)).json.switches[0].id;
    assert.equal((await nav('POST', `/members/${RAPH}/switches/${sid}/close`, undefined, raph)).status, 403, 'pas depuis la session de l’enfant');
    assert.equal((await appel(ctx.base, 'POST', `/members/${RAPH}/switches/${sid}/close`, undefined, ctx.jetons.membre)).status, 200);
    assert.equal((await nav('GET', '/me', undefined, raph)).status, 401);
    assert.equal((await appel(ctx.base, 'POST', `/members/${RAPH}/switches/${sid}/close`, undefined, ctx.jetons.membre)).status, 409);
    assert.equal((await appel(ctx.base, 'POST', `/members/${GAET}/switches/${sid}/close`, undefined, ctx.jetons.membre)).status, 404, 'pas la session de cet enfant');
  });
});

describe('ce qui ferme une session d’enfant sans retour', () => {
  it('le parent change son mot de passe', async () => {
    const marc = await connecter('marc@example.fr', MDP_MARC);
    const raph = await basculer(marc, RAPH);
    const r = await nav('PUT', '/me/credentials', { currentPassword: MDP_MARC, password: 'MotDePasseMarc2' }, marc);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await nav('GET', '/me', undefined, raph)).status, 401);
  });

  it('la fiche de l’enfant n’est plus marquée « enfant » : la session ne devient pas celle d’un adulte', async () => {
    const raph = await basculer(await connecter('nolwenn@example.fr', MDP_NOLW), RAPH);
    const etat = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin);
    const membres = etat.json.state.members.map((m: { id: string }) => (m.id === RAPH ? { ...m, enfant: false } : m));
    const put = await appel(ctx.base, 'PUT', '/state', { version: etat.json.version, state: { ...etat.json.state, members: membres } }, ctx.jetons.admin);
    assert.equal(put.status, 200, JSON.stringify(put.json));
    assert.equal((await nav('GET', '/me', undefined, raph)).status, 401);
    assert.equal((await nav('GET', '/finances/bootstrap', undefined, raph)).status, 401);
    const etat2 = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin);
    const remis = etat2.json.state.members.map((m: { id: string }) => (m.id === RAPH ? { ...m, enfant: true } : m));
    await appel(ctx.base, 'PUT', '/state', { version: etat2.json.version, state: { ...etat2.json.state, members: remis } }, ctx.jetons.admin);
  });
});

describe('une file d’opérations ne part que sous la session qui l’a remplie', () => {
  it('un lot marqué pour un autre membre est refusé en bloc, et reste à son propriétaire', async () => {
    const raph = await basculer(await connecter('nolwenn@example.fr', MDP_NOLW), RAPH);
    for (const chemin of ['/tasks/ops', '/shopping/ops', '/places/ops']) {
      const r = await nav('POST', chemin, { ops: [], as: NOLW }, raph);
      assert.equal(r.status, 409, chemin);
      assert.equal(r.json.owner, NOLW);
      assert.equal((await nav('POST', chemin, { ops: [], as: RAPH }, raph)).status, 200, chemin);
      assert.equal((await nav('POST', chemin, { ops: [] }, raph)).status, 200, `${chemin} sans « as » : une application d’avant ce contrôle`);
    }
  });
});

describe('la temporisation est celle de la connexion', () => {
  it('l’acharnement sur le retour retarde aussi une connexion du parent', async () => {
    const parent = await connecter('pauline@example.fr', MDP_PAUL);
    const raph = await basculer(parent, RAPH);
    for (let i = 0; i < 6; i++) {
      assert.equal((await nav('POST', '/auth/switch/back', { password: 'non' }, raph)).status, 401, `essai ${i + 1}`);
    }
    const bloque = await nav('POST', '/auth/switch/back', { password: MDP_PAUL }, raph);
    assert.equal(bloque.status, 429, 'même le bon mot de passe attend');
    assert.match(bloque.json.error, /Réessayez dans/);
    assert.equal((await nav('POST', '/auth/login', { email: 'pauline@example.fr', password: MDP_PAUL })).status, 429);
    assert.equal((await nav('GET', '/me', undefined, raph)).json.memberId, RAPH);
  });
});

describe('le calendrier d’un enfant est en lecture seule', () => {
  it('ce qu’un enfant envoie pour les événements est ignoré, le reste de son envoi passe', async () => {
    const lire = async (jeton: string) => (await appel(ctx.base, 'GET', '/state', undefined, jeton)).json;
    const a = await lire(ctx.jetons.admin);
    const ev = { id: 'ev-ro', title: 'Rentrée', date: '2026-09-01', time: '08:30', who: [], recur: 'none' };
    assert.equal((await appel(ctx.base, 'PUT', '/state', { version: a.version, state: { ...a.state, events: [...a.state.events, ev] } }, ctx.jetons.admin)).status, 200);
    const e = await lire(ctx.jetons.enfant);
    const lena = (e.state.members as { id: string; name: string }[]).find((m) => m.name === 'Lena')!.id;
    const slot = { id: 'sl-ro', who: [lena], dow: 3, start: '14:00', end: '15:00', label: 'Piscine', k: 'sport', rec: 'weekly' };
    const r = await appel(ctx.base, 'PUT', '/state', { version: e.version, state: {
      ...e.state, sched: [...e.state.sched, slot],
      events: [...e.state.events.filter((x: { id: string }) => x.id !== 'ev-ro'), { ...ev, id: 'ev-enfant', title: 'Fête' }],
    } }, ctx.jetons.enfant);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const apres = (await lire(ctx.jetons.admin)).state;
    assert.ok(apres.events.some((x: { id: string }) => x.id === 'ev-ro'), 'l’événement n’est pas supprimé');
    assert.ok(!apres.events.some((x: { id: string }) => x.id === 'ev-enfant'), 'ni créé');
    assert.ok(apres.sched.some((x: { id: string }) => x.id === 'sl-ro'), 'son créneau, lui, est enregistré');
  });
});
