// Surface HTTP des tâches, montée sous /api/tasks.
//
// Tout le routeur est derrière le garde de session, comme le reste de l'API.
// La lecture passe par /api/live, commune aux courses et aux tâches : deux
// sondages pour deux sous-arbres du même document n'auraient aucun sens.
import { Router } from 'express';
import { applyTaskOps } from './repo';
import { opsRouter } from '../ops-router';

export function tasksRouter(): Router {
  return opsRouter({
    apply: applyTaskOps,
    label: 'Tâches',
    errorMsg: 'Erreur sur les tâches : ',
    maxBody: '512kb',
  });
}
