// Le contact déclaré aux services push, et ce qu'un refus raconte.
//
// Ce fichier existe à cause d'un cas réel : Safari sur Mac, « échec : HTTP 403 »,
// et rien d'autre à se mettre sous la dent. Deux défauts se cachaient derrière.
//
//   - Le contact par défaut, « mailto:foyer@localhost », passe au travers du
//     garde de la bibliothèque : sur une adresse « mailto: », URL.hostname est
//     vide, donc son contrôle du « localhost » ne se déclenche jamais. Apple,
//     lui, refuse un contact qui ne mène nulle part.
//   - Le corps de la réponse, qui **nomme** la cause, était jeté. « HTTP 403 »
//     tout seul n'est pas diagnosticable.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FALLBACK_SUBJECT, reasonOf, resolveVapidSubject, subjectProblem } from '../src/notify/push';

describe('ce qui empêche un contact de servir', () => {
  it('accepte une adresse réelle', () => {
    assert.equal(subjectProblem('mailto:vous@exemple.fr'), '');
    assert.equal(subjectProblem('https://foyer.exemple.fr'), '');
    assert.equal(subjectProblem('https://github.com/PrudhommeWTF/Foyer-App'), '');
  });

  it('refuse une adresse locale, y compris en « mailto: » où la bibliothèque ne voit rien', () => {
    // C'est exactement le défaut historique de Foyer.
    assert.match(subjectProblem('mailto:foyer@localhost'), /adresse locale/);
    assert.match(subjectProblem('https://localhost:8099'), /adresse locale/);
    assert.match(subjectProblem('mailto:foyer@foyer.local'), /adresse locale/);
  });

  it('refuse un domaine qui ne mène nulle part', () => {
    assert.match(subjectProblem('mailto:foyer@machine'), /sans point/);
    assert.match(subjectProblem('mailto:foyer'), /aucun domaine/);
  });

  it('refuse ce qui n’est ni https ni mailto', () => {
    assert.match(subjectProblem('http://foyer.exemple.fr'), /https|mailto/);
    assert.match(subjectProblem('foyer.exemple.fr'), /pas une adresse valide/);
  });
});

describe('le contact retenu', () => {
  it('la variable d’environnement gagne quand elle tient la route', () => {
    const c = resolveVapidSubject({ env: 'mailto:vous@exemple.fr', publicUrl: 'https://foyer.exemple.fr' });
    assert.equal(c.subject, 'mailto:vous@exemple.fr');
    assert.equal(c.rejected, null);
  });

  it('à défaut, l’adresse publique du foyer sert de contact', () => {
    const c = resolveVapidSubject({ publicUrl: 'https://foyer.exemple.fr' });
    assert.equal(c.subject, 'https://foyer.exemple.fr');
  });

  it('un contact local est écarté **en le nommant**, et l’adresse publique prend le relais', () => {
    const c = resolveVapidSubject({ env: 'mailto:foyer@localhost', publicUrl: 'https://foyer.exemple.fr' });
    assert.equal(c.subject, 'https://foyer.exemple.fr');
    assert.equal(c.rejected?.value, 'mailto:foyer@localhost');
    assert.match(c.rejected!.reason, /403/, 'le message doit dire ce que ça provoque, pas seulement que c’est refusé');
  });

  it('sans rien de valable, le dépôt du projet sert de contact plutôt qu’une adresse morte', () => {
    const c = resolveVapidSubject({ env: 'mailto:foyer@localhost' });
    assert.equal(c.subject, FALLBACK_SUBJECT);
    assert.equal(subjectProblem(c.subject), '', 'le repli doit lui-même être acceptable');
  });

  it('une adresse publique locale ne remplace pas un contact valable', () => {
    const c = resolveVapidSubject({ env: 'mailto:vous@exemple.fr', publicUrl: 'http://192.168.1.20:8099' });
    assert.equal(c.subject, 'mailto:vous@exemple.fr');
  });

  it('rien de posé du tout : le repli, sans rien à signaler', () => {
    const c = resolveVapidSubject({});
    assert.equal(c.subject, FALLBACK_SUBJECT);
    assert.equal(c.rejected, null);
  });
});

describe('ce qu’un refus raconte', () => {
  it('extrait la raison du corps JSON, celle qui nomme la cause', () => {
    assert.equal(reasonOf({ statusCode: 403, body: '{"reason":"BadJwtToken"}' }), ' : BadJwtToken');
    assert.equal(reasonOf({ statusCode: 403, body: '{"reason":"VapidPkHashMismatch"}' }), ' : VapidPkHashMismatch');
  });

  it('recopie un corps non JSON plutôt que de le perdre', () => {
    assert.equal(reasonOf({ statusCode: 400, body: 'Invalid TTL header' }), ' : Invalid TTL header');
  });

  it('un corps très long est tronqué : ce n’est pas une colonne de base de données', () => {
    const r = reasonOf({ statusCode: 500, body: 'x'.repeat(400) });
    assert.ok(r.length < 130, r.length + ' caractères');
  });

  it('sans corps, rien n’est ajouté : « HTTP 403 » reste « HTTP 403 »', () => {
    assert.equal(reasonOf({ statusCode: 403 }), '');
    assert.equal(reasonOf(new Error('réseau coupé')), '');
  });
});
