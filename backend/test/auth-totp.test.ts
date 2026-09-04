// Le second facteur, de bout en bout, sur les vraies routes.
//
// C'est la protection qui couvre le seul scénario qu'aucune autre correction
// n'atteignait : quelqu'un qui **connaît le mot de passe**, parce qu'il a été
// réutilisé ailleurs et que cet ailleurs a fuité. Ni la temporisation, ni
// l'égalisation du temps de réponse, ni fail2ban ne voient passer une connexion
// réussie du premier coup.
//
// Ce fichier vérifie donc surtout ce qui ne doit **pas** marcher : sauter le
// second temps, réutiliser un code, se servir du défi comme d'une session,
// retirer la protection sans la prouver.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Contexte, SECRET, appel, arreter, demarrer } from './securite-helpers';
import { codePour, pasDe } from '../src/auth/totp';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

const MDP = 'MotDePasseSolide2';
const QUI = 'membre@example.fr';
/** La fiche de Camille, à qui appartient le compte éprouvé ici. */
const FICHE = 'm1';

const jeton = (): string => ctx.jetons.membre;
const code = (secret: string, decalage = 0): string => codePour(secret, pasDe(Date.now()) + decalage)!;
const connexion = (body: unknown): Promise<{ status: number; json: any }> =>
  appel(ctx.base, 'POST', '/auth/login', body);

/**
 * Remet le compte à l'état « sans second facteur », quel qu'il soit.
 *
 * Passe par le déblocage administrateur, le seul chemin qui n'exige pas de
 * connaître le code : c'est précisément la sortie de secours du téléphone perdu.
 */
async function remettreAZero(): Promise<void> {
  await appel(ctx.base, 'POST', `/members/${FICHE}/totp/reset`,
    { password: 'MotDePasseSolide1' }, ctx.jetons.admin);
}

/** Active le second facteur et rend de quoi s'en servir. */
async function activer(): Promise<{ secret: string; recovery: string[] }> {
  const start = await appel(ctx.base, 'POST', '/me/totp/start', { password: MDP }, jeton());
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const secret = start.json.secret as string;
  const on = await appel(ctx.base, 'POST', '/me/totp/enable', { code: code(secret) }, jeton());
  assert.equal(on.status, 200, JSON.stringify(on.json));
  return { secret, recovery: on.json.recovery as string[] };
}

/** Le défi remis par le premier temps, pour un compte qui porte un second facteur. */
async function defi(): Promise<string> {
  const r = await connexion({ email: QUI, password: MDP });
  assert.equal(r.json.totpRequired, true, JSON.stringify(r.json));
  return r.json.challenge as string;
}

describe('l’enrôlement ne protège rien tant qu’il n’est pas prouvé', () => {
  beforeEach(remettreAZero);

  it('le premier temps exige le mot de passe', async () => {
    assert.equal((await appel(ctx.base, 'POST', '/me/totp/start', {}, jeton())).status, 403);
    assert.equal((await appel(ctx.base, 'POST', '/me/totp/start', { password: 'pas-le-bon' }, jeton())).status, 403);
  });

  it('le secret mis de côté ne ferme pas encore le compte', async () => {
    await appel(ctx.base, 'POST', '/me/totp/start', { password: MDP }, jeton());
    // Une saisie de travers dans l'application du téléphone ne doit pas fermer
    // le compte : tant que le code n'a pas été prouvé, on se connecte comme avant.
    const r = await connexion({ email: QUI, password: MDP });
    assert.equal(r.status, 200);
    assert.ok(r.json.token, 'le mot de passe suffit encore');
    assert.equal(r.json.totpRequired, undefined);
  });

  it('un code faux n’active rien', async () => {
    await appel(ctx.base, 'POST', '/me/totp/start', { password: MDP }, jeton());
    const r = await appel(ctx.base, 'POST', '/me/totp/enable', { code: '000000' }, jeton());
    assert.equal(r.status, 400);
    assert.match(String(r.json.error), /heure de votre téléphone/);
    assert.equal((await appel(ctx.base, 'GET', '/me', undefined, jeton())).json.totp, false);
  });

  it('activer sans avoir commencé ne marche pas', async () => {
    const r = await appel(ctx.base, 'POST', '/me/totp/enable', { code: '123456' }, jeton());
    assert.equal(r.status, 409);
  });

  it('le bon code active, et rend dix codes de secours une seule fois', async () => {
    const { recovery } = await activer();
    assert.equal(recovery.length, 10);
    assert.equal(new Set(recovery).size, 10);
    const moi = await appel(ctx.base, 'GET', '/me', undefined, jeton());
    assert.equal(moi.json.totp, true);
    assert.equal(moi.json.totpRecoveryLeft, 10);
    // Ils ne ressortent jamais : ils ne sont pas rangés en clair.
    assert.equal(moi.json.recovery, undefined);
  });

  it('on ne recommence pas un enrôlement par-dessus un second facteur actif', async () => {
    await activer();
    const r = await appel(ctx.base, 'POST', '/me/totp/start', { password: MDP }, jeton());
    assert.equal(r.status, 409);
    assert.match(String(r.json.error), /déjà actif/);
  });
});

describe('le mot de passe ne suffit plus', () => {
  let secret: string;
  before(async () => { await remettreAZero(); ({ secret } = await activer()); });

  it('la connexion s’arrête sur un défi, sans jeton de session', async () => {
    const r = await connexion({ email: QUI, password: MDP });
    assert.equal(r.status, 200);
    assert.equal(r.json.totpRequired, true);
    assert.equal(r.json.token, undefined, 'aucun jeton de session ne doit sortir du premier temps');
    assert.ok(r.json.challenge);
  });

  it('un mot de passe faux s’arrête avant, sans dire qu’un second facteur existe', async () => {
    const r = await connexion({ email: QUI, password: 'pas-le-bon' });
    assert.equal(r.status, 401);
    assert.equal(r.json.totpRequired, undefined);
    assert.equal(r.json.challenge, undefined);
  });

  it('le défi n’ouvre rien par lui-même : c’est tout l’objet du second facteur', async () => {
    const d = await defi();
    for (const chemin of ['/state', '/me', '/live', '/finances/bootstrap']) {
      assert.equal((await appel(ctx.base, 'GET', chemin, undefined, d)).status, 401,
        `${chemin} accepte le défi comme une session`);
    }
  });

  it('un défi signé avec le secret des sessions est refusé', async () => {
    // La contre-épreuve du choix de conception : si les deux secrets étaient le
    // même, ce jeton passerait et le second facteur serait décoratif.
    const forge = jwt.sign({ id: ctx.ids.membre, tv: 0 }, SECRET, { expiresIn: '5m' });
    const r = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: forge, code: code(secret) });
    assert.equal(r.status, 401);
  });

  it('un défi expiré est refusé', async () => {
    const secretDefi = crypto.createHmac('sha256', SECRET).update('foyer-totp-challenge').digest('hex');
    const vieux = jwt.sign({ id: ctx.ids.membre, tv: 0 }, secretDefi, { expiresIn: '-1m' });
    const r = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: vieux, code: code(secret) });
    assert.equal(r.status, 401);
  });

  it('le bon code ouvre la session, et elle vaut vraiment', async () => {
    // Le pas suivant, parce que celui de l'activation vient d'être consommé :
    // c'est voulu, et c'est ce qu'éprouve le groupe « un code ne vaut qu'une fois ».
    const r = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: await defi(), code: code(secret, 1) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.token);
    assert.equal((await appel(ctx.base, 'GET', '/state', undefined, r.json.token)).status, 200);
  });
});

describe('un code ne vaut qu’une fois', () => {
  let secret: string;
  before(async () => { await remettreAZero(); ({ secret } = await activer()); });

  it('le code qui a servi à l’activation ne sert pas à se connecter', async () => {
    // Celui qui a regardé l'écran d'enrôlement par-dessus une épaule ne doit pas
    // pouvoir s'en servir dans la foulée.
    const r = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: await defi(), code: code(secret) });
    assert.equal(r.status, 401);
    assert.match(String(r.json.error), /déjà servi/);
  });

  it('le même code refusé au second usage', async () => {
    // Un code lu par-dessus une épaule reste affiché une trentaine de secondes.
    // Sans ce refus, cela suffirait à ouvrir une seconde session.
    const c = code(secret, 1);
    const un = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: await defi(), code: c });
    assert.equal(un.status, 200, JSON.stringify(un.json));

    const deux = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: await defi(), code: c });
    assert.equal(deux.status, 401);
    assert.match(String(deux.json.error), /déjà servi/);
  });

  it('un code plus ancien que celui qui vient de servir est refusé aussi', async () => {
    const r = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: await defi(), code: code(secret, -1) });
    assert.ok([401, 429].includes(r.status), `reçu ${r.status}`);
  });
});

describe('les codes de secours, pour le téléphone perdu', () => {
  let recovery: string[];
  let secret: string;
  before(async () => { await remettreAZero(); ({ secret, recovery } = await activer()); });

  it('un code de secours ouvre la session', async () => {
    const r = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: await defi(), code: recovery[0] });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.token);
  });

  it('et ne vaut plus rien ensuite', async () => {
    const r = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: await defi(), code: recovery[0] });
    assert.ok([401, 429].includes(r.status), `reçu ${r.status}`);
  });

  it('le compte restant se voit, pour alerter avant qu’il n’en reste zéro', async () => {
    const moi = await appel(ctx.base, 'GET', '/me', undefined, jeton());
    assert.equal(moi.json.totpRecoveryLeft, 9);
  });

  it('se recopie sans que la casse ni les tirets ne comptent', async () => {
    const brut = recovery[1].toLowerCase().replace('-', ' ');
    const r = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: await defi(), code: brut });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  });

  it('les refaire exige le mot de passe et le code du téléphone', async () => {
    assert.equal((await appel(ctx.base, 'POST', '/me/totp/recovery', { password: MDP }, jeton())).status, 403);
    assert.equal((await appel(ctx.base, 'POST', '/me/totp/recovery', { code: '000000' }, jeton())).status, 403);
  });

  it('une fois refaits, les anciens ne valent plus rien', async () => {
    const neufs = await appel(ctx.base, 'POST', '/me/totp/recovery',
      { password: MDP, code: code(secret, 1) }, jeton());
    assert.equal(neufs.status, 200, JSON.stringify(neufs.json));
    assert.equal((neufs.json.recovery as string[]).length, 10);
    assert.equal((await appel(ctx.base, 'GET', '/me', undefined, jeton())).json.totpRecoveryLeft, 10);

    // recovery[2] n'avait jamais servi : il est pourtant mort avec les autres.
    const vieux = await appel(ctx.base, 'POST', '/auth/login/totp', { challenge: await defi(), code: recovery[2] });
    assert.ok([401, 429].includes(vieux.status), `reçu ${vieux.status}`);
  });
});

describe('retirer sa protection se prouve', () => {
  let secret: string;
  before(async () => { await remettreAZero(); ({ secret } = await activer()); });

  it('le mot de passe seul ne suffit pas', async () => {
    // Sinon, qui a volé le mot de passe retire le second facteur, et il n'aura
    // servi à rien.
    const r = await appel(ctx.base, 'POST', '/me/totp/disable', { password: MDP }, jeton());
    assert.equal(r.status, 403);
    assert.equal((await appel(ctx.base, 'GET', '/me', undefined, jeton())).json.totp, true);
  });

  it('le code seul ne suffit pas non plus', async () => {
    const r = await appel(ctx.base, 'POST', '/me/totp/disable', { code: code(secret) }, jeton());
    assert.equal(r.status, 403);
    assert.equal((await appel(ctx.base, 'GET', '/me', undefined, jeton())).json.totp, true);
  });

  it('les deux ensemble retirent la protection', async () => {
    const r = await appel(ctx.base, 'POST', '/me/totp/disable', { password: MDP, code: code(secret) }, jeton());
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await appel(ctx.base, 'GET', '/me', undefined, jeton())).json.totp, false);
    // Et la connexion redevient un seul temps.
    const c = await connexion({ email: QUI, password: MDP });
    assert.ok(c.json.token);
  });
});

describe('le déblocage par un administrateur, dernière sortie de secours', () => {
  before(async () => { await remettreAZero(); await activer(); });

  it('un membre ordinaire ne débloque pas le compte d’un autre', async () => {
    const r = await appel(ctx.base, 'POST', `/members/${FICHE}/totp/reset`, { password: MDP }, jeton());
    assert.equal(r.status, 403);
  });

  it('un administrateur sans son mot de passe non plus', async () => {
    const r = await appel(ctx.base, 'POST', `/members/${FICHE}/totp/reset`, {}, ctx.jetons.admin);
    assert.equal(r.status, 403);
    assert.equal((await appel(ctx.base, 'GET', '/me', undefined, jeton())).json.totp, true);
  });

  it('avec son mot de passe, il débloque', async () => {
    const r = await appel(ctx.base, 'POST', `/members/${FICHE}/totp/reset`,
      { password: 'MotDePasseSolide1' }, ctx.jetons.admin);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal((await appel(ctx.base, 'GET', '/me', undefined, jeton())).json.totp, false);
  });

  it('sans jeton, personne ne débloque personne', async () => {
    assert.equal((await appel(ctx.base, 'POST', `/members/${FICHE}/totp/reset`, { password: 'x' })).status, 401);
  });
});

describe('la liste des accès dit qui est protégé', () => {
  before(async () => { await remettreAZero(); await activer(); });

  it('un administrateur voit où en est le foyer', async () => {
    const r = await appel(ctx.base, 'GET', '/members/accounts', undefined, ctx.jetons.admin);
    assert.equal(r.status, 200);
    const camille = (r.json.accounts as { memberId: string; totp: boolean }[]).find((a) => a.memberId === FICHE);
    assert.equal(camille?.totp, true);
    const admin = (r.json.accounts as { memberId: string; totp: boolean }[]).find((a) => a.memberId === 'me');
    assert.equal(admin?.totp, false, 'et voit aussi qui ne l’a pas encore posé');
  });
});
