// Les coûts des gestes, montés sous /api/entretien/couts : adultes seulement
// (un enfant ne voit jamais un montant), module Entretien allumé. Les contrats
// ne sont proposés que si Finances l'est aussi.
import express, { Request, Router } from 'express';
import { getTasks } from '../tasks/repo';
import { parisDay } from '../tasks/ops';
import { effectiveSetting } from '../settings/repo';
import { getContract } from '../finances/contracts';
import { AMOUNT_MAX, costSummary, setCost } from './costs';

const financesOn = (): boolean => effectiveSetting('modFinances') !== false;
const summary = () => costSummary(getTasks().items, parisDay(new Date().toISOString()), financesOn());

export function costsRouter(memberId: (req: Request) => string | null): Router {
  const r = Router();
  r.get('/', (_req, res) => { res.json(summary()); });
  r.put('/gestes/:id', express.json({ limit: '1kb' }), (req, res) => {
    const id = String(req.params['id']).slice(0, 80);
    const b = (req.body ?? {}) as { amount?: unknown; contractId?: unknown };
    const amount = b.amount === null || b.amount === undefined ? null : b.amount;
    const contractId = b.contractId === null || b.contractId === undefined ? null : b.contractId;
    if (amount !== null && (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > AMOUNT_MAX)) {
      res.status(400).json({ error: 'Montant illisible : des centimes, entier positif.' }); return;
    }
    if (contractId !== null) {
      if (!financesOn()) { res.status(400).json({ error: 'Le module Finances est désactivé : pas de contrat à rattacher.' }); return; }
      if (typeof contractId !== 'number' || !Number.isInteger(contractId) || !getContract(contractId)) { res.status(400).json({ error: 'Contrat inconnu.' }); return; }
    }
    if (!getTasks().items.some((t) => t.id === id && t.listId === 'entretien')) { res.status(404).json({ error: 'Geste inconnu.' }); return; }
    setCost(id, { amount: amount as number | null, contractId: contractId as number | null }, memberId(req));
    res.json(summary());
  });
  return r;
}
