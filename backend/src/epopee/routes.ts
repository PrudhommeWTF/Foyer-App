// Surface HTTP du module « Épopée », montée sous /api/epopee derrière la
// session, `requireMember` et le drapeau `modEpopee`. Pas de jeton d'accès.
//
// Qui a le droit de quoi :
//   - un enfant lit **sa** besace, **son** journal et **ses** routines, et rien
//     d'autre ; il n'écrit qu'une chose : ses étapes du jour (faite, passée) et
//     ses pauses ;
//   - un adulte lit celles de tous les enfants, enrôle, retire, donne un bravo,
//     annule une écriture, et peut noter une étape à la place de l'enfant ;
//   - seul un membre marqué enfant s'enrôle.
import express, { Request, Response, Router } from 'express';
import { Member } from '../models';
import { log } from '../log';
import { AuthedRequest, currentMember } from '../auth/session';
import type { RoutineTpl } from './gabarit';
import { NOTE_MAX, STEP_STATUS, bravoEcus, dayAccepted } from './rules';
import * as repo from './repo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Le journal rendu à l'écran : les dernières écritures suffisent, le solde vient de toutes. */
const JOURNAL_MAX = 50;
/** Aujourd'hui, à l'heure du foyer. */
const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());

const me = (req: Request): Member => currentMember(req as AuthedRequest)!;
const handler = (fn: (req: Request, res: Response) => void) => (req: Request, res: Response): void => {
  try { fn(req, res); }
  catch (e) {
    log.erreur('Épopée : erreur inattendue', e);
    res.status(500).json({ error: 'Épopée : ' + (e as Error).message });
  }
};

export function epopeeRouter(members: () => Member[], gabarit: () => RoutineTpl[]): Router {
  const r = Router();
  const json = express.json({ limit: '16kb' });
  const nameOf = (id: string | null): string | null => (id ? members().find((m) => m.id === id)?.name ?? null : null);

  const summary = (m: Member) => {
    const p = repo.activeProfile(m.id);
    return { memberId: m.id, enrolled: !!p, floor: p?.floor ?? null, balance: p ? repo.balanceOf(m.id) : null, enrolledAt: p?.enrolled_at ?? null };
  };
  const entryView = (e: repo.LedgerRow, cancelled: Set<string>) => ({
    id: e.id, kind: e.kind, delta: e.delta, note: e.note, ref: e.ref, by: nameOf(e.by_member), at: e.at, cancelled: cancelled.has(e.id),
  });

  /** Les routines d'un enfant et où il en est ce jour-là. */
  const routinesView = (memberId: string, day: string) => {
    const marks = new Map(repo.marksOf(memberId, day).map((m) => [m.step_id, m.status]));
    return repo.routinesOf(memberId).map((r) => {
      const d = repo.routineDay(r.id, day);
      return {
        id: r.id, kind: r.kind, title: r.title, time: r.time, startedAt: d?.started_at ?? null, endedAt: d?.ended_at ?? null, pauses: d?.pauses ?? 0,
        steps: repo.stepsOf(r.id).map((s) => ({ id: s.id, title: s.title, hint: s.hint, icon: s.icon, seconds: s.seconds, ecus: s.ecus, status: marks.get(s.id) ?? null })),
      };
    });
  };
  /**
   * La routine que la session a le droit de dérouler : celle de l'enfant
   * lui-même, ou celle d'un enfant pour un adulte, et un enfant en cours
   * d'Épopée. Rend null après avoir répondu quand c'est refusé.
   */
  const runnable = (req: Request, res: Response, routineId: string | undefined): repo.RoutineRow | null => {
    const r = routineId ? repo.getRoutine(routineId) : null;
    if (!r) { res.status(404).json({ error: 'Routine introuvable.' }); return null; }
    if (me(req).enfant && r.member_id !== me(req).id) { res.status(403).json({ error: 'Cette routine n’est pas la tienne.' }); return null; }
    if (!repo.activeProfile(r.member_id)) { res.status(409).json({ error: 'Cet enfant n’est pas enrôlé dans l’Épopée.' }); return null; }
    return r;
  };
  /** Le jour annoncé par l'appareil (aujourd'hui par défaut), ou null après un 400. */
  const dayOf = (req: Request, res: Response): string | null => {
    const d = (req.body as { day?: unknown } | undefined)?.day ?? today();
    if (dayAccepted(d, today())) return d;
    res.status(400).json({ error: 'day : aujourd’hui ou hier seulement.' });
    return null;
  };

  /** L'enfant nommé par la route, que la session a le droit de lire, ou null après réponse. */
  const child = (req: Request, res: Response): Member | null => {
    const m = members().find((x) => x.id === String(req.params['id']));
    if (me(req).enfant && m?.id !== me(req).id) { res.status(403).json({ error: 'Tu ne peux voir que ta besace.' }); return null; }
    if (!m) { res.status(404).json({ error: 'Membre inconnu.' }); return null; }
    if (!m.enfant) { res.status(400).json({ error: 'L’Épopée est réservée aux enfants du foyer.' }); return null; }
    return m;
  };
  const adult = (req: Request, res: Response): boolean => {
    if (!me(req).enfant) return true;
    res.status(403).json({ error: 'Réservé aux adultes du foyer.' });
    return false;
  };
  /** Pour écrire : un adulte, et un enfant en cours d'Épopée. */
  const enrolled = (req: Request, res: Response): Member | null => {
    if (!adult(req, res)) return null;
    const m = child(req, res);
    if (m && !repo.activeProfile(m.id)) { res.status(409).json({ error: `${m.name} n’est pas enrôlé dans l’Épopée.` }); return null; }
    return m;
  };

  // Les enfants du foyer et leur besace : tous pour un adulte, soi pour un enfant.
  r.get('/membres', handler((req, res) => {
    res.json({ enfants: members().filter((m) => m.enfant && (!me(req).enfant || m.id === me(req).id)).map(summary) });
  }));

  r.get('/membres/:id', handler((req, res) => {
    const m = child(req, res); if (!m) return;
    const all = repo.activeProfile(m.id) ? repo.entriesOf(m.id) : [];
    const cancelled = new Set(all.map((e) => e.ref).filter((x): x is string => !!x));
    const day = today();
    res.json({ ...summary(m), day, routines: all.length ? routinesView(m.id, day) : [], journal: all.slice(0, JOURNAL_MAX).map((e) => entryView(e, cancelled)) });
  }));

  r.post('/membres/:id/enrolement', handler((req, res) => {
    if (!adult(req, res)) return;
    const m = child(req, res); if (!m) return;
    const was = repo.profileOf(m.id);
    const { created } = repo.enrol(m.id, me(req).id);
    if (created) repo.installGabarit(m.id, gabarit());
    if (created) log.info(`Épopée : ${m.name} enrôlé par ${me(req).name}, ${repo.balanceOf(m.id)} écus d’amorce.`);
    else if (was?.retired_at) log.info(`Épopée : ${m.name} réenrôlé par ${me(req).name}, besace retrouvée (${repo.balanceOf(m.id)} écus).`);
    res.status(created ? 201 : 200).json(summary(m));
  }));

  r.delete('/membres/:id/enrolement', handler((req, res) => {
    const m = enrolled(req, res); if (!m) return;
    repo.retire(m.id);
    log.info(`Épopée : ${m.name} retiré par ${me(req).name} (besace et journal conservés).`);
    res.json(summary(m));
  }));

  r.post('/membres/:id/bravos', json, handler((req, res) => {
    const m = enrolled(req, res); if (!m) return;
    const { id, ecus, note } = (req.body ?? {}) as { id?: unknown; ecus?: unknown; note?: unknown };
    const n = bravoEcus(ecus);
    if (typeof id !== 'string' || !UUID.test(id)) { res.status(400).json({ error: 'id : identifiant du geste attendu (uuid).' }); return; }
    if (n === null) { res.status(400).json({ error: 'ecus : un bravo vaut 1, 2 ou 3 écus.' }); return; }
    if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > NOTE_MAX)) { res.status(400).json({ error: `note : texte d’au plus ${NOTE_MAX} caractères attendu.` }); return; }
    const done = repo.bravo(id.toLowerCase(), m.id, n, (note as string | null | undefined)?.trim() || null, me(req).id);
    if (!done) { res.status(409).json({ error: 'Cet identifiant a déjà servi à autre chose.' }); return; }
    if (!done.duplicate) log.info(`Épopée : bravo de ${me(req).name} à ${m.name}, +${n} écu${n > 1 ? 's' : ''}${done.entry.note ? ` (« ${done.entry.note} »)` : ''}.`);
    res.status(done.duplicate ? 200 : 201).json({ duplicate: done.duplicate, entry: entryView(done.entry, new Set()), balance: repo.balanceOf(m.id) });
  }));

  // Les routines du gabarit, pour un enfant enrôlé avant qu'elles n'existent.
  r.post('/membres/:id/routines/gabarit', handler((req, res) => {
    const m = enrolled(req, res); if (!m) return;
    const n = repo.installGabarit(m.id, gabarit());
    if (n) log.info(`Épopée : ${n} routine${n > 1 ? 's' : ''} du gabarit posée${n > 1 ? 's' : ''} pour ${m.name} par ${me(req).name}.`);
    res.status(n ? 201 : 200).json({ routines: routinesView(m.id, today()) });
  }));

  // Une étape du jour : faite (son écu est versé, une seule fois) ou passée.
  r.post('/etapes/:id', json, handler((req, res) => {
    const step = repo.getStep(String(req.params['id']));
    const routine = runnable(req, res, step?.routine_id); if (!routine || !step) return;
    const status = STEP_STATUS.find((x) => x === (req.body as { status?: unknown } | undefined)?.status);
    if (!status) { res.status(400).json({ error: 'status : « fait » ou « saute ».' }); return; }
    const day = dayOf(req, res); if (!day) return;
    const out = repo.markStep(step, routine, day, status, me(req).id);
    const who = nameOf(routine.member_id) ?? 'un enfant';
    if (!out.duplicate) log.info(`Épopée : ${who}, « ${step.title} » ${status === 'fait' ? `fait, +${out.ecus} écu${out.ecus > 1 ? 's' : ''}` : 'passé'}${me(req).id !== routine.member_id ? ` (noté par ${me(req).name})` : ''}.`);
    if (!out.duplicate && out.routineDone) log.info(`Épopée : ${who} est allé au bout de « ${routine.title} ».`);
    res.status(out.duplicate ? 200 : 201).json({ ...out, balance: repo.balanceOf(routine.member_id) });
  }));

  // Une pause « grain de sable » : comptée, jamais pénalisée.
  r.post('/routines/:id/pauses', json, handler((req, res) => {
    const routine = runnable(req, res, String(req.params['id'])); if (!routine) return;
    const day = dayOf(req, res); if (!day) return;
    res.status(201).json({ pauses: repo.addPause(routine, day) });
  }));

  r.post('/journal/:id/annulation', handler((req, res) => {
    if (!adult(req, res)) return;
    const e = repo.getEntry(String(req.params['id']));
    if (!e) { res.status(404).json({ error: 'Écriture introuvable.' }); return; }
    const out = repo.cancel(e, me(req).id);
    if ('refusal' in out) { res.status(409).json({ error: out.refusal }); return; }
    log.info(`Épopée : ${me(req).name} annule une écriture de ${nameOf(e.member_id) ?? 'un membre parti'} (${out.entry.delta} écu${Math.abs(out.entry.delta) > 1 ? 's' : ''}).`);
    res.status(201).json({ entry: entryView(out.entry, new Set()), balance: repo.balanceOf(e.member_id) });
  }));

  return r;
}
