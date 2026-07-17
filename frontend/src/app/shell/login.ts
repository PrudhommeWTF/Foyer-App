import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';

interface DemoMember { ini: string; name: string; color: string; }

@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="login">
      <div class="art">
        <div class="brand">
          <div class="brand-badge"><f-icon name="home" [size]="26" color="#fff" [width]="2.2" /></div>
          <div>
            <div class="brand-name">Foyer</div>
            <div class="brand-tag f-script">la maison, ensemble</div>
          </div>
        </div>
        <div>
          <div class="hero f-display">Toute la vie du foyer, au même endroit.</div>
          <div class="hero-sub">Calendrier, courses, tâches, budget, repas… Organisez votre famille en toute sérénité.</div>
        </div>
        <div class="chips">
          @for (m of demo; track m.ini) {
            <div class="mchip">
              <span class="avatar" [style.background]="m.color" style="width:28px;height:28px;font-size:12px;border:2px solid rgba(255,255,255,.5)">{{ m.ini }}</span>
              <span>{{ m.name }}</span>
            </div>
          }
        </div>
      </div>

      <div class="panel">
        <div class="form">
          <div class="logo-m">
            <div class="brand-badge sm"><f-icon name="home" [size]="24" color="#fff" [width]="2.2" /></div>
            <div class="brand-name" style="color:var(--ink)">Foyer</div>
          </div>
          <div class="title f-display">{{ mode() === 'login' ? 'Bon retour 👋' : 'Créer votre foyer' }}</div>
          <div class="subtitle">{{ mode() === 'login' ? 'Connectez-vous à votre espace famille' : 'Quelques secondes suffisent' }}</div>

          @if (mode() === 'register') {
            <label class="field-label">Prénom</label>
            <input class="input" [(ngModel)]="name" placeholder="Camille" style="margin-bottom:18px" />
          }

          <label class="field-label">Email</label>
          <input class="input" [(ngModel)]="email" (keydown.enter)="submit()" placeholder="camille.martin@email.fr" style="margin-bottom:18px" />

          <div class="pwd-row">
            <label class="field-label" style="margin:0">Mot de passe</label>
          </div>
          <div class="pwd-wrap">
            <input class="input" [(ngModel)]="pwd" (keydown.enter)="submit()" [type]="show() ? 'text' : 'password'" placeholder="••••••••" style="padding-right:46px" />
            <button class="eye" type="button" (click)="show.set(!show())">
              <f-icon [name]="show() ? 'eyeOff' : 'eye'" [size]="19" color="var(--ink3)" />
            </button>
          </div>

          @if (mode() === 'login') {
            <label class="remember" (click)="remember.set(!remember())">
              <span class="tick" [class.on]="remember()">@if (remember()) { <f-icon name="check" [size]="12" color="#fff" [width]="3.4" /> }</span>
              <span>Rester connecté</span>
            </label>
          } @else { <div style="height:22px"></div> }

          @if (error()) { <div class="err">{{ error() }}</div> }

          <button class="btn btn-primary btn-block" style="padding:15px" (click)="submit()" [disabled]="busy()">
            {{ busy() ? 'Connexion…' : (mode() === 'login' ? 'Se connecter' : 'Créer mon foyer') }}
          </button>

          <div class="switch">
            @if (mode() === 'login') {
              Pas encore de foyer ? <span (click)="mode.set('register')">Créer un compte</span>
            } @else {
              Déjà un compte ? <span (click)="mode.set('login')">Se connecter</span>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .login { width: 100%; min-height: 100vh; display: flex; }
    .art {
      flex: 1; display: flex; flex-direction: column; justify-content: space-between; padding: 54px;
      background: linear-gradient(150deg, #E56B4E, #D9553A 55%, #C6492F);
    }
    .brand { display: flex; align-items: center; gap: 13px; }
    .brand-badge { width: 46px; height: 46px; border-radius: 15px; background: rgba(255,255,255,.16); display: flex; align-items: center; justify-content: center; }
    .brand-badge.sm { width: 44px; height: 44px; border-radius: 14px; background: linear-gradient(135deg, #E56B4E, #D9553A); }
    .brand-name { font-family: var(--font-display); font-size: 24px; font-weight: 700; color: #fff; line-height: 1; }
    .brand-tag { font-size: 17px; color: rgba(255,255,255,.85); line-height: 1; }
    .hero { font-size: 42px; font-weight: 700; color: #fff; line-height: 1.1; max-width: 440px; text-wrap: pretty; }
    .hero-sub { font-size: 16px; font-weight: 600; color: rgba(255,255,255,.9); margin-top: 16px; max-width: 400px; line-height: 1.5; }
    .chips { display: flex; gap: 10px; flex-wrap: wrap; }
    .mchip { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,.15); border-radius: 30px; padding: 6px 14px 6px 6px; color: #fff; font-size: 13px; font-weight: 800; }
    .panel { width: 46%; flex: none; display: flex; align-items: center; justify-content: center; padding: 40px; background: var(--bg); }
    .form { width: 100%; max-width: 380px; }
    .logo-m { display: none; align-items: center; gap: 12px; margin-bottom: 32px; justify-content: center; }
    .title { font-size: 28px; font-weight: 700; color: var(--ink); }
    .subtitle { font-size: 14.5px; font-weight: 600; color: var(--ink2); margin: 6px 0 28px; }
    .pwd-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .pwd-wrap { position: relative; margin-bottom: 14px; }
    .eye { position: absolute; top: 0; right: 0; height: 100%; width: 44px; display: flex; align-items: center; justify-content: center; background: none; border: none; cursor: pointer; }
    .remember { display: flex; align-items: center; gap: 9px; cursor: pointer; margin: 0 0 22px; font-size: 13.5px; font-weight: 700; color: var(--ink2); }
    .err { background: #FCE9E3; color: #C6492F; font-weight: 700; font-size: 13.5px; padding: 11px 14px; border-radius: 12px; margin-bottom: 14px; }
    .switch { text-align: center; font-size: 13.5px; font-weight: 700; color: var(--ink2); margin-top: 22px; }
    .switch span { color: var(--primary); font-weight: 800; cursor: pointer; }
    @media (max-width: 860px) {
      .art { display: none; }
      .panel { width: 100%; }
      .logo-m { display: flex; }
    }
  `],
})
export class LoginComponent {
  store = inject(FoyerStore);
  mode = signal<'login' | 'register'>('login');
  email = 'camille.martin@email.fr';
  pwd = '';
  name = '';
  show = signal(false);
  remember = signal(true);
  busy = signal(false);
  error = this.store.authError;

  demo: DemoMember[] = [
    { ini: 'C', name: 'Camille', color: '#E56B4E' },
    { ini: 'T', name: 'Thomas', color: '#4E93B8' },
    { ini: 'L', name: 'Léa', color: '#9B6FA8' },
    { ini: 'N', name: 'Noah', color: '#6E9E5F' },
  ];

  async submit(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    if (this.mode() === 'login') await this.store.login(this.email.trim(), this.pwd);
    else await this.store.register(this.email.trim(), this.pwd, this.name.trim());
    this.busy.set(false);
  }
}
