import { FinAsset, FinContract, FinContractKind } from '../../core/finances.api';

/** Les libellés des contrats et des biens, partagés par la liste et la fiche. */
export const ASSET_KINDS: { id: FinAsset['kind']; label: string; icon: string }[] = [
  { id: 'immobilier', label: 'Bien immobilier', icon: 'maison' },
  { id: 'vehicule', label: 'Véhicule', icon: 'voiture' },
  { id: 'autre', label: 'Autre', icon: 'facture' },
];

export const CONTRACT_KINDS: { id: FinContractKind; label: string }[] = [
  { id: 'assurance', label: 'Assurance' },
  { id: 'energie', label: 'Énergie' },
  { id: 'telecom', label: 'Téléphonie et internet' },
  { id: 'abonnement', label: 'Abonnement' },
  { id: 'credit', label: 'Crédit' },
  { id: 'sante', label: 'Santé' },
  { id: 'autre', label: 'Autre' },
];

export const PERIODICITIES: { id: FinContract['periodicity']; label: string }[] = [
  { id: 'mensuelle', label: 'Mensuelle' },
  { id: 'trimestrielle', label: 'Trimestrielle' },
  { id: 'semestrielle', label: 'Semestrielle' },
  { id: 'annuelle', label: 'Annuelle' },
  { id: 'ponctuelle', label: 'Ponctuelle' },
];

/** « mois », « trimestre » : l'unité du montant annoncé. */
export function periodWord(p: FinContract['periodicity']): string {
  return ({ mensuelle: 'mois', trimestrielle: 'trimestre', semestrielle: 'semestre', annuelle: 'an', ponctuelle: '' } as const)[p];
}
