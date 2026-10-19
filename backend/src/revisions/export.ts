// Ce qui sort du module Révisions vers l'extérieur : le bilan d'une période en
// PDF (« Pour la maîtresse », une page par enfant, signé Foyer, sans aucune
// donnée d'un autre membre) et les sessions en CSV (pour le parent, un
// tableur). Rien ici ne connaît un exercice : libellés et résumés viennent du
// bilan, donc des définitions.
import { DocBlock, documentPdf } from '../export/pdf';
import { Bilan, BilanTotals } from './bilan';
import { SessionRow } from './repo';
import { exerciseById } from './exercises';
import { Params } from './exercises/contract';

const n = (k: number, one: string, many: string): string => `${k} ${k > 1 ? many : one}`;
const pct = (t: BilanTotals): string => `${t.pct} % de réponses justes`;
const frDate = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** La ligne d'un total : « 5 sessions, 120 questions : 98 bonnes, 12 lentes, 10 fausses ; 92 % de réponses justes (88 % sur la période précédente). » */
function totalLine(t: BilanTotals, prev: BilanTotals | null): string {
  return `${n(t.sessions, 'session', 'sessions')}, ${n(t.questions, 'question', 'questions')} : ${n(t.good, 'bonne', 'bonnes')}, ${n(t.slow, 'lente', 'lentes')}, ${n(t.wrong, 'fausse', 'fausses')} ; ${pct(t)}`
    + (prev ? ` (${prev.pct} % sur la période précédente).` : '.');
}

/** Le bilan d'une période en PDF : par matière, puis par exercice. */
export function bilanPdf(b: Bilan, today: string): Buffer {
  const blocks: DocBlock[] = [];
  if (!b.matieres.length) blocks.push({ p: 'Pas de session de révisions sur cette période.' });
  else if (b.matieres.flatMap((m) => m.exercises).length > 1) blocks.push({ p: 'En tout : ' + totalLine(b.totals, b.prev) });
  for (const m of b.matieres) {
    blocks.push({ h2: m.label });
    for (const e of m.exercises) {
      blocks.push({ h3: `${e.label} : ${e.summary}` });
      blocks.push({ p: e.totals.sessions ? totalLine(e.totals, e.prev) : 'Pas de session sur cette période.' });
      if (e.groups.length) {
        blocks.push({ table: {
          columns: [{ title: 'Groupe', width: 163 }, { title: 'Questions', width: 80, align: 'right' }, { title: 'Justes', width: 80, align: 'right' },
            { title: 'Rapides', width: 80, align: 'right' }, { title: 'Période précédente', width: 120, align: 'right' }],
          rows: e.groups.map((g) => [g.group, String(g.questions), `${g.pct} %`, `${g.fastPct} %`, g.prevPct === null ? '' : `${g.prevPct} % justes`]),
        } });
      }
      blocks.push({ p: e.fragiles.length ? `Encore fragiles : ${e.fragiles.map((f) => f.label).join(', ')}.` : 'Rien de fragile dans ce programme pour l’instant.' });
    }
  }
  return documentPdf({
    title: `Révisions de ${b.member.name}`, subtitle: b.label, blocks,
    footer: `Établi par Foyer le ${frDate(today)}. « Justes » compte aussi les réponses lentes ; « rapides » : justes dans le temps prévu pour l’âge.`,
  });
}

const cell = (v: string): string => {
  const s = /^[=+\-@]/.test(v) ? '\'' + v : v;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const MODE: Record<string, string> = { apprendre: 'Apprendre', entrainer: 'S’entraîner', test: 'Test' };
const wall = (iso: string, opts: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...opts }).format(new Date(iso));

/** Les sessions en CSV : séparateur « ; », UTF-8 avec BOM, fins de ligne CRLF, comme les autres exports de Foyer. */
export function sessionsCsv(rows: SessionRow[]): Buffer {
  const head = ['Date', 'Heure', 'Exercice', 'Mode', 'Réglages', 'Questions', 'Bonnes', 'Lentes', 'Fausses', 'Temps moyen (s)', 'Abandonnée'];
  const lines = [head, ...rows.map((s) => {
    const def = exerciseById(s.exercise_id);
    let what = '';
    try { what = def ? def.summary(JSON.parse(s.params_json) as Params) : ''; } catch { /* réglages illisibles : laissés vides */ }
    return [
      wall(s.started_at, { day: '2-digit', month: '2-digit', year: 'numeric' }), wall(s.started_at, { hour: '2-digit', minute: '2-digit' }),
      def?.label ?? s.exercise_id, MODE[s.mode] ?? s.mode, what, String(s.questions), String(s.good), String(s.slow), String(s.wrong),
      s.avg_ms === null ? '' : (s.avg_ms / 1000).toFixed(1).replace('.', ','), s.aborted ? 'oui' : 'non',
    ];
  })].map((l) => l.map(cell).join(';'));
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf-8');
}
