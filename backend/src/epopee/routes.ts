// Surface HTTP du module « Épopée », montée sous /api/epopee derrière la
// session, `requireMember` et le drapeau `modEpopee`. Pas de jeton d'accès.
//
// Qui a le droit de quoi :
//   - un enfant lit **sa** besace, **son** journal, **ses** routines et les
//     exploits convenus, et rien d'autre ; il n'écrit que ses étapes du jour
//     (faite, passée), ses pauses, et le signalement d'un exploit ;
//   - un adulte lit celles de tous les enfants, enrôle, retire, règle (affichage,
//     routines, exploits), donne un bravo, crédite un exploit, tranche une
//     demande, annule une écriture, et peut noter une étape à la place de l'enfant ;
//   - Armurerie : un enfant choisit un trésor (une quête proposée), y renonce
//     tant qu'elle n'est pas scellée, et échange ses écus quand il en a assez ;
//     un adulte tient le catalogue, scelle le pacte, abandonne une quête, et
//     note le moment vécu ;
//   - le bilan de la semaine et les notes du conseil de famille sont aux adultes ;
//   - seul un membre marqué enfant s'enrôle.
import express, { Request, Response, Router } from 'express';
import { Member } from '../models';
import { log } from '../log';
import { AuthedRequest, currentMember } from '../auth/session';
import { contentDisposition } from '../headers';
import * as files from '../storage/files';
import { checkUpload } from '../storage/upload-check';
import { addDays, mondayOf, periodLabel } from '../revisions/bilan';
import { RITUEL, computeBilan, councilPdf, lines } from './bilan';
import { emit } from './events';
import type { Gabarit } from './gabarit';
import { DISPLAYS, NOTE_MAX, ROUTINES_MAX, STEP_STATUS, bravoEcus, dateInput, dayAccepted, exploitInput, optionalText, rewardInput, stepsInput, timeInput, titleInput } from './rules';
import * as repo from './repo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Le journal rendu à l'écran : les dernières écritures suffisent, le solde vient de toutes. */
const JOURNAL_MAX = 50;
const MEMORIES_MAX = 30;
/** Une photo réduite par l'application pèse quelques centaines de kilo-octets ; au-delà, ce n'en est pas une. */
const MAX_PHOTO = '8mb';
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

export function epopeeRouter(members: () => Member[], gabarit: () => Gabarit): Router {
  const r = Router();
  const json = express.json({ limit: '16kb' });
  const nameOf = (id: string | null): string | null => (id ? members().find((m) => m.id === id)?.name ?? null : null);

  const summary = (m: Member) => {
    const p = repo.activeProfile(m.id);
    return { memberId: m.id, enrolled: !!p, floor: p?.floor ?? null, balance: p ? repo.balanceOf(m.id) : null, enrolledAt: p?.enrolled_at ?? null, display: p?.display ?? null, timer: p ? !!p.timer : null, swornAt: p?.sworn_at ?? null, swornBy: nameOf(p?.sworn_by ?? null) };
  };
  const entryView = (e: repo.LedgerRow, cancelled: Set<string>) => ({
    id: e.id, kind: e.kind, delta: e.delta, note: e.note, ref: e.ref, by: nameOf(e.by_member), at: e.at, cancelled: cancelled.has(e.id),
  });

  const exploitView = (e: repo.ExploitRow) => ({ id: e.id, title: e.title, ecus: e.ecus });
  /** Les demandes d'un enfant : celles qui attendent, et celles tranchées aujourd'hui. */
  const requestsView = (memberId: string, day: string) => repo.requestsOf(memberId, day).map((q) => {
    const e = repo.getExploit(q.exploit_id);
    return { id: q.id, exploitId: q.exploit_id, title: e?.title ?? '', ecus: e?.ecus ?? 0, status: q.status, createdAt: q.created_at, decidedBy: nameOf(q.decided_by) };
  });
  const rewardView = (r: repo.RewardRow) => ({ id: r.id, title: r.title, description: r.description, cost: r.cost, category: r.category });
  const questView = (q: repo.QuestRow) => ({
    id: q.id, rewardId: q.reward_id, title: q.title, cost: q.cost, status: q.status, proposedBy: nameOf(q.proposed_by), createdAt: q.created_at,
    pact: q.sealed_at ? { date: q.pact_date, items: q.pact_items, rule: q.pact_rule, note: q.pact_note, by: nameOf(q.sealed_by) } : null,
    reachedAt: q.reached_at, honoredAt: q.honored_at, memory: q.status === 'honoree' ? { child: q.memory_child, parent: q.memory_parent, by: nameOf(q.honored_by) } : null,
    // The photo of the memory: its file id only tells the screen when the picture changed.
    photo: q.photo_file_id,
  });
  /**
   * La quête nommée par la route, que la session a le droit de lire : celle de
   * l'enfant lui-même, ou n'importe laquelle pour un adulte. Null après réponse.
   */
  const quest = (req: Request, res: Response): repo.QuestRow | null => {
    const q = repo.getQuest(String(req.params['id']));
    if (!q) { res.status(404).json({ error: 'Quête introuvable.' }); return null; }
    if (me(req).enfant && q.member_id !== me(req).id) { res.status(403).json({ error: 'Cette quête n’est pas la tienne.' }); return null; }
    return q;
  };

  /** L'identifiant d'un geste donné par l'appareil, ou null après un 400. */
  const gestureId = (req: Request, res: Response): string | null => {
    const id = (req.body as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && UUID.test(id)) return id.toLowerCase();
    res.status(400).json({ error: 'id : identifiant du geste attendu (uuid).' });
    return null;
  };
  /** L'exploit convenu que nomme le corps (`exploitId`), ou null après un 404. */
  const exploitOf = (req: Request, res: Response): repo.ExploitRow | null => {
    const id = (req.body as { exploitId?: unknown } | undefined)?.exploitId;
    const e = typeof id === 'string' ? repo.getExploit(id) : null;
    if (e && !e.archived_at) return e;
    res.status(404).json({ error: 'Exploit introuvable.' });
    return null;
  };
  /** La routine d'un enfant enrôlé, pour un adulte qui la règle ; null après réponse. */
  const editable = (req: Request, res: Response): repo.RoutineRow | null => {
    if (!adult(req, res)) return null;
    const r = repo.getRoutine(String(req.params['id']));
    if (!r) { res.status(404).json({ error: 'Routine introuvable.' }); return null; }
    return r;
  };

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
    res.json({ ...summary(m), day, routines: all.length ? routinesView(m.id, day) : [], demandes: all.length ? requestsView(m.id, day) : [],
      quetes: all.length ? repo.openQuests(m.id).map(questView) : [], souvenirs: all.length ? repo.memories(m.id, MEMORIES_MAX).map(questView) : [], journal: all.slice(0, JOURNAL_MAX).map((e) => entryView(e, cancelled)) });
  }));

  r.post('/membres/:id/enrolement', handler((req, res) => {
    if (!adult(req, res)) return;
    const m = child(req, res); if (!m) return;
    const was = repo.profileOf(m.id);
    const { created } = repo.enrol(m.id, me(req).id);
    if (created) { const g = gabarit(); repo.installGabarit(m.id, g.routines); repo.installExploits(g.exploits); repo.installRewards(g.rewards); }
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

  // Le serment de l'alliance : scellé une fois, par un adulte, avec l'enfant à côté de lui.
  r.post('/membres/:id/serment', handler((req, res) => {
    const m = enrolled(req, res); if (!m) return;
    const first = repo.swear(m.id, me(req).id);
    if (first) log.info(`Épopée : serment de l’alliance scellé par ${m.name} et ${me(req).name}.`);
    res.status(first ? 201 : 200).json(summary(m));
  }));

  // Affichage de la besace et sablier, par enfant.
  r.patch('/membres/:id/reglages', json, handler((req, res) => {
    const m = enrolled(req, res); if (!m) return;
    const p = repo.activeProfile(m.id)!;
    const b = (req.body ?? {}) as { display?: unknown; timer?: unknown };
    const display = b.display === undefined ? p.display : DISPLAYS.find((d) => d === b.display);
    if (!display) { res.status(400).json({ error: 'display : « nombre » ou « pieces ».' }); return; }
    if (b.timer !== undefined && typeof b.timer !== 'boolean') { res.status(400).json({ error: 'timer : oui ou non.' }); return; }
    repo.setSettings(m.id, { display, timer: b.timer === undefined ? !!p.timer : b.timer });
    log.info(`Épopée : réglages de ${m.name} modifiés par ${me(req).name}.`);
    res.json(summary(m));
  }));

  // Les routines du gabarit : pour un enfant qui n'en a aucune, ou (`replace`)
  // pour revenir aux routines proposées. Les coches passées restent.
  r.post('/membres/:id/routines/gabarit', json, handler((req, res) => {
    const m = enrolled(req, res); if (!m) return;
    if ((req.body as { replace?: unknown } | undefined)?.replace === true) {
      repo.resetRoutines(m.id, gabarit().routines);
      log.info(`Épopée : routines de ${m.name} remises au gabarit par ${me(req).name}.`);
      res.status(201).json({ routines: routinesView(m.id, today()) });
      return;
    }
    const n = repo.installGabarit(m.id, gabarit().routines);
    if (n) log.info(`Épopée : ${n} routine${n > 1 ? 's' : ''} du gabarit posée${n > 1 ? 's' : ''} pour ${m.name} par ${me(req).name}.`);
    res.status(n ? 201 : 200).json({ routines: routinesView(m.id, today()) });
  }));

  /** Le titre, l'heure et les étapes d'une routine tels qu'un parent les envoie, ou null après un 400. */
  const routineBody = (req: Request, res: Response): { title: string; time: string; steps: Exclude<ReturnType<typeof stepsInput>, string> } | null => {
    const b = (req.body ?? {}) as { title?: unknown; time?: unknown; steps?: unknown };
    const title = titleInput(b.title), time = timeInput(b.time), steps = stepsInput(b.steps);
    if (!title) { res.status(400).json({ error: 'title : un titre d’au plus 60 caractères.' }); return null; }
    if (!time) { res.status(400).json({ error: 'time : une heure HH:MM.' }); return null; }
    if (typeof steps === 'string') { res.status(400).json({ error: steps }); return null; }
    return { title, time, steps };
  };

  // Créer une routine de plus (le retour de l'école, les devoirs) : son moment se déduit de son heure.
  r.post('/membres/:id/routines', json, handler((req, res) => {
    const m = enrolled(req, res); if (!m) return;
    const b = routineBody(req, res); if (!b) return;
    if (repo.routinesOf(m.id).length >= ROUTINES_MAX) { res.status(409).json({ error: `${m.name} a déjà ${ROUTINES_MAX} routines : retirez-en une avant d’en ajouter.` }); return; }
    const row = repo.createRoutine(m.id, b.title, b.time, b.steps);
    log.info(`Épopée : routine « ${row.title} » (${row.time}) créée pour ${m.name} par ${me(req).name} (${b.steps.length} étape${b.steps.length > 1 ? 's' : ''}).`);
    res.status(201).json({ id: row.id, routines: routinesView(m.id, today()) });
  }));

  // Régler une routine : son titre, son heure, et ses étapes dans l'ordre donné.
  r.put('/routines/:id', json, handler((req, res) => {
    const routine = editable(req, res); if (!routine) return;
    const b = routineBody(req, res); if (!b) return;
    if (!repo.replaceSteps(routine.id, b.steps)) { res.status(400).json({ error: 'Une étape citée n’appartient pas à cette routine.' }); return; }
    repo.updateRoutine(routine.id, b.title, b.time);
    log.info(`Épopée : routine « ${b.title} » de ${nameOf(routine.member_id) ?? 'un enfant'} réglée par ${me(req).name} (${b.steps.length} étape${b.steps.length > 1 ? 's' : ''}).`);
    res.json({ routines: routinesView(routine.member_id, today()) });
  }));

  // Retirer une routine : ce qui a été gagné avec reste.
  r.delete('/routines/:id', handler((req, res) => {
    const routine = editable(req, res); if (!routine) return;
    repo.archiveRoutine(routine.id);
    log.info(`Épopée : routine « ${routine.title} » de ${nameOf(routine.member_id) ?? 'un enfant'} retirée par ${me(req).name} (écus et coches conservés).`);
    res.json({ routines: routinesView(routine.member_id, today()) });
  }));

  // ---- Exploits convenus ----
  r.get('/exploits', handler((_req, res) => { res.json({ exploits: repo.exploits().map(exploitView) }); }));

  r.post('/exploits', json, handler((req, res) => {
    if (!adult(req, res)) return;
    const x = exploitInput((req.body ?? {}) as Record<string, unknown>);
    if (typeof x === 'string') { res.status(400).json({ error: x }); return; }
    const e = repo.addExploit(x);
    log.info(`Épopée : exploit « ${e.title} » (${e.ecus} écu${e.ecus > 1 ? 's' : ''}) ajouté par ${me(req).name}.`);
    res.status(201).json({ exploit: exploitView(e) });
  }));

  r.put('/exploits/:id', json, handler((req, res) => {
    if (!adult(req, res)) return;
    const e = repo.getExploit(String(req.params['id']));
    if (!e || e.archived_at) { res.status(404).json({ error: 'Exploit introuvable.' }); return; }
    const x = exploitInput((req.body ?? {}) as Record<string, unknown>);
    if (typeof x === 'string') { res.status(400).json({ error: x }); return; }
    repo.updateExploit(e.id, x);
    res.json({ exploit: exploitView(repo.getExploit(e.id)!) });
  }));

  r.delete('/exploits/:id', handler((req, res) => {
    if (!adult(req, res)) return;
    const e = repo.getExploit(String(req.params['id']));
    if (!e || e.archived_at) { res.status(404).json({ error: 'Exploit introuvable.' }); return; }
    repo.archiveExploit(e.id);
    log.info(`Épopée : exploit « ${e.title} » retiré par ${me(req).name}.`);
    res.json({ ok: true });
  }));

  // Crédit express : un adulte verse un exploit convenu, d'un geste.
  r.post('/membres/:id/exploits', json, handler((req, res) => {
    const m = enrolled(req, res); if (!m) return;
    const id = gestureId(req, res); if (!id) return;
    const e = exploitOf(req, res); if (!e) return;
    const done = repo.creditExploit(id, m.id, e, me(req).id);
    if (!done) { res.status(409).json({ error: 'Cet identifiant a déjà servi à autre chose.' }); return; }
    if (!done.duplicate) log.info(`Épopée : ${me(req).name} crédite « ${e.title} » à ${m.name}, +${e.ecus} écu${e.ecus > 1 ? 's' : ''}.`);
    res.status(done.duplicate ? 200 : 201).json({ duplicate: done.duplicate, entry: entryView(done.entry, new Set()), balance: repo.balanceOf(m.id) });
  }));

  // Un enfant signale un exploit : rien n'est versé tant qu'un parent n'a pas répondu.
  r.post('/membres/:id/demandes', json, handler((req, res) => {
    const m = child(req, res); if (!m) return;
    if (m.id !== me(req).id) { res.status(403).json({ error: 'Seul l’enfant signale ses exploits.' }); return; }
    if (!repo.activeProfile(m.id)) { res.status(409).json({ error: 'Ton épopée n’a pas encore commencé.' }); return; }
    const id = gestureId(req, res); if (!id) return;
    const e = exploitOf(req, res); if (!e) return;
    const out = repo.addRequest(id, m.id, e.id);
    if (!out) { res.status(409).json({ error: 'Cet identifiant a déjà servi à autre chose.' }); return; }
    if (!out.duplicate) {
      log.info(`Épopée : ${m.name} signale « ${e.title} ».`);
      emit({ kind: 'exploit', id: out.request.id, childId: m.id, child: m.name, actorId: me(req).id, title: e.title, ecus: e.ecus });
    }
    res.status(out.duplicate ? 200 : 201).json({ duplicate: out.duplicate, demandes: requestsView(m.id, today()) });
  }));

  // Un adulte tranche : validé (l'écu est versé) ou « pas tout à fait » (rien n'est retiré).
  r.post('/demandes/:id/decision', json, handler((req, res) => {
    if (!adult(req, res)) return;
    const q = repo.getRequest(String(req.params['id']));
    const accept = (req.body as { accept?: unknown } | undefined)?.accept;
    if (!q) { res.status(404).json({ error: 'Demande introuvable.' }); return; }
    if (typeof accept !== 'boolean') { res.status(400).json({ error: 'accept : oui ou non.' }); return; }
    const e = repo.getExploit(q.exploit_id)!;
    if (accept && !repo.activeProfile(q.member_id)) { res.status(409).json({ error: 'Cet enfant n’est plus enrôlé dans l’Épopée.' }); return; }
    const out = repo.decideRequest(q, e, accept, me(req).id);
    if (!out) { res.status(409).json({ error: 'Cette demande a déjà reçu sa réponse.' }); return; }
    log.info(`Épopée : ${me(req).name} ${accept ? `valide « ${e.title} » de ${nameOf(q.member_id) ?? 'un enfant'}, +${e.ecus} écu${e.ecus > 1 ? 's' : ''}` : `répond « pas tout à fait » à « ${e.title} » de ${nameOf(q.member_id) ?? 'un enfant'}`}.`);
    res.json({ status: out.status, balance: repo.balanceOf(q.member_id) });
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

  // ---- Armurerie : le catalogue des récompenses ----
  r.get('/recompenses', handler((_req, res) => { res.json({ recompenses: repo.rewards().map(rewardView) }); }));

  r.post('/recompenses', json, handler((req, res) => {
    if (!adult(req, res)) return;
    const x = rewardInput((req.body ?? {}) as Record<string, unknown>);
    if (typeof x === 'string') { res.status(400).json({ error: x }); return; }
    const row = repo.addReward(x);
    log.info(`Épopée : récompense « ${row.title} » (${row.cost} écus) ajoutée par ${me(req).name}.`);
    res.status(201).json({ recompense: rewardView(row) });
  }));

  r.put('/recompenses/:id', json, handler((req, res) => {
    if (!adult(req, res)) return;
    const row = repo.getReward(String(req.params['id']));
    if (!row || row.archived_at) { res.status(404).json({ error: 'Récompense introuvable.' }); return; }
    const x = rewardInput((req.body ?? {}) as Record<string, unknown>);
    if (typeof x === 'string') { res.status(400).json({ error: x }); return; }
    repo.updateReward(row.id, x);
    res.json({ recompense: rewardView(repo.getReward(row.id)!) });
  }));

  r.delete('/recompenses/:id', handler((req, res) => {
    if (!adult(req, res)) return;
    const row = repo.getReward(String(req.params['id']));
    if (!row || row.archived_at) { res.status(404).json({ error: 'Récompense introuvable.' }); return; }
    repo.archiveReward(row.id);
    log.info(`Épopée : récompense « ${row.title} » retirée par ${me(req).name}.`);
    res.json({ ok: true });
  }));

  // ---- Armurerie : les quêtes ----
  // Choisir un trésor : l'enfant pour lui-même, ou un adulte pour lui. Rien
  // n'est engagé tant qu'un adulte n'a pas scellé le pacte.
  r.post('/membres/:id/quetes', json, handler((req, res) => {
    const m = child(req, res); if (!m) return;
    if (!repo.activeProfile(m.id)) { res.status(409).json({ error: `${m.name} n’est pas enrôlé dans l’Épopée.` }); return; }
    const id = gestureId(req, res); if (!id) return;
    const rid = (req.body as { rewardId?: unknown }).rewardId;
    const reward = typeof rid === 'string' ? repo.getReward(rid) : null;
    if (!reward || reward.archived_at) { res.status(404).json({ error: 'Récompense introuvable.' }); return; }
    const out = repo.proposeQuest(id, m.id, reward, me(req).id);
    if (!out) { res.status(409).json({ error: 'Une quête est déjà en cours. Une seule à la fois.' }); return; }
    if (!out.duplicate) {
      log.info(`Épopée : ${m.name} vise « ${reward.title} » (${reward.cost} écus)${me(req).id !== m.id ? `, proposé par ${me(req).name}` : ''}.`);
      emit({ kind: 'quete', id: out.quest.id, childId: m.id, child: m.name, actorId: me(req).id, title: reward.title, cost: reward.cost });
    }
    res.status(out.duplicate ? 200 : 201).json({ quete: questView(out.quest) });
  }));

  // Sceller le pacte : ce à quoi le parent s'engage (quand, avec quoi, quelle règle), et un mot.
  r.post('/quetes/:id/pacte', json, handler((req, res) => {
    if (!adult(req, res)) return;
    const q = quest(req, res); if (!q) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const date = b['date'] === undefined || b['date'] === null || b['date'] === '' ? null : dateInput(b['date']);
    const items = optionalText(b['items'], 200), rule = optionalText(b['rule'], 200), note = optionalText(b['note'], 200);
    if (date === null && b['date']) { res.status(400).json({ error: 'date : une date AAAA-MM-JJ.' }); return; }
    if (items === null || rule === null || note === null) { res.status(400).json({ error: 'Chaque texte du pacte fait 200 caractères au plus.' }); return; }
    if (!repo.activeProfile(q.member_id)) { res.status(409).json({ error: 'Cet enfant n’est plus enrôlé dans l’Épopée.' }); return; }
    const out = repo.sealQuest(q, { date, items, rule, note }, me(req).id);
    if (!out) { res.status(409).json({ error: 'Cette quête n’attend plus de pacte.' }); return; }
    log.info(`Épopée : pacte scellé par ${me(req).name} pour « ${q.title} » de ${nameOf(q.member_id) ?? 'un enfant'}${out.topUp ? `, +${out.topUp} écu${out.topUp > 1 ? 's' : ''} d’amorce` : ''}.`);
    res.json({ quete: questView(out.quest), balance: repo.balanceOf(q.member_id) });
  }));

  // Renoncer : l'enfant tant que le pacte n'est pas scellé, un adulte tant que la quête est en cours. Rien n'est retiré.
  r.post('/quetes/:id/abandon', handler((req, res) => {
    const q = quest(req, res); if (!q) return;
    if (me(req).enfant && q.status !== 'proposee') { res.status(403).json({ error: 'Le pacte est scellé : parles-en à tes parents.' }); return; }
    if (!repo.abandonQuest(q)) { res.status(409).json({ error: 'Cette quête n’est plus en cours.' }); return; }
    log.info(`Épopée : quête « ${q.title} » de ${nameOf(q.member_id) ?? 'un enfant'} abandonnée par ${me(req).name} (besace intacte).`);
    res.json({ ok: true, balance: repo.balanceOf(q.member_id) });
  }));

  // Échanger ses écus contre le trésor : l'enfant, ou un adulte pour lui.
  r.post('/quetes/:id/echange', handler((req, res) => {
    const q = quest(req, res); if (!q) return;
    if (!repo.activeProfile(q.member_id)) { res.status(409).json({ error: 'Cet enfant n’est plus enrôlé dans l’Épopée.' }); return; }
    const out = repo.exchangeQuest(q, me(req).id);
    if ('refusal' in out) { res.status(409).json({ error: out.refusal }); return; }
    log.info(`Épopée : ${nameOf(q.member_id) ?? 'un enfant'} échange ${q.cost} écus contre « ${q.title} ».`);
    emit({ kind: 'tresor', id: q.id, childId: q.member_id, child: nameOf(q.member_id) ?? 'Votre enfant', actorId: me(req).id, title: q.title, date: out.quest.pact_date });
    res.status(201).json({ quete: questView(out.quest), balance: repo.balanceOf(q.member_id) });
  }));

  // Le moment a été vécu : un souvenir, avec le mot de l'enfant et celui du parent.
  r.post('/quetes/:id/vecu', json, handler((req, res) => {
    if (!adult(req, res)) return;
    const q = quest(req, res); if (!q) return;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const day = b['date'] === undefined || b['date'] === null || b['date'] === '' ? today() : dateInput(b['date']);
    const kid = optionalText(b['child'], 300), parent = optionalText(b['parent'], 600);
    if (!day || day > today()) { res.status(400).json({ error: 'date : une date AAAA-MM-JJ, aujourd’hui au plus tard.' }); return; }
    if (kid === null || parent === null) { res.status(400).json({ error: 'Le mot de l’enfant fait 300 caractères au plus, le vôtre 600.' }); return; }
    const out = repo.honorQuest(q, day, kid, parent, me(req).id);
    if (!out) { res.status(409).json({ error: 'Ce trésor n’attend pas d’être vécu.' }); return; }
    log.info(`Épopée : « ${q.title} » vécu avec ${nameOf(q.member_id) ?? 'un enfant'}, noté par ${me(req).name}.`);
    res.json({ quete: questView(out) });
  }));

  // ---- La photo d'un souvenir : posée par un adulte, vue par l'enfant et les adultes ----
  r.post('/quetes/:id/photo', express.raw({ type: '*/*', limit: MAX_PHOTO }), handler((req, res) => {
    if (!adult(req, res)) return;
    const q = quest(req, res); if (!q) return;
    if (q.status !== 'honoree') { res.status(409).json({ error: 'La photo se pose sur un souvenir : notez d’abord le moment comme vécu.' }); return; }
    const check = checkUpload(req.body, false);
    if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }
    const out = repo.setPhoto(q, `souvenir-${q.id}${check.type.ext}`, req.body as Buffer, check.type);
    log.info(`Épopée : photo du souvenir « ${q.title} » de ${nameOf(q.member_id) ?? 'un enfant'} posée par ${me(req).name}.`);
    res.status(201).json({ quete: questView(out) });
  }));

  r.delete('/quetes/:id/photo', handler((req, res) => {
    if (!adult(req, res)) return;
    const q = quest(req, res); if (!q) return;
    if (q.photo_file_id === null) { res.status(404).json({ error: 'Ce souvenir n’a pas de photo.' }); return; }
    repo.removePhoto(q);
    log.info(`Épopée : photo du souvenir « ${q.title} » retirée par ${me(req).name}.`);
    res.json({ quete: questView(repo.getQuest(q.id)!) });
  }));

  r.get('/quetes/:id/photo', handler((req, res) => {
    const q = quest(req, res); if (!q) return;
    const f = q.photo_file_id === null ? null : files.fileOf(q.photo_file_id);
    if (!f) { res.status(404).json({ error: 'Ce souvenir n’a pas de photo.' }); return; }
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    // The address carries the file id (?v=) and changes with the picture: the same address is the same picture.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', contentDisposition('inline', f.name, 'souvenir'));
    res.sendFile(f.path);
  }));

  // ---- Le conseil de famille : le bilan de la semaine, pour les adultes ----
  /** Le lundi demandé (`semaine`, la semaine en cours par défaut), ou null après un 400. */
  const weekOf = (req: Request, res: Response): string | null => {
    const v = (req.query['semaine'] ?? (req.body as { semaine?: unknown } | undefined)?.semaine) as unknown;
    if (v === undefined) return mondayOf(today());
    const day = dateInput(v);
    if (day && mondayOf(day) === day && day <= today()) return day;
    res.status(400).json({ error: 'semaine : un lundi AAAA-MM-JJ, passé ou de cette semaine.' });
    return null;
  };
  const bilans = (from: string) => members().filter((m) => m.enfant && repo.activeProfile(m.id))
    .map((m) => computeBilan(repo.weekData({ id: m.id, name: m.name }, from, addDays(from, 6), today())));

  r.get('/conseil', handler((req, res) => {
    if (!adult(req, res)) return;
    const from = weekOf(req, res); if (!from) return;
    const c = repo.council(from);
    res.json({
      from, to: addDays(from, 6), label: periodLabel(from, addDays(from, 6)), current: from === mondayOf(today()),
      enfants: bilans(from).map((b) => ({ memberId: b.member.id, earned: b.earned, lines: lines(b), words: b.words })),
      rituel: RITUEL, notes: c?.notes ?? '', notesBy: nameOf(c?.by_member ?? null),
    });
  }));

  r.put('/conseil', json, handler((req, res) => {
    if (!adult(req, res)) return;
    const from = weekOf(req, res); if (!from) return;
    const notes = optionalText((req.body as { notes?: unknown }).notes, 2000);
    if (notes === null) { res.status(400).json({ error: 'notes : 2000 caractères au plus.' }); return; }
    repo.setCouncil(from, notes, me(req).id);
    log.info(`Épopée : notes du conseil de famille (semaine du ${from}) enregistrées par ${me(req).name}.`);
    res.json({ notes, notesBy: me(req).name });
  }));

  r.get('/conseil.pdf', handler((req, res) => {
    if (!adult(req, res)) return;
    const from = weekOf(req, res); if (!from) return;
    log.info(`Épopée : ${me(req).name} a téléchargé le bilan de la semaine du ${from}.`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="epopee-bilan-${from}.pdf"`);
    res.send(councilPdf(bilans(from), from, repo.council(from)?.notes ?? '', today()));
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
