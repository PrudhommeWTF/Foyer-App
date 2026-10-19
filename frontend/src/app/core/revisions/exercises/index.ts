// Le registre des exercices du module Révisions. Ajouter un exercice : un
// fichier dans ce dossier qui respecte le contrat (contract.ts), et une ligne
// ici. Voir docs/revisions.md.
import { ExerciseDef } from './contract';
import { TABLES } from './tables';

export const EXERCISES: readonly ExerciseDef[] = [TABLES as ExerciseDef];

export const exerciseById = (id: unknown): ExerciseDef | undefined => EXERCISES.find((e) => e.id === id);
