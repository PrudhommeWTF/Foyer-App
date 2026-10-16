// Module École, deuxième tranche, de bout en bout : vraies routes, vrais gardes,
// faux serveur ÉcoleDirecte local. On y rejoue la recette : devoirs projetés en
// tâches dans « Devoirs de … », « fait » dans les deux sens sans boucle ni
// décochage silencieux, envoi qui échoue puis repart, devoir modifié, tâche
// supprimée jamais recréée, devoir disparu, cours importés, et un enfant qui
// ne voit que ce qui le concerne.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
import { FauxEd, fauxEcoleDirecte, jourParis } from './ecole-faux-serveur';

const CLE = 'cle-de-chiffrement-de-test-de-plus-de-32-caracteres';

interface Devoir { id: number; studentId: number; due: string; subject: string; html: string; text: string; isTest: boolean; done: boolean; pending: boolean; doneError: string | null; modifiedAt: string | null; taskId: string | null; }
interface Tache { id: string; listId: string; text: string; note?: string; who: string[]; due: string | null; done: boolean; edId?: number; via?: string; }

describe('École : devoirs, tâches et emploi du temps (HTTP)', () => {
  let ctx: Contexte;
  let ed: FauxEd;
  let svc: typeof import('../src/ecole/service');
  let compte = 0;
  let lena = '';
  let camille = '';
  let eleveLena = 0;
  let eleveNolan = 0;

  before(async () => {
    ed = await fauxEcoleDirecte();
    process.env.FOYER_SECRET_KEY = CLE;
    process.env.FOYER_ED_API_BASE = ed.base;
    ctx = await demarrer();
    svc = await import('../src/ecole/service');
  });
  after(async () => { await arreter(ctx); await ed.fermer(); });

  const A = () => ctx.jetons.admin;
  const E = () => ctx.jetons.enfant;
  const etat = async () => (await appel(ctx.base, 'GET', '/state', undefined, A())).json;
  const taches = async (): Promise<Tache[]> => (await etat()).state.tasks;
  const listes = async (): Promise<{ id: string; name: string; kind: string; scope: string }[]> => (await etat()).state.taskLists;
  const vue = async (jeton = A()) => (await appel(ctx.base, 'GET', '/ecole/vue', undefined, jeton)).json;
  const devoir = async (edId: number): Promise<Devoir> => {
    const db = (await import('../src/db')).db;
    const row = db.prepare('SELECT id FROM ed_homework WHERE ed_id = ?').get(edId) as { id: number };
    return (await vue()).homework.find((h: Devoir) => h.id === row.id);
  };
  const tacheDe = async (edId: number): Promise<Tache | undefined> => { const d = await devoir(edId); return (await taches()).find((t) => t.id === d?.taskId); };
  const synchro = () => svc.connect(compte);

  it('mise en place : module actif, compte connecté, Léna associée à Lena, Nolan-Pierre à Camille', async () => {
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEcole: true } }, A());
    const r = await appel(ctx.base, 'POST', '/ecole/comptes', { label: 'Collège', identifiant: 'parent.famille', motdepasse: 'mot de passe & 100%' }, A());
    compte = r.json.account.id;
    const ok = await appel(ctx.base, 'POST', `/ecole/comptes/${compte}/qcm`, { choix: 2 }, A());
    assert.equal(ok.json.result.kind, 'ok');
    const membres = (await etat()).state.members;
    lena = membres.find((m: { name: string }) => m.name === 'Lena').id;
    camille = membres.find((m: { name: string }) => m.name === 'Camille').id;
    [eleveLena, eleveNolan] = ok.json.account.students.map((s: { id: number }) => s.id);
    await appel(ctx.base, 'PUT', `/ecole/eleves/${eleveLena}`, { action: 'confirmer' }, A());
    await appel(ctx.base, 'PUT', `/ecole/eleves/${eleveNolan}`, { action: 'associer', memberId: camille }, A());
    assert.equal((await vue()).homework.length, 0, 'rien avant la première synchronisation des données');
  });

  it('première synchronisation : la liste « Devoirs de Lena », une tâche par devoir à venir, rien au-delà de l’horizon', async () => {
    const r = await synchro();
    assert.deepEqual(r, { kind: 'ok', students: 2, data: { ok: 2, failed: 0 } });
    const l = (await listes()).find((x) => x.kind === 'devoirs')!;
    assert.equal(l.name, 'Devoirs de Lena');
    assert.equal(l.scope, 'shared');
    const t = (await taches()).filter((x) => x.listId === l.id);
    assert.equal(t.length, 3, 'J+1 (deux) et J+3 ; J+40 est hors de la fenêtre de 14 jours');
    const maths = t.find((x) => x.text.startsWith('Mathematiques'))!;
    assert.equal(maths.text, 'Mathematiques : Exercices 12 et 13 p. 45');
    assert.deepEqual(maths.who, [lena]);
    assert.equal(maths.due, jourParis(1));
    assert.equal(maths.via, 'ÉcoleDirecte');
    assert.ok(maths.edId);
    assert.match(maths.note!, /Corrigé sur le site \(https:\/\/exemple\.fr\/corrige\)/);
    assert.doesNotMatch(maths.note!, /alert/);
    assert.equal(t.find((x) => x.text.startsWith('Interro'))!.text, 'Interro d’anglais lv1 : Interrogation sur le prétérit, unit 3');
    assert.equal(t.find((x) => x.text.startsWith('Histoire'))!.done, true, 'déjà fait dans ÉcoleDirecte : tâche cochée d’emblée');
    assert.equal(ed.faits.length, 0, 'rien à envoyer');
  });

  it('écran École : énoncé nettoyé (lien gardé, script retiré), badge interrogation ; 210 pour Nolan-Pierre n’est pas une erreur', async () => {
    const v = await vue();
    const maths = v.homework.find((h: Devoir) => h.subject === 'MATHEMATIQUES');
    assert.match(maths.html, /<a href="https:\/\/exemple\.fr\/corrige" target="_blank" rel="noopener noreferrer">le site<\/a>/);
    assert.doesNotMatch(maths.html, /script/);
    assert.equal(v.homework.find((h: Devoir) => h.subject === 'ANGLAIS LV1').isTest, true);
    const nolan = v.students.find((s: { id: number }) => s.id === eleveNolan);
    assert.ok(nolan.dataOkAt, 'vacances : synchronisé sans erreur');
    assert.equal(nolan.dataError, null);
  });

  it('cours importés : annulé signalé, événement sur deux jours écarté, demi-pension par défaut', async () => {
    const r = await appel(ctx.base, 'GET', '/ecole/cours', undefined, A());
    const l = r.json.lessons.filter((x: { studentId: number }) => x.studentId === eleveLena);
    assert.equal(l.length, 6);
    assert.equal(l.find((x: { subject: string }) => x.subject === 'PHYSIQUE-CHIMIE').cancelled, true);
    assert.equal(l[0].memberId, lena);
    assert.equal(l[0].halfBoard, true);
    await appel(ctx.base, 'PUT', `/ecole/eleves/${eleveLena}`, { action: 'demi-pension', halfBoard: false }, A());
    assert.equal((await appel(ctx.base, 'GET', '/ecole/cours', undefined, A())).json.lessons[0].halfBoard, false);
    await appel(ctx.base, 'PUT', `/ecole/eleves/${eleveLena}`, { action: 'demi-pension', halfBoard: true }, A());
  });

  it('un enfant ne voit que lui : ni les devoirs ni les cours de l’autre élève (403)', async () => {
    const v = await vue(E());
    assert.deepEqual(v.students.map((s: { id: number }) => s.id), [eleveLena]);
    assert.ok(v.homework.every((h: Devoir) => h.studentId === eleveLena));
    assert.equal((await appel(ctx.base, 'GET', `/ecole/eleves/${eleveNolan}/devoirs`, undefined, E())).status, 403);
    assert.equal((await appel(ctx.base, 'GET', `/ecole/eleves/${eleveNolan}/cours`, undefined, E())).status, 403);
    assert.equal((await appel(ctx.base, 'GET', `/ecole/eleves/${eleveLena}/devoirs`, undefined, E())).status, 200);
    assert.ok((await appel(ctx.base, 'GET', '/ecole/cours', undefined, E())).json.lessons.every((l: { studentId: number }) => l.studentId === eleveLena));
    assert.equal((await appel(ctx.base, 'GET', '/ecole/etat', undefined, E())).status, 403, 'la configuration reste aux administrateurs');
  });

  it('« Fait » coché par l’enfant dans l’écran École : la tâche se coche, « non transmis » jusqu’au passage suivant, puis envoyé', async () => {
    const d = await devoir(5001);
    const r = await appel(ctx.base, 'POST', `/ecole/devoirs/${d.id}/fait`, { fait: true }, E());
    assert.equal(r.status, 200);
    assert.equal(r.json.homework.done, true);
    assert.equal(r.json.homework.pending, true);
    assert.equal((await tacheDe(5001))!.done, true, 'la case et la tâche sont la même information');
    await synchro();
    assert.deepEqual(ed.faits.at(-1), { eleve: 3000001, faits: [5001], nonFaits: [] });
    assert.equal((await devoir(5001)).pending, false);
    const n = ed.faits.length;
    await synchro();
    assert.equal(ed.faits.length, n, 'pas de renvoi en boucle');
  });

  it('coché dans ÉcoleDirecte : la tâche se coche au passage suivant ; décoché dans ÉcoleDirecte : elle se décoche, rien ne repart', async () => {
    ed.cahier[jourParis(1)].find((r) => r.idDevoir === 5002)!.effectue = true;
    await synchro();
    assert.equal((await tacheDe(5002))!.done, true);
    ed.cahier[jourParis(3)].find((r) => r.idDevoir === 5003)!.effectue = false;
    const n = ed.faits.length;
    await synchro();
    assert.equal((await tacheDe(5003))!.done, false, 'Foyer suit ÉcoleDirecte');
    assert.equal((await devoir(5003)).done, false);
    assert.equal((await devoir(5003)).pending, false);
    await synchro();
    assert.equal((await tacheDe(5003))!.done, false);
    assert.equal(ed.faits.length, n, 'et rien ne repart');
  });

  it('décoché dans Foyer pendant une panne : reste décoché, « non transmis » avec la raison, puis part au retour', async () => {
    const t = (await tacheDe(5001))!;
    const r = await appel(ctx.base, 'POST', '/tasks/ops', { ops: [{ op: 'reopen', opId: 'reo-1', id: t.id }] }, E());
    assert.equal(r.status, 200);
    ed.envoiEnPanne = true;
    await synchro();
    const d = await devoir(5001);
    assert.equal(d.done, false);
    assert.equal(d.pending, true);
    assert.match(d.doneError!, /HTTP 500/);
    ed.envoiEnPanne = false;
    await synchro();
    assert.deepEqual(ed.faits.at(-1), { eleve: 3000001, faits: [], nonFaits: [5001] });
    assert.equal((await devoir(5001)).pending, false);
  });

  it('énoncé modifié par le professeur : titre mis à jour, coche conservée, « modifié le »', async () => {
    const d0 = await devoir(5002);
    assert.equal(d0.done, true);
    ed.enonce(5002, '<p>Interrogation sur le présent simple</p>');
    await synchro();
    const t = (await tacheDe(5002))!;
    assert.equal(t.text, 'Interro d’anglais lv1 : Interrogation sur le présent simple');
    assert.equal(t.done, true);
    assert.ok((await devoir(5002)).modifiedAt);
  });

  it('tâche supprimée par l’utilisateur : jamais recréée ; devoir disparu : tâche retirée, devoir archivé', async () => {
    const t = (await tacheDe(5001))!;
    await appel(ctx.base, 'POST', '/tasks/ops', { ops: [{ op: 'remove', opId: 'rm-1', id: t.id }] }, A());
    await synchro();
    await synchro();
    assert.equal((await taches()).some((x) => x.id === t.id), false, 'pas de résurrection');
    assert.ok(await devoir(5001), 'le devoir reste dans l’écran École');

    // Sans tâche, la case de l'écran École suit ÉcoleDirecte dans les deux sens.
    const n = ed.faits.length;
    ed.cahier[jourParis(1)].find((r) => r.idDevoir === 5001)!.effectue = true;
    await synchro();
    assert.equal((await devoir(5001)).done, true);
    ed.cahier[jourParis(1)].find((r) => r.idDevoir === 5001)!.effectue = false;
    await synchro();
    assert.equal((await devoir(5001)).done, false);
    await synchro();
    assert.equal(ed.faits.length, n, 'rien ne repart');

    const t3 = (await tacheDe(5003))!;
    delete ed.cahier[jourParis(3)];
    await synchro();
    assert.equal((await taches()).some((x) => x.id === t3.id), false);
    assert.equal(await devoir(5003), undefined, 'archivé, hors de la vue courante');
    const archives = (await appel(ctx.base, 'GET', `/ecole/eleves/${eleveLena}/devoirs?archives=1`, undefined, A())).json.homework;
    assert.ok(archives.some((h: Devoir) => h.subject === 'HISTOIRE-GEOGRAPHIE'), 'mais consultable dans l’historique');
  });

  it('la liste « Devoirs de … » ne se remplit, ne se supprime ni ne se renomme à la main', async () => {
    const l = (await listes()).find((x) => x.kind === 'devoirs')!;
    const add = await appel(ctx.base, 'POST', '/tasks/ops', { ops: [{ op: 'add', opId: 'add-x', id: 'tx', listId: l.id, text: 'Tâche maison' }] }, A());
    assert.match(add.json.skipped[0].reason, /viennent d’ÉcoleDirecte/);
    // Une tâche projetée se modifie (note, rappel) sans être refusée.
    const t = (await tacheDe(5002))!;
    const edit = await appel(ctx.base, 'POST', '/tasks/ops', { ops: [{ op: 'edit', opId: 'ed-x', id: t.id, listId: l.id, remind: 'eve' }] }, A());
    assert.deepEqual(edit.json.skipped, []);

    const e = await etat();
    const put = await appel(ctx.base, 'PUT', '/state', { version: e.version, state: { ...e.state, taskLists: e.state.taskLists.filter((x: { id: string }) => x.id !== l.id) } }, A());
    assert.equal(put.status, 200);
    assert.ok((await listes()).some((x) => x.id === l.id), 'remise en place');
    assert.ok((await taches()).some((x) => x.listId === l.id), 'avec ses devoirs');
    const e2 = await etat();
    await appel(ctx.base, 'PUT', '/state', { version: e2.version, state: { ...e2.state, taskLists: e2.state.taskLists.map((x: { id: string }) => (x.id === l.id ? { ...x, name: 'Autre nom' } : x)) } }, A());
    assert.equal((await listes()).find((x) => x.id === l.id)!.name, 'Devoirs de Lena');
    const e3 = await etat();
    await appel(ctx.base, 'PUT', '/state', { version: e3.version, state: { ...e3.state, taskLists: [...e3.state.taskLists, { id: 'faux', name: 'Faux devoirs', color: '#000', icon: 'ecole', kind: 'devoirs', scope: 'shared', position: 99 }] } }, A());
    assert.equal((await listes()).find((x) => x.id === 'faux')!.kind, 'taches', 'une liste de devoirs ne se fabrique pas à la main');
  });

  it('jeton refusé sur les données : la connexion reste réussie, l’erreur est notée par élève, le journal le dit', async () => {
    ed.jetonRefuse = true;
    const r = await synchro();
    assert.equal(r.kind, 'ok');
    if (r.kind === 'ok') assert.equal(r.data!.failed, 1, 'le premier élève échoue, le suivant attend le passage suivant');
    const v = await vue();
    assert.match(v.students.find((s: { id: number }) => s.id === eleveLena).dataError, /520/);
    const journal = (await appel(ctx.base, 'GET', '/ecole/etat', undefined, A())).json.journal;
    assert.equal(journal[0].scope, 'donnees');
    assert.equal(journal[0].ok, false);
    ed.jetonRefuse = false;
    await synchro();
    assert.equal((await vue()).students.find((s: { id: number }) => s.id === eleveLena).dataError, null);
  });
});
