// Ce qui se passe dans l'Épopée et qu'un parent veut savoir tout de suite : un
// enfant signale un exploit, vise un trésor, ou vient de le gagner. Les routes
// émettent, le serveur décide qui prévenir (voir server.ts) ; ici, la forme de
// l'événement et les mots de la notification, purs.
//
// Ces trois moments attendent une réponse d'adulte. Rien d'autre ne notifie :
// une étape faite ou un bravo donné n'appellent personne.

export type EpopeeEvent =
  /** Un exploit signalé : il attend « Valider » ou « Pas tout à fait ». */
  | { kind: 'exploit'; id: string; childId: string; child: string; actorId: string; title: string; ecus: number }
  /** Un trésor choisi par l'enfant : il attend que le pacte soit scellé. */
  | { kind: 'quete'; id: string; childId: string; child: string; actorId: string; title: string; cost: number }
  /** Un trésor gagné : les écus sont échangés, il reste à vivre le moment. */
  | { kind: 'tresor'; id: string; childId: string; child: string; actorId: string; title: string; date: string | null };

export interface EventMessage { key: string; title: string; body: string; tag: string; }

const frDay = (day: string): string => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(day + 'T12:00:00Z'));

/**
 * La notification d'un événement. La clé porte l'objet (la demande, la quête) :
 * le même événement ne prévient qu'une fois. Le tag regroupe par enfant, et
 * mène à l'écran Épopée au tap (« epopee-<membre> », voir sw.js).
 */
export function eventMessage(e: EpopeeEvent): EventMessage {
  const base = { key: `epopee|${e.kind}|${e.id}`, tag: 'epopee-' + e.childId };
  if (e.kind === 'exploit') return { ...base, title: `${e.child} signale un exploit`, body: `« ${e.title} », +${e.ecus} écu${e.ecus > 1 ? 's' : ''} si vous validez.` };
  if (e.kind === 'quete') return { ...base, title: `${e.child} vise un trésor`, body: `« ${e.title} », ${e.cost} écus. Il reste à sceller le pacte ensemble.` };
  return { ...base, title: `${e.child} a gagné son trésor`, body: `« ${e.title} » : à vous de tenir le pacte${e.date ? `, prévu ${frDay(e.date)}` : ''}.` };
}

/**
 * Qui prévenir : les adultes qui ont un compte et qui le veulent, sauf celui
 * qui vient de faire le geste (un parent qui échange pour son enfant le sait).
 */
export function recipients(e: EpopeeEvent, adults: string[], wants: (memberId: string) => boolean): string[] {
  return adults.filter((m) => m !== e.actorId && wants(m));
}

type Hook = (e: EpopeeEvent) => void;
let hook: Hook | null = null;
/** Le serveur s'abonne ici ; sans abonné (tests, push non initialisé), émettre ne fait rien. */
export function onEpopeeEvent(fn: Hook | null): void { hook = fn; }
/** Émet un événement. Une panne de l'abonné ne fait jamais échouer le geste de l'enfant. */
export function emit(e: EpopeeEvent): void {
  try { hook?.(e); } catch { /* the gesture itself succeeded: the notification is a courtesy */ }
}
