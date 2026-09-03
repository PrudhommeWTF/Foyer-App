// Les trois états de chaque tuile, et la panne qui ne doit rien casser.
//
// Un tableau de bord ment de trois façons : il affiche zéro quand il ne sait
// pas, il présente une vieille valeur comme fraîche, et il cache une erreur
// derrière un état vide. Ces tests interdisent les trois, tuile par tuile, et
// vérifient qu'une exception d'un fournisseur ne blanchit pas la page.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NAV_GROUPS } from '../../shell/nav';
import { buildArticleIndex } from '../ingredients';
import { HouseholdState } from '../models';
import type { FinDeadline } from '../finances.api';
import { DocSnapshot, FinSnapshot, Source, TileContext, TileProvider, TileState, safeState } from './contract';
import { TILE_PROVIDERS } from './registry';

const TODAY = '2026-08-21';

/** Un document vide mais bien formé : c'est le foyer qui vient d'être créé. */
const emptyDoc = (): HouseholdState => ({
  familyName: 'Foyer', members: [], events: [], aisles: [], articles: [],
  shopLists: [], shop: [], taskLists: [], tasks: [], msgs: [], contacts: [],
  folders: [], files: [], meals: {}, recipes: [], sched: [],
  profile: { name: '', role: '', email: '', phone: '', color: '#E56B4E', memberId: '' },
  settings: { dateFmt: 'JJ/MM/AAAA', dark: false, prefNotifs: true },
});

/** Un document qui a de quoi remplir chaque tuile du plan « document ». */
const fullDoc = (): HouseholdState => ({
  ...emptyDoc(),
  members: [{ id: 'm1', name: 'Léa', role: 'Enfant', color: '#9B6FA8', ini: 'LE' }],
  events: [{ id: 'e1', date: TODAY, time: '08:30', title: 'Dentiste', who: 'm1', recur: 'none' }],
  tasks: [
    { id: 't1', text: 'Sortir le verre', who: 'm1', due: 'Aujourd’hui', done: false, listId: 'l1', prio: 'med' },
    { id: 't2', text: 'Déjà faite', who: 'm1', due: 'Hier', done: true, listId: 'l1', prio: 'low' },
  ],
  shop: [
    { id: 's1', name: 'Farine', qty: '1 kg', aisleId: 'a1', state: 'a-prendre', listId: 'c1' },
    { id: 's2', name: 'Lait', qty: '2 L', aisleId: 'a1', state: 'panier', listId: 'c1' },
  ],
  msgs: [{ who: 'm1', text: 'Je rentre tard', time: '18:04' }],
  // Le 21 août 2026 est un vendredi : l'emploi du temps est une semaine type.
  sched: [{ id: 'sc1', who: ['m1'], dow: 5, start: '08:30', end: '16:30', label: 'École', k: 'ecole', rec: 'weekly' }],
  recipes: [{ id: 'r1', name: 'Gratin', level: 'Facile', color: '#7A9B76', prepMin: 15, cookMin: 45, ingr: [], steps: [] }],
  meals: { [TODAY + '-soir']: { items: [{ rid: 'r1' }] } },
});

const finSnapshot = (over: Partial<FinSnapshot> = {}): FinSnapshot => ({
  month: '2026-08', monthLabel: 'Août 2026', accounts: 1, currentBalance: 152340,
  currentAccounts: [{ id: 1, name: 'Compte joint' }],
  deadlines: [echeance()], dayExtras: {}, contracts: 2,
  savings: { pending: 24000, done: 0, count: 3, openCount: 2 },
  energy: { contracts: 1, due: [{ contractId: 9, name: 'Électricité', provider: 'EDF', lastOn: '2026-06-10', daysSince: 72 }] },
  summary: {
    month: '2026-08', income: 250000, expense: 180000, balance: 70000, budgetTotal: 200000,
    categories: [], missing: [], incomplete: false,
  },
  ...over,
});

const echeance = (over: Partial<FinDeadline> = {}): FinDeadline => ({
  contractId: 4, contractName: 'Assurance auto', provider: 'MAIF',
  kind: 'preavis', date: '2026-09-01', daysAway: 11, assetId: null, memberIds: [],
  ...over,
});

/** Un foyer qui n'a jamais ouvert le module : tout est à zéro déclaré, rien n'est « nul ». */
const finVierge = (): FinSnapshot => finSnapshot({
  accounts: 0, currentBalance: null, currentAccounts: [], contracts: 0, deadlines: [],
  savings: { pending: 0, done: 0, count: 0, openCount: 0 },
  energy: { contracts: 0, due: [] },
  summary: null,
});

/** Le plan « document » tel que l'adaptateur le compose. */
const snap = (doc: HouseholdState, schoolHolidays: DocSnapshot['schoolHolidays'] = []): DocSnapshot =>
  ({ doc, schoolHolidays, articles: buildArticleIndex(doc.articles) });

const ctx = (doc: Source<DocSnapshot>, fin: Source<FinSnapshot>): TileContext => ({ today: TODAY, doc, fin });
const ready = <T>(data: T, stale?: string): Source<T> =>
  stale ? { status: 'ready', data, asOf: '2026-08-21T07:00:00Z', stale } : { status: 'ready', data, asOf: '2026-08-21T07:00:00Z' };
const broken = <T>(): Source<T> => ({ status: 'error', message: 'Injoignable', detail: 'ECONNREFUSED' });
const loading = <T>(): Source<T> => ({ status: 'loading' });

const provider = (id: string): TileProvider => {
  const p = TILE_PROVIDERS.find((x) => x.id === id);
  assert.ok(p, `fournisseur « ${id} » absent du registre`);
  return p;
};

/** Le plan dont dépend la tuile porte l'état voulu, l'autre est toujours sain. */
function stateWhenSourceIs(p: TileProvider, src: 'ready' | 'empty' | 'error' | 'loading'): TileState<unknown> {
  const fin = p.source === 'finances';
  const doc: Source<DocSnapshot> = !fin && src === 'error' ? broken()
    : !fin && src === 'loading' ? loading()
    : ready(snap(!fin && src === 'empty' ? emptyDoc() : fullDoc()));
  const money: Source<FinSnapshot> = fin && src === 'error' ? broken()
    : fin && src === 'loading' ? loading()
    // « Vide » côté finances, c'est un module jamais servi : aucun compte, donc
    // aucune synthèse. Ce n'est pas zéro euro dépensé.
    : ready(fin && src === 'empty' ? finVierge() : finSnapshot());
  return p.state(ctx(doc, money));
}

// ---- les trois états, tuile par tuile -------------------------------------

for (const p of TILE_PROVIDERS) {
  test(`${p.id} : donnée présente`, () => {
    assert.equal(stateWhenSourceIs(p, 'ready').kind, 'ok');
  });

  test(`${p.id} : aucune donnée donne un état vide explicite, jamais un zéro`, () => {
    const s = stateWhenSourceIs(p, 'empty');
    assert.equal(s.kind, 'empty', `${p.id} devrait être vide`);
    if (s.kind === 'empty') assert.ok(s.hint.length > 3, 'un état vide doit expliquer ce qu’il est');
  });

  test(`${p.id} : module en erreur donne une erreur, jamais un état vide`, () => {
    const s = stateWhenSourceIs(p, 'error');
    assert.equal(s.kind, 'error', `${p.id} devrait être en erreur`);
    if (s.kind === 'error') {
      assert.ok(s.message.length > 3, 'le message s’adresse à qui regarde l’écran');
      assert.ok(s.detail.length > 3, 'le détail s’adresse à qui lit les journaux');
    }
  });

  test(`${p.id} : source en cours de chargement n’invente rien`, () => {
    assert.equal(stateWhenSourceIs(p, 'loading').kind, 'loading');
  });
}

// ---- ce que chaque tuile dit réellement -----------------------------------

test('agenda : les événements du jour, triés, et eux seuls', () => {
  const doc = fullDoc();
  doc.events = [
    { id: 'e2', date: TODAY, time: '18:00', title: 'Piscine', who: 'm1', recur: 'none' },
    { id: 'e1', date: TODAY, time: '08:30', title: 'Dentiste', who: 'm1', recur: 'none' },
    { id: 'e3', date: '2026-08-22', time: '09:00', title: 'Demain', who: 'm1', recur: 'none' },
  ];
  const s = provider('agenda').state(ctx(ready(snap(doc)), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
  if (s.kind !== 'ok') return;
  const events = (s.data as { events: { id: string }[] }).events;
  assert.deepEqual(events.map((e) => e.id), ['e1', 'e2']);
});

test('taches : « tout est fait » et « aucune tâche » sont deux vides différents', () => {
  const fait = fullDoc();
  fait.tasks = [{ id: 't2', text: 'Déjà faite', who: 'm1', due: '', done: true, listId: 'l1', prio: 'low' }];
  const a = provider('taches').state(ctx(ready(snap(fait)), ready(finSnapshot())));
  const b = provider('taches').state(ctx(ready(snap(emptyDoc())), ready(finSnapshot())));
  assert.equal(a.kind, 'empty');
  assert.equal(b.kind, 'empty');
  if (a.kind === 'empty' && b.kind === 'empty') assert.notEqual(a.hint, b.hint);
});

test('courses : le panier ne compte pas dans ce qui reste à prendre', () => {
  const s = provider('courses').state(ctx(ready(snap(fullDoc())), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
  if (s.kind === 'ok') assert.equal((s.data as { left: number }).left, 1);
});

test('repas : le dîner du jour, avec le temps de la recette', () => {
  const s = provider('repas').state(ctx(ready(snap(fullDoc())), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
  if (s.kind === 'ok') {
    const d = s.data as { name: string; meta: string };
    assert.equal(d.name, 'Gratin');
    assert.ok(d.meta.includes('1 h'), 'quinze et quarante-cinq minutes font une heure');
  }
});

test('finances : un mois incomplet le dit et nomme les comptes manquants', () => {
  const fin = finSnapshot();
  fin.summary = {
    ...fin.summary!, incomplete: true,
    missing: [{ accountId: 3, name: 'Compte joint', coveredThrough: '2026-08-04' }],
  };
  const s = provider('finances').state(ctx(ready(snap(fullDoc())), ready(fin)));
  assert.equal(s.kind, 'ok');
  if (s.kind === 'ok') {
    assert.ok(s.partial, 'un mois incomplet doit être signalé');
    assert.ok(s.partial!.includes('Compte joint'), 'et nommer le compte en cause');
  }
});

test('finances : une synthèse absente est une erreur, pas un solde à zéro', () => {
  const s = provider('finances').state(ctx(ready(snap(fullDoc())), ready(finSnapshot({ summary: null }))));
  assert.equal(s.kind, 'error');
});

test('finances : sans compte déclaré, le module n’a jamais servi (vide, pas zéro)', () => {
  const s = provider('finances').state(ctx(ready(snap(fullDoc())), ready(finVierge())));
  assert.equal(s.kind, 'empty');
});

test('agenda : la journée est composée, pas seulement ses rendez-vous', () => {
  const doc = fullDoc();
  doc.members[0].birthday = '2016-08-21';
  doc.tasks.push({ id: 't9', text: 'Passer chez le notaire', who: 'm1', due: '', done: false, listId: 'l1', prio: 'high', planned: TODAY });
  const fin = finSnapshot({
    dayExtras: { [TODAY]: [{ kind: 'echeance', label: 'Résilier : Assurance auto', color: '#C6492F' }] },
  });

  const s = provider('agenda').state(ctx(ready(snap(doc, [{ name: 'Vacances d’été', start: '2026-07-05', end: '2026-08-31', zone: 'A' }])), ready(fin)));
  assert.equal(s.kind, 'ok');
  if (s.kind !== 'ok') return;
  const labels = (s.data as { extras: { label: string }[] }).extras.map((x) => x.label);
  assert.ok(labels.some((l) => l.includes('Vacances')), 'les vacances scolaires marquent la journée');
  assert.ok(labels.some((l) => l.includes('Anniv. Léa')), 'un anniversaire aussi');
  assert.ok(!labels.includes('Passer chez le notaire'),
    'mais pas les tâches planifiées : la tuile Tâches est juste à côté');
  assert.ok(labels.some((l) => l.includes('Assurance auto')), 'une échéance de contrat aussi');
});

test('agenda : un jour sans rendez-vous mais avec un anniversaire n’est pas « rien de prévu »', () => {
  const doc = emptyDoc();
  doc.members = [{ id: 'm1', name: 'Léa', role: 'Enfant', color: '#9B6FA8', ini: 'LE', birthday: '2016-08-21' }];
  const s = provider('agenda').state(ctx(ready(snap(doc)), ready(finSnapshot())));
  assert.equal(s.kind, 'ok', 'un anniversaire suffit à remplir la journée');
});

test('agenda : quand les finances sont tombées, la journée dit qu’elle est amputée', () => {
  const s = provider('agenda').state(ctx(ready(snap(fullDoc())), broken()));
  assert.equal(s.kind, 'ok', 'l’agenda vit sa vie, il ne dépend pas des finances');
  if (s.kind === 'ok') {
    assert.ok(s.partial, 'mais il ne présente pas une journée incomplète comme complète');
    assert.ok(s.partial!.includes('échéances'), 'et il dit ce qui manque');
  }
});

test('taches : le compteur porte sur aujourd’hui, pas sur l’arriéré', () => {
  const doc = fullDoc();
  doc.tasks = [
    { id: 'a', text: 'Aujourd’hui', who: 'm1', due: '', done: false, listId: 'l1', prio: 'med', planned: TODAY },
    { id: 'b', text: 'Sans date', who: 'm1', due: '', done: false, listId: 'l1', prio: 'med' },
    { id: 'c', text: 'Sans date non plus', who: 'm1', due: '', done: false, listId: 'l1', prio: 'med' },
  ];
  const s = provider('taches').state(ctx(ready(snap(doc)), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
  if (s.kind === 'ok') {
    const d = s.data as { due: number; lines: unknown[] };
    assert.equal(d.due, 1, 'deux tâches sans date ne font pas deux tâches du jour');
    assert.equal(d.lines.length, 3, 'elles s’affichent quand même, pour remplir la tuile');
  }
});

test('taches : « rien pour aujourd’hui » n’est pas « tout est fait »', () => {
  const doc = fullDoc();
  doc.tasks = [{ id: 'a', text: 'Plus tard', who: 'm1', due: '', done: false, listId: 'l1', prio: 'med', planned: '2026-12-24' }];
  const s = provider('taches').state(ctx(ready(snap(doc)), ready(finSnapshot())));
  assert.equal(s.kind, 'empty');
  if (s.kind === 'empty') assert.match(s.hint, /aujourd/i);
});

test('repas : les couverts suivent la semaine type des convives', () => {
  const doc = fullDoc();
  // Le 21 août 2026 est un vendredi (jour 5). Léa n'y dîne pas.
  doc.members = [
    { id: 'me', name: 'Thomas', role: 'Papa', color: '#E56B4E', ini: 'TH' },
    { id: 'm1', name: 'Léa', role: 'Enfant', color: '#9B6FA8', ini: 'LE', absent: ['5-soir'] },
  ];
  const s = provider('repas').state(ctx(ready(snap(doc)), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
  if (s.kind === 'ok') {
    const d = s.data as { pax: string };
    assert.equal(d.pax, '1 couvert (sans Léa)', 'la tuile dit pour combien on cuisine, et pourquoi');
  }
});

test('repas : un convive attendu à qui le plat ne convient pas est signalé', () => {
  const doc = fullDoc();
  doc.articles = [{ key: 'courgette', name: 'Courgette', syn: [], rayon: 'legumes' }];
  doc.recipes = [{ id: 'r1', name: 'Gratin', level: 'Facile', color: '#7A9B76', ingr: ['3 courgettes'], steps: [] }];
  doc.members = [{ id: 'm1', name: 'Léa', role: 'Enfant', color: '#9B6FA8', ini: 'LE', refuse: ['courgette'] }];
  const s = provider('repas').state(ctx(ready(snap(doc)), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
  if (s.kind === 'ok') {
    const d = s.data as { alerts: string[] };
    assert.equal(d.alerts.length, 1, 'l’alerte remonte jusqu’à l’accueil');
    assert.match(d.alerts[0], /Léa/);
  }
});

test('repas : un convive absent ce soir-là ne déclenche pas d’alerte', () => {
  const doc = fullDoc();
  doc.articles = [{ key: 'courgette', name: 'Courgette', syn: [], rayon: 'legumes' }];
  doc.recipes = [{ id: 'r1', name: 'Gratin', level: 'Facile', color: '#7A9B76', ingr: ['3 courgettes'], steps: [] }];
  doc.members = [{ id: 'm1', name: 'Léa', role: 'Enfant', color: '#9B6FA8', ini: 'LE', refuse: ['courgette'], absent: ['5-soir'] }];
  const s = provider('repas').state(ctx(ready(snap(doc)), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
  // Une fausse alerte de plus, et plus personne ne lit les vraies.
  if (s.kind === 'ok') assert.equal((s.data as { alerts: string[] }).alerts.length, 0);
});

test('échéances : les plus proches d’abord, et le préavis est signalé comme coûteux', () => {
  const fin = finSnapshot({ deadlines: [
    echeance({ contractId: 1, contractName: 'Mutuelle', kind: 'fin', daysAway: 40 }),
    echeance({ contractId: 2, contractName: 'Assurance auto', kind: 'preavis', daysAway: 5 }),
    echeance({ contractId: 3, contractName: 'Box internet', kind: 'renouvellement', daysAway: 20 }),
  ] });
  const s = provider('echeances').state(ctx(ready(snap(fullDoc())), ready(fin)));
  assert.equal(s.kind, 'ok');
  if (s.kind !== 'ok') return;
  const lines = (s.data as { lines: { deadline: FinDeadline; label: string; costly: boolean }[] }).lines;
  assert.deepEqual(lines.map((l) => l.deadline.contractName), ['Assurance auto', 'Box internet', 'Mutuelle']);
  assert.deepEqual(lines.map((l) => l.costly), [true, false, false]);
  assert.equal(lines[0].label, 'Dernier jour pour résilier');
});

test('échéances : une date passée n’encombre plus l’accueil, elle reste dans son module', () => {
  const fin = finSnapshot({ deadlines: [echeance({ daysAway: -30 })] });
  const s = provider('echeances').state(ctx(ready(snap(fullDoc())), ready(fin)));
  assert.equal(s.kind, 'empty', 'plus aucun geste possible : rien à mettre en avant');
});

test('échéances : au-delà de l’horizon, rien n’appelle un geste aujourd’hui', () => {
  const fin = finSnapshot({ deadlines: [echeance({ daysAway: 200 })] });
  assert.equal(provider('echeances').state(ctx(ready(snap(fullDoc())), ready(fin))).kind, 'empty');
});

test('échéances : sans contrat déclaré, la tuile propose de commencer', () => {
  const s = provider('echeances').state(ctx(ready(snap(fullDoc())), ready(finVierge())));
  assert.equal(s.kind, 'empty');
  if (s.kind === 'empty') assert.ok(s.start, 'un module jamais servi propose son geste de démarrage');
});

test('énergie : un compteur à jour ne réclame rien', () => {
  const fin = finSnapshot({ energy: { contracts: 1, due: [] } });
  const s = provider('energie').state(ctx(ready(snap(fullDoc())), ready(fin)));
  assert.equal(s.kind, 'empty');
  if (s.kind === 'empty') assert.ok(!s.start, 'le module sert déjà : rien à démarrer');
});

test('énergie : sans compteur suivi, la tuile propose de commencer', () => {
  const s = provider('energie').state(ctx(ready(snap(fullDoc())), ready(finVierge())));
  assert.equal(s.kind, 'empty');
  if (s.kind === 'empty') assert.ok(s.start);
});

test('économies : les pistes ouvertes et ce qu’elles valent par an', () => {
  const s = provider('economies').state(ctx(ready(snap(fullDoc())), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
  if (s.kind === 'ok') {
    const d = s.data as { open: number; pending: number };
    assert.equal(d.open, 2);
    assert.equal(d.pending, 24000);
  }
});

test('économies : tout mené à bien n’est pas « aucune piste »', () => {
  const finies = finSnapshot({ savings: { pending: 0, done: 30000, count: 2, openCount: 0 } });
  const a = provider('economies').state(ctx(ready(snap(fullDoc())), ready(finies)));
  const b = provider('economies').state(ctx(ready(snap(fullDoc())), ready(finVierge())));
  assert.equal(a.kind, 'empty');
  assert.equal(b.kind, 'empty');
  if (a.kind === 'empty' && b.kind === 'empty') {
    assert.notEqual(a.hint, b.hint);
    assert.ok(!a.start, 'un module déjà servi ne propose pas de démarrer');
    assert.ok(b.start);
  }
});

test('planning : les créneaux du jour, à l’heure, tous membres confondus', () => {
  const doc = fullDoc();
  doc.sched = [
    { id: 'a', who: ['m1'], dow: 5, start: '17:00', end: '18:00', label: 'Judo', k: 'sport', rec: 'weekly' },
    { id: 'b', who: ['m1'], dow: 5, start: '08:30', end: '16:30', label: 'École', k: 'ecole', rec: 'weekly' },
    { id: 'c', who: ['m1'], dow: 1, start: '09:00', end: '10:00', label: 'Piano', k: 'loisir', rec: 'weekly' },
  ];
  const s = provider('planning').state(ctx(ready(snap(doc)), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
  if (s.kind === 'ok') {
    const slots = (s.data as { slots: { id: string }[] }).slots;
    assert.deepEqual(slots.map((x) => x.id), ['b', 'a'], 'un autre jour de la semaine type ne s’invite pas');
  }
});

test('planning : un créneau de période scolaire disparaît pendant les vacances', () => {
  // La recette de l'utilisateur, vue depuis l'accueil : l'école ne doit pas
  // s'annoncer un jour de vacances.
  const doc = fullDoc();
  doc.sched = [{ id: 'e', who: ['m1'], dow: 5, start: '08:30', end: '16:30', label: 'École', k: 'ecole', rec: 'weekly', when: 'school' }];
  const vacances = [{ name: 'Vacances d’été', start: '2026-07-04', end: '2026-08-31', zone: 'B' }];
  const dedans = provider('planning').state(ctx(ready(snap(doc, vacances)), ready(finSnapshot())));
  assert.equal(dedans.kind, 'empty', 'le 21 août tombe dans les vacances d’été');

  // Hors vacances, le même créneau reparaît.
  const dehors = provider('planning').state(ctx(ready(snap(doc, [{ name: 'Toussaint', start: '2026-10-17', end: '2026-11-02', zone: 'B' }])), ready(finSnapshot())));
  assert.equal(dehors.kind, 'ok');
});

test('planning : sans vacances connues, l’école s’affiche plutôt que de disparaître', () => {
  // Cacher l'école à 7h50 parce qu'une API est tombée serait pire que
  // d'afficher un créneau en trop.
  const doc = fullDoc();
  doc.sched = [{ id: 'e', who: ['m1'], dow: 5, start: '08:30', end: '16:30', label: 'École', k: 'ecole', rec: 'weekly', when: 'school' }];
  const s = provider('planning').state(ctx(ready(snap(doc, [])), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
});

test('planning : une journée sans créneau n’est pas un emploi du temps absent', () => {
  const doc = fullDoc();
  doc.sched = [{ id: 'c', who: ['m1'], dow: 7, start: '09:00', end: '10:00', label: 'Piano', k: 'loisir', rec: 'weekly' }];
  const a = provider('planning').state(ctx(ready(snap(doc)), ready(finSnapshot())));
  const b = provider('planning').state(ctx(ready(snap(emptyDoc())), ready(finSnapshot())));
  assert.equal(a.kind, 'empty');
  assert.equal(b.kind, 'empty');
  if (a.kind === 'empty' && b.kind === 'empty') {
    assert.notEqual(a.hint, b.hint);
    assert.ok(!a.start, 'l’emploi du temps existe : rien à démarrer');
    assert.ok(b.start);
  }
});

test('finances : sans compte courant, aucun solde n’est affiché plutôt qu’un zéro', () => {
  const s = provider('finances').state(ctx(ready(snap(fullDoc())), ready(finSnapshot({ currentBalance: null }))));
  assert.equal(s.kind, 'ok');
  if (s.kind === 'ok') assert.equal((s.data as { balance: number | null }).balance, null);
});

test('agenda : demain accompagne aujourd’hui, sans se confondre avec lui', () => {
  const doc = fullDoc();
  doc.events = [
    { id: 'e1', date: TODAY, time: '08:30', title: 'Dentiste', who: 'm1', recur: 'none' },
    { id: 'e2', date: '2026-08-22', time: '09:00', title: 'Match de foot', who: 'm1', recur: 'none' },
  ];
  const s = provider('agenda').state(ctx(ready(snap(doc)), ready(finSnapshot())));
  assert.equal(s.kind, 'ok');
  if (s.kind !== 'ok') return;
  const d = s.data as { events: { id: string }[]; tomorrow: { id: string }[] };
  assert.deepEqual(d.events.map((e) => e.id), ['e1']);
  assert.deepEqual(d.tomorrow.map((e) => e.id), ['e2']);
});

test('agenda : une journée vide mais un lendemain chargé n’est pas « rien de prévu »', () => {
  const doc = emptyDoc();
  doc.events = [{ id: 'e2', date: '2026-08-22', time: '09:00', title: 'Match', who: 'm1', recur: 'none' }];
  // Le soir, ce qui compte est le lendemain : le taire viderait l'écran au
  // moment précis où il sert le plus.
  assert.equal(provider('agenda').state(ctx(ready(snap(doc)), ready(finSnapshot()))).kind, 'ok');
});

// ---- péremption ------------------------------------------------------------

test('une donnée qui ne se rafraîchit plus le dit, sur toutes les tuiles', () => {
  const raison = 'Le serveur ne répond pas.';
  for (const p of TILE_PROVIDERS) {
    const s = p.source === 'finances'
      ? p.state(ctx(ready(snap(fullDoc())), ready(finSnapshot(), raison)))
      : p.state(ctx(ready(snap(fullDoc()), raison), ready(finSnapshot())));
    if (s.kind === 'ok') assert.equal(s.stale, raison, p.id);
  }
});

// ---- isolation des pannes --------------------------------------------------

test('un fournisseur qui lève ne casse pas le rendu de la page', () => {
  const explosif: TileProvider = {
    id: 'explosif', title: 'Explosif', screen: 'home', link: '', source: 'document',
    state: () => { throw new Error('boum'); },
  };
  const lignes: string[] = [];
  const bon = provider('agenda');
  const c = ctx(ready(snap(fullDoc())), ready(finSnapshot()));

  const rendu = [explosif, bon].map((p) => safeState(p, c, (l) => lignes.push(l)));

  assert.equal(rendu[0].kind, 'error', 'la tuile fautive passe en erreur');
  assert.equal(rendu[1].kind, 'ok', 'les autres tuiles continuent de fonctionner');
  assert.equal(lignes.length, 1, 'la panne est journalisée une fois');
  assert.ok(lignes[0].includes('explosif') && lignes[0].includes('boum'),
    'le journal nomme la tuile et la cause : c’est le seul moyen de diagnostic');
});

test('safeState laisse passer les états normaux sans les altérer', () => {
  const c = ctx(ready(snap(fullDoc())), ready(finSnapshot()));
  for (const p of TILE_PROVIDERS) {
    assert.deepEqual(safeState(p, c, () => { /* rien à journaliser */ }), p.state(c), p.id);
  }
});

// ---- liens morts -----------------------------------------------------------

test('aucune tuile ne pointe vers un écran qui n’existe pas', () => {
  const ecrans = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)));
  for (const p of TILE_PROVIDERS) {
    assert.ok(ecrans.has(p.screen), `tuile « ${p.id} » : l’écran « ${p.screen} » n’est pas dans la navigation`);
  }
});

test('les identifiants de tuile sont uniques', () => {
  const ids = TILE_PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});
