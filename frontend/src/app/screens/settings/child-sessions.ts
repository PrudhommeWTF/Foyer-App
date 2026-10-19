import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { ApiService, SwitchEntry } from '../../core/api.service';
import { FoyerStore } from '../../core/foyer.store';
import { switchLine, switchState } from '../../core/switch-log';

/**
 * Sous la fiche d'un enfant, dans Paramètres → Membres : les dernières sessions
 * ouvertes pour lui par un parent (qui, quand, sur quel appareil), et celle
 * qui serait restée ouverte, avec de quoi la fermer à distance. Rien quand il
 * n'y en a jamais eu.
 */
@Component({
  selector: 'settings-child-sessions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entries().length) {
      <div class="cs">
        @for (e of entries(); track e.id) {
          <div class="cs-row" [class.open]="e.open">
            <div class="cs-b">
              <div class="cs-l">{{ line(e) }}</div>
              <div class="cs-s">{{ state(e) }}</div>
            </div>
            @if (e.open) {
              <button class="btn btn-soft cs-x" (click)="close(e)" [disabled]="busy()">Fermer</button>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .cs { display: flex; flex-direction: column; gap: 6px; margin: -2px 0 6px 58px; }
    .cs-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 12px; background: var(--soft2); }
    .cs-row.open { background: #E5F0F4; }
    :host-context(:root.dark) .cs-row.open { background: rgba(78,147,184,.18); }
    .cs-b { flex: 1; min-width: 0; }
    .cs-l { font-size: 12.5px; font-weight: 800; color: var(--ink); }
    .cs-s { font-size: 11.5px; font-weight: 700; color: var(--ink2); margin-top: 1px; }
    .cs-x { flex: none; padding: 7px 12px; font-size: 12.5px; }
    @media (max-width: 860px) { .cs { margin-left: 0; } }
  `],
})
export class ChildSessionsComponent implements OnInit {
  readonly memberId = input.required<string>();
  private readonly api = inject(ApiService);
  private readonly store = inject(FoyerStore);
  readonly entries = signal<SwitchEntry[]>([]);
  readonly busy = signal(false);

  ngOnInit(): void { void this.load(); }

  /** Les trois dernières : de quoi répondre à « qui l'a ouverte hier soir ? » sans dérouler un registre. */
  private async load(): Promise<void> {
    try { this.entries.set((await this.api.memberSwitches(this.memberId())).switches.slice(0, 3)); } catch { /* rien à montrer */ }
  }

  line(e: SwitchEntry): string { return switchLine(e); }
  state(e: SwitchEntry): string { return switchState(e, (id) => (id && this.store.memberName(id)) || 'un membre retiré'); }

  async close(e: SwitchEntry): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.closeSwitch(this.memberId(), e.id);
      this.store.toast('Session fermée : l’appareil revient à l’écran de connexion.');
    } catch (err) {
      this.store.toast((err as Error).message);
    } finally {
      this.busy.set(false);
      void this.load();
    }
  }
}
