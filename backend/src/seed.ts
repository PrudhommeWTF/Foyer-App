// Seed household state — mirrors the demo data from the design handoff prototype.
// Only DATA fields are persisted; ephemeral UI/form/selection state lives in the frontend.

export const SEED_STATE = {
  familyName: 'Famille Martin',
  members: [
    { id: 'cam', name: 'Camille', role: 'Maman', color: '#E56B4E', ini: 'C', admin: true },
    { id: 'tho', name: 'Thomas', role: 'Papa', color: '#4E93B8', ini: 'T', admin: true },
    { id: 'lea', name: 'Léa', role: '12 ans', color: '#9B6FA8', ini: 'L', admin: false },
    { id: 'noa', name: 'Noah', role: '8 ans', color: '#6E9E5F', ini: 'N', admin: false },
  ],
  events: [
    { id: 'e1', date: '2026-07-16', time: '08:00', title: 'Dépose Noah à l’école', who: 'tho', recur: 'weekday', end: null },
    { id: 'e2', date: '2026-07-16', time: '14:30', title: 'Rendez-vous pédiatre', who: 'lea', recur: 'none', end: null },
    { id: 'e3', date: '2026-07-16', time: '19:00', title: 'Dîner en famille', who: 'cam', recur: 'daily', end: null },
    { id: 'e4', date: '2026-07-14', time: '17:00', title: 'Entraînement de foot', who: 'noa', recur: 'weekly', end: null },
    { id: 'e5', date: '2026-07-18', time: '10:00', title: 'Marché du samedi', who: 'cam', recur: 'weekly', end: null },
    { id: 'e6', date: '2026-07-18', time: '15:00', title: 'Anniversaire chez Manon', who: 'lea', recur: 'none', end: null },
    { id: 'e7', date: '2026-07-20', time: '09:00', title: 'Dentiste', who: 'tho', recur: 'none', end: null },
    { id: 'e8', date: '2026-07-15', time: '18:30', title: 'Cours de piano', who: 'lea', recur: 'weekly', end: null },
    { id: 'e9', date: '2026-07-24', time: '20:00', title: 'Soirée entre parents', who: 'cam', recur: 'monthly', end: null },
    { id: 'e10', date: '2026-07-27', end: '2026-07-31', time: '09:00', title: 'Vacances à la mer', who: 'cam', recur: 'none' },
  ],
  aisles: [
    { id: 'a1', name: 'Fruits & légumes', color: '#7A9B76' },
    { id: 'a2', name: 'Frais', color: '#4E93B8' },
    { id: 'a3', name: 'Épicerie', color: '#F0B24B' },
    { id: 'a4', name: 'À trier', color: '#8A7E74' },
  ],
  shopLists: [
    { id: 'cl1', name: 'Courses de la semaine', color: '#7A9B76', icon: 'panier' },
    { id: 'cl2', name: 'Pharmacie', color: '#4E93B8', icon: 'sante' },
    { id: 'cl3', name: 'Marché du dimanche', color: '#F0B24B', icon: 'jardin' },
  ],
  shop: [
    { id: 's1', name: 'Bananes', qty: 'x6', cat: 'Fruits & légumes', done: false, listId: 'cl1' },
    { id: 's2', name: 'Tomates', qty: '1 kg', cat: 'Fruits & légumes', done: false, listId: 'cl1' },
    { id: 's3', name: 'Salade', qty: 'x1', cat: 'Fruits & légumes', done: true, listId: 'cl1' },
    { id: 's4', name: 'Lait', qty: '2 L', cat: 'Frais', done: true, listId: 'cl1' },
    { id: 's5', name: 'Yaourts', qty: 'x8', cat: 'Frais', done: false, listId: 'cl1' },
    { id: 's6', name: 'Beurre', qty: 'x1', cat: 'Frais', done: false, listId: 'cl1' },
    { id: 's7', name: 'Pâtes', qty: 'x2', cat: 'Épicerie', done: false, listId: 'cl1' },
    { id: 's8', name: 'Café', qty: 'x1', cat: 'Épicerie', done: true, listId: 'cl1' },
    { id: 's9', name: 'Doliprane', qty: 'x1', cat: 'Pharmacie', done: false, listId: 'cl2' },
    { id: 's10', name: 'Pansements', qty: 'x1', cat: 'Pharmacie', done: false, listId: 'cl2' },
    { id: 's11', name: 'Fraises', qty: 'x2', cat: 'Fruits & légumes', done: false, listId: 'cl3' },
  ],
  taskLists: [
    { id: 'l1', name: 'Maison', color: '#E56B4E', icon: 'maison' },
    { id: 'l2', name: 'Bricolage', color: '#7A9B76', icon: 'outils' },
    { id: 'l3', name: 'Départ en vacances', color: '#4E93B8', icon: 'valise' },
  ],
  tasks: [
    { id: 't1', text: 'Signer le carnet de Léa', who: 'cam', due: "Aujourd'hui", done: false, listId: 'l1', prio: 'med' },
    { id: 't2', text: 'Sortir les poubelles', who: 'noa', due: "Aujourd'hui", done: false, listId: 'l1', prio: 'med' },
    { id: 't3', text: 'Poncer la commode', who: 'tho', due: 'Demain', done: false, listId: 'l2', prio: 'med' },
    { id: 't4', text: 'Racheter des vis', who: 'tho', due: 'Cette semaine', done: false, listId: 'l2', prio: 'low' },
    { id: 't5', text: 'Réserver l’hôtel', who: 'cam', due: '18 juil.', done: false, listId: 'l3', prio: 'high' },
    { id: 't6', text: 'Faire les valises', who: 'lea', due: '20 juil.', done: false, listId: 'l3', prio: 'med' },
    { id: 't7', text: 'Ranger la chambre', who: 'noa', due: 'Hier', done: true, listId: 'l1', prio: 'low' },
    { id: 't8', text: 'Vérifier la perceuse', who: 'tho', due: 'Hier', done: true, listId: 'l2', prio: 'low' },
  ],
  msgs: [
    { who: 'lea', text: 'Maman tu peux signer mon carnet ?', time: '12:30' },
    { who: 'cam', text: 'Oui ce soir promis 😉', time: '12:45' },
    { who: 'tho', text: 'Je passe prendre du pain en rentrant', time: '17:10' },
    { who: 'noa', text: 'On mange quoi ce soir ?', time: '17:20' },
    { who: 'cam', text: 'Poulet rôti !', time: '17:22' },
  ],
  contacts: [
    { id: 'ct1', name: 'Dr. Lefèvre', role: 'Pédiatre', phone: '01 42 88 12 03', email: 'cabinet.lefevre@sante.fr', cat: 'Santé', color: '#C77DA5', urgent: false },
    { id: 'ct2', name: 'École Jean Moulin', role: 'Primaire de Noah', phone: '01 45 21 76 40', email: 'contact@ecole-jm.fr', cat: 'École', color: '#4E93B8', urgent: false },
    { id: 'ct3', name: 'Sophie', role: 'Nounou', phone: '06 12 45 78 90', email: 'sophie.nounou@gmail.com', cat: 'Famille', color: '#E56B4E', urgent: false },
    { id: 'ct4', name: 'Pharmacie du Centre', role: 'De garde', phone: '01 43 55 09 88', email: '', cat: 'Santé', color: '#7A9B76', urgent: true },
    { id: 'ct5', name: 'Papi & Mamie', role: 'Grands-parents', phone: '02 38 44 12 65', email: '', cat: 'Famille', color: '#F0B24B', urgent: false },
    { id: 'ct6', name: 'Plomberie Durand', role: 'Dépannage 24/7', phone: '06 88 34 21 09', email: '', cat: 'Maison', color: '#8A7E74', urgent: true },
    { id: 'ct7', name: 'SAMU', role: 'Urgences médicales', phone: '15', email: '', cat: 'Urgences', color: '#E56B4E', urgent: true },
    { id: 'ct8', name: 'Pompiers', role: 'Secours', phone: '18', email: '', cat: 'Urgences', color: '#E56B4E', urgent: true },
  ],
  folders: [
    { id: 'f1', name: 'Assurances', color: '#E56B4E' },
    { id: 'f2', name: 'Santé', color: '#7A9B76' },
    { id: 'f3', name: 'École', color: '#4E93B8' },
    { id: 'f4', name: 'Impôts', color: '#F0B24B' },
  ],
  files: [
    { id: 'd1', name: 'Carte vitale — Léa.pdf', folderId: 'f2', type: 'PDF', date: '12 juil. 2026', data: null },
    { id: 'd2', name: 'Ordonnance Dr Lefèvre.pdf', folderId: 'f2', type: 'PDF', date: '08 juil. 2026', data: null },
    { id: 'd3', name: 'Carnet de vaccination.jpg', folderId: 'f2', type: 'IMG', date: '02 juin 2026', data: null },
    { id: 'd4', name: 'Attestation habitation.pdf', folderId: 'f1', type: 'PDF', date: '15 juin 2026', data: null },
    { id: 'd5', name: 'Contrat auto.pdf', folderId: 'f1', type: 'PDF', date: '20 mai 2026', data: null },
    { id: 'd6', name: 'Certificat scolaire.jpg', folderId: 'f3', type: 'IMG', date: '01 sept. 2025', data: null },
    { id: 'd7', name: 'Liste fournitures.pdf', folderId: 'f3', type: 'PDF', date: '28 août 2025', data: null },
    { id: 'd8', name: 'Avis d’imposition 2025.pdf', folderId: 'f4', type: 'PDF', date: '10 sept. 2025', data: null },
    { id: 'd9', name: 'Taxe foncière.pdf', folderId: 'f4', type: 'PDF', date: '15 oct. 2025', data: null },
  ],
  bcats: [
    { id: 'c1', name: 'Courses', budget: 600, color: '#7A9B76', icon: 'panier' },
    { id: 'c2', name: 'Logement', budget: 850, color: '#E56B4E', icon: 'maison' },
    { id: 'c3', name: 'Transports', budget: 250, color: '#4E93B8', icon: 'voiture' },
    { id: 'c4', name: 'Loisirs', budget: 300, color: '#F0B24B', icon: 'loisir' },
  ],
  tx: [
    { id: 'x1', name: 'Salaire', catId: null, amount: 2450, income: true, date: '01 juil.', m: 0 },
    { id: 'x2', name: 'Loyer', catId: 'c2', amount: 850, income: false, date: '03 juil.', m: 0 },
    { id: 'x3', name: 'Carrefour', catId: 'c1', amount: 84.3, income: false, date: '15 juil.', m: 0 },
    { id: 'x4', name: 'Marché du samedi', catId: 'c1', amount: 32, income: false, date: '11 juil.', m: 0 },
    { id: 'x5', name: 'Essence Total', catId: 'c3', amount: 62, income: false, date: '14 juil.', m: 0 },
    { id: 'x6', name: 'Cinéma Pathé', catId: 'c4', amount: 38, income: false, date: '12 juil.', m: 0 },
    { id: 'x7', name: 'Restaurant', catId: 'c4', amount: 54, income: false, date: '09 juil.', m: 0 },
    { id: 'j1', name: 'Salaire', catId: null, amount: 2450, income: true, date: '01 juin', m: -1 },
    { id: 'j2', name: 'Loyer', catId: 'c2', amount: 850, income: false, date: '03 juin', m: -1 },
    { id: 'j3', name: 'Auchan', catId: 'c1', amount: 212.5, income: false, date: '18 juin', m: -1 },
    { id: 'j4', name: 'Essence', catId: 'c3', amount: 74, income: false, date: '12 juin', m: -1 },
    { id: 'j5', name: 'Parc d’attractions', catId: 'c4', amount: 180, income: false, date: '21 juin', m: -1 },
    { id: 'j6', name: 'Métro', catId: 'c3', amount: 48, income: false, date: '05 juin', m: -1 },
    { id: 'a1', name: 'Salaire', catId: null, amount: 2450, income: true, date: '01 mai', m: -2 },
    { id: 'a2', name: 'Loyer', catId: 'c2', amount: 850, income: false, date: '03 mai', m: -2 },
    { id: 'a3', name: 'Courses du mois', catId: 'c1', amount: 498, income: false, date: '20 mai', m: -2 },
    { id: 'a4', name: 'Concert', catId: 'c4', amount: 95, income: false, date: '17 mai', m: -2 },
  ],
  meals: {
    '2026-07-13-soir': { rid: 'r3' },
    '2026-07-14-soir': { text: 'Soupe & tartines' },
    '2026-07-15-soir': { rid: 'r1' },
    '2026-07-16-matin': { text: 'Tartines & fruits' },
    '2026-07-16-midi': { text: 'Salade composée' },
    '2026-07-16-soir': { rid: 'r2' },
    '2026-07-17-soir': { text: 'Pizza maison' },
    '2026-07-18-soir': { rid: 'r4' },
    '2026-07-19-soir': { text: 'Rôti & purée' },
  } as Record<string, { rid?: string; text?: string }>,
  recipes: [
    {
      id: 'r1', name: 'Gratin de courgettes', time: '40 min', level: 'Facile', color: '#7A9B76', photo: null,
      ingr: ['3 courgettes', '20 cl de crème fraîche', 'Gruyère râpé', '2 œufs'],
      steps: ['Émincer et faire revenir les courgettes.', 'Battre les œufs avec la crème.', 'Verser sur les courgettes, couvrir de gruyère.', 'Enfourner 25 min à 190°C.'],
    },
    {
      id: 'r2', name: 'Poulet rôti & légumes', time: '1 h 10', level: 'Moyen', color: '#F0B24B', photo: null,
      ingr: ['1 poulet fermier', 'Pommes de terre', 'Carottes', 'Thym & romarin'],
      steps: ['Préchauffer le four à 200°C.', 'Disposer les légumes autour du poulet.', 'Arroser d’huile, saler, poivrer.', 'Cuire 1 h en arrosant régulièrement.'],
    },
    {
      id: 'r3', name: 'Pâtes bolognaise', time: '35 min', level: 'Facile', color: '#E56B4E', photo: null,
      ingr: ['400 g de spaghetti', '300 g de bœuf haché', 'Tomates concassées', '1 oignon'],
      steps: ['Faire revenir l’oignon et la viande.', 'Ajouter les tomates, mijoter 20 min.', 'Cuire les pâtes al dente.', 'Mélanger et servir.'],
    },
    {
      id: 'r4', name: 'Crêpes du dimanche', time: '25 min', level: 'Facile', color: '#9B6FA8', photo: null,
      ingr: ['250 g de farine', '3 œufs', '50 cl de lait', 'Beurre'],
      steps: ['Mélanger farine et œufs.', 'Ajouter le lait progressivement.', 'Laisser reposer 30 min.', 'Cuire à la poêle chaude.'],
    },
  ],
  sched: [
    { id: 's1', who: 'lea', day: 'Lundi', start: '08:00', end: '17:00', label: 'Collège', k: 'ecole' },
    { id: 's2', who: 'lea', day: 'Lundi', start: '17:30', end: '18:30', label: 'Piano', k: 'loisir' },
    { id: 's3', who: 'lea', day: 'Mardi', start: '08:00', end: '17:00', label: 'Collège', k: 'ecole' },
    { id: 's4', who: 'lea', day: 'Mercredi', start: '10:00', end: '11:30', label: 'Danse', k: 'sport' },
    { id: 's5', who: 'lea', day: 'Jeudi', start: '08:00', end: '17:00', label: 'Collège', k: 'ecole' },
    { id: 's6', who: 'lea', day: 'Vendredi', start: '08:00', end: '16:00', label: 'Collège', k: 'ecole' },
    { id: 's7', who: 'lea', day: 'Samedi', start: '14:00', end: '16:00', label: 'Anniversaire', k: 'loisir' },
    { id: 'sn1', who: 'noa', day: 'Lundi', start: '08:30', end: '16:30', label: 'École', k: 'ecole' },
    { id: 'sn2', who: 'noa', day: 'Mardi', start: '08:30', end: '16:30', label: 'École', k: 'ecole' },
    { id: 'sn3', who: 'noa', day: 'Mardi', start: '17:00', end: '18:30', label: 'Foot', k: 'sport' },
    { id: 'sn4', who: 'noa', day: 'Jeudi', start: '08:30', end: '16:30', label: 'École', k: 'ecole' },
    { id: 'sn5', who: 'noa', day: 'Vendredi', start: '08:30', end: '16:30', label: 'École', k: 'ecole' },
    { id: 'sn6', who: 'noa', day: 'Vendredi', start: '16:00', end: '17:00', label: 'Judo', k: 'sport' },
    { id: 'sm1', who: 'cam', day: 'Lundi', start: '09:00', end: '17:30', label: 'Travail', k: 'travail' },
    { id: 'sm2', who: 'cam', day: 'Mardi', start: '09:00', end: '17:30', label: 'Travail', k: 'travail' },
    { id: 'sm3', who: 'cam', day: 'Mercredi', start: '12:30', end: '14:00', label: 'Déjeuner équipe', k: 'repas' },
    { id: 'sm4', who: 'cam', day: 'Jeudi', start: '09:00', end: '17:30', label: 'Travail', k: 'travail' },
    { id: 'st1', who: 'tho', day: 'Lundi', start: '08:30', end: '18:00', label: 'Bureau', k: 'travail' },
    { id: 'st2', who: 'tho', day: 'Samedi', start: '10:00', end: '11:30', label: 'Course à pied', k: 'sport' },
  ],
  notifs: [
    { id: 'n1', title: 'Rappel : Rendez-vous pédiatre', desc: 'Léa — aujourd’hui à 14:30', time: 'Il y a 20 min', read: false, kind: 'event' },
    { id: 'n2', title: 'Thomas a ajouté une tâche', desc: '« Sortir les poubelles » dans Maison', time: 'Il y a 1 h', read: false, kind: 'task' },
    { id: 'n3', title: 'Budget : plafond bientôt atteint', desc: 'Courses — 92% du budget du mois', time: 'Il y a 3 h', read: false, kind: 'budget' },
    { id: 'n4', title: 'Liste de courses partagée', desc: 'Camille a coché 4 articles', time: 'Hier', read: true, kind: 'shop' },
    { id: 'n5', title: 'Nouveau document ajouté', desc: '« Ordonnance Dr Lefèvre.pdf » dans Santé', time: 'Hier', read: true, kind: 'doc' },
  ],
  profile: { name: 'Camille', role: 'Maman', email: 'camille.martin@email.fr', phone: '06 24 55 18 09', color: '#E56B4E', memberId: 'cam' },
  settings: {
    lang: 'Français', tz: 'Europe/Paris (GMT+1)', dateFmt: 'JJ/MM/AAAA', weekStart: 'Lundi', currency: 'Euro (€)',
    dark: false, prefNotifs: true, prefWeekly: true, prefShared: false,
  },
};

export type HouseholdState = typeof SEED_STATE;

// ---- First-run onboarding -------------------------------------------------

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export interface OnboardingMember {
  id?: string;
  name: string;
  role?: string;
  color?: string;
  /** Optional login email — when set (with a password), an account is created for the member. */
  email?: string;
}

export interface OnboardingInput {
  household: { name: string; weekStart?: string; currency?: string; theme?: 'light' | 'dark' };
  admin: { name: string; role?: string; color?: string; email: string };
  members?: OnboardingMember[];
}

/**
 * Build the initial household state from the onboarding wizard: the chosen name,
 * members and preferences, plus a small structural scaffold (aisles, one shopping
 * list, one task list, default budget categories) so the app is usable but free of
 * demo personal data.
 */
export function buildInitialState(input: OnboardingInput): HouseholdState {
  const adminId = 'me';
  const admin = {
    id: adminId,
    name: input.admin.name.trim(),
    role: (input.admin.role || '').trim() || 'Parent',
    color: input.admin.color || '#E56B4E',
    ini: initials(input.admin.name),
    admin: true,
    email: input.admin.email.trim(),
  };
  const others = (input.members || [])
    .filter((m) => (m.name || '').trim())
    .map((m, i) => ({
      id: m.id || 'm' + (i + 1),
      name: m.name.trim(),
      role: (m.role || '').trim() || 'Membre',
      color: m.color || '#4E93B8',
      ini: initials(m.name),
      admin: false,
      ...((m.email || '').trim() ? { email: (m.email || '').trim() } : {}),
    }));

  return {
    familyName: input.household.name.trim(),
    members: [admin, ...others],
    events: [],
    aisles: [
      { id: 'a1', name: 'Fruits & légumes', color: '#7A9B76' },
      { id: 'a2', name: 'Frais', color: '#4E93B8' },
      { id: 'a3', name: 'Épicerie', color: '#F0B24B' },
      { id: 'a4', name: 'À trier', color: '#8A7E74' },
    ],
    shopLists: [{ id: 'cl1', name: 'Courses de la semaine', color: '#7A9B76', icon: 'panier' }],
    shop: [],
    taskLists: [{ id: 'l1', name: 'Maison', color: '#E56B4E', icon: 'maison' }],
    tasks: [],
    msgs: [],
    contacts: [],
    folders: [],
    files: [],
    bcats: [
      { id: 'c1', name: 'Courses', budget: 600, color: '#7A9B76', icon: 'panier' },
      { id: 'c2', name: 'Logement', budget: 850, color: '#E56B4E', icon: 'maison' },
      { id: 'c3', name: 'Transports', budget: 250, color: '#4E93B8', icon: 'voiture' },
      { id: 'c4', name: 'Loisirs', budget: 300, color: '#F0B24B', icon: 'loisir' },
    ],
    tx: [],
    meals: {},
    recipes: [],
    sched: [],
    notifs: [],
    profile: { name: admin.name, role: admin.role, email: admin.email, phone: '', color: admin.color, memberId: adminId },
    settings: {
      lang: 'Français',
      tz: 'Europe/Paris (GMT+1)',
      dateFmt: 'JJ/MM/AAAA',
      weekStart: input.household.weekStart || 'Lundi',
      currency: input.household.currency || 'Euro (€)',
      dark: input.household.theme === 'dark',
      prefNotifs: true,
      prefWeekly: true,
      prefShared: false,
    },
  };
}
