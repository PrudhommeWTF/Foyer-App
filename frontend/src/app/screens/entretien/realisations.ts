import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { EntretienApi, Extras, Proof } from '../../core/entretien.api';
import { ApiError } from '../../core/api.service';
import { IconComponent } from '../../core/icon';
import { TaskItem } from '../../core/models';
import { RealisationRow, realisationRows } from '../../core/entretien';
import { parisDay } from '../../core/task-ops';

/**
 * L'historique d'un geste d'entretien, dans sa fiche : chaque réalisation, sa
 * note (« conduit propre ») et ses justificatifs (l'attestation de la
 * chaudière, le certificat de ramonage). On les ajoute après coup, quand le
 * papier arrive. Un enfant lit et écrit les notes ; les justificatifs sont
 * réservés aux adultes (le serveur ne les lui sert pas).
 *
 * Une réalisation annulée qui portait une note ou un justificatif reste ici,
 * marquée « annulée » : on ne perd pas une attestation sur un « Annuler ».
 */
@Component({
  selector: 'app-realisations',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="field-label">Réalisations · {{ item().history?.length || 0 }}</div>
    @for (r of rows(); track r.at; let first = $first) {
      <div class="real" [class.cancelled]="r.cancelled">
        <div class="r-line">{{ line(r) }}</div>
        @if (r.extras?.note && editing() !== r.at) { <div class="r-note">{{ r.extras!.note }}</div> }
        @if (r.extras?.files?.length) {
          <div class="r-files">
            @for (f of r.extras!.files!; track f.id) {
              <span class="r-file">
                <a [href]="url(f)" target="_blank" rel="noopener"><f-icon name="documents" [size]="13" color="currentColor" [width]="2.2" /> {{ f.name }}</a>
                <button type="button" class="x" (click)="retirer(f)" [attr.aria-label]="'Retirer ' + f.name"><f-icon name="x" [size]="12" color="var(--ink3)" /></button>
              </span>
            }
          </div>
        }
        @if (editing() === r.at) {
          <textarea class="input" rows="3" maxlength="1000" [ngModel]="draft()" (ngModelChange)="draft.set($event)" placeholder="Ce qui a été fait, ce qu'a dit le technicien…" aria-label="Note de la réalisation"></textarea>
          <div class="r-act">
            <button type="button" class="btn btn-soft" (click)="editing.set(null)">Annuler</button>
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="enregistrer(r)">Enregistrer</button>
          </div>
        } @else {
          <div class="r-links">
            <button type="button" class="r-link" (click)="editer(r)">{{ r.extras?.note ? 'Modifier la note' : 'Ajouter une note' }}</button>
            @if (!store.isChild() && !r.cancelled) {
              <label class="r-link">Joindre un justificatif
                <input type="file" accept="image/*,application/pdf" hidden (change)="joindre($event, r)" /></label>
            }
          </div>
        }
      </div>
    }
    @if (busy()) { <div class="r-busy">Envoi en cours…</div> }
  `,
  styles: [`
    :host { display: block; }
    .field-label { margin-top: 16px; }
    .real { padding: 8px 0; }
    .real + .real { border-top: 1px solid var(--line); }
    .r-line { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .cancelled .r-line { color: var(--ink3); font-style: italic; }
    .r-note { margin: 5px 0 2px; padding: 8px 11px; border-radius: 10px; background: var(--soft); font-size: 13.5px; font-weight: 600; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
    .r-files { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .r-file { display: inline-flex; align-items: center; gap: 2px; border-radius: 9px; background: #EDF2EB; padding: 3px 4px 3px 9px; }
    .r-file a { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 800; color: var(--sage); text-decoration: none; max-width: 230px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .x { border: none; background: none; padding: 3px; cursor: pointer; display: grid; place-items: center; }
    .r-links { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 5px; }
    .r-link { border: none; background: none; padding: 0; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; }
    textarea { width: 100%; box-sizing: border-box; margin-top: 6px; resize: vertical; }
    .r-act { display: flex; gap: 8px; margin-top: 6px; }
    .r-act .btn { flex: 1; }
    .r-busy { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; }
  `],
})
export class RealisationsComponent {
  readonly store = inject(FoyerStore);
  private readonly api = inject(EntretienApi);
  readonly item = input.required<TaskItem>();
  /** Ouvre la note de la dernière réalisation (« Note ou justificatif » depuis l'écran Entretien). */
  readonly openNote = input(false);

  private readonly extras = signal<Extras[]>([]);
  readonly editing = signal<string | null>(null);
  readonly draft = signal('');
  readonly busy = signal(false);
  readonly rows = computed(() => realisationRows(this.item().history || [], this.extras()));

  constructor() {
    // Relu à l'ouverture et à chaque réalisation ajoutée ou annulée (sur ce téléphone ou un autre).
    let opened = false;
    effect(() => {
      const t = this.item(); void (t.history?.length);
      untracked(() => void this.charger(t.id).then(() => {
        if (opened || !this.openNote()) return;
        opened = true;
        const last = this.rows().find((r) => !r.cancelled);
        if (last) this.editer(last);
      }));
    });
  }

  private async charger(id: string): Promise<void> {
    try { this.extras.set(await this.api.realisations(id)); } catch { /* hors ligne : l'historique s'affiche sans ses notes */ }
  }

  line(r: RealisationRow<Extras>): string {
    const d = this.store.fmtNumDate(parisDay(r.at));
    if (r.cancelled) return `${d} · réalisation annulée`;
    const h = r.done;
    if (!h) return d;
    return [d + (h.by ? ' par ' + this.store.memberName(h.by) : ' par le foyer'),
      h.used ? `${h.used} pris dans le stock` : '', h.due ? 'prévue le ' + this.store.fmtNumDate(h.due) : ''].filter(Boolean).join(' · ');
  }
  url(f: Proof): string { return this.api.justificatifUrl(f.id); }
  editer(r: RealisationRow<Extras>): void { this.draft.set(r.extras?.note || ''); this.editing.set(r.at); }

  /**
   * Une réalisation notée à l'instant sur ce téléphone n'est peut-être pas
   * encore arrivée au serveur : la file des tâches part d'abord, et une
   * réalisation encore inconnue est retentée brièvement.
   */
  private async envoyer(fn: () => Promise<Extras[]>, ok: string): Promise<boolean> {
    this.busy.set(true);
    try {
      for (let i = 0; ; i++) {
        await this.store.flushTaskQueue();
        try { this.extras.set(await fn()); this.store.toast(ok); return true; }
        catch (e) {
          if (!(e instanceof ApiError) || e.status !== 404 || i >= 3) throw e;
          await new Promise((res) => setTimeout(res, 700));
        }
      }
    } catch (e) { this.store.toast((e as Error).message || 'L’envoi a échoué.'); return false; }
    finally { this.busy.set(false); }
  }

  async enregistrer(r: RealisationRow<Extras>): Promise<void> {
    const note = this.draft().trim();
    if (await this.envoyer(() => this.api.setNote(this.item().id, r.at, note), note ? 'Note enregistrée' : 'Note retirée')) this.editing.set(null);
  }
  async joindre(ev: Event, r: RealisationRow<Extras>): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (file) await this.envoyer(() => this.api.joindre(this.item().id, r.at, file), 'Justificatif joint');
  }
  async retirer(f: Proof): Promise<void> {
    if (!confirm(`Retirer « ${f.name} » ? Le fichier est effacé.`)) return;
    await this.envoyer(() => this.api.retirer(f.id), 'Justificatif retiré');
  }
}
