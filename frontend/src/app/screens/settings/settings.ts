import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DashboardStore } from '../../core/dashboard.store';
import { ApiService } from '../../core/api.service';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { PALETTE } from '../../core/constants';
import { contactIni } from '../../core/helpers';
import { ALL, DEPLOYMENT, GROUPS, SECTIONS, SettingDecl, declOf } from '../../core/settings/registry';
import { manualOrder } from '../../core/home-context';
import { TILE_PROVIDERS } from '../../core/tiles/registry';
import { AvatarComponent } from '../../shared/avatar';
import { SettingFieldComponent } from './field';

/**
 * Une section de la page, et le groupe où elle tombe.
 *
 * Tout vient du registre : l'ordre, les groupes, les intitulés, et les réglages
 * de chaque section. Déclarer une clé la fait apparaître ici, au bon endroit,
 * sans rouvrir ce fichier. Il ne reste à ce fichier que l'icône, et le contenu
 * des sections qui portent des **gestes** plutôt que des réglages.
 */
interface Section { id: string; group: string; label: string; desc: string; icon: string; tint: string; color: string; }
interface Groupe { id: string; label: string; desc: string; sections: Section[]; }

const ICONES: Record<string, { icon: string; tint: string; color: string }> = {
  compte: { icon: 'key', tint: '#FCE9E3', color: '#E56B4E' },
  accueil: { icon: 'home', tint: '#FCE9E3', color: '#E56B4E' },
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

/**
 * Les sections qui s'affichent même sans porter le moindre réglage, parce
 * qu'elles portent des gestes : changer son mot de passe, ajouter un membre.
 * Ailleurs, une section vide est une section qu'on ne montre pas.
 */
const GESTES = new Set(['compte', 'membres']);

@Component({
  selector: 'screen-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AvatarComponent, IconComponent, SettingFieldComponent],
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
              @for (g of groupes(); track g.id) {
                @if (!$first) { <hr class="sep" /> }
                <div class="gt">{{ g.label }}</div>
                @for (s of g.sections; track s.id) {
                  <button [class.on]="ouvert() === s.id" (click)="aller(s.id)">
                    <f-icon [name]="s.icon" [size]="17" [color]="ouvert() === s.id ? 'var(--primary)' : 'var(--ink2)'" [width]="2" />
                    <span>{{ s.label }}</span>
                  </button>
                }
              }
            </nav>
          }

          <div class="body">
            @for (g of groupes(); track g.id) {
            <!-- Le trait sépare les quatre grands ensembles déclarés dans le
                 registre : soi, le foyer, les modules, la machine. Sur grand
                 écran, une seule section est dépliée et c'est la barre latérale
                 qui porte ce découpage : un titre de groupe seul n'y aurait
                 rien à annoncer. -->
            @if (store.narrow()) {
              @if (!$first) { <hr class="sep" /> }
              <div class="groupe"><div class="gl">{{ g.label }}</div><div class="gd">{{ g.desc }}</div></div>
            }
            @for (s of g.sections; track s.id) {
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
                        @case ('compte') {
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

                          <button class="btn btn-soft btn-block" style="margin-top:22px" (click)="store.logout()">
                            <f-icon name="logout" [size]="18" color="var(--ink2)" [width]="2.2" /> Se déconnecter
                          </button>
                        }
                        @case ('accueil') {
                          <div class="hint" style="margin:0 0 12px">
                            @if (ordreManuel()) {
                              Vos tuiles restent dans cet ordre, dépliées, quelles que soient l’heure et le jour.
                              Les règles de contexte (<code>accueil.json</code>) ne les reclassent plus.
                            } @else {
                              L’accueil remonte pour l’instant ce qui compte selon l’heure et le jour, et replie le reste
                              sur son titre. Déplacez une tuile pour figer l’ordre : le vôtre l’emportera, et plus rien ne se repliera.
                            }
                          </div>
                          <div class="tuiles">
                            @for (t of tuiles(); track t.id; let i = $index) {
                              <div class="tuile">
                                <span class="rang">{{ i + 1 }}</span>
                                <span class="tn">{{ t.title }}</span>
                                <button class="icon-btn sm" [disabled]="!!verrou() || i === 0" (click)="deplacer(i, -1)" aria-label="Monter cette tuile">
                                  <f-icon name="arrowUp" [size]="16" color="var(--ink2)" [width]="2.2" />
                                </button>
                                <button class="icon-btn sm" [disabled]="!!verrou() || i === tuiles().length - 1" (click)="deplacer(i, 1)" aria-label="Descendre cette tuile">
                                  <f-icon name="arrowDown" [size]="16" color="var(--ink2)" [width]="2.2" />
                                </button>
                              </div>
                            }
                          </div>
                          @if (verrou()) {
                            <div class="hint">{{ verrou() }}</div>
                          } @else if (ordreManuel()) {
                            <button class="reset-sec" (click)="ordreAutomatique()">Revenir à l’ordre automatique</button>
                          }
                        }
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
            @if (!store.isAdmin()) {
              <div class="hint">Ce lien vaut accès au calendrier du foyer sans mot de passe : seul un administrateur peut le voir. Demandez-lui de vous le transmettre.</div>
            } @else if (store.icsUrl()) {
              <div class="ics-url">{{ store.icsUrl() }}</div>
              <div class="ics-actions">
                <button class="btn btn-soft grow" (click)="copyIcs()"><f-icon name="copy" [size]="16" [width]="2" /> {{ copied() ? 'Copié !' : 'Copier le lien' }}</button>
                <button class="btn btn-ghost" (click)="store.regenerateIcs()" title="Invalide l'ancien lien"><f-icon name="refresh" [size]="16" color="var(--primary)" [width]="2" /></button>
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
                    <div class="push-send" [class.ko]="s.status === 'failed' || s.status === 'missed'" [class.partiel]="s.status === 'partial'">
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
                          <div class="extra-t">État du service</div>
                          @if (store.systemStatus(); as st) {
                            <div class="etat">
                              <div><span>Version</span><b>{{ st.version }}</b></div>
                              <div><span>En service depuis</span><b>{{ duree(st.uptime) }}</b></div>
                              <div><span>Node</span><b>{{ st.nodeVersion }}</b></div>
                              <div><span>Dossier des données</span><b class="chemin">{{ st.dataDir }}</b></div>
                              <div><span>Base de données</span><b>{{ poids(st.dbBytes) }}</b></div>
                              <div><span>Dossier complet</span><b>{{ poids(st.dataBytes) }}</b></div>
                              @if (st.disk; as d) {
                                <div [class.alerte]="d.free < d.total * 0.1">
                                  <span>Espace disque restant</span>
                                  <b>{{ poids(d.free) }} sur {{ poids(d.total) }}</b>
                                </div>
                              } @else {
                                <div><span>Espace disque restant</span><b>inconnu sur cette plateforme</b></div>
                              }
                              <div><span>Contenu</span><b>{{ st.counts.members }} membres · {{ st.counts.events }} événements · {{ st.counts.tasks }} tâches · {{ st.counts.recipes }} recettes · {{ st.counts.files }} documents</b></div>
                              <!-- Un refus d'Apple se présente comme « HTTP 403 » à côté d'un
                                   appareil, sans dire que c'est ce contact qui ne convient pas. -->
                              <div><span>Contact déclaré aux services push</span><b class="chemin">{{ st.pushSubject }}</b></div>
                            </div>
                          } @else {
                            <div class="hint">État du service indisponible.</div>
                          }

                          <div class="extra-t">Sauvegardes de la base</div>
                          <div class="hint" style="margin:0 0 10px">
                            Un instantané cohérent pris <b>sans arrêter le service</b> (la base est en WAL : copier
                            le fichier à chaud donnerait une archive corrompue). Il emporte tout ce qui est en base,
                            finances comprises, mais <b>ni les fichiers ni les photos</b>, qui vivent à côté sur le
                            disque. Pour une archive vraiment complète :
                            <code>tar czf foyer.tar.gz -C {{ dossierParent() }} {{ dossierNom() }}</code>, service arrêté.
                          </div>
                          @if (store.isAdmin()) {
                            <button class="data-row" [disabled]="store.backupBusy()" (click)="store.makeBackup()">
                              <f-icon name="folder" [size]="18" color="var(--ink2)" [width]="2" />
                              <span>{{ store.backupBusy() ? 'Sauvegarde en cours…' : 'Sauvegarder maintenant' }}</span>
                            </button>
                          }
                          @for (b of store.systemStatus()?.snapshots || []; track b.name) {
                            <div class="sauv">
                              <div class="sauv-b">
                                <div class="sauv-n">{{ b.name }}</div>
                                <div class="sauv-m">{{ quand(b.at.replace('T', ' ')) }} · {{ poids(b.bytes) }}</div>
                              </div>
                              <button class="icon-btn sm" title="Télécharger" (click)="store.downloadBackup(b.name)">
                                <f-icon name="download" [size]="16" color="var(--ink2)" [width]="2" />
                              </button>
                              <button class="icon-btn sm" title="Effacer" (click)="store.deleteBackup(b.name)">
                                <f-icon name="trash" [size]="16" color="var(--primary)" [width]="2" />
                              </button>
                            </div>
                          } @empty {
                            <div class="hint">Aucune sauvegarde pour le moment.</div>
                          }
                          <div class="hint" style="margin-top:10px">
                            <b>Restaurer</b> ne se fait pas depuis l’application : remplacer la base pendant que le
                            service l’utilise la corromprait. Service arrêté :
                            <code>systemctl stop foyer &amp;&amp; cp sauvegardes/foyer-….db foyer.db &amp;&amp; rm -f foyer.db-wal foyer.db-shm &amp;&amp; systemctl start foyer</code>
                          </div>

                          <div class="extra-t">Mises à jour</div>
            @if (store.updating()) {
              <div class="upd-badge new"><f-icon name="refresh" [size]="13" color="#D9930F" [width]="3" /> Mise à jour en cours…</div>
              <div class="upd-cur" style="margin-top:8px">{{ store.updateMsg() || 'Veuillez patienter…' }}</div>
              <div class="upd-progress"><span class="upd-bar"></span></div>
              <div class="hint" style="margin-top:8px">Ne fermez pas cette page ; elle se rechargera automatiquement à la fin.</div>
            } @else {
              <!-- Le canal se règle ici et non parmi les champs engendrés de la
                   section : il décide de ce que le bouton juste dessous va
                   chercher, et un réglage se comprend à côté de son effet. -->
              @if (canalDecl; as d) {
                <div class="fields" style="margin-bottom:14px">
                  <f-setting [decl]="d" [value]="store.readDeclared(d)" [lock]="store.settingLock(d)"
                    (change)="changerCanal(d, $event)" />
                </div>
              }
              @let u = store.updateInfo();
              @if (u?.updateAvailable) {
                <div class="upd-badge new">Nouvelle version {{ u!.latestTag }} disponible{{ u!.prerelease ? ' (préversion)' : '' }}</div>
                @if (u!.name && u!.name !== u!.latestTag) { <div class="hint" style="margin-top:6px">{{ u!.name }}</div> }
                <div class="upd-cur">Version installée : {{ u!.current }}</div>
                @if (u!.url) { <a class="upd-link" [href]="u!.url" target="_blank" rel="noopener">Voir les notes de version ↗</a> }
                @if (!u!.selfUpdate) {
                  <div class="hint" style="margin-top:10px">
                    @if (u!.selfUpdateReason === 'coupee') {
                      Mise à jour depuis l’interface refusée sur ce serveur (<code>FOYER_SELF_UPDATE</code>).
                      Sur la machine : <code>bash deploy/lxc/update.sh</code>.
                    } @else {
                      Ce serveur n’a pas le dispositif de mise à jour en un clic.
                      En LXC : <code>bash deploy/lxc/update.sh</code>.
                      En Docker : <code>docker compose pull &amp;&amp; docker compose up -d</code>.
                    }
                  </div>
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

                        }
                      }
                    </div>
                  }
                </section>
              }
            }
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .sep { border: none; border-top: 2px solid var(--line); margin: 22px 0 0; }
    .groupe { margin: 18px 0 2px; }
    .gl { font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--ink); }
    .gd { font-size: 12px; font-weight: 700; color: var(--ink3); line-height: 1.45; }
    .side .sep { margin: 12px 0 4px; }
    .gt { font-size: 11px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .06em; padding: 6px 13px 4px; }

    .tuiles { display: flex; flex-direction: column; gap: 8px; }
    .tuile { display: flex; align-items: center; gap: 10px; background: var(--soft); border-radius: 13px; padding: 9px 12px; }
    .rang { font-size: 12px; font-weight: 800; color: var(--ink3); width: 18px; flex: none; }
    .tn { flex: 1; min-width: 0; font-size: 14px; font-weight: 800; color: var(--ink); }
    /* Deux flèches qu'on utilise à répétition : 34 px se rate au pouce. */
    .tuile .icon-btn { width: 40px; height: 40px; }
    .tuile .icon-btn:disabled { opacity: .3; cursor: not-allowed; }

    .moi { display: flex; align-items: center; gap: 14px; background: var(--soft); border-radius: 16px; padding: 14px 16px; margin-bottom: 18px; }
    .moi-b { min-width: 0; }
    .moi-n { font-size: 16px; font-weight: 800; color: var(--ink); }
    .moi-m { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .input.court { max-width: 120px; text-transform: uppercase; }

    .totp-on { display: flex; align-items: center; gap: 9px; background: #EDF2EB; border-radius: 12px; padding: 12px 14px; font-size: 13.5px; font-weight: 700; color: #4A6247; margin-bottom: 12px; }
    .hint.alerte { color: var(--primary); font-weight: 800; }
    .secret-b { background: var(--soft); border-radius: 14px; padding: 14px; margin: 12px 0; }
    .secret-t { font-size: 12px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
    .secret { display: block; font-size: 17px; font-weight: 800; letter-spacing: 2px; word-break: break-all; color: var(--ink); }
    .secours { background: #FDF0DA; border-radius: 14px; padding: 14px; margin: 12px 0; }
    .secours-t { font-size: 13px; font-weight: 800; color: #8A6520; margin-bottom: 10px; }
    .secours-l { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; }
    .secours-l code { font-size: 14px; font-weight: 800; letter-spacing: 1px; color: var(--ink); }
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

    .etat { background: var(--soft); border-radius: 13px; padding: 4px 14px; margin-bottom: 10px; }
    .etat > div { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; padding: 7px 0; border-bottom: 1px solid var(--line); }
    .etat > div:last-child { border-bottom: none; }
    .etat span { font-size: 12px; font-weight: 700; color: var(--ink2); flex: none; }
    .etat b { font-size: 12.5px; font-weight: 800; color: var(--ink); text-align: right; min-width: 0; }
    .etat b.chemin { word-break: break-all; font-family: ui-monospace, monospace; font-size: 11.5px; }
    .etat > div.alerte b { color: #C6492F; }

    .sauv { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--line); }
    .sauv:last-of-type { border-bottom: none; }
    .sauv-b { flex: 1; min-width: 0; }
    .sauv-n { font-size: 12.5px; font-weight: 800; color: var(--ink); font-family: ui-monospace, monospace; word-break: break-all; }
    .sauv-m { font-size: 11.5px; font-weight: 700; color: var(--ink3); }

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
    /* Un envoi partiel n'est ni une réussite ni une panne : il se signale sans crier. */
    .push-send.partiel .push-send-m { color: #B8860B; }
  `],
})
export class SettingsScreen {
  store = inject(FoyerStore);
  dash = inject(DashboardStore);
  private api = inject(ApiService);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;
  copied = signal(false);

  readonly DEPLOYMENT = DEPLOYMENT;
  readonly q = signal('');
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

  async copierSecret(): Promise<void> {
    // La clé sans les espaces : c'est ce que l'application attend, les espaces
    // n'étaient là que pour la relire.
    try {
      await navigator.clipboard.writeText(this.totpSecretLisible().replace(/\s/g, ''));
      this.secretCopie.set(true); setTimeout(() => this.secretCopie.set(false), 1800);
    } catch { this.store.toast('Copie impossible : recopiez la clé à la main.'); }
  }

  async copierSecours(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.totpCodes().join('\n'));
      this.secoursCopies.set(true); setTimeout(() => this.secoursCopies.set(false), 1800);
    } catch { this.store.toast('Copie impossible : recopiez les codes à la main.'); }
  }

  /** Les réglages du serveur, indexés par clé, tels que le serveur les applique. */
  readonly serveur = computed<Record<string, { value: string; set: boolean }>>(() =>
    Object.fromEntries((this.store.settingsInfo()?.deployment || []).map((d) => [d.key, d])));
  /** La section dépliée. Dans l'état d'interface, pour qu'on puisse y mener depuis ailleurs. */
  readonly ouvert = computed(() => this.store.ui().settingsSection);

  /** Les sections du registre qui ont quelque chose à montrer, dans son ordre. */
  readonly sections = computed<Section[]>(() => SECTIONS
    .filter((s) => GESTES.has(s.id) || ALL.some((d) => d.section === s.id))
    .map((s) => ({ id: s.id, group: s.group, label: s.label, desc: s.desc, ...(ICONES[s.id] || ICONES['affichage']) })));

  /**
   * Les mêmes, rangées par groupe. C'est ce découpage que la page sépare d'un
   * trait : on va de soi au foyer, du foyer aux modules, des modules à la machine.
   */
  readonly groupes = computed<Groupe[]>(() => GROUPS
    .map((g) => ({ ...g, sections: this.sections().filter((s) => s.group === g.id) }))
    .filter((g) => g.sections.length));

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
    this.store.loadProfileFields();
    this.store.loadIcs();
    this.store.checkUpdates();
    void this.store.loadSettingsInfo();
    void this.store.loadSystemStatus();
  }

  /**
   * L'ordre des tuiles de l'accueil, tel qu'il s'applique : celui qu'on a choisi,
   * complété des tuiles qu'il ne nomme pas encore.
   */
  readonly tuiles = computed(() => {
    // Sans ordre choisi, la liste montre celui de l'accueil **en ce moment**,
    // règles comprises : déplacer une tuile fige alors ce qu'on avait sous les
    // yeux, au lieu de rebattre les cartes sur un ordre qu'on n'a jamais vu.
    const choisi = this.store.setting('homeOrder');
    const ids = choisi.trim() ? TILE_PROVIDERS.map((p) => p.id) : this.dash.tiles().map((t) => t.provider.id);
    return manualOrder(choisi, ids)
      .map((id) => ({ id, title: TILE_PROVIDERS.find((p) => p.id === id)?.title || id }));
  });
  readonly ordreManuel = computed(() => !!this.store.setting('homeOrder').trim());
  /** Pourquoi l'ordre n'est pas modifiable ici, dans les mêmes termes que les autres réglages. */
  readonly verrou = computed(() => { const d = declOf('homeOrder'); return d ? this.store.settingLock(d) : ''; });

  /** Le canal de mise à jour, rendu à la main dans le bloc « Mises à jour ». */
  readonly canalDecl = declOf('updateChannel');

  /**
   * Changer de canal sans revérifier laisserait à l'écran la réponse de
   * l'ancien : « à jour » alors qu'une préversion attend, ou l'inverse. Le
   * réglage et son effet se voient donc du même geste.
   */
  async changerCanal(d: SettingDecl, val: boolean | number | string): Promise<void> {
    await this.store.writeDeclared(d, val);
    await this.store.checkUpdates();
  }

  /** Échange la tuile avec sa voisine, et enregistre l'ordre entier. */
  deplacer(i: number, sens: 1 | -1): void {
    const ids = this.tuiles().map((t) => t.id);
    const j = i + sens;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.store.setSetting('homeOrder', ids.join(','));
  }
  /** Rendre la main aux règles de contexte : un ordre vide, c'est le défaut. */
  ordreAutomatique(): void { this.store.setSetting('homeOrder', ''); }

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

  /** Ce que la section contient, tous rendus confondus. C'est ce que la remise à zéro touche. */
  reglages(section: string): SettingDecl[] { return ALL.filter((d) => d.section === section && d.scope !== 'deploiement'); }
  /** Ce que le champ engendré prend en charge : le reste a son contrôle écrit à la main. */
  champs(section: string): SettingDecl[] { return this.reglages(section).filter((d) => !d.custom); }
  nomSection(id: string): string { return SECTIONS.find((s) => s.id === id)?.label || id; }
  basculer(id: string): void { this.store.patch({ settingsSection: this.ouvert() === id ? '' : id }); }
  aller(id: string): void { this.q.set(''); this.store.patch({ settingsSection: id }); }

  /** Au moins un réglage de la section est modifiable par la personne connectée. */
  modifiable(section: string): boolean { return this.reglages(section).some((d) => !this.store.settingLock(d)); }
  toutParDefaut(section: string): boolean {
    return this.reglages(section).every((d) => this.store.readDeclared(d) === d.default);
  }
  resetSection(section: string): void {
    for (const d of this.reglages(section)) {
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

  /** « 4,2 Mo », « 812 Ko ». Un chiffre lisible d'un coup d'oeil, pas une précision inutile. */
  poids(o: number): string {
    if (o >= 1073741824) return (o / 1073741824).toFixed(1).replace('.', ',') + ' Go';
    if (o >= 1048576) return (o / 1048576).toFixed(1).replace('.', ',') + ' Mo';
    if (o >= 1024) return Math.round(o / 1024) + ' Ko';
    return o + ' o';
  }

  /** « 3 jours », « 4 h », « 12 min ». Depuis quand le service tourne. */
  duree(s: number): string {
    if (s >= 86400) return Math.floor(s / 86400) + ' jour' + (s >= 172800 ? 's' : '');
    if (s >= 3600) return Math.floor(s / 3600) + ' h';
    return Math.max(1, Math.floor(s / 60)) + ' min';
  }

  /** Le dossier de données découpé, pour écrire la commande tar sans la deviner. */
  dossierParent(): string {
    const d = this.store.systemStatus()?.dataDir || '/var/lib/foyer';
    return d.slice(0, d.lastIndexOf('/')) || '/';
  }
  dossierNom(): string {
    const d = this.store.systemStatus()?.dataDir || '/var/lib/foyer';
    return d.slice(d.lastIndexOf('/') + 1) || 'foyer';
  }

  /** « le 04/09 à 16:53 ». La date complète n'apporte rien dans un journal court. */
  quand(iso: string): string {
    const [j, h] = (iso || '').replace('T', ' ').split(' ');
    const [, mo, jour] = (j || '').split('-');
    return jour ? `le ${jour}/${mo} à ${(h || '').slice(0, 5)}` : iso;
  }

  /**
   * La mise à jour installe et exécute du code sur le serveur : le mot de passe
   * est redemandé, comme pour un changement d'identifiants. Ce n'est pas une
   * formalité, c'est ce qui sépare « quelqu'un a mon téléphone déverrouillé » de
   * « quelqu'un exécute ce qu'il veut sur ma machine ».
   */
  doUpdate(): void {
    const mdp = prompt(
      'Lancer la mise à jour de Foyer ? Le service va se recompiler et redémarrer (environ 1 à 2 min).\n\n'
      + 'Cette opération installe et exécute du code sur le serveur : confirmez avec votre mot de passe.',
    );
    if (mdp) this.store.applyUpdate(mdp);
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
    return s === 'sent' ? 'envoyé'
      : s === 'partial' ? 'reçu par une partie des appareils'
      : s === 'no-device' ? 'aucun appareil'
      : s === 'failed' ? 'échec'
      : s === 'missed' ? 'manqué (service arrêté)' : s;
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
