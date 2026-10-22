// Le carnet d'entretien : chaque geste, rangé par pièce, avec ses réalisations
// sur la période (date, qui, coût, note, justificatifs). En PDF, et en zip avec
// les justificatifs eux-mêmes : à la vente du logement, pour le bailleur, ou
// pour l'assureur après un sinistre.
//
// Réservé aux adultes (garde dans le routeur) : il porte les montants et les
// justificatifs. Un geste sans réalisation sur la période y figure quand même,
// « aucune réalisation » : c'est aussi ce qu'un carnet doit montrer.
import fs from 'fs';
import type { TaskItem } from '../tasks/ops';
import { HISTORY_MAX, parisDay } from '../tasks/ops';
import { fileOf } from '../storage/files';
import { DocBlock, documentPdf } from '../export/pdf';
import { ZipSink, ZipWriter } from '../export/zip-writer';
import { frDate } from '../equipements/warranty';
import { spendByRealisation } from './costs';
import { Extras, extrasByGeste } from './realisations';
import { ENTRETIEN_LIST_ID } from './list';

export const PERIODS = ['12', '24', 'tout'] as const;
export type Period = (typeof PERIODS)[number];

interface Household { familyName?: string; members?: { id: string; name: string }[]; rooms?: { id: string; name: string; position: number }[]; }

export interface CarnetLine { day: string; by: string; amount: number | null; note: string; cancelled: boolean; proofs: { fileId: number; name: string; path: string }[]; }
export interface CarnetGeste { title: string; howto: string; archived: boolean; lines: CarnetLine[]; }
export interface CarnetRoom { name: string; gestes: CarnetGeste[]; }
export interface Carnet { household: string; from: string | null; today: string; rooms: CarnetRoom[]; proofs: number; }

const euros = (c: number): string => (c / 100).toFixed(2).replace('.', ',');
const addMonths = (iso: string, n: number): string => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + n, +iso.slice(8, 10))).toISOString().slice(0, 10);
const safe = (x: string): string => x.replace(/[\\/:*?"<>|]/g, '_').trim();

/** Le carnet, à la date du jour (Paris) : par pièce dans l'ordre du foyer, « Sans pièce » en dernier. */
export function buildCarnet(tasks: TaskItem[], state: Household, period: Period, today: string): Carnet {
  const from = period === 'tout' ? null : addMonths(today, -Number(period));
  const names = new Map((state.members || []).map((m) => [m.id, m.name]));
  const rooms = [...(state.rooms || [])].sort((a, b) => a.position - b.position);
  const known = new Set(rooms.map((r) => r.id));
  const extras = extrasByGeste();
  const spend = spendByRealisation();
  const used = new Set<string>();
  let proofs = 0;
  const gestes = tasks.filter((t) => t.listId === ENTRETIEN_LIST_ID && !t.parentId).sort((a, b) => a.text.localeCompare(b.text, 'fr'));

  const geste = (t: TaskItem, room: string): CarnetGeste => {
    const ex = new Map((extras.get(t.id) || []).map((e) => [e.doneAt, e]));
    const history = t.history || [];
    // Les réalisations, plus celles qu'on a annulées mais qui portent une note
    // ou un justificatif. Une ligne sortie d'un historique plein (les plus
    // anciennes) n'est pas annulée : elle a eu lieu, le carnet la garde.
    const full = history.length >= HISTORY_MAX ? history[0].at : null;
    const outside = [...ex.values()].filter((e) => !history.some((h) => h.at === e.doneAt));
    const all: { at: string; by: string | null; e?: Extras; cancelled: boolean; unknown?: boolean }[] = [
      ...history.map((h) => ({ at: h.at, by: h.by, e: ex.get(h.at), cancelled: false })),
      ...outside.map((e) => ({ at: e.doneAt, by: null, e, cancelled: !(full && e.doneAt < full), unknown: true })),
    ].filter((r) => !from || parisDay(r.at) >= from).sort((a, b) => (a.at < b.at ? 1 : -1));
    const lines = all.map((r): CarnetLine => {
      const day = parisDay(r.at);
      return {
        day, by: r.unknown ? '' : r.by ? names.get(r.by) || 'un ancien membre' : 'le foyer',
        amount: spend.get(`${t.id}@${r.at}`) ?? null, note: r.e?.note || '', cancelled: r.cancelled,
        proofs: (r.e?.files || []).map((f) => {
          const ext = /\.[a-z0-9]{1,5}$/i.exec(f.name)?.[0] || (f.mime === 'application/pdf' ? '.pdf' : '.jpg');
          const base = `justificatifs/${safe(room)} - ${safe(t.text).slice(0, 80)} - ${day}`;
          let path = base + ext;
          for (let i = 2; used.has(path); i++) path = `${base} (${i})${ext}`;
          used.add(path); proofs++;
          return { fileId: f.id, name: f.name, path };
        }),
      };
    });
    return { title: t.text, howto: t.maintenance?.howto || '', archived: !!t.done, lines };
  };

  const out: CarnetRoom[] = rooms.map((r) => ({ name: r.name, gestes: gestes.filter((t) => t.maintenance?.roomId === r.id).map((t) => geste(t, r.name)) }));
  out.push({ name: 'Sans pièce', gestes: gestes.filter((t) => !t.maintenance?.roomId || !known.has(t.maintenance.roomId)).map((t) => geste(t, 'Sans pièce')) });
  return { household: state.familyName || '', from, today, rooms: out.filter((r) => r.gestes.length), proofs };
}

/** Le PDF : un titre par pièce, un sous-titre par geste, une ligne par réalisation et sa note dessous. */
export function carnetPdf(c: Carnet): Buffer {
  const blocks: DocBlock[] = [];
  for (const r of c.rooms) {
    blocks.push({ h2: r.name });
    for (const g of r.gestes) {
      blocks.push({ h3: g.title + (g.archived ? ' (archivé)' : '') });
      if (g.howto) blocks.push({ p: g.howto, muted: true });
      if (!g.lines.length) blocks.push({ p: 'Aucune réalisation sur la période.', muted: true });
      for (const l of g.lines) {
        const head = [frDate(l.day), l.cancelled ? 'réalisation annulée' : l.by ? 'par ' + l.by : '', l.amount !== null ? euros(l.amount) + ' €' : '',
          l.proofs.length ? `justificatif${l.proofs.length > 1 ? 's' : ''} : ${l.proofs.map((p) => p.name).join(', ')}` : ''].filter(Boolean).join(' · ');
        blocks.push({ p: head });
        if (l.note) blocks.push({ p: 'Note : ' + l.note, muted: true });
      }
    }
  }
  if (!blocks.length) blocks.push({ p: 'Aucun geste d’entretien noté.' });
  const n = c.rooms.reduce((t, r) => t + r.gestes.reduce((u, g) => u + g.lines.length, 0), 0);
  return documentPdf({
    title: 'Carnet d’entretien',
    subtitle: [c.household, c.from ? `du ${frDate(c.from)} au ${frDate(c.today)}` : `jusqu’au ${frDate(c.today)}`, `${n} réalisation${n > 1 ? 's' : ''}`].filter(Boolean).join(' · '),
    blocks,
    footer: `Carnet d’entretien · édité le ${frDate(c.today)}`,
  });
}

/**
 * Le zip : le PDF, et chaque justificatif sous un nom qui dit la pièce, le
 * geste et le jour. Un fichier absent du disque est signalé dans
 * `absents.txt` plutôt que de faire échouer l'export.
 */
export function carnetZip(sink: ZipSink, c: Carnet): void {
  const zip = new ZipWriter(sink);
  zip.add('carnet-entretien.pdf', carnetPdf(c));
  const missing: string[] = [];
  for (const r of c.rooms) for (const g of r.gestes) for (const l of g.lines) for (const p of l.proofs) {
    const f = fileOf(p.fileId);
    if (!f) { missing.push(p.path); continue; }
    zip.add(p.path, fs.readFileSync(f.path));
  }
  if (missing.length) {
    zip.add('absents.txt', Buffer.from('Justificatifs absents du disque (restaurer le répertoire « pieces ») :\r\n' + missing.join('\r\n') + '\r\n', 'utf-8'));
  }
  zip.finish();
}
