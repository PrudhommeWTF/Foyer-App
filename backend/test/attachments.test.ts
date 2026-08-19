// Pièces jointes : les octets sur le disque, les métadonnées en base.
//
// Deux sources de vérité qui peuvent diverger : ces tests portent autant sur le
// rangement que sur ce qui se passe quand la divergence arrive.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { migrateFinances } from '../src/finances/schema';
import * as repo from '../src/finances/repo';
import * as attachments from '../src/finances/attachments';
import * as contracts from '../src/finances/contracts';

let db: Database.Database;
let dir: string;
let compte: number;

/** Minimal but genuine headers: the detector reads bytes, not extensions. */
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64, 3)]);
const HEIC = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(64, 4)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 5)]);

function reset(): void {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foyer-pj-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateFinances(db);
  repo.initFinancesRepo(db, dir);
  compte = repo.createAccount({ name: 'Compte', kind: 'courant', memberIds: [], openingBalance: 0, openingDate: null, archived: false }).id;
}

const contract = (name = 'Assurance'): contracts.Contract => contracts.createContract({
  name, provider: 'AXA', kind: 'assurance', assetId: null, accountId: null, categoryId: null,
  memberIds: [], amountMin: null, amountMax: null, periodicity: 'mensuelle',
  renewalOn: null, noticeDays: 0, endsOn: null, status: 'actif', notes: '', refs: [],
});

/** Store a buffer, refusing to guess: the type must be detected first. */
function put(ownerKind: attachments.OwnerKind, ownerId: number, name: string, buf: Buffer): attachments.StoreResult {
  const type = attachments.detectType(buf)!;
  assert.ok(type, `type non reconnu pour ${name}`);
  return attachments.store(ownerKind, ownerId, name, buf, type);
}

const filesOnDisk = (): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name)); else out.push(e.name);
    }
  };
  walk(path.join(dir, 'pieces'));
  return out;
};

beforeEach(reset);

describe('reconnaissance du type', () => {
  it('lit les octets d’en-tête, jamais l’extension', () => {
    assert.deepEqual(attachments.detectType(PDF), { mime: 'application/pdf', ext: '.pdf' });
    assert.deepEqual(attachments.detectType(PNG), { mime: 'image/png', ext: '.png' });
    assert.deepEqual(attachments.detectType(JPEG), { mime: 'image/jpeg', ext: '.jpg' });
    assert.deepEqual(attachments.detectType(WEBP), { mime: 'image/webp', ext: '.webp' });
    assert.deepEqual(attachments.detectType(HEIC), { mime: 'image/heic', ext: '.heic' });
  });

  it('refuse ce qu’il ne reconnaît pas, plutôt que de le ranger quand même', () => {
    assert.equal(attachments.detectType(ZIP), null);
    assert.equal(attachments.detectType(Buffer.from('facture;12,30')), null);
    assert.equal(attachments.detectType(Buffer.alloc(3)), null, 'trop court pour affirmer quoi que ce soit');
  });
});

describe('rangement sur disque', () => {
  it('écrit le fichier sous son empreinte, jamais sous le nom fourni', () => {
    const c = contract();
    const { attachment } = put('contract', c.id, '../../etc/passwd', PDF);

    assert.equal(attachment.name, '../../etc/passwd', 'le nom d’origine reste lisible dans l’interface');
    const files = filesOnDisk();
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9a-f]{64}\.pdf$/, 'le disque ne porte que l’empreinte');
    assert.ok(fs.existsSync(attachments.fileOf(attachment.id)!));
  });

  it('ne stocke qu’une fois deux pièces identiques, et ne casse pas l’une en supprimant l’autre', () => {
    const c1 = contract('Un');
    const c2 = contract('Deux');
    const a = put('contract', c1.id, 'facture.pdf', PDF);
    const b = put('contract', c2.id, 'la-meme.pdf', PDF);

    assert.equal(b.deduplicated, true);
    assert.equal(filesOnDisk().length, 1, 'un seul fichier pour deux fiches');

    attachments.remove(a.attachment.id);
    assert.equal(filesOnDisk().length, 1, 'l’autre fiche pointe encore dessus');
    assert.ok(attachments.fileOf(b.attachment.id));

    attachments.remove(b.attachment.id);
    assert.equal(filesOnDisk().length, 0, 'plus personne : la place est rendue tout de suite');
  });

  it('liste les pièces d’un propriétaire, et compte celles de tous', () => {
    const c1 = contract('Un');
    const c2 = contract('Deux');
    put('contract', c1.id, 'a.pdf', PDF);
    put('contract', c1.id, 'b.png', PNG);
    put('contract', c2.id, 'c.jpg', JPEG);

    assert.deepEqual(attachments.listFor('contract', c1.id).map((a) => a.name), ['a.pdf', 'b.png']);
    assert.equal(attachments.countsFor('contract').get(c1.id), 2);
    assert.equal(attachments.countsFor('contract').get(c2.id), 1);
  });

  it('ne laisse pas de fichier à demi écrit sous son nom définitif', () => {
    const c = contract();
    put('contract', c.id, 'facture.pdf', PDF);
    assert.ok(filesOnDisk().every((f) => !f.endsWith('.part')));
  });
});

describe('suppression du propriétaire', () => {
  it('emporte les pièces d’un contrat supprimé', () => {
    const c = contract();
    put('contract', c.id, 'facture.pdf', PDF);
    put('contract', c.id, 'avenant.png', PNG);
    assert.equal(contracts.countAttachmentsForContract(c.id), 2);

    assert.equal(contracts.deleteContract(c.id), 2);
    assert.equal(attachments.listFor('contract', c.id).length, 0);
    assert.equal(filesOnDisk().length, 0);
  });

  it('emporte les pièces d’une opération supprimée', () => {
    const t = repo.createTransaction({
      accountId: compte, date: '2026-08-05', amount: -8169, kind: 'depense',
      label: 'Prlv Sepa Axa', categoryId: null, notes: '', cleared: false,
    }).id;
    put('transaction', t, 'ticket.jpg', JPEG);

    repo.deleteTransaction(t);
    assert.equal(attachments.listFor('transaction', t).length, 0);
    assert.equal(filesOnDisk().length, 0);
  });
});

describe('divergence entre la base et le disque', () => {
  it('signale une fiche dont le fichier a disparu, sans rien supprimer', () => {
    const c = contract();
    const { attachment } = put('contract', c.id, 'facture.pdf', PDF);
    fs.unlinkSync(path.join(dir, 'pieces', attachment.sha256.slice(0, 2), attachment.sha256 + '.pdf'));

    const report = attachments.sweepOrphans();
    assert.equal(report.danglingRows.length, 1);
    assert.equal(report.danglingRows[0].name, 'facture.pdf');
    assert.equal(attachments.get(attachment.id)!.name, 'facture.pdf', 'la fiche est conservée : une restauration peut la sauver');
    assert.equal(attachments.fileOf(attachment.id), null, 'mais le téléchargement sait qu’il n’a rien à servir');
  });

  it('signale un fichier que plus aucune fiche ne réclame, sans le supprimer', () => {
    const orphan = path.join(dir, 'pieces', 'ab');
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, 'ab'.repeat(32) + '.pdf'), PDF);

    const report = attachments.sweepOrphans();
    assert.equal(report.orphanFiles.length, 1);
    assert.equal(filesOnDisk().length, 1, 'rien n’est effacé dans le dos de l’administrateur');
  });

  it('ne compte pas un envoi en cours comme un orphelin', () => {
    fs.mkdirSync(path.join(dir, 'pieces', 'cd'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pieces', 'cd', 'x.pdf.part'), PDF);
    assert.deepEqual(attachments.sweepOrphans().orphanFiles, []);
  });

  it('ne trouve rien à signaler quand tout va bien', () => {
    const c = contract();
    put('contract', c.id, 'facture.pdf', PDF);
    const report = attachments.sweepOrphans();
    assert.deepEqual(report.danglingRows, []);
    assert.deepEqual(report.orphanFiles, []);
  });
});
