import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { contactIni, uid } from '../core/helpers';

interface ObMember { id: string; name: string; role: string; color: string; ini: string; email: string; password: string; }

const PALETTE = ['#E56B4E', '#4E93B8', '#9B6FA8', '#6E9E5F', '#F0B24B', '#C77DA5'];
const STEP_LABELS = ['Bienvenue', 'Nom du foyer', 'Votre profil', 'Membres', 'Préférences', 'Terminé'];
const INTRO = [
  { icon: 'home', bg: '#FCE9E3', color: '#E56B4E', title: 'Nommez votre foyer', desc: 'Le nom de votre espace partagé' },
  { icon: 'users', bg: '#E5F0F4', color: '#4E93B8', title: 'Créez votre profil', desc: 'Votre identité dans le foyer' },
  { icon: 'userPlus', bg: '#EDF6EA', color: '#6E9E5F', title: 'Invitez votre famille', desc: 'Ajoutez parents et enfants' },
];

@Component({
  selector: 'app-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent],
  template: `
    <div class="ob">
      <!-- Brand / stepper -->
      <aside class="art">
        <div>
          <div class="brand">
            <div class="badge"><f-icon name="home" [size]="25" color="#fff" [width]="2.2" /></div>
            <div class="brand-name f-display">Foyer</div>
          </div>
          <div class="stepper">
            @for (l of stepLabels; track $index) {
              <div class="st" [class.cur]="step() === $index">
                <div class="dot" [class.done]="step() > $index" [class.on]="step() === $index">
                  @if (step() > $index) { ✓ } @else { {{ $index + 1 }} }
                </div>
                <div class="st-label">{{ l }}</div>
              </div>
            }
          </div>
        </div>
        <div class="art-foot">On configure votre espace en quelques instants.<br>Vous pourrez tout modifier plus tard dans les paramètres.</div>
      </aside>

      <!-- Content -->
      <div class="pane">
        <div class="scroll fscroll">
          <div class="inner">
            <div class="mhead">
              <div class="mbadge"><f-icon name="home" [size]="21" color="#fff" [width]="2.2" /></div>
              <div class="brand-name f-display" style="color:var(--ink);font-size:19px">Foyer</div>
            </div>
            <div class="eyebrow">Étape {{ step() + 1 }} sur {{ total }}</div>
            <div class="progress"><div class="bar" [style.width.%]="progress()"></div></div>

            @switch (step()) {
              @case (0) {
                <div class="fade">
                  <div class="hero-ic" style="background:#FCE9E3"><f-icon name="users" [size]="34" color="#E56B4E" /></div>
                  <h1 class="f-display">Bienvenue dans Foyer 👋</h1>
                  <p class="lead">Créons ensemble l'espace de votre famille. Vous allez nommer votre foyer, créer votre profil et inviter vos proches.</p>
                  <div class="cards">
                    @for (it of intro; track it.title) {
                      <div class="intro">
                        <div class="intro-ic" [style.background]="it.bg"><f-icon [name]="it.icon" [size]="21" [color]="it.color" /></div>
                        <div><div class="intro-t">{{ it.title }}</div><div class="intro-d">{{ it.desc }}</div></div>
                      </div>
                    }
                  </div>
                </div>
              }

              @case (1) {
                <div class="fade">
                  <h2 class="f-display">Comment s'appelle votre foyer ?</h2>
                  <p class="sub">C'est le nom qui apparaîtra en haut de votre espace partagé.</p>
                  <label class="field-label">Nom du foyer</label>
                  <input class="input big" [ngModel]="famName()" (ngModelChange)="famName.set($event)" (keydown.enter)="next()" placeholder="Famille Martin" />
                  <label class="field-label" style="margin-top:20px">Suggestions</label>
                  <div class="sugs">
                    @for (s of suggestions(); track s) {
                      <button class="sug" (click)="famName.set(s)">{{ s }}</button>
                    }
                  </div>
                </div>
              }

              @case (2) {
                <div class="fade">
                  <h2 class="f-display">Créez votre profil</h2>
                  <p class="sub">Vous serez administrateur du foyer et pourrez gérer les membres.</p>
                  <div class="preview">
                    <f-avatar [ini]="ini()" [color]="color()" [size]="58" />
                    <div><div class="pv-name">{{ name().trim() || 'Votre prénom' }}</div><span class="pv-admin">ADMIN</span></div>
                  </div>
                  <div class="two">
                    <div><label class="field-label">Prénom</label><input class="input" [ngModel]="name()" (ngModelChange)="name.set($event)" placeholder="Camille" /></div>
                    <div><label class="field-label">Rôle</label><input class="input" [ngModel]="role()" (ngModelChange)="role.set($event)" placeholder="Maman" /></div>
                  </div>
                  <div class="two" style="margin-top:16px">
                    <div><label class="field-label">Email</label><input class="input" type="email" [ngModel]="email()" (ngModelChange)="email.set($event)" placeholder="camille@email.fr" /></div>
                    <div><label class="field-label">Mot de passe</label><input class="input" type="password" [ngModel]="password()" (ngModelChange)="password.set($event)" placeholder="6 caractères min." /></div>
                  </div>
                  <label class="field-label" style="margin-top:18px">Couleur</label>
                  <div class="swatches">
                    @for (c of palette; track c) {
                      <button class="sw" [style.background]="c" [style.box-shadow]="color() === c ? ('0 0 0 3px var(--surface),0 0 0 6px ' + c) : 'none'" (click)="color.set(c)"></button>
                    }
                  </div>
                </div>
              }

              @case (3) {
                <div class="fade">
                  <h2 class="f-display">Ajoutez votre famille</h2>
                  <p class="sub">Ajoutez les membres du foyer. Donnez-leur un <b>email + mot de passe</b> pour qu'ils puissent se connecter (facultatif — laissez vide pour un simple profil).</p>
                  <div class="mlist">
                    <div class="mrow you">
                      <f-avatar [ini]="ini()" [color]="color()" [size]="42" />
                      <div class="mrow-info"><div class="mrow-name">{{ name().trim() || 'Vous' }}</div><div class="mrow-role">{{ role().trim() || 'Parent' }} · Vous</div></div>
                      <span class="badge-admin">ADMIN</span>
                    </div>
                    @for (m of members(); track m.id) {
                      <div class="mrow">
                        <f-avatar [ini]="m.ini" [color]="m.color" [size]="42" />
                        <div class="mrow-info">
                          <div class="mrow-name">{{ m.name }}</div>
                          <div class="mrow-role">{{ m.role }}@if (m.email) { <span class="acct"><f-icon name="check" [size]="11" color="#5F7E5C" [width]="3" /> compte</span> }</div>
                        </div>
                        <button class="mrm" (click)="removeMember(m.id)"><f-icon name="x" [size]="16" color="#C6492F" [width]="2.2" /></button>
                      </div>
                    }
                  </div>
                  <div class="addbox">
                    <label class="field-label">Nouveau membre</label>
                    <div class="two" style="margin-bottom:11px">
                      <input class="input soft" [ngModel]="mName()" (ngModelChange)="mName.set($event)" placeholder="Prénom" />
                      <input class="input soft" [ngModel]="mRole()" (ngModelChange)="mRole.set($event)" placeholder="Rôle / âge" />
                    </div>
                    <div class="two" style="margin-bottom:13px">
                      <input class="input soft" type="email" [ngModel]="mEmail()" (ngModelChange)="mEmail.set($event)" placeholder="Email de connexion (facultatif)" />
                      <input class="input soft" type="password" [ngModel]="mPassword()" (ngModelChange)="mPassword.set($event)" (keydown.enter)="addMember()" placeholder="Mot de passe (facultatif)" />
                    </div>
                    <div class="addrow">
                      <div class="swatches sm">
                        @for (c of palette; track c) {
                          <button class="sw sm" [style.background]="c" [style.box-shadow]="mColor() === c ? ('0 0 0 3px var(--surface),0 0 0 5px ' + c) : 'none'" (click)="mColor.set(c)"></button>
                        }
                      </div>
                      <button class="btn btn-primary" (click)="addMember()"><f-icon name="plus" [size]="16" color="#fff" [width]="2.4" /> Ajouter</button>
                    </div>
                  </div>
                </div>
              }

              @case (4) {
                <div class="fade">
                  <h2 class="f-display">Quelques préférences</h2>
                  <p class="sub">Adaptez Foyer à vos habitudes.</p>
                  <label class="field-label">La semaine commence le</label>
                  <div class="opts">
                    @for (w of ['Lundi', 'Dimanche']; track w) {
                      <button class="opt" [class.on]="weekStart() === w" (click)="weekStart.set(w)">{{ w }}</button>
                    }
                  </div>
                  <label class="field-label" style="margin-top:22px">Devise</label>
                  <div class="opts">
                    @for (c of ['Euro (€)', 'Dollar ($)', 'Franc CHF']; track c) {
                      <button class="opt" [class.on]="currency() === c" (click)="currency.set(c)">{{ c }}</button>
                    }
                  </div>
                  <label class="field-label" style="margin-top:22px">Thème</label>
                  <div class="opts">
                    <button class="opt" [class.on]="theme() === 'light'" (click)="setTheme('light')"><f-icon name="sun" [size]="18" [color]="theme() === 'light' ? '#E56B4E' : 'var(--ink2)'" /> Clair</button>
                    <button class="opt" [class.on]="theme() === 'dark'" (click)="setTheme('dark')"><f-icon name="moon" [size]="18" [color]="theme() === 'dark' ? '#E56B4E' : 'var(--ink2)'" /> Sombre</button>
                  </div>
                </div>
              }

              @case (5) {
                <div class="fade">
                  <div class="hero-ic" style="background:#EDF6EA"><f-icon name="check" [size]="34" color="#7A9B76" [width]="2.4" /></div>
                  <h1 class="f-display">Tout est prêt !</h1>
                  <p class="lead">Votre foyer est configuré. Vous pouvez commencer à organiser la vie de famille.</p>
                  <div class="recap">
                    <div class="rrow"><span>Foyer</span><b>{{ famName().trim() || 'Mon foyer' }}</b></div>
                    <div class="rrow"><span>Membres</span><div class="ravatars">
                      @for (m of allMembers(); track m.id) { <f-avatar [ini]="m.ini" [color]="m.color" [size]="30" border="2px solid var(--surface)" /> }
                    </div></div>
                    <div class="rrow"><span>Préférences</span><b>{{ weekStart() }} · {{ currency() }}</b></div>
                  </div>
                </div>
              }
            }
          </div>
        </div>

        <div class="foot">
          @if (step() > 0) {
            <button class="btn btn-soft" (click)="back()"><f-icon name="chevronLeft" [size]="17" [width]="2.4" /> Retour</button>
          }
          <div class="spacer"></div>
          @if (step() === 3) { <button class="skip" (click)="skip()">Passer</button> }
          <button class="btn btn-primary next" (click)="next()" [disabled]="busy()">
            {{ nextLabel() }}<f-icon name="chevronRight" [size]="17" color="#fff" [width]="2.4" />
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ob { width: 100%; min-height: 100vh; display: flex; background: var(--bg); }
    .art { width: 340px; flex: none; display: flex; flex-direction: column; justify-content: space-between; padding: 44px 38px; background: linear-gradient(160deg, #E56B4E, #D9553A 55%, #C6492F); color: #fff; }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 46px; }
    .badge { width: 44px; height: 44px; border-radius: 14px; background: rgba(255,255,255,.16); display: flex; align-items: center; justify-content: center; }
    .brand-name { font-size: 24px; font-weight: 700; }
    .stepper { display: flex; flex-direction: column; gap: 6px; }
    .st { display: flex; align-items: center; gap: 14px; padding: 11px 12px; border-radius: 13px; transition: background .2s; }
    .st.cur { background: rgba(255,255,255,.16); }
    .dot { width: 30px; height: 30px; flex: none; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13.5px; color: #fff; border: 2px solid rgba(255,255,255,.5); }
    .dot.on { background: rgba(255,255,255,.22); border-color: transparent; }
    .dot.done { background: #fff; color: #D9553A; border-color: transparent; }
    .st-label { font-size: 14px; font-weight: 700; color: rgba(255,255,255,.7); }
    .st.cur .st-label { color: #fff; font-weight: 800; }
    .art-foot { font-size: 13px; font-weight: 600; line-height: 1.6; color: rgba(255,255,255,.82); }

    .pane { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .scroll { flex: 1; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 56px 40px 20px; }
    .inner { width: 100%; max-width: 520px; }
    .mhead { display: none; align-items: center; gap: 11px; margin-bottom: 26px; }
    .mbadge { width: 38px; height: 38px; border-radius: 12px; background: linear-gradient(135deg, #EE7E5F, #D9553A); display: flex; align-items: center; justify-content: center; }
    .eyebrow { font-size: 12.5px; font-weight: 800; color: var(--primary); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 9px; }
    .progress { height: 6px; border-radius: 4px; background: var(--soft2); margin-bottom: 32px; overflow: hidden; }
    .bar { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #EE7E5F, #D9553A); transition: width .3s; }
    .fade { animation: ffade .3s ease; }
    h1 { font-family: var(--font-display); font-size: 30px; font-weight: 700; color: var(--ink); line-height: 1.15; margin-bottom: 12px; }
    h2 { font-family: var(--font-display); font-size: 27px; font-weight: 700; color: var(--ink); margin-bottom: 10px; }
    .lead { font-size: 15.5px; font-weight: 600; color: var(--ink2); line-height: 1.6; margin-bottom: 26px; }
    .sub { font-size: 14.5px; font-weight: 600; color: var(--ink2); margin-bottom: 26px; }
    .hero-ic { width: 64px; height: 64px; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin-bottom: 22px; }
    .cards { display: flex; flex-direction: column; gap: 12px; }
    .intro { display: flex; align-items: center; gap: 14px; padding: 15px 16px; border-radius: 15px; background: var(--surface); border: 1.5px solid var(--line); }
    .intro-ic { width: 40px; height: 40px; flex: none; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
    .intro-t { font-size: 15px; font-weight: 800; color: var(--ink); }
    .intro-d { font-size: 13px; font-weight: 600; color: var(--ink2); }
    .input.big { padding: 15px 17px; font-size: 16px; border-radius: 14px; }
    .input.soft { background: var(--soft); }
    .sugs { display: flex; flex-wrap: wrap; gap: 9px; }
    .sug { padding: 10px 16px; border-radius: 30px; background: var(--surface); border: 1.5px solid var(--line2); font-size: 13.5px; font-weight: 700; color: var(--ink2); cursor: pointer; }
    .sug:hover { border-color: var(--primary); color: var(--primary); }
    .preview { display: flex; align-items: center; gap: 16px; padding: 18px; border-radius: 16px; background: var(--surface); border: 1.5px solid var(--line); margin-bottom: 24px; }
    .pv-name { font-size: 17px; font-weight: 800; color: var(--ink); }
    .pv-admin { display: inline-block; margin-top: 4px; padding: 3px 9px; border-radius: 20px; background: #FCE9E3; font-size: 11px; font-weight: 800; color: #E56B4E; }
    .two { display: flex; gap: 14px; }
    .two > div { flex: 1; min-width: 0; }
    .swatches { display: flex; gap: 12px; flex-wrap: wrap; }
    .swatches.sm { gap: 9px; }
    .sw { width: 40px; height: 40px; border: none; border-radius: 50%; cursor: pointer; }
    .sw.sm { width: 30px; height: 30px; }
    .mlist { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
    .mrow { display: flex; align-items: center; gap: 13px; padding: 13px 15px; border-radius: 14px; background: var(--surface); border: 1.5px solid var(--line); }
    .mrow.you { background: #FCF3EF; border-color: #F5D9CF; }
    :host-context(:root.dark) .mrow.you { background: rgba(229,107,78,.14); border-color: rgba(229,107,78,.3); }
    .mrow-info { flex: 1; min-width: 0; }
    .mrow-name { font-size: 15px; font-weight: 800; color: var(--ink); }
    .mrow-role { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .acct { display: inline-flex; align-items: center; gap: 3px; margin-left: 8px; padding: 1px 7px; border-radius: 20px; background: #EDF2EB; color: #5F7E5C; font-size: 10.5px; font-weight: 800; }
    :host-context(:root.dark) .acct { background: rgba(122,155,118,.22); }
    .badge-admin { padding: 4px 10px; border-radius: 20px; background: #FCE9E3; font-size: 11px; font-weight: 800; color: #E56B4E; }
    .mrm { width: 34px; height: 34px; border: none; border-radius: 10px; background: var(--soft); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .mrm:hover { background: #FCE4DE; }
    .addbox { padding: 17px; border-radius: 16px; background: var(--surface); border: 1.5px dashed var(--line2); }
    .addrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .opts { display: flex; gap: 11px; flex-wrap: wrap; }
    .opt { flex: 1; min-width: 90px; display: flex; align-items: center; justify-content: center; gap: 9px; padding: 14px; border-radius: 13px; border: 2px solid var(--line2); background: var(--surface); color: var(--ink2); font-size: 14.5px; font-weight: 800; cursor: pointer; }
    .opt.on { border-color: var(--primary); background: #FCE9E3; color: var(--primary); }
    :host-context(:root.dark) .opt.on { background: rgba(229,107,78,.18); }
    .recap { border-radius: 18px; background: var(--surface); border: 1.5px solid var(--line); overflow: hidden; }
    .rrow { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; }
    .rrow + .rrow { border-top: 1px solid var(--line); }
    .rrow span { font-size: 13px; font-weight: 700; color: var(--ink2); }
    .rrow b { font-size: 15px; font-weight: 800; color: var(--ink); }
    .ravatars { display: flex; }
    .ravatars > * { margin-left: -8px; }
    .ravatars > *:first-child { margin-left: 0; }
    .foot { display: flex; align-items: center; gap: 14px; padding: 20px 40px; border-top: 1px solid var(--line); background: var(--surface); }
    .foot .btn { padding: 14px 22px; }
    .next { padding: 14px 26px; box-shadow: 0 12px 26px -14px rgba(229,107,78,.9); }
    .skip { border: none; background: none; padding: 14px 18px; font-size: 14px; font-weight: 800; color: var(--ink2); cursor: pointer; }

    @media (max-width: 860px) {
      .art { display: none; }
      .mhead { display: flex; }
      .scroll { padding: 32px 18px 16px; }
      .foot { padding: 16px 18px; }
      .two { flex-direction: column; gap: 12px; }
    }
  `],
})
export class OnboardingComponent {
  store = inject(FoyerStore);
  palette = PALETTE;
  stepLabels = STEP_LABELS;
  intro = INTRO;
  total = 6;

  step = signal(0);
  famName = signal('');
  name = signal('');
  role = signal('');
  email = signal('');
  password = signal('');
  color = signal('#E56B4E');
  members = signal<ObMember[]>([]);
  mName = signal('');
  mRole = signal('');
  mEmail = signal('');
  mPassword = signal('');
  mColor = signal('#4E93B8');
  weekStart = signal('Lundi');
  currency = signal('Euro (€)');
  theme = signal<'light' | 'dark'>('light');
  busy = signal(false);

  ini = computed(() => contactIni(this.name().trim() || '?'));
  progress = computed(() => Math.round((this.step() / 5) * 100));
  nextLabel = computed(() => (this.step() === 0 ? 'Commencer' : this.step() >= 5 ? 'Terminer' : 'Continuer'));
  suggestions = computed(() => ['Famille ' + (this.name().trim() || 'Martin'), 'Chez nous', 'La Maisonnée', 'Le Nid']);
  allMembers = computed<ObMember[]>(() => [{ id: 'me', name: this.name(), role: this.role(), color: this.color(), ini: this.ini(), email: '', password: '' }, ...this.members()].slice(0, 6));

  setTheme(t: 'light' | 'dark'): void {
    this.theme.set(t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }

  addMember(): void {
    const name = this.mName().trim();
    if (!name) { this.store.toast('Donne un prénom'); return; }
    const email = this.mEmail().trim();
    const password = this.mPassword();
    if ((!!email) !== (!!password)) { this.store.toast('Renseigne email ET mot de passe, ou aucun des deux'); return; }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) { this.store.toast('Email du membre invalide'); return; }
    if (password && password.length < 6) { this.store.toast('Mot de passe du membre : 6 caractères minimum'); return; }
    if (email && this.emailTaken(email)) { this.store.toast('Cet email est déjà utilisé'); return; }
    this.members.update((list) => [...list, { id: uid('ob'), name, role: this.mRole().trim() || 'Membre', color: this.mColor(), ini: contactIni(name), email, password }]);
    this.mName.set(''); this.mRole.set(''); this.mEmail.set(''); this.mPassword.set(''); this.mColor.set('#4E93B8');
  }

  private emailTaken(email: string): boolean {
    const e = email.toLowerCase();
    return this.email().trim().toLowerCase() === e || this.members().some((m) => m.email.toLowerCase() === e);
  }
  removeMember(id: string): void { this.members.update((l) => l.filter((m) => m.id !== id)); }

  back(): void { this.step.update((s) => Math.max(0, s - 1)); this.scrollTop(); }
  skip(): void { this.step.update((s) => s + 1); this.scrollTop(); }

  async next(): Promise<void> {
    const s = this.step();
    if (s === 1 && !this.famName().trim()) { this.store.toast('Donne un nom à ton foyer'); return; }
    if (s === 2) {
      if (!this.name().trim()) { this.store.toast('Indique ton prénom'); return; }
      if (!/^\S+@\S+\.\S+$/.test(this.email().trim())) { this.store.toast('Indique un email valide'); return; }
      if (this.password().length < 6) { this.store.toast('Mot de passe : 6 caractères minimum'); return; }
    }
    if (s >= 5) { await this.finish(); return; }
    this.step.update((x) => x + 1);
    this.scrollTop();
  }

  private async finish(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    const ok = await this.store.completeSetup({
      household: { name: this.famName().trim(), weekStart: this.weekStart(), currency: this.currency(), theme: this.theme() },
      admin: { name: this.name().trim(), role: this.role().trim(), color: this.color(), email: this.email().trim(), password: this.password() },
      members: this.members().map((m) => ({ name: m.name, role: m.role, color: m.color, email: m.email || undefined, password: m.password || undefined })),
    });
    this.busy.set(false);
    if (!ok) this.store.toast(this.store.authError() || 'Échec de la configuration');
  }

  private scrollTop(): void {
    setTimeout(() => { const el = document.querySelector('.ob .scroll'); if (el) el.scrollTop = 0; }, 0);
  }
}
