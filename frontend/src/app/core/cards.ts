// Cartes de fidélité : le noyau pur, sans dépendance au DOM ni aux librairies de
// scan et de rendu. Il porte les formats de code qu'on sait afficher, la
// correspondance vers la librairie de rendu (bwip-js) et le monogramme qui tient
// lieu de logo (initiales et couleur dérivées du nom, jamais un logo récupéré en
// ligne : rien ne sort du foyer).
import { PALETTE } from './constants';
import { CardFormat } from './models';

export interface CardFormatDecl { id: CardFormat; label: string; }

/** Les formats proposés à la saisie manuelle, du plus courant au plus rare. */
export const CARD_FORMATS: CardFormatDecl[] = [
  { id: 'qr', label: 'QR Code' },
  { id: 'ean13', label: 'Code-barres EAN-13' },
  { id: 'code128', label: 'Code-barres Code 128' },
  { id: 'code39', label: 'Code-barres Code 39' },
  { id: 'ean8', label: 'Code-barres EAN-8' },
  { id: 'upca', label: 'Code-barres UPC-A' },
  { id: 'itf', label: 'Code-barres entrelacé 2/5' },
  { id: 'codabar', label: 'Code-barres Codabar' },
];

const FORMAT_LABELS: Record<CardFormat, string> =
  Object.fromEntries(CARD_FORMATS.map((f) => [f.id, f.label])) as Record<CardFormat, string>;

/** Le libellé lisible d'un format, ou le format brut s'il est inconnu. */
export function formatLabel(f: string): string {
  return FORMAT_LABELS[f as CardFormat] || f;
}

/** L'identifiant bwip-js (`bcid`) de la symbologie, pour le rendu du code. */
export function bwipBcid(f: CardFormat): string {
  switch (f) {
    case 'qr': return 'qrcode';
    case 'ean13': return 'ean13';
    case 'ean8': return 'ean8';
    case 'upca': return 'upca';
    case 'code128': return 'code128';
    case 'code39': return 'code39';
    case 'itf': return 'interleaved2of5';
    case 'codabar': return 'rationalizedCodabar';
  }
}

/** Un QR n'est pas une barre : le rendu réserve un carré au premier, un bandeau aux seconds. */
export const isMatrix = (f: CardFormat): boolean => f === 'qr';

/**
 * Le nom de format que rend le scanner (l'énum `BarcodeFormat` de @zxing/library,
 * ex. « EAN_13 »), traduit en un format qu'on sait réafficher. Rend null pour un
 * format lu mais qu'on ne redessine pas : l'appelant le dit plutôt que de ranger
 * une carte qu'il ne saura pas remontrer.
 */
export function formatFromScan(zxingName: string): CardFormat | null {
  switch (zxingName) {
    case 'QR_CODE': return 'qr';
    case 'EAN_13': return 'ean13';
    case 'EAN_8': return 'ean8';
    case 'UPC_A': return 'upca';
    case 'UPC_E': return 'upca';
    case 'CODE_128': return 'code128';
    case 'CODE_39': return 'code39';
    case 'ITF': return 'itf';
    case 'CODABAR': return 'codabar';
    default: return null;
  }
}

/**
 * Les initiales du monogramme : une lettre par mot, deux au plus. Sans nom, un
 * point d'interrogation, pour que la pastille ne soit jamais vide.
 */
export function cardInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Une couleur stable tirée du nom : la même enseigne garde toujours la même
 * pastille, sans rien stocker. Proposée à l'import ; l'utilisateur peut la
 * changer, la carte porte alors sa propre couleur.
 */
export function cardColor(name: string): string {
  const s = (name || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
