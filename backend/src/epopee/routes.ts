// Surface HTTP du module « Épopée », montée sous /api/epopee derrière la
// session, `requireMember` et le drapeau `modEpopee`. Pas de jeton d'accès.
//
// Qui a le droit de quoi :
//   - un enfant lit **sa** besace et **son** journal, et rien d'autre ; il
//     n'écrit rien ici ;
//   - un adulte lit celles de tous les enfants, enrôle, retire, donne un bravo
//     et annule une écriture ;
//   - seul un membre marqué enfant s'enrôle.
import express, { Request, Response, Router } from 'express';
import { Member } from '../models';
import { log } from '../log';
import { AuthedRequest, currentMember } from '../auth/session';
import { NOTE_MAX, bravoEcus } from './rules';
import * as repo from './repo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Le journal rendu à l'écran : les dernières écritures suffisent, le solde vient de toutes. */
const JOURNAL_MAX = 50;

const me = (req: Request): Member => currentMember(req as AuthedRequest)!;
const handler = (fn: (req: Request, res: Response) => void) => (req: Request, res: Response): void => {
  try { fn(req, res); }
  catch (e) {
    log.erreur('Épopée : erreur inattendue', e);
    res.status(500).json({ error: 'Épopée : ' + (e as Error).message });
  }
};

export function epopeeRouter(members: () => Member[]): Router {
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
    res.json({ ...summary(m), journal: all.slice(0, JOURNAL_MAX).map((e) => entryView(e, cancelled)) });
  }));

  r.post('/membres/:id/enrolement', handler((req, res) => {
    if (!adult(req, res)) return;
    const m = child(req, res); if (!m) return;
    const was = repo.profileOf(m.id);
    const { created } = repo.enrol(m.id, me(req).id);
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

  r.post('/journal/:id/annulation', handler((req, res) => {
    if (!adult(req, res)) return;
    const id = String(req.params['id']).toLowerCase();
    const e = UUID.test(id) ? repo.getEntry(id) : null;
    if (!e) { res.status(404).json({ error: 'Écriture introuvable.' }); return; }
    const out = repo.cancel(e, me(req).id);
    if ('refusal' in out) { res.status(409).json({ error: out.refusal }); return; }
    log.info(`Épopée : ${me(req).name} annule une écriture de ${nameOf(e.member_id) ?? 'un membre parti'} (${out.entry.delta} écu${Math.abs(out.entry.delta) > 1 ? 's' : ''}).`);
    res.status(201).json({ entry: entryView(out.entry, new Set()), balance: repo.balanceOf(e.member_id) });
  }));

  return r;
}
