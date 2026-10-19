import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { EcoleApi, EdAccount, EdEtat, EdResult, EdState, EdStudent } from '../../core/ecole.api';
import { relTime } from '../../core/activity';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';

/**
 * Paramètres → École : les comptes ÉcoleDirecte, la question de sécurité,
 * l'association des élèves aux membres, et le journal des synchronisations.
 * Réservé aux administrateurs (le serveur refuse les autres).
 *
 * Tout ce qui est affiché vient du serveur, qui seul parle à ÉcoleDirecte :
 * jamais d'identifiant ni de mot de passe relu, seulement des dates et des états.
 */
@Component({
  selector: 'settings-ecole',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    @if (!store.isAdmin()) {
      <div class="hint">Les comptes ÉcoleDirecte se configurent par un administrateur.</div>
    } @else if (erreur() && !etat()) {
      <div class="ko">{{ erreur() }}</div>
    } @else if (etat(); as e) {
      @if (e.keyState !== 'ok') {
        <div class="warn">
          <b>{{ e.keyState === 'absente' ? 'Clé de chiffrement absente.' : 'Clé de chiffrement trop courte (32 caractères au moins).' }}</b>
          Aucun compte ne peut être enregistré tant que <code>FOYER_SECRET_KEY</code> n’est pas posée.
          En LXC, ajoutez-la à <code>/etc/foyer/foyer.env</code> puis <code>systemctl restart foyer</code> ;
          en Docker, dans le <code>.env</code> du compose. Générez-la avec <code>openssl rand -base64 32</code>.
        </div>
      }
      @if (e.inPause && e.accounts.length) {
        <div class="hint">Pause de nuit en cours : Foyer ne contacte pas ÉcoleDirecte avant l’heure de reprise. « Synchroniser maintenant » reste possible.</div>
      }

      @for (a of e.accounts; track a.id) {
        <div class="acct">
          <div class="a-head">
            <div class="a-label">{{ a.label }}</div>
            <span class="badge" [class]="'badge ' + tone(a.state)">{{ stateLabel(a) }}</span>
          </div>
          <div class="a-meta">
            @if (a.accountType) { <span>{{ a.accountType === 'famille' ? 'Compte famille' : 'Compte élève' }}</span> }
            @if (a.credsSetAt) { <span>Identifiants enregistrés {{ quand(a.credsSetAt) }}</span> }
            <span>{{ a.trustedSince ? 'Appareil de confiance connu depuis ' + quand(a.trustedSince) : 'Appareil de confiance : pas encore' }}</span>
          </div>
          <div class="a-sync">
            <div><span>Dernière réussite</span><b>{{ a.lastOkAt ? ago(a.lastOkAt) : 'jamais' }}</b></div>
            <div><span>Prochain passage</span><b>{{ a.nextRunAt ? heure(a.nextRunAt) : 'aucun sans action de votre part' }}</b></div>
          </div>

          @if (a.lastError && a.state !== 'ok') {
            <div class="err">
              {{ a.lastError.message }}
              <div class="code">{{ a.lastError.code !== null ? 'code ÉcoleDirecte ' + a.lastError.code + ' · ' : '' }}{{ quand(a.lastError.at) }}</div>
            </div>
          }
          @if (a.alertedAt) { <div class="small">Administrateurs prévenus {{ quand(a.alertedAt) }}.</div> }

          @if (a.state === 'qcm' && a.pendingQcm; as q) {
            <div class="qcm">
              <div class="q-t">Question de sécurité</div>
              <div class="q-q">{{ q.question }}</div>
              <div class="q-props">
                @for (p of q.propositions; track $index) {
                  <button class="btn btn-soft" [disabled]="busy() === a.id" (click)="repondre(a, $index)">{{ p }}</button>
                }
              </div>
              <div class="small">Touchez la bonne réponse : Foyer se reconnecte et mémorise cet appareil. Une mauvaise réponse compte comme une tentative chez ÉcoleDirecte.</div>
            </div>
          }

          @if (resultats()[a.id]; as r) { <div class="res" [class.ko]="r.kind === 'erreur'">{{ resume(r) }}</div> }

          @if (a.students.length) {
            <div class="sub-t">Élèves</div>
            @for (s of a.students; track s.id) {
              <div class="stu">
                <div class="s-body">
                  <div class="s-name">{{ s.firstName }} {{ s.lastName }}</div>
                  <div class="s-meta">{{ [s.className, s.schoolName].filter(nonVide).join(' · ') }}</div>
                  <div class="s-link" [class.todo]="s.linkState === 'propose' || s.linkState === 'aucun'">{{ lien(s) }}</div>
                  @if (s.linkState === 'confirme') {
                    @if (s.dataError) { <div class="s-err">Données en échec : {{ s.dataError }}</div> }
                    @else if (s.dataOkAt) { <div class="s-meta">Devoirs et emploi du temps synchronisés {{ quand(s.dataOkAt) }}</div> }
                    <label class="s-half">
                      <input type="checkbox" [checked]="s.halfBoard" [disabled]="busy() === a.id" (change)="demiPension(a, s, $any($event.target).checked)" />
                      Demi-pensionnaire : la pause de midi entre deux cours compte comme une absence au déjeuner
                    </label>
                  }
                </div>
                @if (choix()?.studentId === s.id) {
                  <div class="s-pick">
                    <select class="input" [ngModel]="choix()!.memberId" (ngModelChange)="choix.set({ studentId: s.id, memberId: $event })">
                      <option value="">Choisir un membre…</option>
                      @for (m of store.d().members; track m.id) { <option [value]="m.id">{{ m.name }}</option> }
                    </select>
                    <div class="row">
                      <button class="btn btn-primary" [disabled]="!choix()!.memberId || busy() === a.id" (click)="associer(a, s)">Associer</button>
                      <button class="btn btn-soft" [disabled]="busy() === a.id" (click)="lier(a, s, 'ignorer')">Ignorer cet élève</button>
                      <button class="btn btn-ghost" (click)="choix.set(null)">Annuler</button>
                    </div>
                  </div>
                } @else {
                  <div class="row">
                    @if (s.linkState === 'propose') {
                      <button class="btn btn-primary" [disabled]="busy() === a.id" (click)="lier(a, s, 'confirmer')">Confirmer</button>
                    }
                    <button class="btn btn-soft" (click)="choix.set({ studentId: s.id, memberId: s.memberId || '' })">{{ s.linkState === 'confirme' ? 'Changer' : 'Choisir' }}</button>
                  </div>
                }
              </div>
            }
          }

          <div class="acts">
            @if (a.state === 'cle' || a.state === 'identifiants') {
              <button class="btn btn-primary" (click)="ouvrir(a)">Ressaisir les identifiants</button>
            } @else if (a.state !== 'qcm') {
              <button class="btn btn-primary" [disabled]="busy() === a.id" (click)="synchroniser(a)">
                <f-icon name="refresh" [size]="16" color="#fff" [width]="2.4" /> {{ busy() === a.id ? 'Connexion…' : 'Synchroniser maintenant' }}
              </button>
            }
            <button class="btn btn-soft" [disabled]="busy() === a.id" (click)="basculerPause(a)">{{ a.enabled ? 'Mettre en pause' : 'Reprendre' }}</button>
            @if (a.state !== 'cle' && a.state !== 'identifiants') { <button class="btn btn-soft" (click)="ouvrir(a)">Modifier</button> }
            <button class="btn btn-ghost danger" (click)="aRetirer.set(a)">Retirer</button>
          </div>
        </div>
      }

      <button class="btn btn-soft add" [disabled]="e.keyState !== 'ok'" (click)="ouvrir(null)">
        <f-icon name="plus" [size]="16" color="var(--ink2)" [width]="2.6" /> Ajouter un compte ÉcoleDirecte
      </button>
      <div class="small">Version d’API annoncée : {{ e.apiVersion }}. Foyer ne contacte que {{ e.apiBase }}, et seulement quand le module est actif.</div>

      @if (e.journal.length) {
        <details class="journal">
          <summary>Journal des synchronisations</summary>
          @for (l of e.journal; track l.id) {
            <div class="j-l" [class.ko]="!l.ok">
              <span class="j-t">{{ quand(l.at) }}</span>
              <span class="j-m">{{ nomCompte(l.accountId) }} : {{ l.message }}</span>
              <span class="j-c">{{ l.edCode !== null ? 'code ' + l.edCode : '' }}{{ l.durationMs !== null ? ' · ' + l.durationMs + ' ms' : '' }}</span>
            </div>
          }
        </details>
      }
    } @else {
      <div class="hint">Chargement…</div>
    }

    @if (form(); as f) {
      <f-modal [title]="f.id ? 'Modifier « ' + f.label + ' »' : 'Ajouter un compte ÉcoleDirecte'" [maxWidth]="440" (close)="form.set(null)">
        <div class="form">
          <label class="lab">Libellé<input class="input" [(ngModel)]="f.label" placeholder="Collège de Nolan" maxlength="80" /></label>
          <label class="lab">Identifiant ÉcoleDirecte<input class="input" [(ngModel)]="f.identifiant" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
          <label class="lab">Mot de passe
            <div class="pw">
              <input class="input" [type]="voir() ? 'text' : 'password'" [(ngModel)]="f.motdepasse" autocomplete="new-password" />
              <button class="icon-btn sm" type="button" [attr.aria-label]="voir() ? 'Masquer' : 'Afficher'" (click)="voir.set(!voir())"><f-icon [name]="voir() ? 'eyeOff' : 'eye'" [size]="16" /></button>
            </div>
          </label>
          <div class="small">
            Le compte parent donne accès à tous les enfants rattachés. Le mot de passe est chiffré sur le serveur et ne revient jamais dans le navigateur.
            @if (f.id) { Laissez identifiant et mot de passe vides pour ne changer que le libellé. }
          </div>
          @if (formErr()) { <div class="ko">{{ formErr() }}</div> }
          <div class="f-act">
            <button class="btn btn-soft" (click)="form.set(null)">Annuler</button>
            <button class="btn btn-primary" [disabled]="!formOk() || busy() === -1" (click)="enregistrer()">{{ busy() === -1 ? 'Connexion…' : f.id && !f.identifiant ? 'Enregistrer' : 'Se connecter' }}</button>
          </div>
        </div>
      </f-modal>
    }

    @if (aRetirer(); as a) {
      <f-modal [title]="'Retirer « ' + a.label + ' »'" [maxWidth]="420" (close)="aRetirer.set(null)">
        <p class="q">Les identifiants et l’appareil de confiance sont effacés du serveur ; l’historique reste consultable. Pour reconnecter ce compte plus tard, il faudra les ressaisir et répondre de nouveau à la question de sécurité.</p>
        <div class="f-act">
          <button class="btn btn-soft" (click)="aRetirer.set(null)">Annuler</button>
          <button class="btn btn-danger" (click)="retirer(a)">Retirer</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    :host { display: block; }
    .hint, .small { font-size: 12.5px; font-weight: 600; color: var(--ink3); line-height: 1.5; margin: 6px 0 10px; }
    .warn { font-size: 12.5px; font-weight: 600; color: #8A5A08; background: #FDF0DA; border-radius: 12px; padding: 12px 14px; line-height: 1.55; margin-bottom: 14px; }
    code { background: var(--soft2); padding: 1px 6px; border-radius: 6px; font-size: 11px; }
    .ko { font-size: 12.5px; font-weight: 800; color: #C6492F; }
    .acct { border: 1px solid var(--line); border-radius: 14px; padding: 14px; margin-bottom: 14px; }
    .a-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .a-label { font-size: 15px; font-weight: 800; color: var(--ink); }
    .badge { font-size: 11.5px; font-weight: 800; padding: 4px 10px; border-radius: 20px; }
    .badge.ok { background: #EDF2EB; color: #5F7E5C; }
    .badge.act { background: #FCE9E3; color: #C6492F; }
    .badge.wait { background: #FDF0DA; color: #9A6A12; }
    .badge.off { background: var(--soft2); color: var(--ink2); }
    .a-meta { display: flex; flex-direction: column; gap: 2px; font-size: 12px; font-weight: 600; color: var(--ink3); margin-top: 6px; }
    .a-sync { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
    .a-sync div { background: var(--soft); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; }
    .a-sync span { font-size: 12.5px; font-weight: 800; color: var(--ink3); }
    .a-sync b { font-size: 13px; font-weight: 800; color: var(--ink); margin-top: 2px; }
    .err { margin-top: 10px; font-size: 13px; font-weight: 700; color: #A33A22; background: #FCE9E3; border-radius: 10px; padding: 10px 12px; line-height: 1.45; }
    .err .code { font-size: 11px; font-weight: 700; color: #B86A55; margin-top: 4px; }
    .qcm { margin-top: 12px; border: 2px solid var(--primary); border-radius: 12px; padding: 12px; }
    .q-t { font-size: 12.5px; font-weight: 800; color: var(--primary); }
    .q-q { font-size: 14.5px; font-weight: 800; color: var(--ink); margin: 6px 0 10px; line-height: 1.4; }
    .q-props { display: flex; flex-direction: column; gap: 8px; }
    .q-props .btn { justify-content: flex-start; text-align: left; }
    .res { margin-top: 10px; font-size: 12.5px; font-weight: 800; color: #5F7E5C; }
    .res.ko { color: #C6492F; }
    .sub-t { font-size: 12.5px; font-weight: 800; color: var(--ink3); margin: 14px 0 6px; }
    .stu { display: flex; flex-direction: column; gap: 8px; padding: 10px 0; border-top: 1px solid var(--line); }
    .s-name { font-size: 14px; font-weight: 800; color: var(--ink); }
    .s-meta { font-size: 12px; font-weight: 600; color: var(--ink3); }
    .s-link { font-size: 12.5px; font-weight: 700; color: #5F7E5C; margin-top: 2px; }
    .s-link.todo { color: #9A6A12; }
    .s-err { font-size: 12px; font-weight: 700; color: #C6492F; margin-top: 2px; }
    .s-half { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; font-weight: 600; color: var(--ink2); margin-top: 6px; line-height: 1.4; }
    .s-half input { margin-top: 2px; }
    .s-pick { display: flex; flex-direction: column; gap: 8px; }
    .row, .acts { display: flex; gap: 8px; flex-wrap: wrap; }
    .row .btn, .acts .btn { padding: 9px 13px; font-size: 13px; }
    .acts { margin-top: 14px; }
    .danger { color: #C6492F; }
    .add { margin-top: 2px; }
    .journal { margin-top: 12px; }
    .journal summary { cursor: pointer; font-size: 12.5px; font-weight: 800; color: var(--ink2); padding: 6px 0; }
    .j-l { display: flex; flex-direction: column; padding: 6px 0; border-top: 1px solid var(--line); }
    .j-t { font-size: 11px; font-weight: 800; color: var(--ink3); }
    .j-m { font-size: 12.5px; font-weight: 700; color: var(--ink); }
    .j-l.ko .j-m { color: #C6492F; }
    .j-c { font-size: 11px; font-weight: 700; color: var(--ink3); }
    .form { display: flex; flex-direction: column; gap: 12px; }
    .lab { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 800; color: var(--ink2); }
    .pw { display: flex; gap: 8px; align-items: center; }
    .q { font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin: 0 0 14px; }
    .f-act { display: flex; gap: 8px; margin-top: 8px; }
    .f-act .btn { flex: 1; }
  `],
})
export class SettingsEcoleComponent {
  store = inject(FoyerStore);
  private api = inject(EcoleApi);

  readonly etat = signal<EdEtat | null>(null);
  readonly erreur = signal('');
  /** Le compte en cours d'échange avec le serveur (-1 : le formulaire). */
  readonly busy = signal<number | null>(null);
  /** Ce que la dernière action a donné, par compte, affiché sous ses boutons. */
  readonly resultats = signal<Record<number, EdResult>>({});
  readonly choix = signal<{ studentId: number; memberId: string } | null>(null);
  readonly form = signal<{ id: number | null; label: string; identifiant: string; motdepasse: string } | null>(null);
  readonly formErr = signal('');
  readonly voir = signal(false);
  readonly aRetirer = signal<EdAccount | null>(null);
  readonly nonVide = (s: string): boolean => !!s;

  /** Une méthode, pas un `computed` : les champs du formulaire se modifient en place. */
  formOk(): boolean {
    const f = this.form();
    if (!f || !f.label.trim()) return false;
    // En modification, identifiant et mot de passe vont ensemble ou pas du tout.
    if (f.id && !f.identifiant.trim() && !f.motdepasse) return true;
    return !!f.identifiant.trim() && !!f.motdepasse;
  }

  constructor() { if (this.store.isAdmin()) void this.charger(); }

  async charger(): Promise<void> {
    try { this.etat.set(await this.api.etat()); this.erreur.set(''); }
    catch (e) { this.erreur.set((e as Error).message || 'Section École indisponible.'); }
  }

  /** Une action sur un compte : occupée pendant l'échange, puis l'état frais du serveur. */
  private async agir(a: { id: number }, fn: () => Promise<{ result?: EdResult | null; account: EdAccount }>): Promise<void> {
    this.busy.set(a.id);
    try {
      const out = await fn();
      if (out.result) this.resultats.update((r) => ({ ...r, [a.id]: out.result! }));
    } catch (e) {
      this.resultats.update((r) => ({ ...r, [a.id]: { kind: 'erreur', errorKind: 'http', code: null, message: (e as Error).message } }));
    }
    this.busy.set(null);
    await this.charger();
  }

  synchroniser(a: EdAccount): Promise<void> { return this.agir(a, () => this.api.connect(a.id)); }
  repondre(a: EdAccount, i: number): Promise<void> { return this.agir(a, () => this.api.answer(a.id, i)); }
  basculerPause(a: EdAccount): Promise<void> { return this.agir(a, () => this.api.pause(a.id, a.enabled)); }
  lier(a: EdAccount, s: EdStudent, action: 'confirmer' | 'ignorer'): Promise<void> { this.choix.set(null); return this.agir(a, () => this.api.link(s.id, action)); }
  demiPension(a: EdAccount, s: EdStudent, on: boolean): Promise<void> { return this.agir(a, () => this.api.halfBoard(s.id, on)); }
  associer(a: EdAccount, s: EdStudent): Promise<void> {
    const m = this.choix()?.memberId; this.choix.set(null);
    return this.agir(a, () => this.api.link(s.id, 'associer', m));
  }

  ouvrir(a: EdAccount | null): void {
    this.formErr.set(''); this.voir.set(false);
    this.form.set({ id: a?.id ?? null, label: a?.label ?? '', identifiant: '', motdepasse: '' });
  }

  async enregistrer(): Promise<void> {
    const f = this.form();
    if (!f || !this.formOk()) return;
    this.busy.set(-1); this.formErr.set('');
    try {
      const out = f.id
        ? await this.api.update(f.id, { label: f.label.trim(), ...(f.identifiant.trim() ? { identifiant: f.identifiant.trim(), motdepasse: f.motdepasse } : {}) })
        : await this.api.create(f.label.trim(), f.identifiant.trim(), f.motdepasse);
      if (out.result) this.resultats.update((r) => ({ ...r, [out.account.id]: out.result! }));
      this.form.set(null);
    } catch (e) { this.formErr.set((e as Error).message); }
    this.busy.set(null);
    await this.charger();
  }

  async retirer(a: EdAccount): Promise<void> {
    this.aRetirer.set(null);
    try { await this.api.remove(a.id); this.store.toast('Compte ÉcoleDirecte retiré'); } catch (e) { this.store.toast((e as Error).message); }
    await this.charger();
  }

  tone(s: EdState): string {
    return s === 'ok' ? 'ok' : s === 'pause' || s === 'jamais' ? 'off' : s === 'pause-auto' || s === 'qcm' ? 'wait' : 'act';
  }
  stateLabel(a: EdAccount): string {
    switch (a.state) {
      case 'ok': return 'Connecté';
      case 'jamais': return 'Jamais connecté';
      case 'erreur': return 'Dernière tentative en échec';
      case 'qcm': return 'Question de sécurité à répondre';
      case 'identifiants': return 'Identifiants refusés';
      case 'version': return 'Version d’API refusée';
      case 'cle': return 'Identifiants à ressaisir';
      case 'pause': return 'En pause';
      case 'pause-auto': return 'En pause automatique jusqu’à ' + (a.pausedUntil ? this.heure(a.pausedUntil) : '?');
    }
  }
  resume(r: EdResult): string {
    if (r.kind === 'ok') return `Connexion réussie : ${r.students} élève${r.students > 1 ? 's' : ''} trouvé${r.students > 1 ? 's' : ''}.`;
    if (r.kind === 'qcm') return r.changed ? 'La question a changé depuis son affichage : répondez à la nouvelle.' : 'ÉcoleDirecte pose une question de sécurité : répondez ci-dessus.';
    return r.message + (r.code !== null ? ` (code ${r.code})` : '');
  }
  lien(s: EdStudent): string {
    const nom = s.memberId ? this.store.memberName(s.memberId) || 'membre retiré' : '';
    switch (s.linkState) {
      case 'confirme': return `Associé à ${nom}${s.matchSource === 'manuel' ? ' (choisi à la main)' : ''}`;
      case 'propose': return `Proposé : ${nom}, d’après le prénom. À confirmer.`;
      case 'ignore': return 'Ignoré : ni synchronisé, ni affiché.';
      default: return 'Aucun membre ne correspond au prénom : choisissez-le.';
    }
  }
  nomCompte(id: number | null): string { return this.etat()?.accounts.find((a) => a.id === id)?.label || 'compte retiré'; }

  ago(iso: string): string { return relTime(iso, Date.now()); }
  /** « le 13/10 à 18:02 », à l'heure de Paris. */
  quand(iso: string): string {
    const d = new Date(iso);
    const j = d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' });
    return `le ${j} à ${this.heure(iso)}`;
  }
  /** « 14:30 », ou « demain 06:00 » quand ce n'est pas aujourd'hui. */
  heure(iso: string): string {
    const d = new Date(iso);
    const hm = d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
    const jour = (x: Date): string => x.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
    const auj = new Date();
    if (jour(d) === jour(auj)) return hm;
    if (jour(d) === jour(new Date(auj.getTime() + 86_400_000))) return 'demain ' + hm;
    return d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric' }) + ' ' + hm;
  }
}
