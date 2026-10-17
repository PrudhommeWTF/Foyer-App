// Surface HTTP du module Entretien, montée sous /api/entretien, derrière la
// session et le drapeau du module (403 quand il est éteint).
//
// Les gestes eux-mêmes ne passent pas par ici : ce sont des tâches, écrites
// par les opérations de /api/tasks. Ce routeur ne sert que ce qui n'est pas
// une tâche : le catalogue des gestes proposés à la création.
import { Router } from 'express';
import { catalogue } from './catalogue';

export function entretienRouter(dataDir: string): Router {
  const r = Router();
  r.get('/catalogue', (_req, res) => { res.json(catalogue(dataDir)); });
  return r;
}
