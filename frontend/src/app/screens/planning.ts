import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { ModalComponent } from '../shared/modal';
import { WhoComponent } from '../shared/who';
import { SchedSlot } from '../core/models';
import { FreeGap, SchedScope, WHEN_LABELS, dowLabel, filterSlots, gapsOf, slotsOn, validityLabel, whoBadges } from '../core/schedule';
import { DOW, SCHED_TYPES, SCHED_COLORS } from '../core/constants';

/** Un jour de la vue, déjà filtré et daté : l'affichage n'a plus qu'à le dessiner. */
interface DayView { dow: number; date: string; label: string; short: string; num: string; today: boolean; slots: SchedSlot[]; }

/**
 * L'emploi du temps de la semaine.
 *
 * Deux partis pris, et ce sont eux qui font la différence avec l'écran qu'il
 * remplace.
 *
 * **Aucune sélection veut dire tout le foyer.** Le filtre par membre affine, il
 * n'est jamais un prérequis à l'affichage. L'écran précédent s'ouvrait filtré
 * sur un identifiant de maquette qui n'existait dans aucun foyer réel : il
 * n'affichait donc rien, jamais, tant qu'on n'avait pas cliqué sur une pastille.
 *
 * **Des listes triées par heure, pas une grille horaire proportionnelle.** Une
 * grille où la hauteur vaut la durée demande treize heures de hauteur pour
 * rester lisible, et gère les chevauchements en rétrécissant les colonnes :
 * avec quatre membres et trois créneaux à 18h, on obtient des bandes de trois
 * millimètres. Une liste absorbe les chevauchements sans rien faire, deux
 * créneaux à 18h étant deux lignes lisibles. Ce qu'on y perd, et c'est assumé :
 * le sens visuel de la durée et des trous de la journée.
 */
@Component({
  selector: 'screen-planning',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent, ModalComponent, WhoComponent],
  template: `
    <div class="screen-enter">
      <div class="head-row">
        <div class="members">
          @for (m of d().members; track m.id) {
            <div class="pill" [class.active]="filtered(m.id)" (click)="store.toggleSchedWho(m.id)">
              <f-avatar [ini]="m.ini" [color]="m.color" [size]="24" />
              <span>{{ m.name }}</span>
            </div>
          }
        </div>
        @if (!store.narrow()) {
          <button class="btn btn-primary" (click)="store.newSlot(store.ui().schedDow)">
            <f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Nouveau créneau
          </button>
        }
      </div>

      <!-- Le filtre reste visible tant qu'il est actif, et s'efface en un geste :
           un écran qui paraît vide à cause d'un filtre oublié est un piège. -->
      @if (store.ui().schedWho.length) {
        <div class="filter-bar">
          <f-icon name="users" [size]="16" color="var(--ink2)" [width]="2.2" />
          <span>Filtré sur {{ filterNames() }}</span>
          <!-- Copier une semaine n'a de sens que vers quelqu'un d'autre : sans
               filtre, ce serait recopier tout le monde sur tout le monde. -->
          <button class="clear" (click)="store.copyWeek()">Copier la semaine</button>
          <button class="clear" (click)="store.clearSchedWho()">Tout le foyer</button>
        </div>
      }

      @if (store.ui().schedClip; as clip) {
        <div class="clip-bar">
          <f-icon name="copy" [size]="16" color="var(--ink)" [width]="2.2" />
          <span>{{ clipText() }}</span>
          <button class="clear" (click)="store.openPaste()">{{ clip.kind === 'week' ? 'Coller pour…' : 'Coller sur…' }}</button>
          <button class="clear ghost" (click)="store.clearClip()" title="Abandonner la copie">
            <f-icon name="x" [size]="15" color="var(--ink2)" [width]="2.4" />
          </button>
        </div>
      }

      @if (orphans(); as n) {
        <div class="warn-bar">
          <f-icon name="urgent" [size]="16" color="#C6492F" [width]="2.2" />
          <span>{{ orphanText() }}</span>
        </div>
      }

      <!-- La semaine affichée. Sans elle, « à partir de cette date » et le filtre
           des vacances n'auraient aucune date à viser. -->
      <div class="week-bar">
        <button class="icon-btn" title="Semaine précédente" (click)="store.shiftSchedWeek(-1)">
          <f-icon name="chevronLeft" [size]="16" color="var(--ink2)" [width]="2.4" />
        </button>
        <span class="week-label">{{ weekLabel() }}</span>
        <button class="icon-btn" title="Semaine suivante" (click)="store.shiftSchedWeek(1)">
          <f-icon name="chevronRight" [size]="16" color="var(--ink2)" [width]="2.4" />
        </button>
        @if (!onThisWeek()) { <button class="clear" (click)="store.schedToday()">Cette semaine</button> }
      </div>

      @if (!d().sched.length) {
        <div class="blank">
          <div class="blank-title">Votre semaine est encore vide.</div>
          <div class="blank-sub">Ajoutez un premier créneau : école, travail, activité, trajet.</div>
          <button class="btn btn-primary" (click)="store.newSlot(store.ui().schedDow)">
            <f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Nouveau créneau
          </button>
        </div>
      } @else {
        <!-- Téléphone : vue jour, précédée du sélecteur de jour. Une semaine
             complète pour quatre membres n'y tient pas sans devenir illisible.
             Tablette et large : la semaine entière, un jour par colonne. Une
             seule boucle dessine les deux, il n'y a qu'une liste à tenir. -->
        @if (store.narrow()) {
          <div class="day-strip">
            @for (v of week(); track v.dow) {
              <button class="dbtn" [class.on]="v.dow === store.ui().schedDow" [class.today]="v.today"
                      (click)="store.patch({ schedDow: v.dow })">
                <span class="dbtn-name">{{ v.short }}</span>
                <span class="dbtn-num">{{ v.num }}</span>
                <span class="dbtn-count" [class.zero]="!v.slots.length">{{ v.slots.length }}</span>
              </button>
            }
          </div>
        }
        <div class="grid" [class.solo]="store.narrow()">
          @for (v of shown(); track v.dow) {
            <div class="day-card" [class.is-today]="v.today && !store.narrow()"
                 [class.drop-target]="dragId() && overDow() === v.dow"
                 (dragover)="onDragOver($event, v.dow)" (dragleave)="onDragLeave(v.dow)" (drop)="onDrop(v.dow)">
              <div class="day-head">
                <div class="day-name">{{ v.label }} {{ v.num }}@if (v.today) { <span class="tag">aujourd'hui</span> }</div>
                <span class="day-count">{{ v.slots.length }}</span>
                <!-- Bouton visible, pas d'appui long à deviner. -->
                <button class="icon-btn" title="Copier cette journée" (click)="store.copyDay(v.dow)">
                  <f-icon name="copy" [size]="15" color="var(--ink2)" [width]="2.2" />
                </button>
              </div>
              <div class="slots">
                @for (s of v.slots; track s.id) {
                  <!-- Le trou qui précède ce créneau. Il rend au passage le sens
                       des temps libres, que la vue en listes faisait perdre. -->
                  @if (gapBefore(v, s); as g) {
                    <div class="gap" (click)="store.newSlot(v.dow, g.start)" [title]="'Ajouter un créneau à ' + g.start">
                      <span class="gap-line"></span>
                      <span class="gap-txt"><f-icon name="plus" [size]="11" color="var(--ink3)" [width]="2.6" /> {{ g.start }} – {{ g.end }} libre</span>
                      <span class="gap-line"></span>
                    </div>
                  }
                  <div class="slot" draggable="true" (dragstart)="onDragStart(s)" (dragend)="onDragEnd()"
                       [class.dragging]="dragId() === s.id"
                       [style.border-left]="'4px solid ' + color(s.k)" (click)="store.editSlot(s.id, v.date)">
                    <div class="slot-top">
                      <div class="slot-time">{{ s.end ? s.start + ' – ' + s.end : s.start }}</div>
                      <f-who [badges]="badges(s)" />
                    </div>
                    <div class="slot-label">{{ s.label }}</div>
                    <div class="slot-tags">
                      <span class="slot-badge" [style.background]="tintOf(s.k)" [style.color]="color(s.k)">
                        <span class="dot" [style.background]="color(s.k)"></span>{{ typeLabel(s.k) }}
                      </span>
                      <!-- Une période ou une exception doit se voir sur la ligne :
                           sinon rien ne distingue « toute l'année » de « jusqu'en juin ». -->
                      @if (noteOf(s); as note) { <span class="slot-note">{{ note }}</span> }
                    </div>
                  </div>
                } @empty {
                  <!-- « Rien ici » et « rien ici à cause du filtre » ne se disent
                       pas pareil : le second doit proposer sa propre sortie. -->
                  <div class="free">{{ store.ui().schedWho.length ? 'Rien pour ce filtre' : 'Libre' }}</div>
                }
              </div>
              <div class="day-foot">
                <div class="add" (click)="store.newSlot(v.dow)">
                  <f-icon name="plus" [size]="13" color="var(--ink2)" [width]="2.6" /> Ajouter
                </div>
                @if (pastableOn(v.dow)) {
                  <div class="add paste" (click)="store.pasteOn(v.dow)">
                    <f-icon name="download" [size]="13" color="var(--primary)" [width]="2.6" /> Coller
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>

    @if (store.ui().schedEdit) {
      <f-modal [title]="formTitle()" [maxWidth]="520" (close)="store.patch({ schedEdit: false })">
        <div class="seg">
          <button [class.active]="store.ui().seRec === 'weekly'" (click)="store.patch({ seRec: 'weekly' })">Toutes les semaines</button>
          <button [class.active]="store.ui().seRec === 'once'" (click)="store.patch({ seRec: 'once' })">Une seule fois</button>
        </div>

        @if (store.ui().seRec === 'once') {
          <div class="field-label">Date</div>
          <input class="input" type="date" [ngModel]="store.ui().seDate" (ngModelChange)="store.patch({ seDate: $event })" />
        } @else {
          <div class="field-label">Jour</div>
          <div class="seg wrap">
            @for (n of days; track n) {
              <button [class.active]="store.ui().seDow === n" (click)="store.patch({ seDow: n })">{{ label(n) }}</button>
            }
          </div>
        }

        <div class="field-label">Qui</div>
        <div class="who-opts">
          @for (m of d().members; track m.id) {
            <div class="who-opt" [class.on]="store.ui().seWho.includes(m.id)"
                 [style.border-color]="store.ui().seWho.includes(m.id) ? m.color : 'transparent'"
                 (click)="store.toggleSlotWho(m.id)">
              <f-avatar [ini]="m.ini" [color]="m.color" [size]="24" />
              <span>{{ m.name }}</span>
            </div>
          }
        </div>

        <div class="form-row">
          <div class="field">
            <div class="field-label">Début</div>
            <input class="input" type="time" [ngModel]="store.ui().seStart" (ngModelChange)="store.patch({ seStart: $event })" />
          </div>
          <div class="field">
            <div class="field-label">Fin (option.)</div>
            <input class="input" type="time" [ngModel]="store.ui().seEnd" (ngModelChange)="store.patch({ seEnd: $event })" />
          </div>
        </div>

        <div class="field-label">Intitulé</div>
        <!-- Ce qu'on a déjà écrit fait office de modèles : « École », « Car »,
             « Cabinet » reviennent tous les jours, et une bibliothèque de
             modèles serait une seconde chose à tenir à jour. -->
        <input class="input" list="sched-labels" [ngModel]="store.ui().seLabel"
               (ngModelChange)="store.patch({ seLabel: $event })" placeholder="Ex : Cours de piano" />
        <datalist id="sched-labels">
          @for (l of store.labelSuggestions(); track l) { <option [value]="l"></option> }
        </datalist>

        <div class="field-label">Type</div>
        <div class="type-opts">
          @for (t of types; track t.k) {
            <div class="type-opt" [class.on]="store.ui().seType === t.k"
                 [style.border-color]="store.ui().seType === t.k ? t.color : 'transparent'"
                 [style.background]="tintOf(t.k)" [style.color]="t.color"
                 (click)="store.patch({ seType: t.k })">
              <span class="dot" [style.background]="t.color"></span>{{ t.label }}
            </div>
          }
        </div>

        <!-- Les réglages de période sont repliés : ils ne servent pas à la saisie
             courante, et le formulaire ne doit demander que le nécessaire. -->
        @if (store.ui().seRec === 'weekly') {
          @if (store.ui().seMore) {
            <div class="form-row">
              <div class="field">
                <div class="field-label">À partir du (option.)</div>
                <input class="input" type="date" [ngModel]="store.ui().seFrom" (ngModelChange)="store.patch({ seFrom: $event })" />
              </div>
              <div class="field">
                <div class="field-label">Jusqu’au (option.)</div>
                <input class="input" type="date" [ngModel]="store.ui().seUntil" (ngModelChange)="store.patch({ seUntil: $event })" />
              </div>
            </div>
            <div class="field-label">Seulement</div>
            <div class="seg wrap">
              <button [class.active]="store.ui().seWhen === 'always'" (click)="store.patch({ seWhen: 'always' })">Toute l’année</button>
              <button [class.active]="store.ui().seWhen === 'school'" (click)="store.patch({ seWhen: 'school' })">En période scolaire</button>
              <button [class.active]="store.ui().seWhen === 'holidays'" (click)="store.patch({ seWhen: 'holidays' })">Pendant les vacances</button>
            </div>
          } @else {
            <div class="more" (click)="store.patch({ seMore: true })">
              <f-icon name="calendar" [size]="14" color="var(--ink2)" [width]="2.2" /> Période de validité et vacances
            </div>
          }
        }

        <!-- Modifier une occurrence ne doit jamais toucher toute la série sans
             qu'on l'ait demandé : la question est posée ici, au-dessus du bouton. -->
        @if (askScope() && !store.ui().seDelOpen) {
          <div class="field-label">Appliquer</div>
          <div class="seg wrap">
            <button [class.active]="store.ui().seScope === 'all'" (click)="store.patch({ seScope: 'all' })">À toute la série</button>
            <button [class.active]="store.ui().seScope === 'future'" (click)="store.patch({ seScope: 'future' })">À partir du {{ store.fmtNumDate(store.ui().seOccDate) }}</button>
            <button [class.active]="store.ui().seScope === 'once'" (click)="store.patch({ seScope: 'once' })">Ce jour seulement</button>
          </div>
        }

        @if (store.ui().seDelOpen) {
          <div class="report destructive">
            <div class="line strong">{{ askScope() ? 'Supprimer quoi ?' : 'Supprimer ce créneau ?' }}</div>
            <div class="del-opts">
              @if (askScope()) {
                <button class="btn btn-danger" (click)="store.delSlot('once')">Ce jour seulement</button>
                <button class="btn btn-danger" (click)="store.delSlot('future')">À partir du {{ store.fmtNumDate(store.ui().seOccDate) }}</button>
                <button class="btn btn-danger" (click)="store.delSlot('all')">Toute la série</button>
              } @else {
                <button class="btn btn-danger" (click)="store.delSlot('all')">Supprimer</button>
              }
              <button class="btn btn-soft" (click)="store.patch({ seDelOpen: false })">Non</button>
            </div>
          </div>
        }

        @if (!store.ui().seDelOpen) {
        <div class="modal-actions">
          @if (store.ui().seEditId) {
            <button class="btn btn-soft" (click)="store.duplicateSlot()"><f-icon name="copy" [size]="16" color="var(--ink)" [width]="2.2" /> Dupliquer</button>
            <button class="btn btn-danger" (click)="store.patch({ seDelOpen: true })"><f-icon name="trash" [size]="16" color="#fff" [width]="2.2" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ schedEdit: false })">Annuler</button>
          <button class="btn btn-primary" (click)="store.saveSlot()">Enregistrer</button>
        </div>
        }
      </f-modal>
    }

    <!-- Un glisser-déposer ne doit pas décider tout seul du sort d'une série. -->
    @if (store.ui().schedMove; as mv) {
      <f-modal [title]="'Déplacer au ' + label(mv.dow).toLowerCase()" [maxWidth]="440" (close)="store.patch({ schedMove: null })">
        <div class="hint">Ce créneau revient toutes les semaines. Que faut-il déplacer ?</div>
        <div class="del-opts">
          <button class="btn btn-primary" (click)="store.moveSlot(mv.id, mv.dow, 'all')">Toute la série</button>
          <button class="btn btn-soft" (click)="store.moveSlot(mv.id, mv.dow, 'once')">Ce jour seulement</button>
        </div>
        <div class="modal-actions">
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ schedMove: null })">Annuler</button>
        </div>
      </f-modal>
    }

    @if (store.ui().schedPasteOpen && store.ui().schedClip; as clip) {
      <f-modal [title]="clip.kind === 'week' ? 'Coller la semaine' : 'Coller ' + label(clip.dow)"
               [maxWidth]="520" (close)="store.patch({ schedPasteOpen: false })">
        @if (clip.kind === 'day') {
          <div class="field-label">Sur quels jours</div>
          <div class="seg wrap">
            @for (n of days; track n) {
              <button [class.active]="store.ui().schedPasteDows.includes(n)" [disabled]="n === clip.dow"
                      (click)="store.togglePasteDow(n)">{{ label(n) }}</button>
            }
          </div>
        }

        <div class="field-label">Comment</div>
        <div class="seg">
          <button [class.active]="store.ui().schedPasteMode === 'merge'" (click)="store.patch({ schedPasteMode: 'merge' })">Fusionner</button>
          <button [class.active]="store.ui().schedPasteMode === 'replace'" (click)="store.patch({ schedPasteMode: 'replace' })">Remplacer</button>
        </div>
        <div class="hint">{{ store.ui().schedPasteMode === 'merge'
          ? 'Ajoute ce qui manque et ne touche à rien d’autre.'
          : 'Le jour visé devient la copie du jour source : ce qu’il portait est supprimé.' }}</div>

        <div class="field-label">Attribuer à</div>
        <div class="who-opts">
          <div class="who-opt" [class.on]="!store.ui().schedPasteWho" (click)="store.patch({ schedPasteWho: null })">
            <span>Membres d’origine</span>
          </div>
          @for (m of d().members; track m.id) {
            <div class="who-opt" [class.on]="store.ui().schedPasteWho === m.id"
                 [style.border-color]="store.ui().schedPasteWho === m.id ? m.color : 'transparent'"
                 (click)="store.patch({ schedPasteWho: m.id })">
              <f-avatar [ini]="m.ini" [color]="m.color" [size]="24" />
              <span>{{ m.name }}</span>
            </div>
          }
        </div>

        <!-- Le rapport avant d'écrire, comme pour la génération des courses :
             on ne supprime jamais sans avoir dit combien et quoi. -->
        @if (store.pastePlan(); as plan) {
          <div class="report" [class.destructive]="plan.removed.length">
            @if (!plan.added.length && !plan.removed.length) {
              <div class="line">{{ plan.duplicates ? 'Tout est déjà là : rien à ajouter.' : 'Choisissez au moins un jour cible.' }}</div>
            } @else {
              @if (plan.added.length) { <div class="line">{{ plan.added.length }} {{ plan.added.length > 1 ? 'créneaux ajoutés' : 'créneau ajouté' }}</div> }
              @if (plan.removed.length) { <div class="line strong">{{ plan.removed.length }} {{ plan.removed.length > 1 ? 'créneaux supprimés' : 'créneau supprimé' }} : {{ removedNames() }}</div> }
              <!-- Un créneau partagé emporte tout le monde avec lui. Le compter
                   sans le dire laisserait croire qu'on ne touche qu'à une personne. -->
              @if (sharedRemoved(); as n) { <div class="line strong">{{ sharedText() }}</div> }
              @if (plan.duplicates) { <div class="line">{{ plan.duplicates }} déjà {{ plan.duplicates > 1 ? 'présents, ignorés' : 'présent, ignoré' }}</div> }
            }
          </div>
        }

        <div class="modal-actions">
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ schedPasteOpen: false })">Annuler</button>
          <button class="btn btn-primary" [disabled]="nothingToPaste()" (click)="store.pasteNow()">Coller</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .head-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; }
    .members { display: flex; flex-wrap: wrap; gap: 10px; }
    .pill { display: flex; align-items: center; gap: 9px; padding: 8px 16px 8px 8px; border-radius: 14px; cursor: pointer; background: var(--surface); color: var(--ink); font-weight: 800; font-size: 14px; box-shadow: 0 8px 18px -14px rgba(90,60,40,.6); }
    .pill.active { background: var(--primary); color: #fff; }
    .head-row .btn { flex: none; }
    :host-context(.shell.narrow) .head-row { margin-bottom: 12px; }
    :host-context(.shell.narrow) .members { gap: 8px; }
    :host-context(.shell.narrow) .pill { padding: 6px 12px 6px 6px; font-size: 13px; gap: 7px; }

    .filter-bar, .warn-bar, .clip-bar { display: flex; align-items: center; gap: 9px; padding: 10px 14px; border-radius: 13px; margin-bottom: 14px; font-size: 13px; font-weight: 700; flex-wrap: wrap; }
    .filter-bar { background: var(--soft2); color: var(--ink2); }
    .clip-bar { background: color-mix(in srgb, var(--primary) 12%, var(--surface)); color: var(--ink); }
    .clip-bar span { flex: 1; min-width: 0; }
    .clear.ghost { background: transparent; padding: 6px 8px; display: inline-flex; }
    .warn-bar { background: color-mix(in srgb, #C6492F 12%, var(--surface)); color: #C6492F; }
    .filter-bar span, .warn-bar span { flex: 1; min-width: 0; }
    .clear { border: none; cursor: pointer; background: var(--surface); color: var(--ink); border-radius: 9px; padding: 6px 12px; font-size: 12px; font-weight: 800; font-family: inherit; }

    .blank { background: var(--surface); border-radius: 18px; padding: 34px 20px; text-align: center; box-shadow: 0 12px 28px -22px rgba(90,60,40,.5); }
    .blank-title { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--ink); }
    .blank-sub { font-size: 13.5px; font-weight: 600; color: var(--ink2); margin: 6px 0 18px; }
    .blank .btn { display: inline-flex; }

    .week-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
    .week-label { flex: 1; min-width: 0; font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--ink); }

    .day-strip { display: flex; gap: 6px; margin-bottom: 14px; }
    .dbtn { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 9px 2px; border: none; border-radius: 13px; background: var(--surface); color: var(--ink2); font-family: inherit; cursor: pointer; }
    .dbtn.on { background: var(--primary); color: #fff; }
    .dbtn.today:not(.on) { box-shadow: inset 0 0 0 2px var(--primary); }
    .dbtn-name { font-size: 12px; font-weight: 800; }
    .dbtn-num { font-family: var(--font-display); font-size: 13px; font-weight: 700; }
    .dbtn-count { font-size: 10.5px; font-weight: 800; opacity: .8; }
    .dbtn-count.zero { opacity: .35; }

    /* La semaine se lit d'un coup quand elle tient sur une ligne. En dessous,
       quatre colonnes valent mieux qu'un remplissage automatique, qui donnait
       huit colonnes pour sept jours sur un grand écran. */
    .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 12px; align-items: start; }
    @media (max-width: 1470px) { .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    @media (max-width: 1000px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .grid.solo, :host-context(.shell.narrow) .grid { grid-template-columns: 1fr; }
    .grid.solo .day-card { min-height: 0; }

    .day-card { background: var(--surface); border-radius: 18px; padding: 14px; box-shadow: 0 12px 28px -22px rgba(90,60,40,.5); min-height: 230px; display: flex; flex-direction: column; }
    .day-card.is-today { box-shadow: 0 12px 28px -22px rgba(90,60,40,.5), inset 0 0 0 2px var(--primary); }
    .day-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .day-head .day-name { flex: 1; min-width: 0; }
    .icon-btn { border: none; background: var(--soft2); border-radius: 9px; padding: 5px 7px; cursor: pointer; display: inline-flex; line-height: 0; }
    .day-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--ink); }
    .day-count { font-size: 11px; font-weight: 800; color: var(--ink3); }
    .tag { font-family: var(--font-body); font-size: 10.5px; font-weight: 800; color: var(--primary); text-transform: uppercase; letter-spacing: .04em; margin-left: 6px; }

    .slots { display: flex; flex-direction: column; gap: 8px; flex: 1; }
    .gap { display: flex; align-items: center; gap: 7px; cursor: pointer; padding: 1px 0; }
    .gap-line { flex: 1; height: 1px; background: var(--soft2); }
    .gap-txt { display: inline-flex; align-items: center; gap: 3px; font-size: 10.5px; font-weight: 800; color: var(--ink3); white-space: nowrap; }
    .gap:hover .gap-txt { color: var(--primary); }
    .slot.dragging { opacity: .4; }
    .day-card.drop-target { box-shadow: 0 12px 28px -22px rgba(90,60,40,.5), inset 0 0 0 2px var(--primary); }
    .slot { background: var(--soft); border-radius: 12px; padding: 10px 11px; cursor: pointer; }
    .slot-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    /* Si la place manque, c'est l'heure qui se coupe, jamais le marqueur
       d'identité : savoir de qui il s'agit prime sur la minute exacte. */
    .slot-top f-who { flex: none; }
    .slot-time { font-family: var(--font-display); font-size: 12.5px; font-weight: 700; color: var(--ink2); white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .slot-label { font-size: 13.5px; font-weight: 800; color: var(--ink); margin-top: 3px; line-height: 1.2; }
    .slot-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 7px; }
    .slot-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 8px; font-size: 10.5px; font-weight: 800; }
    .slot-note { padding: 3px 8px; border-radius: 8px; background: var(--soft2); color: var(--ink2); font-size: 10.5px; font-weight: 800; }
    .slot-badge .dot { width: 7px; height: 7px; border-radius: 2px; }
    .free { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; color: var(--ink3); font-size: 12px; font-weight: 700; padding: 16px 0; text-align: center; }

    .day-foot { display: flex; gap: 6px; margin-top: 8px; }
    .add { flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; padding: 8px; border-radius: 11px; background: var(--soft2); color: var(--ink2); font-size: 12px; font-weight: 800; cursor: pointer; }
    .add.paste { background: color-mix(in srgb, var(--primary) 14%, var(--surface)); color: var(--primary); }

    .hint { font-size: 12px; font-weight: 700; color: var(--ink2); margin: 8px 0 16px; line-height: 1.35; }
    .more { display: inline-flex; align-items: center; gap: 6px; margin: 12px 0 4px; padding: 8px 13px; border-radius: 11px; background: var(--soft2); color: var(--ink2); font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .del-opts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .del-opts .btn { flex: 1 1 auto; }
    .report { background: var(--soft); border-radius: 13px; padding: 12px 14px; margin: 14px 0 4px; font-size: 13px; font-weight: 700; color: var(--ink2); }
    .report.destructive { background: color-mix(in srgb, #C6492F 10%, var(--surface)); }
    .report .line + .line { margin-top: 5px; }
    .report .strong { color: #C6492F; font-weight: 800; }

    .seg.wrap { flex-wrap: wrap; margin-bottom: 6px; }
    .seg > button:disabled { opacity: .35; cursor: default; }
    .form-row { display: flex; gap: 12px; margin-bottom: 4px; }
    .field { flex: 1; min-width: 0; }
    .field-label { margin-top: 4px; }
    .input { margin-bottom: 4px; }

    .who-opts { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 8px; }
    .who-opt { display: flex; align-items: center; gap: 8px; padding: 7px 14px 7px 7px; border-radius: 13px; background: var(--soft); color: var(--ink); font-size: 13.5px; font-weight: 800; cursor: pointer; border: 2px solid transparent; }
    .who-opt.on { background: var(--soft2); }

    .type-opts { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 12px; }
    .type-opt { display: flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 11px; font-size: 13.5px; font-weight: 800; cursor: pointer; border: 2px solid transparent; }
    .type-opt .dot { width: 9px; height: 9px; border-radius: 3px; }

    .modal-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
    .modal-actions .spacer { flex: 1; }
    /* Sur téléphone, les trois boutons côte à côte poussaient « Enregistrer »
       hors de l'écran : le geste central du formulaire était injoignable. */
    :host-context(.shell.narrow) .modal-actions { flex-wrap: wrap; }
    :host-context(.shell.narrow) .modal-actions .spacer { display: none; }
    :host-context(.shell.narrow) .modal-actions .btn-soft,
    :host-context(.shell.narrow) .modal-actions .btn-primary { flex: 1; }
    :host-context(.shell.narrow) .modal-actions .btn-danger { order: 3; flex: 1 0 100%; }
  `],
})
export class PlanningScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  days = [1, 2, 3, 4, 5, 6, 7];
  scopes: SchedScope[] = ['all', 'future', 'once'];
  types = SCHED_TYPES;

  label(dow: number): string { return dowLabel(dow); }
  filtered(id: string): boolean { return this.store.ui().schedWho.includes(id); }

  /**
   * La semaine affichée, résolue une seule fois pour les deux vues.
   *
   * Elle est **datée** : la semaine type est le modèle, mais sans date on ne
   * saurait ni si un créneau est encore valide, ni si c'est les vacances, ni où
   * poser un créneau ponctuel.
   */
  readonly week = computed<DayView[]>(() => {
    const sched = this.d().sched;
    const who = this.store.ui().schedWho;
    const cal = this.store.calendar();
    const today = this.store.todayStr();
    return this.store.schedWeek().map((date, i) => ({
      dow: i + 1,
      date,
      label: dowLabel(i + 1),
      short: DOW[i],
      num: String(parseInt(date.slice(8, 10), 10)),
      today: date === today,
      slots: filterSlots(slotsOn(sched, date, cal), who),
    }));
  });

  /** « Semaine du 7 au 13 septembre », ou à cheval sur deux mois. */
  readonly weekLabel = computed(() => {
    const jours = this.store.schedWeek();
    if (!jours.length) return '';
    const mois = (iso: string) => this.store.fmtLongDate(iso).replace(/^\S+\s/, '');
    const debut = mois(jours[0]);
    const fin = mois(jours[6]);
    const [d1] = debut.split(' ');
    return debut.slice(debut.indexOf(' ') + 1) === fin.slice(fin.indexOf(' ') + 1)
      ? 'Semaine du ' + d1 + ' au ' + fin
      : 'Semaine du ' + debut + ' au ' + fin;
  });

  /** Vrai quand la semaine affichée est celle d'aujourd'hui. */
  readonly onThisWeek = computed(() => this.store.schedWeek().includes(this.store.todayStr()));

  /** Ce que la vue dessine : le jour retenu sur téléphone, la semaine ailleurs. */
  readonly shown = computed<DayView[]>(() => {
    if (!this.store.narrow()) return this.week();
    const dow = this.store.ui().schedDow;
    return this.week().filter((v) => v.dow === dow);
  });

  readonly filterNames = computed(() => {
    const who = this.store.ui().schedWho;
    return this.d().members.filter((m) => who.includes(m.id)).map((m) => m.name).join(', ');
  });

  /** Les créneaux que plus personne ne porte, restés d'un membre supprimé. */
  readonly orphans = computed(() => this.d().sched.filter((s) => !(s.who || []).length).length);
  readonly orphanText = computed(() => {
    const n = this.orphans();
    return n > 1
      ? n + ' créneaux sont sans membre : ouvrez-les pour leur attribuer quelqu’un.'
      : '1 créneau est sans membre : ouvrez-le pour lui attribuer quelqu’un.';
  });

  badges(s: SchedSlot) { return whoBadges(s, this.d().members); }

  /**
   * La question de la portée ne se pose que pour une série déjà enregistrée :
   * un créneau neuf ou ponctuel n'a pas d'occurrences à distinguer.
   */
  readonly askScope = computed(() => {
    const s = this.store.ui();
    if (!s.seEditId) return false;
    return this.d().sched.find((x) => x.id === s.seEditId)?.rec === 'weekly';
  });

  /** Ce qui, sur la ligne, dit qu'un créneau n'a pas lieu toute l'année. */
  noteOf(s: SchedSlot): string {
    if (s.rec === 'once') return s.srcId ? 'ce jour seulement' : 'ponctuel';
    const parts = [validityLabel(s, (iso) => this.store.fmtNumDate(iso)), WHEN_LABELS[s.when || 'always']];
    return parts.filter(Boolean).join(' · ');
  }

  /**
   * Le glisser-déposer, à la souris.
   *
   * Sur téléphone il n'existe pas (le tactile n'a pas de glisser natif, et en
   * fabriquer un se bat avec le défilement de la page). Ce n'est pas un manque :
   * le même déplacement s'y fait en ouvrant le créneau et en changeant son jour,
   * c'est-à-dire par un chemin visible plutôt que par un geste à deviner.
   */
  readonly dragId = signal<string | null>(null);
  readonly overDow = signal(0);

  onDragStart(s: SchedSlot): void { this.dragId.set(s.id); }
  onDragEnd(): void { this.dragId.set(null); this.overDow.set(0); }
  onDragOver(e: DragEvent, dow: number): void {
    if (!this.dragId()) return;
    e.preventDefault();
    if (this.overDow() !== dow) this.overDow.set(dow);
  }
  onDragLeave(dow: number): void { if (this.overDow() === dow) this.overDow.set(0); }
  onDrop(dow: number): void {
    const id = this.dragId();
    this.onDragEnd();
    const slot = id ? this.d().sched.find((x) => x.id === id) : null;
    if (!slot || slot.dow === dow) return;
    // Une série ne change pas de jour sans qu'on l'ait demandé.
    if (slot.rec === 'weekly') { this.store.patch({ schedMove: { id: slot.id, dow } }); return; }
    this.store.moveSlot(slot.id, dow, 'all');
  }

  /** Le temps libre qui précède un créneau, s'il y en a. */
  gapBefore(v: DayView, s: SchedSlot): FreeGap | null {
    return this.gapsFor(v).find((g) => g.end === s.start) || null;
  }
  private gapsFor(v: DayView): FreeGap[] { return gapsOf(v.slots); }

  /** Un jour accepte le collage tant qu'il n'est pas celui qu'on a copié. */
  pastableOn(dow: number): boolean {
    const clip = this.store.ui().schedClip;
    return !!clip && clip.kind === 'day' && clip.dow !== dow;
  }

  readonly clipText = computed(() => {
    const clip = this.store.ui().schedClip;
    if (!clip) return '';
    const n = clip.slots.length;
    const quoi = n + (n > 1 ? ' créneaux' : ' créneau');
    return clip.kind === 'week' ? 'Semaine copiée, ' + quoi : dowLabel(clip.dow) + ' copié, ' + quoi;
  });

  /** Rien à écrire ni à retirer : le bouton ne doit pas laisser croire le contraire. */
  readonly nothingToPaste = computed(() => {
    const plan = this.store.pastePlan();
    return !plan || (!plan.added.length && !plan.removed.length);
  });

  /** Les créneaux supprimés qui appartiennent aussi à quelqu'un hors du collage. */
  private readonly shared = computed(() => {
    const plan = this.store.pastePlan();
    if (!plan) return [];
    return plan.removed.filter((s) => (s.who || []).some((id) => !plan.scope.includes(id)));
  });
  readonly sharedRemoved = computed(() => this.shared().length);
  /**
   * Tourné sans accord de genre ni de nombre sur les personnes : l'application
   * ne connaît pas le genre de ses membres, et « Léa perdent » sur le prénom
   * d'un enfant décrédibilise tout le reste du message.
   */
  readonly sharedText = computed(() => {
    const plan = this.store.pastePlan();
    const n = this.sharedRemoved();
    if (!plan || !n) return '';
    const autres = new Set(this.shared().flatMap((s) => s.who).filter((id) => !plan.scope.includes(id)));
    const noms = this.d().members.filter((m) => autres.has(m.id)).map((m) => m.name).join(', ') || 'quelqu’un d’autre';
    return n > 1
      ? 'dont ' + n + ' partagés avec ' + noms + ' : ils disparaissent pour tout le monde'
      : 'dont 1 partagé avec ' + noms + ' : il disparaît pour tout le monde';
  });

  /** Les intitulés de ce que le collage supprimerait : compter ne suffit pas. */
  readonly removedNames = computed(() => {
    const plan = this.store.pastePlan();
    if (!plan) return '';
    const noms = [...new Set(plan.removed.map((s) => s.label))];
    return noms.slice(0, 4).join(', ') + (noms.length > 4 ? ', …' : '');
  });

  typeLabel(k: string): string { return SCHED_TYPES.find((t) => t.k === k)?.label || k; }
  color(k: string): string { return SCHED_COLORS[k] || 'var(--ink3)'; }

  tintOf(k: string): string {
    return `color-mix(in srgb, ${this.color(k)} 14%, var(--surface))`;
  }

  formTitle = computed(() => (this.store.ui().seEditId ? 'Modifier le créneau' : 'Nouveau créneau'));
}
