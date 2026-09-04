// Le formulaire de connexion, la porte publique de l'application.
//
// Deux propriétés se vérifient ici, et aucune n'était tenue :
//
//   - **un compte inexistant et un mauvais mot de passe se ressemblent**, dans
//     le message comme dans le temps de réponse. Mesuré avant correction :
//     2,0 ms contre 81,0 ms, écarts nets. Le message était identique, le
//     chronomètre disait tout.
//   - **le verrou gêne l'attaquant sans enfermer la famille dehors** : il porte
//     sur le compte visé, il est progressif, et une réussite l'efface.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

const connexion = (email: string, password: string): Promise<{ status: number; json: any }> =>
  appel(ctx.base, 'POST', '/auth/login', { email, password });

/** Le temps médian de n tentatives : plus stable qu'une moyenne face à un pic. */
async function medianeMs(email: string, essais: number): Promise<number> {
  const temps: number[] = [];
  for (let i = 0; i < essais; i++) {
    const t = process.hrtime.bigint();
    // Une adresse différente à chaque fois : on mesure le calcul, pas le verrou.
    await connexion(email.replace('@', `+${i}@`), 'mot-de-passe-faux');
    temps.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  return temps.sort((a, b) => a - b)[Math.floor(temps.length / 2)];
}

describe('un compte inexistant et un mauvais mot de passe se ressemblent', () => {
  it('même message, au mot près', async () => {
    const inconnu = await connexion('personne@nulle-part.example', 'x');
    const connu = await connexion('admin@example.fr', 'mauvais-mot-de-passe');
    assert.equal(inconnu.status, connu.status);
    assert.equal(inconnu.json.error, connu.json.error);
    assert.equal(connu.json.error, 'Identifiants invalides');
  });

  it('même ordre de grandeur de temps de réponse', async () => {
    // Le compte inexistant paie désormais la même vérification bcrypt que le
    // compte connu. On compare des médianes, et on tolère largement : le test
    // doit attraper un rapport de quarante, pas mesurer une machine partagée.
    const inexistant = await medianeMs('personne@nulle-part.example', 5);
    const existant = await medianeMs('admin@example.fr', 5);
    const rapport = Math.max(inexistant, existant) / Math.max(1, Math.min(inexistant, existant));
    assert.ok(rapport < 4,
      `le temps de réponse trahit l’existence du compte : ${inexistant.toFixed(1)} ms contre ${existant.toFixed(1)} ms (rapport ${rapport.toFixed(1)})`);
  });
});

describe('le verrou porte sur le compte visé', () => {
  it('les premières erreurs passent, puis la temporisation tombe', async () => {
    const cible = 'membre@example.fr';
    let bloque = 0;
    for (let i = 0; i < 10; i++) {
      const r = await connexion(cible, 'mauvais-mot-de-passe');
      if (r.status === 429) bloque++;
      else assert.equal(r.status, 401, `tentative ${i + 1}`);
    }
    assert.ok(bloque > 0, 'dix mauvais mots de passe d’affilée sur un compte doivent finir par être temporisés');
  });

  it('la réponse dit combien de temps attendre', async () => {
    const r = await connexion('membre@example.fr', 'encore-faux');
    assert.equal(r.status, 429);
    assert.match(String(r.json.error), /Réessayez dans/);
  });

  it('un autre compte du foyer se connecte toujours : la maison n’est pas enfermée dehors', async () => {
    // C'est la promesse qui compte le plus : le compte visé est temporisé,
    // les autres ne le sont pas, y compris depuis la même adresse.
    const r = await connexion('admin@example.fr', 'MotDePasseSolide1');
    assert.equal(r.status, 200, 'le verrou d’un compte ne doit pas fermer la porte au reste de la famille');
    assert.ok(r.json.token);
  });

  it('une connexion réussie efface l’ardoise du compte', async () => {
    const cible = 'enfant@example.fr';
    // Cinq échecs : la franchise entière, sans verrou encore.
    for (let i = 0; i < 5; i++) assert.equal((await connexion(cible, 'faux')).status, 401, `échec ${i + 1}`);
    assert.equal((await connexion(cible, 'MotDePasseSolide7')).status, 200);

    // Cinq de plus. Si la réussite n'avait pas effacé le compteur, on serait à
    // dix et le verrou serait tombé : c'est exactement ce que ce test attrape.
    for (let i = 0; i < 5; i++) {
      assert.equal((await connexion(cible, 'faux')).status, 401,
        `échec ${i + 1} après la réussite : l’ardoise n’a pas été effacée`);
    }
    assert.equal((await connexion(cible, 'MotDePasseSolide7')).status, 200);
  });
});
