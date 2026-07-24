// Static design constants ported verbatim from the design handoff prototype.
import { ContactCat, SchedType } from './models';

// "Today" in the demo dataset — the whole seed is anchored to mid‑July 2026.
export const TODAY = '2026-07-16';

// Regional settings → functional values (see Paramètres → Général).
export const LANG_LOCALE: Record<string, string> = {
  'Français': 'fr-FR', 'English': 'en-GB', 'Español': 'es-ES', 'Deutsch': 'de-DE',
};
export const TZ_IANA: Record<string, string> = {
  'Europe/Paris (GMT+1)': 'Europe/Paris',
  'Europe/London (GMT)': 'Europe/London',
  'America/New_York (GMT-5)': 'America/New_York',
};
export type DateOrder = 'dmy' | 'mdy' | 'ymd';
export const DATEFMT_ORDER: Record<string, DateOrder> = {
  'JJ/MM/AAAA': 'dmy', 'MM/JJ/AAAA': 'mdy', 'AAAA-MM-JJ': 'ymd',
};

export const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
export const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const MEAL_SLOTS = [
  { key: 'matin', label: 'Petit-déjeuner', short: 'Matin', dot: '#F0B24B' },
  { key: 'midi', label: 'Déjeuner', short: 'Midi', dot: '#4E93B8' },
  { key: 'soir', label: 'Dîner', short: 'Soir', dot: '#E56B4E' },
];

export const LIST_ICONS: Record<string, string> = {
  checklist: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 1.5-2M4 12l1 1 1.5-2M4 18l1 1 1.5-2',
  maison: 'M4 11l8-6 8 6v8H4z',
  outils: 'M14 6a3 3 0 0 0 4 4l3 3-4 4-3-3a3 3 0 0 0-4-4zM10 14l-6 6',
  valise: 'M6 8h12v11H6zM9 8V6a3 3 0 0 1 6 0v2',
  voyage: 'M2 12l19-7-4 15-4-5-3 3v-4z',
  cadeau: 'M4 10h16v10H4zM12 10v10M4 10V7h16v3M12 7c-1-3-5-3-5 0M12 7c1-3 5-3 5 0',
  ecole: 'M3 8l9-4 9 4-9 4zM7 11v4c0 1.2 10 1.2 10 0v-4',
  sport: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8',
  sante: 'M12 21C7 17 4 14 4 10a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 4-3 7-8 11z',
  panier: 'M5 7h13l-1.6 8H6.6zM6.6 15 5 6H2.5',
  fete: 'M4 20l6-14 8 8zM10 6l1-2M18 8l2-1M14 14l2 1',
  jardin: 'M12 20v-7M12 13c-3 0-5-2-5-5 3 0 5 2 5 5zM12 13c0-3 2-5 5-5 0 3-2 5-5 5',
};

export const CAT_ICONS: Record<string, string> = {
  panier: 'M5 7h13l-1.6 8H6.6zM6.6 15 5 6H2.5',
  maison: 'M4 11l8-6 8 6v8H4z',
  voiture: 'M4 13l1.6-5h12.8L20 13v5h-3v-2H7v2H4zM7 13h10',
  loisir: 'M12 4l2.3 5 5.2.5-4 3.4 1.2 5.1L12 20l-5 -1.5 1.2-5.1-4-3.4 5.2-.5z',
  sante: 'M12 21C7 17 4 14 4 10a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 4-3 7-8 11z',
  ecole: 'M3 8l9-4 9 4-9 4zM7 11v4c0 1.2 10 1.2 10 0v-4',
  resto: 'M6 3v18M6 3c-1.5 0-2 2-2 4s.5 4 2 4M17 3v7c0 1 1 1 1 2v9M17 3c1 0 1.4 2 1.4 3.5S17 10 17 10',
  voyage: 'M2 12l19-7-4 15-4-5-3 3v-4z',
  shopping: 'M6 8h12v11H6zM9 8V6a3 3 0 0 1 6 0v2',
  sport: 'M4 9v6M8 7v10M16 7v10M20 9v6M8 12h8',
  facture: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  epargne: 'M4 8h16v11H4zM4 8V5h13v3M15 13h2',
  cadeau: 'M4 10h16v10H4zM12 10v10M4 10V7h16v3M12 7c-1-3-5-3-5 0M12 7c1-3 5-3 5 0',
  animaux: 'M5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM15 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 12c-3 0-5 3-5 5s2 2 5 2 5 1 5-2-2-5-5-5z',
};

// Named app / nav / ui icons (24x24 stroke paths).
export const ICONS: Record<string, string> = {
  home: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  calendar: 'M3 5h18v16H3zM3 9h18M8 3v4M16 3v4',
  courses: 'M4 5h15l-1.6 9H6.5zM6.5 14 5 5 3 4M8 19a1.6 1.6 0 1 0 0 .01M17 19a1.6 1.6 0 1 0 0 .01',
  taches: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 1.5-2M4 12l1 1 1.5-2M4 18l1 1 1.5-2',
  messages: 'M4 5h16v11H9l-4 3z',
  repas: 'M6 3v18M6 3c-1.5 0-2 2-2 4s.5 4 2 4M18 3v7c0 1 1 1 1 2v9M18 3c1 0 1.5 2 1.5 3.5S18 10 18 10',
  recettes: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM9 4v16M12 8h4M12 12h4',
  budget: 'M4 8h16v11H4zM4 8V5h13v3M15 13h2',
  planning: 'M3 4h18v17H3zM3 9h18M8 13h3M8 17h3M14 13h3',
  contacts: 'M5 4h11l3 3v13H5zM12 11a2.4 2.4 0 1 0 0-.01M8.5 17c.6-2 6.4-2 7 0',
  documents: 'M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  settings: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  gear: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
  bell: 'M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6M10 21h4',
  search: 'M11 4a7 7 0 1 0 .01 0M20 20l-3.5-3.5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M20 6 9 17l-5-5',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M6 9l6 6 6-6',
  x: 'M6 6l12 12M18 6 6 18',
  edit: 'M4 20h4L18 10l-4-4L4 16zM14 6l4 4',
  trash: 'M5 7h14M9 7V5h6v2M6 7l1 13h10l1-13',
  sun: 'M12 8a4 4 0 1 0 .01 0M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 .01 0',
  eyeOff: 'M4 4l16 16M2 12s4-7 10-7c1.5 0 2.9.35 4.1.9M22 12s-4 7-10 7c-1.5 0-2.9-.35-4.1-.9',
  phone: 'M5 4h4l1.5 5-2 1a11 11 0 0 0 5 5l1-2 5 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  users: 'M9 8a3 3 0 1 0 .01 0M3 19c0-3 3-5 6-5s6 2 6 5M16 6a3 3 0 0 1 0 6M15 14c3 0 6 2 6 5',
  userPlus: 'M9 8a3 3 0 1 0 .01 0M3 19c0-3 3-5 6-5s6 2 6 5M18 8v6M15 11h6',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  send: 'M4 12l16-8-6 16-2-6z',
  folder: 'M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  logout: 'M9 4H5v16h4M14 8l4 4-4 4M18 12H8',
  clock: 'M12 3a9 9 0 1 0 .01 0M12 7v5l3 2',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  arrowDown: 'M12 5v14M5 12l7 7 7-7',
  export: 'M12 3v12M8 7l4-4 4 4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4',
  refresh: 'M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M18 4v5h-5M6 20v-5h5',
  urgent: 'M12 3a9 9 0 1 0 .01 0M12 8v5M12 16v.5',
  flame: 'M12 3c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 2-3 2-5 1 1 2 1 3 1z',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2',
  key: 'M14 7a4 4 0 1 0-3.7 5.4L9 14H7v2H5v2H3v-2.6l6.6-6.6A4 4 0 0 1 14 7zM15 8h.01',
  cake: 'M4 21h16M5 21v-7h14v7M4 14a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2M12 12V8M9 5.5a1 1 0 1 0 3 0c0-1-1.5-2.5-1.5-2.5S9 4.5 9 5.5zM15 5.5a1 1 0 1 0 0 .01',
  palm: 'M12 22V9M12 9c-3-3-8-2-9 1 3-1 6 0 9 2M12 9c3-3 8-2 9 1-3-1-6 0-9 2M12 9c0-4 3-6 6-6-1 3-3 5-6 6',
  link: 'M9 15l6-6M8 12H6a3 3 0 0 1 0-6h3M16 12h2a3 3 0 0 1 0 6h-3',
  copy: 'M9 9h10v10H9zM5 15H4V4h11v1',
};

export const CONTACT_CATS: ContactCat[] = ['Urgences', 'Santé', 'École', 'Famille', 'Maison', 'Autre'];
export const CONTACT_CAT_COLORS: Record<string, string> = {
  Urgences: '#E56B4E', Santé: '#C77DA5', École: '#4E93B8', Famille: '#F0B24B', Maison: '#7A9B76', Autre: '#8A7E74',
};

export const FILE_TYPE_COLORS: Record<string, string> = {
  PDF: '#E56B4E', IMG: '#7A9B76', DOC: '#4E93B8', XLS: '#5F9E6E', AUTRE: '#8A7E74',
};

export const SCHED_DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
export const SCHED_TYPES: { k: SchedType; label: string; color: string }[] = [
  { k: 'ecole', label: 'École', color: '#4E93B8' },
  { k: 'travail', label: 'Travail', color: '#E56B4E' },
  { k: 'sport', label: 'Sport', color: '#7A9B76' },
  { k: 'loisir', label: 'Loisir', color: '#9B6FA8' },
  { k: 'sante', label: 'Santé', color: '#C77DA5' },
  { k: 'repas', label: 'Repas', color: '#F0B24B' },
  { k: 'autre', label: 'Autre', color: '#8A7E74' },
];
export const SCHED_COLORS: Record<string, string> = {
  ecole: '#4E93B8', travail: '#E56B4E', sport: '#7A9B76', loisir: '#9B6FA8', sante: '#C77DA5', repas: '#F0B24B', autre: '#8A7E74', repos: '#B7ABA0',
};

export const PALETTE = ['#E56B4E', '#7A9B76', '#4E93B8', '#F0B24B', '#9B6FA8', '#C77DA5'];
export const RECIPE_PALETTE = ['#7A9B76', '#F0B24B', '#E56B4E', '#9B6FA8'];
export const CAT_PALETTE = ['#7A9B76', '#E56B4E', '#4E93B8', '#F0B24B', '#9B6FA8', '#6E9E5F'];

/** Light category tints keyed by accent colour. */
export function tint(c: string): string {
  return ({ '#E56B4E': '#FCE9E3', '#7A9B76': '#EDF2EB', '#4E93B8': '#E5F0F4', '#F0B24B': '#FDF0DA', '#9B6FA8': '#F2ECF5' } as Record<string, string>)[c] || '#F5EEE2';
}

/** Gradient for a given accent colour (recipe/meal cards). */
export function grad(c: string): string {
  return ({
    '#7A9B76': 'linear-gradient(135deg,#8FB08A,#6B8F71)',
    '#F0B24B': 'linear-gradient(135deg,#F5C46F,#EBA334)',
    '#E56B4E': 'linear-gradient(135deg,#EE8368,#DB5636)',
    '#9B6FA8': 'linear-gradient(135deg,#B189BD,#8A5C97)',
  } as Record<string, string>)[c] || 'linear-gradient(135deg,#8FB08A,#6B8F71)';
}

export const RECUR_LABELS: Record<string, string> = {
  none: '', daily: 'Chaque jour', weekday: 'En semaine', weekly: 'Chaque semaine', monthly: 'Chaque mois',
};

// French academies (for school-holiday zones). `zone` is informational; the
// backend queries the official dataset by academy name.
export interface Academie { name: string; zone: string; }
export const ACADEMIES: Academie[] = [
  { name: 'Aix-Marseille', zone: 'B' }, { name: 'Amiens', zone: 'B' }, { name: 'Besançon', zone: 'A' },
  { name: 'Bordeaux', zone: 'A' }, { name: 'Clermont-Ferrand', zone: 'A' }, { name: 'Corse', zone: 'Corse' },
  { name: 'Créteil', zone: 'C' }, { name: 'Dijon', zone: 'A' }, { name: 'Grenoble', zone: 'A' },
  { name: 'Lille', zone: 'B' }, { name: 'Limoges', zone: 'A' }, { name: 'Lyon', zone: 'A' },
  { name: 'Montpellier', zone: 'C' }, { name: 'Nancy-Metz', zone: 'B' }, { name: 'Nantes', zone: 'B' },
  { name: 'Nice', zone: 'B' }, { name: 'Normandie', zone: 'B' }, { name: 'Orléans-Tours', zone: 'B' },
  { name: 'Paris', zone: 'C' }, { name: 'Poitiers', zone: 'A' }, { name: 'Reims', zone: 'B' },
  { name: 'Rennes', zone: 'B' }, { name: 'Strasbourg', zone: 'B' }, { name: 'Toulouse', zone: 'C' },
  { name: 'Versailles', zone: 'C' },
];

// Calendar overlay item kinds → colour.
export const CAL_KINDS: Record<string, { color: string; label: string }> = {
  event: { color: '#E56B4E', label: 'Événement' },
  task: { color: '#9B6FA8', label: 'Tâche' },
  holiday: { color: '#4E93B8', label: 'Jour férié' },
  school: { color: '#F0B24B', label: 'Vacances scolaires' },
  birthday: { color: '#C77DA5', label: 'Anniversaire' },
};

export const SCREEN_TITLES: Record<string, string> = {
  home: 'Accueil', calendar: 'Calendrier partagé', courses: 'Listes de courses', taches: 'Tâches',
  messages: 'Messagerie', contacts: 'Contacts importants', documents: 'Documents', budget: 'Suivi de budget',
  repas: 'Planning des repas', recettes: 'Carnet de recettes', planning: 'Emploi du temps', settings: 'Paramètres',
};
