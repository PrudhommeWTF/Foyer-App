// Les limites de taille de corps sont désormais posées PAR ROUTE.
//
// Avant, un express.json global marquait la requête (req._body) au premier
// passage, si bien que la limite de 64 Mo de /finances/restore était sans effet
// (plafonnée à 4 Mo) et rejetée en 413. Ce fichier éprouve les deux bouts :
// /finances/restore accepte un gros corps, /state garde sa borne à 4 Mo avec son
// message dédié.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
before(async () => { ctx = await demarrer(); });
after(async () => { await arreter(ctx); });

const post = (path: string, body: string, token: string): Promise<Response> =>
  fetch(ctx.base + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body });
const put = (path: string, body: string, token: string): Promise<Response> =>
  fetch(ctx.base + path, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body });

describe('limites de corps par route', () => {
  it('/finances/restore accepte un corps de 5 Mo (n’est plus plafonné à 4 Mo)', async () => {
    // Un corps volumineux mais invalide : ce qu'on vérifie, c'est qu'il n'est PAS
    // rejeté sur sa taille (413). La validation du contenu répond autre chose.
    const body = JSON.stringify({ tables: {}, filler: 'x'.repeat(5 * 1024 * 1024) });
    assert.ok(body.length > 4 * 1024 * 1024, 'le corps doit dépasser l’ancienne borne de 4 Mo');
    const res = await post('/finances/restore', body, ctx.jetons.admin);
    assert.notEqual(res.status, 413, 'un corps de 5 Mo ne doit plus être rejeté sur sa taille');
  });

  it('/state garde sa borne à 4 Mo, avec son message dédié', async () => {
    const body = JSON.stringify({ version: 1, state: { blob: 'x'.repeat(5 * 1024 * 1024) } });
    const res = await put('/state', body, ctx.jetons.admin);
    assert.equal(res.status, 413, 'un document de plus de 4 Mo doit être refusé');
    const json = await res.json();
    assert.match(String(json.error), /document du foyer/, 'le message 413 dédié doit remonter');
  });
});
