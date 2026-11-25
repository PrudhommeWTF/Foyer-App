import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { downloadBlob } from '../../core/download';
import { Conseil, Kid, shiftWeek } from '../../core/epopee/epopee';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { ModalComponent } from '../../shared/modal';

/**
 * Le conseil de famille : le bilan de la semaine de chaque enfant enrôlé, les
 * trois temps du conseil, et ce que la famille décide. Le bilan compte ce qui a
 * été fait, jamais ce qui a manqué ; le serveur écrit ses phrases, l'écran les
 * montre.
 */
@Component({
  selector: 'epopee-council',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent, ModalComponent],
  template: `
    <f-modal title="Le conseil de famille" [maxWidth]="680" [tall]="true" (close)="closed.emit()">
      @if (erreur(); as e) { <p class="err" role="alert">{{ e }}</p> }
      @if (conseil(); as c) {
        <div class="week">
          <button class="icon-btn sm" [disabled]="busy()" (click)="aller(-1)" aria-label="Semaine précédente"><f-icon name="chevronLeft" [size]="18" /></button>
          <div class="label">{{ c.label }}</div>
          <button class="icon-btn sm" [disabled]="busy() || c.current" (click)="aller(1)" aria-label="Semaine suivante"><f-icon name="chevronRight" [size]="18" /></button>
        </div>

        @for (e of c.enfants; track e.memberId) {
          @if (kid(e.memberId); as k) {
            <section class="kid">
              <header><f-avatar [ini]="k.ini" [color]="k.color" [size]="34" /><h3>{{ k.name }}</h3>@if (e.earned) { <span class="won">+{{ e.earned }} écu{{ e.earned > 1 ? 's' : '' }}</span> }</header>
              <ul>@for (l of e.lines; track l) { <li>{{ l }}</li> }</ul>
              @for (w of e.words; track $index) { <p class="word">« {{ w }} »</p> }
            </section>
          }
        } @empty { <p class="soft">Aucun enfant n’est enrôlé dans l’Épopée.</p> }

        <section class="rite">
          <div class="field-label">Les trois temps du conseil</div>
          <ol>@for (r of c.rituel; track r.title) { <li><b>{{ r.title }}.</b> {{ r.text }}</li> }</ol>
        </section>

        <label class="notes">
          <span class="field-label">Ce qu’on a décidé</span>
          <textarea class="input" maxlength="2000" placeholder="Une étape à simplifier, un horaire à déplacer, un trésor à prévoir" [value]="notes()" (input)="notes.set($any($event.target).value)"></textarea>
        </label>
        @if (c.notesBy && notes() === c.notes && c.notes) { <p class="soft small">Noté par {{ c.notesBy }}.</p> }
        <div class="foot">
          <button class="btn btn-soft" [disabled]="busy()" (click)="pdf(c)"><f-icon name="download" [size]="16" [width]="2.2" /> Le bilan en PDF</button>
          <button class="btn btn-primary" [disabled]="busy() || notes() === c.notes" (click)="enregistrer(c)">Enregistrer les notes</button>
        </div>
      }
    </f-modal>
  `,
  styles: [`
    .week { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .label { flex: 1; text-align: center; font-family: var(--font-display); font-size: 15.5px; font-weight: 800; color: var(--ink); }
    .icon-btn:disabled { opacity: .35; cursor: default; }
    .kid { padding: 16px; border-radius: 18px; background: var(--soft2); margin-bottom: 10px; }
    .kid header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    h3 { flex: 1; margin: 0; font-family: var(--font-display); font-size: 18px; font-weight: 800; color: var(--ink); }
    .won { padding: 4px 11px; border-radius: 99px; background: #FDF0DA; color: #7D5400; font-size: 13px; font-weight: 800; }
    ul, ol { margin: 0; padding-left: 20px; display: grid; gap: 6px; font-size: 14.5px; font-weight: 600; color: var(--ink); line-height: 1.5; }
    .word { margin: 10px 0 0; font-family: var(--font-script); font-size: 21px; line-height: 1.3; color: var(--ink); }
    .rite { margin: 18px 0; }
    .rite .field-label, .notes .field-label { margin-bottom: 8px; }
    .soft { margin: 0; font-size: 14.5px; font-weight: 600; color: var(--ink2); }
    .small { font-size: 12.5px; color: var(--ink3); margin-top: 6px; }
    .err { margin: 0 0 12px; font-size: 14px; font-weight: 700; color: var(--primary); }
    .foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 16px; }
    .foot .btn { min-height: 48px; }
  `],
})
export class Council {
  private readonly api = inject(ApiService);
  private readonly store = inject(FoyerStore);

  /** The children of the screen, for their names and colours. */
  readonly kids = input.required<Kid[]>();
  readonly closed = output<void>();

  readonly conseil = signal<Conseil | null>(null);
  readonly notes = signal('');
  readonly erreur = signal('');
  readonly busy = signal(false);

  constructor() { void this.charger(); }

  kid(id: string): Kid | undefined { return this.kids().find((k) => k.memberId === id); }

  private async charger(week?: string): Promise<void> {
    this.busy.set(true); this.erreur.set('');
    try {
      const c = await this.api.request<Conseil>('epopee/conseil' + (week ? `?semaine=${week}` : ''));
      this.conseil.set(c); this.notes.set(c.notes);
    } catch (e) { this.erreur.set((e as Error).message); } finally { this.busy.set(false); }
  }
  aller(dir: -1 | 1): void { const c = this.conseil(); if (c) void this.charger(shiftWeek(c.from, dir)); }

  async enregistrer(c: Conseil): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.api.put<{ notes: string; notesBy: string }>('epopee/conseil', { semaine: c.from, notes: this.notes() });
      this.conseil.set({ ...c, notes: r.notes, notesBy: r.notesBy }); this.notes.set(r.notes);
      this.store.toast('Notes du conseil enregistrées.');
    } catch (e) { this.store.toast((e as Error).message); } finally { this.busy.set(false); }
  }
  async pdf(c: Conseil): Promise<void> {
    this.busy.set(true);
    try { downloadBlob(await this.api.download(`epopee/conseil.pdf?semaine=${c.from}`), `epopee-bilan-${c.from}.pdf`); }
    catch (e) { this.store.toast((e as Error).message); } finally { this.busy.set(false); }
  }
}
