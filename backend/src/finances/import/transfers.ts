// Internal-transfer detection.
//
// Candidates are PROPOSED, never merged on their own. The reason is concrete: on
// the reference export, opposite amounts alone paired a 50 € cash withdrawal on
// the joint account with a 50 € card remittance on the business account, two
// days apart and completely unrelated. Merging that silently would have
// destroyed two real operations. See docs/finances-cahier-de-recette.md,
// anomalie 4.
import { normaliseLabel } from '../money';

export type Confidence = 'forte' | 'moyenne' | 'faible';

export interface TransferSide {
  id: number;
  accountId: number;
  accountName: string;
  date: string;
  amount: number;
  label: string;
}

export interface TransferCandidate {
  debit: TransferSide;
  credit: TransferSide;
  daysApart: number;
  confidence: Confidence;
  reason: string;
}

/** Words that mark a transfer on a bank statement. */
const TRANSFER_MARK = /\b(VIR|VIREMENT|VIRT|TRANSFERT|PRLV INTERNE)\b/;
/** Operations that are almost never one leg of an internal transfer. */
const NOT_A_TRANSFER = /\b(RETRAIT|DAB|CHEQUE|CHQ|REMCB|REMISE|CB|CARTE|PAIEMENT PSC)\b/;

const daysBetween = (a: string, b: string): number =>
  Math.round(Math.abs(Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

/** Does either label name the other side's account? */
function namesOtherAccount(label: string, otherAccountName: string): boolean {
  const words = normaliseLabel(otherAccountName).split(/\s+/).filter((w) => w.length >= 5);
  const hay = normaliseLabel(label);
  return words.some((w) => hay.includes(w));
}

function score(debit: TransferSide, credit: TransferSide, daysApart: number): { confidence: Confidence; reason: string } {
  const dl = normaliseLabel(debit.label);
  const cl = normaliseLabel(credit.label);
  const marked = TRANSFER_MARK.test(dl) || TRANSFER_MARK.test(cl);
  const named = namesOtherAccount(debit.label, credit.accountName) || namesOtherAccount(credit.label, debit.accountName);
  const excluded = NOT_A_TRANSFER.test(dl) || NOT_A_TRANSFER.test(cl);

  if (excluded) {
    return { confidence: 'faible', reason: 'Un des deux libellés est un retrait, un chèque ou une remise de carte : rapprochement douteux.' };
  }
  if (daysApart === 0 && (marked || named)) {
    return { confidence: 'forte', reason: named ? 'Même jour, et un libellé nomme l’autre compte.' : 'Même jour, et un libellé porte une mention de virement.' };
  }
  if (marked || named) {
    return { confidence: 'moyenne', reason: `${daysApart} jour${daysApart > 1 ? 's' : ''} d’écart, avec une mention de virement.` };
  }
  return { confidence: 'faible', reason: 'Montants opposés, mais aucune mention de virement de part et d’autre.' };
}

const RANK: Record<Confidence, number> = { forte: 0, moyenne: 1, faible: 2 };

/**
 * Pair opposite amounts across different accounts, within `maxDays`. Each row is
 * used at most once, best pairs first, so a repeated amount does not fan out
 * into a cloud of proposals.
 */
export function findTransferCandidates(rows: TransferSide[], maxDays = 3): TransferCandidate[] {
  const debits = rows.filter((r) => r.amount < 0);
  const credits = rows.filter((r) => r.amount > 0);
  const pairs: TransferCandidate[] = [];

  for (const d of debits) {
    for (const c of credits) {
      if (c.accountId === d.accountId || c.amount !== -d.amount) continue;
      const daysApart = daysBetween(d.date, c.date);
      if (daysApart > maxDays) continue;
      pairs.push({ debit: d, credit: c, daysApart, ...score(d, c, daysApart) });
    }
  }

  // Strongest first, then closest in time, then oldest, so the ordering is stable.
  pairs.sort((a, b) =>
    RANK[a.confidence] - RANK[b.confidence]
    || a.daysApart - b.daysApart
    || a.debit.date.localeCompare(b.debit.date)
    || a.debit.id - b.debit.id);

  const used = new Set<number>();
  const out: TransferCandidate[] = [];
  for (const p of pairs) {
    if (used.has(p.debit.id) || used.has(p.credit.id)) continue;
    used.add(p.debit.id);
    used.add(p.credit.id);
    out.push(p);
  }
  return out;
}
