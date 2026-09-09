// Surface HTTP de la liste de courses, montée sous /api/shopping.
//
// Tout le routeur est derrière le garde de session, comme le reste de l'API.
// La lecture passe par /api/live, commune aux courses et aux tâches.
import { Router } from 'express';
import { applyShoppingOps } from './repo';
import { opsRouter } from '../ops-router';

export function shoppingRouter(): Router {
  return opsRouter({
    apply: applyShoppingOps,
    label: 'Courses',
    errorMsg: 'Erreur sur la liste de courses : ',
    maxBody: '256kb',
  });
}
