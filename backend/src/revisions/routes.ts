// Surface HTTP du module « Révisions », montée sous /api/revisions derrière la
// session, `requireMember` et le drapeau `modRevisions`. Pas de jeton d'accès :
// l'assistant passe par le serveur MCP.
//
// Rien ici ne connaît une matière : chaque exercice est une définition du
// registre (exercises/), qui dit ses paramètres, ses items, la forme de ses
// questions et sa correction. Le serveur refait la correction avec la même
// définition que l'appareil : juste ou faux ne se décide pas sur l'appareil.
//
// Qui a le droit de quoi :
//   - un enfant lit et écrit **ses** sessions, et rien d'autre ;
//   - un adulte lit tout le monde, s'entraîne pour lui-même (sans programme),
//     et règle les programmes d'un enfant ;
//   - une session ne s'enregistre qu'au nom du membre de la session.
import express, { Request, Response, Router } from 'express';
import { HouseholdState, Member } from '../models';
import { getHousehold } from '../db';
import { log } from '../log';
import { AuthedRequest, currentMember } from '../auth/session';
import { appareil } from '../auth/switches';
import { Bareme, timingFor } from './bareme';
import { Result, classify, status } from './mastery';
import { MODES, Mode, ExerciseContext, ExerciseDef, Params, defaults, readParams } from './exercises/contract';
import { EXERCISES, exerciseById } from './exercises';
import { Matiere, matiereLabel } from './matieres';
import { addDays, bilanFor, mondayOf, parisDay as dayOf } from './bilan';
import { bilanPdf, sessionsCsv } from './export';
import {
  AnswerIn, ProgramRow, SessionRow, activeProgram, activePrograms, countedAnswers, itemHistory, masteryRows, programById,
  createList, foyerListId, recordSession, sessionsBetween, sessionsOf, setProgram, stopProgram, toMastery, updateList,
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
const params = (def: ExerciseDef, raw: unknown, ctx: ExerciseContext): Params => { try { return readParams(def, raw, ctx); } catch (e) { throw new Invalid((e as Error).message); } };
/** Les paramètres d'un programme enregistré, ou les défauts s'ils ne se relisent plus (une liste de contenu disparue de la configuration). */
const storedParams = (def: ExerciseDef, json: string, ctx: ExerciseContext): Params => { try { return readParams(def, JSON.parse(json), ctx); } catch { return defaults(def, ctx); } };
/** Une liste de contenu reçue : un libellé, et des éléments non vides, sans doublon. */
const MAX_ITEMS = 200;

const members = (): Member[] => (getHousehold().state as HouseholdState).members;
const parisDay = (isoAt: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(isoAt));

export const programView = (p: ProgramRow | null) => p && ({
  id: p.id, exerciseId: p.exercise_id, params: JSON.parse(p.params_json) as Params, questions: p.questions,
  secondsAllowed: p.seconds_allowed, fastSeconds: p.fast_seconds, dailyGoal: p.daily_goal, setBy: p.set_by, setAt: p.set_at,
});
export const sessionView = (s: SessionRow) => ({
  id: s.id, exerciseId: s.exercise_id, mode: s.mode, params: JSON.parse(s.params_json) as Params, startedAt: s.started_at, endedAt: s.ended_at,
  aborted: !!s.aborted, questions: s.questions, good: s.good, slow: s.slow, wrong: s.wrong, avgMs: s.avg_ms, programId: s.program_id, via: s.via,
});
/** Une définition, telle que l'écran et l'assistant la lisent : tout sauf le code. */
export const exerciseView = (d: ExerciseDef, mat: Matiere[]) => ({
  id: d.id, label: d.label, matiere: d.matiere, matiereLabel: matiereLabel(mat, d.matiere), icon: d.icon, ageMin: d.ageMin ?? null, desc: d.desc,
  input: d.input, prompt: d.prompt, view: d.view, requires: d.requires ?? [], learn: !!d.learn, params: d.params,
});

export function revisionsRouter(getBareme: (exercise?: string) => Bareme, getMatieres: () => Matiere[], getContext: (exercise: string) => ExerciseContext): Router {
  const r = express.Router();
  r.use(express.json({ limit: '256kb' }));

  /** Le membre visé, si la session a le droit de le lire : soi-même, ou n'importe qui pour un adulte. */
  const readable = (req: Request, res: Response): Member | null => {
    const me = currentMember(req as AuthedRequest)!;
    const target = members().find((m) => m.id === req.params.memberId);
    if (!target) { res.status(404).json({ error: 'Membre introuvable.' }); return null; }
    if (me.enfant && target.id !== me.id) { res.status(403).json({ error: 'Tu ne peux voir que tes propres révisions.' }); return null; }
    return target;
  };
  const exercise = (id: unknown): ExerciseDef => {
    const d = exerciseById(id);
    if (!d) throw new Invalid(`Exercice inconnu : ${EXERCISES.map((e) => `« ${e.id} »`).join(', ')}.`);
    return d;
  };
  const route = (fn: (req: Request, res: Response) => void) => (req: Request, res: Response): void => {
    try { fn(req, res); } catch (e) {
      if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
      log.erreur('Révisions : erreur inattendue', e);
      res.status(500).json({ error: 'Erreur interne du serveur.' });
    }
  };
  const timingOf = (d: ExerciseDef, m: Member, day: string, p: ProgramRow | null) =>
    timingFor(getBareme(d.id), m, day, p && { secondsAllowed: p.seconds_allowed, fastSeconds: p.fast_seconds });

  /** Les exercices disponibles et leurs paramètres : ce que l'écran affiche et ce que l'assistant peut régler. */
  r.get('/exercises', (_req, res) => {
    const mat = getMatieres();
    res.json({ matieres: mat, exercises: EXERCISES.map((d) => exerciseView(d, mat)) });
  });

  /** Les règles de maîtrise et le barème d'un exercice, pour l'aide. */
  r.get('/config', route((req, res) => {
    const id = req.query['exercise'];
    const b = getBareme(id !== undefined ? exercise(id).id : undefined);
    res.json({ maitrise: b.maitrise, ages: b.ages, adulte: b.adulte, sansAge: b.sansAge });
  }));

  /** Les programmes actifs d'un membre : ce que « Mon entraînement du jour » enchaîne. */
  r.get('/members/:memberId', route((req, res) => {
    const m = readable(req, res); if (!m) return;
    res.json({
      member: { id: m.id, name: m.name, enfant: !!m.enfant, birthday: m.birthday ?? null },
      programs: activePrograms(m.id).filter((p) => exerciseById(p.exercise_id)).map(programView),
    });
  }));

  /**
   * Tout ce qu'il faut pour s'entraîner à un exercice et le suivre : le
   * programme, les paramètres en vigueur, le temps accordé (et d'où il vient),
   * et la maîtrise de chaque item avec son état.
   */
  r.get('/members/:memberId/exercises/:exercise', route((req, res) => {
    const m = readable(req, res); if (!m) return;
    const d = exercise(req.params['exercise']);
    const program = activeProgram(m.id, d.id);
    const cfg = getBareme(d.id).maitrise;
    res.json({
      member: { id: m.id, name: m.name, enfant: !!m.enfant },
      exerciseId: d.id, program: programView(program),
      params: program ? storedParams(d, program.params_json, getContext(d.id)) : defaults(d, getContext(d.id)),
      timing: timingOf(d, m, parisDay(new Date().toISOString()), program),
      mastery: masteryRows(m.id, d.id).map((x) => ({ key: x.item_key, label: d.itemLabel(x.item_key), ...toMastery(x), status: status(toMastery(x), cfg) })),
    });
  }));

  /** L'historique d'un item (« mult:6x7 » : les deux sens ensemble), le plus récent d'abord. */
  r.get('/members/:memberId/exercises/:exercise/items/:key', route((req, res) => {
    const m = readable(req, res); if (!m) return;
    const d = exercise(req.params['exercise']);
    const key = String(req.params['key']).slice(0, 200);
    res.json({
      key, label: d.itemLabel(key),
      answers: itemHistory(m.id, d.id, key).map((a) => ({ text: textOf(d, a.question_json), expected: a.expected, given: a.given, ms: a.ms, result: a.result, askedAt: a.asked_at, mode: a.mode })),
    });
  }));

  /**
   * Le résumé du suivi d'un exercice depuis une date (quatre semaines par
   * défaut) : sessions par jour à l'heure de Paris, et réussite par groupe
   * d'items tel que l'exercice les regroupe (« Table de 7 »).
   */
  r.get('/members/:memberId/exercises/:exercise/stats', route((req, res) => {
    const m = readable(req, res); if (!m) return;
    const d = exercise(req.params['exercise']);
    const since = req.query['since'] !== undefined ? iso(req.query['since'], 'since') : new Date(Date.now() - 28 * 86400_000).toISOString();
    const program = activeProgram(m.id, d.id);
    const ctx = getContext(d.id);
    const p = program ? storedParams(d, program.params_json, ctx) : defaults(d, ctx);
    const days = new Map<string, { day: string; sessions: number; questions: number; good: number }>();
    for (const s of sessionsOf(m.id, d.id, since, 10_000)) {
      const day = parisDay(s.started_at);
      const e = days.get(day) ?? { day, sessions: 0, questions: 0, good: 0 };
      e.sessions++; e.questions += s.questions; e.good += s.good;
      days.set(day, e);
    }
    const groups = new Map<string, { group: string; questions: number; correct: number; fast: number }>();
    for (const a of countedAnswers(m.id, d.id, since)) {
      for (const g of d.groups(a.item_key, p, ctx)) {
        const e = groups.get(g) ?? { group: g, questions: 0, correct: 0, fast: 0 };
        e.questions++;
        if (a.result === 'bon' || a.result === 'lent') e.correct++;
        if (a.result === 'bon') e.fast++;
        groups.set(g, e);
      }
    }
    res.json({ exerciseId: d.id, since, days: [...days.values()], groups: [...groups.values()] });
  }));

  r.get('/members/:memberId/sessions', route((req, res) => {
    const m = readable(req, res); if (!m) return;
    const ex = req.query['exercise'] !== undefined ? exercise(req.query['exercise']).id : null;
    const since = req.query['since'] !== undefined ? iso(req.query['since'], 'since') : null;
    const limit = req.query['limit'] !== undefined ? int(Number(req.query['limit']), 1, 500, 'limit') : 100;
    res.json({ sessions: sessionsOf(m.id, ex, since, limit).map(sessionView) });
  }));

  /**
   * L'enfant d'un bilan ou d'un export : réservé aux adultes (le bilan est le
   * leur, et celui de la maîtresse), et pour un enfant seulement (un adulte
   * s'entraîne sans bilan).
   */
  const childFor = (req: Request, res: Response): Member | null => {
    const me = currentMember(req as AuthedRequest)!;
    if (me.enfant) { res.status(403).json({ error: 'Le bilan se consulte depuis la session d’un adulte du foyer.' }); return null; }
    const target = members().find((m) => m.id === req.params.memberId);
    if (!target) { res.status(404).json({ error: 'Membre introuvable.' }); return null; }
    if (!target.enfant) { res.status(400).json({ error: 'Un bilan se fait pour un enfant. Un adulte s’entraîne librement, sans bilan.' }); return null; }
    return target;
  };
  /** La période demandée, en jours de Paris, fin incluse ; par défaut la semaine en cours, du lundi à aujourd'hui. */
  const period = (req: Request): { from: string; to: string } => {
    const today = dayOf(new Date().toISOString());
    const day = (v: unknown, what: string): string => {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T12:00:00Z'))) throw new Invalid(`${what} : une date AAAA-MM-JJ attendue.`);
      return v;
    };
    const from = req.query['from'] !== undefined ? day(req.query['from'], 'from') : mondayOf(today);
    const to = req.query['to'] !== undefined ? day(req.query['to'], 'to') : today;
    if (from > to) throw new Invalid('La période commence après sa fin.');
    if (addDays(from, 366) < to) throw new Invalid('Une période d’un an au plus.');
    return { from, to };
  };
  const bilanOf = (m: Member, p: { from: string; to: string }) => bilanFor({ id: m.id, name: m.name }, p.from, p.to, getMatieres(), (ex) => getBareme(ex).maitrise, getContext);

  /** Le bilan d'une période : par matière puis par exercice, comparé à la période précédente. */
  r.get('/members/:memberId/bilan', route((req, res) => {
    const m = childFor(req, res); if (!m) return;
    res.json(bilanOf(m, period(req)));
  }));

  /** Le même bilan en PDF, « Pour la maîtresse » : rien d'un autre membre, pas même qui l'a demandé. */
  r.get('/members/:memberId/bilan.pdf', route((req, res) => {
    const m = childFor(req, res); if (!m) return;
    const p = period(req);
    const pdf = bilanPdf(bilanOf(m, p), dayOf(new Date().toISOString()));
    log.info(`Révisions : ${currentMember(req as AuthedRequest)!.name} a téléchargé le bilan de ${m.name} (${p.from} au ${p.to}).`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="revisions-${m.name.normalize('NFD').replace(/[^\w-]+/g, '') || m.id}-${p.from}-${p.to}.pdf"`);
    res.send(pdf);
  }));

  /** Les sessions d'une période en CSV, pour un tableur. */
  r.get('/members/:memberId/sessions.csv', route((req, res) => {
    const m = childFor(req, res); if (!m) return;
    const p = period(req);
    const rows = sessionsBetween(m.id, addDays(p.from, -1) + 'T00:00:00.000Z', addDays(p.to, 2) + 'T00:00:00.000Z')
      .filter((s) => { const d = dayOf(s.started_at); return d >= p.from && d <= p.to; });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="revisions-sessions-${m.name.normalize('NFD').replace(/[^\w-]+/g, '') || m.id}-${p.from}-${p.to}.csv"`);
    res.send(sessionsCsv(rows, getContext));
  }));

  /** Le programme d'un enfant pour un exercice, réglé par un adulte. L'ancien reste en base : le passé ne change pas. */
  r.put('/members/:memberId/exercises/:exercise/program', route((req, res) => {
    const me = currentMember(req as AuthedRequest)!;
    if (me.enfant) { res.status(403).json({ error: 'Le programme se règle par un adulte du foyer.' }); return; }
    const target = members().find((m) => m.id === req.params.memberId);
    if (!target) { res.status(404).json({ error: 'Membre introuvable.' }); return; }
    if (!target.enfant) { res.status(400).json({ error: 'Un programme se règle pour un enfant. Un adulte s’entraîne librement.' }); return; }
    const d = exercise(req.params['exercise']);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const secs = (v: unknown, what: string): number | null => {
      if (v === null || v === undefined) return null;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.5 || v > 120) throw new Invalid(`${what} : entre 0,5 et 120 secondes, ou rien pour le barème.`);
      return Math.round(v * 10) / 10;
    };
    const secondsAllowed = secs(body['secondsAllowed'], 'Temps accordé'), fastSeconds = secs(body['fastSeconds'], 'Seuil rapide');
    if (secondsAllowed !== null && fastSeconds !== null && fastSeconds > secondsAllowed) throw new Invalid('Le seuil « rapide » ne peut pas dépasser le temps accordé.');
    const ctx = getContext(d.id), pp = params(d, body['params'], ctx);
    const p = setProgram({
      memberId: target.id, exerciseId: d.id, params: pp,
      questions: int(body['questions'], 5, 100, 'Questions par session'), secondsAllowed, fastSeconds,
      dailyGoal: int(body['dailyGoal'] ?? 1, 0, 10, 'Objectif par jour'), setBy: me.id,
    });
    log.info(`Révisions : ${me.name} a réglé le programme ${d.label} de ${target.name} (${d.summary(pp, ctx)}, ${p.questions} questions, objectif ${p.daily_goal} par jour).`);
    res.json({ program: programView(p) });
  }));

  /** Retirer le programme d'un exercice : il reste en base, inactif, avec son historique. */
  r.delete('/members/:memberId/exercises/:exercise/program', route((req, res) => {
    const me = currentMember(req as AuthedRequest)!;
    if (me.enfant) { res.status(403).json({ error: 'Le programme se règle par un adulte du foyer.' }); return; }
    const target = members().find((m) => m.id === req.params.memberId);
    if (!target) { res.status(404).json({ error: 'Membre introuvable.' }); return; }
    const d = exercise(req.params['exercise']);
    if (!stopProgram(target.id, d.id)) { res.status(404).json({ error: 'Pas de programme actif pour cet exercice.' }); return; }
    log.info(`Révisions : ${me.name} a retiré le programme ${d.label} de ${target.name}.`);
    res.json({ ok: true });
  }));

  /** L'exercice d'une route de contenu : il doit déclarer un paramètre de contenu. */
  const withContent = (id: unknown): ExerciseDef => {
    const d = exercise(id);
    if (!d.params.some((x) => x.type === 'content')) throw new Invalid(`L’exercice ${d.label} n’a pas de listes.`);
    return d;
  };
  const adultOnly = (req: Request, res: Response): Member | null => {
    const me = currentMember(req as AuthedRequest)!;
    if (me.enfant) { res.status(403).json({ error: 'Les listes se gèrent par un adulte du foyer.' }); return null; }
    return me;
  };
  const listBody = (body: Record<string, unknown>, partial: boolean): { label?: string; items?: string[] } => {
    const out: { label?: string; items?: string[] } = {};
    if (body['label'] !== undefined || !partial) {
      const l = typeof body['label'] === 'string' ? body['label'].trim() : '';
      if (!l || l.length > 60) throw new Invalid('Le nom de la liste : de 1 à 60 caractères.');
      out.label = l;
    }
    if (body['items'] !== undefined || !partial) {
      if (!Array.isArray(body['items'])) throw new Invalid('Les éléments : une liste attendue.');
      const items = [...new Set(body['items'].filter((x): x is string => typeof x === 'string').map((x) => x.normalize('NFC').trim().replace(/\s+/g, ' ')).filter(Boolean))];
      if (!items.length || items.length > MAX_ITEMS || items.some((x) => x.length > 40)) throw new Invalid(`Les éléments : de 1 à ${MAX_ITEMS}, de 40 caractères au plus chacun.`);
      out.items = items;
    }
    return out;
  };

  /** Les listes d'un exercice : livrées et du foyer. Ouvertes à tout membre, l'appareil en a besoin pour s'entraîner hors ligne. */
  r.get('/exercises/:exercise/content', route((req, res) => {
    const d = withContent(req.params['exercise']);
    res.json({ lists: getContext(d.id).lists });
  }));

  /** Une liste du foyer (la dictée de la semaine), saisie par un adulte. */
  r.post('/exercises/:exercise/content', route((req, res) => {
    const me = adultOnly(req, res); if (!me) return;
    const d = withContent(req.params['exercise']);
    const b = listBody((req.body ?? {}) as Record<string, unknown>, false);
    const l = createList(d.id, b.label!, b.items!, me.id);
    log.info(`Révisions : ${me.name} a créé la liste « ${l.label} » (${d.label}, ${l.items.length} éléments).`);
    res.status(201).json({ list: l });
  }));

  /** Modifier une liste du foyer, ou l'archiver (`archived`) : jamais l'effacer. Les listes livrées ne se modifient pas ici. */
  r.patch('/exercises/:exercise/content/:id', route((req, res) => {
    const me = adultOnly(req, res); if (!me) return;
    const d = withContent(req.params['exercise']);
    const id = foyerListId(String(req.params['id']));
    if (id === null) throw new Invalid('Seule une liste du foyer se modifie ; une liste livrée se change dans la configuration.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const l = updateList(d.id, id, { ...listBody(body, true), ...(typeof body['archived'] === 'boolean' ? { archived: body['archived'] } : {}) });
    if (!l) { res.status(404).json({ error: 'Liste introuvable.' }); return; }
    log.info(`Révisions : ${me.name} a ${body['archived'] === true ? 'archivé' : body['archived'] === false ? 'ressorti' : 'modifié'} la liste « ${l.label} » (${d.label}).`);
    res.json({ list: l });
  }));

  /**
   * Une session terminée (ou abandonnée), en un seul envoi. Idempotente par son
   * identifiant, généré sur l'appareil : la rejouer depuis une file hors ligne
   * ne la compte qu'une fois. Chaque question est relue et corrigée par la
   * définition de l'exercice, ici : juste ou faux se décide sur le serveur.
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
    const d = exercise(body['exerciseId']);
    const mode = body['mode'] as Mode;
    if (!MODES.includes(mode)) throw new Invalid('Mode inconnu : « apprendre », « entrainer » ou « test ».');
    if (mode === 'apprendre' && !d.learn) throw new Invalid(`L’exercice ${d.label} n’a pas de mode Apprendre.`);
    const programId = body['programId'] === null || body['programId'] === undefined ? null : int(body['programId'], 1, Number.MAX_SAFE_INTEGER, 'programId');
    const program = programId !== null ? programById(programId) : null;
    if (programId !== null && (!program || program.member_id !== me.id || program.exercise_id !== d.id)) throw new Invalid('Ce programme n’est pas le tien, ou pas pour cet exercice.');
    const ctx = getContext(d.id);
    const p = params(d, program ? JSON.parse(program.params_json) : body['params'], ctx);
    // Une question doit venir des réglages de la session : l'appareil ne peut pas inventer ses items.
    const universe = new Set(d.universe(p, ctx));
    const now = Date.now();
    // L'horloge de l'appareil fait foi, bornée : rien dans le futur.
    const clamp = (at: string): string => (Date.parse(at) > now + 5 * 60_000 ? new Date(now).toISOString() : at);
    const startedAt = clamp(iso(body['startedAt'], 'startedAt')), endedAt = clamp(iso(body['endedAt'], 'endedAt'));
    const timing = timingOf(d, me, parisDay(startedAt), program);
    // Le seuil appliqué à l'écran pendant la session, s'il est dit et plausible ; sinon celui du jour.
    const fastMs = typeof body['fastMs'] === 'number' && body['fastMs'] >= 300 && body['fastMs'] <= 120_000 ? Math.round(body['fastMs']) : timing.fastMs;
    const allowedMs = typeof body['allowedMs'] === 'number' && body['allowedMs'] >= 500 && body['allowedMs'] <= 120_000 ? Math.round(body['allowedMs']) : timing.allowedMs;
    const raw = body['answers'];
    if (!Array.isArray(raw) || raw.length > MAX_ANSWERS) throw new Invalid(`Réponses : une liste de ${MAX_ANSWERS} au plus attendue.`);
    const answers: AnswerIn[] = raw.map((x, i) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const q = d.parse(o['question'], p);
      if (q === null) throw new Invalid(`Réponse ${i + 1} : question illisible pour l’exercice ${d.label}.`);
      if (!universe.has(d.itemKey(q))) throw new Invalid(`Réponse ${i + 1} : question hors des réglages de la session.`);
      const given = o['given'] === null || o['given'] === undefined ? null : String(o['given']).slice(0, 200);
      const ms = int(Math.round(Number(o['ms'])), 0, 3_600_000, `Réponse ${i + 1}, ms`);
      const c = d.check(q, given ?? '');
      const result: Result = mode === 'apprendre' ? (given === null ? 'passe' : c.ok ? 'bon' : 'faux') : classify(c.ok, given, ms, fastMs);
      return { itemKey: d.itemKey(q), question: q, expected: c.expected, given, ms, askedAt: clamp(iso(o['askedAt'], `Réponse ${i + 1}, askedAt`)), result };
    });
    const sw = (req as AuthedRequest).switched;
    const out = recordSession({
      id, memberId: me.id, exerciseId: d.id, programId, mode, params: p, startedAt, endedAt, aborted: body['aborted'] === true,
      allowedMs, fastMs, device: appareil(String(req.headers['user-agent'] || ''), body['tactile'] === true), via: sw?.viaMemberId ?? null, answers,
    }, getBareme(d.id).maitrise);
    if (out.duplicate) { res.json({ duplicate: true, session: sessionView(out.session), changes: [] }); return; }
    const s = out.session;
    const duree = Math.max(0, Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 1000));
    log.info(`Révisions : session ${d.label} de ${me.name} reçue (${s.mode}, ${d.summary(p, ctx)}${s.aborted ? ', abandonnée' : ''}) : ${s.good} bonnes, ${s.slow} lentes, ${s.wrong} fausses, ${duree} s.`);
    const cfg = getBareme(d.id).maitrise;
    res.status(201).json({
      duplicate: false, session: sessionView(s),
      changes: out.changes.map((c) => ({ key: c.key, label: d.itemLabel(c.key), before: status(c.before ?? undefined, cfg), after: status(c.after ?? undefined, cfg), level: c.after?.level ?? null })),
    });
  }));

  return r;
}

/** L'énoncé d'une réponse enregistrée, relu par sa définition ; la clé brute si elle ne sait plus la lire. */
function textOf(d: ExerciseDef, questionJson: string): string {
  try { const q = d.parse(JSON.parse(questionJson), {}); return q === null ? '' : d.text(q); } catch { return ''; }
}
