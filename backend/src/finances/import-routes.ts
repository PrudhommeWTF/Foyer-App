// HTTP surface of the import machinery, mounted under /api/finances.
//
// The file is uploaded as a raw body rather than multipart: no extra dependency,
// no base64 inflation. Nothing reaches the transactions table before an explicit
// validation, and every committed import can be undone in one call.
import express, { Request, Response, Router } from 'express';
import * as imports from './import-repo';
import { addAlias, getAccount, listAccounts } from './repo';
import { UnsupportedFile, parseFile } from './import/parse';
import { NO_ACCOUNT_LABEL, previewTransfers, resolveAndCollapse, stage } from './import/run';
import { findTransferCandidates } from './import/transfers';
import { ImportPreview, RawRow } from './import/types';
import { applyRules } from './rules-repo';
import { isIsoDate } from './money';
import { log } from '../log';

const MAX_UPLOAD = 25 * 1024 * 1024;

interface Draft { rows: RawRow[]; format: string; encoding: string; rejected: ImportPreview['rejected']; }

/** Recompute the report from the stored rows, after any alias change. */
function buildPreview(id: number, filename: string, draft: Draft): ImportPreview {
  const resolution = resolveAndCollapse(draft.rows);
  const blocked = resolution.unknown.length > 0;
  const staged = blocked
    ? { rows: [], duplicates: 0, perAccount: [], coverage: new Map<number, { from: string; to: string }>() }
    : stage(resolution, imports.existingByKey);

  const uniqueRows = [...resolution.byAccount.values()].reduce((n, rows) => n + rows.length, 0);
  const dates = draft.rows.map((r) => r.date).sort();
  const transferCandidates = blocked || !dates.length ? 0
    : previewTransfers(staged.rows, imports.transferPool(dates[0], dates[dates.length - 1]));

  return {
    importId: id,
    filename,
    format: draft.format,
    encoding: draft.encoding,
    totalRows: draft.rows.length,
    uniqueRows,
    collapsed: resolution.collapsed,
    duplicates: staged.duplicates,
    toInsert: staged.rows.length,
    perAccount: staged.perAccount,
    unknownAccounts: resolution.unknown,
    rejected: draft.rejected,
    transferCandidates,
    blocked,
  };
}

function readDraft(id: number): { draft: Draft; filename: string; status: imports.ImportStatus } | null {
  const row = imports.readDraft(id);
  if (!row || !row.payload) return null;
  return { draft: row.payload as Draft, filename: row.filename, status: row.status };
}

function handler(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    try { fn(req, res); }
    catch (e) {
      if (e instanceof UnsupportedFile) { res.status(415).json({ error: e.message }); return; }
      log.erreur('Finances/import : erreur inattendue', e);
      res.status(500).json({ error: 'Erreur pendant l’import : ' + (e as Error).message });
    }
  };
}

const id = (v: unknown): number => {
  const n = parseInt(String(v ?? ''), 10);
  if (!Number.isInteger(n) || n <= 0) throw new UnsupportedFile('Identifiant invalide.');
  return n;
};

export function importRouter(): Router {
  const r = express.Router();

  // ---- upload and report ----
  r.post('/imports', express.raw({ type: '*/*', limit: MAX_UPLOAD }), handler((req, res) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) {
      res.status(400).json({ error: 'Aucun fichier reçu. Envoyez le contenu brut du fichier dans le corps de la requête.' });
      return;
    }
    const filename = String(req.query['filename'] || 'import').slice(0, 200);
    // Old abandoned drafts are cleared opportunistically, so they never pile up.
    imports.purgeStaleDrafts();

    const parsed = parseFile(buf, filename);
    if (!parsed.rows.length) {
      res.status(422).json({
        error: 'Aucune opération exploitable dans ce fichier.',
        rejected: parsed.rejected.slice(0, 20),
      });
      return;
    }
    const draftId = imports.createDraft(filename, parsed.format);
    const draft: Draft = { rows: parsed.rows, format: parsed.format, encoding: parsed.encoding, rejected: parsed.rejected };
    const preview = buildPreview(draftId, filename, draft);
    imports.saveDraft(draftId, draft, preview);
    res.status(201).json({ preview });
  }));

  r.get('/imports/:id/preview', handler((req, res) => {
    const draftId = id(req.params['id']);
    const found = readDraft(draftId);
    if (!found) { res.status(404).json({ error: 'Brouillon d’import introuvable ou déjà validé.' }); return; }
    const preview = buildPreview(draftId, found.filename, found.draft);
    imports.saveDraft(draftId, found.draft, preview);
    res.json({ preview });
  }));

  /** Map an unknown label to an account (creating it when asked), then re-report. */
  r.post('/imports/:id/accounts', handler((req, res) => {
    const draftId = id(req.params['id']);
    const found = readDraft(draftId);
    if (!found) { res.status(404).json({ error: 'Brouillon d’import introuvable ou déjà validé.' }); return; }

    const label = String(req.body?.label ?? '').trim();
    if (!label) { res.status(400).json({ error: 'Libellé de compte manquant.' }); return; }

    let accountId: number;
    if (req.body?.accountId) {
      accountId = id(req.body.accountId);
      if (!getAccount(accountId)) { res.status(404).json({ error: 'Compte introuvable.' }); return; }
    } else {
      res.status(400).json({ error: 'Choisissez le compte auquel rattacher ce libellé. Aucun compte n’est créé automatiquement.' });
      return;
    }
    if (label === NO_ACCOUNT_LABEL) {
      // The file carried no account column: stamp the chosen account's own name
      // on the rows and remember it, so the placeholder never leaks into aliases.
      const name = getAccount(accountId)!.name;
      addAlias(accountId, name);
      found.draft.rows = found.draft.rows.map((row) => (row.accountLabel.trim() ? row : { ...row, accountLabel: name }));
    } else {
      addAlias(accountId, label);
    }

    const preview = buildPreview(draftId, found.filename, found.draft);
    imports.saveDraft(draftId, found.draft, preview);
    res.json({ preview });
  }));

  // ---- validation ----
  r.post('/imports/:id/commit', handler((req, res) => {
    const draftId = id(req.params['id']);
    const found = readDraft(draftId);
    if (!found) { res.status(404).json({ error: 'Brouillon d’import introuvable ou déjà validé.' }); return; }
    if (found.status !== 'pending') { res.status(409).json({ error: 'Cet import a déjà été traité.' }); return; }

    const resolution = resolveAndCollapse(found.draft.rows);
    if (resolution.unknown.length) {
      res.status(409).json({
        error: `Rattachez d’abord ${resolution.unknown.length} libellé(s) de compte inconnu(s) : ${resolution.unknown.map((u) => u.label).join(', ')}.`,
      });
      return;
    }
    const staged = stage(resolution, imports.existingByKey);
    const inserted = imports.commitImport(draftId, staged.rows, staged.coverage);
    // The whole point of the rules: a statement should arrive already sorted.
    const categorised = inserted ? applyRules({ importId: draftId }) : null;
    res.json({ imported: imports.getImport(draftId), inserted, duplicates: staged.duplicates, categorised });
  }));

  r.delete('/imports/:id', handler((req, res) => {
    const importId = id(req.params['id']);
    const row = imports.getImport(importId);
    if (!row) { res.status(404).json({ error: 'Import introuvable.' }); return; }
    if (row.status === 'pending') { imports.cancelDraft(importId); res.json({ cancelled: true }); return; }
    const { deleted, ungrouped } = imports.undoImport(importId);
    res.json({ deleted, ungrouped });
  }));

  r.get('/imports', handler((_req, res) => res.json({ imports: imports.listImports() })));

  // ---- internal transfers ----
  r.get('/transfers/candidates', handler((req, res) => {
    const from = String(req.query['from'] || '');
    const to = String(req.query['to'] || '');
    if (!isIsoDate(from) || !isIsoDate(to)) { res.status(400).json({ error: 'Période invalide : attendu from et to au format AAAA-MM-JJ.' }); return; }
    const candidates = findTransferCandidates(imports.transferPool(from, to));
    res.json({ candidates, accounts: listAccounts() });
  }));

  r.post('/transfers', handler((req, res) => {
    const pairs = Array.isArray(req.body?.pairs) ? req.body.pairs : [];
    if (!pairs.length) { res.status(400).json({ error: 'Aucun rapprochement à valider.' }); return; }
    const merged: string[] = [];
    const failed: { debitId: number; creditId: number; error: string }[] = [];
    for (const p of pairs) {
      try { merged.push(imports.mergeTransfer(id(p?.debitId), id(p?.creditId))); }
      catch (e) { failed.push({ debitId: Number(p?.debitId), creditId: Number(p?.creditId), error: (e as Error).message }); }
    }
    res.json({ merged: merged.length, failed });
  }));

  r.get('/transfers', handler((_req, res) => res.json({ transfers: imports.listTransfers() })));

  r.delete('/transfers/:group', handler((req, res) => {
    const group = String(req.params['group'] || '');
    if (!/^tg_[0-9a-f]{16}$/.test(group)) { res.status(400).json({ error: 'Groupe de virement invalide.' }); return; }
    res.json({ split: imports.unmergeTransfer(group) });
  }));

  return r;
}
