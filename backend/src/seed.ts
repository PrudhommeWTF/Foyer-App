// Household state helpers. A fresh install stays EMPTY until the onboarding
// wizard creates the household (see buildInitialState); EMPTY_STATE is the blank
// default used before that. Only DATA fields are persisted; ephemeral UI state
// lives in the frontend.
import { HouseholdState } from './models';
import { householdDefaults, memberDefaults } from './settings/registry';

/**
 * Rayons de départ. Leur `position` donne l'ordre de parcours du magasin, que
 * l'écran Courses laisse réordonner : c'est ce qui fait qu'une liste se lit dans
 * l'ordre des allées plutôt que dans l'ordre de saisie.
 */
const STARTER_AISLES = (): HouseholdState['aisles'] => [
  { id: 'a1', name: 'Fruits & légumes', color: '#7A9B76', position: 0, kind: 'legumes' },
  { id: 'a2', name: 'Frais', color: '#4E93B8', position: 1, kind: 'frais' },
  { id: 'a3', name: 'Épicerie', color: '#F0B24B', position: 2, kind: 'epicerie' },
  { id: 'a4', name: 'À trier', color: '#8A7E74', position: 3 },
];

/** La liste de tâches de départ : partagée, l'affaire du jour, sans rien dedans. */
const STARTER_TASK_LIST = (): HouseholdState['taskLists'][number] =>
  ({ id: 'l1', name: 'Maison', color: '#E56B4E', icon: 'maison', kind: 'taches', scope: 'shared', position: 0 });

/** Blank household used as the default before onboarding writes the real state. */
export const EMPTY_STATE: HouseholdState = {
  familyName: '',
  members: [],
  events: [],
  aisles: STARTER_AISLES(),
  articles: [],
  shopLists: [{ id: 'cl1', name: 'Courses de la semaine', color: '#7A9B76', icon: 'panier' }],
  shop: [],
  taskLists: [STARTER_TASK_LIST()],
  taskTemplates: [],
  tasks: [],
  msgs: [],
  contacts: [],
  folders: [],
  files: [],
  meals: {},
  recipes: [],
  sched: [],
  profile: { memberId: '' },
  settings: householdDefaults(),
  prefs: {},
};

export type { HouseholdState } from './models';

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
  birthday?: string | null;
  /** Optional login email — when set (with a password), an account is created for the member. */
  email?: string;
}

export interface OnboardingInput {
  household: { name: string; theme?: 'light' | 'dark'; academie?: string };
  admin: { name: string; role?: string; color?: string; email: string; birthday?: string | null };
  members?: OnboardingMember[];
}

/**
 * Build the initial household state from the onboarding wizard: the chosen name,
 * members and preferences, plus a small structural scaffold (aisles, one shopping
 * list, one task list) so the app is usable but free of demo personal data.
 * Finances have their own tables and their own starter categories (see
 * finances/schema.ts), so nothing budget-related lives here.
 */
export function buildInitialState(input: OnboardingInput): HouseholdState {
  const adminId = 'me';
  const admin: HouseholdState['members'][number] = {
    id: adminId,
    name: input.admin.name.trim(),
    role: (input.admin.role || '').trim() || 'Parent',
    color: input.admin.color || '#E56B4E',
    ini: initials(input.admin.name),
    admin: true,
    email: input.admin.email.trim(),
    birthday: input.admin.birthday || null,
  };
  const others: HouseholdState['members'] = (input.members || [])
    .filter((m) => (m.name || '').trim())
    .map((m, i) => ({
      id: m.id || 'm' + (i + 1),
      name: m.name.trim(),
      role: (m.role || '').trim() || 'Membre',
      color: m.color || '#4E93B8',
      ini: initials(m.name),
      admin: false,
      birthday: m.birthday || null,
      ...((m.email || '').trim() ? { email: (m.email || '').trim() } : {}),
    }));

  return {
    familyName: input.household.name.trim(),
    members: [admin, ...others],
    events: [],
    aisles: STARTER_AISLES(),
    articles: [],
    shopLists: [{ id: 'cl1', name: 'Courses de la semaine', color: '#7A9B76', icon: 'panier' }],
    shop: [],
    taskLists: [STARTER_TASK_LIST()],
    taskTemplates: [],
    tasks: [],
    msgs: [],
    contacts: [],
    folders: [],
    files: [],
    meals: {},
    recipes: [],
    sched: [],
    profile: { memberId: adminId },
    // Les valeurs par défaut viennent du registre ; l'onboarding n'en pose que
    // deux, celles qu'il a demandées. Le thème est une préférence personnelle :
    // il va à celui qui vient de le choisir, pas à tout le foyer.
    settings: { ...householdDefaults(), academie: input.household.academie || '' },
    prefs: { [adminId]: { ...memberDefaults(), dark: input.household.theme === 'dark' } },
  };
}

