// Les modules qu'un administrateur peut activer ou désactiver. Désactiver masque
// le module partout (menu, tuiles, recherche, repères) et verrouille ses accès
// (API et assistant, côté serveur), sans jamais supprimer ses données. La
// réactivation propose de reprendre les données ou de repartir à zéro.
//
// Un module éteint est un drapeau de réglage foyer à `false` (défaut : activé).

export type ModuleFlag = 'modRepas' | 'modFidelite' | 'modFinances' | 'modEmploye';

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
];

/** L'écran à son drapeau de module, ou undefined pour un écran toujours présent. */
export const SCREEN_MODULE: Record<string, ModuleFlag | undefined> = {
  repas: 'modRepas', recettes: 'modRepas', fidelite: 'modFidelite', finances: 'modFinances', employe: 'modEmploye',
};
