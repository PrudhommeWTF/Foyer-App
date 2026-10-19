// Surface HTTP du module « Tables », montée sous /api/tables derrière la
// session, `requireMember` et le drapeau `modTables`. Pas de jeton d'accès :
// l'assistant passe par le serveur MCP.
//
// Qui a le droit de quoi :
//   - un enfant lit et écrit **ses** sessions, et rien d'autre ;
//   - un adulte lit tout le monde, s'entraîne pour lui-même (sa grille existe,
//     sans programme ni bilan), et règle le programme d'un enfant ;
//   - une session ne s'enregistre qu'au nom du membre de la session, jamais
//     d'un autre (pas même par un adulte).
import express, { Request, Response, Router } from 'express';
import { HouseholdState, Member } from '../models';
import { getHousehold } from '../db';
import { log } from '../log';
import { AuthedRequest, currentMember } from '../auth/session';
import { appareil } from '../auth/switches';
import { effectiveSetting } from '../settings/repo';
import { Bareme, timingFor } from './bareme';
import { MODES, Mode, OPERATIONS, Operation, Result, classify, expectedOf, pairOf, status } from './mastery';
import {
  AnswerIn, ProgramRow, SessionRow, activeProgram, masteryRows, pairHistory, programById, recordSession, sessionsOf, setProgram, toMastery,
} from './repo';

/** Au-delà, ce n'est plus une session d'enfant : une file hors ligne abîmée, ou autre chose. */
const MAX_ANSWERS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

class Invalid extends Error {}
const int = (v: unknown, min: number, max: number, what: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Invalid(`${what} : entier entre ${min} et ${max} attendu.`);
  return v;
};
const iso = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !ISO.test(v) || Number.isNaN(Date.parse(v))) throw new Invalid(`${what} : date ISO attendue.`);
  return new Date(v).toISOString();
};

const members = (): Member[] => (getHousehold().state as HouseholdState).members;
const tablesMax = (): number => Number(effectiveSetting('tablesMax')) || 10;
const parisDay = (isoAt: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(isoAt));

export const programView = (p: ProgramRow | null) => p && ({
  id: p.id, operation: p.operation, from: p.from_table, to: p.to_table, questions: p.questions,
  secondsAllowed: p.seconds_allowed, fastSeconds: p.fast_seconds, dailyGoal: p.daily_goal,
  bothDirections: !!p.both_directions, setBy: p.set_by, setAt: p.set_at,
});
export const sessionView = (s: SessionRow) => ({
  id: s.id, mode: s.mode, operation: s.operation, from: s.from_table, to: s.to_table, startedAt: s.started_at, endedAt: s.ended_at,
  aborted: !!s.aborted, questions: s.questions, good: s.good, slow: s.slow, wrong: s.wrong, avgMs: s.avg_ms, programId: s.program_id, via: s.via,
});

export function tablesRouter(getBareme: () => Bareme): Router {
  const r = express.Router();
  r.use(express.json({ limit: '256kb' }));

  /** Le membre visé, si la session a le droit de le lire : soi-même, ou n'importe qui pour un adulte. */
  const readable = (req: Request, res: Response): Member | null => {
    const me = currentMember(req as AuthedRequest)!;
    const target = members().find((m) => m.id === req.params.memberId);
    if (!target) { res.status(404).json({ error: 'Membre introuvable.' }); return null; }
    if (me.enfant && target.id !== me.id) { res.status(403).json({ error: 'Tu ne peux voir que tes propres tables.' }); return null; }
    return target;
  };
  const operation = (v: unknown): Operation => {
    if (!OPERATIONS.includes(v as Operation)) throw new Invalid('Opération inconnue : « multiplication » ou « addition ».');
    return v as Operation;
  };
  const route = (fn: (req: Request, res: Response) => void) => (req: Request, res: Response): void => {
    try { fn(req, res); } catch (e) {
      if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
      log.erreur('Tables : erreur inattendue', e);
      res.status(500).json({ error: 'Erreur interne du serveur.' });
    }
  };

  /** Ce que l'écran doit savoir pour tout le monde : la dernière table, et les seuils écrits dans l'aide. */
  r.get('/config', (_req, res) => {
    const b = getBareme();
    res.json({ tablesMax: tablesMax(), maitrise: b.maitrise, ages: b.ages, adulte: b.adulte, sansAge: b.sansAge });
  });

  /**
   * Tout ce qu'il faut pour s'entraîner et pour suivre : le programme, le temps
   * accordé (et d'où il vient), la grille de l'opération demandée (celle du
   * programme par défaut) avec l'état de chaque case.
   */
  r.get('/members/:memberId', route((req, res) => {
    const m = readable(req, res); if (!m) return;
    const b = getBareme();
    const program = activeProgram(m.id);
    const op = req.query['operation'] !== undefined ? operation(req.query['operation']) : program?.operation ?? 'multiplication';
    const timing = timingFor(b, m, parisDay(new Date().toISOString()), program && { secondsAllowed: program.seconds_allowed, fastSeconds: program.fast_seconds });
    res.json({
      member: { id: m.id, name: m.name, enfant: !!m.enfant, birthday: m.birthday ?? null },
      tablesMax: tablesMax(), operation: op, program: programView(program), timing,
      mastery: masteryRows(m.id, op).map((x) => ({ a: x.a, b: x.b, ...toMastery(x), status: status(toMastery(x), b.maitrise) })),
    });
  }));

  /** L'historique d'une case de la grille : 6 × 7 et 7 × 6 ensemble. */
  r.get('/members/:memberId/pairs/:operation/:a/:b', route((req, res) => {
    const m = readable(req, res); if (!m) return;
    const op = operation(req.params['operation']);
    const [pa, pb] = pairOf(int(Number(req.params['a']), 0, 12, 'a'), int(Number(req.params['b']), 0, 12, 'b'));
    res.json({ a: pa, b: pb, answers: pairHistory(m.id, op, pa, pb) });
  }));

  r.get('/members/:memberId/sessions', route((req, res) => {
    const m = readable(req, res); if (!m) return;
    const since = req.query['since'] !== undefined ? iso(req.query['since'], 'since') : null;
    const limit = req.query['limit'] !== undefined ? int(Number(req.query['limit']), 1, 500, 'limit') : 100;
    res.json({ sessions: sessionsOf(m.id, since, limit).map(sessionView) });
  }));

  /** Le programme d'un enfant, réglé par un adulte. L'ancien reste en base : le passé ne change pas. */
  r.put('/members/:memberId/program', route((req, res) => {
    const me = currentMember(req as AuthedRequest)!;
    if (me.enfant) { res.status(403).json({ error: 'Le programme se règle par un adulte du foyer.' }); return; }
    const target = members().find((m) => m.id === req.params.memberId);
    if (!target) { res.status(404).json({ error: 'Membre introuvable.' }); return; }
    if (!target.enfant) { res.status(400).json({ error: 'Un programme se règle pour un enfant. Un adulte s’entraîne librement.' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const max = tablesMax();
    const from = int(body['from'], 0, max, 'from'), to = int(body['to'], 0, max, 'to');
    if (from > to) throw new Invalid('La première table doit précéder la dernière.');
    const secs = (v: unknown, what: string): number | null => {
      if (v === null || v === undefined) return null;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.5 || v > 120) throw new Invalid(`${what} : entre 0,5 et 120 secondes, ou null pour le barème.`);
      return Math.round(v * 10) / 10;
    };
    const secondsAllowed = secs(body['secondsAllowed'], 'secondsAllowed'), fastSeconds = secs(body['fastSeconds'], 'fastSeconds');
    if (secondsAllowed !== null && fastSeconds !== null && fastSeconds > secondsAllowed) throw new Invalid('Le seuil « rapide » ne peut pas dépasser le temps accordé.');
    const p = setProgram({
      memberId: target.id, operation: operation(body['operation']), from, to,
      questions: int(body['questions'], 5, 100, 'questions'), secondsAllowed, fastSeconds,
      dailyGoal: int(body['dailyGoal'] ?? 1, 0, 10, 'dailyGoal'), bothDirections: body['bothDirections'] !== false, setBy: me.id,
    });
    log.info(`Tables : ${me.name} a réglé le programme de ${target.name} (${p.operation}, tables ${p.from_table} à ${p.to_table}, ${p.questions} questions, objectif ${p.daily_goal} par jour).`);
    res.json({ program: programView(p) });
  }));

  /**
   * Une session terminée (ou abandonnée), en un seul envoi. Idempotente par son
   * identifiant, généré sur l'appareil : la rejouer depuis une file hors ligne
   * ne la compte qu'une fois. Le serveur refait la correction : juste ou faux
   * se décide ici, d'après la question, pas d'après ce que dit l'appareil.
   */
  r.post('/sessions', route((req, res) => {
    const me = currentMember(req as AuthedRequest)!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body['memberId'] !== undefined && body['memberId'] !== me.id) {
      res.status(403).json({ error: 'Une session s’enregistre au nom de qui s’est entraîné, et de personne d’autre.' });
      return;
    }
    const id = String(body['id'] ?? '');
    if (!UUID.test(id)) throw new Invalid('Identifiant de session : un uuid attendu.');
    const mode = body['mode'] as Mode;
    if (!MODES.includes(mode)) throw new Invalid('Mode inconnu : « apprendre », « entrainer » ou « test ».');
    const op = operation(body['operation']);
    const top = Math.max(tablesMax(), 12);
    const from = int(body['from'], 0, top, 'from'), to = int(body['to'], 0, top, 'to');
    const now = Date.now();
    // L'horloge de l'appareil fait foi, bornée : rien dans le futur.
    const clamp = (at: string): string => (Date.parse(at) > now + 5 * 60_000 ? new Date(now).toISOString() : at);
    const startedAt = clamp(iso(body['startedAt'], 'startedAt')), endedAt = clamp(iso(body['endedAt'], 'endedAt'));
    const programId = body['programId'] === null || body['programId'] === undefined ? null : int(body['programId'], 1, Number.MAX_SAFE_INTEGER, 'programId');
    const program = programId !== null ? programById(programId) : null;
    if (programId !== null && (!program || program.member_id !== me.id)) throw new Invalid('Ce programme n’est pas le tien.');
    const timing = timingFor(getBareme(), me, parisDay(startedAt), program && { secondsAllowed: program.seconds_allowed, fastSeconds: program.fast_seconds });
    // Le seuil appliqué à l'écran pendant la session, s'il est dit et plausible ; sinon celui du jour.
    const fastMs = typeof body['fastMs'] === 'number' && body['fastMs'] >= 300 && body['fastMs'] <= 120_000 ? Math.round(body['fastMs']) : timing.fastMs;
    const allowedMs = typeof body['allowedMs'] === 'number' && body['allowedMs'] >= 500 && body['allowedMs'] <= 120_000 ? Math.round(body['allowedMs']) : timing.allowedMs;
    const raw = body['answers'];
    if (!Array.isArray(raw) || raw.length > MAX_ANSWERS) throw new Invalid(`Réponses : une liste de ${MAX_ANSWERS} au plus attendue.`);
    const answers: AnswerIn[] = raw.map((x, i) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const a = int(o['a'], 0, top, `réponse ${i + 1}, a`), b = int(o['b'], 0, top, `réponse ${i + 1}, b`);
      const given = o['given'] === null || o['given'] === undefined ? null : int(o['given'], 0, 9999, `réponse ${i + 1}, given`);
      const ms = int(Math.round(Number(o['ms'])), 0, 3_600_000, `réponse ${i + 1}, ms`);
      const result: Result = mode === 'apprendre' ? (given === expectedOf(op, a, b) ? 'bon' : given === null ? 'passe' : 'faux') : classify(expectedOf(op, a, b), given, ms, fastMs);
      return { a, b, given, ms, askedAt: clamp(iso(o['askedAt'], `réponse ${i + 1}, askedAt`)), result };
    });
    const sw = (req as AuthedRequest).switched;
    const out = recordSession({
      id, memberId: me.id, programId, mode, operation: op, from, to, startedAt, endedAt, aborted: body['aborted'] === true,
      allowedMs, fastMs, device: appareil(String(req.headers['user-agent'] || ''), body['tactile'] === true), via: sw?.viaMemberId ?? null, answers,
    }, getBareme().maitrise);
    if (out.duplicate) { res.json({ duplicate: true, session: sessionView(out.session), changes: [] }); return; }
    const s = out.session;
    const duree = Math.max(0, Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000));
    log.info(`Tables : session de ${me.name} reçue (${s.mode}, ${s.operation}, tables ${s.from_table} à ${s.to_table}${s.aborted ? ', abandonnée' : ''}) : ${s.good} bonnes, ${s.slow} lentes, ${s.wrong} fausses, ${duree} s.`);
    const cfg = getBareme().maitrise;
    res.status(201).json({
      duplicate: false, session: sessionView(s),
      changes: out.changes.map((c) => ({ a: c.a, b: c.b, before: status(c.before ?? undefined, cfg), after: status(c.after ?? undefined, cfg), level: c.after?.level ?? null })),
    });
  }));

  return r;
}
