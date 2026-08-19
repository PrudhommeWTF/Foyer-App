// HTTP surface of assets, contracts and deadlines, mounted under /api/finances.
import express, { Request, Response, Router } from 'express';
import * as contracts from './contracts';
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
    memberId: str(body['memberId'], 'membre', 40) || null,
    amountMin, amountMax, periodicity, renewalOn, noticeDays, endsOn,
    status, notes: str(body['notes'], 'notes', 2000), refs,
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
    contracts.deleteAsset(id(req.params['id'], 'bien'));
    res.json({ assets: contracts.listAssets(), contracts: contracts.listContracts() });
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
    contracts.deleteContract(contractId);
    res.json({ contracts: contracts.listContracts(), detached: n });
  }));

  return r;
}
