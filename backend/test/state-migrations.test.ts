// Ces migrations touchent des données déjà saisies : des recettes, des listes de
// courses réelles. Deux propriétés y comptent plus que tout, et chaque test
// ci-dessous en vérifie une :
//   - rejouer une migration ne doit rien casser ;
//   - rien ne doit disparaître en silence, même ce qui n'a pas pu être converti.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STATE_MIGRATIONS, STATE_VERSION, decodeDataUrl, fileStorer, migrateState, parseFrenchDuration } from '../src/state/migrations';

/** Une image PNG minuscule mais valide, telle qu'une ancienne fiche en contenait. */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Le décodage et la reconnaissance du type sont ceux du démarrage : seul le
 * rangement sur le disque est remplacé. Un bouchon plus permissif rendrait ces
 * tests plus verts que la réalité.
 */
const stub = () => {
  const stored: { kind: string; ownerId: string; name: string; mime: string; bytes: number }[] = [];
  let next = 100;
  return {
    stored,
    ctx: {
      storeDataUrl: fileStorer((kind, ownerId, name, buf, type) => {
        stored.push({ kind, ownerId, name, mime: type.mime, bytes: buf.length });
        return next++;
      }),
    },
  };
};

const run = (doc: Record<string, any>, from = 0) => {
  const s = stub();
  const outcome = migrateState(doc, from, s.ctx, null);
  return { doc, outcome, stored: s.stored };
};

// ---- photos de recettes ----------------------------------------------------

test('une photo en data-URL sort du document et laisse un identifiant', () => {
  const { doc, stored } = run({ recipes: [{ id: 'r1', name: 'Gratin', photo: PNG_DATA_URL }] });
  assert.equal(doc['recipes'][0].photoId, 100);
  assert.equal('photo' in doc['recipes'][0], false, 'la data-URL ne doit plus alourdir le document');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].ownerId, 'r1');
  assert.ok(stored[0].bytes > 0);
});

test('une photo illisible reste dans le document plutôt que d’être effacée', () => {
  // C'est la règle « sans perte » : on ne sait pas la convertir, on ne la jette
  // pas pour autant. Une note le signale, la fiche reste réparable à la main.
  const { doc, outcome } = run({ recipes: [{ id: 'r1', name: 'X', photo: 'data:image/png;base64,%%%pas-du-base64' }] });
  assert.equal(doc['recipes'][0].photo, 'data:image/png;base64,%%%pas-du-base64');
  assert.equal(doc['recipes'][0].photoId, undefined);
  assert.ok(outcome.notes.some((n) => /illisible/.test(n)));
});

test('une recette sans photo, ou déjà migrée, traverse sans être touchée', () => {
  const { doc, stored } = run({
    recipes: [
      { id: 'r1', name: 'Sans photo', photo: null },
      { id: 'r2', name: 'Déjà migrée', photoId: 42 },
      { id: 'r3', name: 'Jamais eu de clé' },
    ],
  });
  assert.equal(stored.length, 0);
  assert.equal(doc['recipes'][1].photoId, 42);
  assert.equal(doc['recipes'][2].name, 'Jamais eu de clé');
  assert.ok(doc['recipes'].every((r: any) => !('photo' in r)));
});

// ---- rayons et articles ----------------------------------------------------

test('le rayon passe du nom à l’identifiant, sans changer de rayon', () => {
  const { doc } = run({
    aisles: [{ id: 'a1', name: 'Frais', color: '#4E93B8' }],
    shop: [{ id: 's1', name: 'Beurre', qty: '250 g', cat: 'Frais', done: false, listId: 'cl1' }],
  });
  assert.equal(doc['shop'][0].aisleId, 'a1');
  assert.equal('cat' in doc['shop'][0], false);
  assert.equal(doc['aisles'][0].position, 0);
});

test('un article dans un rayon fantôme fait recréer le rayon, il ne se perd pas', () => {
  // Le défaut d'origine : « Depuis le planning repas » ne correspondait à aucun
  // rayon, et l'interface ne savait ni le renommer ni le supprimer.
  const { doc, outcome } = run({
    aisles: [{ id: 'a1', name: 'Frais', color: '#4E93B8' }],
    shop: [{ id: 's1', name: 'Pâtes', cat: 'Depuis le planning repas', done: false, listId: 'cl1' }],
  });
  const recreated = doc['aisles'].find((a: any) => a.name === 'Depuis le planning repas');
  assert.ok(recreated, 'le rayon manquant doit être créé');
  assert.equal(doc['shop'][0].aisleId, recreated.id);
  assert.ok(outcome.notes.some((n) => /Rayon\(s\) recréé/.test(n)));
});

test('un article sans rayon du tout atterrit dans « À trier », créé au besoin', () => {
  const { doc } = run({ aisles: [], shop: [{ id: 's1', name: 'Sel', listId: 'cl1' }] });
  const tri = doc['aisles'].find((a: any) => a.name === 'À trier');
  assert.ok(tri);
  assert.equal(doc['shop'][0].aisleId, tri.id);
});

test('deux articles du même rayon fantôme partagent le rayon recréé', () => {
  const { doc } = run({
    aisles: [],
    shop: [
      { id: 's1', name: 'Pain', cat: 'Boulangerie', listId: 'cl1' },
      { id: 's2', name: 'Brioche', cat: 'Boulangerie', listId: 'cl1' },
    ],
  });
  assert.equal(doc['shop'][0].aisleId, doc['shop'][1].aisleId);
  assert.equal(doc['aisles'].filter((a: any) => a.name === 'Boulangerie').length, 1);
});

test('« coché » devient « dans le panier », « non coché » devient « à prendre »', () => {
  const { doc } = run({
    aisles: [{ id: 'a1', name: 'Frais', color: '#4E93B8' }],
    shop: [
      { id: 's1', name: 'A', cat: 'Frais', done: true, listId: 'cl1' },
      { id: 's2', name: 'B', cat: 'Frais', done: false, listId: 'cl1' },
    ],
  });
  assert.equal(doc['shop'][0].state, 'panier');
  assert.equal(doc['shop'][1].state, 'a-prendre');
  assert.ok(doc['shop'].every((i: any) => !('done' in i)));
});

test('les rangs des rayons suivent l’ordre du document d’origine', () => {
  const { doc } = run({
    aisles: [{ id: 'a1', name: 'Un' }, { id: 'a2', name: 'Deux' }, { id: 'a3', name: 'Trois' }],
    shop: [],
  });
  assert.deepEqual(doc['aisles'].map((a: any) => a.position), [0, 1, 2]);
});

// ---- portions et temps des recettes ----------------------------------------

test('la durée en texte libre est reprise en temps de préparation', () => {
  // L'ancien champ ne disait pas s'il valait la préparation, la cuisson ou le
  // total : le reprendre en préparation ne fabrique pas de cuisson imaginaire.
  const { doc } = run({ recipes: [{ id: 'r1', name: 'A', time: '45 min' }, { id: 'r2', name: 'B', time: '1 h 30' }] });
  assert.equal(doc['recipes'][0].prepMin, 45);
  assert.equal(doc['recipes'][1].prepMin, 90);
  assert.ok(doc['recipes'].every((r: any) => !('time' in r)));
});

test('une durée illisible laisse le champ vide et se signale', () => {
  const { doc, outcome } = run({ recipes: [{ id: 'r1', name: 'A', time: 'un moment' }] });
  assert.equal(doc['recipes'][0].prepMin, undefined);
  assert.ok(outcome.notes.some((n) => /illisible/.test(n)));
});

test('le tiret de remplissage n’est pas compté comme une durée illisible', () => {
  const { outcome } = run({ recipes: [{ id: 'r1', name: 'A', time: '—' }] });
  assert.equal(outcome.notes.some((n) => /illisible/.test(n)), false);
});

test('une recette déjà en minutes n’est pas retouchée', () => {
  const { doc } = run({ recipes: [{ id: 'r1', name: 'A', time: '45 min', prepMin: 10, cookMin: 20 }] });
  assert.equal(doc['recipes'][0].prepMin, 10);
  assert.equal(doc['recipes'][0].cookMin, 20);
});

test('les durées à la française se lisent sous leurs formes courantes', () => {
  assert.equal(parseFrenchDuration('45 min'), 45);
  assert.equal(parseFrenchDuration('1 h 30'), 90);
  assert.equal(parseFrenchDuration('1h30'), 90);
  assert.equal(parseFrenchDuration('2 heures'), 120);
  assert.equal(parseFrenchDuration('20'), 20);
  assert.equal(parseFrenchDuration('1 h'), 60);
  for (const v of ['', '—', 'un moment', 'toute la nuit', null, '0 min']) {
    assert.equal(parseFrenchDuration(v), null, String(v));
  }
});

// ---- plusieurs plats par créneau -------------------------------------------

test('un repas unique devient le premier plat de son créneau', () => {
  const { doc } = run({
    meals: {
      '2026-08-21-soir': { rid: 'r1' },
      '2026-08-22-midi': { text: 'Restes' },
    },
  });
  assert.deepEqual(doc['meals']['2026-08-21-soir'], { items: [{ rid: 'r1' }] });
  assert.deepEqual(doc['meals']['2026-08-22-midi'], { items: [{ text: 'Restes' }] });
});

test('un créneau qui ne portait rien devient une liste vide', () => {
  // L'écran l'affiche « Libre », comme avant : rien n'est perdu, rien n'est inventé.
  const { doc } = run({ meals: { '2026-08-21-midi': {}, '2026-08-21-soir': null } });
  assert.deepEqual(doc['meals']['2026-08-21-midi'], { items: [] });
  assert.deepEqual(doc['meals']['2026-08-21-soir'], { items: [] });
});

test('un créneau déjà en liste n’est pas retouché', () => {
  const deja = { items: [{ rid: 'r1' }, { rid: 'r2' }, { text: 'Tarte' }] };
  const { doc } = run({ meals: { '2026-08-21-soir': deja } });
  assert.deepEqual(doc['meals']['2026-08-21-soir'], deja);
});

test('aucun repas du planning ne disparaît', () => {
  const meals: Record<string, any> = {};
  for (let i = 1; i <= 14; i++) meals[`2026-08-${String(i).padStart(2, '0')}-soir`] = { rid: 'r' + i };
  const { doc, outcome } = run({ meals });
  assert.equal(Object.keys(doc['meals']).length, 14);
  assert.ok(Object.values(doc['meals']).every((v: any) => v.items.length === 1));
  assert.ok(outcome.notes.some((n) => /14 repas/.test(n)));
});

test('un planning absent ou biscornu ne fait pas tomber la migration', () => {
  for (const meals of [undefined, null, [], 'nope', 42]) {
    assert.doesNotThrow(() => run({ meals } as Record<string, any>));
  }
});

// ---- les garanties transverses ---------------------------------------------

test('rejouer les migrations sur un document déjà migré ne change rien', () => {
  const before = {
    recipes: [{ id: 'r1', name: 'Gratin', photo: PNG_DATA_URL, time: '45 min' }],
    aisles: [{ id: 'a1', name: 'Frais', color: '#4E93B8' }],
    shop: [{ id: 's1', name: 'Beurre', cat: 'Frais', done: true, listId: 'cl1' }],
    meals: { '2026-08-21-soir': { rid: 'r1' } },
  };
  const { doc } = run(before);
  const snapshot = JSON.stringify(doc);

  // Rejeu complet, en repartant de la version 0 comme le ferait une restauration
  // d'une base dont la version aurait été perdue.
  const again = run(JSON.parse(snapshot));
  assert.equal(JSON.stringify(again.doc), snapshot, 'la seconde passe doit être un no-op');
  assert.equal(again.stored.length, 0, 'aucune photo ne doit être rangée deux fois');
});

test('aucun article ni aucune recette ne disparaît en chemin', () => {
  const doc = {
    recipes: [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B', photo: PNG_DATA_URL }, { id: 'r3', name: 'C' }],
    aisles: [{ id: 'a1', name: 'Frais' }],
    shop: [
      { id: 's1', name: 'Un', cat: 'Frais', listId: 'cl1' },
      { id: 's2', name: 'Deux', cat: 'Inconnu', listId: 'cl1' },
      { id: 's3', name: 'Trois', listId: 'cl2' },
    ],
  };
  const res = run(doc);
  assert.equal(res.doc['recipes'].length, 3);
  assert.equal(res.doc['shop'].length, 3);
  assert.deepEqual(res.doc['shop'].map((i: any) => i.name), ['Un', 'Deux', 'Trois']);
  // Chaque article référence un rayon qui existe vraiment.
  const ids = new Set(res.doc['aisles'].map((a: any) => a.id));
  assert.ok(res.doc['shop'].every((i: any) => ids.has(i.aisleId)));
});

test('un document vide, partiel ou biscornu ne fait pas tomber la migration', () => {
  for (const doc of [{}, { recipes: null, shop: 'nope', aisles: 42 }, { shop: [] }] as Record<string, any>[]) {
    assert.doesNotThrow(() => run(doc));
  }
});

test('la migration part de la version atteinte, pas du début', () => {
  const doc = { recipes: [{ id: 'r1', name: 'A', photo: PNG_DATA_URL }], aisles: [], shop: [] };
  const res = run(doc, 1);
  assert.equal(res.stored.length, 0, 'la migration 1 ne doit pas être rejouée');
  assert.deepEqual(res.outcome.applied.map((a) => a.version), [2, 3, 4, 5, 6, 7, 8]);
  assert.equal(res.outcome.to, STATE_VERSION);
});

test('un document déjà à jour ne déclenche ni transformation ni sauvegarde', () => {
  const res = run({ recipes: [], aisles: [], shop: [] }, STATE_VERSION);
  assert.deepEqual(res.outcome.applied, []);
  assert.equal(res.outcome.backupPath, null);
  assert.equal(res.outcome.to, STATE_VERSION);
});

test('la sauvegarde du document d’origine est écrite avant toute transformation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-mig-'));
  try {
    const doc: Record<string, any> = { recipes: [{ id: 'r1', name: 'Gratin', photo: PNG_DATA_URL }], aisles: [], shop: [] };
    const outcome = migrateState(doc, 0, stub().ctx, dir);
    assert.ok(outcome.backupPath, 'un chemin de sauvegarde doit être rendu');
    const saved = JSON.parse(fs.readFileSync(outcome.backupPath!, 'utf8'));
    // La copie doit porter l'ANCIENNE forme : c'est ce qui rend le retour arrière possible.
    assert.equal(saved.recipes[0].photo, PNG_DATA_URL);
    assert.equal(saved.recipes[0].photoId, undefined);
    assert.match(path.basename(outcome.backupPath!), /^state-avant-migration-v0-/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- migration 5 : les documents quittent le document d'état ---------------

/** Un PDF minuscule mais authentique : le type est reconnu d'après les octets. */
const PDF_DATA_URL = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.7\n' + ' '.repeat(64)).toString('base64');
/** Un .odt : une archive ZIP, que le détecteur partagé laisse sans nom. */
const ODT_DATA_URL = 'data:application/octet-stream;base64,' + Buffer.from('PK\u0003\u0004' + 'x'.repeat(64), 'latin1').toString('base64');

test('les documents sont rangés sur le disque et ne laissent qu’un identifiant', () => {
  const doc = { files: [{ id: 'd1', name: 'Passeport.pdf', folderId: 'f1', type: 'PDF', date: '3 mars 2026', data: PDF_DATA_URL }] };
  const res = run(doc);
  assert.equal(res.stored.length, 1);
  assert.equal(res.stored[0].kind, 'document', 'un document n’est pas rangé comme une photo de recette');
  assert.equal(res.stored[0].ownerId, 'd1');
  assert.equal(res.stored[0].name, 'Passeport.pdf');
  assert.equal(res.stored[0].mime, 'application/pdf');
  assert.equal(res.doc['files'][0].fileId, 100);
  assert.equal('data' in res.doc['files'][0], false, 'les octets ne doivent plus être dans l’état');
  // Le reste de la fiche est intact : c'est elle que l'utilisateur reconnaît.
  assert.equal(res.doc['files'][0].name, 'Passeport.pdf');
  assert.equal(res.doc['files'][0].folderId, 'f1');
  assert.equal(res.doc['files'][0].date, '3 mars 2026');
});

test('un format que le détecteur ne nomme pas est rangé quand même', () => {
  // Refuser un .txt ou un traitement de texte exotique le laisserait en data-URL
  // dans l'état, c'est-à-dire exactement la dette que cette migration solde.
  const inconnu = 'data:application/octet-stream;base64,' + Buffer.from('note libre'.repeat(20)).toString('base64');
  const res = run({ files: [{ id: 'd1', name: 'Notes.txt', data: inconnu }, { id: 'd2', name: 'Bail.odt', data: ODT_DATA_URL }] });
  assert.equal(res.stored.length, 2);
  assert.equal(res.stored[0].mime, 'application/octet-stream');
  assert.equal(res.stored[1].mime, 'application/octet-stream');
  assert.equal(res.doc['files'][0].fileId, 100);
  assert.equal(res.doc['files'][1].fileId, 101);
});

test('un document illisible reste dans l’état, nommé plutôt que compté', () => {
  const res = run({ files: [
    { id: 'd1', name: 'Cassé.pdf', data: 'data:application/pdf;base64,' },
    { id: 'd2', name: 'Bon.pdf', data: PDF_DATA_URL },
  ] });
  assert.equal(res.stored.length, 1, 'seul le document lisible est rangé');
  // Rien ne disparaît en silence : la data-URL survit telle quelle.
  assert.equal(res.doc['files'][0].data, 'data:application/pdf;base64,');
  assert.equal(res.doc['files'][0].fileId, undefined);
  const note = res.outcome.notes.find((n) => n.includes('illisible'));
  assert.ok(note, 'la migration doit signaler ce qu’elle n’a pas su convertir');
  assert.ok(note!.includes('Cassé.pdf'), 'la fiche à rouvrir doit être nommée');
});

test('rejouer la migration des documents ne range rien une seconde fois', () => {
  const doc = { files: [{ id: 'd1', name: 'Passeport.pdf', data: PDF_DATA_URL }] };
  run(doc);
  const again = run(doc);
  assert.equal(again.stored.length, 0);
  assert.equal(again.doc['files'][0].fileId, 100);
});

test('une fiche sans fichier perd sa clé vide sans être rangée', () => {
  const res = run({ files: [{ id: 'd1', name: 'Sans pièce', data: null }] });
  assert.equal(res.stored.length, 0);
  assert.equal('data' in res.doc['files'][0], false);
});

// ---- emploi du temps -------------------------------------------------------

/** Un foyer minimal : les membres décident quels créneaux sont rattachables. */
const foyer = (sched: any[]) => ({ members: [{ id: 'me' }, { id: 'm1' }], sched });

test('un créneau à un seul membre devient un créneau à liste de membres', () => {
  const res = run(foyer([{ id: 's1', who: 'm1', day: 'Mardi', start: '08:00', end: '16:30', label: 'École', k: 'ecole' }]));
  const slot = res.doc['sched'][0];
  assert.deepEqual(slot.who, ['m1']);
  assert.equal(slot.dow, 2);
  assert.equal('day' in slot, false, 'le nom du jour ne doit plus traîner à côté du numéro');
  assert.equal(slot.label, 'École');
});

test('les sept jours se numérotent de lundi à dimanche', () => {
  const jours = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const res = run(foyer(jours.map((day, i) => ({ id: 's' + i, who: 'me', day, start: '09:00', label: day, k: 'autre' }))));
  assert.deepEqual(res.doc['sched'].map((s: any) => s.dow), [1, 2, 3, 4, 5, 6, 7]);
});

test('un créneau rattaché à un membre inconnu est conservé sans membre, et signalé', () => {
  // C'est le cas du foyer réel : le filtre s'initialisait sur « lea », un
  // identifiant de la maquette, et les créneaux créés lui étaient attribués.
  const res = run(foyer([{ id: 's1', who: 'lea', day: 'Lundi', start: '07:50', label: 'Car', k: 'ecole' }]));
  assert.equal(res.doc['sched'].length, 1, 'le créneau ne doit pas partir avec le membre fantôme');
  assert.deepEqual(res.doc['sched'][0].who, []);
  assert.deepEqual(res.doc['sched'][0].label, 'Car');
  assert.ok(res.outcome.notes.some((n) => /membre inconnu/.test(n)));
});

test('un jour illisible place le créneau au lundi et le nomme dans le journal', () => {
  const res = run(foyer([{ id: 's1', who: 'me', day: 'Lundu', start: '09:00', label: 'Cabinet', k: 'travail' }]));
  assert.equal(res.doc['sched'][0].dow, 1);
  assert.ok(res.outcome.notes.some((n) => /Cabinet/.test(n)), 'le créneau doit être nommé pour être retrouvé');
});

test('un créneau déjà migré n’est pas retouché', () => {
  const res = run(foyer([{ id: 's1', who: ['me', 'm1'], dow: 7, start: '10:30', end: '11:30', label: 'Messe', k: 'loisir' }]));
  assert.deepEqual(res.doc['sched'][0].who, ['me', 'm1']);
  assert.equal(res.doc['sched'][0].dow, 7);
});

test('rejouer la migration de l’emploi du temps ne change rien', () => {
  const premier = run(foyer([
    { id: 's1', who: 'm1', day: 'Mercredi', start: '14:00', end: '15:00', label: 'Gym', k: 'sport' },
    { id: 's2', who: 'lea', day: 'Dimanche', start: '10:30', label: 'Messe', k: 'loisir' },
  ]));
  const snapshot = JSON.stringify(premier.doc);
  const second = run(JSON.parse(snapshot));
  assert.equal(JSON.stringify(second.doc), snapshot, 'la seconde passe doit être un no-op');
});

test('aucun créneau ne disparaît, quel que soit son état', () => {
  const res = run(foyer([
    { id: 's1', who: 'me', day: 'Lundi', start: '09:00', label: 'A', k: 'travail' },
    { id: 's2', who: 'inconnu', day: 'Mardi', start: '10:00', label: 'B', k: 'autre' },
    { id: 's3', day: 'Jeudi', start: '11:00', label: 'C', k: 'autre' },
    { id: 's4', who: ['m1'], dow: 5, start: '12:00', label: 'D', k: 'repas' },
  ]));
  assert.deepEqual(res.doc['sched'].map((s: any) => s.label), ['A', 'B', 'C', 'D']);
  assert.ok(res.doc['sched'].every((s: any) => Array.isArray(s.who) && typeof s.dow === 'number'));
});

test('un créneau existant devient explicitement hebdomadaire', () => {
  // Il l'était déjà, implicitement : « tous les lundis, pour toujours ». La
  // migration rend la règle lisible sans changer le comportement.
  const res = run(foyer([{ id: 's1', who: 'me', day: 'Lundi', start: '09:00', label: 'Cabinet', k: 'travail' }]));
  assert.equal(res.doc['sched'][0].rec, 'weekly');
  assert.equal(res.doc['sched'][0].from, undefined, 'aucune période n’est inventée');
  assert.equal(res.doc['sched'][0].until, undefined);
  assert.equal(res.doc['sched'][0].when, undefined);
});

test('un créneau ponctuel déjà posé garde sa récurrence', () => {
  const res = run(foyer([{ id: 's1', who: ['me'], dow: 2, rec: 'once', date: '2026-09-08', start: '10:00', label: 'Médecin', k: 'sante' }]));
  assert.equal(res.doc['sched'][0].rec, 'once');
  assert.equal(res.doc['sched'][0].date, '2026-09-08');
});

test('un emploi du temps absent ou biscornu ne fait pas tomber la migration', () => {
  assert.doesNotThrow(() => run({ members: [{ id: 'me' }] }));
  assert.doesNotThrow(() => run({ members: [{ id: 'me' }], sched: 'oui' }));
  assert.doesNotThrow(() => run({ sched: [{ id: 's1', who: 'me', day: 'Lundi' }] }));
});

// ---- couverts déduits de l'emploi du temps ----------------------------------

const avecAbsences = (absent: string[], sched: any[] = []) =>
  ({ members: [{ id: 'me', absent }, { id: 'm1' }], sched });

test('une case de la semaine type devient un créneau « hors du foyer »', () => {
  const res = run(avecAbsences(['1-midi']));
  const creneau = res.doc['sched'].find((s: any) => s.away);
  assert.ok(creneau, 'la case cochée ne doit pas disparaître avec le champ');
  assert.deepEqual(creneau.who, ['me']);
  assert.equal(creneau.dow, 1);
  assert.equal(creneau.rec, 'weekly');
  // Les bornes encadrent l'heure du déjeuner, sinon le créneau ne couvrirait
  // pas le repas qu'il est censé retirer.
  assert.ok(creneau.start <= '12:30' && creneau.end > '12:30', 'le créneau doit couvrir 12h30');
  assert.equal('absent' in res.doc['members'][0], false, 'le champ disparaît une fois converti');
});

test('deux membres absents au même repas partagent un seul créneau', () => {
  const doc = { members: [{ id: 'me', absent: ['3-soir'] }, { id: 'm1', absent: ['3-soir'] }], sched: [] };
  const res = run(doc);
  const dehors = res.doc['sched'].filter((s: any) => s.away);
  assert.equal(dehors.length, 1, 'une ligne, pas deux');
  assert.deepEqual(dehors[0].who.sort(), ['m1', 'me']);
});

test('la conversion des absences est nommée dans le journal', () => {
  const res = run(avecAbsences(['1-midi', '2-soir']));
  assert.ok(res.outcome.notes.some((n) => /absence\(s\) de la semaine type/.test(n)));
});

test('une case illisible est ignorée sans faire tomber la migration', () => {
  const res = run(avecAbsences(['9-midi', '1-brunch', 'nawak']));
  assert.equal(res.doc['sched'].filter((s: any) => s.away).length, 0);
  assert.equal('absent' in res.doc['members'][0], false);
});

test('l’école et le travail sont marqués « hors du foyer », le reste non', () => {
  const res = run({
    members: [{ id: 'me' }],
    sched: [
      { id: 'a', who: ['me'], dow: 1, start: '08:30', end: '16:30', label: 'École', k: 'ecole', rec: 'weekly' },
      { id: 'b', who: ['me'], dow: 1, start: '09:00', end: '18:00', label: 'Bureau', k: 'travail', rec: 'weekly' },
      { id: 'c', who: ['me'], dow: 1, start: '19:30', end: '20:30', label: 'Dîner', k: 'repas', rec: 'weekly' },
    ],
  });
  const par = Object.fromEntries(res.doc['sched'].map((s: any) => [s.id, s.away]));
  assert.deepEqual(par, { a: true, b: true, c: false });
  assert.ok(res.outcome.notes.some((n) => /marqué\(s\) « hors du foyer »/.test(n)));
});

test('un réglage « hors du foyer » déjà posé n’est jamais retouché', () => {
  // C'est ce qui rend la migration rejouable : rejouer ne doit pas recocher une
  // case que quelqu'un a décochée (le télétravail, le sport à la maison).
  const res = run({
    members: [{ id: 'me' }],
    sched: [{ id: 'a', who: ['me'], dow: 1, start: '09:00', end: '18:00', label: 'Télétravail', k: 'travail', rec: 'weekly', away: false }],
  });
  assert.equal(res.doc['sched'][0].away, false);
});

test('rejouer la migration des couverts ne change rien', () => {
  const premier = run(avecAbsences(['1-midi', '4-soir'], [
    { id: 'x', who: ['me'], dow: 2, start: '08:30', end: '16:30', label: 'École', k: 'ecole', rec: 'weekly' },
  ]));
  const snapshot = JSON.stringify(premier.doc);
  const second = run(JSON.parse(snapshot));
  assert.equal(JSON.stringify(second.doc), snapshot, 'la seconde passe doit être un no-op');
});

test('les versions de migration sont uniques, ordonnées et cohérentes avec STATE_VERSION', () => {
  const versions = STATE_MIGRATIONS.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
  assert.equal(new Set(versions).size, versions.length);
  assert.equal(Math.max(...versions), STATE_VERSION, 'STATE_VERSION doit suivre la dernière migration');
});

// ---- décodage des data-URL -------------------------------------------------

test('decodeDataUrl lit le base64 et refuse ce qui n’en est pas', () => {
  assert.ok(decodeDataUrl(PNG_DATA_URL)!.length > 0);
  assert.equal(decodeDataUrl('https://exemple.test/photo.png'), null);
  assert.equal(decodeDataUrl(''), null);
  // Une data-URL sans base64 est décodée telle quelle plutôt que rejetée.
  assert.equal(decodeDataUrl('data:text/plain,bonjour')!.toString('latin1'), 'bonjour');
});
