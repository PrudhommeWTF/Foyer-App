// La temporisation des tentatives de connexion, éprouvée sur ses deux promesses
// contradictoires : gêner un attaquant sans verrouiller la famille dehors.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SEUILS_ADRESSE, SEUILS_COMPTE, Throttle, messageAttente } from '../src/auth/throttle';

const T0 = 1_700_000_000_000;

describe('le verrou est progressif, pas binaire', () => {
  it('les premiers échecs ne coûtent rien : on se trompe de mot de passe, c’est la vie', () => {
    const t = new Throttle(SEUILS_COMPTE);
    for (let i = 0; i < SEUILS_COMPTE.franchise; i++) {
      assert.equal(t.echec('marie@foyer.fr', T0), 0, `échec ${i + 1}`);
    }
    assert.equal(t.attente('marie@foyer.fr', T0), 0, 'la franchise ne verrouille personne');
  });

  it('au-delà, l’attente double à chaque échec', () => {
    const t = new Throttle(SEUILS_COMPTE);
    for (let i = 0; i < SEUILS_COMPTE.franchise; i++) t.echec('marie@foyer.fr', T0);
    assert.equal(t.echec('marie@foyer.fr', T0), 30_000);
    assert.equal(t.echec('marie@foyer.fr', T0), 60_000);
    assert.equal(t.echec('marie@foyer.fr', T0), 120_000);
  });

  it('l’attente est plafonnée : elle gêne, elle ne condamne pas', () => {
    const t = new Throttle(SEUILS_COMPTE);
    for (let i = 0; i < 40; i++) t.echec('marie@foyer.fr', T0);
    assert.equal(t.echec('marie@foyer.fr', T0), SEUILS_COMPTE.delaiMaxMs);
  });

  it('le temps passe, le verrou tombe', () => {
    const t = new Throttle(SEUILS_COMPTE);
    for (let i = 0; i < 8; i++) t.echec('marie@foyer.fr', T0);
    assert.ok(t.attente('marie@foyer.fr', T0) > 0);
    assert.equal(t.attente('marie@foyer.fr', T0 + 20 * 60_000), 0);
  });

  it('une réussite efface l’ardoise : c’était bien la bonne personne', () => {
    const t = new Throttle(SEUILS_COMPTE);
    for (let i = 0; i < 8; i++) t.echec('marie@foyer.fr', T0);
    assert.ok(t.attente('marie@foyer.fr', T0) > 0);
    t.succes('marie@foyer.fr');
    assert.equal(t.attente('marie@foyer.fr', T0), 0);
    assert.equal(t.echec('marie@foyer.fr', T0), 0, 'et le compteur repart de zéro');
  });

  it('une longue accalmie remet le compteur à zéro', () => {
    const t = new Throttle(SEUILS_COMPTE);
    for (let i = 0; i < 8; i++) t.echec('marie@foyer.fr', T0);
    // Bien après l'oubli : le premier échec suivant est de nouveau gratuit.
    assert.equal(t.echec('marie@foyer.fr', T0 + SEUILS_COMPTE.oubliMs + 1), 0);
  });
});

describe('les deux compteurs ne servent pas la même chose', () => {
  it('viser un compte se paie vite, partager une adresse se paie tard', () => {
    assert.ok(SEUILS_COMPTE.franchise < SEUILS_ADRESSE.franchise,
      'un attaquant garde sa cible et change d’adresse : c’est la cible qu’il faut serrer');
    assert.ok(SEUILS_ADRESSE.franchise >= 30,
      'toute la famille peut sortir par la même adresse : la verrouiller dehors est un dégât, pas une protection');
  });

  it('deux comptes visés depuis la même adresse ne se contaminent pas', () => {
    const t = new Throttle(SEUILS_COMPTE);
    for (let i = 0; i < 10; i++) t.echec('marie@foyer.fr', T0);
    assert.ok(t.attente('marie@foyer.fr', T0) > 0);
    assert.equal(t.attente('thomas@foyer.fr', T0), 0, 'le verrou d’un compte n’en ferme pas un autre');
  });
});

describe('la table ne grossit pas indéfiniment', () => {
  it('les ardoises oubliées sont retirées', () => {
    const t = new Throttle(SEUILS_COMPTE);
    for (let i = 0; i < 200; i++) t.echec(`robot${i}@nulle-part.example`, T0);
    assert.equal(t.taille, 200);
    // Une tentative bien plus tard : le ménage passe et n'en garde qu'une.
    t.echec('robot@nulle-part.example', T0 + SEUILS_COMPTE.oubliMs + 1);
    assert.equal(t.taille, 1);
  });

  it('une rafale sur des milliers de clés est bornée', () => {
    const t = new Throttle(SEUILS_COMPTE, 100);
    for (let i = 0; i < 500; i++) t.echec(`robot${i}@nulle-part.example`, T0 + i);
    assert.ok(t.taille <= 100, `table à ${t.taille} entrées`);
  });
});

describe('le message dit combien de temps attendre', () => {
  it('en secondes en dessous d’une minute, en minutes au-dessus', () => {
    assert.match(messageAttente(30_000), /30 secondes/);
    assert.match(messageAttente(1_000), /1 seconde\b/);
    assert.match(messageAttente(120_000), /2 minutes/);
  });
});
