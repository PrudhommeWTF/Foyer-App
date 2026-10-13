// Surface HTTP du module « École », montée sur /api/ecole derrière le drapeau
// de module (403 désactivé). Deux étages :
//   - la lecture (devoirs, cours, état) et la case « Fait », ouvertes aux
//     membres : un adulte voit tous les élèves associés, un enfant seulement
//     lui-même, contrôle fait ici sur chaque route (403 sinon) ;
//   - la configuration (comptes, question de sécurité, association,
//     sauvegarde), réservée aux administrateurs.
//
// Aucune réponse ne contient d'identifiant, de mot de passe, de jeton, ni le
// couple cn / cv : seulement « enregistrés le … » et « connu depuis le … ».
import express, { Request, Response, Router } from 'express';
import * as repo from './repo';
import * as svc from './service';
import * as backup from './backup';
import { edConfig } from './config';
import { inQuietWindow, nextRunAt } from './cadence';
import { Invalid, fail, id } from '../employes/http';
import { keyState, open } from '../storage/secret-box';
import { parisWall } from '../notify/reminders';
import { log } from '../log';
import { AuthedRequest, currentMember } from '../auth/session';
import { readDoc } from '../state/doc';
import { applyTaskOps } from '../tasks/repo';
import { addDays, localDone, parisToday } from './sync';
import { KEEP_DAYS } from './projection';
import { effectiveSetting } from '../settings/repo';

type Guard = (req: Request, res: Response, next: express.NextFunction) => void;

/** Comme le `makeHandler` d'Employés, pour des handlers asynchrones. */
const handler = (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response): void => {
    Promise.resolve().then(() => fn(req, res)).catch((e) => {
      if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
      log.erreur('École : erreur inattendue', e);
      res.status(500).json({ error: 'Erreur du module École : ' + (e as Error).message });
    });
  };

const text = (v: unknown, field: string, max: number, required = true): string => {
  const s = String(v ?? '').trim();
  if (!s && required) fail(`Le champ « ${field} » est requis.`);
  if (s.length > max) fail(`Le champ « ${field} » dépasse ${max} caractères.`);
  return s;
};

/** Un mot de passe n'est jamais rogné : une espace en bout peut en faire partie. */
const password = (v: unknown): string => {
  const s = String(v ?? '');
  if (!s) fail('Le champ « mot de passe » est requis.');
  if (s.length > 200) fail('Le mot de passe dépasse 200 caractères.');
  return s;
};

export type AccountState = 'ok' | 'jamais' | 'erreur' | 'qcm' | 'identifiants' | 'version' | 'cle' | 'pause' | 'pause-auto';

/** L'état affiché d'un compte. Une clé changée se voit tout de suite, sans attendre une connexion. */
function stateOf(a: repo.Account, now: Date): AccountState {
  if (a.blocked) return a.blocked;
  if (open(a.loginEnc) === null || open(a.passwordEnc) === null) return 'cle';
  if (!a.enabled) return 'pause';
  if (a.pausedUntil && Date.parse(a.pausedUntil) > now.getTime()) return 'pause-auto';
  if (a.lastSyncOk === null) return 'jamais';
  return a.lastSyncOk ? 'ok' : 'erreur';
}

function accountView(a: repo.Account, students: repo.Student[], now: Date) {
  const state = stateOf(a, now);
  return {
    id: a.id, label: a.label, accountType: a.accountType, state,
    credsSetAt: a.credsSetAt,
    trustedSince: a.trustedCnEnc && a.trustedCvEnc ? a.trustedAt : null,
    pendingQcm: a.pendingQcm,
    enabled: a.enabled,
    lastSyncAt: a.lastSyncAt, lastOkAt: a.lastOkAt,
    lastError: a.lastErrorAt ? { at: a.lastErrorAt, code: a.lastErrorCode, kind: a.lastErrorKind, message: a.lastErrorMessage } : null,
    consecutiveFailures: a.consecutiveFailures, pausedUntil: a.pausedUntil,
    /** Les administrateurs ont été prévenus de l'incident en cours, à cette date. */
    alertedAt: a.alertSentAt,
    nextRunAt: state === 'cle' ? null : nextRunAt(a, now, svc.cadence()),
    students: students.filter((s) => s.accountId === a.id).map((s) => ({
      id: s.id, firstName: s.firstName, lastName: s.lastName, className: s.className, schoolName: s.schoolName,
      memberId: s.memberId, matchSource: s.matchSource, linkState: s.linkState, halfBoard: s.halfBoard,
      dataOkAt: s.dataOkAt, dataError: s.dataError,
    })),
  };
}

const account = (raw: unknown): repo.Account => {
  const a = repo.getAccount(id(raw, 'compte'));
  if (!a || a.archivedAt) fail('Compte ÉcoleDirecte introuvable.');
  return a!;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayParam = (v: unknown, fallback: string): string => { const s = String(v ?? '').trim(); if (!s) return fallback; if (!DAY.test(s)) fail('Date invalide : attendu AAAA-MM-JJ.'); return s; };

/** Les élèves que la personne connectée peut voir : tous les associés pour un adulte, elle seule pour un enfant. */
function visibleStudents(req: Request): repo.Student[] {
  const me = currentMember(req as AuthedRequest);
  if (!me) return [];
  const linked = repo.listStudents().filter((s) => s.linkState === 'confirme' && s.memberId);
  return me.enfant ? linked.filter((s) => s.memberId === me.id) : linked;
}

/** L'élève visé par la route, s'il est visible ; 403 sinon (même réponse qu'il existe ou non). */
function studentFor(req: Request, raw: unknown): repo.Student | null {
  const sid = id(raw, 'élève');
  return visibleStudents(req).find((s) => s.id === sid) ?? null;
}

function studentView(s: repo.Student, now: Date) {
  const a = repo.getAccount(s.accountId);
  return {
    id: s.id, memberId: s.memberId, firstName: s.firstName, lastName: s.lastName, className: s.className, schoolName: s.schoolName,
    halfBoard: s.halfBoard, dataOkAt: s.dataOkAt, dataError: s.dataError, dataErrorAt: s.dataErrorAt,
    account: a ? { state: stateOf(a, now), lastOkAt: a.lastOkAt, lastError: a.lastErrorMessage, pausedUntil: a.pausedUntil } : null,
  };
}

/** Un devoir tel que l'écran le montre. « Fait » est la coche de la tâche quand elle existe. */
function homeworkView(h: repo.Homework, tasks: Map<string, { done: boolean }>, memberId: string | null) {
  const task = h.taskId ? tasks.get(h.taskId) : undefined;
  const done = localDone(h, task);
  const synced = h.doneSynced ?? h.doneEd;
  return {
    id: h.id, studentId: h.studentId, memberId, due: h.due, subject: h.subject, teacher: h.teacher,
    html: h.contentHtml, text: h.contentText, isTest: h.isTest, online: h.online, givenOn: h.givenOn,
    done, pending: done !== synced, doneError: done !== synced ? h.doneError : null,
    modifiedAt: h.modifiedAt, archived: !!h.archivedAt, taskId: task ? h.taskId : null,
  };
}

const docTasks = (): Map<string, { done: boolean }> => {
  const { doc } = readDoc();
  return new Map((Array.isArray(doc['tasks']) ? doc['tasks'] : []).map((t: { id: string; done: boolean }) => [t.id, t]));
};

export function ecoleRouter(requireAdmin: Guard, memberIds: () => string[]): Router {
  const r = express.Router();

  // ---- Lecture et « Fait » : tout membre, filtré par élève -----------------
  const member = express.Router();
  member.use(express.json({ limit: '16kb' }));

  /** Les élèves visibles, leur état, et leurs devoirs de la semaine passée à l'horizon réglé. */
  member.get('/vue', handler((req, res) => {
    const now = new Date();
    const today = parisToday(now);
    const students = visibleStudents(req);
    const tasks = docTasks();
    const byId = new Map(students.map((s) => [s.id, s]));
    const homework = repo.listHomework(students.map((s) => s.id), addDays(today, -KEEP_DAYS), addDays(today, Number(effectiveSetting('ecoleDevoirsJours')) || 14))
      .map((h) => homeworkView(h, tasks, byId.get(h.studentId)?.memberId ?? null));
    res.json({ today, students: students.map((s) => studentView(s, now)), homework });
  }));

  member.get('/eleves/:id/devoirs', handler((req, res) => {
    const s = studentFor(req, req.params['id']);
    if (!s) { res.status(403).json({ error: 'Ces devoirs ne vous sont pas accessibles.' }); return; }
    const today = parisToday();
    const tasks = docTasks();
    const from = dayParam(req.query['from'], addDays(today, -KEEP_DAYS));
    const to = dayParam(req.query['to'], addDays(today, 30));
    res.json({ student: studentView(s, new Date()), homework: repo.listHomework([s.id], from, to, req.query['archives'] === '1').map((h) => homeworkView(h, tasks, s.memberId)) });
  }));

  /** Les cours importés des élèves visibles (ou d'un seul), pour l'emploi du temps et la présence. */
  const lessons = (students: repo.Student[], req: Request) => {
    const today = parisToday();
    const from = dayParam(req.query['from'], addDays(today, -7));
    const to = dayParam(req.query['to'], addDays(today, 35));
    const byId = new Map(students.map((s) => [s.id, s]));
    return repo.listLessons(students.map((s) => s.id), from, to).map((l) => ({
      id: l.id, studentId: l.studentId, memberId: byId.get(l.studentId)?.memberId ?? null, halfBoard: byId.get(l.studentId)?.halfBoard ?? true,
      day: l.day, start: l.start, end: l.end, subject: l.subject, teacher: l.teacher, room: l.room, kind: l.kind, cancelled: l.cancelled, modified: l.modified,
    }));
  };
  member.get('/cours', handler((req, res) => { res.json({ lessons: lessons(visibleStudents(req), req) }); }));
  member.get('/eleves/:id/cours', handler((req, res) => {
    const s = studentFor(req, req.params['id']);
    if (!s) { res.status(403).json({ error: 'Cet emploi du temps ne vous est pas accessible.' }); return; }
    res.json({ lessons: lessons([s], req) });
  }));

  /**
   * La case « Fait ». Quand la tâche projetée existe, c'est elle qu'on coche :
   * l'écran École et les Tâches disent la même chose. Le renvoi à ÉcoleDirecte
   * se fait à la synchronisation suivante.
   */
  member.post('/devoirs/:id/fait', handler((req, res) => {
    const h = repo.getHomework(id(req.params['id'], 'devoir'));
    const s = h ? studentFor(req, h.studentId) : null;
    if (!h || !s) { res.status(403).json({ error: 'Ce devoir ne vous est pas accessible.' }); return; }
    const fait = (req.body as Record<string, unknown>)['fait'] === true;
    const me = currentMember(req as AuthedRequest);
    const tasks = docTasks();
    if (h.taskId && tasks.has(h.taskId)) {
      applyTaskOps([{ op: fait ? 'done' : 'reopen', opId: `ed-fait-${h.id}-${Date.now().toString(36)}`, id: h.taskId, by: me?.id ?? null, at: new Date().toISOString() }]);
    } else {
      repo.patchHomework(h.id, { doneLocal: fait });
    }
    log.info(`École : devoir ${h.id} marqué ${fait ? 'fait' : 'à faire'} par ${me?.name || 'un membre'} (envoi à ÉcoleDirecte au prochain passage).`);
    res.json({ homework: homeworkView(repo.getHomework(h.id)!, docTasks(), s.memberId) });
  }));

  r.use(member);

  // ---- Configuration : administrateurs ------------------------------------
  r.use(requireAdmin);

  // Avant l'analyseur commun, borné à 64 Ko : une sauvegarde est plus grosse.
  r.post('/restore', express.json({ limit: '20mb' }), handler((req, res) => {
    const b = req.body as Record<string, unknown>;
    if (b['confirm'] !== 'REMPLACER') { res.status(400).json({ error: 'Confirmation requise : renvoyez confirm="REMPLACER".' }); return; }
    try {
      const report = backup.restoreModule(b['backup']);
      log.info('École : module restauré depuis une sauvegarde.');
      res.json(report);
    } catch (e) {
      if (e instanceof backup.RestoreRefused) { res.status(400).json({ error: e.message }); return; }
      throw e;
    }
  }));

  r.use(express.json({ limit: '64kb' }));

  const view = (a: repo.Account) => accountView(repo.getAccount(a.id)!, repo.listStudents(), new Date());

  r.get('/etat', handler((_req, res) => {
    const now = new Date();
    const students = repo.listStudents();
    const cfg = edConfig();
    res.json({
      keyState: keyState(),
      apiBase: cfg.base, apiVersion: cfg.version,
      inPause: inQuietWindow(parisWall(now), svc.cadence()),
      accounts: repo.listAccounts().map((a) => accountView(a, students, now)),
      journal: repo.listLog(40),
    });
  }));

  r.post('/comptes', handler(async (req, res) => {
    const b = req.body as Record<string, unknown>;
    if (keyState() !== 'ok') fail('Impossible d’enregistrer des identifiants : la clé de chiffrement FOYER_SECRET_KEY est ' + (keyState() === 'absente' ? 'absente' : 'trop courte') + '. Voir docs/ecole.md.');
    const out = await svc.createAccount(text(b['label'], 'libellé', 80), text(b['identifiant'], 'identifiant', 120), password(b['motdepasse']));
    res.status(201).json({ result: out.result, account: view(repo.getAccount(out.id)!) });
  }));

  r.put('/comptes/:id', handler(async (req, res) => {
    const a = account(req.params['id']);
    const b = req.body as Record<string, unknown>;
    const label = b['label'] !== undefined ? text(b['label'], 'libellé', 80) : null;
    const withCreds = b['identifiant'] !== undefined || b['motdepasse'] !== undefined;
    if (withCreds && keyState() !== 'ok') fail('Impossible d’enregistrer des identifiants : la clé de chiffrement FOYER_SECRET_KEY est absente ou trop courte.');
    svc.updateAccount(a.id, label, withCreds ? text(b['identifiant'], 'identifiant', 120) : null, withCreds ? password(b['motdepasse']) : null);
    // De nouveaux identifiants s'essaient tout de suite : c'est la réponse qu'on attend en les saisissant.
    const result = withCreds && repo.getAccount(a.id)!.enabled ? await svc.connect(a.id) : null;
    res.json({ result, account: view(a) });
  }));

  r.post('/comptes/:id/connexion', handler(async (req, res) => {
    const a = svc.releaseBlocks(account(req.params['id']));
    if (a.blocked === 'qcm') fail('Répondez d’abord à la question de sécurité.');
    if (a.blocked === 'identifiants') fail('ÉcoleDirecte a refusé ces identifiants : ressaisissez-les avant de réessayer.');
    if (a.blocked === 'cle' || stateOf(a, new Date()) === 'cle') fail('Identifiants à ressaisir : la clé de chiffrement a changé.');
    // Le bouton reste un geste humain, mais pas un marteau : une tentative par minute.
    if (a.lastSyncAt && Date.now() - Date.parse(a.lastSyncAt) < 60_000) { res.status(429).json({ error: 'Une connexion vient d’avoir lieu : patientez une minute avant de réessayer.' }); return; }
    const result = await svc.connect(a.id);
    res.json({ result, account: view(a) });
  }));

  r.post('/comptes/:id/qcm', handler(async (req, res) => {
    const a = account(req.params['id']);
    const choix = Number((req.body as Record<string, unknown>)['choix']);
    if (!Number.isInteger(choix) || choix < 0) fail('Choisissez une des propositions.');
    const result = await svc.answerQcm(a.id, choix);
    res.json({ result, account: view(a) });
  }));

  r.post('/comptes/:id/pause', handler((req, res) => {
    const a = account(req.params['id']);
    svc.setPaused(a.id, (req.body as Record<string, unknown>)['pause'] === true);
    res.json({ account: view(a) });
  }));

  r.delete('/comptes/:id', handler((req, res) => {
    const a = account(req.params['id']);
    repo.archiveAccount(a.id, new Date().toISOString());
    log.info(`École : compte ${a.id} « ${a.label} » retiré, identifiants effacés.`);
    res.json({ ok: true });
  }));

  // Association d'un élève à un membre : confirmer la proposition, choisir à la
  // main, ignorer l'élève, ou défaire.
  r.put('/eleves/:id', handler((req, res) => {
    const s = repo.getStudent(id(req.params['id'], 'élève'));
    if (!s || s.archivedAt) fail('Élève introuvable.');
    const b = req.body as Record<string, unknown>;
    const action = String(b['action'] ?? '');
    if (action === 'confirmer') {
      if (s!.linkState !== 'propose' || !s!.memberId) fail('Aucune association proposée à confirmer.');
      repo.setLink(s!.id, s!.memberId, s!.matchSource, 'confirme');
    } else if (action === 'associer') {
      const memberId = text(b['memberId'], 'membre', 64);
      if (!memberIds().includes(memberId)) fail('Membre du foyer introuvable.');
      repo.setLink(s!.id, memberId, s!.memberId === memberId && s!.matchSource === 'prenom' ? 'prenom' : 'manuel', 'confirme');
    } else if (action === 'ignorer') {
      repo.setLink(s!.id, null, null, 'ignore');
    } else if (action === 'dissocier') {
      repo.setLink(s!.id, null, null, 'aucun');
    } else if (action === 'demi-pension') {
      repo.patchStudent(s!.id, { halfBoard: b['halfBoard'] === true });
    } else fail('Action inconnue : confirmer, associer, ignorer, dissocier ou demi-pension.');
    const after = repo.getStudent(s!.id)!;
    log.info(`École : élève ${after.id} (compte ${after.accountId}) : ${action}${after.memberId ? ' → membre ' + after.memberId : ''}.`);
    res.json({ account: view(repo.getAccount(after.accountId)!) });
  }));

  r.get('/export.json', handler((_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="foyer-ecole-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(backup.exportModule());
  }));

  return r;
}
