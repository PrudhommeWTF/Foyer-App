// Surface HTTP des tâches, montée sous /api/tasks.
//
// Tout le routeur est derrière le garde de session, comme le reste de l'API.
// La lecture passe par /api/live, commune aux courses et aux tâches : deux
// sondages pour deux sous-arbres du même document n'auraient aucun sens.
import express, { Request, Response, Router } from 'express';
import { applyTaskOps } from './repo';

/** Un lot vient d'une file hors ligne : quelques dizaines d'opérations, jamais plus. */
const MAX_OPS_PER_BATCH = 500;
const MAX_BODY = '512kb';

export function tasksRouter(): Router {
  const r = express.Router();
  r.use(express.json({ limit: MAX_BODY }));

  r.post('/ops', (req: Request, res: Response) => {
    const ops = req.body?.ops;
    if (!Array.isArray(ops)) {
      res.status(400).json({ error: 'Lot d’opérations attendu dans « ops ».' });
      return;
    }
    if (ops.length > MAX_OPS_PER_BATCH) {
      res.status(413).json({ error: `Lot trop gros : ${ops.length} opérations pour un maximum de ${MAX_OPS_PER_BATCH}. Envoyez-le en plusieurs fois.` });
      return;
    }
    try {
      const out = applyTaskOps(ops);
      // Les opérations écartées le sont définitivement : le client les retire de
      // sa file. Le dire dans les journaux, sinon une tâche qui n'arrive jamais
      // reste un mystère côté serveur.
      if (out.skipped.length) {
        // eslint-disable-next-line no-console
        console.warn(
          `[foyer] Tâches : ${out.skipped.length} opération(s) écartée(s). ` +
          out.skipped.map((s) => `${s.opId || '(sans id)'} : ${s.reason}`).join(' | '),
        );
      }
      res.json(out);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[foyer] Tâches : erreur inattendue en appliquant un lot', e);
      res.status(500).json({ error: 'Erreur sur les tâches : ' + (e as Error).message });
    }
  });

  return r;
}
