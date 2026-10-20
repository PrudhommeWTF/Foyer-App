// Le registre des exercices du module Révisions. Ajouter un exercice : un
// fichier dans ce dossier qui respecte le contrat (contract.ts), et une ligne
// ici. Voir docs/revisions.md.
import { ExerciseDef } from './contract';
import { TABLES } from './tables';
import { DICTEE } from './dictee';
import { CONJUGAISON } from './conjugaison';
import { ORTHOGRAPHE } from './orthographe';
import { HEURE } from './heure';
import { SOUSTRACTIONS } from './soustractions';
import { COMPLEMENTS } from './complements';
import { DOUBLES } from './doubles';
import { COMPARER } from './comparer';
import { LETTRES } from './lettres';
import { MONNAIE } from './monnaie';
import { ACCORDS } from './accords';
import { LECTURE } from './lecture';

export const EXERCISES: readonly ExerciseDef[] = [TABLES as ExerciseDef, SOUSTRACTIONS as ExerciseDef, COMPLEMENTS as ExerciseDef, DOUBLES as ExerciseDef, COMPARER as ExerciseDef, LETTRES as ExerciseDef, MONNAIE as ExerciseDef, HEURE as ExerciseDef, DICTEE as ExerciseDef, CONJUGAISON as ExerciseDef, ORTHOGRAPHE as ExerciseDef, ACCORDS as ExerciseDef, LECTURE as ExerciseDef];

export const exerciseById = (id: unknown): ExerciseDef | undefined => EXERCISES.find((e) => e.id === id);
