// Le fil d'activité de l'accueil : « ce qui a récemment changé » dans le foyer.
//
// Il ne se dérive que des mutations réellement horodatées et attribuées :
// tâches (création via `at`/`by`, achèvement via `doneAt`/`doneBy` ou l'historique
// d'une tâche récurrente), articles de courses (`at`/`by`, l'état donnant le
// verbe), et messages de la messagerie (`at`/`who`). Les événements, contacts et
// recettes ne portent ni date de changement ni auteur : les faire figurer ici
// serait inventer une ligne, pas la refléter.
import { HouseholdState } from './models';

/** Au-delà, un message tronqué : une ligne du fil, pas un pavé. */
const MSG_MAX = 120;

export interface ActivityEntry {
  /** Instant du changement, ISO complet : c'est la clé de tri. */
  at: string;
  /** Auteur (identifiant de membre), ou null si le geste n'en portait pas. */
  by: string | null;
  /** « a ajouté », « a terminé », « a mis au panier »... */
  verb: string;
  /** Ce qui a changé : l'intitulé de la tâche ou de l'article. */
  what: string;
  /** La liste d'origine, pour situer d'un coup d'oeil. */
  where: string;
  /** Couleur de cette liste, comme accent. */
  color: string;
}

const SHOP_VERB: Record<string, string> = {
  'a-prendre': 'a ajouté aux courses',
  panier: 'a mis au panier',
  indisponible: 'a noté indisponible',
};

/**
 * Les `limit` changements les plus récents, du plus récent au plus ancien. Une
 * tâche récurrente laisse une ligne par achèvement (son historique), parce que
 * « sortir les poubelles » chaque semaine est bien une activité chaque semaine.
 */
export function recentActivity(state: HouseholdState, limit = 12): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const tList = (id: string) => (state.taskLists || []).find((l) => l.id === id);
  for (const t of state.tasks || []) {
    const l = tList(t.listId);
    const where = l?.name || 'Tâches';
    const color = l?.color || '#7A9B76';
    if (t.at) out.push({ at: t.at, by: t.by ?? null, verb: 'a ajouté', what: t.text, where, color });
    if (t.history?.length) {
      for (const h of t.history) if (h.at) out.push({ at: h.at, by: h.by, verb: 'a terminé', what: t.text, where, color });
    } else if (t.done && t.doneAt) {
      out.push({ at: t.doneAt, by: t.doneBy ?? null, verb: 'a terminé', what: t.text, where, color });
    }
  }
  const sList = (id: string) => (state.shopLists || []).find((l) => l.id === id);
  for (const s of state.shop || []) {
    if (!s.at) continue;
    const l = sList(s.listId);
    out.push({ at: s.at, by: s.by ?? null, verb: SHOP_VERB[s.state] || 'a modifié', what: s.name, where: l?.name || 'Courses', color: l?.color || '#4E93B8' });
  }
  // Les messages : seuls ceux qui portent un horodatage complet. Les anciens
  // n'avaient que l'heure (HH:MM), inclassables dans un fil sur plusieurs jours.
  for (const m of state.msgs || []) {
    if (!m.at) continue;
    const what = m.text.length > MSG_MAX ? m.text.slice(0, MSG_MAX).trimEnd() + '…' : m.text;
    out.push({ at: m.at, by: m.who || null, verb: 'a écrit', what, where: 'Messagerie', color: '#4E93B8' });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** « à l'instant », « il y a 3 min », « hier », puis une date courte au-delà d'un mois. */
export function relTime(iso: string, nowMs: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return 'à l’instant';
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j === 1) return 'hier';
  if (j < 7) return `il y a ${j} j`;
  const sem = Math.floor(j / 7);
  if (sem < 5) return `il y a ${sem} sem`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
