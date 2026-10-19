// La ligne du journal des sessions d'enfant, telle que Paramètres → Membres
// l'affiche sous la fiche de l'enfant : « Session ouverte par Nolwenn le 19/10
// à 18 h 42 sur iPad », puis son état. Pur, pour être vérifié sans navigateur.
import type { SwitchEntry } from './api.service';

const FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/** « le 19/10 à 18 h 42 », à l'heure de Paris quel que soit le fuseau de l'appareil. */
export function quand(iso: string): string {
  const parts = Object.fromEntries(FMT.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `le ${parts['day']}/${parts['month']} à ${parts['hour']} h ${parts['minute']}`;
}

/** La première ligne : qui a ouvert la session, quand, et sur quel appareil. */
export const switchLine = (e: SwitchEntry): string => `Session ouverte par ${e.byName} ${quand(e.startedAt)} sur ${e.device}`;

/** La seconde : encore ouverte, ou comment elle s'est refermée. `nameOf` nomme le membre qui l'a fermée. */
export function switchState(e: SwitchEntry, nameOf: (id: string | null) => string): string {
  if (e.open) return 'Toujours ouverte';
  if (!e.endedAt) return 'Session expirée';
  switch (e.endReason) {
    case 'retour': return `Refermée ${quand(e.endedAt)} : retour de ${nameOf(e.endedBy)}`;
    case 'deconnexion': return `Refermée ${quand(e.endedAt)} : déconnexion`;
    case 'fermee': return `Fermée à distance par ${nameOf(e.endedBy)} ${quand(e.endedAt)}`;
    default: return `Refermée ${quand(e.endedAt)}`;
  }
}
