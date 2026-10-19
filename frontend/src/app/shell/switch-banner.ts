import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';

/**
 * Le bandeau de la session d'un enfant ouverte par un parent (« Raphaël ·
 * session ouverte par Nolwenn »), et la saisie du retour : le mot de passe du
 * parent, puis son code s'il a posé un second facteur. Un échec laisse la
 * session de l'enfant telle quelle ; le serveur temporise comme à la connexion.
 */
@Component({
  selector: 'app-switch-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    @if (store.switched(); as sw) {
      <div class="band" role="status">
        <span class="band-t"><b>{{ store.me()?.name }}</b> · session ouverte par {{ sw.viaName }}</span>
        <button class="band-b" (click)="store.switchBackOpen.set(true)">Revenir à {{ sw.viaName }}</button>
      </div>

      @if (store.switchBackOpen()) {
        <f-modal [title]="'Revenir à ' + sw.viaName" [maxWidth]="400" (close)="fermer()">
          @if (!store.switchChallenge()) {
            <form (submit)="$event.preventDefault(); envoyer()">
              <label class="lbl" for="sb-pwd">Mot de passe de {{ sw.viaName }}</label>
              <input #champ id="sb-pwd" class="input" type="password" autocomplete="current-password" name="pwd"
                     [ngModel]="pwd()" (ngModelChange)="pwd.set($event)" [attr.aria-describedby]="store.switchError() ? 'sb-err' : null" />
              <p class="hint">La session de {{ store.me()?.name }} se referme, et cet appareil revient à celle de {{ sw.viaName }}.</p>
              @if (store.switchError()) { <p id="sb-err" class="err" role="alert">{{ store.switchError() }}</p> }
              <button class="btn btn-primary btn-block" type="submit" [disabled]="!pwd() || store.switchBusy()">Revenir</button>
            </form>
          } @else {
            <form (submit)="$event.preventDefault(); envoyerCode()">
              <label class="lbl" for="sb-code">Code de l’application d’authentification</label>
              <input #champ id="sb-code" class="input code" inputmode="numeric" autocomplete="one-time-code" name="code"
                     [ngModel]="code()" (ngModelChange)="code.set($event)" [attr.aria-describedby]="store.switchError() ? 'sb-err' : null" />
              <p class="hint">Le code à six chiffres du téléphone de {{ sw.viaName }}, ou l’un de ses codes de secours.</p>
              @if (store.switchError()) { <p id="sb-err" class="err" role="alert">{{ store.switchError() }}</p> }
              <button class="btn btn-primary btn-block" type="submit" [disabled]="!code() || store.switchBusy()">Valider</button>
              <button class="btn btn-ghost btn-block" type="button" (click)="retourMotDePasse()">Retour au mot de passe</button>
            </form>
          }
        </f-modal>
      }
    }
  `,
  styles: [`
    .band { display: flex; align-items: center; gap: 12px; padding: 7px 16px; background: #E5F0F4; color: #2F5F7E; font-size: 13px; font-weight: 700; flex: none; }
    :host-context(:root.dark) .band { background: rgba(78,147,184,.18); color: #A9CDE0; }
    .band-t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .band-b { flex: none; border: none; background: transparent; color: inherit; font-family: inherit; font-size: 13px; font-weight: 800; text-decoration: underline; cursor: pointer; padding: 6px 2px; min-height: 32px; }
    .lbl { display: block; font-size: 13px; font-weight: 800; color: var(--ink); margin-bottom: 8px; }
    .code { letter-spacing: .2em; font-size: 20px; text-align: center; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin: 10px 0 14px; }
    .err { font-size: 13px; font-weight: 700; color: var(--primary); margin: 0 0 12px; }
    .btn-ghost { margin-top: 8px; }
  `],
})
export class SwitchBannerComponent {
  readonly store = inject(FoyerStore);
  readonly pwd = signal('');
  readonly code = signal('');
  private readonly champ = viewChild<ElementRef<HTMLInputElement>>('champ');

  constructor() {
    // Le champ prend le focus à l'ouverture et au passage au code : au clavier
    // comme au lecteur d'écran, on tombe directement sur ce qu'il faut saisir.
    effect(() => { this.store.switchChallenge(); const el = this.champ()?.nativeElement; if (el) setTimeout(() => el.focus()); });
  }

  envoyer(): void { void this.store.switchBack(this.pwd()).then(() => this.pwd.set('')); }
  envoyerCode(): void { void this.store.switchBackTotp(this.code()).then(() => this.code.set('')); }
  retourMotDePasse(): void { this.store.switchChallenge.set(''); this.store.switchError.set(''); this.code.set(''); }
  fermer(): void { this.pwd.set(''); this.code.set(''); this.store.cancelSwitchBack(); }
}
