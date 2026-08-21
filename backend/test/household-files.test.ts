// Le magasin d'octets est désormais partagé entre le module Finances et le
// document du foyer. Ce qui compte ici, c'est la frontière : deux tables, un
// seul disque, et un fichier qui ne doit jamais partir tant qu'une des deux le
// réclame encore.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { detectType, initBlobs, sweepOrphans } from '../src/storage/blobs';
import { migrateHousehold } from '../src/storage/schema';
import * as files from '../src/storage/files';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import * as attachments from '../src/finances/attachments';
import * as contracts from '../src/finances/contracts';

let db: Database.Database;
let dir: string;

/** En-têtes minimaux mais authentiques : le détecteur lit les octets. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

const put = (ownerId: string, name: string, buf: Buffer) =>
  files.store('recipe', ownerId, name, buf, detectType(buf)!);

const onDisk = (): string[] => {
  const root = path.join(dir, 'pieces');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  return fs.existsSync(root) ? walk(root) : [];
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-hh-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initBlobs(dir);
  migrateHousehold(db);
  files.initFiles(db);
  migrateFinances(db);
  repo.initFinancesRepo(db);
});

describe('photos de recettes', () => {
  it('range les octets sur le disque et n’en garde que la fiche en base', () => {
    const { file } = put('r1', 'gratin.png', PNG);
    assert.equal(file.mime, 'image/png');
    assert.equal(file.ownerId, 'r1');
    assert.equal(file.size, PNG.length);
    assert.equal(onDisk().length, 1);
    // Le nom de l'utilisateur n'atteint jamais le système de fichiers.
    assert.equal(onDisk()[0].includes('gratin'), false);
  });

  it('la même photo posée deux fois ne coûte qu’un fichier', () => {
    put('r1', 'a.png', PNG);
    put('r2', 'b.png', PNG);
    assert.equal(onDisk().length, 1, 'octets identiques, un seul fichier');
    assert.equal(files.listFor('recipe', 'r1').length, 1);
    assert.equal(files.listFor('recipe', 'r2').length, 1);
  });

  it('retirer une des deux fiches laisse le fichier en place pour l’autre', () => {
    const a = put('r1', 'a.png', PNG).file;
    const b = put('r2', 'b.png', PNG).file;
    files.remove(a.id);
    assert.equal(onDisk().length, 1, 'l’autre recette s’en sert encore');
    assert.ok(files.fileOf(b.id));
    files.remove(b.id);
    assert.equal(onDisk().length, 0, 'plus personne : les octets sont rendus');
  });

  it('un identifiant inconnu ou un fichier disparu se distinguent l’un de l’autre', () => {
    const { file } = put('r1', 'a.png', PNG);
    assert.equal(files.get(999), null);
    fs.rmSync(onDisk()[0]);
    assert.ok(files.get(file.id), 'la fiche reste : une restauration peut la sauver');
    assert.equal(files.fileOf(file.id), null, 'mais rien à servir pour l’instant');
  });
});

describe('frontière entre les deux tables', () => {
  it('un fichier réclamé par les deux tables ne part pas quand l’une le lâche', () => {
    // Le cas que le registre de détenteurs existe pour couvrir : sans lui,
    // supprimer la photo de la recette effacerait la pièce du contrat.
    const c = contracts.createContract({
      name: 'Assurance', provider: 'AXA', kind: 'assurance', assetId: null, accountId: null, categoryId: null,
      memberIds: [], amountMin: null, amountMax: null, periodicity: 'mensuelle',
      renewalOn: null, noticeDays: 0, endsOn: null, status: 'actif', notes: '', refs: [],
    });
    const piece = attachments.store('contract', c.id, 'photo.jpg', JPEG, detectType(JPEG)!);
    const photo = put('r1', 'photo.jpg', JPEG).file;
    assert.equal(onDisk().length, 1);

    files.remove(photo.id);
    assert.equal(onDisk().length, 1, 'le contrat réclame encore ces octets');
    assert.ok(attachments.fileOf(piece.attachment.id));

    attachments.remove(piece.attachment.id);
    assert.equal(onDisk().length, 0);
  });

  it('le balayage voit les deux tables et nomme le détenteur', () => {
    const c = contracts.createContract({
      name: 'Assurance', provider: 'AXA', kind: 'assurance', assetId: null, accountId: null, categoryId: null,
      memberIds: [], amountMin: null, amountMax: null, periodicity: 'mensuelle',
      renewalOn: null, noticeDays: 0, endsOn: null, status: 'actif', notes: '', refs: [],
    });
    attachments.store('contract', c.id, 'facture.pdf', PDF, detectType(PDF)!);
    put('r1', 'gratin.png', PNG);
    assert.deepEqual(sweepOrphans(), { danglingPaths: [], orphanFiles: [] });

    for (const f of onDisk()) fs.rmSync(f);
    const report = sweepOrphans();
    assert.equal(report.danglingPaths.length, 2);
    assert.deepEqual(
      report.danglingPaths.map((d) => d.holder).sort(),
      ['Finances/pièces jointes', 'Foyer/fichiers'],
    );
    // Le nom est ce qui rend le message de démarrage actionnable : un chemin en
    // SHA-256 ne dit rien à personne.
    assert.deepEqual(report.danglingPaths.map((d) => d.name).sort(), ['facture.pdf', 'gratin.png']);
  });

  it('un fichier que plus aucune table ne réclame est signalé, jamais supprimé', () => {
    const orphan = path.join(dir, 'pieces', 'ab');
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'ab'.repeat(32) + '.png'), PNG);
    assert.equal(sweepOrphans().orphanFiles.length, 1);
    assert.equal(onDisk().length, 1, 'rien n’est effacé dans le dos de l’administrateur');
  });
});

describe('ménage des photos sans propriétaire', () => {
  it('retire ce que le document ne cite plus, et rien d’autre', () => {
    const gardee = put('r1', 'gardee.png', PNG).file;
    const remplacee = put('r1', 'remplacee.jpg', JPEG).file;
    assert.equal(files.pruneUnreferenced(new Set([gardee.id])), 1);
    assert.ok(files.get(gardee.id));
    assert.equal(files.get(remplacee.id), null);
    assert.equal(onDisk().length, 1);
  });

  it('ne retire rien quand tout est cité', () => {
    const a = put('r1', 'a.png', PNG).file;
    const b = put('r2', 'b.jpg', JPEG).file;
    assert.equal(files.pruneUnreferenced(new Set([a.id, b.id])), 0);
    assert.equal(onDisk().length, 2);
  });

  it('retire les photos d’un propriétaire disparu, en gardant celles qu’on désigne', () => {
    const a = put('r1', 'a.png', PNG).file;
    const b = put('r1', 'b.jpg', JPEG).file;
    assert.equal(files.removeAllFor('recipe', 'r1', [b.id]), 1);
    assert.equal(files.get(a.id), null);
    assert.ok(files.get(b.id));
  });
});

describe('détection de type', () => {
  it('reconnaît le contenu et pas l’extension', () => {
    assert.equal(detectType(PNG)!.mime, 'image/png');
    assert.equal(detectType(JPEG)!.mime, 'image/jpeg');
    assert.equal(detectType(PDF)!.mime, 'application/pdf');
    assert.equal(detectType(Buffer.from('<html>pas une image du tout</html>')), null);
    assert.equal(detectType(Buffer.alloc(3)), null);
  });
});
