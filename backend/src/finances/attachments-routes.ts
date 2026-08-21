// HTTP surface of the attachments, mounted under /api/finances.
//
// The whole router sits behind the session guard: a piece is never reachable by
// its URL alone, contrary to the ICS feed which trades on a secret token.
import { contentDisposition } from '../headers';
import express, { Request, Response, Router } from 'express';
import * as attachments from './attachments';
import { getAsset, getContract } from './contracts';
import { getTransaction } from './repo';

/** 20 Mo : a scanned invoice weighs a few hundred kilobytes, a phone photo a few megabytes. */
const MAX_UPLOAD = '20mb';

class Invalid extends Error {}
const fail = (msg: string): never => { throw new Invalid(msg); };

function handler(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    try { fn(req, res); }
    catch (e) {
      if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
      // eslint-disable-next-line no-console
      console.error('[foyer] Finances/pièces jointes : erreur inattendue', e);
      res.status(500).json({ error: 'Erreur sur les pièces jointes : ' + (e as Error).message });
    }
  };
}

const id = (v: unknown, field: string): number => {
  const n = parseInt(String(v ?? ''), 10);
  if (!Number.isInteger(n) || n <= 0) fail(`Identifiant invalide pour « ${field} ».`);
  return n;
};

/** Owner of a piece, checked for existence: no attaching to a ghost. */
function owner(req: Request): { kind: attachments.OwnerKind; id: number } {
  const kind = String(req.query['owner'] ?? '') as attachments.OwnerKind;
  if (!attachments.OWNER_KINDS.includes(kind)) fail('Type de rattachement inconnu : attendu contract, asset ou transaction.');
  const ownerId = id(req.query['id'], 'rattachement');
  const exists = kind === 'contract' ? getContract(ownerId)
    : kind === 'asset' ? getAsset(ownerId)
    : getTransaction(ownerId);
  if (!exists) fail('L’élément auquel rattacher cette pièce est introuvable.');
  return { kind, id: ownerId };
}

export function attachmentsRouter(): Router {
  const r = express.Router();

  r.get('/attachments', handler((req, res) => {
    const o = owner(req);
    res.json({ attachments: attachments.listFor(o.kind, o.id) });
  }));

  r.post('/attachments', express.raw({ type: '*/*', limit: MAX_UPLOAD }), handler((req, res) => {
    const o = owner(req);
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) {
      res.status(400).json({ error: 'Aucun fichier reçu. Envoyez le contenu brut du fichier dans le corps de la requête.' });
      return;
    }
    const type = attachments.detectType(buf);
    if (!type) {
      res.status(415).json({
        error: `Ce format n’est pas pris en charge. Formats acceptés : ${attachments.ACCEPTED_LABEL}. `
          + 'Le type est reconnu d’après le contenu du fichier, pas d’après son extension.',
      });
      return;
    }
    const name = String(req.query['filename'] || 'piece').slice(0, 200);
    const { attachment, deduplicated } = attachments.store(o.kind, o.id, name, buf, type);
    res.status(201).json({ attachment, deduplicated, attachments: attachments.listFor(o.kind, o.id) });
  }));

  r.get('/attachments/:id', handler((req, res) => {
    const attachmentId = id(req.params['id'], 'pièce jointe');
    const meta = attachments.get(attachmentId);
    if (!meta) { res.status(404).json({ error: 'Pièce jointe introuvable.' }); return; }
    const file = attachments.fileOf(attachmentId);
    if (!file) {
      res.status(410).json({
        error: 'Le fichier de cette pièce jointe est absent du disque. '
          + 'Restaurez le répertoire « pieces » de vos sauvegardes, ou supprimez cette pièce.',
      });
      return;
    }
    res.setHeader('Content-Type', meta.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const disposition = String(req.query['download'] || '') === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', contentDisposition(disposition, meta.name, 'piece'));
    // sendFile streams: a 20 Mo piece never becomes a 20 Mo buffer in this process.
    res.sendFile(file);
  }));

  r.delete('/attachments/:id', handler((req, res) => {
    const attachmentId = id(req.params['id'], 'pièce jointe');
    const meta = attachments.get(attachmentId);
    if (!meta) { res.status(404).json({ error: 'Pièce jointe introuvable.' }); return; }
    attachments.remove(attachmentId);
    res.json({ attachments: attachments.listFor(meta.ownerKind, meta.ownerId) });
  }));

  /** What the table and the disk disagree on. Read-only: nothing is deleted. */
  r.get('/attachments-check', handler((_req, res) => {
    // Le balayage couvre désormais toutes les tables qui référencent des octets,
    // pas seulement les pièces Finances : c'est le disque qui est inspecté.
    const report = attachments.sweepOrphans();
    res.json({
      danglingRows: report.danglingPaths,
      orphanFiles: report.orphanFiles.length,
      ok: !report.danglingPaths.length && !report.orphanFiles.length,
    });
  }));

  return r;
}