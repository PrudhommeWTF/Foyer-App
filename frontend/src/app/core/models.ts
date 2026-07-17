// Domain models for the Foyer household state.

export type Recur = 'none' | 'daily' | 'weekday' | 'weekly' | 'monthly';
export type Prio = 'low' | 'med' | 'high';
export type SchedType = 'ecole' | 'travail' | 'sport' | 'loisir' | 'sante' | 'repas' | 'autre';
export type ContactCat = 'Urgences' | 'Santé' | 'École' | 'Famille' | 'Maison' | 'Autre';
export type FileType = 'PDF' | 'IMG' | 'DOC' | 'XLS' | 'AUTRE';

export interface Member { id: string; name: string; role: string; color: string; ini: string; admin?: boolean; email?: string; }
export interface EventItem { id: string; date: string; time: string; title: string; who: string; recur: Recur; end?: string | null; }
export interface Aisle { id: string; name: string; color: string; }
export interface ShopList { id: string; name: string; color: string; icon: string; }
export interface ShopItem { id: string; name: string; qty: string; cat: string; done: boolean; listId: string; }
export interface TaskList { id: string; name: string; color: string; icon: string; }
export interface TaskItem { id: string; text: string; who: string; due: string; done: boolean; listId: string; prio: Prio; }
export interface Message { who: string; text: string; time: string; }
export interface Contact { id: string; name: string; role: string; phone: string; email: string; cat: ContactCat; color: string; urgent: boolean; }
export interface Folder { id: string; name: string; color: string; }
export interface FileItem { id: string; name: string; folderId: string; type: FileType; date: string; data?: string | null; }
export interface BudgetCat { id: string; name: string; budget: number; color: string; icon: string; }
export interface Transaction { id: string; name: string; catId: string | null; amount: number; income: boolean; date: string; m: number; }
export interface MealValue { rid?: string; text?: string; }
export interface Recipe { id: string; name: string; time: string; level: string; color: string; photo?: string | null; ingr: string[]; steps: string[]; }
export interface SchedSlot { id: string; who: string; day: string; start: string; end: string; label: string; k: SchedType; }
export interface Notif { id: string; title: string; desc: string; time: string; read: boolean; kind: string; }
export interface Profile { name: string; role: string; email: string; phone: string; color: string; memberId: string; }
export interface Settings {
  lang: string; tz: string; dateFmt: string; weekStart: string; currency: string;
  dark: boolean; prefNotifs: boolean; prefWeekly: boolean; prefShared: boolean;
}

export interface HouseholdState {
  familyName: string;
  members: Member[];
  events: EventItem[];
  aisles: Aisle[];
  shopLists: ShopList[];
  shop: ShopItem[];
  taskLists: TaskList[];
  tasks: TaskItem[];
  msgs: Message[];
  contacts: Contact[];
  folders: Folder[];
  files: FileItem[];
  bcats: BudgetCat[];
  tx: Transaction[];
  meals: Record<string, MealValue>;
  recipes: Recipe[];
  sched: SchedSlot[];
  notifs: Notif[];
  profile: Profile;
  settings: Settings;
}
