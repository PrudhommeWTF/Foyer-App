import { ChangeDetectionStrategy, Component, WritableSignal, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, ApiTokenView } from '../../core/api.service';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { PALETTE } from '../../core/constants';
import { contactIni } from '../../core/helpers';

/**
 * La section « Compte » des Paramètres : profil (prénom, rôle, initiales,
 * couleur), identifiants de connexion, et second facteur. Sortie de l'écran
 * Paramètres parce qu'elle porte des gestes, non des réglages, et surtout la
 * manipulation la plus sensible de l'application (mot de passe, TOTP) : la tenir
 * à part la garde lisible et vérifiable seule. Les mots de passe ne passent
 * jamais par l'état d'interface partagé, ils vivent dans ce composant le temps
 * de la saisie et disparaissent avec lui.
 */
@Component({
  selector: 'settings-account',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AvatarComponent, IconComponent],
  template: `
    @if (store.currentMemberId()) {
      <div class="moi">
        <f-avatar [ini]="apercuIni()" [color]="store.ui().pfColor" [size]="60" />
        <div class="moi-b">
          <div class="moi-n">{{ store.ui().pfName || 'Sans prénom' }}</div>
          <div class="moi-m">{{ store.ui().pfRole || 'Sans rôle' }}{{ store.isAdmin() ? ' · admin du foyer' : '' }}</div>
        </div>
      </div>

      <label class="field-label" for="pf-nom">Prénom</label>
      <input id="pf-nom" class="input" autocomplete="given-name"
        [ngModel]="store.ui().pfName" (ngModelChange)="store.patch({ pfName: $event })" />
      <label class="field-label" for="pf-role">Rôle</label>
      <input id="pf-role" class="input" placeholder="Maman, Papa, Ado…"
        [ngModel]="store.ui().pfRole" (ngModelChange)="store.patch({ pfRole: $event })" />
      <label class="field-label" for="pf-ini">Initiales affichées</label>
      <input id="pf-ini" class="input court" maxlength="3" [placeholder]="iniAuto()"
        [ngModel]="store.ui().pfIni" (ngModelChange)="store.patch({ pfIni: $event })" />
      <div class="hint">Ce qui s’écrit dans votre pastille de couleur, partout dans l’application. Laissez vide pour qu’elles suivent le prénom ({{ iniAuto() }}).</div>
      <label class="field-label">Couleur d’identité</label>
      <div class="swatch-row">
        @for (c of palette; track c) {
          <button class="swatch" [style.background]="c" [attr.aria-label]="'Couleur ' + c"
            [style.box-shadow]="store.ui().pfColor === c ? ('0 0 0 3px var(--surface),0 0 0 6px ' + c) : 'none'"
            (click)="store.patch({ pfColor: c })"></button>
        }
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:16px" (click)="store.saveProfile()">Enregistrer mon profil</button>
    } @else {
      <div class="hint">Votre compte n’est rattaché à aucun membre du foyer : il n’y a ni prénom ni couleur à régler ici. Un administrateur peut faire le lien depuis « Membres et accès ».</div>
    }

    <div class="extra-t">Connexion</div>
    <label class="field-label" for="cr-mail">Adresse de connexion</label>
    <input id="cr-mail" class="input" type="email" autocomplete="username" inputmode="email"
      [ngModel]="store.ui().pfEmail" (ngModelChange)="store.patch({ pfEmail: $event })" />
    <label class="field-label" for="cr-actuel">Mot de passe actuel</label>
    <input id="cr-actuel" class="input" type="password" autocomplete="current-password"
      [ngModel]="mdpActuel()" (ngModelChange)="mdpActuel.set($event)" />
    <div class="hint">Exigé pour toute modification : sans lui, un téléphone déverrouillé laissé sur la table suffirait à s’approprier le compte.</div>
    <label class="field-label" for="cr-neuf">Nouveau mot de passe</label>
    <input id="cr-neuf" class="input" type="password" autocomplete="new-password"
      [ngModel]="mdpNeuf()" (ngModelChange)="mdpNeuf.set($event)" />
    <label class="field-label" for="cr-confirme">Confirmation</label>
    <input id="cr-confirme" class="input" type="password" autocomplete="new-password"
      [ngModel]="mdpConfirme()" (ngModelChange)="mdpConfirme.set($event)" />
    <div class="hint">Au moins {{ store.setting('passwordMinLength') }} caractères. Laissez ces deux champs vides pour ne changer que l’adresse. Changer le mot de passe <b>déconnecte vos autres appareils</b> ; celui-ci reste connecté.</div>
    <button class="btn btn-primary btn-block" style="margin-top:16px" [disabled]="credBusy()" (click)="enregistrerIdentifiants()">
      {{ credBusy() ? 'Enregistrement…' : 'Mettre à jour mes identifiants' }}
    </button>

    <div class="extra-t">Second facteur</div>
    @if (store.totpOn()) {
      <div class="totp-on">
        <f-icon name="check" [size]="16" color="#5F7E5C" [width]="3" />
        <span>Actif. Votre mot de passe seul ne suffit plus à ouvrir ce compte.</span>
      </div>
      @if (secoursRestants() !== null) {
        <div class="hint" [class.alerte]="secoursRestants()! <= 3">
          {{ secoursRestants() }} code(s) de secours restant(s).
          @if (secoursRestants()! <= 3) { Refaites-en une série pendant que vous le pouvez encore. }
        </div>
      }
      @if (totpCodes().length) {
        <div class="secours">
          <div class="secours-t">Vos nouveaux codes de secours. Notez-les maintenant : ils ne seront plus affichés.</div>
          <div class="secours-l">@for (c of totpCodes(); track c) { <code>{{ c }}</code> }</div>
          <button class="btn btn-soft btn-block" style="margin-top:10px" (click)="copierSecours()">
            {{ secoursCopies() ? 'Copiés !' : 'Copier les codes' }}
          </button>
        </div>
      }
      <label class="field-label" for="tp-mdp">Mot de passe</label>
      <input id="tp-mdp" class="input" type="password" autocomplete="current-password"
        [ngModel]="totpMdp()" (ngModelChange)="totpMdp.set($event)" />
      <label class="field-label" for="tp-code">Code à 6 chiffres</label>
      <input id="tp-code" class="input" inputmode="numeric" autocomplete="one-time-code"
        [ngModel]="totpCode()" (ngModelChange)="totpCode.set($event)" placeholder="000000" />
      <div class="hint">Les deux sont exigés : le mot de passe seul suffirait à qui l’a volé, ce qui reviendrait à ne pas avoir de second facteur.</div>
      <button class="btn btn-soft btn-block" style="margin-top:14px" [disabled]="totpBusy()" (click)="refaireSecours()">
        Refaire mes codes de secours
      </button>
      <button class="btn btn-ghost btn-block" style="margin-top:10px" [disabled]="totpBusy()" (click)="retirerTotp()">
        Retirer le second facteur
      </button>
    } @else if (totpUri()) {
      <div class="hint">
        Ajoutez ce compte dans votre application d’authentification (Aegis, Google Authenticator,
        1Password, Bitwarden…), puis saisissez le code qu’elle affiche pour confirmer.
      </div>
      <div class="secret-b">
        <div class="secret-t">Clé à saisir dans l’application</div>
        <code class="secret">{{ totpSecretLisible() }}</code>
        <button class="btn btn-soft btn-block" style="margin-top:10px" (click)="copierSecret()">
          {{ secretCopie() ? 'Copiée !' : 'Copier la clé' }}
        </button>
      </div>
      <label class="field-label" for="tp-verif">Code affiché par l’application</label>
      <input id="tp-verif" class="input" inputmode="numeric" autocomplete="one-time-code"
        [ngModel]="totpCode()" (ngModelChange)="totpCode.set($event)" placeholder="000000" />
      <button class="btn btn-primary btn-block" style="margin-top:14px" [disabled]="totpBusy()" (click)="confirmerTotp()">
        {{ totpBusy() ? 'Vérification…' : 'Activer le second facteur' }}
      </button>
      <button class="btn btn-ghost btn-block" style="margin-top:10px" (click)="annulerTotp()">Annuler</button>
    } @else {
      <div class="hint">
        Un code à six chiffres, en plus du mot de passe. C’est la seule protection qui couvre le cas
        d’un mot de passe réutilisé ailleurs et découvert : ni la temporisation ni les journaux ne
        voient passer une connexion réussie du premier coup.
      </div>
      <label class="field-label" for="tp-start">Mot de passe</label>
      <input id="tp-start" class="input" type="password" autocomplete="current-password"
        [ngModel]="totpMdp()" (ngModelChange)="totpMdp.set($event)" />
      <button class="btn btn-primary btn-block" style="margin-top:14px" [disabled]="totpBusy()" (click)="commencerTotp()">
        {{ totpBusy() ? 'Préparation…' : 'Activer le second facteur' }}
      </button>
    }

    @if (store.currentMemberId()) {
      <div class="extra-t">Accès pour les assistants et scripts</div>
      <div class="hint">
        Un accès laisse un assistant (Claude, un script…) lire ou agir dans le foyer en votre nom, avec vos droits.
        Le secret n’est montré qu’une seule fois, à la création. Changer votre mot de passe ne révoque pas ces accès :
        révoquez-les ici quand vous ne vous en servez plus. Les finances et les réglages restent toujours hors de leur portée.
      </div>

      @if (newSecret()) {
        <div class="secret-b neuf">
          <div class="secret-t">Votre nouvel accès. Copiez-le maintenant : il ne sera plus affiché.</div>
          <code class="secret">{{ newSecret() }}</code>
          <button class="btn btn-soft btn-block" style="margin-top:10px" (click)="copierJeton()">
            {{ secretTokCopie() ? 'Copié !' : 'Copier le jeton' }}
          </button>
        </div>
      }

      @if (tokens().length) {
        <div class="tok-list">
          @for (t of tokens(); track t.id) {
            <div class="tok" [class.rev]="t.revoked_at">
              <div class="tok-b">
                <div class="tok-n">{{ t.name }} <span class="tok-badge">{{ t.scope === 'write' ? 'Lecture et écriture' : 'Lecture seule' }}</span></div>
                <div class="tok-m">
                  <code>{{ t.prefix }}…</code> · créé le {{ dateCourte(t.created_at) }}
                  @if (t.revoked_at) { · <span class="tok-rev">révoqué</span> }
                  @else if (t.last_used_at) { · vu le {{ dateCourte(t.last_used_at) }}{{ t.last_used_ua ? ' (' + agent(t.last_used_ua) + ')' : '' }} }
                  @else { · jamais utilisé }
                </div>
              </div>
              @if (!t.revoked_at) {
                <button class="btn btn-ghost tok-x" (click)="revoquer(t)">Révoquer</button>
              }
            </div>
          }
        </div>
      }

      <label class="field-label" for="tok-nom">Nom de l’accès</label>
      <input id="tok-nom" class="input" placeholder="Claude sur mon iPhone" maxlength="60"
        [ngModel]="tokName()" (ngModelChange)="tokName.set($event)" />
      <label class="field-label">Ce que cet accès pourra faire</label>
      <div class="seg" role="radiogroup" aria-label="Portée de l’accès">
        <button [class.active]="tokScope() === 'read'" (click)="tokScope.set('read')">Lecture seule</button>
        <button [class.active]="tokScope() === 'write'" (click)="tokScope.set('write')">Lecture et écriture</button>
      </div>
      <div class="hint">
        {{ tokScope() === 'write'
          ? 'Pourra ajouter des courses, créer des tâches et des événements, en plus de tout consulter.'
          : 'Pourra consulter l’agenda, les courses, les tâches et les repas, sans rien modifier.' }}
      </div>
      <label class="field-label" for="tok-mdp">Mot de passe</label>
      <input id="tok-mdp" class="input" type="password" autocomplete="current-password"
        [ngModel]="tokPassword()" (ngModelChange)="tokPassword.set($event)" />
      <button class="btn btn-primary btn-block" style="margin-top:14px" [disabled]="tokBusy()" (click)="creerJeton()">
        {{ tokBusy() ? 'Création…' : 'Créer un accès' }}
      </button>
    }

    <button class="btn btn-soft btn-block" style="margin-top:22px" (click)="store.logout()">
      <f-icon name="logout" [size]="18" color="var(--ink2)" [width]="2.2" /> Se déconnecter
    </button>
  `,
  styles: [`
    .extra-t { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .06em; margin: 22px 0 10px; }
    .field-label { margin: 0 0 10px; }
    .hint { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; line-height: 1.5; }
    .hint + .field-label { margin-top: 16px; }
    .hint.alerte { color: var(--primary); font-weight: 800; }

    .moi { display: flex; align-items: center; gap: 14px; background: var(--soft); border-radius: 16px; padding: 14px 16px; margin-bottom: 18px; }
    .moi-b { min-width: 0; }
    .moi-n { font-size: 16px; font-weight: 800; color: var(--ink); }
    .moi-m { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .input.court { max-width: 120px; text-transform: uppercase; }

    .totp-on { display: flex; align-items: center; gap: 9px; background: #EDF2EB; border-radius: 12px; padding: 12px 14px; font-size: 13.5px; font-weight: 700; color: #4A6247; margin-bottom: 12px; }
    .secret-b { background: var(--soft); border-radius: 14px; padding: 14px; margin: 12px 0; }
    .secret-t { font-size: 12px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
    .secret { display: block; font-size: 17px; font-weight: 800; letter-spacing: 2px; word-break: break-all; color: var(--ink); }
    .secours { background: #FDF0DA; border-radius: 14px; padding: 14px; margin: 12px 0; }
    .secours-t { font-size: 13px; font-weight: 800; color: #8A6520; margin-bottom: 10px; }
    .secours-l { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }
    .secours-l code { font-size: 14px; font-weight: 800; letter-spacing: 1px; color: var(--ink); }
    .secret-b.neuf { background: #FDF0DA; }

    .tok-list { display: flex; flex-direction: column; gap: 8px; margin: 6px 0 18px; }
    .tok { display: flex; align-items: center; gap: 12px; background: var(--soft); border-radius: 12px; padding: 11px 14px; }
    .tok.rev { opacity: .55; }
    .tok-b { min-width: 0; flex: 1; }
    .tok-n { font-size: 14px; font-weight: 800; color: var(--ink); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .tok-badge { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--ink2); background: var(--soft2); border-radius: 8px; padding: 2px 7px; }
    .tok-m { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 3px; }
    .tok-m code { font-size: 11.5px; }
    .tok-rev { color: var(--primary); font-weight: 800; }
    .tok-x { flex: none; padding: 8px 12px; font-size: 13px; color: var(--primary); }
  `],
})
export class SettingsAccountComponent {
  store = inject(FoyerStore);
  private api = inject(ApiService);
  readonly palette = PALETTE;

  /**
   * Les mots de passe ne passent pas par l'état d'interface : ils vivent ici, le
   * temps de la saisie, et disparaissent avec l'écran.
   */
  readonly mdpActuel = signal('');
  readonly mdpNeuf = signal('');
  readonly mdpConfirme = signal('');
  readonly credBusy = signal(false);

  // ---- second facteur ------------------------------------------------------
  /** L'enrôlement en cours : la clé à saisir, tant qu'elle n'est pas confirmée. */
  readonly totpUri = signal('');
  readonly totpSecretLisible = signal('');
  readonly totpMdp = signal('');
  readonly totpCode = signal('');
  readonly totpBusy = signal(false);
  /** Les codes de secours, montrés une seule fois : ils ne sont pas rangés en clair. */
  readonly totpCodes = signal<string[]>([]);
  readonly secretCopie = signal(false);
  readonly secoursCopies = signal(false);
  readonly secoursRestants = this.store.totpRecoveryLeft;

  // ---- jetons d'accès (assistants, scripts) --------------------------------
  readonly tokens = signal<ApiTokenView[]>([]);
  readonly tokName = signal('');
  readonly tokScope = signal<'read' | 'write'>('read');
  readonly tokPassword = signal('');
  readonly tokBusy = signal(false);
  /** Le secret d'un jeton qu'on vient de créer, montré une seule fois. */
  readonly newSecret = signal('');
  readonly secretTokCopie = signal(false);

  constructor() { void this.chargerJetons(); }

  private async chargerJetons(): Promise<void> {
    if (!this.store.currentMemberId()) return;
    try { this.tokens.set((await this.api.listMyTokens()).tokens); } catch { /* la section reste vide, sans bruit */ }
  }

  async creerJeton(): Promise<void> {
    if (this.tokBusy()) return;
    const name = this.tokName().trim();
    if (!name) { this.store.toast('Donnez un nom à cet accès.'); return; }
    if (!this.tokPassword()) { this.store.toast('Votre mot de passe est requis pour créer un accès.'); return; }
    this.tokBusy.set(true);
    try {
      const { token, ...vue } = await this.api.createMyToken(name, this.tokScope(), this.tokPassword());
      this.newSecret.set(token);
      this.tokens.update((l) => [vue, ...l]);
      this.tokName.set(''); this.tokPassword.set('');
      this.store.toast('Accès créé. Copiez le jeton maintenant, il ne sera plus affiché.');
    } catch (e) { this.store.toast((e as Error).message); }
    this.tokBusy.set(false);
  }

  async revoquer(t: ApiTokenView): Promise<void> {
    if (!confirm(`Révoquer l’accès « ${t.name} » ? Il cessera immédiatement de fonctionner.`)) return;
    try {
      await this.api.revokeMyToken(t.id);
      this.tokens.update((l) => l.map((x) => (x.id === t.id ? { ...x, revoked_at: new Date().toISOString() } : x)));
      this.store.toast('Accès révoqué.');
    } catch (e) { this.store.toast((e as Error).message); }
  }

  copierJeton(): Promise<void> {
    return this.copier(this.newSecret(), this.secretTokCopie, 'Copie impossible : recopiez le jeton à la main.');
  }

  /** SQLite rend « AAAA-MM-JJ HH:MM:SS » en UTC : on l'affiche à l'heure de Paris. */
  dateCourte(s: string): string {
    const d = new Date(s.replace(' ', 'T') + (s.includes('Z') || s.includes('+') ? '' : 'Z'));
    if (isNaN(d.getTime())) return s;
    return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  }

  /** Un libellé court à partir du User-Agent, pour reconnaître l'appareil qui s'est servi du jeton. */
  agent(ua: string): string {
    if (/claude/i.test(ua)) return 'Claude';
    if (/chatgpt|openai/i.test(ua)) return 'ChatGPT';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android';
    if (/curl/i.test(ua)) return 'curl';
    if (/python/i.test(ua)) return 'script Python';
    if (/node/i.test(ua)) return 'script Node';
    return ua.length > 32 ? ua.slice(0, 32) + '…' : ua;
  }

  /** Les initiales que le prénom donnerait, celles qu'on retrouve en vidant le champ. */
  iniAuto(): string { return contactIni(this.store.ui().pfName || '?'); }
  /** Ce que la pastille affichera une fois enregistré : la saisie, ou le prénom à défaut. */
  apercuIni(): string { return this.store.ui().pfIni.trim().toUpperCase().slice(0, 3) || this.iniAuto(); }

  /**
   * Adresse et mot de passe, ensemble : c'est un seul aller-retour au serveur,
   * et un seul mot de passe actuel à retaper. La confirmation est vérifiée ici,
   * parce que le serveur ne voit qu'un mot de passe et ne peut pas la juger.
   */
  async enregistrerIdentifiants(): Promise<void> {
    if (this.credBusy()) return;
    if (this.mdpNeuf() !== this.mdpConfirme()) { this.store.toast('Les deux mots de passe ne sont pas identiques.'); return; }
    this.credBusy.set(true);
    const ok = await this.store.changeCredentials(this.mdpActuel(), this.store.ui().pfEmail, this.mdpNeuf());
    this.credBusy.set(false);
    if (ok) { this.mdpActuel.set(''); this.mdpNeuf.set(''); this.mdpConfirme.set(''); }
  }

  async commencerTotp(): Promise<void> {
    if (this.totpBusy()) return;
    this.totpBusy.set(true);
    try {
      const r = await this.api.totpStart(this.totpMdp());
      this.totpUri.set(r.uri);
      this.totpSecretLisible.set(r.secretLisible);
      this.totpMdp.set('');
    } catch (e) { this.store.toast((e as Error).message); }
    this.totpBusy.set(false);
  }

  async confirmerTotp(): Promise<void> {
    if (this.totpBusy()) return;
    this.totpBusy.set(true);
    try {
      const r = await this.api.totpEnable(this.totpCode().trim());
      this.totpCodes.set(r.recovery);
      this.totpUri.set('');
      this.totpSecretLisible.set('');
      this.totpCode.set('');
      this.store.totpOn.set(true);
      this.store.totpRecoveryLeft.set(r.recovery.length);
      this.store.toast('Second facteur activé. Notez vos codes de secours.');
    } catch (e) { this.store.toast((e as Error).message); }
    this.totpBusy.set(false);
  }

  annulerTotp(): void {
    this.totpUri.set('');
    this.totpSecretLisible.set('');
    this.totpCode.set('');
  }

  async retirerTotp(): Promise<void> {
    if (this.totpBusy()) return;
    if (!confirm('Retirer le second facteur ? Votre mot de passe seul suffira de nouveau à ouvrir ce compte.')) return;
    this.totpBusy.set(true);
    try {
      await this.api.totpDisable(this.totpMdp(), this.totpCode().trim());
      this.store.totpOn.set(false);
      this.store.totpRecoveryLeft.set(null);
      this.totpCodes.set([]);
      this.totpMdp.set(''); this.totpCode.set('');
      this.store.toast('Second facteur retiré.');
    } catch (e) { this.store.toast((e as Error).message); }
    this.totpBusy.set(false);
  }

  async refaireSecours(): Promise<void> {
    if (this.totpBusy()) return;
    this.totpBusy.set(true);
    try {
      const r = await this.api.totpNewRecovery(this.totpMdp(), this.totpCode().trim());
      this.totpCodes.set(r.recovery);
      this.store.totpRecoveryLeft.set(r.recovery.length);
      this.totpMdp.set(''); this.totpCode.set('');
      this.store.toast('Codes de secours refaits. Les anciens ne valent plus rien.');
    } catch (e) { this.store.toast((e as Error).message); }
    this.totpBusy.set(false);
  }

  /** Copie un texte, lève le drapeau « Copié » 1,8 s, ou signale l'échec. */
  private async copier(texte: string, drapeau: WritableSignal<boolean>, erreur: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texte);
      drapeau.set(true); setTimeout(() => drapeau.set(false), 1800);
    } catch { this.store.toast(erreur); }
  }

  // La clé sans les espaces : c'est ce que l'application attend, les espaces
  // n'étaient là que pour la relire.
  copierSecret(): Promise<void> {
    return this.copier(this.totpSecretLisible().replace(/\s/g, ''), this.secretCopie, 'Copie impossible : recopiez la clé à la main.');
  }

  copierSecours(): Promise<void> {
    return this.copier(this.totpCodes().join('\n'), this.secoursCopies, 'Copie impossible : recopiez les codes à la main.');
  }
}
