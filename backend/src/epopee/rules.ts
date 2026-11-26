// Les règles de l'Épopée, pures : ni base, ni horloge. Le serveur les applique
// avant chaque écriture, l'appareil ne décide d'aucun montant.

/** Les écus d'amorce : la besace ne commence jamais vide, et ce plancher ne se retire pas. */
export const AMORCE = 5;
/** Un bravo spontané vaut de 1 à 3 écus : un encouragement, pas un salaire. */
export const BRAVO_MAX = 3;
export const NOTE_MAX = 120;

export const KINDS = ['amorce', 'bravo', 'etape', 'exploit', 'echange', 'annulation'] as const;
export type Kind = typeof KINDS[number];
export interface Entry { id: string; kind: Kind; delta: number; ref: string | null; }

export const balance = (entries: Entry[]): number => entries.reduce((s, e) => s + e.delta, 0);

/** Les écus d'un bravo, ou null si la valeur n'en est pas une. */
export const bravoEcus = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= BRAVO_MAX ? v : null);

/**
 * Pourquoi cette écriture ne s'annule pas, ou null si elle s'annule. L'amorce
 * est acquise, une annulation ne s'annule pas, une écriture ne s'annule qu'une
 * fois, et reprendre des écus ne fait jamais passer la besace sous son plancher.
 */
export function cancelRefusal(entry: Entry, entries: Entry[], floor: number): string | null {
  if (entry.kind === 'amorce') return 'Les écus d’amorce sont acquis : ils ne se reprennent pas.';
  if (entry.kind === 'annulation') return 'Une annulation ne s’annule pas.';
  if (entry.kind === 'echange') return 'Un trésor échangé ne se reprend pas : le pacte est scellé.';
  if (entries.some((e) => e.ref === entry.id)) return 'Cette écriture est déjà annulée.';
  if (balance(entries) - entry.delta < floor) return 'Ces écus ont déjà servi : les reprendre ferait passer la besace sous son plancher.';
  return null;
}

/** Le moment d'une routine : il décide de son pictogramme et de l'ambiance de son déroulé (le soir est sombre). */
export const ROUTINE_KINDS = ['matin', 'journee', 'soir'] as const;
export type RoutineKind = typeof ROUTINE_KINDS[number];
/** Une étape est faite, ou passée (un jour sans : ni écu, ni reproche). */
export const STEP_STATUS = ['fait', 'saute'] as const;
export type StepStatus = typeof STEP_STATUS[number];

/** La veille d'un jour 'AAAA-MM-JJ'. */
export const dayBefore = (day: string): string => new Date(Date.parse(day + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
/**
 * Le jour qu'un appareil annonce pour une étape : aujourd'hui, ou hier (une
 * tablette restée sans réseau la nuit envoie le lendemain). Jamais plus loin,
 * jamais demain : une étape ne se rattrape pas, et ne se prend pas d'avance.
 */
export const dayAccepted = (day: unknown, today: string): day is string => day === today || day === dayBefore(today);

/** L'identifiant de l'écriture d'une étape : un par étape et par jour, d'où un seul crédit quoi qu'il arrive. */
export const stepEntryId = (stepId: string, day: string): string => `etape:${stepId}:${day}`;

/** Comment la besace se montre à l'enfant : le nombre et les pièces, ou les pièces seules (avant la lecture des nombres). */
export const DISPLAYS = ['nombre', 'pieces'] as const;
export type Display = typeof DISPLAYS[number];

/** Un exploit convenu vaut de 1 à 3 écus, une étape de 0 à 3 : jamais de gros lot. */
export const EXPLOIT_ECUS_MAX = 3;
export const STEPS_MAX = 12;
export interface StepInput { id: string | null; title: string; hint: string; icon: string; seconds: number; ecus: number; }

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);
const whole = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** Le titre et les écus d'un exploit, ou la raison du refus. */
export function exploitInput(raw: { title?: unknown; ecus?: unknown }): { title: string; ecus: number } | string {
  const title = text(raw.title, 60), ecus = whole(raw.ecus, 1, EXPLOIT_ECUS_MAX);
  if (!title) return 'title : un titre d’au plus 60 caractères.';
  if (ecus === null) return `ecus : de 1 à ${EXPLOIT_ECUS_MAX}.`;
  return { title, ecus };
}

/** Les étapes d'une routine telles qu'un parent les a réglées, ou la raison du refus (la première rencontrée). */
export function stepsInput(raw: unknown): StepInput[] | string {
  if (!Array.isArray(raw) || !raw.length || raw.length > STEPS_MAX) return `steps : de 1 à ${STEPS_MAX} étapes.`;
  const out: StepInput[] = [];
  for (const [i, s] of (raw as Record<string, unknown>[]).entries()) {
    const title = text(s?.['title'], 60), seconds = whole(s?.['seconds'], 10, 3600), ecus = whole(s?.['ecus'], 0, 3);
    const icon = typeof s?.['icon'] === 'string' && /^[a-zA-Z]{1,30}$/.test(s['icon']) ? s['icon'] : null;
    const hint = s?.['hint'] === undefined || s?.['hint'] === null || s?.['hint'] === '' ? '' : text(s['hint'], 120);
    const id = s?.['id'] === undefined || s?.['id'] === null ? null : text(s['id'], 60);
    if (!title) return `Étape ${i + 1} : un titre d’au plus 60 caractères.`;
    if (hint === null) return `Étape ${i + 1} : une phrase d’au plus 120 caractères.`;
    if (!icon) return `Étape ${i + 1} : un pictogramme.`;
    if (seconds === null) return `Étape ${i + 1} : une durée de 10 secondes à une heure.`;
    if (ecus === null) return `Étape ${i + 1} : de 0 à 3 écus.`;
    if (s?.['id'] !== undefined && s?.['id'] !== null && !id) return `Étape ${i + 1} : identifiant illisible.`;
    if (id && out.some((x) => x.id === id)) return `Étape ${i + 1} : étape citée deux fois.`;
    out.push({ id, title, hint, icon, seconds, ecus });
  }
  return out;
}
export const timeInput = (v: unknown): string | null => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);

// ---- Armurerie : récompenses et quêtes ----

/** À deux (un moment partagé), un privilège, un petit plaisir. */
export const REWARD_CATEGORIES = ['duo', 'privilege', 'petit'] as const;
export type RewardCategory = typeof REWARD_CATEGORIES[number];
/** Un trésor coûte au moins deux fois l'amorce : la besace d'amorce seule n'achète rien. */
export const REWARD_COST_MIN = 2 * AMORCE;
export const REWARD_COST_MAX = 300;
/**
 * La vie d'une quête : proposée (un trésor choisi, un parent n'a pas encore
 * répondu), active (pacte scellé), atteinte (écus échangés, le moment reste à
 * vivre), honorée (vécu, rangé aux souvenirs), abandonnée (rien n'est retiré).
 */
export const QUEST_STATUS = ['proposee', 'active', 'atteinte', 'honoree', 'abandonnee'] as const;
export type QuestStatus = typeof QUEST_STATUS[number];

export interface RewardInput { title: string; description: string; cost: number; category: RewardCategory; }
/** Une récompense telle qu'un parent l'a saisie, ou la raison du refus. */
export function rewardInput(raw: Record<string, unknown>): RewardInput | string {
  const title = text(raw['title'], 60), cost = whole(raw['cost'], REWARD_COST_MIN, REWARD_COST_MAX);
  const description = raw['description'] === undefined || raw['description'] === null || raw['description'] === '' ? '' : text(raw['description'], 160);
  const category = REWARD_CATEGORIES.find((c) => c === raw['category']);
  if (!title) return 'title : un titre d’au plus 60 caractères.';
  if (description === null) return 'description : 160 caractères au plus.';
  if (cost === null) return `cost : de ${REWARD_COST_MIN} à ${REWARD_COST_MAX} écus.`;
  if (!category) return 'category : « duo », « privilege » ou « petit ».';
  return { title, description, cost, category };
}
/** Un texte libre facultatif (pacte, souvenir) : '' s'il est absent, null s'il est trop long ou n'est pas un texte. */
export const optionalText = (v: unknown, max: number): string | null => (v === undefined || v === null || v === '' ? '' : text(v, max) ?? (typeof v === 'string' && !v.trim() ? '' : null));
export const dateInput = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z')) ? v : null);

/**
 * Ce qu'il faut verser à la besace quand un pacte est scellé pour qu'une quête
 * ne commence jamais sous l'amorce. Zéro le plus souvent : seulement après un
 * échange qui a vidé la besace.
 */
export const pactTopUp = (bal: number, floor: number): number => Math.max(0, floor - bal);
/** Les écus manquent-ils encore pour ce trésor ? Un échange dépense le coût entier ; le plancher ne protège que des retraits. */
export const canExchange = (bal: number, cost: number): boolean => bal >= cost;
export const exchangeEntryId = (questId: string): string => `echange:${questId}`;

/** Un enfant garde ses routines lisibles d'un coup d'œil : pas plus que cela. */
export const ROUTINES_MAX = 6;
/**
 * Le moment d'une routine, d'après son heure : le matin avant midi, le soir à
 * partir de 18 h, la journée entre les deux (le retour de l'école, les devoirs).
 * Il se déduit, il ne se choisit pas : déplacer une routine change son ambiance.
 */
export const kindOf = (time: string): RoutineKind => (time < '12:00' ? 'matin' : time < '18:00' ? 'journee' : 'soir');
/** Le titre d'une routine, ou null s'il manque ou dépasse 60 caractères. */
export const titleInput = (v: unknown): string | null => text(v, 60);
