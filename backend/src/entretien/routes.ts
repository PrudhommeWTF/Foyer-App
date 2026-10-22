// Surface HTTP du module Entretien, montée sous /api/entretien, derrière la
// session et le drapeau du module (403 quand il est éteint).
//
// Les gestes eux-mêmes ne passent pas par ici : ce sont des tâches, écrites
// par les opérations de /api/tasks. Ce routeur sert ce qui n'est pas une
// tâche : le catalogue des gestes proposés à la création, le passage d'un
// consommable à la liste de courses (bouton « Ajouter aux courses »), la note
// et les justificatifs d'une réalisation, et le carnet d'entretien.
//
// Un enfant lit et écrit les notes ; il ne voit ni les justificatifs (une
// attestation porte un prix et une adresse) ni le carnet (les montants).
import express, { NextFunction, Request, Response, Router } from 'express';
import { catalogue } from './catalogue';
import { gesteToShopping } from './courses';
import { NOTE_MAX, attach, extrasByGeste, hasExtras, proof, setNote } from './realisations';
import { PERIODS, Period, buildCarnet, carnetPdf, carnetZip } from './carnet';
import { ENTRETIEN_LIST_ID } from './list';
import { getTasks } from '../tasks/repo';
import { parisDay } from '../tasks/ops';
import { AuthedRequest, currentMember } from '../auth/session';
import { checkUpload } from '../storage/upload-check';
import * as files from '../storage/files';
import { contentDisposition } from '../headers';
import { getHousehold } from '../db';
import { log } from '../log';

/** Plafond d'un justificatif : une attestation scannée pèse quelques mégaoctets, une photo réduite moins d'un. */
const MAX_UPLOAD = '20mb';

const isChild = (req: Request): boolean => !!currentMember(req as AuthedRequest)?.enfant;
const who = (req: Request): string => currentMember(req as AuthedRequest)?.name || 'inconnu';
const adulte = (req: Request, res: Response, next: NextFunction): void => {
  if (isChild(req)) { res.status(403).json({ error: 'Les justificatifs et le carnet d’entretien sont réservés aux adultes.' }); return; }
  next();
};
const geste = (id: string) => getTasks().items.find((t) => t.id === id && t.listId === ENTRETIEN_LIST_ID && !t.parentId);

export function entretienRouter(dataDir: string, memberId: (req: Request) => string | null): Router {
  const r = Router();
  r.get('/catalogue', (_req, res) => { res.json(catalogue(dataDir)); });
  r.post('/gestes/:id/courses', express.json({ limit: '1kb' }), (req, res) => {
    const out = gesteToShopping(String(req.params['id']).slice(0, 80), { by: memberId(req) });
    if (out.kind === 'refus') { res.status(400).json({ error: out.error }); return; }
    res.json(out);
  });

  // ---- notes et justificatifs des réalisations ----
  // Le geste, puis sa réalisation : un instant de son historique. Une réalisation
  // annulée qui porte déjà une note ou un justificatif se modifie encore (on
  // retire sa note, ses fichiers), mais on n'en ajoute pas à une réalisation inconnue.
  const realisation = (req: Request, res: Response, adding: boolean): { taskId: string; doneAt: string; text: string } | null => {
    const taskId = String(req.params['id']).slice(0, 80), doneAt = String(req.params['at']).slice(0, 40);
    const t = geste(taskId);
    if (!t) { res.status(404).json({ error: 'Geste inconnu.' }); return null; }
    if (!(t.history || []).some((h) => h.at === doneAt) && (adding || !hasExtras(taskId, doneAt))) {
      res.status(404).json({ error: 'Cette réalisation n’est pas dans l’historique du geste.' }); return null;
    }
    return { taskId, doneAt, text: t.text };
  };

  r.get('/gestes/:id/realisations', (req, res) => {
    const id = String(req.params['id']).slice(0, 80);
    if (!geste(id)) { res.status(404).json({ error: 'Geste inconnu.' }); return; }
    const child = isChild(req);
    // Un enfant ne voit que les notes : une réalisation qui n'a que des justificatifs ne lui dit rien.
    res.json({ realisations: (extrasByGeste(id, !child).get(id) || []).filter((e) => !child || e.note) });
  });

  r.put('/gestes/:id/realisations/:at/note', express.json({ limit: '8kb' }), (req, res) => {
    const note = String((req.body as { note?: unknown })?.note ?? '').trim();
    if (note.length > NOTE_MAX) { res.status(400).json({ error: `La note dépasse ${NOTE_MAX} caractères.` }); return; }
    const x = realisation(req, res, false); if (!x) return;
    setNote(x.taskId, x.doneAt, note, memberId(req));
    res.json({ realisations: extrasByGeste(x.taskId, !isChild(req)).get(x.taskId) || [] });
  });

  r.post('/gestes/:id/realisations/:at/justificatifs', adulte, express.raw({ type: '*/*', limit: MAX_UPLOAD }), (req, res) => {
    const x = realisation(req, res, true); if (!x) return;
    const check = checkUpload(req.body, true);
    if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }
    const name = String(req.query['filename'] || 'justificatif').replace(/[\r\n]+/g, ' ').trim().slice(0, 200) || 'justificatif';
    const file = attach(x.taskId, x.doneAt, name, req.body as Buffer, check.type);
    log.info(`Entretien : justificatif « ${name} » joint à « ${x.text} » (${parisDay(x.doneAt)}) par ${who(req)}.`);
    res.status(201).json({ file, realisations: extrasByGeste(x.taskId).get(x.taskId) || [] });
  });

  r.get('/justificatifs/:fid', adulte, (req, res) => {
    const p = proof(Number(req.params['fid']));
    if (!p || !geste(p.taskId)) { res.status(404).json({ error: 'Justificatif introuvable.' }); return; }
    const f = files.fileOf(Number(req.params['fid']));
    if (!f) { res.status(410).json({ error: 'Le fichier est absent du disque. Restaurez le répertoire « pieces » de vos sauvegardes, ou joignez-le à nouveau.' }); return; }
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', contentDisposition(req.query['download'] === '1' ? 'attachment' : 'inline', f.name, 'justificatif'));
    res.sendFile(f.path);
  });

  r.delete('/justificatifs/:fid', adulte, (req, res) => {
    const fid = Number(req.params['fid']);
    const p = proof(fid);
    if (!p || !geste(p.taskId)) { res.status(404).json({ error: 'Justificatif introuvable.' }); return; }
    files.remove(fid);
    log.info(`Entretien : justificatif « ${p.name} » retiré par ${who(req)}.`);
    res.json({ realisations: extrasByGeste(p.taskId).get(p.taskId) || [] });
  });

  // ---- le carnet d'entretien (adultes) ----
  r.get('/carnet.:format', adulte, (req, res) => {
    const format = String(req.params['format']);
    const period = String(req.query['periode'] || '12') as Period;
    if (format !== 'pdf' && format !== 'zip') { res.status(404).json({ error: 'Format inconnu : pdf ou zip.' }); return; }
    if (!PERIODS.includes(period)) { res.status(400).json({ error: `Période inconnue : ${PERIODS.join(', ')}.` }); return; }
    const today = parisDay(new Date().toISOString());
    const c = buildCarnet(getTasks().items, getHousehold().state as Parameters<typeof buildCarnet>[1], period, today);
    log.info(`Entretien : carnet d’entretien (${format}, ${period === 'tout' ? 'tout' : period + ' mois'}) par ${who(req)}.`);
    res.setHeader('Content-Disposition', contentDisposition('attachment', `carnet-entretien-${today}.${format}`, 'carnet'));
    res.setHeader('Cache-Control', 'private, no-store');
    if (format === 'pdf') { res.type('application/pdf').send(carnetPdf(c)); return; }
    // Le zip part au fil de l'eau : un justificatif à la fois en mémoire.
    res.type('application/zip');
    carnetZip(res, c);
    res.end();
  });
  return r;
}
