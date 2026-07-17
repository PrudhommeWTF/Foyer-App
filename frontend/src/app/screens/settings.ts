import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';

@Component({
  selector: 'screen-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="screen-enter">
      <div class="screen-head">
        <div>
          <h1>Paramètres</h1>
          <div class="screen-sub">Personnalisez votre foyer, vos préférences et votre confidentialité</div>
        </div>
      </div>

      <div class="cols">
        <!-- Column 1 — Général -->
        <div class="card">
          <div class="sec-head">
            <div class="sec-ic" style="background:#EDF2EB">
              <f-icon name="settings" [size]="18" color="#7A9B76" [width]="2" />
            </div>
            <span class="sec-title">Général</span>
          </div>

          <div class="field-label">Langue</div>
          <div class="seg wrap">
            @for (o of langOpts; track o) {
              <button [class.active]="d().settings.lang === o" (click)="store.setSetting('lang', o)">{{ o }}</button>
            }
          </div>

          <div class="field-label">Fuseau horaire</div>
          <div class="seg stack">
            @for (o of tzOpts; track o) {
              <button [class.active]="d().settings.tz === o" (click)="store.setSetting('tz', o)">{{ o }}</button>
            }
          </div>

          <div class="field-label">Format de date</div>
          <div class="seg wrap">
            @for (o of dateFmtOpts; track o) {
              <button [class.active]="d().settings.dateFmt === o" (click)="store.setSetting('dateFmt', o)">{{ o }}</button>
            }
          </div>

          <div class="two">
            <div>
              <div class="field-label">Début de semaine</div>
              <div class="seg">
                @for (o of weekStartOpts; track o) {
                  <button [class.active]="d().settings.weekStart === o" (click)="store.setSetting('weekStart', o)">{{ o }}</button>
                }
              </div>
            </div>
            <div>
              <div class="field-label">Devise</div>
              <div class="seg">
                @for (o of currencyOpts; track o) {
                  <button [class.active]="d().settings.currency === o" (click)="store.setSetting('currency', o)">{{ o }}</button>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Column 2 — Membres du foyer -->
        <div class="card">
          <div class="sec-head">
            <div class="sec-left">
              <div class="sec-ic" style="background:#E5F0F4">
                <f-icon name="users" [size]="18" color="#4E93B8" [width]="2" />
              </div>
              <span class="sec-title">Membres du foyer</span>
            </div>
            <button class="invite" (click)="store.newMember()">
              <f-icon name="plus" [size]="15" color="var(--primary)" [width]="2.6" /> Inviter
            </button>
          </div>

          <div class="field-label">Nom du foyer</div>
          <div class="fam-row">
            <input class="input" [ngModel]="store.ui().famNameField" (ngModelChange)="store.patch({ famNameField: $event })" />
            <button class="btn btn-primary" (click)="store.saveFamily()">Enregistrer</button>
          </div>

          <div class="field-label">Membres ({{ d().members.length }})</div>
          <div class="members">
            @for (m of d().members; track m.id) {
              <div class="member">
                <div class="m-av" [style.background]="m.color">{{ m.ini }}</div>
                <div class="m-body">
                  <div class="m-top">
                    <span class="m-name">{{ m.name }}</span>
                    @if (m.admin) { <span class="badge">Admin</span> }
                  </div>
                  <div class="m-role">{{ m.role }}</div>
                </div>
                <button class="icon-btn sm" (click)="store.editMember(m.id)">
                  <f-icon name="edit" [size]="16" color="var(--ink2)" [width]="2" />
                </button>
                <button class="icon-btn sm" (click)="store.patch({ memberDelId: m.id })">
                  <f-icon name="trash" [size]="16" color="var(--primary)" [width]="2" />
                </button>
              </div>
            }
          </div>
        </div>

        <!-- Column 3 — Apparence + Notifications + Données -->
        <div class="stackcol">
          <div class="card">
            <div class="sec-head">
              <div class="sec-ic" style="background:#F2ECF5">
                <f-icon name="moon" [size]="18" color="#9B6FA8" [width]="2" />
              </div>
              <span class="sec-title">Apparence</span>
            </div>
            <div class="field-label">Thème</div>
            <div class="seg">
              <button class="grow" [class.active]="!d().settings.dark" (click)="store.setThemeMode('light')">Clair</button>
              <button class="grow" [class.active]="d().settings.dark" (click)="store.setThemeMode('dark')">Sombre</button>
            </div>
          </div>

          <div class="card">
            <div class="sec-head">
              <div class="sec-ic" style="background:#FCE9E3">
                <f-icon name="bell" [size]="18" color="var(--primary)" [width]="2" />
              </div>
              <span class="sec-title">Notifications</span>
            </div>
            <div class="prefs">
              @for (p of prefs; track p.key) {
                <div class="pref" (click)="store.setSetting(p.key, !d().settings[p.key])">
                  <div>
                    <div class="pref-label">{{ p.label }}</div>
                    <div class="pref-desc">{{ p.desc }}</div>
                  </div>
                  <div class="sw" [class.on]="d().settings[p.key]"><div class="knob"></div></div>
                </div>
              }
            </div>
          </div>

          <div class="card">
            <div class="sec-head">
              <div class="sec-ic" style="background:#FDF0DA">
                <f-icon name="folder" [size]="18" color="#F0B24B" [width]="2" />
              </div>
              <span class="sec-title">Données &amp; confidentialité</span>
            </div>
            <button class="data-row" (click)="store.exportData()">
              <f-icon name="export" [size]="18" color="var(--ink2)" [width]="2" />
              <span>Exporter mes données</span>
            </button>
            <button class="data-row" (click)="store.resetDemo()">
              <f-icon name="refresh" [size]="18" color="var(--primary)" [width]="2" />
              <span class="danger">Réinitialiser la démo</span>
            </button>
            <div class="version">Foyer · v1.0.0</div>
          </div>

          <button class="btn btn-primary btn-block" (click)="store.logout()">
            <f-icon name="logout" [size]="18" color="#fff" [width]="2.2" /> Se déconnecter
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; align-items: start; }
    :host-context(.shell.narrow) .cols { grid-template-columns: 1fr; }
    @media (max-width: 860px) { .cols { grid-template-columns: 1fr; } }

    .stackcol { display: flex; flex-direction: column; gap: 20px; }

    .sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
    .sec-left { display: flex; align-items: center; gap: 10px; }
    .sec-ic { width: 34px; height: 34px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex: none; }
    .sec-title { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--ink); }
    .sec-head > .sec-ic + .sec-title { margin-left: 10px; }

    .field-label { margin: 0 0 10px; }
    .field-label + .seg, .field-label + .fam-row, .field-label + .members { margin-bottom: 20px; }

    .seg.wrap { flex-wrap: wrap; }
    .seg.stack { flex-direction: column; }
    .seg.stack button { text-align: left; }
    .seg button.grow { flex: 1; }
    .two { display: flex; gap: 24px; flex-wrap: wrap; }
    .two > div { flex: 1; min-width: 120px; }

    .invite { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 800; color: var(--primary); background: none; border: none; cursor: pointer; padding: 0; }

    .fam-row { display: flex; gap: 10px; }
    .fam-row .input { flex: 1; }
    .fam-row .btn { flex: none; }

    .members { display: flex; flex-direction: column; gap: 10px; }
    .member { display: flex; align-items: center; gap: 14px; background: var(--soft); border-radius: 16px; padding: 14px 16px; }
    .m-av { width: 44px; height: 44px; flex: none; border-radius: 50%; color: #fff; font-weight: 800; font-size: 17px; display: flex; align-items: center; justify-content: center; }
    .m-body { flex: 1; min-width: 0; }
    .m-top { display: flex; align-items: center; gap: 8px; }
    .m-name { font-weight: 800; font-size: 15px; color: var(--ink); }
    .m-role { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .badge { background: #FDF0DA; color: #D9930F; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 6px; text-transform: uppercase; letter-spacing: .03em; }

    .prefs { display: flex; flex-direction: column; gap: 10px; }
    .pref { display: flex; align-items: center; justify-content: space-between; padding: 13px 15px; border-radius: 13px; background: var(--soft); cursor: pointer; }
    .pref-label { font-size: 14px; font-weight: 800; color: var(--ink); }
    .pref-desc { font-size: 12px; font-weight: 700; color: var(--ink2); }

    .sw { width: 46px; height: 26px; flex: none; border-radius: 20px; background: var(--line2); position: relative; transition: background .2s; }
    .sw.on { background: var(--primary); }
    .sw .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left .2s; }
    .sw.on .knob { left: 23px; }

    .data-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 13px 15px; border-radius: 13px; background: var(--soft); border: none; cursor: pointer; margin-bottom: 10px; font-size: 14px; font-weight: 800; color: var(--ink); }
    .data-row .danger { color: var(--primary); }
    .version { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; }
  `],
})
export class SettingsScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  langOpts = ['Français', 'English', 'Español', 'Deutsch'];
  tzOpts = ['Europe/Paris (GMT+1)', 'Europe/London (GMT)', 'America/New_York (GMT-5)'];
  dateFmtOpts = ['JJ/MM/AAAA', 'MM/JJ/AAAA', 'AAAA-MM-JJ'];
  weekStartOpts = ['Lundi', 'Dimanche'];
  currencyOpts = ['Euro (€)', 'Dollar ($)', 'Livre (£)'];

  prefs: { key: 'prefNotifs' | 'prefWeekly' | 'prefShared'; label: string; desc: string }[] = [
    { key: 'prefNotifs', label: 'Notifications push', desc: 'Alertes sur cet appareil' },
    { key: 'prefWeekly', label: 'Résumé hebdomadaire', desc: 'Un récapitulatif chaque semaine' },
    { key: 'prefShared', label: 'Partage étendu', desc: 'Visible par tout le foyer' },
  ];

  constructor() {
    this.store.patch({ famNameField: this.d().familyName });
  }
}
