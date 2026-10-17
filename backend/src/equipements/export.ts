// L'export pour l'assurance : la liste des équipements encore là (en service ou
// en panne, non archivés), avec pièce, désignation, marque, modèle, numéro de
// série, date et prix d'achat, en CSV (Numbers, Excel) et en PDF, et les
// factures jointes dans un zip.
//
// Réservé aux adultes (garde dans le routeur) : c'est l'inventaire de la
// maison avec sa valeur. Le zip écrit chaque facture une seule fois, même
// jointe à plusieurs fiches (la facture d'une cuisine complète), et le CSV dit
// pour chaque appareil où la trouver dans l'archive.
import * as repo from './repo';
import { houseRooms } from './routes';
import { computeWarranty, frDate } from './warranty';
import { fileOf } from '../storage/files';
import { tablePdf } from '../export/pdf';
import { ZipSink, ZipWriter } from '../export/zip-writer';
import fs from 'fs';

const CAT: Record<string, string> = {
  electromenager: 'Électroménager', multimedia: 'Multimédia', chauffage_clim: 'Chauffage et climatisation', securite: 'Sécurité',
  jardin_piscine: 'Jardin et piscine', informatique: 'Informatique', mobilier: 'Mobilier', autre: 'Autre',
};
const COND: Record<string, string> = { neuf: 'Neuf', occasion_pro: 'Occasion (professionnel)', occasion_particulier: 'Occasion (particulier)' };
const euros = (c: number | null): string => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));

export interface InsuranceRow {
  item: repo.Item; room: string; warranty: string;
  /** Les factures jointes : identifiant de fichier et chemin dans le zip. */
  invoices: { fileId: number; path: string }[];
}

/** Les lignes de l'export, triées par pièce (ordre des pièces) puis par désignation. */
export function insuranceRows(rules: { defaultMonths: number; alertDays: number }, today: string): InsuranceRow[] {
  const rooms = houseRooms().sort((a, b) => a.position - b.position);
  const rank = new Map(rooms.map((r, i) => [r.id, i]));
  const names = new Map(rooms.map((r) => [r.id, r.name]));
  const items = repo.listItems(false)
    .filter((it) => it.status === 'en_service' || it.status === 'en_panne')
    .sort((a, b) => (rank.get(a.roomId ?? '') ?? 999) - (rank.get(b.roomId ?? '') ?? 999) || a.name.localeCompare(b.name, 'fr'));
  // Un fichier, un chemin : la facture partagée est nommée d'après la première fiche qui la porte.
  const paths = new Map<number, string>();
  const used = new Set<string>();
  return items.map((item) => {
    const room = (item.roomId && names.get(item.roomId)) || 'Sans pièce';
    const invoices = repo.attachmentsOf(item.id).filter((a) => a.kind === 'facture').map((a) => {
      let p = paths.get(a.fileId);
      if (!p) {
        const ext = /\.[a-z0-9]{1,5}$/i.exec(a.name)?.[0] || (a.mime === 'application/pdf' ? '.pdf' : '.jpg');
        const safe = (x: string): string => x.replace(/[\\/:*?"<>|]/g, '_');
        const base = `factures/${safe(room)} - ${safe(item.name)}`;
        p = base + ext;
        for (let i = 2; used.has(p); i++) p = `${base} (${i})${ext}`;
        used.add(p); paths.set(a.fileId, p);
      }
      return { fileId: a.fileId, path: p };
    });
    return { item, room, warranty: computeWarranty(item, rules, today).label, invoices };
  });
}

const HEADERS = ['Pièce', 'Désignation', 'Catégorie', 'Marque', 'Modèle', 'Numéro de série', 'Date d’achat', 'Prix d’achat (€)', 'Vendeur', 'État à l’achat', 'Garantie', 'Statut', 'Facture'];

/** Une cellule CSV : entre guillemets si besoin, guillemets doublés. Une formule (=, +, -, @) est neutralisée. */
const cell = (v: string): string => {
  const s = /^[=+\-@]/.test(v) ? '\'' + v : v;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** Le CSV : séparateur « ; », UTF-8 avec BOM, fins de ligne CRLF. S'ouvre tel quel dans Numbers et Excel en français. */
export function insuranceCsv(rows: InsuranceRow[]): Buffer {
  const lines = [HEADERS, ...rows.map((r) => [
    r.room, r.item.name, CAT[r.item.category] || '', r.item.brand, r.item.model, r.item.serial,
    r.item.purchasedOn ? frDate(r.item.purchasedOn) : '', euros(r.item.purchasePrice), r.item.vendor, COND[r.item.condition] || '',
    r.warranty, r.item.status === 'en_panne' ? 'En panne' : 'En service', r.invoices.map((i) => i.path).join(' ; '),
  ])].map((l) => l.map(cell).join(';'));
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf-8');
}

/** Le PDF : une ligne par appareil, et le total des prix connus. */
export function insurancePdf(rows: InsuranceRow[], household: string, today: string): Buffer {
  const total = rows.reduce((t, r) => t + (r.item.purchasePrice ?? 0), 0);
  const sansPrix = rows.filter((r) => r.item.purchasePrice === null).length;
  return tablePdf({
    title: 'Inventaire des équipements',
    subtitle: `${household ? household + ' · ' : ''}état au ${frDate(today)} · ${rows.length} appareil${rows.length > 1 ? 's' : ''}`,
    columns: [
      { title: 'Pièce', width: 82 }, { title: 'Désignation', width: 118 }, { title: 'Marque', width: 70 }, { title: 'Modèle', width: 88 },
      { title: 'Numéro de série', width: 110 }, { title: 'Achat', width: 56 }, { title: 'Prix (€)', width: 58, align: 'right' },
      { title: 'Garantie', width: 150 }, { title: 'Facture', width: 38 },
    ],
    rows: rows.map((r) => [r.room, r.item.name, r.item.brand, r.item.model, r.item.serial,
      r.item.purchasedOn ? frDate(r.item.purchasedOn) : '', euros(r.item.purchasePrice), r.warranty, r.invoices.length ? 'oui' : '']),
    footer: `Valeur d’achat connue : ${euros(total)} €${sansPrix ? ` (${sansPrix} appareil${sansPrix > 1 ? 's' : ''} sans prix)` : ''}`,
  });
}

/**
 * Le zip : le CSV, le PDF, et chaque facture une fois. Une facture absente du
 * disque est signalée dans `absentes.txt` plutôt que de faire échouer l'export.
 */
export function insuranceZip(sink: ZipSink, rows: InsuranceRow[], household: string, today: string): void {
  const zip = new ZipWriter(sink);
  zip.add('equipements.csv', insuranceCsv(rows));
  zip.add('equipements.pdf', insurancePdf(rows, household, today));
  const done = new Set<number>();
  const missing: string[] = [];
  for (const r of rows) {
    for (const inv of r.invoices) {
      if (done.has(inv.fileId)) continue;
      done.add(inv.fileId);
      const f = fileOf(inv.fileId);
      if (!f) { missing.push(`${inv.path} (${r.item.name})`); continue; }
      zip.add(inv.path, fs.readFileSync(f.path));
    }
  }
  if (missing.length) {
    zip.add('absentes.txt', Buffer.from('Factures absentes du disque (restaurer le répertoire « pieces ») :\r\n' + missing.join('\r\n') + '\r\n', 'utf-8'));
  }
  zip.finish();
}
