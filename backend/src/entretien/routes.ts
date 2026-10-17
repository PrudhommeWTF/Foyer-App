// Surface HTTP du module Entretien, montée sous /api/entretien, derrière la
// session et le drapeau du module (403 quand il est éteint).
//
// Les gestes eux-mêmes ne passent pas par ici : ce sont des tâches, écrites
// par les opérations de /api/tasks. Ce routeur sert ce qui n'est pas une
// tâche : le catalogue des gestes proposés à la création, et le passage d'un
// consommable à la liste de courses (bouton « Ajouter aux courses »).
import express, { Request, Router } from 'express';
import { catalogue } from './catalogue';
import { gesteToShopping } from './courses';

export function entretienRouter(dataDir: string, memberId: (req: Request) => string | null): Router {
  const r = Router();
  r.get('/catalogue', (_req, res) => { res.json(catalogue(dataDir)); });
  r.post('/gestes/:id/courses', express.json({ limit: '1kb' }), (req, res) => {
    const out = gesteToShopping(String(req.params['id']).slice(0, 80), { by: memberId(req) });
    if (out.kind === 'refus') { res.status(400).json({ error: out.error }); return; }
    res.json(out);
  });
  return r;
}
