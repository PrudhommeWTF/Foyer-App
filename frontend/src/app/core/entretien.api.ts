import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { ApiError, ApiService } from './api.service';
import { Catalogue } from './entretien';
import { FoyerStore } from './foyer.store';
import { isImageFile, resizePhoto } from './image-resize';
import { downloadBlob } from './download';

/** Le coût d'un geste, tel que le sert GET /api/entretien/couts (centimes). */
export interface GesteCost { taskId: string; amount: number | null; contractId: number | null; perYear: number | null; forecast: number | null; real12: number; }
export interface CostContract { id: number; name: string; provider: string; status: string; real12: number; }
export interface CostSummary { gestes: GesteCost[]; contracts: CostContract[]; totals: { real12: number; forecast: number }; }
/** Un justificatif d'une réalisation (attestation, certificat), servi aux seuls adultes. */
export interface Proof { id: number; name: string; mime: string; size: number; createdAt: string; }
/** Ce qu'une réalisation porte en plus : sa note, et pour un adulte ses justificatifs. Voir backend entretien/realisations.ts. */
export interface Extras { doneAt: string; day: string; note: string; noteBy: string | null; files?: Proof[]; }
export type CarnetPeriod = '12' | '24' | 'tout';

/**
 * Le catalogue des gestes d'entretien, lu une fois par session. Il ne change
 * qu'avec une mise à jour ou la surcharge de l'administrateur : le relire à
 * chaque ouverture de « Nouveau geste » ne servirait à rien.
 *
 * Et leurs coûts, pour les adultes seulement (le serveur refuse un enfant) :
 * hors du document, relus à la demande.
 *
 * Et la note et les justificatifs des réalisations, lus geste par geste quand
 * on ouvre sa fiche ; le carnet d'entretien, téléchargé à la demande.
 */
@Injectable({ providedIn: 'root' })
export class EntretienApi {
  private api = inject(ApiService);
  readonly catalogue = signal<Catalogue | null>(null);
  readonly erreur = signal('');
  readonly couts = signal<CostSummary | null>(null);
  private readonly foyer = inject(FoyerStore);
  private relire: ReturnType<typeof setTimeout> | null = null;
  /** Ce qui change un montant réel : un geste fait, rouvert, ajouté ou supprimé. */
  private readonly empreinte = computed(() => this.foyer.gestes().map((t) => t.id + ':' + (t.history?.length || 0)).join(','));

  constructor() {
    // Une fois les coûts lus, ils suivent les coches (de ce téléphone ou d'un autre), le temps que le serveur les ait notées.
    effect(() => {
      this.empreinte();
      if (!this.couts() || this.foyer.isChild()) return;
      if (this.relire) clearTimeout(this.relire);
      this.relire = setTimeout(() => void this.chargerCouts(), 1500);
    });
  }

  async charger(): Promise<void> {
    if (this.catalogue()) return;
    this.erreur.set('');
    try { this.catalogue.set(await this.api.request<Catalogue>('entretien/catalogue')); }
    catch { this.erreur.set('Le catalogue des gestes n’a pas pu être chargé. Vous pouvez créer un geste libre.'); }
  }

  private enCours = false;
  async chargerCouts(): Promise<void> {
    if (this.enCours) return;
    this.enCours = true;
    try { this.couts.set(await this.api.request<CostSummary>('entretien/couts')); }
    catch { /* hors ligne ou module éteint : les montants restent ceux déjà lus */ }
    finally { this.enCours = false; }
  }
  /** Lit les coûts s'ils ne l'ont pas encore été (une fiche ouverte directement). */
  assurer(): void { if (!this.couts() && !this.foyer.isChild()) void this.chargerCouts(); }
  cout(taskId: string): GesteCost | undefined { return this.couts()?.gestes.find((g) => g.taskId === taskId); }

  /**
   * Enregistre le coût d'un geste. `envoyer` pousse d'abord la file des
   * opérations de tâches : un geste créé à l'instant doit exister côté serveur
   * avant son coût (404 sinon, retenté brièvement).
   */
  async setCout(taskId: string, amount: number | null, contractId: number | null, envoyer: () => Promise<void>): Promise<boolean> {
    for (let i = 0; i < 4; i++) {
      await envoyer();
      try { this.couts.set(await this.api.put<CostSummary>(`entretien/couts/gestes/${encodeURIComponent(taskId)}`, { amount, contractId })); return true; }
      catch (e) {
        if (!(e instanceof ApiError) || e.status !== 404) return false;
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    return false;
  }

  private base(taskId: string, at: string): string { return `entretien/gestes/${encodeURIComponent(taskId)}/realisations/${encodeURIComponent(at)}`; }
  async realisations(taskId: string): Promise<Extras[]> {
    return (await this.api.request<{ realisations: Extras[] }>(`entretien/gestes/${encodeURIComponent(taskId)}/realisations`)).realisations;
  }
  async setNote(taskId: string, at: string, note: string): Promise<Extras[]> {
    return (await this.api.put<{ realisations: Extras[] }>(this.base(taskId, at) + '/note', { note })).realisations;
  }
  /** Joint un justificatif : une photo est réduite à 2 000 px en JPEG avant de partir, un PDF part tel quel. */
  async joindre(taskId: string, at: string, file: File): Promise<Extras[]> {
    const sent = isImageFile(file) ? await resizePhoto(file) : file;
    return (await this.api.upload<{ realisations: Extras[] }>(`${this.base(taskId, at)}/justificatifs?filename=${encodeURIComponent(sent.name)}`, sent)).realisations;
  }
  async retirer(fileId: number): Promise<Extras[]> {
    return (await this.api.del<{ realisations: Extras[] }>(`entretien/justificatifs/${fileId}`)).realisations;
  }
  justificatifUrl(fileId: number): string { return this.api.absolute(`entretien/justificatifs/${fileId}`); }
  /** Télécharge le carnet d'entretien (adultes). */
  async carnet(format: 'pdf' | 'zip', period: CarnetPeriod): Promise<void> {
    downloadBlob(await this.api.download(`entretien/carnet.${format}?periode=${period}`), `carnet-entretien-${this.foyer.todayStr()}.${format}`);
  }
}
