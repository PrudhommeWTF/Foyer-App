// Household state helpers. A fresh install stays EMPTY until the onboarding
// wizard creates the household (see buildInitialState); EMPTY_STATE is the blank
// default used before that. Only DATA fields are persisted; ephemeral UI state
// lives in the frontend.
import { HouseholdState } from './models';

/** Blank household used as the default before onboarding writes the real state. */
export const EMPTY_STATE: HouseholdState = {
  familyName: '',
  members: [],
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
  profile: { name: '', role: '', email: '', phone: '', color: '#E56B4E', memberId: '' },
  settings: {
    dateFmt: 'JJ/MM/AAAA',
    dark: false, prefNotifs: true, academie: '',
  },
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
 * list, one task list, default budget categories) so the app is usable but free of
 * demo personal data.
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
    profile: { name: admin.name, role: admin.role, email: admin.email || '', phone: '', color: admin.color, memberId: adminId },
    settings: {
      dateFmt: 'JJ/MM/AAAA',
      dark: input.household.theme === 'dark',
      prefNotifs: true,
      academie: input.household.academie || '',
    },
  };
}

