// HTTP surface of the categorisation rules, mounted under /api/finances.
import express, { Request, Response, Router } from 'express';
import * as rules from './rules-repo';
import { getAccount, getCategory } from './repo';
import { ActionKind, Condition, ConditionField, ConditionOp, MatchMode } from './rules';
import { isIsoDate } from './money';

class Invalid extends Error {}
const fail = (msg: string): never => { throw new Invalid(msg); };

const FIELDS: ConditionField[] = ['label', 'amount', 'sens', 'account', 'dayOfMonth', 'date'];
const OPS: Record<ConditionField, ConditionOp[]> = {
  label: ['contains', 'notContains', 'equals', 'startsWith', 'regex'],
  amount: ['gt', 'lt', 'between', 'equals'],
  sens: ['is', 'isNot'],
  account: ['is', 'isNot'],
  dayOfMonth: ['equals', 'between', 'gt', 'lt'],
  date: ['between', 'before', 'after'],
};
const ACTIONS: ActionKind[] = ['category', 'label', 'tag', 'transfer'];

function handler(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    try { fn(req, res); }
    catch (e) {
      if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
      // eslint-disable-next-line no-console
      console.error('[foyer] Finances/règles : erreur inattendue', e);
      res.status(500).json({ error: 'Erreur dans le moteur de règles : ' + (e as Error).message });
    }
  };
}

const id = (v: unknown, field: string): number => {
  const n = parseInt(String(v ?? ''), 10);
  if (!Number.isInteger(n) || n <= 0) fail(`Identifiant invalide pour « ${field} ».`);
  return n;
};

/** Validate a condition, refusing anything the engine would silently ignore. */
function condition(raw: Record<string, unknown>, index: number): Condition {
  const where = `condition ${index + 1}`;
  const field = String(raw['field'] ?? '') as ConditionField;
  if (!FIELDS.includes(field)) fail(`Critère inconnu dans la ${where}.`);
  const op = String(raw['op'] ?? '') as ConditionOp;
  if (!OPS[field].includes(op)) fail(`Opérateur « ${op} » impossible sur ce critère (${where}).`);
  const value = String(raw['value'] ?? '').trim();
  const value2 = String(raw['value2'] ?? '').trim();

  if (!value) fail(`La ${where} est incomplète : renseignez une valeur.`);
  if (op === 'between' && !value2) fail(`La ${where} attend deux bornes.`);

  if (field === 'amount') {
    for (const [v, name] of [[value, 'première'], [value2, 'seconde']] as const) {
      if (!v) continue;
      if (!Number.isFinite(parseFloat(v.replace(',', '.')))) fail(`Montant invalide (${name} borne) dans la ${where}.`);
    }
  }
  if (field === 'date') {
    for (const v of [value, value2]) if (v && !isIsoDate(v)) fail(`Date invalide dans la ${where} : attendu AAAA-MM-JJ.`);
  }
  if (field === 'account' && !getAccount(parseInt(value, 10))) fail(`Compte introuvable dans la ${where}.`);
  if (field === 'sens' && !['depense', 'recette'].includes(value)) fail(`Sens invalide dans la ${where} : attendu depense ou recette.`);
  if (field === 'label' && op === 'regex') {
    try { new RegExp(value); }
    catch (e) { fail(`Expression régulière invalide dans la ${where} : ${(e as Error).message}`); }
  }
  return { field, op, value, value2 };
}

function ruleInput(body: Record<string, unknown>): rules.RuleInput {
  const name = String(body['name'] ?? '').trim();
  if (!name) fail('Donnez un nom à la règle.');
  if (name.length > 120) fail('Le nom de la règle dépasse 120 caractères.');

  const rawConditions = Array.isArray(body['conditions']) ? body['conditions'] : [];
  if (!rawConditions.length) fail('Une règle sans condition s’appliquerait à toutes les opérations : ajoutez au moins un critère.');
  const conditions = rawConditions.map((c, i) => condition(c as Record<string, unknown>, i));

  const rawActions = Array.isArray(body['actions']) ? body['actions'] : [];
  if (!rawActions.length) fail('Une règle sans action ne ferait rien : ajoutez au moins une action.');
  const actions = rawActions.map((a) => {
    const raw = a as Record<string, unknown>;
    const kind = String(raw['kind'] ?? '') as ActionKind;
    if (!ACTIONS.includes(kind)) fail(`Action inconnue : « ${kind} ».`);
    const value = String(raw['value'] ?? '').trim();
    if (kind === 'category' && value && !getCategory(parseInt(value, 10))) fail('Catégorie introuvable dans les actions.');
    if (kind === 'label' && !value) fail('L’action « réécrire le libellé » attend le nouveau libellé.');
    if (kind === 'tag' && !value) fail('L’action « ajouter une étiquette » attend un nom d’étiquette.');
    return { kind, value };
  });

  const matchMode = String(body['matchMode'] ?? 'all') as MatchMode;
  if (!['all', 'any'].includes(matchMode)) fail('Mode de correspondance invalide : attendu all ou any.');

  return { name, enabled: body['enabled'] !== false, matchMode, stop: !!body['stop'], conditions, actions };
}

export function rulesRouter(): Router {
  const r = express.Router();

  r.get('/rules', handler((_req, res) => res.json({ rules: rules.listRules(), tags: rules.listTags() })));

  r.post('/rules', handler((req, res) => {
    res.status(201).json({ rule: rules.createRule(ruleInput(req.body || {})) });
  }));

  r.put('/rules/:id', handler((req, res) => {
    const rule = rules.updateRule(id(req.params['id'], 'règle'), ruleInput(req.body || {}));
    if (!rule) { res.status(404).json({ error: 'Règle introuvable.' }); return; }
    res.json({ rule });
  }));

  r.delete('/rules/:id', handler((req, res) => {
    rules.deleteRule(id(req.params['id'], 'règle'));
    res.json({ rules: rules.listRules() });
  }));

  r.post('/rules/:id/move', handler((req, res) => {
    const delta = parseInt(String(req.body?.delta ?? 0), 10);
    if (delta !== 1 && delta !== -1) fail('Déplacement invalide : attendu 1 ou -1.');
    rules.moveRule(id(req.params['id'], 'règle'), delta);
    res.json({ rules: rules.listRules() });
  }));

  /** What an unsaved rule would do. Writes nothing. */
  r.post('/rules/preview', handler((req, res) => {
    res.json({ preview: rules.previewRule(ruleInput(req.body || {})) });
  }));

  /** Replay the enabled rules over the history. */
  r.post('/rules/apply', handler((req, res) => {
    const body = req.body || {};
    const filter: rules.ApplyFilter = {};
    if (body.from) { if (!isIsoDate(String(body.from))) fail('Date de début invalide.'); filter.from = String(body.from); }
    if (body.to) { if (!isIsoDate(String(body.to))) fail('Date de fin invalide.'); filter.to = String(body.to); }
    if (body.accountId) filter.accountId = id(body.accountId, 'compte');
    res.json({ report: rules.applyRules(filter, body.force !== true) });
  }));

  r.get('/tags', handler((_req, res) => res.json({ tags: rules.listTags() })));

  return r;
}
