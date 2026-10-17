// Les outils d'assistant du module Équipements. Ils passent par les mêmes
// fonctions que l'API (equipements/routes.ts) : même validation, même filtre
// enfant (ni numéro de série, ni montant, ni facture ni plaque), même garantie
// calculée à la date du jour. Aucun fichier ne sort par ici : l'assistant dit
// qu'une facture existe, il ne la télécharge pas.
//
// Les textes sont courts, en français, avec l'identifiant entre crochets
// (« [12] ») pour qu'un geste suivant puisse viser la fiche.
import * as repo from '../equipements/repo';
import { detailView, houseRooms, itemFields, listViews, ItemView } from '../equipements/routes';
import { Invalid } from '../equipements/http';
import { norm } from '../equipements/search';
import { frDate } from '../equipements/warranty';
import { log } from '../log';
import type { McpCtx } from './tools';

const STATUS: Record<string, string> = { en_service: 'en service', en_panne: 'en panne', remplace: 'remplacé', donne_vendu: 'donné ou vendu', jete: 'jeté' };
const KIND: Record<string, string> = { achat: 'achat', panne: 'panne', reparation: 'réparation', sav: 'SAV', remplacement: 'remplacement', note: 'note' };
const euros = (c: number | null): string => (c === null ? '' : (c / 100).toFixed(2).replace('.', ',') + ' €');
const GARANTIES = ['sous_garantie', 'expire_bientot', 'hors_garantie', 'inconnue'] as const;

/** Une ligne de liste : de quoi reconnaître l'appareil et savoir où en est sa garantie. */
const line = (v: ItemView): string =>
  `[${v.id}] ${v.name}${v.brand || v.model ? ' · ' + [v.brand, v.model].filter(Boolean).join(' ') : ''}`
  + ` · ${v.roomName || 'sans pièce'} · ${v.warranty.label}${v.status !== 'en_service' ? ' · ' + STATUS[v.status] : ''}${v.archivedAt ? ' · archivé' : ''}`;

/** Une pièce par son nom (casse et accents ignorés). Inconnue : la liste des pièces, pour réessayer. */
function roomByName(name: string): string {
  const rooms = houseRooms();
  const r = rooms.find((x) => norm(x.name) === norm(name));
  if (!r) throw new Invalid(`Pièce « ${name} » inconnue. Pièces du foyer : ${rooms.map((x) => x.name).join(', ') || 'aucune (à créer dans l’écran Équipements)'}.`);
  return r.id;
}

/** Une fiche par son identifiant, ou par sa désignation quand elle est unique. */
function resolve(ctx: McpCtx, ref: { id?: number; nom?: string }): repo.Item {
  if (ref.id !== undefined) {
    const it = repo.getItem(ref.id);
    if (!it) throw new Invalid(`Aucun équipement [${ref.id}].`);
    return it;
  }
  const q = (ref.nom || '').trim();
  if (!q) throw new Invalid('Précisez `id` (de equipements_liste) ou `nom`.');
  const found = listViews({ recherche: q }, ctx.enfant);
  if (found.length === 1) return repo.getItem(found[0].id)!;
  if (!found.length) throw new Invalid(`Aucun équipement ne correspond à « ${q} ».`);
  throw new Invalid(`Plusieurs équipements correspondent à « ${q} » : ${found.slice(0, 8).map(line).join(' ; ')}. Précisez l’id.`);
}

/** Exécute une écriture et rend le message d'une saisie refusée, plutôt qu'une erreur brute. */
function guarded(fn: () => string): string {
  try { return fn(); } catch (e) { if (e instanceof Invalid) return 'Refusé : ' + e.message; throw e; }
}

export function equipementsListe(ctx: McpCtx, a: { piece?: string; garantie?: string; categorie?: string; recherche?: string }): string {
  return guarded(() => {
    const garantie = a.garantie && (GARANTIES as readonly string[]).includes(a.garantie) ? a.garantie as typeof GARANTIES[number] : undefined;
    if (a.garantie && !garantie) throw new Invalid(`garantie : attendu ${GARANTIES.join(', ')}.`);
    const categorie = a.categorie && (repo.CATEGORIES as readonly string[]).includes(a.categorie) ? a.categorie as repo.Category : undefined;
    if (a.categorie && !categorie) throw new Invalid(`categorie : attendu ${repo.CATEGORIES.join(', ')}.`);
    const items = listViews({ recherche: a.recherche, piece: a.piece ? roomByName(a.piece) : undefined, garantie, categorie }, ctx.enfant);
    if (!items.length) return 'Aucun équipement ne correspond.';
    return `${items.length} équipement${items.length > 1 ? 's' : ''} :\n` + items.map(line).join('\n');
  });
}

export function equipementDetail(ctx: McpCtx, a: { id?: number; nom?: string }): string {
  return guarded(() => {
    const d = detailView(resolve(ctx, a).id, ctx.enfant)!;
    const out = [
      line(d),
      d.warranty.explain + (d.warrantyNote ? ' ' + d.warrantyNote : ''),
      d.serial ? `Numéro de série : ${d.serial}` : '',
      d.purchasedOn ? `Acheté le ${frDate(d.purchasedOn)}${d.purchasePrice !== null ? ' pour ' + euros(d.purchasePrice) : ''}${d.vendor ? ' chez ' + d.vendor : ''}.` : '',
      d.replacedByName ? `Remplacé par [${d.replacedBy}] ${d.replacedByName}.` : '',
      d.replaces.length ? 'Remplace : ' + d.replaces.map((r) => `[${r.id}] ${r.name}`).join(', ') + '.' : '',
      d.notes ? 'Notes : ' + d.notes : '',
      d.attachmentList.length ? 'Pièces jointes (à ouvrir dans l’application) : ' + d.attachmentList.map((x) => `${x.kind} « ${x.label || x.name} »`).join(', ') + '.' : 'Aucune pièce jointe.',
      d.events.length ? 'Historique :\n' + d.events.map((e) => `- ${frDate(e.at)} ${KIND[e.kind]}${e.text ? ' : ' + e.text : ''}${e.cost !== null ? ' (' + euros(e.cost) + ')' : ''}`).join('\n') : 'Historique vide.',
    ];
    return out.filter(Boolean).join('\n');
  });
}

export function equipementPieces(): string {
  const counts = new Map<string, number>();
  for (const it of repo.listItems(false)) if (it.roomId) counts.set(it.roomId, (counts.get(it.roomId) || 0) + 1);
  const rooms = houseRooms().sort((x, y) => x.position - y.position);
  if (!rooms.length) return 'Aucune pièce : elles se créent dans l’écran Équipements (menu ⋯, « Gérer les pièces »).';
  return rooms.map((r) => `${r.name} : ${counts.get(r.id) || 0} équipement${(counts.get(r.id) || 0) > 1 ? 's' : ''}`).join('\n');
}

export interface EqpChamps { nom?: string; piece?: string; marque?: string; modele?: string; serie?: string; achete_le?: string; prix?: number | string; garantie_mois?: number; garantie_fin?: string; statut?: string; notes?: string; }

/** Les noms de l'assistant vers ceux de l'API, puis la même validation que l'écran. */
function fieldsFrom(a: EqpChamps): repo.ItemFields {
  const body: Record<string, unknown> = {};
  if (a.nom !== undefined) body['name'] = a.nom;
  if (a.piece !== undefined) body['room_id'] = a.piece === '' ? null : roomByName(a.piece);
  if (a.marque !== undefined) body['brand'] = a.marque;
  if (a.modele !== undefined) body['model'] = a.modele;
  if (a.serie !== undefined) body['serial'] = a.serie;
  if (a.achete_le !== undefined) body['purchased_on'] = a.achete_le;
  if (a.prix !== undefined) body['purchase_price'] = a.prix;
  if (a.garantie_mois !== undefined) body['warranty_months'] = a.garantie_mois;
  if (a.garantie_fin !== undefined) body['warranty_until'] = a.garantie_fin;
  if (a.statut !== undefined) body['status'] = a.statut;
  if (a.notes !== undefined) body['notes'] = a.notes;
  return itemFields(body);
}

export function equipementCreer(ctx: McpCtx, a: EqpChamps): string {
  return guarded(() => {
    const f = fieldsFrom(a);
    if (!f.name) throw new Invalid('`nom` est requis.');
    const it = repo.createItem({ ...f, name: f.name }, ctx.memberId, ctx.via);
    log.info(`Équipements : « ${it.name} » créé par l’assistant (${ctx.via}).`);
    return 'Créé : ' + line(detailView(it.id, false)!) + '\nLa photo de la plaque et la facture se joignent depuis l’application.';
  });
}

export function equipementModifier(ctx: McpCtx, a: EqpChamps & { id?: number }): string {
  return guarded(() => {
    const cur = resolve(ctx, { id: a.id, nom: a.id === undefined ? a.nom : undefined });
    const f = fieldsFrom(a.id === undefined ? { ...a, nom: undefined } : a);
    if (!Object.keys(f).length) throw new Invalid('Rien à modifier : précisez au moins un champ.');
    const changed = f.status !== undefined && f.status !== cur.status;
    if (changed && f.status_on === undefined) f.status_on = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    repo.editItem(cur.id, f, ctx.memberId);
    if (changed) log.info(`Équipements : « ${cur.name} » passe de ${cur.status} à ${f.status} (assistant ${ctx.via}).`);
    return 'Modifié : ' + line(detailView(cur.id, false)!);
  });
}

export function equipementEvenement(ctx: McpCtx, a: { id?: number; nom?: string; type?: string; texte?: string; cout?: number | string; date?: string }): string {
  return guarded(() => {
    const it = resolve(ctx, a);
    const kind = a.type as repo.EventKind;
    if (!repo.EVENT_KINDS.includes(kind)) throw new Invalid(`type : attendu ${repo.EVENT_KINDS.join(', ')}.`);
    const at = a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    const text = String(a.texte ?? '').trim().slice(0, 1000);
    let cost: number | null = null;
    if (a.cout !== undefined && a.cout !== '') {
      const n = typeof a.cout === 'number' ? a.cout : Number(String(a.cout).replace(/[\s€]/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new Invalid('cout : un montant en euros, par exemple 89,90.');
      cost = Math.round(n * 100);
    }
    const { item } = repo.addEvent(it.id, at, kind, text, cost, ctx.memberId, ctx.via);
    log.info(`Équipements : événement « ${kind} » noté sur « ${it.name} » par l’assistant (${ctx.via}).`);
    const statut = item.status !== it.status ? ` La fiche passe « ${STATUS[item.status]} ».` : '';
    return `Noté sur [${it.id}] ${it.name} : ${KIND[kind]} du ${frDate(at)}${text ? ' (' + text + ')' : ''}.${statut}`;
  });
}
