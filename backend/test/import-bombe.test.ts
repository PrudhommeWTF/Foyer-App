// Une archive qui pèse peu et se déplie beaucoup.
//
// Le déflatage n'avait aucune borne de sortie : mesuré, un faux .xlsx de
// 305 907 octets amenait le service à 988 Mo de mémoire résidente et bloquait le
// processus 5,7 secondes. Le plafond de téléversement étant de 25 Mo et le taux
// de compression du zéro d'environ mille pour un, un seul fichier pouvait viser
// vingt-cinq gigaoctets : le conteneur est tué par le noyau, et le foyer perd
// son application le temps que quelqu'un s'en aperçoive.
//
// La disponibilité passe après la confidentialité dans ce foyer, mais une
// requête authentifiée qui coupe le service reste une requête de trop.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { describe, it } from 'node:test';
import { readZip } from '../src/finances/import/zip';
import { UnsupportedFile, parseFile } from '../src/finances/import/parse';

/**
 * Une archive ZIP d'une entrée, écrite à la main : `taille` octets de zéro,
 * dégonflés. `annonce` permet de mentir dans le répertoire central, pour vérifier
 * que la borne ne repose pas sur ce que le fichier déclare.
 */
function archive(taille: number, annonce = taille): Buffer {
  const nom = Buffer.from('xl/worksheets/sheet1.xml');
  const brut = Buffer.alloc(taille);
  const co = zlib.deflateRawSync(brut, { level: 9 });
  const crc = zlib.crc32 ? zlib.crc32(brut) : 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(co.length, 18); local.writeUInt32LE(annonce, 22);
  local.writeUInt16LE(nom.length, 26);
  const debut = Buffer.concat([local, nom, co]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(co.length, 20); central.writeUInt32LE(annonce, 24);
  central.writeUInt16LE(nom.length, 28); central.writeUInt32LE(0, 42);
  const cd = Buffer.concat([central, nom]);

  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(1, 8); fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(debut.length, 16);
  return Buffer.concat([debut, cd, fin]);
}

describe('une archive qui se déplie trop est refusée', () => {
  it('cent mégaoctets de zéro dans trois cents kilo-octets : refusé', () => {
    const bombe = archive(100 * 1024 * 1024);
    assert.ok(bombe.length < 200 * 1024, `la bombe pèse ${bombe.length} octets sur le disque`);
    assert.throws(() => readZip(bombe, () => true), /dépasse .* Mo une fois décompress/);
  });

  it('refusé aussi quand l’en-tête ment sur la taille', () => {
    // Le répertoire central annonce un kilo-octet, le contenu en fait cent
    // mégaoctets : c'est zlib qui doit arrêter les frais, pas la déclaration.
    const menteuse = archive(100 * 1024 * 1024, 1024);
    assert.throws(() => readZip(menteuse, () => true), /dépasse .* Mo une fois décompress/);
  });

  it('le refus remonte à l’import comme un fichier illisible, pas comme un plantage', () => {
    assert.throws(
      () => parseFile(archive(100 * 1024 * 1024), 'releve.xlsx'),
      (e: Error) => e instanceof UnsupportedFile && /illisible|dépasse/.test(e.message),
    );
  });

  it('une archive de taille normale passe toujours', () => {
    const normale = archive(64 * 1024);
    const entrees = readZip(normale, () => true);
    assert.equal(entrees.get('xl/worksheets/sheet1.xml')?.length, 64 * 1024);
  });
});
