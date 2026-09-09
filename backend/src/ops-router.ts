// Le routeur d'un sous-arbre écrit par opérations journalisées (courses, tâches).
//
// Les deux surfaces sont identiques à trois chaînes près (l'appliqueur, le
// libellé des journaux, le message d'erreur) et à la taille de corps acceptée.
// Une seule fabrique, pour que la validation du lot, le plafond et le rapport
// des opérations écartées ne divergent pas entre les deux.
import express, { Request, Response, Router } from 'express';
import { log } from './log';

/** Un lot vient d'une file hors ligne : quelques dizaines d'opérations, jamais plus. */
const MAX_OPS_PER_BATCH = 500;

/** Ce que la fabrique lit du résultat d'un appliqueur : de quoi journaliser les écartées. */
interface OpsOutcome { skipped: { opId: string; reason: string }[]; }

export function opsRouter(cfg: {
  /** Applique le lot au document et rend le résultat (renvoyé tel quel au client). */
  apply: (ops: unknown) => OpsOutcome;
  /** Préfixe des journaux : « Courses », « Tâches ». */
  label: string;
  /** Message du 500, complété par le détail de l'erreur. */
  errorMsg: string;
  /** Taille de corps acceptée (les tâches portent des textes plus longs que les courses). */
  maxBody: string;
}): Router {
  const r = express.Router();
  r.use(express.json({ limit: cfg.maxBody }));

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
      const out = cfg.apply(ops);
      // Les opérations écartées le sont définitivement : le client les retire de
      // sa file. Le dire dans les journaux, sinon une opération qui n'arrive
      // jamais reste un mystère côté serveur.
      if (out.skipped.length) {
        log.attention(
          `${cfg.label} : ${out.skipped.length} opération(s) écartée(s). ` +
          out.skipped.map((s) => `${s.opId || '(sans id)'} : ${s.reason}`).join(' | '),
        );
      }
      res.json(out);
    } catch (e) {
      log.erreur(`${cfg.label} : erreur inattendue en appliquant un lot`, e);
      res.status(500).json({ error: cfg.errorMsg + (e as Error).message });
    }
  });

  return r;
}
