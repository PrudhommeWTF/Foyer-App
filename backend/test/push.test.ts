// La couture du canal push avec la base : abonnements, envoi idempotent par
// clé et par membre, appareils morts retirés, journal lisible, planificateur
// qui ne renvoie rien deux fois et note ce qu'il a manqué.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateHousehold } from '../src/storage/schema';
import { addDevice, detailOf, initPush, isPushEndpointAllowed, isSubscription, listDevices, notify, publicKey, recentSends, removeDevice, setSender } from '../src/notify/push';
import { SchedulerDeps, tick } from '../src/notify/scheduler';
import { Bilan, weeklyHits } from '../src/revisions/bilan';
import { applyTaskOps, initTasks, onAssigned } from '../src/tasks/repo';
import { TaskItem } from '../src/tasks/ops';

let db: Database.Database;
let sent: { endpoint: string; title: string; kind: string }[];
let failWith: Record<string, number> = {};

const sub = (n: string) => ({ endpoint: 'https://push.example/' + n, keys: { p256dh: 'p', auth: 'a' } });
const task = (over: Partial<TaskItem> = {}): TaskItem =>
  ({ id: 't1', listId: 'l1', text: 'Plombier', who: ['m1'], due: '2026-09-05', time: '18:00', done: false, remind: 'at', ...over });

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE household (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  migrateHousehold(db);
  initTasks(db);
  initPush(db);
  sent = [];
  failWith = {};
  setSender(async (d, p) => {
    const code = failWith[d.endpoint];
    if (code) { const e = new Error('push refusé') as Error & { statusCode: number }; e.statusCode = code; throw e; }
    sent.push({ endpoint: d.endpoint, title: p.title, kind: p.kind });
  });
});

describe('l’endpoint d’abonnement ne peut viser qu’un service push connu', () => {
  it('accepte les fournisseurs des navigateurs', () => {
    for (const e of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/xyz',
      'https://web.push.apple.com/QID',
      'https://wns2-by3p.notify.windows.com/w/?token=z',
    ]) assert.equal(isPushEndpointAllowed(e), true, e);
  });

  it('refuse une adresse interne ou un domaine arbitraire', () => {
    // C'est la SSRF que ça ferme : un membre ne peut pas faire poster le serveur
    // sur le routeur du foyer ni sur un domaine à lui.
    for (const e of [
      'https://192.168.1.1/',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/',
      'https://attaquant.example/collecte',
      'https://fcm.googleapis.com.attaquant.example/',
      'pas-une-url',
    ]) assert.equal(isPushEndpointAllowed(e), false, e);
  });
});

describe('clés et abonnements', () => {
  it('les clés VAPID sont générées une fois et gardées en base', () => {
    const k1 = publicKey();
    const again = initPush(db);
    assert.equal(again.generated, false);
    assert.equal(again.publicKey, k1);
  });

  it('un abonnement ré-envoyé ne fait pas de doublon, et un membre ne retire que les siens', () => {
    addDevice('m1', sub('a'), 'iPhone');
    addDevice('m1', sub('a'), 'iPhone encore');
    addDevice('me', sub('b'), 'Mac');
    assert.equal(listDevices('m1').length, 1);
    assert.equal(removeDevice('me', listDevices('m1')[0].id), false, 'pas le sien');
    assert.equal(removeDevice('m1', listDevices('m1')[0].id), true);
    assert.equal(listDevices().length, 1);
  });

  it('un abonnement illisible est refusé avant d’atteindre la base', () => {
    assert.equal(isSubscription({ endpoint: 'http://pas-https', keys: { p256dh: 'p', auth: 'a' } }), false);
    assert.equal(isSubscription({ endpoint: 'https://ok', keys: { p256dh: 'p' } }), false);
    assert.equal(isSubscription(sub('x')), true);
  });
});

describe('envoi', () => {
  it('envoie à tous les appareils du membre, et pas deux fois pour la même clé', async () => {
    addDevice('m1', sub('a'), ''); addDevice('m1', sub('b'), '');
    const r1 = await notify('k1', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r1.members[0].status, 'sent');
    assert.equal(r1.members[0].devices, 2);
    const r2 = await notify('k1', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r2.members[0].status, 'skipped');
    assert.equal(sent.length, 2, 'un redémarrage au milieu de la minute ne renvoie rien');
  });

  it('un membre sans appareil est noté « aucun appareil », visiblement', async () => {
    const r = await notify('k2', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r.members[0].status, 'no-device');
    assert.equal(recentSends()[0].status, 'no-device');
  });

  it('un appareil que le service déclare mort est retiré, et l’erreur reste lisible', async () => {
    addDevice('m1', sub('a'), 'iPhone'); addDevice('m1', sub('b'), 'iPad');
    failWith['https://push.example/a'] = 410;
    const r = await notify('k3', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    // L'iPad a reçu, l'iPhone est parti : ce n'est pas un envoi réussi, et le
    // journal doit dire lequel des deux, sinon l'appareil disparaît sans un mot.
    assert.equal(r.members[0].status, 'partial');
    assert.match(r.members[0].error!, /1 appareil sur 2/);
    assert.match(r.members[0].error!, /abonnement expiré/);
    assert.equal(listDevices('m1').length, 1, 'l’iPhone dont l’abonnement est mort a été retiré');
    failWith['https://push.example/b'] = 500;
    const r2 = await notify('k4', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r2.members[0].status, 'failed');
    assert.match(r2.members[0].error!, /HTTP 500/);
    assert.equal(listDevices('m1').length, 1, 'une panne passagère ne retire pas l’appareil');
    assert.match(listDevices('m1')[0].lastError!, /500/);
  });

  it('un abonnement expiré (404) retire l’appareil et laisse une trace au journal', async () => {
    addDevice('m1', sub('a'), 'iPhone');
    failWith['https://push.example/a'] = 404;
    const r = await notify('k404', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r.members[0].status, 'failed', 'le seul appareil est mort : l’envoi a échoué');
    assert.match(r.members[0].error!, /HTTP 404/);
    assert.equal(listDevices('m1').length, 0, 'l’appareil au 404 a été retiré, pas gardé en erreur permanente');
    assert.equal(recentSends()[0].status, 'failed', 'le journal garde la trace de l’échec');
  });

  // Ce que le réabonnement du service worker déclenche : le service push a
  // renouvelé l'abonnement (nouvelle adresse), le SW a réenregistré la nouvelle,
  // et l'ancienne, morte, part au premier envoi qui la trouve en 410.
  it('après renouvellement, l’ancienne adresse morte est élaguée et la nouvelle reçoit', async () => {
    addDevice('m1', sub('ancienne'), 'iPhone'); // l'abonnement d'origine
    addDevice('m1', sub('nouvelle'), 'iPhone'); // celui que le SW vient de réenregistrer
    failWith['https://push.example/ancienne'] = 410;
    const r = await notify('krenew', ['m1'], { kind: 'reminder', title: 'Plombier', body: '' });
    assert.equal(r.members[0].status, 'partial');
    assert.equal(listDevices('m1').length, 1, 'seule la nouvelle adresse subsiste');
    assert.equal(listDevices('m1')[0].endpoint, 'https://push.example/nouvelle');
    assert.equal(sent.some((s) => s.endpoint === 'https://push.example/nouvelle'), true, 'la nouvelle adresse a bien reçu');
  });

  // Le cas réel : un iPhone qui reçoit, un Mac qui refuse. Le journal notait
  // « envoyé » et jetait l'échec, donc un appareil muet passait pour un succès.
  it('un envoi qui n’atteint qu’une partie des appareils ne se présente pas comme réussi', async () => {
    addDevice('m1', sub('iphone'), 'iPhone'); addDevice('m1', sub('mac'), 'Safari sur Mac');
    failWith['https://push.example/mac'] = 403;
    const r = await notify('k5', ['m1'], { kind: 'test', title: 'Foyer : test', body: '' });
    const m = r.members[0];
    assert.equal(m.status, 'partial');
    assert.equal(m.devices, 1, 'un appareil atteint');
    assert.equal(m.total, 2, 'sur deux abonnés');
    assert.match(m.error!, /1 appareil sur 2/);
    assert.match(m.error!, /HTTP 403/, 'la raison du refus est là, pas seulement le compte');
    assert.equal(listDevices('m1').length, 2, 'un 403 ne retire pas l’appareil : il se corrige');
  });

  it('tous les appareils répondent : c’est un envoi réussi, sans détail inutile', async () => {
    addDevice('m1', sub('a'), 'iPhone'); addDevice('m1', sub('b'), 'iPad');
    const r = await notify('k6', ['m1'], { kind: 'test', title: 'Foyer : test', body: '' });
    assert.equal(r.members[0].status, 'sent');
    assert.equal(r.members[0].devices, 2);
    assert.equal(r.members[0].total, 2);
    assert.equal(r.members[0].error, null);
  });

  it('un seul appareil, qui refuse : un échec franc, sans « 0 appareil sur 1 »', async () => {
    addDevice('m1', sub('a'), 'iPhone');
    failWith['https://push.example/a'] = 403;
    const r = await notify('k7', ['m1'], { kind: 'test', title: 'Foyer : test', body: '' });
    assert.equal(r.members[0].status, 'failed');
    assert.match(r.members[0].error!, /HTTP 403/);
    assert.equal(/sur 1/.test(r.members[0].error!), false, 'un compte n’apprend rien quand il n’y a qu’un appareil');
  });

  it('des appareils qui refusent pour la même raison tiennent en une ligne', () => {
    assert.equal(detailOf(1, 3, ['HTTP 403 : BadJwtToken', 'HTTP 403 : BadJwtToken']), '1 appareil sur 3 · HTTP 403 : BadJwtToken');
    assert.equal(detailOf(1, 3, ['HTTP 403', 'HTTP 500']), '1 appareil sur 3 · HTTP 403 ; HTTP 500');
  });
});

describe('planificateur', () => {
  const deps = (tasks: TaskItem[], log: string[], over: Partial<SchedulerDeps> = {}): SchedulerDeps => ({
    tasks: () => tasks,
    lists: () => [],
    members: () => [],
    accounts: () => ['me', 'm1'],
    adults: () => ['me', 'm1'],
    employes: () => [],
    rappelJour: () => 3,
    url: () => '',
    entretienOn: () => true,
    garanties: () => ({ items: [], alertDays: 60 }),
    revisionsWeekly: () => [],
    // Par défaut : rien de suspendu, pas d'heures de silence, tout le monde veut
    // ses rappels. Les tests qui éprouvent ces règles les posent eux-mêmes.
    rules: () => ({ paused: false, quiet: { from: '', to: '' } }),
    wants: () => true,
    log: (l: string) => { log.push(l); },
    ...over,
  });

  it('envoie ce qui est dû, note ce qui est manqué, et ne recommence pas au passage suivant', async () => {
    addDevice('m1', sub('a'), ''); addDevice('me', sub('b'), '');
    const log: string[] = [];
    const tasks = [task({ id: 'a', time: '18:00' }), task({ id: 'b', time: '12:00' }), task({ id: 'c', who: [], time: '17:45' })];
    await tick(deps(tasks, log), '2026-09-05T18:00');
    assert.deepEqual(sent.map((s) => s.endpoint.slice(-1)).sort(), ['a', 'a', 'b'], 'a → m1 ; c sans responsable → m1 et me');
    assert.ok(log.some((l) => l.includes('manqué') && l.includes('Plombier')), 'b est noté manqué, pas envoyé à 18 h');
    assert.ok(recentSends().some((s) => s.status === 'missed'));
    await tick(deps(tasks, log), '2026-09-05T18:01');
    assert.equal(sent.length, 3, 'rien de plus au passage suivant');
  });

  it('gestes d’entretien : selon « rappels d’entretien » de chacun, tus quand le module est éteint, jamais sans date', async () => {
    addDevice('m1', sub('a'), ''); addDevice('me', sub('b'), '');
    const log: string[] = [];
    const geste = task({ id: 'g', listId: 'entretien', who: [], time: null, remind: 'morning', due: '2026-09-05' });
    // m1 a coupé les rappels d'entretien, pas ceux de ses tâches : seul « me » reçoit le geste.
    const wants = (m: string, kind: string) => !(m === 'm1' && kind === 'entretien');
    await tick(deps([geste, task({ id: 't', who: ['m1'], time: '09:00' })], log, { wants }), '2026-09-05T09:00');
    assert.deepEqual(sent.map((s) => s.endpoint.slice(-1)).sort(), ['a', 'b'], 'la tâche de m1 lui arrive, le geste à me seul');
    sent.length = 0;
    await tick(deps([{ ...geste, id: 'g2' }], log, { entretienOn: () => false }), '2026-09-05T09:00');
    assert.equal(sent.length, 0, 'module éteint : le geste ne rappelle pas');
    await tick(deps([{ ...geste, id: 'g3', due: null }], log), '2026-09-05T09:00');
    assert.equal(sent.length, 0, 'jamais noté : pas de date, pas de rappel');
  });

  it('fin de garantie : une fois par fiche et par date de fin, aux adultes qui le veulent, à partir de 9 h', async () => {
    addDevice('m1', sub('a'), ''); addDevice('me', sub('b'), '');
    const log: string[] = [];
    const lave = { id: 7, name: 'Lave-vaisselle', until: '2026-10-30', daysLeft: 25 };
    const garanties = (items: typeof lave[]) => () => ({ items, alertDays: 60 });
    const wants = (m: string, kind: string) => !(m === 'm1' && kind === 'garantie');
    await tick(deps([], log, { garanties: garanties([lave]), wants }), '2026-10-05T08:59');
    assert.equal(sent.length, 0, 'pas avant 9 h');
    await tick(deps([], log, { garanties: garanties([lave]), wants }), '2026-10-05T09:00');
    assert.deepEqual(sent.map((s) => s.endpoint.slice(-1)), ['b'], 'm1 a coupé les fins de garantie');
    assert.equal(sent[0].title, 'Garantie bientôt terminée');
    assert.ok(log.some((l) => l.includes('Lave-vaisselle : sous garantie jusqu’au 30/10/2026 (encore 25 jours).')), log.join('\n'));
    await tick(deps([], log, { garanties: garanties([{ ...lave, daysLeft: 24 }]), wants }), '2026-10-06T09:00');
    assert.equal(sent.length, 1, 'une seule fois pour cette date de fin, même le lendemain');
    await tick(deps([], log, { garanties: garanties([{ ...lave, until: '2027-10-30', daysLeft: 20 }]), wants }), '2027-10-10T09:00');
    assert.equal(sent.length, 2, 'garantie prolongée : la nouvelle fin prévient à nouveau');
    await tick(deps([], log, { garanties: garanties([{ id: 8, name: 'Four', until: '2026-12-31', daysLeft: 80 }, { id: 9, name: 'TV', until: '2026-10-01', daysLeft: -5 }]), wants }), '2026-10-12T09:00');
    assert.equal(sent.length, 2, 'ni au-delà du seuil, ni une garantie déjà finie');
  });

  it('bilan des révisions : le dimanche à l’heure dite, une fois par enfant et par semaine, aux adultes qui le veulent', async () => {
    addDevice('m1', sub('a'), ''); addDevice('me', sub('b'), '');
    const log: string[] = [];
    const bilan = (sessions: number) => (kid: { id: string; name: string }, from: string, to: string): Bilan => ({
      member: kid, from, to, label: '', prev: null,
      totals: { sessions, questions: sessions * 10, good: sessions * 9, slow: 0, wrong: sessions, pct: 90 },
      matieres: sessions ? [{ id: 'maths', label: 'Mathématiques', exercises: [{ id: 'tables', label: 'Tables', summary: 'Les tables de 6 à 9, multiplication',
        totals: { sessions, questions: sessions * 10, good: sessions * 9, slow: 0, wrong: sessions, pct: 90 }, prev: null, groups: [],
        fragiles: [{ label: '7 × 8', status: 'en-cours' }] }] }] : [],
    });
    const weekly = (sessions: number) => (wall: string) => weeklyHits([{ id: 'k1', name: 'Raphaël' }, { id: 'k2', name: 'Gaëtan' }], ['me', 'm1'], wall, '18:30',
      (k, f, t) => bilan(k.id === 'k1' ? sessions : 0)(k, f, t));
    const wants = (m: string, kind: string) => !(m === 'm1' && kind === 'revisions');
    await tick(deps([], log, { revisionsWeekly: weekly(5), wants }), '2026-10-18T18:29');
    assert.equal(sent.length, 0, 'pas avant l’heure');
    await tick(deps([], log, { revisionsWeekly: weekly(5), wants }), '2026-10-18T18:30');
    assert.deepEqual(sent.map((s) => s.endpoint.slice(-1)), ['b'], 'm1 a coupé le bilan ; Gaëtan, sans programme ni session, n’a pas de bilan');
    assert.equal(sent[0].title, 'Révisions de Raphaël');
    assert.ok(log.some((l) => l.includes('« Raphaël cette semaine : 5 sessions, les tables de 6 à 9, multiplication, 90 % de réussite, 7 × 8 encore fragile. »')), log.join('\n'));
    await tick(deps([], log, { revisionsWeekly: weekly(6), wants }), '2026-10-18T21:00');
    assert.equal(sent.length, 1, 'une seule fois par semaine');
    await tick(deps([], log, { revisionsWeekly: weekly(5), wants }), '2026-10-19T18:30');
    assert.equal(sent.length, 1, 'le lundi : rien');
    await tick(deps([], log, { revisionsWeekly: weekly(2), wants }), '2026-10-25T19:00');
    assert.equal(sent.length, 2, 'la semaine suivante, à nouveau');
  });

  it('une tâche faite entre-temps n’est plus rappelée ; reportée, elle l’est à nouveau', async () => {
    addDevice('m1', sub('a'), '');
    const log: string[] = [];
    await tick(deps([task({ done: true })], log), '2026-09-05T18:00');
    assert.equal(sent.length, 0);
    await tick(deps([task()], log), '2026-09-05T18:00');
    await tick(deps([task({ due: '2026-09-06' })], log), '2026-09-06T18:00');
    assert.equal(sent.length, 2);
  });

  it('rappel de préparation : envoyé une fois dans la fenêtre, à l’enfant à compte et aux adultes', async () => {
    addDevice('nolan', sub('a'), ''); addDevice('m1', sub('b'), '');
    const log: string[] = [];
    const over: Partial<SchedulerDeps> = {
      lists: () => [{ id: 'L', name: 'Trousseau colo', kind: 'preparation', forMember: 'nolan', departure: '2026-09-05', remindDaysBefore: 3 }],
      members: () => [{ id: 'm1', name: 'Maman', adult: true, hasAccount: true }, { id: 'nolan', name: 'Nolan', adult: false, hasAccount: true }],
    };
    const tasks = [task({ id: 'p1', listId: 'L', due: null, remind: null }), task({ id: 'p2', listId: 'L', due: null, remind: null })];
    await tick(deps(tasks, log, over), '2026-09-03T18:00');
    assert.deepEqual(sent.map((s) => s.endpoint.slice(-1)).sort(), ['a', 'b'], 'Nolan et Maman, une fois chacun');
    assert.ok(log.some((l) => l.includes('préparation') && l.includes('Trousseau colo')));
    await tick(deps(tasks, log, over), '2026-09-03T18:01');
    assert.equal(sent.length, 2, 'même jour, même clé : rien de plus');
  });

  it('rappel CESU : le mois écoulé non déclaré, aux adultes, une fois par mois', async () => {
    addDevice('me', sub('a'), ''); addDevice('m1', sub('b'), '');
    const log: string[] = [];
    const over: Partial<SchedulerDeps> = {
      adults: () => ['me', 'm1'],
      employes: (month) => month === '2026-08' ? [{ id: '1', name: 'Fatou', role: 'menage', minutes: 900, status: 'ouvert' }] : [],
      rappelJour: () => 3,
    };
    // Le 3 septembre à 9 h : le mois d'août, ouvert avec présences, est rappelé aux deux adultes.
    await tick(deps([], log, over), '2026-09-03T09:00');
    assert.deepEqual(sent.map((s) => s.endpoint.slice(-1)).sort(), ['a', 'b'], 'me et m1');
    assert.ok(log.some((l) => l.includes('CESU') && l.includes('août')));
    // Deuxième passage : même clé mensuelle, rien de plus.
    await tick(deps([], log, over), '2026-09-03T09:01');
    assert.equal(sent.length, 2, 'même mois, même clé : pas de second envoi');
  });
});

describe('affectation par quelqu’un d’autre', () => {
  it('signale les membres nouvellement affectés, avec l’opération, et pas l’auteur', () => {
    db.prepare('INSERT INTO household (id, state, version) VALUES (1, ?, 1)').run(JSON.stringify({
      members: [{ id: 'me' }, { id: 'm1' }], taskLists: [{ id: 'l1' }], shopLists: [], tasks: [],
    }));
    const got: string[] = [];
    onAssigned((memberId, t, opId) => got.push(`${memberId}:${t.id}:${opId}`));
    applyTaskOps([{ opId: 'o1', op: 'add', id: 't1', listId: 'l1', text: 'x', who: ['me', 'm1'], by: 'me' }]);
    applyTaskOps([{ opId: 'o2', op: 'edit', id: 't1', who: ['me', 'm1'], by: 'm1' }]);
    // Retiré puis remis dans le même lot : aucun changement net, personne n'est prévenu.
    applyTaskOps([{ opId: 'o3', op: 'edit', id: 't1', who: ['m1'], by: 'm1' }, { opId: 'o4', op: 'edit', id: 't1', who: ['m1', 'me'], by: 'm1' }]);
    applyTaskOps([{ opId: 'o5', op: 'edit', id: 't1', who: ['m1'], by: 'm1' }]);
    applyTaskOps([{ opId: 'o6', op: 'edit', id: 't1', who: ['m1', 'me'], by: 'm1' }]);
    onAssigned(null);
    assert.deepEqual(got, ['m1:t1:o1', 'me:t1:o6']);
  });
});
