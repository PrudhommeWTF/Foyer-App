// Un endpoint protégé, appelé sans jeton, répond 401.
//
// Le cœur de ce fichier n'est pas la boucle : c'est la liste PUBLICS ci-dessous.
// Elle est écrite à la main, et le test échoue dès qu'une route de l'API n'y
// figure pas et répond autre chose que 401. Ajouter une route publique demande
// donc de l'inscrire ici, c'est-à-dire de l'assumer devant la CI, plutôt que de
// la laisser passer inaperçue dans une revue.
//
// C'est le garde qui manquait le jour où `POST /auth/register` a suffi à lire
// l'agenda des enfants et l'adresse de la maison.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

/**
 * Les seules routes que l'API sert sans jeton, et pourquoi.
 *
 * `feed.ics` est le seul cas où le secret voyage dans l'URL : les agendas de
 * Google et d'Apple ne savent pas porter d'en-tête d'autorisation. Sans jeton
 * valide, elle répond 404 et ne dit rien du foyer.
 */
const PUBLICS: { chemin: string; method: string; pourquoi: string; attendu: number[] }[] = [
  { method: 'GET', chemin: '/health', pourquoi: 'sonde du conteneur et du proxy', attendu: [200] },
  { method: 'GET', chemin: '/setup/status', pourquoi: 'l’écran doit savoir s’il faut proposer l’assistant', attendu: [200] },
  { method: 'POST', chemin: '/setup', pourquoi: 'création du foyer, refusée dès qu’un compte existe', attendu: [409] },
  { method: 'POST', chemin: '/auth/login', pourquoi: 'formulaire de connexion', attendu: [400, 401] },
  { method: 'POST', chemin: '/auth/register', pourquoi: 'inscription, coupée par défaut', attendu: [400, 403] },
  { method: 'GET', chemin: '/calendar/feed.ics?token=', pourquoi: 'flux ICS, le jeton est le secret', attendu: [404] },
];

/** Ce que l'API expose, hors routes publiques. Une omission ici est un trou. */
const PROTEGES: [string, string][] = [
  ['GET', '/state'], ['PUT', '/state'], ['GET', '/live'], ['GET', '/me'], ['PUT', '/me/credentials'],
  ['GET', '/members/accounts'], ['POST', '/members/m1/account'], ['PUT', '/members/m1/account'], ['DELETE', '/members/m1/account'],
  ['GET', '/home/rules'], ['GET', '/calendar/school-holidays'], ['GET', '/calendar/ics'], ['POST', '/calendar/ics/regenerate'],
  ['GET', '/system/version'], ['GET', '/system/update-check'], ['GET', '/system/update-status'],
  ['POST', '/system/update'], ['GET', '/system/status'],
  ['POST', '/system/backup'], ['GET', '/system/backup/foyer-2026-01-01-1200.db'], ['DELETE', '/system/backup/foyer-2026-01-01-1200.db'],
  ['GET', '/settings'], ['PATCH', '/settings'], ['GET', '/settings/export'], ['POST', '/settings/import'],
  ['GET', '/files/1'], ['POST', '/files?owner=document&id=d1'], ['DELETE', '/files/1'],
  ['POST', '/shopping/ops'], ['POST', '/tasks/ops'], ['POST', '/recipes/import'],
  ['GET', '/push/status'], ['POST', '/push/subscribe'], ['POST', '/push/unsubscribe'], ['DELETE', '/push/subscribe/1'], ['POST', '/push/test'],
  ['GET', '/finances/bootstrap'], ['GET', '/finances/home?month=2026-01'], ['GET', '/finances/dashboard?month=2026-01'],
  ['GET', '/finances/export.json'], ['GET', '/finances/export.csv'], ['POST', '/finances/restore'],
  ['GET', '/finances/accounts'], ['POST', '/finances/accounts'], ['PUT', '/finances/accounts/1'], ['DELETE', '/finances/accounts/1'],
  ['GET', '/finances/accounts/1/schedule'], ['POST', '/finances/accounts/1/aliases'], ['DELETE', '/finances/aliases/1'],
  ['GET', '/finances/categories'], ['POST', '/finances/categories'], ['PUT', '/finances/categories/1'], ['DELETE', '/finances/categories/1'],
  ['GET', '/finances/transactions'], ['POST', '/finances/transactions'], ['PUT', '/finances/transactions/1'], ['DELETE', '/finances/transactions/1'],
  ['GET', '/finances/summary?month=2026-01'],
  ['GET', '/finances/contracts'], ['POST', '/finances/contracts'], ['PUT', '/finances/contracts/1'], ['DELETE', '/finances/contracts/1'],
  ['POST', '/finances/assets'], ['PUT', '/finances/assets/1'], ['DELETE', '/finances/assets/1'],
  ['POST', '/finances/savings'], ['PUT', '/finances/savings/1'], ['DELETE', '/finances/savings/1'], ['POST', '/finances/savings/1/task'],
  ['GET', '/finances/readings'], ['POST', '/finances/readings'], ['PUT', '/finances/readings/1'], ['DELETE', '/finances/readings/1'],
  ['GET', '/finances/rules'], ['POST', '/finances/rules'], ['PUT', '/finances/rules/1'], ['DELETE', '/finances/rules/1'],
  ['POST', '/finances/rules/1/move'], ['POST', '/finances/rules/preview'], ['POST', '/finances/rules/apply'], ['GET', '/finances/tags'],
  ['GET', '/finances/attachments?owner=transaction&id=1'], ['POST', '/finances/attachments?owner=transaction&id=1'],
  ['GET', '/finances/attachments/1'], ['DELETE', '/finances/attachments/1'], ['GET', '/finances/attachments-check'],
  ['POST', '/finances/imports'], ['GET', '/finances/imports'], ['GET', '/finances/imports/1/preview'],
  ['POST', '/finances/imports/1/accounts'], ['POST', '/finances/imports/1/commit'], ['DELETE', '/finances/imports/1'],
  ['GET', '/finances/transfers'], ['GET', '/finances/transfers/candidates'], ['POST', '/finances/transfers'],
  ['DELETE', '/finances/transfers/tg_0123456789abcdef'],
];

describe('sans jeton, l’API ne dit rien', () => {
  for (const [method, chemin] of PROTEGES) {
    it(`${method} ${chemin} → 401`, async () => {
      const r = await appel(ctx.base, method, chemin);
      assert.equal(r.status, 401, `${method} ${chemin} a répondu ${r.status} : cette route est ouverte sans authentification`);
    });
  }
});

describe('les routes publiques, et seulement celles-là', () => {
  for (const p of PUBLICS) {
    it(`${p.method} ${p.chemin} reste public (${p.pourquoi})`, async () => {
      const r = await appel(ctx.base, p.method, p.chemin, p.method === 'POST' ? {} : undefined);
      assert.ok(p.attendu.includes(r.status), `attendu ${p.attendu.join(' ou ')}, reçu ${r.status}`);
    });
  }

  it('le flux ICS ne livre rien sur un jeton faux', async () => {
    const r = await appel(ctx.base, 'GET', '/calendar/feed.ics?token=0000000000000000000000000000000000000');
    assert.equal(r.status, 404);
    assert.doesNotMatch(String(r.json), /BEGIN:VCALENDAR/);
  });

  it('l’assistant de configuration est fermé une fois le foyer créé', async () => {
    const r = await appel(ctx.base, 'POST', '/setup', {
      household: { name: 'Foyer pirate' },
      admin: { name: 'Pirate', email: 'pirate@example.fr', password: 'MotDePasseSolide9' },
    });
    assert.equal(r.status, 409);
  });
});
