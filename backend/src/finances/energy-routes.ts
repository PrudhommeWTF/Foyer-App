// HTTP surface of the meter readings, mounted under /api/finances.
import express, { Request, Response, Router } from 'express';
import * as energy from './energy';
import { getContract } from './contracts';
import { isIsoDate, parseCents } from './money';
import { log } from '../log';

class Invalid extends Error {}
const fail = (msg: string): never => { throw new Invalid(msg); };

function handler(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    try { fn(req, res); }
    catch (e) {
      if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
      log.erreur('Finances/énergie : erreur inattendue', e);
      res.status(500).json({ error: 'Erreur sur les relevés : ' + (e as Error).message });
    }
  };
}

const id = (v: unknown, field: string): number => {
  const n = parseInt(String(v ?? ''), 10);
  if (!Number.isInteger(n) || n <= 0) fail(`Identifiant invalide pour « ${field} ».`);
  return n;
};

/** An index or a kWh figure: positive, decimals allowed, empty means unknown. */
const measure = (v: unknown, field: string): number | null => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) fail(`Valeur invalide pour « ${field} », par exemple 10600 ou 10600,5.`);
  if (n < 0) fail(`« ${field} » ne peut pas être négatif : un compteur ne recule pas.`);
  return n;
};

function readingInput(body: Record<string, unknown>): energy.ReadingInput {
  const contractId = id(body['contractId'], 'contrat');
  const contract = getContract(contractId);
  if (!contract) fail('Contrat introuvable.');
  if (contract!.kind !== 'energie') fail('Les relevés ne concernent que les contrats d’énergie.');

  const date = String(body['date'] ?? '').trim();
  if (!isIsoDate(date)) fail('Date de relevé invalide : attendu AAAA-MM-JJ.');

  const input: energy.ReadingInput = {
    contractId, date,
    indexTotal: measure(body['indexTotal'], 'index'),
    indexHp: measure(body['indexHp'], 'index heures pleines'),
    indexHc: measure(body['indexHc'], 'index heures creuses'),
    kwh: measure(body['kwh'], 'consommation'),
    kwhHp: measure(body['kwhHp'], 'consommation heures pleines'),
    kwhHc: measure(body['kwhHc'], 'consommation heures creuses'),
    cost: null,
    notes: String(body['notes'] ?? '').trim().slice(0, 500),
  };

  const rawCost = String(body['cost'] ?? '').trim();
  if (rawCost) {
    const cents = parseCents(rawCost);
    if (cents === null) fail('Montant invalide, par exemple 120,45.');
    input.cost = Math.abs(cents as number);
  }

  // A reading that carries no figure at all measures nothing and would only add
  // a hole in the history.
  const hasFigure = [input.indexTotal, input.indexHp, input.indexHc, input.kwh, input.kwhHp, input.kwhHc]
    .some((v) => v !== null);
  if (!hasFigure) fail('Renseignez au moins un index ou une consommation.');

  return input;
}

export function energyRouter(): Router {
  const r = express.Router();

  r.get('/readings', handler((req, res) => {
    const contractId = id(req.query['contractId'], 'contrat');
    res.json({
      readings: energy.listReadings(contractId),
      periods: energy.periods(contractId),
      summary: energy.summary(contractId),
    });
  }));

  r.post('/readings', handler((req, res) => {
    res.status(201).json({ reading: energy.createReading(readingInput(req.body || {})) });
  }));

  r.put('/readings/:id', handler((req, res) => {
    const reading = energy.updateReading(id(req.params['id'], 'relevé'), readingInput(req.body || {}));
    if (!reading) { res.status(404).json({ error: 'Relevé introuvable.' }); return; }
    res.json({ reading });
  }));

  r.delete('/readings/:id', handler((req, res) => {
    const readingId = id(req.params['id'], 'relevé');
    const reading = energy.getReading(readingId);
    if (!reading) { res.status(404).json({ error: 'Relevé introuvable.' }); return; }
    energy.deleteReading(readingId);
    res.json({ readings: energy.listReadings(reading.contractId), periods: energy.periods(reading.contractId) });
  }));

  return r;
}
