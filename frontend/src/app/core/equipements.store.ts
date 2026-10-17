import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AttachmentKind, EqpBootstrap, EqpDetail, EqpFields, EqpItem, EquipementsApi, EventKind, categoryOf } from './equipements.api';
import { FoyerStore, SearchHit } from './foyer.store';
import { eqpMatches, warrantyDayExtras } from './equipements';
import { isImageFile, resizePhoto } from './image-resize';
import { downloadBlob } from './download';

/**
 * État de l'écran Équipements. Le module vit dans ses tables : tout passe par
 * /api/equipements, sauf les pièces (socle Maison du document, FoyerStore).
 * L'état de la garantie est celui que le serveur calcule ; le formulaire le
 * prévisualise avec la même fonction (warranty.ts), sans rien stocker.
 *
 * Tout membre lit. Un enfant reçoit des fiches sans série ni montant : c'est le
 * serveur qui les retire, l'écran se contente de ne pas afficher de case vide.
 */
@Injectable({ providedIn: 'root' })
export class EquipementsStore {
  private api = inject(EquipementsApi);
  readonly foyer = inject(FoyerStore);

  readonly boot = signal<EqpBootstrap | null>(null);
  /** Les fiches archivées, chargées seulement quand on demande à les voir. */
  readonly archived = signal<EqpItem[] | null>(null);
  readonly showArchived = signal(false);
  /** Les fiches complètes (pièces jointes, historique), par identifiant, chargées à l'ouverture. */
  readonly details = signal<Record<number, EqpDetail>>({});
  readonly indispo = signal(false);
  readonly busy = signal(false);

  readonly items = computed(() => this.boot()?.items ?? []);
  readonly canEdit = computed(() => !!this.boot()?.canEdit && !this.foyer.isChild());
  readonly rules = computed(() => this.boot()?.rules ?? { defaultMonths: 24, alertDays: 60 });
  readonly assets = computed(() => this.boot()?.assets ?? []);

  constructor() {
    // Repère d'agenda : le dernier jour couvert de chaque garantie en cours.
    effect(() => this.foyer.setExternalDayExtras('equipements', warrantyDayExtras(this.items())));
    // Module actif et quelqu'un de connecté : on charge, pour la recherche
    // globale comme pour l'écran. Éteint ou déconnecté : on oublie tout.
    effect(() => {
      if (this.foyer.authed() && this.foyer.modEquipements()) { if (!this.boot() && !this.loading) void this.reload(); }
      else if (this.boot()) this.reset();
    });
  }

  private loading = false;
  async reload(): Promise<void> {
    this.loading = true;
    try {
      this.boot.set(await this.api.bootstrap());
      this.indispo.set(false);
      if (this.showArchived()) this.archived.set((await this.api.items(true)).items.filter((i) => i.archivedAt));
    } catch { this.indispo.set(true); }
    this.loading = false;
  }
  private reset(): void { this.boot.set(null); this.archived.set(null); this.details.set({}); this.showArchived.set(false); }

  async toggleArchived(): Promise<void> {
    const on = !this.showArchived();
    this.showArchived.set(on);
    if (on) { try { this.archived.set((await this.api.items(true)).items.filter((i) => i.archivedAt)); } catch { this.archived.set([]); } }
  }

  /** Une fiche, telle que la liste la connaît, archivées comprises, enrichie de son détail s'il est chargé. */
  find(id: number): EqpItem | EqpDetail | null {
    return this.details()[id] ?? this.items().find((i) => i.id === id) ?? this.archived()?.find((i) => i.id === id) ?? null;
  }
  async loadDetail(id: number): Promise<void> {
    try { this.keep((await this.api.detail(id)).item); } catch { /* fiche disparue : la fiche le dira */ }
  }
  /** Retient le détail renvoyé par une écriture, et rafraîchit la liste (garanties, décomptes). */
  private keep(d: EqpDetail): void {
    this.details.update((m) => ({ ...m, [d.id]: d }));
  }
  private async after(p: Promise<{ item: EqpDetail }>): Promise<EqpDetail> {
    this.busy.set(true);
    try { const { item } = await p; this.keep(item); await this.reload(); return item; }
    finally { this.busy.set(false); }
  }

  create(f: EqpFields): Promise<EqpDetail> { return this.after(this.api.create(f)); }
  update(id: number, f: EqpFields): Promise<EqpDetail> { return this.after(this.api.update(id, f)); }
  archive(id: number, archived: boolean): Promise<EqpDetail> { return this.after(this.api.archive(id, archived)); }
  replace(id: number, by: number): Promise<EqpDetail> { return this.after(this.api.replace(id, by)); }
  addEvent(id: number, body: { kind: EventKind; text?: string; cost?: string | null; at?: string }): Promise<EqpDetail> { return this.after(this.api.addEvent(id, body)); }
  archiveEvent(eventId: number): Promise<EqpDetail> { return this.after(this.api.archiveEvent(eventId)); }
  removeAttachment(id: number): Promise<EqpDetail> { return this.after(this.api.removeAttachment(id)); }

  /** Joint un fichier : une image est réduite à 2 000 px en JPEG avant de partir, un PDF part tel quel. */
  async attach(itemId: number, kind: AttachmentKind, file: File): Promise<EqpDetail> {
    const sent = isImageFile(file) ? await resizePhoto(file) : file;
    const r = await this.after(this.api.upload(itemId, kind, sent));
    return r;
  }
  attachmentUrl(id: number, download = false): string { return this.api.attachmentUrl(id, download); }

  /** Télécharge l'export pour l'assurance. */
  async exportInsurance(format: 'csv' | 'pdf' | 'zip'): Promise<void> {
    this.busy.set(true);
    try { downloadBlob(await this.api.insurance(format), `equipements-assurance-${this.foyer.todayStr()}.${format}`); }
    catch (e) { this.foyer.toast((e as Error).message || 'L’export a échoué.'); }
    finally { this.busy.set(false); }
  }

  /** Les fiches qui répondent à la recherche globale. */
  searchHits(q: string): SearchHit[] {
    if (q.trim().length < 2) return [];
    return this.items().filter((it) => eqpMatches(it, q)).slice(0, 12).map((it) => {
      const c = categoryOf(it.category);
      return {
        kind: 'equipment', icon: c.icon, color: c.color, title: it.name,
        sub: [[it.brand, it.model].filter(Boolean).join(' '), it.roomName, it.warranty.label].filter(Boolean).join(' · '),
        screen: 'equipements', id: String(it.id),
      };
    });
  }
}
