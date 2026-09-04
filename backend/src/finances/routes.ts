// HTTP surface of the finances module. Mounted at /api/finances behind the same
// JWT auth as the rest of the API. Operations are granular: nothing here reads or
// rewrites the household JSON document.
import express, { NextFunction, Request, Response, Router } from 'express';
import * as repo from './repo';
import { exportCsv, monthSummary } from './repo';
import { isIsoDate, isMonth, parseCents } from './money';
import { dashboard } from './dashboard';
import { attachmentsRouter } from './attachments-routes';
import * as backup from './backup';
import { effectiveSetting } from '../settings/repo';
import { contractsRouter } from './contracts-routes';
import * as contracts from './contracts';
import * as energy from './energy';
import * as savings from './savings';
import { energyRouter } from './energy-routes';
import { importRouter } from './import-routes';
import { rulesRouter } from './rules-routes';
import * as loans from './loans';
import { ACCOUNT_KINDS, LoanTerms, TX_KINDS, TxKind } from './types';
import { log } from '../log';

/** Reject with an explicit French message rather than a bare 400. */
class Invalid extends Error {}
const fail = (msg: string): never => { throw new Invalid(msg); };

function str(v: unknown, field: string, { max = 200, required = true } = {}): string {
  const s = String(v ?? '').trim();
  if (!s && required) fail(`Le champ « ${field} » est requis.`);
  if (s.length > max) fail(`Le champ « ${field} » dépasse ${max} caractères.`);
  return s;
}

function amountCents(v: unknown, field: string): number {
  const c = parseCents(v as string);
  if (c === null) fail(`Montant invalide pour « ${field} » : saisissez un nombre, par exemple -84,30.`);
  return c as number;
}

function isoDate(v: unknown, field: string): string {
  const s = String(v ?? '').trim();
  if (!isIsoDate(s)) fail(`Date invalide pour « ${field} » : attendu AAAA-MM-JJ, reçu « ${s} ».`);
  return s;
}

function optionalIsoDate(v: unknown, field: string): string | null {
  const s = String(v ?? '').trim();
  return s ? isoDate(s, field) : null;
}

function id(v: unknown, field: string): number {
  const n = parseInt(String(v ?? ''), 10);
  if (!Number.isInteger(n) || n <= 0) fail(`Identifiant invalide pour « ${field} ».`);
  return n;
}

function optionalId(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string, fallback?: T): T {
  const s = String(v ?? '').trim() as T;
  if (!s && fallback) return fallback;
  if (!allowed.includes(s)) fail(`Valeur invalide pour « ${field} » : attendu ${allowed.join(', ')}.`);
  return s;
}

/** Wrap a handler so validation errors become 400s with their own message. */
function handler(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    try { fn(req, res); }
    catch (e) {
      if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
      log.erreur('Finances : erreur inattendue', e);
      res.status(500).json({ error: 'Erreur interne du module Finances : ' + (e as Error).message });
    }
  };
}

/**
 * Identifiants de membres, dédoublonnés et bornés. Ils viennent du document du
 * foyer et non d'une table : on ne peut donc pas les vérifier par clé étrangère,
 * seulement les nettoyer.
 */
function memberIds(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : [];
  if (raw.length > 20) fail('Trop de personnes sélectionnées.');
  const out = raw.map((m) => String(m ?? '').trim().slice(0, 40)).filter(Boolean);
  return [...new Set(out)];
}

/**
 * Termes du prêt, pour un compte de crédit. Tout vide veut dire « pas encore
 * saisi » : le compte existe, il ne calcule rien, et l'écran le dit. Dès qu'un
 * champ est rempli, les quatre obligatoires le deviennent, sinon on garderait
 * un prêt à moitié saisi qui ne produit qu'un écran vide inexplicable.
 */
function loanTerms(body: Record<string, unknown>): LoanTerms | null {
  const raw = (body['loan'] || {}) as Record<string, unknown>;
  const given = ['principal', 'rateBp', 'payment', 'insurance', 'firstOn']
    .some((k) => raw[k] !== undefined && raw[k] !== '' && raw[k] !== null);
  if (!given) return null;
  const terms: LoanTerms = {
    principal: amountCents(raw['principal'], 'capital emprunté'),
    rateBp: ratePoints(raw['rateBp']),
    payment: amountCents(raw['payment'], 'mensualité'),
    insurance: raw['insurance'] === undefined || raw['insurance'] === '' ? 0 : amountCents(raw['insurance'], 'assurance'),
    firstOn: str(raw['firstOn'], 'date de première échéance'),
  };
  if (!isIsoDate(terms.firstOn)) fail('Date de première échéance invalide : attendu AAAA-MM-JJ.');
  try { loans.checkTerms(terms); }
  catch (e) { fail((e as Error).message); }
  return terms;
}

/** Taux annuel, saisi en pourcentage (« 3,45 »), stocké en points de base. */
function ratePoints(v: unknown): number {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 30) fail('Taux annuel invalide : attendu un pourcentage entre 0 et 30.');
  return Math.round(n * 100);
}

function accountInput(body: Record<string, unknown>): repo.AccountInput {
  const kind = oneOf(body['kind'], ACCOUNT_KINDS, 'type de compte', 'courant');
  return {
    name: str(body['name'], 'nom du compte'),
    kind,
    memberIds: memberIds(body['memberIds']),
    openingBalance: body['openingBalance'] === undefined || body['openingBalance'] === '' ? 0 : amountCents(body['openingBalance'], 'solde d’ouverture'),
    openingDate: optionalIsoDate(body['openingDate'], 'date d’ouverture'),
    archived: !!body['archived'],
    loan: kind === 'credit' ? loanTerms(body) : null,
  };
}

function categoryInput(body: Record<string, unknown>): repo.CategoryInput {
  const parentId = optionalId(body['parentId']);
  if (parentId) {
    const parent = repo.getCategory(parentId);
    if (!parent) fail('Catégorie parente introuvable.');
    if (parent!.parentId) fail('Les catégories ont deux niveaux : une sous-catégorie ne peut pas en contenir une autre.');
  }
  return {
    parentId,
    name: str(body['name'], 'nom de la catégorie', { max: 80 }),
    monthlyBudget: body['monthlyBudget'] === undefined || body['monthlyBudget'] === '' ? 0 : Math.abs(amountCents(body['monthlyBudget'], 'budget mensuel')),
    color: str(body['color'], 'couleur', { max: 20, required: false }) || '#7A9B76',
    icon: str(body['icon'], 'icône', { max: 40, required: false }) || 'facture',
  };
}

function txInput(body: Record<string, unknown>): repo.TxInput {
  const accountId = id(body['accountId'], 'compte');
  const account = repo.getAccount(accountId) ?? fail('Compte introuvable.');
  // Un compte de crédit ne tient pas de registre : son capital restant dû se
  // calcule à partir des termes du prêt. Y écrire des opérations créerait une
  // seconde source de vérité, et les deux divergeraient dès la première
  // échéance. Un remboursement anticipé se saisit en recalant le capital
  // restant dû à sa date.
  if (account.kind === 'credit') {
    fail(
      `« ${account.name} » est un compte de crédit : son capital restant dû vient des termes du prêt, `
      + 'pas d’opérations. Pour un remboursement anticipé ou une renégociation, ressaisissez le capital '
      + 'restant dû à sa date dans la fiche du compte.',
    );
  }
  const amount = amountCents(body['amount'], 'montant');
  const kind = oneOf<TxKind>(body['kind'], TX_KINDS, 'type d’opération', amount >= 0 ? 'recette' : 'depense');
  if (kind === 'depense' && amount > 0) fail('Une dépense doit avoir un montant négatif.');
  if (kind === 'recette' && amount < 0) fail('Une recette doit avoir un montant positif.');
  if (amount === 0) fail('Le montant ne peut pas être nul.');
  const categoryId = optionalId(body['categoryId']);
  if (categoryId && !repo.getCategory(categoryId)) fail('Catégorie introuvable.');
  const label = str(body['label'], 'libellé', { max: 300 });
  return {
    accountId, date: isoDate(body['date'], 'date'), amount, kind,
    label, labelRaw: String(body['labelRaw'] ?? label).trim() || label,
    categoryId, contractId: optionalId(body['contractId']),
    notes: str(body['notes'], 'notes', { max: 2000, required: false }),
    cleared: !!body['cleared'],
  };
}

/** L'état de chaque prêt, indexé par compte. Les comptes sans prêt n'y sont pas. */
function loanViews(): Record<number, loans.LoanView> {
  const out: Record<number, loans.LoanView> = {};
  for (const a of repo.listAccounts()) {
    const v = loans.loanView(a);
    if (v) out[a.id] = v;
  }
  return out;
}

/**
 * Le garde d'administration, fourni par le serveur : le module n'a pas à savoir
 * comment un administrateur se reconnaît, seulement à demander la vérification.
 */
export type AdminGuard = (req: Request, res: Response, next: NextFunction) => void;

/**
 * Qui est derrière la requête, pour les lignes de journal. Le garde
 * d'administration a déjà résolu le membre : on le relit là où il l'a posé,
 * plutôt que d'apprendre à ce module ce qu'est un foyer.
 */
const who = (req: Request): string =>
  (req as Request & { user?: { email?: string } }).user?.email || '(compte inconnu)';

export function financesRouter(requireAdmin: AdminGuard): Router {
  const r = express.Router();

  // Import, deduplication and internal transfers live in their own router.
  r.use(importRouter());
  // Categorisation rules likewise.
  r.use(rulesRouter());
  // Assets, contracts and deadlines.
  r.use(contractsRouter());
  // Attachments: bytes on disk, metadata in SQLite.
  r.use(attachmentsRouter());
  // Meter readings, on the energy contracts.
  r.use(energyRouter());

  // Single call that fills the whole screen: accounts, categories, balances,
  // per-account coverage and the months that hold data.
  r.get('/bootstrap', handler((_req, res) => {
    res.json({
      accounts: repo.listAccounts(),
      categories: repo.listCategories(),
      balances: repo.accountBalances(),
      ignoredOps: repo.opsBeforeOpening(),
      loans: loanViews(),
      coverage: repo.accountCoverage(),
      months: repo.availableMonths(),
      aliases: repo.listAliases(),
    });
  }));

  /**
   * Ce que le module publie pour l'accueil, en un seul aller-retour.
   *
   * Séparé de `/bootstrap` à dessein : l'accueil payait jusqu'ici le démarrage
   * complet du module (comptes, catégories, soldes, opérations, règles,
   * contrats) pour afficher un chiffre, sur l'écran le plus ouvert de
   * l'application. Ici, une seule requête, et rien de plus que ce qui est
   * affiché.
   *
   * Le mois est donné par le client : c'est lui qui connaît le fuseau du foyer,
   * et c'est ce qui fait que l'accueil bascule seul à minuit.
   */
  r.get('/home', handler((req, res) => {
    const month = String(req.query['month'] || '').trim();
    if (!isMonth(month)) fail('Mois invalide : attendu AAAA-MM.');
    const today = new Date().toISOString().slice(0, 10);
    const all = contracts.listContracts();
    const accounts = repo.listAccounts();
    const balances = repo.accountBalances();
    // Le solde des comptes courants, et lui seul : l'épargne et le crédit
    // répondent à d'autres questions que « est-ce que je peux dépenser ».
    const courants = accounts.filter((a) => a.kind === 'courant' && !a.archived);
    res.json({
      home: {
        month,
        // Zéro compte veut dire « module jamais servi ». L'accueil en fait un
        // état vide, surtout pas un solde à zéro.
        accounts: accounts.length,
        summary: monthSummary(month, today),
        // Les échéances alimentent l'accueil, les notifications et le
        // calendrier : les servir ici évite de charger tout le module pour elles.
        deadlines: contracts.deadlines(today),
        contracts: all.length,
        savings: savings.totals(),
        currentBalance: courants.length ? courants.reduce((a, c) => a + (balances[c.id] ?? 0), 0) : null,
        // De quoi saisir une dépense en espèces sans charger tout le module.
        currentAccounts: courants.map((c) => ({ id: c.id, name: c.name })),
        energy: {
          contracts: all.filter((c) => c.kind === 'energie').length,
          due: energy.readingsDue(all, energy.lastReadingDates(), today, Number(effectiveSetting('readingDueDays'))),
        },
      },
    });
  }));

  /**
   * Sauvegarde du seul module, en un fichier JSON.
   *
   * Réservée à un administrateur, et journalisée : deux GET sans rôle exigé et
   * sans trace faisaient de cet endpoint le point d'exfiltration parfait, toutes
   * les opérations et toutes les références de contrat en un appel, sans que
   * rien ne l'ait noté.
   */
  r.get('/export.json', requireAdmin, handler((req, res) => {
    const dump = backup.exportModule();
    log.info(`Finances : export complet (JSON) par ${who(req)}.`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="foyer-finances-${dump.generatedAt.slice(0, 10)}.json"`);
    res.send(JSON.stringify(dump));
  }));

  /**
   * Restauration : elle **écrase** les données du module. D'où deux gardes, et
   * pas un : réservée à un administrateur du foyer (masquer un bouton n'empêche
   * personne d'appeler l'API), et confirmation explicite dans le corps de la
   * requête, qu'aucun appel accidentel ne portera.
   */
  r.post('/restore', requireAdmin, express.json({ limit: '64mb' }), handler((req, res) => {
    const body = req.body || {};
    if (String(body.confirm || '') !== 'REMPLACER') {
      res.status(400).json({
        error: 'Restauration non confirmée. Cette opération remplace toutes les données du module Finances : '
          + 'envoyez « confirm » avec la valeur REMPLACER pour la lancer.',
      });
      return;
    }
    try {
      res.json({ report: backup.restoreModule(body.backup) });
    } catch (e) {
      if (e instanceof backup.RestoreRefused) { res.status(422).json({ error: e.message }); return; }
      throw e;
    }
  }));

  // ---- accounts ----
  r.get('/accounts', handler((_req, res) => res.json({
    accounts: repo.listAccounts(), balances: repo.accountBalances(), ignoredOps: repo.opsBeforeOpening(),
    loans: loanViews(),
  })));

  /**
   * Le tableau d'amortissement complet, pour le comparer à celui de la banque.
   * Tableau vide quand le compte n'est pas un crédit ou que ses termes manquent.
   */
  r.get('/accounts/:id/schedule', handler((req, res) => {
    const a = repo.getAccount(id(req.params['id'], 'compte'));
    if (!a) { res.status(404).json({ error: 'Compte introuvable.' }); return; }
    res.json({ instalments: loans.loanSchedule(a) });
  }));

  r.post('/accounts', handler((req, res) => {
    res.status(201).json({ account: repo.createAccount(accountInput(req.body || {})) });
  }));

  r.put('/accounts/:id', handler((req, res) => {
    const account = repo.updateAccount(id(req.params['id'], 'compte'), accountInput(req.body || {}));
    if (!account) { res.status(404).json({ error: 'Compte introuvable.' }); return; }
    res.json({ account });
  }));

  r.delete('/accounts/:id', handler((req, res) => {
    const accountId = id(req.params['id'], 'compte');
    const n = repo.countTransactionsForAccount(accountId);
    if (n > 0) {
      res.status(409).json({
        error: `Ce compte porte ${n} opération${n > 1 ? 's' : ''}. Archivez-le plutôt que de le supprimer : son historique reste consultable et il sort des alertes de mois incomplet.`,
      });
      return;
    }
    repo.deleteAccount(accountId);
    res.json({ ok: true });
  }));

  // ---- account aliases ----
  r.post('/accounts/:id/aliases', handler((req, res) => {
    const accountId = id(req.params['id'], 'compte');
    if (!repo.getAccount(accountId)) { res.status(404).json({ error: 'Compte introuvable.' }); return; }
    repo.addAlias(accountId, str(req.body?.label, 'libellé de compte', { max: 300 }));
    res.status(201).json({ aliases: repo.listAliases() });
  }));

  r.delete('/aliases/:id', handler((req, res) => {
    repo.deleteAlias(id(req.params['id'], 'alias'));
    res.json({ aliases: repo.listAliases() });
  }));

  // ---- categories ----
  r.get('/categories', handler((_req, res) => res.json({ categories: repo.listCategories() })));

  r.post('/categories', handler((req, res) => {
    res.status(201).json({ category: repo.createCategory(categoryInput(req.body || {})) });
  }));

  r.put('/categories/:id', handler((req, res) => {
    const categoryId = id(req.params['id'], 'catégorie');
    if (optionalId(req.body?.parentId) === categoryId) fail('Une catégorie ne peut pas être sa propre parente.');
    const category = repo.updateCategory(categoryId, categoryInput(req.body || {}));
    if (!category) { res.status(404).json({ error: 'Catégorie introuvable.' }); return; }
    res.json({ category });
  }));

  r.delete('/categories/:id', handler((req, res) => {
    repo.deleteCategory(id(req.params['id'], 'catégorie'));
    res.json({ categories: repo.listCategories() });
  }));

  // ---- transactions ----
  // Everything the dashboard tab shows, in one call: the month, the twelve months
  // before it, the year to date and the biggest expenses.
  r.get('/dashboard', handler((req, res) => {
    const month = String(req.query['month'] || '');
    if (!isMonth(month)) fail('Mois invalide : attendu AAAA-MM.');
    res.json({ dashboard: dashboard(month) });
  }));

  r.get('/transactions', handler((req, res) => {
    const q = req.query;
    const result = repo.listTransactions({
      from: q['from'] ? isoDate(q['from'], 'date de début') : undefined,
      to: q['to'] ? isoDate(q['to'], 'date de fin') : undefined,
      accountId: q['accountId'] ? id(q['accountId'], 'compte') : undefined,
      categoryId: q['categoryId'] ? id(q['categoryId'], 'catégorie') : undefined,
      uncategorised: q['uncategorised'] === '1',
      contractId: q['contractId'] ? id(q['contractId'], 'contrat') : undefined,
      tag: q['tag'] ? String(q['tag']).slice(0, 60) : undefined,
      q: q['q'] ? String(q['q']).slice(0, 100) : undefined,
      limit: q['limit'] ? parseInt(String(q['limit']), 10) : undefined,
      offset: q['offset'] ? parseInt(String(q['offset']), 10) : undefined,
    });
    res.json(result);
  }));

  r.post('/transactions', handler((req, res) => {
    res.status(201).json({ transaction: repo.createTransaction(txInput(req.body || {})) });
  }));

  r.put('/transactions/:id', handler((req, res) => {
    const transaction = repo.updateTransaction(id(req.params['id'], 'transaction'), txInput(req.body || {}));
    if (!transaction) { res.status(404).json({ error: 'Transaction introuvable.' }); return; }
    res.json({ transaction });
  }));

  r.delete('/transactions/:id', handler((req, res) => {
    repo.deleteTransaction(id(req.params['id'], 'transaction'));
    res.json({ ok: true });
  }));

  // ---- aggregates ----
  r.get('/summary', handler((req, res) => {
    const month = String(req.query['month'] || '').trim();
    if (!isMonth(month)) fail('Mois invalide : attendu AAAA-MM.');
    res.json({ summary: monthSummary(month) });
  }));

  // ---- export ----
  r.get('/export.csv', requireAdmin, handler((req, res) => {
    const csv = exportCsv();
    log.info(`Finances : export complet (CSV) par ${who(req)}, ${csv.split('\r\n').length - 2} ligne(s).`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="foyer-finances-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }));

  return r;
}
