// Surface HTTP de la liste de courses, montée sous /api/shopping.
//
// Tout le routeur est derrière le garde de session, comme le reste de l'API.
import express, { Request, Response, Router } from 'express';
import { applyShoppingOps, getShopping } from './repo';

/** Un lot vient d'une file hors ligne : quelques dizaines d'opérations, jamais plus. */
const MAX_OPS_PER_BATCH = 500;
const MAX_BODY = '256kb';

export function shoppingRouter(): Router {
  const r = express.Router();
  r.use(express.json({ limit: MAX_BODY }));

  /**
   * Instantané de la liste. `since` évite de renvoyer les articles quand rien
   * n'a bougé : l'écran sonde toutes les cinq secondes tant qu'il est visible,
   * autant que la réponse tienne en trois lignes le reste du temps.
   */
  r.get('/', (req: Request, res: Response) => {
    const snap = getShopping();
    const since = parseInt(String(req.query['since'] ?? ''), 10);
    if (Number.isInteger(since) && since === snap.version) {
      res.json({ version: snap.version, unchanged: true });
      return;
    }
    res.json({ version: snap.version, items: snap.items });
  });

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
      const out = applyShoppingOps(ops);
      // Les opérations écartées le sont définitivement : le client les retire de
      // sa file. Le dire dans les journaux, sinon un article qui n'arrive jamais
      // dans la liste reste un mystère côté serveur.
      if (out.skipped.length) {
        // eslint-disable-next-line no-console
        console.warn(
          `[foyer] Courses : ${out.skipped.length} opération(s) écartée(s). ` +
          out.skipped.map((s) => `${s.opId || '(sans id)'} : ${s.reason}`).join(' | '),
        );
      }
      res.json(out);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[foyer] Courses : erreur inattendue en appliquant un lot', e);
      res.status(500).json({ error: 'Erreur sur la liste de courses : ' + (e as Error).message });
    }
  });

  return r;
}
