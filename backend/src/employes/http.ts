// Préambule HTTP du module « Employé à domicile », calqué sur finances/http.ts :
// une seule classe `Invalid` pour que toutes les validations d'un même module
// soient rattrapées en 400 par le même enveloppeur, jamais en 500.
import { Request, Response } from 'express';
import { log } from '../log';

/** Rejet avec un message explicite (rendu en 400) plutôt qu'un 400 nu. */
export class Invalid extends Error {}
export const fail = (msg: string): never => { throw new Invalid(msg); };

/** Un identifiant de base : entier strictement positif. */
export const id = (v: unknown, field: string): number => {
  const n = parseInt(String(v ?? ''), 10);
  if (!Number.isInteger(n) || n <= 0) fail(`Identifiant invalide pour « ${field} ».`);
  return n;
};

/**
 * Enveloppe un handler : une `Invalid` devient un 400 avec son message, tout le
 * reste un 500 étiqueté.
 */
export function makeHandler(logLabel: string, clientPrefix: string) {
  return (fn: (req: Request, res: Response) => void) =>
    (req: Request, res: Response): void => {
      try { fn(req, res); }
      catch (e) {
        if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
        log.erreur(logLabel, e);
        res.status(500).json({ error: clientPrefix + (e as Error).message });
      }
    };
}
