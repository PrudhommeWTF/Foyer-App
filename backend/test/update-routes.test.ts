// Les routes de mise à jour, sur les vraies routes du serveur.
//
// Ce qui est éprouvé ici n'est pas GitHub (le dépôt visé est volontairement
// introuvable, et le réseau peut manquer) mais les trois décisions du serveur :
// qui a le droit, ce qu'il constate de la machine, et ce qu'il écrit dans le
// déclencheur lu **en root** par systemd.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

const MDP_ADMIN = 'MotDePasseSolide1';
const helperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-helper-'));
const helper = path.join(helperDir, 'foyer-self-update.sh');

let c: Contexte;
let trigger: string;

const poserHelper = (): void => fs.writeFileSync(helper, '#!/bin/sh\n');
const retirerHelper = (): void => { try { fs.unlinkSync(helper); } catch { /* déjà absent */ } };
const couper = (v?: string): void => { if (v === undefined) delete process.env.FOYER_SELF_UPDATE; else process.env.FOYER_SELF_UPDATE = v; };
const canal = (v: string) => appel(c.base, 'PATCH', '/settings', { changes: { updateChannel: v } }, c.jetons.admin);

before(async () => {
  // Posés avant l'import du serveur : le dépôt est figé au chargement du module.
  process.env.FOYER_SELF_UPDATE_HELPER = helper;
  process.env.FOYER_GITHUB_REPO = 'PrudhommeWTF/depot-qui-n-existe-pas-foyer-test';
  couper(undefined);
  c = await demarrer();
  trigger = path.join(c.dir, '.update-trigger');
});
after(async () => { await arreter(c); });

describe('GET /system/version : la capacité est constatée', () => {
  it('sans helper : pas de mise à jour en un clic, et la raison est dite', async () => {
    retirerHelper();
    const r = await appel(c.base, 'GET', '/system/version', undefined, c.jetons.admin);
    assert.equal(r.status, 200);
    assert.equal((r.json as { selfUpdate: boolean }).selfUpdate, false);
    assert.equal((r.json as { selfUpdateReason: string }).selfUpdateReason, 'absente');
  });

  it('avec le helper : possible, sans que rien n’ait été déclaré', async () => {
    // C'est le cœur du changement : FOYER_SELF_UPDATE n'est pas posée ici.
    poserHelper();
    const r = await appel(c.base, 'GET', '/system/version', undefined, c.jetons.admin);
    assert.equal((r.json as { selfUpdate: boolean }).selfUpdate, true);
    assert.equal((r.json as { selfUpdateReason?: string }).selfUpdateReason, undefined);
  });

  it('FOYER_SELF_UPDATE=false coupe malgré le helper', async () => {
    poserHelper();
    couper('false');
    const r = await appel(c.base, 'GET', '/system/version', undefined, c.jetons.admin);
    assert.equal((r.json as { selfUpdate: boolean }).selfUpdate, false);
    assert.equal((r.json as { selfUpdateReason: string }).selfUpdateReason, 'coupee');
    couper(undefined);
  });
});

describe('POST /system/update', () => {
  it('refuse sans le dispositif, en nommant les deux gestes possibles', async () => {
    retirerHelper();
    const r = await appel(c.base, 'POST', '/system/update', { password: MDP_ADMIN }, c.jetons.admin);
    assert.equal(r.status, 400);
    const erreur = (r.json as { error: string }).error;
    assert.match(erreur, /LXC/);
    assert.match(erreur, /docker compose/, 'un conteneur n’a pas deploy/lxc/update.sh : lui conseiller serait mentir');
  });

  it('refuse quand la mise à jour a été explicitement coupée', async () => {
    poserHelper();
    couper('false');
    const r = await appel(c.base, 'POST', '/system/update', { password: MDP_ADMIN }, c.jetons.admin);
    assert.equal(r.status, 400);
    assert.match((r.json as { error: string }).error, /FOYER_SELF_UPDATE/);
    couper(undefined);
  });

  it('exige toujours le mot de passe, helper ou pas', async () => {
    poserHelper();
    const r = await appel(c.base, 'POST', '/system/update', { password: 'pas-le-bon' }, c.jetons.admin);
    assert.equal(r.status, 403);
    assert.equal(fs.existsSync(trigger), false);
  });

  it('reste interdite à un membre ordinaire', async () => {
    poserHelper();
    const r = await appel(c.base, 'POST', '/system/update', { password: 'MotDePasseSolide2' }, c.jetons.membre);
    assert.equal(r.status, 403);
    assert.equal(fs.existsSync(trigger), false);
  });

  it('canal préversions : refuse plutôt que d’installer autre chose que l’affiché', async () => {
    // Le dépôt est introuvable, donc la version cible l'est aussi. Sur ce canal,
    // laisser le helper choisir installerait la stable pendant que l'écran
    // annonce une rc : mieux vaut ne rien faire et le dire.
    poserHelper();
    fs.rmSync(trigger, { force: true });
    assert.equal((await canal('prerelease')).status, 200);
    const r = await appel(c.base, 'POST', '/system/update', { password: MDP_ADMIN }, c.jetons.admin);
    assert.equal(r.status, 502);
    assert.equal(fs.existsSync(trigger), false, 'rien n’est déclenché quand la cible est inconnue');
  });

  it('canal stable : laisse le helper retrouver son calcul si GitHub ne répond pas', async () => {
    poserHelper();
    fs.rmSync(trigger, { force: true });
    assert.equal((await canal('latest')).status, 200);
    const r = await appel(c.base, 'POST', '/system/update', { password: MDP_ADMIN }, c.jetons.admin);
    assert.equal(r.status, 200);
    assert.equal(fs.existsSync(trigger), true);
    assert.doesNotMatch(fs.readFileSync(trigger, 'utf8'), /^tag=/,
      'sans version résolue, le déclencheur ne nomme rien et le helper décide comme avant');
    fs.rmSync(trigger, { force: true });
  });
});
