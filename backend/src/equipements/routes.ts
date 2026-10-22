// Surface HTTP du module « Équipements », montée sur /api/equipements derrière
// `requireMember` et le drapeau `modEquipements`. Tout membre lit ; seuls les
// adultes créent, modifient, archivent et joignent des fichiers.
//
// Un enfant lit les fiches **sans** numéro de série, prix, vendeur ni coût, et
// ne peut ouvrir ni une facture ni une photo de plaque (la plaque montre le
// numéro de série). Le filtre est appliqué ici, à la sortie, pas dans l'écran :
// l'API ne rend jamais à un enfant ce que l'écran lui cacherait.
//
// Les pièces sont celles du socle Maison (document du foyer, `rooms`), la même
// liste qu'Entretien : la fiche en garde l'identifiant (`room_id` dans l'API).
//
// L'état de la garantie est calculé à chaque lecture, à la date du jour à Paris,
// avec les règles du foyer (voir warranty.ts). Il n'est jamais stocké.
import express, { NextFunction, Request, Response, Router } from 'express';
import * as repo from './repo';
import * as backup from './backup';
import { fail, id, makeHandler } from './http';
import { CONDITIONS, Warranty, WarrantyRules, WarrantyState, computeWarranty, isDay } from './warranty';
import { AuthedRequest, currentMember } from '../auth/session';
import { effectiveSetting } from '../settings/repo';
import { contentDisposition } from '../headers';
import { checkUpload } from '../storage/upload-check';
import * as files from '../storage/files';
import { log } from '../log';
import { getHousehold } from '../db';
import { matches } from './search';
import { insuranceCsv, insurancePdf, insuranceRows, insuranceZip } from './export';

type Guard = (req: Request, res: Response, next: NextFunction) => void;

const handler = makeHandler('Équipements : erreur inattendue', 'Erreur du module Équipements : ');
const member = (req: Request) => currentMember(req as AuthedRequest);
const author = (req: Request): string | null => member(req)?.id ?? null;
const isChild = (req: Request): boolean => !!member(req)?.enfant;
const who = (req: Request): string => member(req)?.name || 'inconnu';

/** Les gestes d'écriture : adultes seulement. */
const adulte: Guard = (req, res, next) => {
  if (isChild(req)) { res.status(403).json({ error: 'Seul un adulte peut modifier les équipements.' }); return; }
  next();
};

export const today = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
export const rules = (): WarrantyRules => ({
  defaultMonths: Number(effectiveSetting('eqpGarantieDefautMois')),
  alertDays: Number(effectiveSetting('eqpGarantieAlerteJours')),
});

/**
 * Plafond d'un fichier. Pas de réglage foyer ici : celui des photos de recettes
 * vit dans la section Repas, qui disparaît avec son module. Une photo réduite
 * pèse moins d'un mégaoctet, une facture scannée quelques-uns.
 */
const MAX_UPLOAD = '20mb';
/** Les pièces qu'un enfant peut ouvrir. Une facture porte le prix, une plaque le numéro de série. */
const CHILD_KINDS: readonly repo.AttachmentKind[] = ['notice', 'photo'];
/** Une plaque ou une photo est une image ; une facture ou une notice peut être un PDF. */
const PDF_KINDS: readonly repo.AttachmentKind[] = ['facture', 'notice', 'autre'];

// ---- saisie ---------------------------------------------------------------

const text = (v: unknown, field: string, max: number, required = false): string => {
  const s = String(v ?? '').trim();
  if (!s && required) fail(`Le champ « ${field} » est requis.`);
  if (s.length > max) fail(`Le champ « ${field} » dépasse ${max} caractères.`);
  return s;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], field: string): T => {
  const s = String(v ?? '').trim() as T;
  if (!allowed.includes(s)) fail(`Valeur invalide pour « ${field} » : attendu ${allowed.join(', ')}.`);
  return s;
};
const day = (v: unknown, field: string): string => {
  const s = String(v ?? '').trim();
  if (!isDay(s)) fail(`Date invalide pour « ${field} » : attendu AAAA-MM-JJ.`);
  return s;
};
/** Absent, null ou blanc : « pas de valeur ». Un coût non saisi n'est pas un coût nul. */
const empty = (v: unknown): boolean => v === undefined || v === null || v === '' || (typeof v === 'string' && !v.trim());
const optDay = (v: unknown, field: string): string | null => (empty(v) ? null : day(v, field));
/** Un montant en euros (« 1 234,56 » ou 1234.56) vers des centimes entiers. */
export const eurosToCents = (v: unknown, field: string): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[\s  €]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) fail(`Montant invalide pour « ${field} » : un nombre d’euros, par exemple 449,99.`);
  return Math.round(n * 100);
};
const optCents = (v: unknown, field: string): number | null => (empty(v) ? null : eurosToCents(v, field));
const optMonths = (v: unknown): number | null => {
  if (empty(v)) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isInteger(n) || n < 0 || n > 240) fail('Durée de garantie invalide : un nombre entier de mois, de 0 à 240.');
  return n;
};
/** Les pièces du socle Maison (document du foyer), partagées avec Entretien. */
export const houseRooms = (): { id: string; name: string; position: number }[] => {
  const rooms = (getHousehold().state as { rooms?: unknown }).rooms;
  return Array.isArray(rooms) ? rooms.filter((r) => r && typeof r.id === 'string') : [];
};
const roomRef = (v: unknown): string | null => {
  if (empty(v)) return null;
  const s = String(v);
  if (!houseRooms().some((r) => r.id === s)) fail('Pièce introuvable.');
  return s;
};
const assetRef = (v: unknown): number | null => {
  if (empty(v)) return null;
  const a = id(v, 'asset_id');
  if (!repo.assetExists(a)) fail('Bien immobilier introuvable dans Finances.');
  return a;
};

/** Les champs d'une fiche présents dans le corps, validés. Absent = inchangé. Sert aussi à l'assistant (MCP). */
export function itemFields(b: Record<string, unknown>): repo.ItemFields {
  const f: repo.ItemFields = {};
  const has = (k: string): boolean => b[k] !== undefined;
  if (has('name')) f.name = text(b['name'], 'name', 120, true);
  if (has('room_id')) f.room_ref = roomRef(b['room_id']);
  if (has('asset_id')) f.asset_id = assetRef(b['asset_id']);
  if (has('category')) f.category = oneOf(b['category'], repo.CATEGORIES, 'category');
  if (has('brand')) f.brand = text(b['brand'], 'brand', 80);
  if (has('model')) f.model = text(b['model'], 'model', 80);
  if (has('serial')) f.serial = text(b['serial'], 'serial', 80);
  if (has('purchased_on')) f.purchased_on = optDay(b['purchased_on'], 'purchased_on');
  if (has('purchase_price')) f.purchase_price = optCents(b['purchase_price'], 'purchase_price');
  if (has('vendor')) f.vendor = text(b['vendor'], 'vendor', 120);
  if (has('condition')) f.condition = oneOf(b['condition'], CONDITIONS, 'condition');
  if (has('warranty_months')) f.warranty_months = optMonths(b['warranty_months']);
  if (has('warranty_until')) f.warranty_until = optDay(b['warranty_until'], 'warranty_until');
  if (has('warranty_note')) f.warranty_note = text(b['warranty_note'], 'warranty_note', 500);
  if (has('notes')) f.notes = text(b['notes'], 'notes', 2000);
  if (has('status')) f.status = oneOf(b['status'], repo.STATUSES, 'status');
  if (has('status_on')) f.status_on = optDay(b['status_on'], 'status_on');
  return f;
}

// ---- lecture --------------------------------------------------------------

export interface ItemView extends Omit<repo.Item, 'serial' | 'purchasePrice' | 'vendor' | 'assetId'> {
  serial: string | null; purchasePrice: number | null; vendor: string | null; assetId: number | null;
  roomName: string | null; warranty: Warranty; attachments: Partial<Record<repo.AttachmentKind, number>>;
  replacedByName: string | null;
}

/** Ce qu'un membre voit d'une fiche. Un enfant : ni série, ni prix, ni vendeur, ni bien, ni décompte de factures et plaques. */
export function view(it: repo.Item, child: boolean, ctx: { rooms: Map<string, string>; counts: Map<number, Partial<Record<repo.AttachmentKind, number>>>; names: Map<number, string>; t: string; r: WarrantyRules }): ItemView {
  const counts = { ...(ctx.counts.get(it.id) ?? {}) };
  if (child) for (const k of Object.keys(counts) as repo.AttachmentKind[]) if (!CHILD_KINDS.includes(k)) delete counts[k];
  return {
    ...it,
    serial: child ? null : it.serial,
    purchasePrice: child ? null : it.purchasePrice,
    vendor: child ? null : it.vendor,
    assetId: child ? null : it.assetId,
    roomName: it.roomId !== null ? ctx.rooms.get(it.roomId) ?? null : null,
    warranty: computeWarranty(it, ctx.r, ctx.t),
    attachments: counts,
    replacedByName: it.replacedBy !== null ? ctx.names.get(it.replacedBy) ?? null : null,
  };
}

function viewContext() {
  const all = repo.listItems(true);
  return {
    rooms: new Map(houseRooms().map((r) => [r.id, r.name])),
    counts: repo.attachmentCounts(),
    names: new Map(all.map((i) => [i.id, i.name])),
    t: today(), r: rules(),
  };
}

const WARRANTY_STATES: readonly WarrantyState[] = ['sous_garantie', 'expire_bientot', 'hors_garantie', 'inconnue'];

/** Les fiches filtrées, triées par nom. Les filtres sont ceux de l'écran et de l'assistant. */
export function listViews(q: { recherche?: string; piece?: string; garantie?: WarrantyState; categorie?: repo.Category; statut?: repo.Status; archives?: boolean }, child: boolean): ItemView[] {
  const ctx = viewContext();
  return repo.listItems(!!q.archives)
    // Une pièce supprimée du socle laisse ses fiches « sans pièce » : `none` les retrouve.
    .filter((it) => q.piece === undefined || (q.piece === 'none' ? !it.roomId || !ctx.rooms.has(it.roomId) : it.roomId === q.piece))
    .filter((it) => !q.categorie || it.category === q.categorie)
    .filter((it) => !q.statut || it.status === q.statut)
    .filter((it) => !q.recherche || matches(it, q.recherche, child))
    .map((it) => view(it, child, ctx))
    .filter((v) => !q.garantie || v.warranty.state === q.garantie);
}

/**
 * Les garanties à surveiller pour le rappel de fin : fiches actives, appareils
 * encore là (en service ou en panne), dont la date de fin est connue.
 */
export function watchedWarranties(): { id: number; name: string; until: string; daysLeft: number }[] {
  const t = today(), r = rules();
  return repo.listItems(false)
    .filter((it) => it.status === 'en_service' || it.status === 'en_panne')
    .map((it) => ({ it, w: computeWarranty(it, r, t) }))
    .filter(({ w }) => w.until !== null && w.daysLeft !== null)
    .map(({ it, w }) => ({ id: it.id, name: it.name, until: w.until!, daysLeft: w.daysLeft! }));
}

/** Une fiche complète : pièces jointes et historique, filtrés pour un enfant. */
export function detailView(itemId: number, child: boolean) {
  const it = repo.getItem(itemId);
  if (!it) return null;
  const attachments = repo.attachmentsOf(itemId).filter((a) => !child || CHILD_KINDS.includes(a.kind));
  const events = repo.eventsOf(itemId).map((e) => (child ? { ...e, cost: null } : e));
  return { ...view(it, child, viewContext()), attachmentList: attachments, events, replaces: repo.replacedItems(itemId) };
}

// ---- routeur --------------------------------------------------------------

export function equipementsRouter(requireAdmin: Guard): Router {
  const r = express.Router();
  // Corps JSON courts partout, sauf la restauration qui lit le sien plus large.
  const json = express.json({ limit: '256kb' });
  r.use((req, res, next) => (req.path === '/restore' ? next() : json(req, res, next)));

  r.get('/bootstrap', handler((req, res) => {
    const child = isChild(req);
    res.json({
      today: today(),
      rules: rules(),
      canEdit: !child,
      items: listViews({}, child),
      // Le champ « bien » n'existe que s'il y a plusieurs biens immobiliers, et
      // que Finances est actif : sinon, la question ne se pose pas.
      assets: !child && effectiveSetting('modFinances') !== false ? repo.realEstateAssets() : [],
    });
  }));

  r.get('/items', handler((req, res) => {
    const q = req.query;
    const items = listViews({
      recherche: q['q'] ? String(q['q']).slice(0, 120) : undefined,
      piece: q['room'] ? String(q['room']).slice(0, 40) : undefined,
      garantie: q['garantie'] ? oneOf(q['garantie'], WARRANTY_STATES, 'garantie') : undefined,
      categorie: q['categorie'] ? oneOf(q['categorie'], repo.CATEGORIES, 'categorie') : undefined,
      statut: q['statut'] ? oneOf(q['statut'], repo.STATUSES, 'statut') : undefined,
      archives: q['archived'] === '1',
    }, isChild(req));
    res.json({ items, total: items.length });
  }));

  r.get('/items/:id', handler((req, res) => {
    const d = detailView(id(req.params['id'], 'id'), isChild(req));
    if (!d) { res.status(404).json({ error: 'Équipement introuvable.' }); return; }
    res.json({ item: d });
  }));

  // ---- fiches (adultes) ----
  r.post('/items', adulte, handler((req, res) => {
    const b = req.body as Record<string, unknown>;
    const f = itemFields(b);
    if (!f.name) fail('Le champ « name » est requis.');
    const it = repo.createItem({ ...f, name: f.name! }, author(req), null);
    log.info(`Équipements : « ${it.name} » créé par ${who(req)}.`);
    res.status(201).json({ item: detailView(it.id, false) });
  }));

  r.put('/items/:id', adulte, handler((req, res) => {
    const itemId = id(req.params['id'], 'id');
    const cur = repo.getItem(itemId); if (!cur) { res.status(404).json({ error: 'Équipement introuvable.' }); return; }
    const f = itemFields(req.body as Record<string, unknown>);
    if (f.status !== undefined && f.status !== cur.status && f.status_on === undefined) f.status_on = today();
    repo.editItem(itemId, f, author(req));
    if (f.status !== undefined && f.status !== cur.status) {
      log.info(`Équipements : « ${cur.name} » passe de ${cur.status} à ${f.status} (${who(req)}).`);
    }
    res.json({ item: detailView(itemId, false) });
  }));

  for (const [path, archived] of [['archive', true], ['unarchive', false]] as const) {
    r.post(`/items/:id/${path}`, adulte, handler((req, res) => {
      const itemId = id(req.params['id'], 'id');
      const it = repo.setArchived(itemId, archived, author(req));
      if (!it) { res.status(404).json({ error: 'Équipement introuvable.' }); return; }
      log.info(`Équipements : « ${it.name} » ${archived ? 'archivé' : 'désarchivé'} par ${who(req)}.`);
      res.json({ item: detailView(itemId, false) });
    }));
  }

  // L'ancien appareil reste consultable, grisé, avec « remplacé par … ».
  r.post('/items/:id/replace', adulte, handler((req, res) => {
    const oldId = id(req.params['id'], 'id');
    const b = req.body as Record<string, unknown>;
    const newId = id(b['by'], 'by');
    const old = repo.getItem(oldId), neu = repo.getItem(newId);
    if (!old || !neu) { res.status(404).json({ error: 'Équipement introuvable.' }); return; }
    if (oldId === newId) fail('Un appareil ne peut pas se remplacer lui-même.');
    if (neu.replacedBy === oldId) fail('Ces deux fiches se remplaceraient l’une l’autre.');
    repo.replaceItem(oldId, newId, b['day'] ? day(b['day'], 'day') : today(), author(req));
    log.info(`Équipements : « ${old.name} » remplacé par « ${neu.name} » (${who(req)}).`);
    res.json({ item: detailView(oldId, false) });
  }));

  // ---- historique (adultes) ----
  r.post('/items/:id/events', adulte, handler((req, res) => {
    const itemId = id(req.params['id'], 'id');
    if (!repo.getItem(itemId)) { res.status(404).json({ error: 'Équipement introuvable.' }); return; }
    const b = req.body as Record<string, unknown>;
    const kind = oneOf(b['kind'], repo.EVENT_KINDS, 'kind');
    const { event, item } = repo.addEvent(itemId, b['at'] ? day(b['at'], 'at') : today(), kind,
      text(b['text'], 'text', 1000), optCents(b['cost'], 'cost'), author(req), null);
    log.info(`Équipements : événement « ${kind} » noté sur « ${item.name} » par ${who(req)}.`);
    res.status(201).json({ event, item: detailView(itemId, false) });
  }));

  r.post('/events/:id/archive', adulte, handler((req, res) => {
    const e = repo.getEvent(id(req.params['id'], 'id'));
    if (!e || e.archivedAt) { res.status(404).json({ error: 'Événement introuvable.' }); return; }
    repo.archiveEvent(e.id);
    res.json({ item: detailView(e.itemId, false) });
  }));

  // ---- pièces jointes ----
  r.post('/items/:id/attachments', adulte, express.raw({ type: '*/*', limit: MAX_UPLOAD }), handler((req, res) => {
    const itemId = id(req.params['id'], 'id');
    const it = repo.getItem(itemId); if (!it) { res.status(404).json({ error: 'Équipement introuvable.' }); return; }
    const kind = oneOf(req.query['kind'], repo.ATTACHMENT_KINDS, 'kind');
    const check = checkUpload(req.body, PDF_KINDS.includes(kind));
    if (!check.ok) { res.status(check.status).json({ error: check.error }); return; }
    const buf = req.body as Buffer, type = check.type;
    const name = String(req.query['filename'] || kind).slice(0, 200);
    const { file, deduplicated } = files.storeOnce('equipment', 'eqp', name, buf, type);
    const { attachment, existed } = repo.attach(itemId, kind, file.id, text(req.query['label'], 'label', 120), author(req));
    log.info(`Équipements : ${kind} « ${name} » jointe à « ${it.name} » par ${who(req)}${deduplicated ? ' (fichier déjà connu, non dupliqué)' : ''}.`);
    res.status(existed ? 200 : 201).json({ attachment, deduplicated, item: detailView(itemId, false) });
  }));

  r.get('/attachments/:id', handler((req, res) => {
    const a = repo.getAttachment(id(req.params['id'], 'id'));
    if (!a) { res.status(404).json({ error: 'Pièce jointe introuvable.' }); return; }
    if (isChild(req) && !CHILD_KINDS.includes(a.kind)) { res.status(403).json({ error: 'Cette pièce n’est pas accessible depuis un compte enfant.' }); return; }
    const f = files.fileOf(a.fileId);
    if (!f) {
      res.status(410).json({ error: 'Le fichier est absent du disque. Restaurez le répertoire « pieces » de vos sauvegardes, ou joignez-le à nouveau.' });
      return;
    }
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', contentDisposition(req.query['download'] === '1' ? 'attachment' : 'inline', f.name, 'piece'));
    res.sendFile(f.path);
  }));

  r.put('/attachments/:id', adulte, handler((req, res) => {
    const b = req.body as Record<string, unknown>;
    const a = repo.editAttachment(id(req.params['id'], 'id'), {
      kind: b['kind'] !== undefined ? oneOf(b['kind'], repo.ATTACHMENT_KINDS, 'kind') : undefined,
      label: b['label'] !== undefined ? text(b['label'], 'label', 120) : undefined,
    });
    if (!a) { res.status(404).json({ error: 'Pièce jointe introuvable.' }); return; }
    res.json({ attachment: a, item: detailView(a.itemId, false) });
  }));

  r.delete('/attachments/:id', adulte, handler((req, res) => {
    const a = repo.getAttachment(id(req.params['id'], 'id'));
    if (!a) { res.status(404).json({ error: 'Pièce jointe introuvable.' }); return; }
    const gone = repo.detach(a.id)!;
    // Plus aucune fiche ne cite ce fichier : il quitte le disque maintenant
    // (si aucun autre module ne détient les mêmes octets).
    if (gone.orphan) files.remove(gone.fileId);
    log.info(`Équipements : ${a.kind} « ${a.name} » retirée par ${who(req)}.`);
    res.json({ item: detailView(a.itemId, false) });
  }));

  // ---- export pour l'assurance (adultes) ----
  // L'inventaire de la maison avec sa valeur : jamais pour un compte enfant.
  r.get('/export/assurance.:format', adulte, handler((req, res) => {
    const format = oneOf(req.params['format'], ['csv', 'pdf', 'zip'] as const, 'format');
    const t = today();
    const rows = insuranceRows(rules(), t);
    const household = String((getHousehold().state as { familyName?: string }).familyName || '');
    const name = `equipements-assurance-${t}.${format}`;
    log.info(`Équipements : export pour l’assurance (${format}, ${rows.length} appareil(s)) par ${who(req)}.`);
    res.setHeader('Content-Disposition', contentDisposition('attachment', name, 'export'));
    res.setHeader('Cache-Control', 'private, no-store');
    if (format === 'csv') { res.type('text/csv; charset=utf-8').send(insuranceCsv(rows)); return; }
    if (format === 'pdf') { res.type('application/pdf').send(insurancePdf(rows, household, t)); return; }
    // Le zip part au fil de l'eau : une facture à la fois en mémoire.
    res.type('application/zip');
    insuranceZip(res, rows, household, t);
    res.end();
  }));

  // ---- sauvegarde / restauration du module (administrateur) ----
  r.get('/export.json', requireAdmin, handler((_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="equipements-${today()}.json"`);
    res.json(backup.exportModule());
  }));
  r.post('/restore', requireAdmin, express.json({ limit: '20mb' }), handler((req, res) => {
    const b = req.body as Record<string, unknown>;
    if (b['confirm'] !== 'REMPLACER') fail('Restauration non confirmée : envoyez « confirm: "REMPLACER" » pour écraser les données du module.');
    try {
      const report = backup.restoreModule(b['backup']);
      log.info(`Équipements : module restauré par ${who(req)}.`);
      res.json(report);
    } catch (e) {
      if (e instanceof backup.RestoreRefused) fail(e.message);
      throw e;
    }
  }));

  // Un fichier trop lourd ressortait en page HTML d'Express, sans dire la limite.
  r.use((err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type !== 'entity.too.large') { next(err); return; }
    res.status(413).json({ error: `Ce fichier dépasse le plafond du serveur (${MAX_UPLOAD.replace('mb', ' Mo')}).` });
  });

  return r;
}
