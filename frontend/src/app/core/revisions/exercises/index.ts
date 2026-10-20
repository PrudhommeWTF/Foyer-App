// Le registre des exercices du module Révisions. Ajouter un exercice : un
// fichier dans ce dossier qui respecte le contrat (contract.ts), et une ligne
// ici. Voir docs/revisions.md.
import { ExerciseDef } from './contract';
import { TABLES } from './tables';
import { DICTEE } from './dictee';
import { CONJUGAISON } from './conjugaison';
import { HEURE } from './heure';
import { SOUSTRACTIONS } from './soustractions';

export const EXERCISES: readonly ExerciseDef[] = [TABLES as ExerciseDef, SOUSTRACTIONS as ExerciseDef, HEURE as ExerciseDef, DICTEE as ExerciseDef, CONJUGAISON as ExerciseDef];

export const exerciseById = (id: unknown): ExerciseDef | undefined => EXERCISES.find((e) => e.id === id);
