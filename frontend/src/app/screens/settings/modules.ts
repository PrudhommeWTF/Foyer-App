import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { MODULES, ModuleDef } from '../../core/modules';
import { ModulesApi, ModuleCounts } from '../../core/modules.api';
import { ModalComponent } from '../../shared/modal';

/**
 * Panneau d'administration des modules : activer ou désactiver « Repas et
 * cuisine », « Cartes de fidélité », « Finances » et « Employé à domicile ».
 * Désactiver masque le module partout et ferme ses accès, sans supprimer ses
 * données. Réactiver propose de reprendre les données ou de repartir à zéro
 * (effacement définitif, confirmé par saisie). Réservé aux administrateurs.
 */
@Component({
  selector: 'settings-modules',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ModalComponent],
  template: `
    @if (!store.isAdmin()) {
      <div class="hint">L’activation des modules est un réglage du foyer, réservé à un administrateur.</div>
    }
    <div class="mods">
      @for (m of modules; track m.flag) {
        <div class="mod">
          <div class="txt">
            <div class="ml">{{ m.label }}</div>
            <div class="md">{{ m.desc }}</div>
            @if (!store.moduleOn(m.flag)) { <div class="off">Désactivé{{ resume(m.id) ? ' · ' + resume(m.id) + ' en réserve' : '' }}</div> }
          </div>
          <button class="sw" [class.on]="store.moduleOn(m.flag)" [disabled]="!store.isAdmin() || busy()"
                  role="switch" [attr.aria-checked]="store.moduleOn(m.flag)" [attr.aria-label]="m.label"
                  (click)="basculer(m)"><span class="dot"></span></button>
        </div>
      }
    </div>

    @if (reactive(); as m) {
      <f-modal [title]="'Réactiver « ' + m.label + ' »'" [maxWidth]="440" (close)="fermer()">
        <div class="form">
          @if (resume(m.id)) {
            <p class="q">Des données de ce module sont en réserve : <b>{{ resume(m.id) }}</b>. Les reprendre, ou repartir à zéro ?</p>
            <div class="choix">
              <button class="opt" [class.sel]="mode() === 'reprendre'" (click)="mode.set('reprendre')">
                <div class="ot">Reprendre les données</div>
                <div class="os">Le module retrouve tout ce qu’il contenait.</div>
              </button>
              <button class="opt danger" [class.sel]="mode() === 'zero'" (click)="mode.set('zero')">
                <div class="ot">Repartir à zéro</div>
                <div class="os">Efface définitivement ce que le module contenait.</div>
              </button>
            </div>
            @if (mode() === 'zero') {
              <label class="lab">Pour confirmer l’effacement, tapez <b>SUPPRIMER</b>
                <input class="input" [(ngModel)]="confirmTxt" placeholder="SUPPRIMER" autocomplete="off" />
              </label>
            }
          } @else {
            <p class="q">Ce module ne contient aucune donnée. Il sera simplement réactivé.</p>
          }
          @if (erreur()) { <div class="ko">{{ erreur() }}</div> }
          <div class="f-act">
            <button class="btn soft" (click)="fermer()">Annuler</button>
            <button class="btn primary" [disabled]="!peutValider() || busy()" (click)="valider()">
              {{ resume(m.id) && mode() === 'zero' ? 'Effacer et réactiver' : 'Réactiver' }}
            </button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    :host { display: block; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); margin-bottom: 12px; line-height: 1.5; }
    .mods { display: flex; flex-direction: column; gap: 10px; }
    .mod { display: flex; align-items: center; gap: 14px; }
    .txt { flex: 1; min-width: 0; }
    .ml { font-size: 14px; font-weight: 800; color: var(--ink); }
    .md { font-size: 12.5px; font-weight: 600; color: var(--ink3); margin-top: 2px; line-height: 1.45; }
    .off { font-size: 12px; font-weight: 800; color: #9A6A12; margin-top: 4px; }
    .sw { flex: none; width: 48px; height: 28px; border-radius: 16px; border: none; background: var(--soft2); cursor: pointer; position: relative; transition: background .15s; }
    .sw.on { background: var(--primary); }
    .sw:disabled { opacity: .5; cursor: default; }
    .sw .dot { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 2px 5px rgba(0,0,0,.2); }
    .sw.on .dot { transform: translateX(20px); }
    .form { display: flex; flex-direction: column; }
    .q { font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin: 0 0 14px; }
    .choix { display: flex; flex-direction: column; gap: 10px; }
    .opt { text-align: left; border: 2px solid var(--line2); background: var(--surface); border-radius: 12px; padding: 12px 14px; cursor: pointer; }
    .opt.sel { border-color: var(--primary); }
    .opt.danger.sel { border-color: #C6492F; }
    .ot { font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .os { font-size: 12px; font-weight: 600; color: var(--ink3); margin-top: 2px; }
    .lab { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 800; color: var(--ink2); margin-top: 14px; }
    .ko { margin-top: 10px; font-size: 12px; font-weight: 800; color: #C6492F; }
    .f-act { display: flex; gap: 8px; margin-top: 20px; }
    .f-act .btn { flex: 1; justify-content: center; border: none; border-radius: 11px; padding: 11px; font-weight: 800; font-size: 13.5px; cursor: pointer; }
    .btn.soft { background: var(--soft2); color: var(--ink2); }
    .btn.primary { background: var(--primary); color: #fff; }
    .btn:disabled { opacity: .5; cursor: default; }
  `],
})
export class SettingsModulesComponent {
  store = inject(FoyerStore);
  private api = inject(ModulesApi);

  modules = MODULES;
  readonly counts = signal<ModuleCounts | null>(null);
  readonly busy = signal(false);
  readonly erreur = signal('');
  readonly reactive = signal<ModuleDef | null>(null);
  readonly mode = signal<'reprendre' | 'zero'>('reprendre');
  confirmTxt = '';

  readonly peutValider = computed(() => {
    const m = this.reactive(); if (!m) return false;
    if (!this.resume(m.id)) return true; // rien à reprendre : simple réactivation
    return this.mode() === 'reprendre' || this.confirmTxt.trim() === 'SUPPRIMER';
  });

  constructor() { void this.charger(); }
  private async charger(): Promise<void> {
    try { this.counts.set((await this.api.counts()).counts); } catch { /* module lecture seule sans données */ }
  }

  /** Un résumé de ce qu'un module garde en réserve, ou '' s'il est vide. */
  resume(id: string): string {
    const c = this.counts(); if (!c) return '';
    if (id === 'repas') { const n = c.repas.recipes, m = c.repas.meals; return n || m ? `${n} recette${n > 1 ? 's' : ''}, ${m} repas` : ''; }
    if (id === 'fidelite') { const n = c.fidelite.cards; return n ? `${n} carte${n > 1 ? 's' : ''}` : ''; }
    if (id === 'finances') { const n = c.finances.transactions; return n ? `${n} opération${n > 1 ? 's' : ''}` : ''; }
    if (id === 'employe') { const n = c.employe.employes, p = c.employe.presences; return n || p ? `${n} employé${n > 1 ? 's' : ''}, ${p} présence${p > 1 ? 's' : ''}` : ''; }
    return '';
  }

  async basculer(m: ModuleDef): Promise<void> {
    if (!this.store.isAdmin() || this.busy()) return;
    if (this.store.moduleOn(m.flag)) {
      // Désactivation : immédiate, sans rien effacer.
      this.busy.set(true);
      try { await this.store.setSetting(m.flag, false); } finally { this.busy.set(false); }
    } else {
      // Réactivation : on demande d'abord (reprendre / repartir à zéro).
      this.mode.set('reprendre'); this.confirmTxt = ''; this.erreur.set(''); this.reactive.set(m);
    }
  }

  fermer(): void { this.reactive.set(null); }

  async valider(): Promise<void> {
    const m = this.reactive(); if (!m || !this.peutValider() || this.busy()) return;
    this.busy.set(true); this.erreur.set('');
    try {
      if (this.resume(m.id) && this.mode() === 'zero') {
        await this.api.reset(m.id);
        await this.charger();
      }
      await this.store.setSetting(m.flag, true);
      this.reactive.set(null);
    } catch (e) { this.erreur.set((e as Error).message || 'L’opération a échoué.'); }
    this.busy.set(false);
  }
}
