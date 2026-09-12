// Le planificateur des rappels : une fois par minute, calée sur la minute.
//
// Il lit le document, demande à reminders.ts ce qui est dû, et l'envoie. Il
// ne garde aucun état : le journal `hh_notif_sent` est la seule mémoire, ce
// qui rend un redémarrage sans conséquence (rien n'est renvoyé deux fois) et
// une longue coupure lisible (les rappels tombés pendant sont notés manqués).
import type { TaskItem } from '../tasks/ops';
import { PushPayload, SendReport, notify, recordMissed } from './push';
import { PrepList, PrepMember, QuietHours, ReminderHit, dueReminders, parisWall, preparationDue } from './reminders';

export interface SchedulerDeps {
  tasks: () => TaskItem[];
  /** Les listes du foyer : le planificateur n'y lit que les listes de préparation datées. */
  lists: () => PrepList[];
  /** Les membres du foyer, avec adulte/compte, pour choisir les destinataires d'un rappel de préparation. */
  members: () => PrepMember[];
  /** Les membres qui ont un compte : c'est à eux qu'une tâche sans responsable rappelle. */
  accounts: () => string[];
  /** Adresse ouverte au tap sur la notification. */
  url: () => string;
  /**
   * Les réglages du foyer au moment du passage. Relus à chaque minute : couper
   * les rappels avant de partir en vacances ne doit pas demander de redémarrer
   * le service.
   */
  rules: () => { paused: boolean; quiet: QuietHours };
  /** Ce membre veut-il ce genre de rappel sur son téléphone ? */
  wants: (memberId: string, kind: 'reminder' | 'assigned') => boolean;
  log: (line: string) => void;
}

const payloadOf = (h: ReminderHit, url: string): PushPayload =>
  ({ kind: 'reminder', title: h.title, body: h.body, url, taskId: h.taskId, tag: 'task-' + h.taskId });
const prepPayloadOf = (h: ReminderHit, url: string): PushPayload =>
  ({ kind: 'reminder', title: h.title, body: h.body, url, taskId: h.taskId, tag: 'prep-' + h.taskId });

/** Ce qu'un envoi a atteint, par membre, pour le journal (vide quand tout a été ignoré). */
const reached = (r: SendReport): string => r.members.filter((m) => m.status !== 'skipped')
  .map((m) => `${m.memberId} : ${m.status === 'sent' ? m.devices + ' appareil(s)' : m.status === 'no-device' ? 'aucun appareil abonné' : 'échec (' + m.error + ')'}`)
  .join(' ; ');

/** Un passage. Exporté pour les tests, et pour forcer un passage à la main. */
export async function tick(deps: SchedulerDeps, nowWall = parisWall()): Promise<void> {
  const { paused, quiet } = deps.rules();
  // Suspendu : on ne calcule rien et on ne note rien. À la reprise, les rappels
  // de la période ne sont pas rattrapés, et l'écran le dit avant de suspendre.
  if (paused) return;

  const { hits, missed } = dueReminders(deps.tasks(), deps.accounts(), nowWall, quiet);
  for (const h of missed) {
    const pour = h.memberIds.filter((m) => deps.wants(m, 'reminder'));
    if (!pour.length) continue;
    const n = recordMissed(h.key, pour, payloadOf(h, deps.url()));
    if (n) deps.log(`Notifications : rappel manqué pour « ${h.title} » (prévu ${h.fireAt.replace('T', ' ')}, service arrêté à ce moment-là).`);
  }
  for (const h of hits) {
    const pour = h.memberIds.filter((m) => deps.wants(m, 'reminder'));
    if (!pour.length) continue;
    const parts = reached(await notify(h.key, pour, payloadOf(h, deps.url())));
    if (parts) deps.log(`Notifications : rappel « ${h.title} » (${h.fireAt.replace('T', ' ')}) → ${parts}`);
  }
  // Rappels de préparation : un départ approche et il reste des affaires à préparer.
  for (const h of preparationDue(deps.lists(), deps.tasks(), deps.members(), nowWall)) {
    const pour = h.memberIds.filter((m) => deps.wants(m, 'reminder'));
    if (!pour.length) continue;
    const parts = reached(await notify(h.key, pour, prepPayloadOf(h, deps.url())));
    if (parts) deps.log(`Notifications : préparation « ${h.title} » (${h.fireAt.replace('T', ' ')}) → ${parts}`);
  }
}

/** Démarre la boucle. Rend de quoi l'arrêter. */
export function startScheduler(deps: SchedulerDeps): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const run = async (): Promise<void> => {
    try { await tick(deps); } catch (e) { deps.log('Notifications : passage du planificateur en erreur : ' + (e as Error).message); }
    if (!stopped) timer = setTimeout(run, 60_000 - (Date.now() % 60_000) + 500);
  };
  timer = setTimeout(run, 60_000 - (Date.now() % 60_000) + 500);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
