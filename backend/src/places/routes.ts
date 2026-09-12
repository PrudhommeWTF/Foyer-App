// Surface HTTP des lieux, montée sous /api/places.
//
// Tout le routeur est derrière le garde de session, comme le reste de l'API.
// La lecture passe par /api/live, commune aux courses, aux tâches et aux lieux.
import { Router } from 'express';
import { applyPlaceOps } from './repo';
import { opsRouter } from '../ops-router';

export function placesRouter(): Router {
  return opsRouter({
    apply: applyPlaceOps,
    label: 'Lieux',
    errorMsg: 'Erreur sur les lieux : ',
    maxBody: '256kb',
  });
}
