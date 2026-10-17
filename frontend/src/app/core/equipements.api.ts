import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';
import { Condition, Warranty, WarrantyRules, WarrantyState } from './warranty';

// Client léger sur /api/equipements. Le module vit dans ses tables
// relationnelles (eqp_*) : rien ici ne passe par le document d'état, sauf les
// pièces, qui sont celles du socle Maison partagé avec Entretien (FoyerStore).
// Les montants arrivent en centimes ; ils partent en euros, comme Finances.

export type Category = 'electromenager' | 'multimedia' | 'chauffage_clim' | 'securite' | 'jardin_piscine' | 'informatique' | 'mobilier' | 'autre';
export const CATEGORIES: { id: Category; label: string; icon: string; color: string }[] = [
  { id: 'electromenager', label: 'Électroménager', icon: 'bolt', color: '#E56B4E' },
  { id: 'multimedia', label: 'Multimédia', icon: 'eye', color: '#9B6FA8' },
  { id: 'chauffage_clim', label: 'Chauffage et climatisation', icon: 'sun', color: '#D9930F' },
  { id: 'securite', label: 'Sécurité', icon: 'lock', color: '#C6492F' },
  { id: 'jardin_piscine', label: 'Jardin et piscine', icon: 'pin', color: '#7A9B76' },
  { id: 'informatique', label: 'Informatique', icon: 'panelRight', color: '#4E93B8' },
  { id: 'mobilier', label: 'Mobilier', icon: 'home', color: '#8A7E74' },
  { id: 'autre', label: 'Autre', icon: 'folder', color: '#8A7E74' },
];
export const categoryOf = (c: string) => CATEGORIES.find((x) => x.id === c) ?? CATEGORIES[CATEGORIES.length - 1];

export type Status = 'en_service' | 'en_panne' | 'remplace' | 'donne_vendu' | 'jete';
export const STATUSES: { id: Status; label: string }[] = [
  { id: 'en_service', label: 'En service' },
  { id: 'en_panne', label: 'En panne' },
  { id: 'remplace', label: 'Remplacé' },
  { id: 'donne_vendu', label: 'Donné ou vendu' },
  { id: 'jete', label: 'Jeté' },
];
export const statusLabel = (s: string): string => STATUSES.find((x) => x.id === s)?.label ?? s;

export const CONDITIONS: { id: Condition; label: string }[] = [
  { id: 'neuf', label: 'Neuf' },
  { id: 'occasion_pro', label: 'Occasion, chez un professionnel' },
  { id: 'occasion_particulier', label: 'Occasion, entre particuliers' },
];

export type AttachmentKind = 'facture' | 'plaque' | 'notice' | 'photo' | 'autre';
export const ATTACHMENT_KINDS: { id: AttachmentKind; label: string }[] = [
  { id: 'plaque', label: 'Plaque signalétique' },
  { id: 'facture', label: 'Facture' },
  { id: 'notice', label: 'Notice' },
  { id: 'photo', label: 'Photo' },
  { id: 'autre', label: 'Autre' },
];
export const attachmentLabel = (k: string): string => ATTACHMENT_KINDS.find((x) => x.id === k)?.label ?? k;

export type EventKind = 'achat' | 'panne' | 'reparation' | 'sav' | 'remplacement' | 'note';
export const EVENT_KINDS: { id: EventKind; label: string }[] = [
  { id: 'panne', label: 'Panne' },
  { id: 'sav', label: 'Appel au SAV' },
  { id: 'reparation', label: 'Réparation' },
  { id: 'remplacement', label: 'Remplacement' },
  { id: 'achat', label: 'Achat' },
  { id: 'note', label: 'Note' },
];
export const eventLabel = (k: string): string => EVENT_KINDS.find((x) => x.id === k)?.label ?? k;

export const WARRANTY_FILTERS: { id: WarrantyState; label: string }[] = [
  { id: 'sous_garantie', label: 'Sous garantie' },
  { id: 'expire_bientot', label: 'Expire bientôt' },
  { id: 'hors_garantie', label: 'Hors garantie' },
  { id: 'inconnue', label: 'Garantie inconnue' },
];

/** Une fiche telle que l'API la rend. Pour un enfant, série, prix, vendeur et bien sont null. */
export interface EqpItem {
  id: number; roomId: string | null; assetId: number | null; name: string; category: Category;
  brand: string; model: string; serial: string | null; purchasedOn: string | null; purchasePrice: number | null;
  vendor: string | null; condition: Condition; warrantyMonths: number | null; warrantyUntil: string | null;
  warrantyNote: string; notes: string; status: Status; statusOn: string | null; replacedBy: number | null;
  createdBy: string | null; createdAt: string; updatedBy: string | null; updatedAt: string | null; archivedAt: string | null;
  roomName: string | null; warranty: Warranty; attachments: Partial<Record<AttachmentKind, number>>; replacedByName: string | null;
}
export interface EqpAttachment { id: number; itemId: number; kind: AttachmentKind; fileId: number; label: string; addedBy: string | null; addedAt: string; name: string; mime: string; size: number; }
export interface EqpEvent { id: number; itemId: number; at: string; kind: EventKind; text: string; cost: number | null; createdBy: string | null; createdAt: string; }
export interface EqpDetail extends EqpItem { attachmentList: EqpAttachment[]; events: EqpEvent[]; replaces: { id: number; name: string }[]; }
export interface EqpBootstrap { today: string; rules: WarrantyRules; canEdit: boolean; items: EqpItem[]; assets: { id: number; name: string }[]; }

/** Le corps d'une création ou d'une modification : noms de l'API, montants en euros. */
export interface EqpFields {
  name?: string; room_id?: string | null; asset_id?: number | null; category?: Category;
  brand?: string; model?: string; serial?: string; purchased_on?: string | null; purchase_price?: string | number | null;
  vendor?: string; condition?: Condition; warranty_months?: number | null; warranty_until?: string | null;
  warranty_note?: string; notes?: string; status?: Status; status_on?: string | null;
}

@Injectable({ providedIn: 'root' })
export class EquipementsApi {
  private api = inject(ApiService);

  bootstrap(): Promise<EqpBootstrap> { return this.api.request('equipements/bootstrap'); }
  items(archived = false): Promise<{ items: EqpItem[] }> { return this.api.request('equipements/items' + (archived ? '?archived=1' : '')); }
  detail(id: number): Promise<{ item: EqpDetail }> { return this.api.request('equipements/items/' + id); }
  create(f: EqpFields): Promise<{ item: EqpDetail }> { return this.api.post('equipements/items', f); }
  update(id: number, f: EqpFields): Promise<{ item: EqpDetail }> { return this.api.put('equipements/items/' + id, f); }
  archive(id: number, archived: boolean): Promise<{ item: EqpDetail }> { return this.api.post(`equipements/items/${id}/${archived ? 'archive' : 'unarchive'}`, {}); }
  replace(id: number, by: number): Promise<{ item: EqpDetail }> { return this.api.post(`equipements/items/${id}/replace`, { by }); }
  addEvent(id: number, body: { kind: EventKind; text?: string; cost?: string | null; at?: string }): Promise<{ item: EqpDetail }> {
    return this.api.post(`equipements/items/${id}/events`, body);
  }
  archiveEvent(id: number): Promise<{ item: EqpDetail }> { return this.api.post(`equipements/events/${id}/archive`, {}); }
  upload(itemId: number, kind: AttachmentKind, file: File): Promise<{ item: EqpDetail; deduplicated: boolean }> {
    return this.api.upload(`equipements/items/${itemId}/attachments?kind=${kind}&filename=${encodeURIComponent(file.name)}`, file);
  }
  removeAttachment(id: number): Promise<{ item: EqpDetail }> { return this.api.del(`equipements/attachments/${id}`); }
  /** L'export pour l'assurance (adultes) : la liste en CSV ou PDF, ou le zip avec les factures. */
  insurance(format: 'csv' | 'pdf' | 'zip'): Promise<Blob> { return this.api.download('equipements/export/assurance.' + format); }
  /** Adresse d'une pièce jointe : le cookie de session l'authentifie, une balise <img> ou un lien suffit. */
  attachmentUrl(id: number, download = false): string { return this.api.absolute(`equipements/attachments/${id}${download ? '?download=1' : ''}`); }
}
