export interface NavItem { id: string; label: string; icon: string; }

/**
 * Les écrans qu'un compte enfant n'ouvre pas.
 *
 * Le serveur refuse de son côté, indépendamment : cette liste n'est pas la
 * protection, elle évite d'afficher une porte qui répond 403. Déclarée ici parce
 * que la barre latérale, la barre du bas et le menu d'ajout doivent filtrer la
 * même chose, et qu'une seule des trois oubliée laisserait l'entrée visible.
 */
export const ECRANS_ADULTES: ReadonlySet<string> = new Set(['finances', 'documents', 'settings']);

/** Les entrées du menu « + » qui mènent à ces écrans. */
export const AJOUTS_ADULTES: ReadonlySet<string> = new Set(['tx', 'file']);

/** Les groupes de navigation, tels qu'ils s'affichent pour ce compte. */
export const navGroupsFor = (enfant: boolean): NavGroup[] => (enfant
  ? NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !ECRANS_ADULTES.has(i.id)) })).filter((g) => g.items.length)
  : NAV_GROUPS);
export interface NavGroup { title: string; items: NavItem[]; }

export const NAV_GROUPS: NavGroup[] = [
  {
    title: '',
    items: [
      { id: 'home', label: 'Accueil', icon: 'home' },
      { id: 'calendar', label: 'Calendrier', icon: 'calendar' },
      { id: 'courses', label: 'Listes de courses', icon: 'courses' },
      { id: 'taches', label: 'Tâches', icon: 'taches' },
      { id: 'messages', label: 'Messagerie', icon: 'messages' },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { id: 'repas', label: 'Planning des repas', icon: 'repas' },
      { id: 'recettes', label: 'Carnet de recettes', icon: 'recettes' },
      { id: 'finances', label: 'Finances', icon: 'budget' },
      { id: 'planning', label: 'Emploi du temps', icon: 'planning' },
    ],
  },
  {
    title: 'Le foyer',
    items: [
      { id: 'contacts', label: 'Contacts', icon: 'contacts' },
      { id: 'documents', label: 'Documents', icon: 'documents' },
    ],
  },
];

/** Bottom tab bar (mobile): the 4 primary destinations + a "Plus" sheet. */
export const MOBILE_TABS: NavItem[] = [
  { id: 'home', label: 'Accueil', icon: 'home' },
  { id: 'calendar', label: 'Agenda', icon: 'calendar' },
  { id: 'courses', label: 'Courses', icon: 'courses' },
  { id: 'taches', label: 'Tâches', icon: 'taches' },
];

export const ADD_MENU: { id: string; label: string; sub: string; icon: string; tint: string; color: string }[] = [
  { id: 'event', label: 'Événement', sub: 'Ajouter à l’agenda', icon: 'calendar', tint: '#FCE9E3', color: '#E56B4E' },
  { id: 'task', label: 'Tâche', sub: 'Assigner à un membre', icon: 'taches', tint: '#F2ECF5', color: '#9B6FA8' },
  { id: 'shop', label: 'Article de courses', sub: 'Ajouter à la liste', icon: 'courses', tint: '#EDF2EB', color: '#7A9B76' },
  { id: 'recipe', label: 'Recette', sub: 'Ajouter au carnet', icon: 'recettes', tint: '#FCE9E3', color: '#E56B4E' },
  { id: 'tx', label: 'Opération', sub: 'Dépense ou recette', icon: 'budget', tint: '#EDF2EB', color: '#7A9B76' },
  { id: 'slot', label: 'Créneau', sub: 'Emploi du temps', icon: 'planning', tint: '#E5F0F4', color: '#4E93B8' },
  { id: 'contact', label: 'Contact', sub: 'Carnet du foyer', icon: 'contacts', tint: '#F2ECF5', color: '#9B6FA8' },
  { id: 'file', label: 'Document', sub: 'Téléverser un fichier', icon: 'documents', tint: '#FDF0DA', color: '#F0B24B' },
  { id: 'member', label: 'Membre', sub: 'Ajouter au foyer', icon: 'userPlus', tint: '#FDF0DA', color: '#F0B24B' },
];
