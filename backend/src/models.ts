// Household domain model (backend). Mirrors the frontend models; new optional
// fields (planned/birthday/academie) are additive and backward-compatible.
import type { ShopItem } from './shopping/ops';

export interface Member { id: string; name: string; role: string; color: string; ini: string; admin?: boolean; email?: string; birthday?: string | null; }
export interface EventItem { id: string; date: string; time: string; title: string; who: string; recur: string; end?: string | null; }
export interface Aisle { id: string; name: string; color: string; position: number; }
export interface ShopList { id: string; name: string; color: string; icon: string; }
// La forme d'un article et celle de ses mutations vivent avec le moteur qui les
// écrit réellement, article par article (voir shopping/ops.ts).
export type { ShopItem, ShopState } from './shopping/ops';
export interface TaskList { id: string; name: string; color: string; icon: string; }
export interface TaskItem { id: string; text: string; who: string; due: string; done: boolean; listId: string; prio: string; planned?: string | null; }
export interface Message { who: string; text: string; time: string; }
export interface Contact { id: string; name: string; role: string; phone: string; email: string; cat: string; color: string; urgent: boolean; birthday?: string | null; }
export interface Folder { id: string; name: string; color: string; }
export interface FileItem { id: string; name: string; folderId: string; type: string; date: string; data?: string | null; }
export interface MealValue { rid?: string; text?: string; }
// `photoId` désigne une ligne de hh_attachments : les octets ne sont plus dans
// le document, qui repartait en entier à chaque enregistrement.
export interface Recipe { id: string; name: string; time: string; level: string; color: string; photoId?: number | null; ingr: string[]; steps: string[]; }
export interface SchedSlot { id: string; who: string; day: string; start: string; end: string; label: string; k: string; }
export interface Profile { name: string; role: string; email: string; phone: string; color: string; memberId: string; }
export interface Settings {
  dateFmt: string;
  dark: boolean; prefNotifs: boolean;
  academie?: string;
  /** Show the breakfast row in the meal planner. Off by default: rarely planned. */
  showBreakfast?: boolean;
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
  meals: Record<string, MealValue>;
  recipes: Recipe[];
  sched: SchedSlot[];
  profile: Profile;
  settings: Settings;
}
