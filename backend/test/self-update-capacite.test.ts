// La mise à jour en un clic se constate, elle ne se déclare plus.
//
// Avant, une seule variable décidait : `FOYER_SELF_UPDATE`. Elle pouvait mentir
// dans les deux sens, et les deux mensonges existaient pour de bon :
//
//   - posée à vrai sur une machine sans helper root (LXC réinstallé autrement,
//     fichier effacé), l'écran offrait un bouton qui écrivait un déclencheur que
//     personne ne lit : rien ne se passait, sans un mot d'explication ;
//   - absente en Docker, où elle l'est toujours, l'écran conseillait
//     « bash deploy/lxc/update.sh », un script qui n'existe pas dans l'image.
//
// Ce qui décide maintenant, c'est le fichier que systemd exécute vraiment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { HELPER_DEFAUT, selfUpdateCapacite } from '../src/system/self-update';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-maj-'));
const helper = path.join(dir, 'foyer-self-update.sh');
const poser = (): void => fs.writeFileSync(helper, '#!/bin/sh\n');
const retirer = (): void => { try { fs.unlinkSync(helper); } catch { /* déjà absent */ } };

describe('selfUpdateCapacite', () => {
  it('cherche le helper posé par l’installeur LXC', () => {
    assert.equal(selfUpdateCapacite().helper, HELPER_DEFAUT);
    assert.equal(HELPER_DEFAUT, '/usr/local/sbin/foyer-self-update.sh');
  });

  it('sans helper : refuse, et dit que le dispositif manque', () => {
    retirer();
    const cap = selfUpdateCapacite({ helper });
    assert.equal(cap.possible, false);
    assert.equal(cap.raison, 'absente');
    assert.equal(cap.helper, helper, 'le chemin inspecté est rendu : un dépannage ne doit pas être une devinette');
  });

  it('une déclaration ne remplace pas le dispositif', () => {
    // Le premier mensonge : la variable dit oui, la machine ne sait pas faire.
    retirer();
    for (const declare of ['1', 'true', 'yes', 'on']) {
      const cap = selfUpdateCapacite({ refus: declare, helper });
      assert.equal(cap.possible, false, declare);
      assert.equal(cap.raison, 'absente', declare);
    }
  });

  it('avec le helper : accepte sans rien avoir à déclarer', () => {
    // Le second mensonge : la machine sait faire, et il fallait le lui dire.
    poser();
    assert.deepEqual(selfUpdateCapacite({ helper }), { possible: true, helper });
  });

  it('FOYER_SELF_UPDATE reste un interrupteur d’arrêt', () => {
    poser();
    for (const declare of ['0', 'false', 'no', 'off', 'FALSE', ' false ']) {
      const cap = selfUpdateCapacite({ refus: declare, helper });
      assert.equal(cap.possible, false, declare);
      assert.equal(cap.raison, 'coupee', declare);
    }
  });

  it('une valeur incompréhensible laisse le constat trancher', () => {
    // Une faute de frappe dans /etc/foyer/foyer.env ne doit ni activer ni
    // désactiver quoi que ce soit en silence : le fichier reste le juge.
    poser();
    assert.equal(selfUpdateCapacite({ refus: 'peut-être', helper }).possible, true);
    retirer();
    assert.equal(selfUpdateCapacite({ refus: 'peut-être', helper }).possible, false);
  });

  it('un répertoire portant le nom du helper ne compte pas pour un script', () => {
    retirer();
    fs.mkdirSync(helper);
    try { assert.equal(selfUpdateCapacite({ helper }).possible, false); }
    finally { fs.rmdirSync(helper); }
  });
});
