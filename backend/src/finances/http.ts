// Le préambule HTTP partagé des routeurs du module Finances.
//
// Chaque routeur (comptes, contrats, énergie, règles, pièces jointes) rejetait
// une saisie invalide de la même façon, mais avec sa **propre** classe `Invalid`.
// Une erreur de validation levée dans un fichier et rattrapée par le `handler`
// d'un autre n'était alors plus reconnue, et tombait en 500 au lieu de 400. Une
// seule classe `Invalid` ici règle ça, et évite au passage cinq copies.
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
 * reste un 500 étiqueté. Le libellé de journal et le préfixe du message client
 * varient d'un routeur à l'autre, d'où la fabrique.
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
