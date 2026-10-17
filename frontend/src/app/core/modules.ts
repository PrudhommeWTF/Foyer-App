// Les modules qu'un administrateur peut activer ou désactiver. Désactiver masque
// le module partout (menu, tuiles, recherche, repères) et verrouille ses accès
// (API et assistant, côté serveur), sans jamais supprimer ses données. La
// réactivation propose de reprendre les données ou de repartir à zéro.
//
// Un module éteint est un drapeau de réglage foyer à `false`. Activés par défaut,
// sauf École : il contacte un service extérieur, on ne l'allume qu'exprès.

export type ModuleFlag = 'modRepas' | 'modFidelite' | 'modFinances' | 'modEmploye' | 'modEcole' | 'modEntretien' | 'modEquipements';

export interface ModuleDef {
  flag: ModuleFlag;
  /** Identifiant côté endpoint de remise à zéro (POST /api/modules/:id/reset). */
  id: string;
  label: string;
  /** Ce que la désactivation masque, en une phrase, pour l'écran d'administration. */
  desc: string;
  /** Les écrans que le module apporte. */
  screens: string[];
}

export const MODULES: ModuleDef[] = [
  { flag: 'modRepas', id: 'repas', label: 'Repas et cuisine', desc: 'Le planning des repas et le carnet de recettes.', screens: ['repas', 'recettes'] },
  { flag: 'modFidelite', id: 'fidelite', label: 'Cartes de fidélité', desc: 'Les cartes de fidélité du foyer.', screens: ['fidelite'] },
  { flag: 'modFinances', id: 'finances', label: 'Finances', desc: 'Les comptes, opérations, budgets et contrats.', screens: ['finances'] },
  { flag: 'modEmploye', id: 'employe', label: 'Employé à domicile', desc: 'Le suivi des heures et la déclaration CESU.', screens: ['employe'] },
  { flag: 'modEntretien', id: 'entretien', label: 'Entretien de la maison', desc: 'Les gestes d’entretien qui reviennent (cartouche de la carafe, détecteurs de fumée, chaudière), avec leur stock. Désactivé, l’écran, la liste Entretien dans Tâches et ses rappels disparaissent ; les gestes sont conservés.', screens: ['entretien'] },
  // L'écran arrive avec la tranche suivante : en attendant, le drapeau ferme
  // l'API du module et sa section de réglages.
  { flag: 'modEquipements', id: 'equipements', label: 'Équipements', desc: 'Les fiches des appareils de la maison : facture, plaque, numéro de série et garantie.', screens: [] },
  { flag: 'modEcole', id: 'ecole', label: 'École (ÉcoleDirecte)', desc: 'Les devoirs et l’emploi du temps des enfants, rapatriés d’ÉcoleDirecte. Désactivé, Foyer ne contacte jamais ÉcoleDirecte.', screens: ['ecole'] },
];

/** L'écran à son drapeau de module, ou undefined pour un écran toujours présent. */
export const SCREEN_MODULE: Record<string, ModuleFlag | undefined> = {
  repas: 'modRepas', recettes: 'modRepas', fidelite: 'modFidelite', finances: 'modFinances', employe: 'modEmploye', ecole: 'modEcole', entretien: 'modEntretien',
};
