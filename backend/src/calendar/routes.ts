// Surface HTTP du calendrier, montée sous /api/calendar : vacances scolaires
// (relayées de data.education.gouv.fr, en cache), lien d'abonnement ICS et son
// flux public. Sortie de server.ts, elle réunit ce qui touche l'agenda partagé.
//
// Le routeur n'est PAS monté derrière `auth` : le flux `feed.ics` est public
// (un agenda externe le relit sans session, le jeton est le secret), pendant que
// les autres routes exigent une session. Chaque route porte donc sa propre garde,
// et server.ts ne passe que les gardes, l'enveloppe async et la temporisation.
import express, { Request, RequestHandler, Response, Router } from 'express';
import crypto from 'crypto';
import { HouseholdState } from '../models';
import { getIcsToken, getSchoolHolidaysCache, getStateByIcsToken, setIcsToken, setSchoolHolidaysCache } from '../db';
import { declOf, setting } from '../settings/registry';
import { buildIcs } from '../ics';
import { calendarFacts } from '../schedule';
import { DEADLINE_HORIZON_DAYS, deadlines as contractDeadlines } from '../finances/contracts';

interface SchoolHoliday { name: string; start: string; end: string; zone: string; }
const HOLIDAYS_TTL = 7 * 24 * 3600 * 1000;

async function fetchSchoolHolidays(academie: string): Promise<SchoolHoliday[]> {
  const where = encodeURIComponent(`location="${academie}"`);
  const url = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?where=${where}&limit=100&order_by=start_date`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = (await res.json()) as { results?: Record<string, string>[] };
  const seen = new Set<string>();
  const out: SchoolHoliday[] = [];
  for (const r of json.results || []) {
    const pop = (r['population'] || '').toLowerCase();
    if (pop && pop !== '-' && !pop.includes('lève') && !pop.includes('eleve')) continue; // pupils / unspecified only
    const name = r['description'] || 'Vacances';
    const start = (r['start_date'] || '').slice(0, 10);
    const end = (r['end_date'] || '').slice(0, 10);
    if (!start || !end) continue;
    const key = name + start + end;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, start, end, zone: r['zones'] || '' });
  }
  return out;
}

/** Ce que server.ts fournit : les gardes, l'enveloppe async et la temporisation du flux public. */
export interface CalendarDeps {
  auth: RequestHandler;
  requireMember: RequestHandler;
  requireAdmin: RequestHandler;
  icsLimiter: RequestHandler;
  route: (fn: (req: Request, res: Response) => Promise<void>) => RequestHandler;
}

export function calendarRouter(deps: CalendarDeps): Router {
  const { auth, requireMember, requireAdmin, icsLimiter, route } = deps;
  const r = express.Router();

  r.get('/school-holidays', auth, requireMember, route(async (req, res) => {
    const academie = String(req.query['academie'] || '').trim();
    if (!academie) { res.json({ holidays: [], academie: '' }); return; }
    // Le nom d'académie est interpolé dans la clause `where` de la requête
    // OpenDataSoft : on n'accepte donc que les valeurs de la liste fermée du
    // registre, jamais une chaîne libre venue du client.
    const known = (declOf('academie')?.options || []).some((o) => o.value && o.value === academie);
    if (!known) { res.status(400).json({ holidays: [], academie, error: 'Académie inconnue' }); return; }
    const cache = getSchoolHolidaysCache(academie);
    if (cache && Date.now() - cache.fetchedAt < HOLIDAYS_TTL) { res.json({ holidays: cache.data, academie, cached: true }); return; }
    try {
      const holidays = await fetchSchoolHolidays(academie);
      setSchoolHolidaysCache(academie, holidays, Date.now());
      res.json({ holidays, academie });
    } catch {
      if (cache) { res.json({ holidays: cache.data, academie, stale: true }); return; }
      res.json({ holidays: [], academie, error: 'Service de vacances scolaires indisponible' });
    }
  }));

  // Le jeton donne un accès permanent et SANS authentification à tout le
  // calendrier du foyer, horaires des enfants compris, et il survit à la
  // suppression du compte qui l'a lu. Le lire, comme le créer, est un geste
  // d'administration : c'est le canal d'exfiltration le plus discret de
  // l'application.
  r.get('/ics', auth, requireAdmin, (_req, res) => {
    let token = getIcsToken();
    if (!token) { token = crypto.randomBytes(18).toString('hex'); setIcsToken(token); }
    res.json({ token });
  });

  r.post('/ics/regenerate', auth, requireAdmin, (_req, res) => {
    const token = crypto.randomBytes(18).toString('hex');
    setIcsToken(token);
    res.json({ token });
  });

  // Public — consumed by external calendar apps (Google/Apple), so no auth; the token is the secret.
  // Un agenda relit ce flux quelques fois par heure ; personne n'a de raison d'en
  // demander cent. La limite ne rend pas le jeton devinable (144 bits, il ne
  // l'était pas), elle empêche d'en faire un robinet.
  r.get('/feed.ics', icsLimiter, (req: Request, res: Response) => {
    const token = String(req.query['token'] || '');
    const state = getStateByIcsToken(token) as HouseholdState | null;
    if (!state) { res.status(404).type('text/plain').send('Calendrier introuvable'); return; }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="foyer.ics"');
    const today = new Date().toISOString().slice(0, 10);
    // Le filtre scolaire/vacances des créneaux publiés a besoin des vacances de
    // l'académie du foyer : on les prend dans le cache (rempli par l'usage normal
    // de l'app), sans appel sortant dans un flux relu en boucle. Cache vide :
    // vacances inconnues, donc on affiche, comme à l'écran.
    const academie = setting('academie', state);
    const cache = academie ? getSchoolHolidaysCache(academie) : null;
    const schoolHolidays = (cache?.data as { start: string; end: string }[] | undefined) || [];
    res.send(buildIcs(state, contractDeadlines(today, DEADLINE_HORIZON_DAYS), calendarFacts(schoolHolidays), today));
  });

  return r;
}
