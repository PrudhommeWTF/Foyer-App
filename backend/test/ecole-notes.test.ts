// Module École, troisième tranche, de bout en bout : notes, moyennes, vie
// scolaire et notifications, sur le faux serveur local. La recette : la
// première synchronisation n'annonce rien ; une note qui tombe est annoncée
// une fois, aux adultes et à l'enfant ; plusieurs se regroupent ; une absence
// ne va qu'aux adultes ; le rappel du soir part une fois par élève et par soir ;
// un enfant ne lit que ses notes.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';
import { FauxEd, fauxEcoleDirecte, jourParis } from './ecole-faux-serveur';

interface Envoi { key: string; to: string[]; title: string; body: string; }

describe('École : notes, vie scolaire, notifications (HTTP)', () => {
  let ctx: Contexte;
  let ed: FauxEd;
  let svc: typeof import('../src/ecole/service');
  let wall: typeof import('../src/notify/reminders')['parisWall'];
  const envois: Envoi[] = [];
  let compte = 0, eleveLena = 0, eleveNolan = 0;
  let thomas = '', camille = '', lena = '';

  before(async () => {
    ed = await fauxEcoleDirecte();
    process.env.FOYER_SECRET_KEY = 'cle-de-chiffrement-de-test-de-plus-de-32-caracteres';
    process.env.FOYER_ED_API_BASE = ed.base;
    ctx = await demarrer();
    svc = await import('../src/ecole/service');
    wall = (await import('../src/notify/reminders')).parisWall;
  });
  after(async () => { await arreter(ctx); await ed.fermer(); });

  const A = () => ctx.jetons.admin;
  const synchro = () => svc.connect(compte);
  const note = (id: number, matiere: string, valeur: string, extra: Record<string, unknown> = {}) => ({
    id, devoir: 'Contrôle', codePeriode: 'A001', codeMatiere: matiere.slice(0, 4), libelleMatiere: matiere, typeDevoir: 'Devoir',
    coef: '1', noteSur: '20', valeur, nonSignificatif: false, date: jourParis(0), moyenneClasse: '11,2', minClasse: '3', maxClasse: '19', ...extra,
  });

  it('mise en place : Léna (enfant, compte) associée à Lena, Nolan-Pierre à Camille ; envois capturés', async () => {
    await appel(ctx.base, 'PATCH', '/settings', { changes: { modEcole: true } }, A());
    const r = await appel(ctx.base, 'POST', '/ecole/comptes', { label: 'Collège', identifiant: 'parent.famille', motdepasse: 'mot de passe & 100%' }, A());
    compte = r.json.account.id;
    const ok = await appel(ctx.base, 'POST', `/ecole/comptes/${compte}/qcm`, { choix: 2 }, A());
    [eleveLena, eleveNolan] = ok.json.account.students.map((s: { id: number }) => s.id);
    const membres = (await appel(ctx.base, 'GET', '/state', undefined, A())).json.state.members as { id: string; name: string }[];
    [thomas, camille, lena] = ['Thomas', 'Camille', 'Lena'].map((n) => membres.find((m) => m.name === n)!.id);
    await appel(ctx.base, 'PUT', `/ecole/eleves/${eleveLena}`, { action: 'confirmer' }, A());
    await appel(ctx.base, 'PUT', `/ecole/eleves/${eleveNolan}`, { action: 'associer', memberId: camille }, A());
    svc.setEcoleDeps({
      accounts: () => [thomas, camille, lena],
      wants: () => true,
      push: async (key, to, title, body) => { envois.push({ key, to, title, body }); },
    });
  });

  it('première synchronisation : notes, moyennes et vie scolaire lues, aucune notification', async () => {
    const r = await synchro();
    assert.equal(r.kind, 'ok');
    assert.deepEqual(envois, [], 'pas trente notes d’un coup');
    const n = await appel(ctx.base, 'GET', `/ecole/eleves/${eleveLena}/notes`, undefined, A());
    assert.equal(n.json.grades.length, 3);
    assert.equal(n.json.grades.find((g: { subject: string }) => g.subject === 'ANGLAIS LV1').value, 'Abs');
    assert.equal(n.json.averages[0].subject, 'Moyenne générale');
    assert.equal(n.json.averages[0].average, '13,25', 'telle que renvoyée, jamais recalculée');
    const v = await appel(ctx.base, 'GET', `/ecole/eleves/${eleveLena}/vie-scolaire`, undefined, A());
    assert.deepEqual(v.json.items.map((e: { kind: string }) => e.kind).sort(), ['absence', 'retard', 'sanction']);
    // Nolan-Pierre n'a ni NOTES ni VIE_SCOLAIRE dans ses modules : aucune requête pour lui.
    assert.equal(ed.requetes.some((q) => /\/eleves\/3000002\/(notes|viescolaire)/.test(q.path)), false);
  });

  it('une note tombe : annoncée une fois, aux adultes et à Lena ; pas au passage suivant', async () => {
    ed.notes.notes.push(note(8101, 'HISTOIRE-GEOGRAPHIE', '16'));
    await synchro();
    assert.equal(envois.length, 1);
    assert.equal(envois[0].title, 'Lena : 16/20 en histoire-geographie');
    assert.deepEqual(envois[0].to.sort(), [thomas, camille, lena].sort());
    await synchro();
    assert.equal(envois.length, 1, 'jamais deux fois la même note');
  });

  it('trois notes au même passage : une notification groupée ; une note non significative seule : rien', async () => {
    ed.notes.notes.push(note(8102, 'MATHEMATIQUES', '9'), note(8103, 'PHYSIQUE-CHIMIE', '12,5'), note(8104, 'ANGLAIS LV1', '17'));
    await synchro();
    assert.equal(envois.at(-1)!.title, 'Lena : 3 nouvelles notes');
    const n = envois.length;
    ed.notes.notes.push(note(8105, 'FRANCAIS', '8', { nonSignificatif: true }));
    await synchro();
    assert.equal(envois.length, n);
  });

  it('un retard enregistré : aux adultes seulement, avec « non justifié »', async () => {
    ed.vie.absencesRetards.push({ id: 6003, typeElement: 'Retard', date: jourParis(0), displayDate: 'aujourd’hui à 08:12', libelle: '12 minutes', motif: '', justifie: false });
    await synchro();
    const e = envois.at(-1)!;
    assert.equal(e.title, 'Lena : retard enregistré aujourd’hui, non justifié');
    assert.deepEqual(e.to.sort(), [thomas, camille].sort(), 'la vie scolaire est l’affaire des adultes');
  });

  it('un nouveau devoir (après la première lecture) : annoncé ; les préférences décident', async () => {
    ed.cahier[jourParis(2)] = [{ matiere: 'ANGLAIS LV1', codeMatiere: 'AGL1', aFaire: true, idDevoir: 5010, donneLe: jourParis(0), effectue: false, interrogation: false, rendreEnLigne: false }];
    svc.setEcoleDeps({ wants: (m, kind) => kind !== 'devoirs' || m === lena });
    await synchro();
    const e = envois.at(-1)!;
    assert.match(e.title, /^Lena : nouveau devoir d’anglais lv1 pour /);
    assert.deepEqual(e.to, [lena], 'seul qui le veut');
    svc.setEcoleDeps({ wants: () => true });
  });

  it('rappel du soir : à l’heure réglée, une clé par élève et par soir ; rien hors de la fenêtre', async () => {
    const at = (hm: string): Date => {
      const want = `${jourParis(0)}T${hm}`;
      for (let t = Date.now() - 36 * 3600_000; t < Date.now() + 36 * 3600_000; t += 60_000) if (wall(new Date(t)) === want) return new Date(t);
      throw new Error('heure introuvable');
    };
    const n = envois.length;
    assert.equal(await svc.eveningReminders(at('17:00')), 0, 'avant 17:30');
    assert.equal(await svc.eveningReminders(at('17:45')), 1);
    const e = envois.at(-1)!;
    assert.equal(e.key, `ecole-soir|${eleveLena}|${jourParis(0)}`, 'clé du soir : le journal des envois en fait un envoi unique');
    assert.match(e.title, /^Lena : \d devoirs? pour demain/);
    assert.ok(e.to.includes(lena) && e.to.includes(thomas));
    assert.equal(await svc.eveningReminders(at('19:31')), 0, 'plus de deux heures après : trop tard');
    assert.equal(envois.length, n + 1);
  });

  it('un enfant lit ses notes et sa vie scolaire, pas celles d’un autre (403)', async () => {
    assert.equal((await appel(ctx.base, 'GET', `/ecole/eleves/${eleveLena}/notes`, undefined, ctx.jetons.enfant)).status, 200);
    assert.equal((await appel(ctx.base, 'GET', `/ecole/eleves/${eleveNolan}/notes`, undefined, ctx.jetons.enfant)).status, 403);
    assert.equal((await appel(ctx.base, 'GET', `/ecole/eleves/${eleveNolan}/vie-scolaire`, undefined, ctx.jetons.enfant)).status, 403);
  });
});
