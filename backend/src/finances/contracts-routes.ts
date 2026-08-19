// HTTP surface of assets, contracts and deadlines, mounted under /api/finances.
import express, { Request, Response, Router } from 'express';
import * as attachments from './attachments';
import * as contracts from './contracts';
import * as savings from './savings';
import { getAccount, getCategory } from './repo';
import { isIsoDate, parseCents } from './money';

class Invalid extends Error {}
const fail = (msg: string): never => { throw new Invalid(msg); };

const ASSET_KINDS: contracts.AssetKind[] = ['immobilier', 'vehicule', 'autre'];
const ASSET_STATUS: contracts.AssetStatus[] = ['actif', 'vendu'];
const CONTRACT_KINDS: contracts.ContractKind[] = ['assurance', 'energie', 'telecom', 'abonnement', 'credit', 'sante', 'autre'];
const PERIODICITIES: contracts.Periodicity[] = ['mensuelle', 'trimestrielle', 'semestrielle', 'annuelle', 'ponctuelle'];
const CONTRACT_STATUS: contracts.ContractStatus[] = ['actif', 'resilie'];

function handler(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    try { fn(req, res); }
    catch (e) {
      if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
      // eslint-disable-next-line no-console
      console.error('[foyer] Finances/contrats : erreur inattendue', e);
      res.status(500).json({ error: 'Erreur dans les contrats : ' + (e as Error).message });
    }
  };
}

const id = (v: unknown, field: string): number => {
  const n = parseInt(String(v ?? ''), 10);
  if (!Number.isInteger(n) || n <= 0) fail(`Identifiant invalide pour « ${field} ».`);
  return n;
};

const str = (v: unknown, field: string, max = 200): string => {
  const s = String(v ?? '').trim();
  if (s.length > max) fail(`Le champ « ${field} » dépasse ${max} caractères.`);
  return s;
};

const optionalDate = (v: unknown, field: string): string | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!isIsoDate(s)) fail(`Date invalide pour « ${field} » : attendu AAAA-MM-JJ.`);
  return s;
};

const optionalRef = (v: unknown, field: string, exists: (n: number) => unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = id(v, field);
  if (!exists(n)) fail(`${field} introuvable.`);
  return n;
};

/** Identifiants de membres, dédoublonnés et bornés. */
function memberIds(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : [];
  if (raw.length > 20) fail('Trop de personnes sélectionnées.');
  return [...new Set(raw.map((m) => String(m ?? '').trim().slice(0, 40)).filter(Boolean))];
}

function assetInput(body: Record<string, unknown>): contracts.AssetInput {
  const name = str(body['name'], 'nom du bien');
  if (!name) fail('Donnez un nom au bien.');
  const kind = String(body['kind'] ?? 'autre') as contracts.AssetKind;
  if (!ASSET_KINDS.includes(kind)) fail('Type de bien invalide.');
  const status = String(body['status'] ?? 'actif') as contracts.AssetStatus;
  if (!ASSET_STATUS.includes(status)) fail('Statut de bien invalide.');
  const acquiredOn = optionalDate(body['acquiredOn'], 'date d’acquisition');
  const soldOn = optionalDate(body['soldOn'], 'date de vente');
  if (acquiredOn && soldOn && soldOn < acquiredOn) fail('La date de vente précède la date d’acquisition.');
  return { name, kind, status, address: str(body['address'], 'adresse', 300), acquiredOn, soldOn, notes: str(body['notes'], 'notes', 2000) };
}

/** Optional amount in cents, always stored positive: a contract costs, it does not sign. */
const optionalAmount = (v: unknown, field: string): number | null => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const cents = parseCents(s);
  if (cents === null) fail(`Montant invalide pour « ${field} », par exemple 81,69.`);
  return Math.abs(cents as number);
};

function contractInput(body: Record<string, unknown>): contracts.ContractInput {
  const name = str(body['name'], 'nom du contrat');
  if (!name) fail('Donnez un nom au contrat.');
  const kind = String(body['kind'] ?? 'autre') as contracts.ContractKind;
  if (!CONTRACT_KINDS.includes(kind)) fail('Type de contrat invalide.');
  const periodicity = String(body['periodicity'] ?? 'mensuelle') as contracts.Periodicity;
  if (!PERIODICITIES.includes(periodicity)) fail('Périodicité invalide.');
  const status = String(body['status'] ?? 'actif') as contracts.ContractStatus;
  if (!CONTRACT_STATUS.includes(status)) fail('Statut de contrat invalide.');

  const amountMin = optionalAmount(body['amountMin'], 'montant minimum');
  const amountMax = optionalAmount(body['amountMax'], 'montant maximum');
  if (amountMin !== null && amountMax !== null && amountMin > amountMax) {
    fail('Le montant minimum dépasse le montant maximum.');
  }

  const noticeDays = parseInt(String(body['noticeDays'] ?? 0), 10) || 0;
  if (noticeDays < 0 || noticeDays > 365) fail('Le préavis doit tenir entre 0 et 365 jours.');

  const renewalOn = optionalDate(body['renewalOn'], 'date de reconduction');
  const endsOn = optionalDate(body['endsOn'], 'date de fin');

  const rawRefs = Array.isArray(body['refs']) ? body['refs'] : [];
  const refs = rawRefs.map((r, i) => {
    const raw = r as Record<string, unknown>;
    const key = str(raw['key'], `intitulé de la référence ${i + 1}`, 80);
    if (!key) fail(`La référence ${i + 1} n’a pas d’intitulé.`);
    return { key, value: str(raw['value'], `référence ${i + 1}`, 200) };
  });

  return {
    name, provider: str(body['provider'], 'fournisseur'), kind,
    assetId: optionalRef(body['assetId'], 'Bien', (n) => contracts.getAsset(n)),
    accountId: optionalRef(body['accountId'], 'Compte', (n) => getAccount(n)),
    categoryId: optionalRef(body['categoryId'], 'Catégorie', (n) => getCategory(n)),
    memberIds: memberIds(body['memberIds']),
    amountMin, amountMax, periodicity, renewalOn, noticeDays, endsOn,
    status, notes: str(body['notes'], 'notes', 2000), refs,
  };
}

function savingInput(body: Record<string, unknown>): savings.SavingInput {
  const title = str(body['title'], 'intitulé de la piste');
  if (!title) fail('Donnez un intitulé à la piste.');

  const status = String(body['status'] ?? 'idee') as savings.SavingStatus;
  if (!savings.SAVING_STATUSES.includes(status)) fail('Statut de piste invalide.');

  const gain = optionalAmount(body['annualGain'], 'gain annuel');
  if (gain === null) fail('Indiquez le gain annuel estimé, même approximatif : sans lui, la piste ne se compare à rien.');

  return {
    title, description: str(body['description'], 'description', 2000),
    annualGain: gain as number,
    contractId: optionalRef(body['contractId'], 'Contrat', (n) => contracts.getContract(n)),
    assetId: optionalRef(body['assetId'], 'Bien', (n) => contracts.getAsset(n)),
    status,
    targetDate: optionalDate(body['targetDate'], 'échéance visée'),
    taskId: str(body['taskId'], 'tâche', 40) || null,
  };
}

export function contractsRouter(): Router {
  const r = express.Router();

  /** Assets, contracts, deadlines and real costs: one call fills the screen. */
  r.get('/contracts', handler((_req, res) => {
    res.json({
      assets: contracts.listAssets(),
      contracts: contracts.listContracts(),
      deadlines: contracts.deadlines(),
      costs: Object.fromEntries(contracts.contractCosts()),
      pieces: Object.fromEntries(attachments.countsFor('contract')),
      savings: savings.listSavings(),
      savingsTotals: savings.totals(),
    });
  }));

  r.post('/assets', handler((req, res) => {
    res.status(201).json({ asset: contracts.createAsset(assetInput(req.body || {})) });
  }));

  r.put('/assets/:id', handler((req, res) => {
    const asset = contracts.updateAsset(id(req.params['id'], 'bien'), assetInput(req.body || {}));
    if (!asset) { res.status(404).json({ error: 'Bien introuvable.' }); return; }
    res.json({ asset });
  }));

  r.delete('/assets/:id', handler((req, res) => {
    const pieces = contracts.deleteAsset(id(req.params['id'], 'bien'));
    res.json({ assets: contracts.listAssets(), contracts: contracts.listContracts(), pieces });
  }));

  r.post('/contracts', handler((req, res) => {
    res.status(201).json({ contract: contracts.createContract(contractInput(req.body || {})) });
  }));

  r.put('/contracts/:id', handler((req, res) => {
    const contract = contracts.updateContract(id(req.params['id'], 'contrat'), contractInput(req.body || {}));
    if (!contract) { res.status(404).json({ error: 'Contrat introuvable.' }); return; }
    res.json({ contract });
  }));

  r.delete('/contracts/:id', handler((req, res) => {
    const contractId = id(req.params['id'], 'contrat');
    const n = contracts.countTransactionsForContract(contractId);
    const pieces = contracts.deleteContract(contractId);
    res.json({ contracts: contracts.listContracts(), detached: n, pieces });
  }));

  // ---- pistes d'économies ----
  r.post('/savings', handler((req, res) => {
    res.status(201).json({ saving: savings.createSaving(savingInput(req.body || {})) });
  }));

  r.put('/savings/:id', handler((req, res) => {
    const saving = savings.updateSaving(id(req.params['id'], 'piste'), savingInput(req.body || {}));
    if (!saving) { res.status(404).json({ error: 'Piste introuvable.' }); return; }
    res.json({ saving, totals: savings.totals() });
  }));

  r.delete('/savings/:id', handler((req, res) => {
    savings.deleteSaving(id(req.params['id'], 'piste'));
    res.json({ savings: savings.listSavings(), totals: savings.totals() });
  }));

  /** Mémorise la tâche créée depuis une piste, ou l'oublie quand elle a disparu. */
  r.post('/savings/:id/task', handler((req, res) => {
    const taskId = String(req.body?.taskId ?? '').trim().slice(0, 40) || null;
    const saving = savings.linkTask(id(req.params['id'], 'piste'), taskId);
    if (!saving) { res.status(404).json({ error: 'Piste introuvable.' }); return; }
    res.json({ saving });
  }));

  return r;
}
