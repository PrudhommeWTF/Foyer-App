// Seeds a demo household into a FRESH Foyer instance and captures the
// screenshots used by the showcase site (site/assets/screens/*.webp).
//
// Usage (from the repo root, backend serving the built frontend on an EMPTY data dir):
//   FOYER_DATA_DIR=$(mktemp -d) FOYER_JWT_SECRET=demo-secret-demo-secret \
//     FOYER_STATIC_DIR=frontend/dist/frontend/browser node backend/dist/server.js &
//   node site/tools/capture.mjs            # FOYER_URL defaults to http://127.0.0.1:8099
//
// Needs Playwright (`npm i -D playwright` or a global install). The demo family is
// fictional (« Famille Martin »); every date is relative to today so the shots stay fresh.
import { chromium, devices } from 'playwright';
import { mkdir, readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.FOYER_URL || 'http://127.0.0.1:8099';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'screens');
const EMAIL = 'claire@famille-martin.fr';
const PASSWORD = 'demo-foyer-2026';

const jar = [];
async function api(method, url, body) {
  const res = await fetch(BASE + '/api' + url, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: jar.join('; ') },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie?.() || []) jar.push(c.split(';')[0]);
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

const pad = (n) => String(n).padStart(2, '0');
const day = (k) => { const d = new Date(); d.setDate(d.getDate() + k); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
// Monday of the current week, for the week-based screens (meals, timetable).
const monday = (() => { const d = new Date(); const w = (d.getDay() + 6) % 7; return -w; })();

async function seed() {
  await api('POST', '/setup', {
    household: { name: 'Famille Martin' },
    admin: { name: 'Claire', role: 'Maman', color: '#E56B4E', email: EMAIL, password: PASSWORD },
    members: [
      { name: 'Julien', role: 'Papa', color: '#4E93B8' },
      { name: 'Léa', role: '12 ans', color: '#7A9B76' },
      { name: 'Hugo', role: '8 ans', color: '#9B6FA8' },
    ],
  });
  const s = await api('GET', '/state');
  const st = s.state ?? s;
  const [C, J, L, H] = st.members.map((m) => m.id);

  st.events = [
    { id: 'e1', date: day(0), time: '17:30', endTime: '18:30', title: 'Piscine', who: [L], recur: 'none', at: ago(6), by: L },
    { id: 'e2', date: day(1), time: '14:00', endTime: '16:00', title: 'Match de handball', who: [H, J], recur: 'none', at: ago(40), by: J },
    { id: 'e3', date: day(1), time: '19:30', title: 'Dîner chez Mamie', who: [C, J, L, H], recur: 'none', at: ago(95), by: C },
    { id: 'e4', date: day(2), time: '10:00', endTime: '11:30', title: 'Marché et boulangerie', who: [C, H], recur: 'none', at: ago(300), by: C },
    { id: 'e5', date: day(3), time: '09:15', title: 'Dentiste', who: [L], recur: 'none', at: ago(1500), by: J },
    { id: 'e6', date: day(4), time: '18:00', endTime: '19:00', title: 'Réunion parents-profs', who: [C, J], recur: 'none', at: ago(2900), by: C },
    { id: 'e7', date: day(5), time: '', allDay: true, title: 'Sortie scolaire au musée', who: [H], recur: 'none', at: ago(4000), by: C },
    { id: 'e8', date: day(-2), time: '20:30', title: 'Cinéma en famille', who: [C, J, L, H], recur: 'none', at: ago(9000), by: J },
    { id: 'e9', date: day(-4), time: '18:00', endTime: '19:00', title: 'Conservatoire', who: [L], recur: 'none', at: ago(12000), by: C },
    { id: 'e10', date: day(8), time: '11:00', title: 'Anniversaire de Hugo', who: [C, J, L, H], recur: 'none', at: ago(15000), by: C },
    { id: 'e11', date: day(10), time: '08:45', title: 'Contrôle technique', who: [J], recur: 'none', at: ago(16000), by: J },
    { id: 'e12', date: day(-8), time: '', allDay: true, title: 'Journée pédagogique', who: [L, H], recur: 'none', at: ago(20000), by: C },
    { id: 'e13', date: day(13), time: '15:00', endTime: '17:00', title: 'Tournoi de handball', who: [H], recur: 'none', at: ago(21000), by: J },
  ];
  st.recipes = [
    { id: 'r1', name: 'Gratin dauphinois', level: 'Facile', color: '#F0B24B', portions: 4, prepMin: 20, cookMin: 60, tags: ['four', 'famille'], rating: 5,
      ingr: ['1 kg de pommes de terre', '50 cl de crème', '25 cl de lait', '1 gousse d’ail', 'Muscade'], steps: ['Éplucher et trancher finement.', 'Disposer, napper de crème.', 'Cuire 1 h à 160 °C.'] },
    { id: 'r2', name: 'Poulet rôti au citron', level: 'Facile', color: '#E56B4E', portions: 4, prepMin: 15, cookMin: 75, tags: ['dimanche'], rating: 4,
      ingr: ['1 poulet fermier', '2 citrons', 'Thym', '4 pommes de terre'], steps: ['Farcir le poulet de citron.', 'Rôtir 1 h 15.'] },
    { id: 'r3', name: 'Soupe de potiron', level: 'Facile', color: '#7A9B76', portions: 6, prepMin: 15, cookMin: 30, tags: ['végétarien', 'automne'], rating: 4,
      ingr: ['1 potiron', '2 oignons', '1 l de bouillon'], steps: ['Faire revenir, mouiller, mixer.'] },
    { id: 'r4', name: 'Lasagnes maison', level: 'Moyen', color: '#9B6FA8', portions: 6, prepMin: 40, cookMin: 45, tags: ['famille'], rating: 5,
      ingr: ['Pâtes à lasagne', '500 g de bœuf haché', 'Sauce tomate', 'Béchamel', 'Parmesan'], steps: ['Monter les couches.', 'Cuire 45 min.'] },
    { id: 'r5', name: 'Crêpes de la Chandeleur', level: 'Facile', color: '#F0B24B', portions: 4, prepMin: 10, cookMin: 20, tags: ['goûter'], rating: 5,
      ingr: ['250 g de farine', '4 œufs', '50 cl de lait'], steps: ['Mélanger, laisser reposer, cuire.'] },
    { id: 'r6', name: 'Saumon et riz au curry', level: 'Facile', color: '#4E93B8', portions: 4, prepMin: 10, cookMin: 20, tags: ['rapide'], rating: 4,
      ingr: ['4 pavés de saumon', '250 g de riz', 'Lait de coco', 'Curry'], steps: ['Cuire le riz, saisir le saumon.'] },
  ];
  const plan = [['r3', 'r1'], ['r6', 'r4'], [null, 'r2'], ['r1', 'r5'], ['r6', 'r3'], ['r5', 'r4'], ['r2', 'r3'],
    ['r1', 'r6'], ['r4', 'r2'], [null, 'r5'], ['r3', 'r1'], ['r6', 'r4'], ['r2', 'r5'], ['r1', 'r3']];
  st.meals = {};
  plan.forEach(([midi, soir], i) => {
    const d = day(monday + i);
    if (midi) st.meals[`${d}-midi`] = { items: [{ rid: midi }] };
    if (soir) st.meals[`${d}-soir`] = { items: [{ rid: soir }] };
  });
  st.meals[`${day(monday + 2)}-midi`] = { items: [{ text: 'Cantine' }] };
  const slot = (id, who, dow, start, end, label, k, away = true) => ({ id, who, dow, start, end, label, k, away, rec: 'weekly' });
  st.sched = [
    ...[1, 2, 4, 5].map((d) => slot('s-ecole-l' + d, [L], d, '08:00', '16:30', 'Collège', 'ecole')),
    slot('s-ecole-l3', [L], 3, '08:00', '12:00', 'Collège', 'ecole'),
    ...[1, 2, 4, 5].map((d) => slot('s-ecole-h' + d, [H], d, '08:30', '16:30', 'École', 'ecole')),
    ...[1, 2, 3, 4, 5].map((d) => slot('s-trav-c' + d, [C], d, '09:00', '17:30', 'Travail', 'travail')),
    ...[1, 2, 3, 4].map((d) => slot('s-trav-j' + d, [J], d, '08:30', '18:00', 'Travail', 'travail')),
    slot('s-hand', [H], 3, '14:00', '15:30', 'Handball', 'sport'),
    slot('s-pisc', [L], 5, '17:30', '18:30', 'Piscine', 'sport'),
    slot('s-guit', [J], 2, '20:00', '21:00', 'Guitare', 'loisir', false),
  ];
  st.contacts = [
    { id: 'c1', name: 'Dr Lefèvre', role: 'Médecin traitant', phone: '01 23 45 67 89', email: '', cat: 'Santé', color: '#C77DA5', urgent: true },
    { id: 'c2', name: 'Collège Jean-Moulin', role: 'Vie scolaire', phone: '01 98 76 54 32', email: '', cat: 'École', color: '#4E93B8', urgent: false },
    { id: 'c3', name: 'Mamie Jeanne', role: 'Grand-mère', phone: '06 11 22 33 44', email: '', cat: 'Famille', color: '#F0B24B', urgent: false },
  ];
  st.taskLists = [
    { id: 'l1', name: 'Maison', color: '#E56B4E', icon: 'maison', kind: 'taches', scope: 'shared', position: 0 },
    { id: 'l2', name: 'École', color: '#4E93B8', icon: 'checklist', kind: 'taches', scope: 'shared', position: 1 },
  ];
  st.shopLists = [
    { id: 'cl1', name: 'Courses de la semaine', color: '#7A9B76', icon: 'panier' },
    { id: 'cl2', name: 'Bricolage', color: '#F0B24B', icon: 'maison' },
  ];
  await api('PUT', '/state', s.state ? { ...s, state: st } : st);

  let n = 0;
  const op = (o) => ({ opId: 'demo-' + ++n, ...o });
  const task = (id, listId, text, who, due, by, min, extra = {}) => op({ op: 'add', id, listId, text, who, due, by, at: ago(min), ...extra });
  await api('POST', '/tasks/ops', { ops: [
    task('t1', 'l1', 'Sortir les poubelles', [H], day(0), C, 30),
    task('t2', 'l1', 'Arroser les plantes', [L], day(0), C, 200, { done: true, doneAt: ago(12), doneBy: L }),
    task('t3', 'l1', 'Appeler le plombier', [J], day(1), C, 600),
    task('t4', 'l2', 'Signer le carnet de liaison', [C, J], day(1), L, 90),
    task('t5', 'l2', 'Acheter un compas', [C], day(3), L, 1400),
    task('t6', 'l1', 'Changer les draps', [], day(2), J, 2000),
  ] });
  const art = (id, name, qty, aisleId, by, min) => op({ op: 'add', id, name, qty, aisleId, listId: 'cl1', by, at: ago(min < 30 ? min + 2000 : min) });
  await api('POST', '/shopping/ops', { ops: [
    art('i1', 'Pommes de terre', '1 kg', 'a-legumes', C, 20), art('i2', 'Potiron', '1', 'a-legumes', C, 21),
    art('i3', 'Citrons', '2', 'a-legumes', J, 300), art('i4', 'Poulet fermier', '1', 'a-viande', C, 22),
    art('i5', 'Pavés de saumon', '4', 'a-poisson', C, 23), art('i6', 'Baguette', '2', 'a-boulangerie', H, 50),
    art('i7', 'Crème fraîche', '50 cl', 'a-frais', C, 24), art('i8', 'Lait demi-écrémé', '2 l', 'a-frais', L, 35),
    art('i9', 'Œufs', '12', 'a-frais', C, 25), art('i10', 'Riz basmati', '1 kg', 'a-feculents', J, 400),
    art('i11', 'Lait de coco', '2', 'a-conserves', C, 26), art('i12', 'Liquide vaisselle', '1', 'a-entretien', J, 800),
  ] });
  await api('POST', '/shopping/ops', { ops: [op({ op: 'set-state', id: 'i6', state: 'panier', by: H, at: ago(4) }), op({ op: 'set-state', id: 'i9', state: 'panier', by: C, at: ago(3) })] });
}

async function session(browser, opts, scheme) {
  const ctx = await browser.newContext({ ...opts, locale: 'fr-FR', timezoneId: 'Europe/Paris', colorScheme: scheme });
  const p = await ctx.newPage();
  await p.goto(BASE + '/');
  await p.locator('input').nth(0).fill(EMAIL);
  await p.locator('input').nth(1).fill(PASSWORD);
  await p.getByRole('button', { name: 'Se connecter' }).click();
  await p.waitForTimeout(2200);
  const later = p.getByRole('button', { name: 'Plus tard' });
  if (await later.count()) await later.first().click().catch(() => {});
  await p.waitForTimeout(2800); // let the welcome toast leave
  return [ctx, p];
}
async function go(p, label, mobile) {
  if (mobile) { await p.getByRole('button', { name: 'Accueil' }).first().click().catch(() => {}); await p.waitForTimeout(500); }
  await p.getByText(label, { exact: true }).first().click();
  await p.waitForTimeout(1600);
}
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + '.png') });

await mkdir(OUT, { recursive: true });
await seed();
const browser = await chromium.launch();
const desk = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const phone = { ...devices['iPhone 13'] };

for (const scheme of ['light', 'dark']) {
  let [ctx, p] = await session(browser, desk, scheme);
  await shot(p, `bureau-accueil-${scheme}`);
  await go(p, 'Calendrier'); await p.getByText('Mois', { exact: true }).first().click().catch(() => {}); await p.waitForTimeout(1200);
  await shot(p, `bureau-calendrier-${scheme}`);
  await go(p, 'Listes de courses'); await shot(p, `bureau-courses-${scheme}`);
  await go(p, 'Planning des repas'); await shot(p, `bureau-repas-${scheme}`);
  await go(p, 'Emploi du temps'); await shot(p, `bureau-emploi-du-temps-${scheme}`);
  await go(p, 'Carnet de recettes'); await shot(p, `bureau-recettes-${scheme}`);
  await ctx.close();

  [ctx, p] = await session(browser, phone, scheme);
  await shot(p, `mobile-accueil-${scheme}`);
  await go(p, 'Listes de courses', true); await shot(p, `mobile-courses-${scheme}`);
  await go(p, 'Tâches', true); await shot(p, `mobile-taches-${scheme}`);
  await go(p, 'Planning des repas', true); await shot(p, `mobile-repas-${scheme}`);
  await ctx.close();
}
// PNG → WebP with Chromium's own encoder (no image dependency): desktop 1600 px wide, phone 720 px.
const conv = await (await browser.newContext()).newPage();
for (const f of (await readdir(OUT)).filter((x) => x.endsWith('.png'))) {
  const src = 'data:image/png;base64,' + (await readFile(path.join(OUT, f))).toString('base64');
  const webp = await conv.evaluate(async ([src, w]) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = Math.round(img.height * w / img.width);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', 0.84).split(',')[1];
  }, [src, f.startsWith('bureau') ? 1600 : 720]);
  await writeFile(path.join(OUT, f.replace(/\.png$/, '.webp')), Buffer.from(webp, 'base64'));
  await unlink(path.join(OUT, f));
}
await browser.close();
console.log('Captures écrites dans', OUT);
