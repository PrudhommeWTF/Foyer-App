// L'état du service et les sauvegardes déclenchées depuis l'application.
//
// Deux choses comptent ici, et une seule est du confort :
//
//   - un instantané pris à chaud doit être une base **lisible**. La base est en
//     WAL : une copie de fichier donnerait une archive corrompue, silencieusement.
//   - un nom de sauvegarde vient d'une requête HTTP. Sans contrôle,
//     « ../../etc/passwd » serait un nom acceptable.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { BackupRefused, makeSnapshot, removeSnapshot, snapshotPath } from '../src/system/backup';
import { buildStatus, dbBytes, dirBytes, listSnapshots, safeSnapshotName, snapshotName } from '../src/system/status';

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-sys-'));
  db = new Database(path.join(dir, 'foyer.db'));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE essai (id INTEGER PRIMARY KEY, valeur TEXT)');
  db.prepare('INSERT INTO essai (valeur) VALUES (?)').run('avant sauvegarde');
});

afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('sauvegarde de la base', () => {
  it('l’instantané est une base lisible, avec les données du moment', () => {
    const { snapshot } = makeSnapshot(db, dir, 7);
    const copie = new Database(path.join(dir, 'sauvegardes', snapshot.name), { readonly: true });
    assert.equal((copie.prepare('SELECT valeur FROM essai').get() as { valeur: string }).valeur, 'avant sauvegarde');
    copie.close();
  });

  it('elle ne fige pas la base : le service continue d’écrire après', () => {
    makeSnapshot(db, dir, 7);
    db.prepare('INSERT INTO essai (valeur) VALUES (?)').run('après');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM essai').get() as { n: number }).n, 2);
  });

  it('une seconde sauvegarde dans la même minute le dit plutôt que d’écraser', () => {
    const now = new Date('2026-09-04T10:00:00');
    makeSnapshot(db, dir, 7, now);
    assert.throws(() => makeSnapshot(db, dir, 7, now), BackupRefused);
  });

  it('les plus anciennes sont élaguées, la nouvelle jamais', () => {
    for (let i = 0; i < 5; i++) makeSnapshot(db, dir, 3, new Date(2026, 8, 4, 10, i));
    const restantes = listSnapshots(dir).map((s) => s.name);
    assert.equal(restantes.length, 3, 'trois gardées, comme demandé');
    assert.ok(restantes.includes(snapshotName(new Date(2026, 8, 4, 10, 4))), 'la plus récente est là');
    assert.ok(!restantes.includes(snapshotName(new Date(2026, 8, 4, 10, 0))), 'la plus ancienne est partie');
  });

  it('l’élagage garde toujours au moins la sauvegarde qu’on vient de faire', () => {
    makeSnapshot(db, dir, 1, new Date(2026, 8, 4, 10, 0));
    const { snapshot } = makeSnapshot(db, dir, 1, new Date(2026, 8, 4, 10, 1));
    assert.deepEqual(listSnapshots(dir).map((s) => s.name), [snapshot.name]);
  });
});

describe('le nom d’une sauvegarde vient d’une requête HTTP', () => {
  it('n’accepte que la forme que ce service écrit', () => {
    assert.equal(safeSnapshotName('foyer-2026-09-04-1030.db'), true);
    assert.equal(safeSnapshotName('../../etc/passwd'), false);
    assert.equal(safeSnapshotName('foyer.db'), false);
    assert.equal(safeSnapshotName('foyer-2026-09-04-1030.db.bak'), false);
    assert.equal(safeSnapshotName(''), false);
  });

  it('un chemin hors du dossier n’est jamais servi ni effacé', () => {
    fs.writeFileSync(path.join(dir, 'secret'), 'x');
    assert.equal(snapshotPath(dir, '../secret'), null);
    assert.equal(removeSnapshot(dir, '../secret'), false);
    assert.equal(fs.existsSync(path.join(dir, 'secret')), true, 'le fichier visé est toujours là');
  });
});

describe('état du service', () => {
  it('rend ce qu’un exploitant regarde en premier', () => {
    makeSnapshot(db, dir, 7);
    const st = buildStatus({
      version: '1.4.0', dataDir: dir, dbPath: path.join(dir, 'foyer.db'),
      pushSubject: 'https://foyer.exemple.fr',
      counts: { members: 4, events: 12, tasks: 30, recipes: 8, files: 3 },
    });
    assert.equal(st.version, '1.4.0');
    assert.equal(st.dataDir, dir);
    assert.ok(st.dbBytes > 0, 'la base pèse quelque chose');
    assert.ok(st.dataBytes >= st.dbBytes, 'le dossier pèse au moins la base');
    assert.equal(st.snapshots.length, 1);
    assert.deepEqual(st.counts, { members: 4, events: 12, tasks: 30, recipes: 8, files: 3 });
    assert.ok(st.uptime >= 0);
    assert.equal(st.pushSubject, 'https://foyer.exemple.fr', 'c’est lui qu’Apple refuse quand un envoi rend 403');
  });

  it('un dossier absent pèse zéro plutôt que de faire échouer la page', () => {
    assert.equal(dirBytes(path.join(dir, 'nexiste-pas')), 0);
  });
});

describe('le poids de la base en mode WAL', () => {
  it('compte le journal, sinon une base pleine paraît vide', () => {
    // En WAL, tout ce qui vient d'être écrit attend dans foyer.db-wal : le
    // fichier principal peut ne peser que quelques kilo-octets.
    const principal = fs.statSync(path.join(dir, 'foyer.db')).size;
    const wal = path.join(dir, 'foyer.db-wal');
    assert.ok(fs.existsSync(wal), 'le journal existe bien en mode WAL');
    assert.ok(dbBytes(path.join(dir, 'foyer.db')) > principal, 'le total dépasse le seul fichier principal');
  });

  it('une base absente pèse zéro plutôt que de faire échouer la page', () => {
    assert.equal(dbBytes(path.join(dir, 'nexiste-pas.db')), 0);
  });
});
