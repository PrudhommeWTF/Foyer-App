// Flux ICS du calendrier partagé.
//
// Extrait de server.ts pour être testable : un fichier ICS n'est relu par
// personne, seulement par des agendas qui refusent en silence ce qu'ils ne
// comprennent pas. Les lignes se terminent par CRLF, comme l'exige la RFC 5545.
import { HouseholdState } from './seed';
import { Deadline } from './finances/contracts';

const pad2 = (n: number): string => String(n).padStart(2, '0');
const icsDate = (ds: string): string => ds.replace(/-/g, '');
function icsAddDay(ds: string): string {
  const d = new Date(ds + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}
const icsEsc = (s: string): string => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsRrule(recur: string): string {
  switch (recur) {
    case 'daily': return 'FREQ=DAILY';
    case 'weekday': return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly': return 'FREQ=WEEKLY';
    case 'monthly': return 'FREQ=MONTHLY';
    default: return '';
  }
}
const DEADLINE_SUMMARY: Record<string, string> = {
  preavis: 'Dernier jour pour résilier',
  renouvellement: 'Reconduction tacite',
  fin: 'Fin de contrat',
};
// Tournures construites pour rester correctes quel que soit le nom du contrat :
// « de Assurance habitation » n'est pas du français, et l'élision ne peut pas se
// deviner à partir d'un nom saisi librement.
const DEADLINE_DETAIL: Record<string, string> = {
  preavis: 'Passé ce jour, le contrat est reconduit automatiquement.',
  renouvellement: 'Reconduction automatique du contrat.',
  fin: 'Le contrat prend fin.',
};

/**
 * Le module met en forme, il n'interroge rien : les échéances lui sont passées.
 * C'est ce qui permet de le tester sans base et de garder la requête là où elle
 * a un sens.
 */
export function buildIcs(state: HouseholdState, deadlines: Deadline[] = []): string {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').slice(0, 15) + 'Z';
  const mname = (id: string): string => state.members.find((m) => m.id === id)?.name || '';
  const L: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Foyer//Calendrier//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(state.familyName)}`];
  for (const ev of state.events) {
    const allDay = !ev.time || ev.time === '—';
    L.push('BEGIN:VEVENT', `UID:${ev.id}@foyer`, `DTSTAMP:${dtstamp}`);
    if (allDay) {
      L.push(`DTSTART;VALUE=DATE:${icsDate(ev.date)}`);
      L.push(`DTEND;VALUE=DATE:${icsAddDay(ev.end && ev.end !== ev.date ? ev.end : ev.date)}`);
    } else {
      const [hh, mm] = ev.time.split(':');
      L.push(`DTSTART:${icsDate(ev.date)}T${pad2(+hh)}${pad2(+mm)}00`);
      if (ev.end && ev.end !== ev.date) L.push(`DTEND:${icsDate(ev.end)}T${pad2(+hh)}${pad2(+mm)}00`);
      else L.push(`DTEND:${icsDate(ev.date)}T${pad2(Math.min(+hh + 1, 23))}${pad2(+mm)}00`);
    }
    const rr = icsRrule(ev.recur);
    if (rr) L.push(`RRULE:${rr}`);
    L.push(`SUMMARY:${icsEsc(ev.title)}`);
    const who = mname(ev.who);
    if (who) L.push(`DESCRIPTION:${icsEsc(who)}`);
    L.push('END:VEVENT');
  }

  // Les échéances de contrat ne sont pas stockées comme événements : elles sont
  // dérivées à la lecture, ici comme à l'écran. Un UID stable par contrat et par
  // type fait que l'agenda **déplace** l'entrée quand la date bouge, au lieu
  // d'en accumuler une par reconduction.
  for (const d of deadlines) {
    L.push('BEGIN:VEVENT', `UID:fin-${d.kind}-${d.contractId}@foyer`, `DTSTAMP:${dtstamp}`);
    L.push(`DTSTART;VALUE=DATE:${icsDate(d.date)}`);
    L.push(`DTEND;VALUE=DATE:${icsAddDay(d.date)}`);
    L.push(`SUMMARY:${icsEsc(DEADLINE_SUMMARY[d.kind] + ' : ' + d.contractName)}`);
    const detail = d.provider ? `${d.contractName} (${d.provider}).` : `${d.contractName}.`;
    L.push(`DESCRIPTION:${icsEsc(DEADLINE_DETAIL[d.kind] + ' ' + detail)}`);
    // Seule la date limite de résiliation coûte de l'argent si elle passe : elle
    // seule mérite qu'un agenda réveille quelqu'un une semaine avant.
    if (d.kind === 'preavis') {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P7D',
        `DESCRIPTION:${icsEsc('Dernière semaine pour résilier : ' + detail)}`, 'END:VALARM');
    }
    L.push('END:VEVENT');
  }

  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

