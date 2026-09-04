import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ALL, DEPLOYMENT, SECTIONS, SettingDecl } from '../../core/settings/registry';
import { SettingFieldComponent } from './field';

/**
 * Une section de la page.
 *
 * Les sections de réglages viennent du registre : déclarer une clé la fait
 * apparaître ici, au bon endroit, sans rouvrir ce fichier. Les sections
 * « Membres et accès » et « Exploitation » n'ont pas de réglages : elles
 * portent des gestes (ajouter un membre, lancer une mise à jour, exporter), et
 * sont donc décrites à la main.
 */
interface Section { id: string; label: string; desc: string; icon: string; tint: string; color: string; }

const ICONES: Record<string, { icon: string; tint: string; color: string }> = {
  affichage: { icon: 'settings', tint: '#EDF2EB', color: '#7A9B76' },
  calendriers: { icon: 'calendar', tint: '#E5F0F4', color: '#4E93B8' },
  notifications: { icon: 'bell', tint: '#FCE9E3', color: '#E56B4E' },
  repas: { icon: 'repas', tint: '#FDF0DA', color: '#F0B24B' },
  courses: { icon: 'courses', tint: '#EDF2EB', color: '#7A9B76' },
  taches: { icon: 'taches', tint: '#F2ECF5', color: '#9B6FA8' },
  finances: { icon: 'budget', tint: '#EDF2EB', color: '#5F9E6E' },
  documents: { icon: 'documents', tint: '#FDF0DA', color: '#F0B24B' },
  acces: { icon: 'lock', tint: '#F2ECF5', color: '#9B6FA8' },
  serveur: { icon: 'bolt', tint: '#FDF0DA', color: '#D9930F' },
  membres: { icon: 'users', tint: '#E5F0F4', color: '#4E93B8' },
  exploitation: { icon: 'refresh', tint: '#F2ECF5', color: '#9B6FA8' },
};

/** Les sections sans réglages déclarés, dans l'ordre où elles suivent celles du registre. */
const GESTES: Section[] = [
  { id: 'membres', label: 'Membres et accès', desc: 'Le nom du foyer, ses membres et leurs accès.', ...ICONES['membres'] },
  { id: 'exploitation', label: 'Exploitation', desc: 'Version, mises à jour, export des données, journal des modifications.', ...ICONES['exploitation'] },
  { id: 'serveur', label: 'Serveur et déploiement', desc: 'Ce que la machine impose, en lecture seule.', ...ICONES['serveur'] },
];

@Component({
  selector: 'screen-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, SettingFieldComponent],
  template: `
    <div class="screen-enter">
      <div class="screen-head">
        <div>
          <h1>Paramètres</h1>
          <div class="screen-sub">{{ store.isAdmin() ? 'Les réglages du foyer et vos préférences.' : 'Vos préférences. Les réglages du foyer sont en lecture seule.' }}</div>
        </div>
      </div>

      <!-- La recherche passe avant tout le reste : au-delà d'une trentaine de
           réglages, personne ne se souvient de la section où se trouve le sien. -->
      <div class="find">
        <f-icon name="search" [size]="17" color="var(--ink3)" [width]="2.2" />
        <input class="input" type="search" autocomplete="off" placeholder="Chercher un réglage : vacances, rappel, repas…"
          [ngModel]="q()" (ngModelChange)="q.set($event)" />
        @if (q()) { <button class="clear" aria-label="Effacer la recherche" (click)="q.set('')"><f-icon name="x" [size]="16" color="var(--ink2)" [width]="2.2" /></button> }
      </div>

      @if (cherche()) {
        <div class="found">
          @if (!trouves().length && !sectionsTrouvees().length) {
            <div class="card rien">Aucun réglage ne correspond à « {{ q() }} ». La recherche porte sur les intitulés et sur les descriptions.</div>
          }
          @for (d of trouves(); track d.key) {
            <f-setting [decl]="d" [value]="store.readDeclared(d)" [lock]="store.settingLock(d)" [where]="nomSection(d.section)"
              (change)="store.writeDeclared(d, $event)" />
          }
          @for (s of sectionsTrouvees(); track s.id) {
            <button class="jump" (click)="aller(s.id)">
              <div class="ji" [style.background]="s.tint"><f-icon [name]="s.icon" [size]="17" [color]="s.color" [width]="2" /></div>
              <div><div class="jl">{{ s.label }}</div><div class="jd">{{ s.desc }}</div></div>
            </button>
          }
        </div>
      } @else {
        <div class="layout">
          <!-- Grand écran : la liste des sections reste visible et on n'en affiche
               qu'une. Téléphone : le même état pilote un accordéon. -->
          @if (!store.narrow()) {
            <nav class="side">
              @for (s of sections(); track s.id) {
                <button [class.on]="ouvert() === s.id" (click)="ouvert.set(s.id)">
                  <f-icon [name]="s.icon" [size]="17" [color]="ouvert() === s.id ? 'var(--primary)' : 'var(--ink2)'" [width]="2" />
                  <span>{{ s.label }}</span>
                </button>
              }
            </nav>
          }

          <div class="body">
            @for (s of sections(); track s.id) {
              @if (store.narrow() || ouvert() === s.id) {
                <section class="card" [id]="'section-' + s.id">
                  @if (store.narrow()) {
                    <button class="head" [attr.aria-expanded]="ouvert() === s.id" (click)="basculer(s.id)">
                      <div class="hi" [style.background]="s.tint"><f-icon [name]="s.icon" [size]="18" [color]="s.color" [width]="2" /></div>
                      <div class="ht"><div class="hl">{{ s.label }}</div><div class="hd">{{ s.desc }}</div></div>
                      <f-icon [name]="ouvert() === s.id ? 'chevronDown' : 'chevronRight'" [size]="18" color="var(--ink3)" [width]="2.4" />
                    </button>
                  } @else {
                    <div class="head fixe">
                      <div class="hi" [style.background]="s.tint"><f-icon [name]="s.icon" [size]="18" [color]="s.color" [width]="2" /></div>
                      <div class="ht"><div class="hl">{{ s.label }}</div><div class="hd">{{ s.desc }}</div></div>
                    </div>
                  }

                  @if (!store.narrow() || ouvert() === s.id) {
                    <div class="content">
                      @if (s.id === 'serveur') {
                        <div class="hint" style="margin:0 0 12px">
                          Ces valeurs viennent de la configuration du service, pas de l’application. Pour les changer :
                          éditez <code>/etc/foyer/foyer.env</code> (LXC) ou <code>docker-compose.yml</code> (Docker),
                          puis <code>systemctl restart foyer</code> ou <code>docker compose up -d</code>.
                        </div>
                        <div class="fields">
                          @for (d of DEPLOYMENT; track d.key) {
                            <f-setting [decl]="d" [value]="''" [readonly]="true"
                              [affiche]="serveur()[d.key]?.value || ''" [pose]="!!serveur()[d.key]?.set" />
                          }
                        </div>
                      } @else if (champs(s.id).length) {
                        <div class="fields">
                          @for (d of champs(s.id); track d.key) {
                            <f-setting [decl]="d" [value]="store.readDeclared(d)" [lock]="store.settingLock(d)"
                              (change)="store.writeDeclared(d, $event)" />
                          }
                        </div>
                        @if (modifiable(s.id) && !toutParDefaut(s.id)) {
                          <button class="reset-sec" (click)="resetSection(s.id)">Revenir aux valeurs par défaut de cette section</button>
                        }
                      }

                      @switch (s.id) {
                        @case ('courses') {
                          <!-- L'ordre des rayons et les articles de placard sont des
                               données du foyer, pas des réglages : ils se modifient là
                               où on les voit. Cette page les pointe plutôt que de
                               devenir un second back-office. -->
                          <button class="jump" style="margin-top:16px" (click)="store.go('courses')">
                            <div class="ji" style="background:#EDF2EB"><f-icon name="courses" [size]="17" color="#7A9B76" [width]="2" /></div>
                            <div>
                              <div class="jl">Ordre des rayons et articles de placard</div>
                              <div class="jd">Ils se règlent dans l’écran Courses, où on les voit : ce sont des listes que vous tenez, pas des réglages.</div>
                            </div>
                          </button>
                        }
                        @case ('calendriers') {
                          <div class="extra">
                            <div class="extra-t">Partage du calendrier</div>
            <div class="hint" style="margin-bottom:10px">Abonnez Google Agenda, Apple Calendrier… à ce lien (événements du foyer et échéances de contrat, lecture seule).</div>
            @if (store.icsUrl()) {
              <div class="ics-url">{{ store.icsUrl() }}</div>
              <div class="ics-actions">
                <button class="btn btn-soft grow" (click)="copyIcs()"><f-icon name="copy" [size]="16" [width]="2" /> {{ copied() ? 'Copié !' : 'Copier le lien' }}</button>
                @if (store.isAdmin()) {
                  <button class="btn btn-ghost" (click)="store.regenerateIcs()" title="Invalide l'ancien lien"><f-icon name="refresh" [size]="16" color="var(--primary)" [width]="2" /></button>
                }
              </div>
            } @else {
              <div class="hint">Lien indisponible.</div>
            }
                          </div>
                        }
                        @case ('notifications') {
            <!-- Les rappels sur le téléphone : ce qui marche ici, et ce qui est parti. Le
                 push est muet quand il casse, donc tout ce que le serveur sait est montré. -->
            <div class="push">
              <div class="pref-label">Rappels sur cet appareil</div>
              @switch (store.pushSupport()) {
                @case ('checking') { <div class="pref-desc">Vérification…</div> }
                @case ('unsupported') { <div class="pref-desc">Ce navigateur ne sait pas recevoir de rappels. Sur iPhone, ouvrez Foyer depuis l’icône de l’écran d’accueil.</div> }
                @case ('install') {
                  <div class="pref-desc">Sur iPhone, les rappels n’arrivent qu’à une application installée : dans Safari, touchez <b>Partager</b>, puis <b>Sur l’écran d’accueil</b>, et ouvrez Foyer depuis cette icône pour activer les rappels ici.</div>
                }
                @case ('denied') { <div class="pref-desc">Les notifications sont bloquées pour Foyer dans les réglages de cet appareil. Autorisez-les, puis revenez ici.</div> }
                @case ('off') {
                  <div class="pref-desc">Les rappels d’échéance et les tâches qu’on vous affecte arriveront ici, même l’application fermée.</div>
                  <button class="btn btn-primary push-btn" [disabled]="store.pushBusy()" (click)="store.enablePush()"><f-icon name="bell" [size]="16" color="#fff" [width]="2.2" /> Activer les rappels sur cet appareil</button>
                }
                @case ('on') {
                  <div class="pref-desc ok">Activés sur cet appareil.</div>
                  <div class="push-acts">
                    <button class="btn btn-soft grow" [disabled]="store.pushBusy()" (click)="store.testPush()">Envoyer un test</button>
                    <button class="btn btn-ghost" [disabled]="store.pushBusy()" (click)="store.disablePush()">Désactiver ici</button>
                  </div>
                }
              }

              @if (store.pushStatus(); as ps) {
                @if (ps.devices.length) {
                  <div class="push-sub">Mes appareils</div>
                  @for (dv of ps.devices; track dv.id) {
                    <div class="push-dev">
                      <div class="push-dev-body">
                        <div class="push-dev-ua">{{ deviceName(dv.ua) }}</div>
                        <div class="push-dev-meta">
                          @if (dv.lastError) { <span class="ko">{{ dv.lastError }}</span> }
                          @else if (dv.lastOkAt) { dernier envoi accepté le {{ store.fmtNumDate(dv.lastOkAt.slice(0, 10)) }} }
                          @else { abonné le {{ store.fmtNumDate(dv.createdAt.slice(0, 10)) }}, rien d’envoyé encore }
                        </div>
                      </div>
                      <button class="icon-btn sm" (click)="store.removePushDevice(dv.id)" aria-label="Retirer cet appareil"><f-icon name="x" [size]="15" color="var(--ink2)" [width]="2.2" /></button>
                    </div>
                  }
                }
                <div class="push-sub">Qui reçoit les rappels</div>
                <div class="pref-desc">{{ subscribedNames(ps.subscribed) }}</div>
                @if (ps.sends.length) {
                  <div class="push-sub">Derniers envois</div>
                  @for (s of ps.sends.slice(0, 8); track s.key + s.memberId) {
                    <div class="push-send" [class.ko]="s.status === 'failed' || s.status === 'missed'">
                      <span class="push-send-t">{{ s.title }}</span>
                      <span class="push-send-m">{{ kindLabel(s.kind) }} · {{ store.memberName(s.memberId) || s.memberId }} · {{ sendLabel(s.status) }}{{ s.error ? ' : ' + s.error : '' }}</span>
                    </div>
                  }
                }
              }
            </div>
                        }
                        @case ('membres') {
            <div class="field-label">Nom du foyer</div>
            @if (store.isAdmin()) {
              <div class="fam-row">
                <input class="input" [ngModel]="store.ui().famNameField" (ngModelChange)="store.patch({ famNameField: $event })" />
                <button class="btn btn-primary" (click)="store.saveFamily()">Enregistrer</button>
              </div>
            } @else {
              <div class="input readonly">{{ d().familyName }}</div>
            }

            <div class="mh">
              <div class="field-label" style="margin:0">Membres ({{ d().members.length }})</div>
              @if (store.isAdmin()) {
                <button class="invite" (click)="store.newMember()">
                  <f-icon name="plus" [size]="15" color="var(--primary)" [width]="2.6" /> Ajouter
                </button>
              }
            </div>
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
                  @if (store.isAdmin()) {
                    <button class="icon-btn sm" (click)="store.editMember(m.id)">
                      <f-icon name="edit" [size]="16" color="var(--ink2)" [width]="2" />
                    </button>
                    <button class="icon-btn sm" (click)="store.patch({ memberDelId: m.id })">
                      <f-icon name="trash" [size]="16" color="var(--primary)" [width]="2" />
                    </button>
                  }
                </div>
              }
            </div>
                        }
                        @case ('exploitation') {
                          <div class="extra-t">Mises à jour</div>
            @if (store.updating()) {
              <div class="upd-badge new"><f-icon name="refresh" [size]="13" color="#D9930F" [width]="3" /> Mise à jour en cours…</div>
              <div class="upd-cur" style="margin-top:8px">{{ store.updateMsg() || 'Veuillez patienter…' }}</div>
              <div class="upd-progress"><span class="upd-bar"></span></div>
              <div class="hint" style="margin-top:8px">Ne fermez pas cette page ; elle se rechargera automatiquement à la fin.</div>
            } @else {
              @let u = store.updateInfo();
              @if (u?.updateAvailable) {
                <div class="upd-badge new">Nouvelle version {{ u!.latestTag }} disponible</div>
                @if (u!.name && u!.name !== u!.latestTag) { <div class="hint" style="margin-top:6px">{{ u!.name }}</div> }
                <div class="upd-cur">Version installée : {{ u!.current }}</div>
                @if (u!.url) { <a class="upd-link" [href]="u!.url" target="_blank" rel="noopener">Voir les notes de version ↗</a> }
                @if (!u!.selfUpdate) {
                  <div class="hint" style="margin-top:10px">Auto-MAJ désactivée. Sur le serveur : <code>bash deploy/lxc/update.sh</code> (ou réinstallez avec <code>SELF_UPDATE=true</code>).</div>
                } @else if (!store.isAdmin()) {
                  <div class="hint" style="margin-top:10px">Seul un administrateur peut lancer la mise à jour.</div>
                }
              } @else if (u && !u.error) {
                <div class="upd-badge ok"><f-icon name="check" [size]="14" color="#5F7E5C" [width]="3" /> À jour ({{ u.current }})</div>
              } @else if (u?.error) {
                <div class="upd-cur">Version installée : {{ u!.current }}</div>
                <div class="hint" style="margin-top:6px">{{ u!.error }}</div>
              } @else {
                <div class="hint">Vérifiez la présence d'une nouvelle version sur GitHub.</div>
              }
              @if (store.updateMsg()) { <div class="upd-failed">{{ store.updateMsg() }}</div> }
              <div class="upd-actions">
                <button class="btn btn-soft grow" [disabled]="store.updateChecking()" (click)="store.checkUpdates()">
                  {{ store.updateChecking() ? 'Vérification…' : 'Vérifier les mises à jour' }}
                </button>
                @if (u?.updateAvailable && u!.selfUpdate && store.isAdmin()) {
                  <button class="btn btn-primary grow" (click)="doUpdate()">Mettre à jour maintenant</button>
                }
              </div>
            }

                          <div class="extra-t">Configuration</div>
                          <div class="hint" style="margin:0 0 10px">Vos réglages seuls, dans un fichier lisible. À exporter avant de toucher à quoi que ce soit, et à réimporter après une réinstallation pour ne pas tout reparamétrer de mémoire. Ce n’est pas une sauvegarde des données du foyer.</div>
                          <button class="data-row" [disabled]="store.configBusy()" (click)="store.exportSettings()">
                            <f-icon name="export" [size]="18" color="var(--ink2)" [width]="2" />
                            <span>Exporter la configuration</span>
                          </button>
                          @if (store.isAdmin()) {
                            <button class="data-row" [disabled]="store.configBusy()" (click)="fichier.click()">
                              <f-icon name="upload" [size]="18" color="var(--ink2)" [width]="2" />
                              <span>{{ store.configBusy() ? 'Lecture du fichier…' : 'Importer une configuration' }}</span>
                            </button>
                            <input #fichier type="file" accept="application/json,.json" hidden (change)="importer($event)" />
                          }
                          @if (store.configReport(); as r) {
                            <div class="rapport">
                              <div class="rap-t">Configuration exportée {{ quand(r.generatedAt.replace('T', ' ')) }}{{ r.household ? ', foyer « ' + r.household + ' »' : '' }}</div>
                              @if (r.applied.length) {
                                <div class="rap-l">{{ r.applied.length }} réglage(s) rétabli(s) : {{ r.applied.join(', ') }}</div>
                              } @else {
                                <div class="rap-l">Aucun réglage à rétablir : tout était déjà en place.</div>
                              }
                              @for (e of r.ecartes; track e.key + (e.member || '')) {
                                <div class="rap-ko">{{ e.key }}{{ e.member ? ' (' + e.member + ')' : '' }} : {{ e.reason }}</div>
                              }
                            </div>
                          }

                          <div class="extra-t">Données</div>
                          <button class="data-row" (click)="store.exportData()">
                            <f-icon name="export" [size]="18" color="var(--ink2)" [width]="2" />
                            <span>Exporter le document du foyer</span>
                          </button>
                          <div class="hint">Le document JSON du foyer : membres, agenda, tâches, courses, repas, recettes, contacts. Il n’emporte ni les finances (tables séparées) ni les fichiers et photos (sur le disque) : pour tout garder, archivez le dossier de données du serveur.</div>
                          <div class="version">Foyer{{ store.version() ? ' ' + store.version() : '' }}</div>

                          <div class="extra-t">Dernières modifications de réglages</div>
                          @let journal = store.settingsInfo()?.log || [];
                          @if (!journal.length) {
                            <div class="hint">Aucun réglage n’a encore été modifié depuis cette installation.</div>
                          } @else {
                            @for (l of journal.slice(0, 20); track l.id) {
                              <div class="log">
                                <span class="log-k">{{ l.label }}</span>
                                <span class="log-m">{{ quand(l.at) }} · {{ store.memberName(l.memberId || '') || 'compte sans membre' }} · {{ affiche(l.before) }} → {{ affiche(l.after) }}</span>
                              </div>
                            }
                          }

                          <button class="btn btn-primary btn-block" style="margin-top:18px" (click)="store.logout()">
                            <f-icon name="logout" [size]="18" color="#fff" [width]="2.2" /> Se déconnecter
                          </button>
                        }
                      }
                    </div>
                  }
                </section>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .find { display: flex; align-items: center; gap: 9px; background: var(--surface); border: 2px solid var(--line); border-radius: var(--r-input); padding: 0 13px; margin-bottom: 20px; }
    .find .input { border: none; background: none; padding: 13px 0; flex: 1; min-width: 0; }
    .find .input:focus { border: none; outline: none; }
    .find .clear { border: none; background: none; cursor: pointer; padding: 4px; display: flex; }

    .found { display: flex; flex-direction: column; gap: 12px; }
    .rien { font-size: 13px; font-weight: 700; color: var(--ink2); line-height: 1.55; }
    .jump { display: flex; align-items: center; gap: 12px; text-align: left; width: 100%; background: var(--surface); border: 2px solid var(--line); border-radius: 16px; padding: 13px 15px; cursor: pointer; }
    .ji { width: 34px; height: 34px; border-radius: 11px; display: flex; align-items: center; justify-content: center; flex: none; }
    .jl { font-size: 14px; font-weight: 800; color: var(--ink); }
    .jd { font-size: 12px; font-weight: 700; color: var(--ink2); }

    .layout { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 20px; align-items: start; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
    :host-context(.shell.narrow) .layout { grid-template-columns: 1fr; }

    .side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 4px; }
    .side button { display: flex; align-items: center; gap: 11px; text-align: left; border: none; background: none; cursor: pointer; padding: 11px 13px; border-radius: 12px; font-size: 14px; font-weight: 800; color: var(--ink2); }
    .side button.on { background: var(--soft); color: var(--primary); }

    .body { display: flex; flex-direction: column; gap: 16px; }
    .head { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; border: none; background: none; padding: 0; cursor: pointer; }
    .head.fixe { cursor: default; }
    .hi { width: 36px; height: 36px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex: none; }
    .ht { flex: 1; min-width: 0; }
    .hl { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--ink); }
    .hd { font-size: 12px; font-weight: 700; color: var(--ink2); line-height: 1.45; }

    .content { margin-top: 16px; }
    .fields { display: flex; flex-direction: column; gap: 10px; }
    .reset-sec { margin-top: 12px; border: none; background: none; padding: 0; cursor: pointer; font-size: 12px; font-weight: 800; color: var(--primary); }

    .extra { margin-top: 4px; }
    .extra-t { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .06em; margin: 22px 0 10px; }
    .content > .fields + .extra-t, .content > .fields + .extra { margin-top: 22px; }

    .log { display: flex; flex-direction: column; padding: 6px 0; border-bottom: 1px solid var(--line); }
    .log:last-of-type { border-bottom: none; }
    .log-k { font-size: 13px; font-weight: 800; color: var(--ink); }
    .log-m { font-size: 11.5px; font-weight: 700; color: var(--ink3); line-height: 1.45; }

    .rapport { background: var(--soft); border-radius: 13px; padding: 12px 14px; margin-bottom: 10px; }
    .rap-t { font-size: 12px; font-weight: 800; color: var(--ink); margin-bottom: 5px; }
    .rap-l { font-size: 12px; font-weight: 700; color: var(--ink2); line-height: 1.5; }
    .rap-ko { font-size: 11.5px; font-weight: 700; color: #C6492F; line-height: 1.5; margin-top: 3px; }
    .data-row:disabled { opacity: .6; cursor: not-allowed; }

    .field-label { margin: 0 0 10px; }
    .field-label + .seg, .field-label + .fam-row, .field-label + .members { margin-bottom: 20px; }
    .invite { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 800; color: var(--primary); background: none; border: none; cursor: pointer; padding: 0; }
    .fam-row { display: flex; gap: 10px; }
    .fam-row .input { flex: 1; }
    .fam-row .btn { flex: none; }
    .field-label + .input.readonly { margin-bottom: 20px; }
    .input.readonly { display: flex; align-items: center; color: var(--ink2); font-weight: 700; background: var(--soft); }
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
    .data-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 13px 15px; border-radius: 13px; background: var(--soft); border: none; cursor: pointer; margin-bottom: 10px; font-size: 14px; font-weight: 800; color: var(--ink); }
    .data-row .danger { color: var(--primary); }
    .version { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; }
    .hint { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 6px; line-height: 1.5; }
    .hint + .field-label { margin-top: 16px; }
    .ics-url { font-size: 11.5px; font-weight: 700; color: var(--ink2); background: var(--soft); border-radius: 11px; padding: 11px 13px; word-break: break-all; margin-bottom: 10px; }
    .ics-actions { display: flex; gap: 8px; }
    .ics-actions .grow { flex: 1; }
    .upd-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 800; padding: 6px 12px; border-radius: 20px; }
    .upd-badge.ok { background: #EDF2EB; color: #5F7E5C; }
    .upd-badge.new { background: #FDF0DA; color: #D9930F; }
    .upd-cur { font-size: 12px; font-weight: 700; color: var(--ink2); margin-top: 8px; }
    .upd-link { display: inline-block; margin-top: 6px; font-size: 12.5px; font-weight: 800; color: var(--primary); }
    .upd-failed { margin-top: 10px; font-size: 12.5px; font-weight: 700; color: #B8860B; line-height: 1.4; }
    .upd-actions { display: flex; gap: 8px; margin-top: 12px; }
    .upd-actions .grow { flex: 1; }
    @media (max-width: 420px) { .upd-actions { flex-direction: column; } }
    .upd-progress { margin-top: 10px; height: 6px; border-radius: 20px; background: var(--soft2); overflow: hidden; }
    .upd-bar { display: block; height: 100%; width: 40%; border-radius: 20px; background: var(--primary); animation: upd-slide 1.2s ease-in-out infinite; }
    @keyframes upd-slide { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
    code { background: var(--soft2); padding: 1px 6px; border-radius: 6px; font-size: 11px; }
    .push { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
    .push .pref-desc.ok { color: #6E9E5F; }
    .push-btn { display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; }
    .push-acts { display: flex; gap: 8px; margin-top: 10px; }
    .push-acts .grow { flex: 1; }
    .push-sub { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .06em; margin: 14px 0 6px; }
    .push-dev { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    .push-dev-body { flex: 1; min-width: 0; }
    .push-dev-ua { font-size: 13px; font-weight: 800; color: var(--ink); }
    .push-dev-meta { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .ko { color: #C6492F; }
    .push-send { display: flex; flex-direction: column; padding: 4px 0; }
    .push-send-t { font-size: 12.5px; font-weight: 800; color: var(--ink); }
    .push-send-m { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .push-send.ko .push-send-m { color: #C6492F; }
  `],
})
export class SettingsScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;
  copied = signal(false);

  readonly DEPLOYMENT = DEPLOYMENT;
  readonly q = signal('');

  /** Les réglages du serveur, indexés par clé, tels que le serveur les applique. */
  readonly serveur = computed<Record<string, { value: string; set: boolean }>>(() =>
    Object.fromEntries((this.store.settingsInfo()?.deployment || []).map((d) => [d.key, d])));
  readonly ouvert = signal(SECTIONS[0]?.id || 'membres');

  /** Les sections du registre qui portent au moins un réglage, puis celles de gestes. */
  readonly sections = computed<Section[]>(() => [
    ...SECTIONS.filter((s) => s.id !== 'serveur' && ALL.some((d) => d.section === s.id))
      .map((s) => ({ id: s.id, label: s.label, desc: s.desc, ...(ICONES[s.id] || ICONES['affichage']) })),
    ...GESTES,
  ]);

  readonly cherche = computed(() => this.q().trim().length >= 2);

  /**
   * La recherche porte sur l'intitulé **et** sur la description : c'est la
   * description qui contient « vacances scolaires » ou « rayon », donc le mot
   * qu'on a en tête quand on ne sait plus comment le réglage s'appelle.
   */
  readonly trouves = computed<SettingDecl[]>(() => {
    const m = norm(this.q());
    return m ? ALL.filter((d) => d.scope !== 'deploiement'
      && norm(d.label + ' ' + d.desc + ' ' + d.module + ' ' + this.nomSection(d.section)).includes(m)) : [];
  });

  readonly sectionsTrouvees = computed<Section[]>(() => {
    const m = norm(this.q());
    return m ? this.sections().filter((s) => norm(s.label + ' ' + s.desc).includes(m)) : [];
  });

  constructor() {
    this.store.patch({ famNameField: this.d().familyName });
    this.store.loadIcs();
    this.store.checkUpdates();
    void this.store.loadSettingsInfo();
  }

  champs(section: string): SettingDecl[] { return ALL.filter((d) => d.section === section && d.scope !== 'deploiement'); }
  nomSection(id: string): string { return SECTIONS.find((s) => s.id === id)?.label || id; }
  basculer(id: string): void { this.ouvert.set(this.ouvert() === id ? '' : id); }
  aller(id: string): void { this.q.set(''); this.ouvert.set(id); }

  /** Au moins un réglage de la section est modifiable par la personne connectée. */
  modifiable(section: string): boolean { return this.champs(section).some((d) => !this.store.settingLock(d)); }
  toutParDefaut(section: string): boolean {
    return this.champs(section).every((d) => this.store.readDeclared(d) === d.default);
  }
  resetSection(section: string): void {
    for (const d of this.champs(section)) {
      if (!this.store.settingLock(d) && this.store.readDeclared(d) !== d.default) this.store.writeDeclared(d, d.default);
    }
  }

  /** « activé », « Rennes (zone B) », « 21 » : ce que la personne a vu à l'écran. */
  affiche(v: boolean | number | string | null): string {
    if (v === null) return 'rien';
    if (typeof v === 'boolean') return v ? 'activé' : 'désactivé';
    return v === '' ? 'aucune' : String(v);
  }

  /** Le fichier choisi part au serveur, et l'input se vide pour qu'on puisse rejouer le même. */
  importer(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void this.store.importSettings(f);
    input.value = '';
  }

  /** « le 04/09 à 16:53 ». La date complète n'apporte rien dans un journal court. */
  quand(iso: string): string {
    const [j, h] = (iso || '').replace('T', ' ').split(' ');
    const [, mo, jour] = (j || '').split('-');
    return jour ? `le ${jour}/${mo} à ${(h || '').slice(0, 5)}` : iso;
  }

  doUpdate(): void {
    if (confirm('Lancer la mise à jour de Foyer ? Le service va se recompiler et redémarrer (environ 1–2 min).')) {
      this.store.applyUpdate();
    }
  }

  /** « iPhone », « iPad », « Chrome sur Android », « Safari sur Mac » : lisible, pas l'agent complet. */
  deviceName(ua: string): string {
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return 'iPad';
    const nav = /Firefox/.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Navigateur';
    const os = /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? nav + ' sur ' + os : nav;
  }
  subscribedNames(ids: string[]): string {
    const names = ids.map((id) => this.store.memberName(id)).filter(Boolean);
    return names.length ? names.join(', ') : 'Personne n’a encore activé les rappels sur un appareil.';
  }
  kindLabel(k: string): string { return k === 'reminder' ? 'rappel' : k === 'assigned' ? 'affectation' : k === 'test' ? 'test' : k; }
  sendLabel(s: string): string {
    return s === 'sent' ? 'envoyé' : s === 'no-device' ? 'aucun appareil' : s === 'failed' ? 'échec' : s === 'missed' ? 'manqué (service arrêté)' : s;
  }

  async copyIcs(): Promise<void> {
    try { await navigator.clipboard.writeText(this.store.icsUrl()); this.copied.set(true); setTimeout(() => this.copied.set(false), 1800); }
    catch { this.store.toast('Copie impossible — sélectionnez le lien manuellement'); }
  }
}

/** Minuscules sans accents : « Académie » se trouve en tapant « academie ». */
function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
