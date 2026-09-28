// Surface HTTP du module « Employé à domicile », montée sur /api/employes,
// derrière `requireAdulte` (jamais les enfants). Les gestes de configuration
// (créer un employé, changer le taux) exigent en plus un administrateur.
// Écritures granulaires : rien ici ne lit ni ne réécrit le document JSON.
import express, { Request, Response, Router } from 'express';
import * as repo from './repo';
import * as backup from './backup';
import { fail, id, makeHandler } from './http';
import { AuthedRequest, currentMember } from '../auth/session';
import { effectiveSetting } from '../settings/repo';
import { log } from '../log';

type AdminGuard = (req: Request, res: Response, next: express.NextFunction) => void;

const handler = makeHandler('Employés : erreur inattendue', 'Erreur du module Employé à domicile : ');
const author = (req: Request): string | null => currentMember(req as AuthedRequest)?.id ?? null;

const trimmed = (v: unknown, field: string, max = 200, required = true): string => {
  const s = String(v ?? '').trim();
  if (!s && required) fail(`Le champ « ${field} » est requis.`);
  if (s.length > max) fail(`Le champ « ${field} » dépasse ${max} caractères.`);
  return s;
};
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isMonthStr = (s: string): boolean => /^\d{4}-\d{2}$/.test(s);
const dayField = (v: unknown, field: string): string => { const s = String(v ?? '').trim(); if (!isDay(s)) fail(`Date invalide pour « ${field} » : attendu AAAA-MM-JJ.`); return s; };
const monthField = (v: unknown, field: string): string => { const s = String(v ?? '').trim(); if (!isMonthStr(s)) fail(`Mois invalide pour « ${field} » : attendu AAAA-MM.`); return s; };
const optionalDay = (v: unknown, field: string): string | null => { const s = String(v ?? '').trim(); return s ? dayField(s, field) : null; };
/** Durée en minutes, multiple de 15, bornée à 24 h. */
const minutesField = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 1440 || n % 15 !== 0) fail('Durée invalide : un nombre de minutes positif, multiple de 15 (par exemple 180 pour 3 h).');
  return n;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], field: string, fallback?: T): T => {
  const s = String(v ?? '').trim() as T;
  if (!s && fallback) return fallback;
  if (!allowed.includes(s)) fail(`Valeur invalide pour « ${field} » : attendu ${allowed.join(', ')}.`);
  return s;
};
/** Un montant en euros (« 14,50 ») vers des centimes entiers. */
const eurosToCents = (v: unknown, field: string): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n < 0 || n > 1000) fail(`Montant invalide pour « ${field} » : un nombre d'euros, par exemple 14,50.`);
  return Math.round(n * 100);
};
const optionalCents = (v: unknown, field: string): number | null => (v === undefined || v === null || v === '' ? null : eurosToCents(v, field));

/** L'employé visé par la requête : `employee` (identifiant) ou, à défaut, l'employé principal. */
function resolveEmployee(req: Request): repo.Employee {
  const raw = req.query['employee'] ?? (req.body as Record<string, unknown>)?.['employee'];
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const e = repo.getEmployee(id(raw, 'employee'));
    if (!e || e.archivedAt) fail('Employé introuvable.');
    return e!;
  }
  const p = repo.primaryEmployee();
  if (!p) fail('Aucun employé configuré. Créez-en un dans les Paramètres.');
  return p!;
}

const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
/** Refuse une écriture de présence sur un mois figé. */
function ensureOpen(employeeId: number, month: string): void {
  const st = repo.monthStatus(employeeId, month);
  if (repo.isFrozen(st)) fail(`Le mois ${month} est ${st === 'paye' ? 'payé' : 'déclaré'} : rouvrez-le pour modifier ses présences.`);
}

export function employesRouter(requireAdmin: AdminGuard): Router {
  const r = express.Router();
  r.use(express.json({ limit: '256kb' }));

  // ---- Lecture ----
  r.get('/bootstrap', handler((_req, res) => {
    const t = today();
    const employees = repo.listEmployees(false).map((e) => {
      const rate = repo.currentRate(e.id, t);
      return {
        ...e,
        currentRate: rate ? { netHourlyCents: rate.netHourlyCents, effectiveFrom: rate.effectiveFrom } : null,
        // Les mois à déclarer (présences non déclarées) : le repère d'agenda les
        // pose au jour de rappel du mois suivant.
        openMonths: repo.openMonthsWithPresence(e.id),
      };
    });
    res.json({
      employees,
      congesInclus: effectiveSetting('empCongesInclus') === true,
      dureeHabituelle: Number(effectiveSetting('empDureeHabituelle')) || 180,
      rappelJour: Number(effectiveSetting('empRappelJour')) || 3,
    });
  }));

  r.get('/rates', handler((req, res) => { const e = resolveEmployee(req); res.json({ employeeId: e.id, rates: repo.ratesOf(e.id) }); }));

  r.get('/month', handler((req, res) => {
    const e = resolveEmployee(req);
    const month = req.query['month'] ? monthField(req.query['month'], 'month') : today().slice(0, 7);
    res.json(repo.computeMonth(e.id, month));
  }));

  r.get('/shifts', handler((req, res) => {
    const e = resolveEmployee(req);
    if (req.query['month']) { res.json({ employeeId: e.id, shifts: repo.shiftsOfMonth(e.id, monthField(req.query['month'], 'month')) }); return; }
    const to = req.query['to'] ? dayField(req.query['to'], 'to') : today();
    const from = req.query['from'] ? dayField(req.query['from'], 'from') : (() => { const d = new Date(to + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 31); return d.toISOString().slice(0, 10); })();
    res.json({ employeeId: e.id, from, to, shifts: repo.shiftsBetween(e.id, from, to) });
  }));

  // ---- Présences (adultes) ----
  r.post('/shifts', handler((req, res) => {
    const e = resolveEmployee(req);
    const b = req.body as Record<string, unknown>;
    const day = b['day'] ? dayField(b['day'], 'day') : today();
    ensureOpen(e.id, day.slice(0, 7));
    const minutes = b['minutes'] !== undefined ? minutesField(b['minutes']) : (Number(effectiveSetting('empDureeHabituelle')) || 180);
    const note = trimmed(b['note'], 'note', 500, false);
    // Doublon du jour : on ne l'ajoute pas en silence, on le signale. `force` passe outre (second passage assumé).
    const existing = repo.shiftOn(e.id, day);
    if (existing && b['force'] !== true) { res.json({ duplicate: existing }); return; }
    const shift = repo.addShift(e.id, day, minutes, note, author(req));
    log.info(`Employé : présence ajoutée (${e.name}, ${day}, ${minutes} min) par ${author(req) || 'inconnu'}.`);
    res.status(201).json({ shift });
  }));

  r.put('/shifts/:id', handler((req, res) => {
    const shiftId = id(req.params['id'], 'id');
    const s = repo.getShift(shiftId); if (!s) fail('Présence introuvable.');
    const b = req.body as Record<string, unknown>;
    const day = b['day'] !== undefined ? dayField(b['day'], 'day') : s!.day;
    ensureOpen(s!.employeeId, s!.day.slice(0, 7));
    if (day !== s!.day) ensureOpen(s!.employeeId, day.slice(0, 7));
    const patch = {
      day,
      minutes: b['minutes'] !== undefined ? minutesField(b['minutes']) : undefined,
      note: b['note'] !== undefined ? trimmed(b['note'], 'note', 500, false) : undefined,
    };
    const shift = repo.editShift(shiftId, patch, author(req));
    log.info(`Employé : présence ${shiftId} modifiée par ${author(req) || 'inconnu'}.`);
    res.json({ shift });
  }));

  r.post('/shifts/:id/archive', handler((req, res) => {
    const shiftId = id(req.params['id'], 'id');
    const s = repo.getShift(shiftId); if (!s) fail('Présence introuvable.');
    ensureOpen(s!.employeeId, s!.day.slice(0, 7));
    repo.archiveShift(shiftId, author(req));
    log.info(`Employé : présence ${shiftId} retirée (archivée) par ${author(req) || 'inconnu'}.`);
    res.json({ ok: true });
  }));

  // ---- Mois (adultes) ----
  r.post('/month/declare', handler((req, res) => {
    const e = resolveEmployee(req); const b = req.body as Record<string, unknown>;
    const month = monthField(b['month'], 'month');
    const date = optionalDay(b['date'], 'date') || today();
    const conges = effectiveSetting('empCongesInclus') === true;
    const recap = repo.declareMonth(e.id, month, date, conges, trimmed(b['note'], 'note', 500, false), author(req));
    log.info(`Employé : mois ${month} déclaré (${e.name}) par ${author(req) || 'inconnu'}.`);
    res.json(recap);
  }));
  r.post('/month/pay', handler((req, res) => {
    const e = resolveEmployee(req); const b = req.body as Record<string, unknown>;
    const month = monthField(b['month'], 'month');
    const date = optionalDay(b['date'], 'date') || today();
    const recap = repo.payMonth(e.id, month, date, optionalCents(b['urssaf_total'], 'urssaf_total'), author(req));
    log.info(`Employé : mois ${month} marqué payé (${e.name}) par ${author(req) || 'inconnu'}.`);
    res.json(recap);
  }));
  r.post('/month/reopen', handler((req, res) => {
    const e = resolveEmployee(req); const month = monthField((req.body as Record<string, unknown>)['month'], 'month');
    const recap = repo.reopenMonth(e.id, month, author(req));
    log.info(`Employé : mois ${month} rouvert (${e.name}) par ${author(req) || 'inconnu'}.`);
    res.json(recap);
  }));
  r.post('/month/no-presence', handler((req, res) => {
    const e = resolveEmployee(req); const month = monthField((req.body as Record<string, unknown>)['month'], 'month');
    const recap = repo.markNoPresence(e.id, month, author(req));
    log.info(`Employé : mois ${month} marqué sans présence (${e.name}) par ${author(req) || 'inconnu'}.`);
    res.json(recap);
  }));

  // ---- Configuration (administrateur) ----
  r.post('/employees', requireAdmin, handler((req, res) => {
    const b = req.body as Record<string, unknown>;
    const name = trimmed(b['name'], 'name', 120);
    const role = oneOf(b['role'], repo.EMP_ROLES, 'role', 'menage');
    const e = repo.createEmployee(name, role);
    // Taux personnalisé posé à la création : une première ligne d'historique
    // datée d'aujourd'hui. Chaque employé porte le sien, il n'y a pas de taux global.
    if (b['euros'] !== undefined && b['euros'] !== null && b['euros'] !== '') {
      repo.addRate(e.id, eurosToCents(b['euros'], 'euros'), today(), author(req));
    }
    log.info(`Employé : « ${name} » (${role}) créé par ${author(req) || 'inconnu'}.`);
    res.status(201).json({ employee: e });
  }));
  r.put('/employees/:id', requireAdmin, handler((req, res) => {
    const empId = id(req.params['id'], 'id'); const b = req.body as Record<string, unknown>;
    const patch = {
      name: b['name'] !== undefined ? trimmed(b['name'], 'name', 120) : undefined,
      role: b['role'] !== undefined ? oneOf(b['role'], repo.EMP_ROLES, 'role') : undefined,
      active: b['active'] !== undefined ? b['active'] === true : undefined,
    };
    const e = repo.editEmployee(empId, patch); if (!e) fail('Employé introuvable.');
    res.json({ employee: e });
  }));
  r.post('/employees/:id/archive', requireAdmin, handler((req, res) => {
    if (!repo.archiveEmployee(id(req.params['id'], 'id'))) fail('Employé introuvable ou déjà archivé.');
    res.json({ ok: true });
  }));

  // Le taux : une ligne d'historique datée par employé (emp_rates). Le calcul
  // d'un mois lit cet historique, le taux en vigueur le jour de chaque présence.
  r.put('/taux', requireAdmin, handler((req, res) => {
    const e = resolveEmployee(req); const b = req.body as Record<string, unknown>;
    const cents = eurosToCents(b['euros'] ?? b['montant'], 'euros');
    const effectiveFrom = b['effective_from'] ? dayField(b['effective_from'], 'effective_from') : today();
    const rate = repo.addRate(e.id, cents, effectiveFrom, author(req));
    log.info(`Employé : taux réglé à ${(cents / 100).toFixed(2)} € (effet ${effectiveFrom}, ${e.name}) par ${author(req) || 'inconnu'}.`);
    res.json({ rate, rates: repo.ratesOf(e.id) });
  }));

  // ---- Sauvegarde / restauration du module (administrateur) ----
  r.get('/export.json', requireAdmin, handler((_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="employes-${today()}.json"`);
    res.json(backup.exportModule());
  }));
  r.post('/restore', requireAdmin, handler((req, res) => {
    const b = req.body as Record<string, unknown>;
    if (b['confirm'] !== 'REMPLACER') fail('Restauration non confirmée : envoyez « confirm: "REMPLACER" » pour écraser les données du module.');
    try {
      const report = backup.restoreModule(b['backup']);
      log.info(`Employé : module restauré par ${author(req) || 'inconnu'}.`);
      res.json(report);
    } catch (e) {
      if (e instanceof backup.RestoreRefused) fail(e.message);
      throw e;
    }
  }));

  return r;
}
