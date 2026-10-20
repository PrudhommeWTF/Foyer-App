import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { ModalComponent } from '../../shared/modal';
import { WhoComponent } from '../../shared/who';
import { SchedSlot } from '../../core/models';
import { WHEN_LABELS, dowLabel, filterSlots, slotsOn, validityLabel, whoBadges } from '../../core/schedule';
import { Placed, hourRange, isWholeDay, layoutTimed } from '../../core/day-layout';
import { DOW, SCHED_TYPES, SCHED_COLORS } from '../../core/constants';
import { isEdSlot } from '../../core/ecole-slots';
import { EcoleStore } from '../../core/ecole.store';

/** Un jour de la vue, déjà filtré et daté : l'affichage n'a plus qu'à le dessiner. */
interface DayView { dow: number; date: string; label: string; short: string; num: string; today: boolean; slots: SchedSlot[]; }
/** Un créneau posé dans la grille, en pixels depuis le haut de la plage affichée et en pourcentage de la colonne. */
interface Block { s: SchedSlot; top: number; height: number; left: number; width: number; }
/** Une colonne de la grille : le jour, ses créneaux de toute la journée (bandeau) et ses créneaux posés. */
interface DayCol { v: DayView; allDay: SchedSlot[]; blocks: Block[]; }

/** Hauteur d'une heure : 46 px sur la semaine, 54 px pour le jour seul du téléphone. */
const HOUR_H = 46;
const HOUR_H_NARROW = 54;
const GUTTER = 38;
const COL_GAP = 6;

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
 * **Une vraie grille horaire.** La durée se lit, les creux aussi. Pour qu'elle
 * reste lisible avec quatre membres, la plage d'heures se resserre sur la
 * semaine (de l'heure pleine avant le premier créneau à celle après le
 * dernier), un créneau seul dans sa grappe prend toute la largeur, et un
 * créneau trop étroit écrit son titre debout. Les créneaux de toute la journée
 * (« Congés ») montent dans un bandeau au lieu d'occuper la grille.
 */
@Component({
  selector: 'screen-planning',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent, ModalComponent, WhoComponent],
  template: `
    <div class="screen-enter">
      <div class="head-row">
        <div class="members">
          <!-- Un enfant ne voit que son emploi du temps : pas de filtre à régler. -->
          @for (m of store.isChild() ? [] : d().members; track m.id) {
            <button type="button" class="pill" [class.active]="filtered(m.id)" [attr.aria-pressed]="filtered(m.id)" (click)="store.toggleSchedWho(m.id)">
              <f-avatar [ini]="m.ini" [color]="m.color" [size]="24" />
              <span>{{ m.name }}</span>
            </button>
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
      @if (store.ui().schedWho.length && !store.isChild()) {
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

      @if (!store.isChild() && orphans(); as n) {
        <div class="warn-bar">
          <f-icon name="urgent" [size]="16" color="var(--status-crit)" [width]="2.2" />
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

      @if (!store.schedAll().length) {
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
        <!-- La grille horaire : une colonne par jour (un seul jour sur téléphone), la durée se lit, les creux aussi. -->
        <div class="eg" [class.solo]="store.narrow()" [style.--days]="cols().length" [style.--hour-h.px]="hourH()">
          <div class="eg-row eg-heads">
            <div></div>
            @for (c of cols(); track c.v.dow) {
              <div class="eg-head" [class.today]="c.v.today">
                <span class="eg-day">{{ c.v.short }}. {{ c.v.num }}</span>
                <span class="eg-n">{{ c.v.slots.length }}</span>
                @if (c.v.today) { <span class="eg-tag">aujourd'hui</span> }
                <span class="eg-acts">
                  @if (pastableOn(c.v.dow)) {
                    <button class="eg-act paste" (click)="store.pasteOn(c.v.dow)"><f-icon name="download" [size]="13" color="currentColor" [width]="2.6" /> Coller</button>
                  } @else {
                    <button class="eg-act reveal" title="Copier cette journée" [attr.aria-label]="'Copier ' + dayName(c.v)" (click)="store.copyDay(c.v.dow)">
                      <f-icon name="copy" [size]="13" color="currentColor" [width]="2.2" />
                    </button>
                  }
                  <!-- Le clavier n'a pas de survol : l'ajout reste un bouton du jour. -->
                  <button class="eg-act reveal" title="Ajouter un créneau" [attr.aria-label]="'Ajouter un créneau ' + dayName(c.v)" (click)="store.newSlot(c.v.dow)">
                    <f-icon name="plus" [size]="13" color="currentColor" [width]="2.6" />
                  </button>
                </span>
              </div>
            }
          </div>
          <!-- Les créneaux de toute la journée (« Congés ») montent dans ce bandeau plutôt que d'occuper la grille. -->
          @if (hasAllDay()) {
            <div class="eg-row eg-allday">
              <div class="eg-gl">journée</div>
              @for (c of cols(); track c.v.dow) {
                <div class="eg-ad">
                  @for (s of c.allDay; track s.id) {
                    <button class="eg-adbar" [style.background]="mix(color(s.k), 24)" [title]="slotTitle(s)" (click)="open(s, c.v)">
                      <span class="eg-adl">{{ s.label }}</span><f-who [badges]="badges(s)" [size]="16" />
                    </button>
                  }
                </div>
              }
            </div>
          }
          <div class="eg-row eg-body">
            <div class="eg-gutter" [style.height.px]="bodyH()">
              @for (h of hours(); track h) { <span class="eg-hour" [style.top.px]="(h - range()[0]) * hourH()">{{ h }}h</span> }
            </div>
            @for (c of cols(); track c.v.dow) {
              <div class="eg-col" [style.height.px]="bodyH()" [class.drop-target]="dragId() && overDow() === c.v.dow"
                   (dragover)="onDragOver($event, c.v.dow)" (dragleave)="onDragLeave(c.v.dow)" (drop)="onDrop(c.v.dow)"
                   (mousemove)="onMove($event, c)" (mouseleave)="ghost.set(null)">
                @for (h of hours(); track h) { <div class="eg-line" [style.top.px]="(h - range()[0]) * hourH()"></div> }
                @for (b of c.blocks; track b.s.id) {
                  <!-- Un cours importé d'ÉcoleDirecte se lit, il ne s'édite ni ne se déplace : il vient du serveur. -->
                  <div class="eg-slot" role="button" tabindex="0" [attr.draggable]="!ed(b.s.id)"
                       [class.ed]="ed(b.s.id)" [class.cancelled]="cancelled(b.s.id)" [class.vert]="vertical(b)" [class.short]="b.height < 50" [class.dragging]="dragId() === b.s.id"
                       [style.top.px]="b.top" [style.height.px]="b.height" [style.left.%]="b.left" [style.width.%]="b.width"
                       [style.background]="slotBg(b.s)" [title]="slotTitle(b.s)"
                       (dragstart)="onDragStart(b.s)" (dragend)="onDragEnd()" (click)="open(b.s, c.v)" (keydown.enter)="open(b.s, c.v)">
                    <f-who class="eg-who" [badges]="badges(b.s)" [size]="16" />
                    <span class="eg-t">{{ b.s.label }}</span>
                    @if (!vertical(b) && b.height >= 34) {
                      <span class="eg-time">{{ b.s.start }}@if (b.s.end && b.height > 60) { – {{ b.s.end }} }@if (cancelled(b.s.id)) { · annulé } @else if (modified(b.s.id)) { · modifié }</span>
                    }
                  </div>
                }
                <!-- Le creux survolé : une heure en pointillés, à l'heure pleine, pour y ajouter un créneau. -->
                @if (ghost(); as g) {
                  @if (g.dow === c.v.dow) {
                    <button class="eg-ghost" [style.top.px]="(g.hour - range()[0]) * hourH()" (click)="store.newSlot(c.v.dow, hhmm(g.hour))">+ {{ hhmm(g.hour) }}</button>
                  }
                }
                @if (c.v.today && nowTop() !== null) { <div class="eg-now" [style.top.px]="nowTop()" aria-hidden="true"></div> }
                @if (!c.v.slots.length && store.ui().schedWho.length) { <div class="eg-free">Rien pour ce filtre</div> }
              </div>
            }
          </div>
        </div>
        <div class="legend">
          @for (t of legend(); track t.k) { <span><span class="lg-sq" [style.background]="t.color"></span>{{ t.label }}</span> }
          @if (hasEd()) { <span><span class="lg-sq hatch"></span>cours ÉcoleDirecte annulé</span> }
        </div>
      }
    </div>

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
    .members { display: flex; flex-wrap: wrap; gap: 6px; }
    /* Le filtre par membre : l'avatar et le prénom, sans fond ; le membre retenu se pose sur la surface. */
    .pill { display: flex; align-items: center; gap: 8px; padding: 4px 12px 4px 4px; border-radius: 999px; cursor: pointer; border: 1px solid transparent; background: none; color: var(--ink2); font: inherit; font-weight: 800; font-size: 14px; }
    .pill:hover { color: var(--ink); }
    .pill.active { background: var(--surface); border-color: var(--line2); color: var(--ink); }
    .head-row .btn { flex: none; }
    :host-context(.shell.narrow) .head-row { margin-bottom: 12px; }
    :host-context(.shell.narrow) .pill { font-size: 13px; gap: 6px; }

    .filter-bar, .warn-bar, .clip-bar { display: flex; align-items: center; gap: 9px; padding: 10px 14px; border-radius: 13px; margin-bottom: 14px; font-size: 13px; font-weight: 700; flex-wrap: wrap; }
    .filter-bar { background: var(--soft2); color: var(--ink2); }
    .clip-bar { background: color-mix(in srgb, var(--primary) 12%, var(--surface)); color: var(--ink); }
    .clip-bar span { flex: 1; min-width: 0; }
    .clear.ghost { background: transparent; padding: 6px 8px; display: inline-flex; }
    .warn-bar { background: var(--status-crit-bg); color: var(--status-crit); }
    .filter-bar span, .warn-bar span { flex: 1; min-width: 0; }
    .clear { border: none; cursor: pointer; background: var(--surface); color: var(--ink); border-radius: 9px; padding: 6px 12px; font-size: 12px; font-weight: 800; font-family: inherit; }

    .blank { background: var(--surface); border-radius: 18px; padding: 34px 20px; text-align: center; border: 1px solid var(--line); }
    .blank-title { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--ink); }
    .blank-sub { font-size: 13.5px; font-weight: 600; color: var(--ink2); margin: 6px 0 18px; }
    .blank .btn { display: inline-flex; }

    .week-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
    .week-label { flex: 1; min-width: 0; font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--ink); }
    .icon-btn { border: none; background: var(--soft2); border-radius: 9px; padding: 5px 7px; cursor: pointer; display: inline-flex; line-height: 0; }

    /* Téléphone : le sélecteur de jour. Le jour choisi en encre pleine, aujourd'hui en orange. */
    .day-strip { display: flex; gap: 4px; margin-bottom: 14px; }
    .dbtn { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 2px; border: none; border-radius: 12px; background: none; color: var(--ink2); font-family: inherit; cursor: pointer; }
    .dbtn.today { color: var(--primary); }
    .dbtn.on { background: var(--ink); color: var(--surface); }
    .dbtn-name { font-size: 11.5px; font-weight: 700; }
    .dbtn-num { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: inherit; }
    .dbtn:not(.on):not(.today) .dbtn-num { color: var(--ink); }
    .dbtn-count { font-size: 10.5px; font-weight: 800; opacity: .75; }
    .dbtn-count.zero { opacity: .35; }

    /* ===== la grille horaire ===== */
    .eg { --gutter: 38px; }
    .eg-row { display: grid; grid-template-columns: var(--gutter) repeat(var(--days, 7), minmax(0, 1fr)); gap: 0 6px; }
    .eg-heads { margin-bottom: 4px; }
    .eg-head { display: flex; align-items: center; gap: 5px; min-width: 0; padding: 4px 2px 6px; font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .eg-head.today .eg-day { color: var(--primary); }
    .eg-day { white-space: nowrap; }
    .eg-n { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .eg-tag { font-size: 10.5px; font-weight: 800; color: var(--primary); white-space: nowrap; }
    .eg-acts { margin-left: auto; display: flex; gap: 2px; flex: none; }
    .eg-act { display: inline-flex; align-items: center; gap: 4px; border: none; background: none; border-radius: 7px; padding: 4px 5px; color: var(--ink2); font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
    .eg-act:hover { background: var(--soft2); color: var(--ink); }
    .eg-act.paste { color: var(--primary); }
    .reveal { opacity: 0; transition: opacity .15s ease; }
    .eg-head:hover .reveal, .eg-head:focus-within .reveal { opacity: 1; }
    @media (hover: none) { .reveal { opacity: 1; } }
    .eg-allday { margin-bottom: 6px; }
    .eg-gl, .eg-hour { font-size: 10.5px; font-weight: 800; color: var(--ink3); text-align: right; }
    .eg-gl { padding: 6px 6px 0 0; }
    .eg-ad { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .eg-adbar { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 24px; border: none; border-radius: 7px; padding: 3px 4px 3px 8px; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--ink); cursor: pointer; text-align: left; }
    .eg-adl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .eg-body { align-items: start; }
    .eg-gutter { position: relative; }
    .eg-hour { position: absolute; right: 6px; transform: translateY(-6px); }
    .eg-col { position: relative; min-width: 0; box-shadow: inset 1px 0 0 var(--line); border-top: 1px solid var(--line2); }
    .eg-col.drop-target { background: var(--soft); }
    .eg-line { position: absolute; left: 0; right: 0; height: 1px; background: var(--line); pointer-events: none; }
    /* Un créneau : un aplat de la couleur de son type, sans bordure ; le titre à l'encre, l'heure en gris. */
    .eg-slot { position: absolute; z-index: 1; box-sizing: border-box; border: 1px solid var(--surface); border-radius: 8px; padding: 4px 6px; overflow: hidden; cursor: pointer; display: flex; flex-direction: column; gap: 1px; }
    .eg-slot:focus-visible { outline: 2px solid var(--ink3); }
    .eg-slot[draggable="true"] { cursor: grab; }
    .eg-slot.dragging { opacity: .4; }
    .eg-who { position: absolute; top: 4px; right: 4px; }
    .eg-t { font-size: 12.5px; font-weight: 800; color: var(--ink); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; padding-right: 18px; }
    .eg-slot.short .eg-t { white-space: nowrap; }
    .eg-time { font-size: 11px; font-weight: 700; color: var(--ink2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Trop étroit pour un titre couché : il se lit debout, l'avatar au-dessus. */
    .eg-slot.vert { align-items: center; padding: 4px 2px; gap: 6px; }
    .eg-slot.vert .eg-who { position: static; }
    .eg-slot.vert .eg-t { writing-mode: vertical-rl; transform: rotate(180deg); padding: 0; white-space: nowrap; max-height: calc(100% - 26px); }
    /* Un cours annulé : un aplat pâle hachuré de sa couleur, le titre barré. */
    .eg-slot.cancelled .eg-t { color: var(--ink2); text-decoration: line-through; }
    .eg-ghost { position: absolute; left: 3px; right: 3px; z-index: 0; height: calc(var(--hour-h) - 4px); margin-top: 2px; border: 1.5px dashed var(--line2); border-radius: 8px; background: none; color: var(--ink2); font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
    .eg-ghost:hover { color: var(--ink); border-color: var(--ink3); }
    .eg-now { position: absolute; left: 0; right: 0; height: 2px; background: var(--primary); z-index: 2; pointer-events: none; }
    .eg-now::before { content: ''; position: absolute; left: -4px; top: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--primary); }
    .eg-free { position: absolute; top: 12px; left: 0; right: 0; text-align: center; font-size: 12px; font-weight: 700; color: var(--ink3); pointer-events: none; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .legend > span { display: inline-flex; align-items: center; gap: 6px; }
    .lg-sq { width: 8px; height: 8px; border-radius: 2px; flex: none; }
    .lg-sq.hatch { width: 12px; height: 12px; background: repeating-linear-gradient(135deg, var(--ink3) 0 1.5px, transparent 1.5px 4px); }

    .hint { font-size: 12px; font-weight: 700; color: var(--ink2); margin: 8px 0 16px; line-height: 1.35; }
    .del-opts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .del-opts .btn { flex: 1 1 auto; }
    .report { background: var(--soft); border-radius: 13px; padding: 12px 14px; margin: 14px 0 4px; font-size: 13px; font-weight: 700; color: var(--ink2); }
    .report.destructive { background: var(--status-crit-bg); }
    .report .line + .line { margin-top: 5px; }
    .report .strong { color: var(--status-crit); font-weight: 800; }

    .seg.wrap { flex-wrap: wrap; margin-bottom: 6px; }
    .seg > button:disabled { opacity: .35; cursor: default; }
    .field-label { margin-top: 4px; }

    .who-opts { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 8px; }
    .who-opt { display: flex; align-items: center; gap: 8px; padding: 7px 14px 7px 7px; border-radius: 13px; background: var(--soft); color: var(--ink); font-size: 13.5px; font-weight: 800; cursor: pointer; border: 2px solid transparent; }
    .who-opt.on { background: var(--soft2); }

    .modal-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
    .modal-actions .spacer { flex: 1; }
    /* Sur téléphone, les boutons se partagent la largeur : rien ne sort de l'écran. */
    :host-context(.shell.narrow) .modal-actions { flex-wrap: wrap; }
    :host-context(.shell.narrow) .modal-actions .spacer { display: none; }
    :host-context(.shell.narrow) .modal-actions .btn-soft,
    :host-context(.shell.narrow) .modal-actions .btn-primary { flex: 1; }
  `],
})
export class PlanningScreen {
  store = inject(FoyerStore);
  d = this.store.d;

  days = [1, 2, 3, 4, 5, 6, 7];

  label(dow: number): string { return dowLabel(dow); }
  filtered(id: string): boolean { return this.store.schedFilter().includes(id); }

  /**
   * La semaine affichée, résolue une seule fois pour les deux vues.
   *
   * Elle est **datée** : la semaine type est le modèle, mais sans date on ne
   * saurait ni si un créneau est encore valide, ni si c'est les vacances, ni où
   * poser un créneau ponctuel.
   */
  readonly week = computed<DayView[]>(() => {
    // Les créneaux du foyer et les cours importés d'ÉcoleDirecte, côte à côte.
    const sched = this.store.schedAll();
    const who = this.store.schedFilter();
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

  // ---- la grille horaire ---------------------------------------------------
  readonly hourH = computed(() => this.store.narrow() ? HOUR_H_NARROW : HOUR_H);
  /** Chaque jour de la semaine, ses créneaux de toute la journée à part, les autres posés par layoutTimed. */
  private readonly placed = computed(() => this.week().map((v) => ({
    v,
    allDay: v.slots.filter((s) => isWholeDay(s.start, s.end)),
    timed: layoutTimed(v.slots.filter((s) => !isWholeDay(s.start, s.end)).map((s) => ({ item: s, start: s.start, end: s.end })), { minDur: 30 }),
  })));
  /** La plage d'heures pleines de la semaine, bornée à 6 h – 22 h ; 7 h – 19 h sans créneau. Stable d'un jour à l'autre. */
  readonly range = computed(() => hourRange(this.placed().flatMap((d) => d.timed)));
  readonly hours = computed(() => { const [a, b] = this.range(); return Array.from({ length: b - a + 1 }, (_, i) => a + i); });
  readonly bodyH = computed(() => (this.range()[1] - this.range()[0]) * this.hourH());
  /** Ce que la grille dessine : le jour retenu sur téléphone, la semaine ailleurs. */
  readonly cols = computed<DayCol[]>(() => {
    const [from, to] = this.range();
    const h = this.hourH();
    const narrow = this.store.narrow();
    const dow = this.store.ui().schedDow;
    // Un créneau hors de la plage (avant 6 h, après 22 h) reste visible, ramené au bord.
    const block = (p: Placed<SchedSlot>): Block => {
      const s0 = Math.min(Math.max(p.s, from * 60), to * 60 - 15);
      const e0 = Math.max(Math.min(p.e, to * 60), s0 + 15);
      return { s: p.item, top: ((s0 - from * 60) / 60) * h, height: Math.max(18, ((e0 - s0) / 60) * h), left: (p.col / p.cols) * 100, width: 100 / p.cols };
    };
    return this.placed().filter((d) => !narrow || d.v.dow === dow).map((d) => ({ v: d.v, allDay: d.allDay, blocks: d.timed.map(block) }));
  });
  readonly hasAllDay = computed(() => this.cols().some((c) => c.allDay.length));
  /** Les types présents, pour la légende ; le motif hachuré s'y ajoute dès qu'un cours ÉcoleDirecte est là. */
  readonly legend = computed(() => { const ks = new Set(this.cols().flatMap((c) => c.v.slots.map((s) => s.k))); return SCHED_TYPES.filter((t) => ks.has(t.k)); });
  readonly hasEd = computed(() => this.cols().some((c) => c.v.slots.some((s) => this.ed(s.id))));

  /** La largeur d'une colonne, mesurée : un créneau trop étroit écrit son titre debout. */
  private readonly hostW = signal(0);
  private readonly host = inject(ElementRef<HTMLElement>);
  vertical(b: Block): boolean {
    const n = this.cols().length || 1;
    const colW = (this.hostW() - GUTTER - COL_GAP * n) / n;
    return colW > 0 && (colW * b.width) / 100 < 64 && b.height > 100;
  }

  /** L'heure qu'il est, en minutes, pour le trait « maintenant ». Rafraîchie chaque minute. */
  private readonly nowMin = signal(this.readNow());
  private readNow(): number { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  readonly nowTop = computed(() => {
    const [from, to] = this.range(); const m = this.nowMin();
    return m < from * 60 || m > to * 60 ? null : ((m - from * 60) / 60) * this.hourH();
  });

  constructor() {
    const destroy = inject(DestroyRef);
    try {
      const tick = setInterval(() => this.nowMin.set(this.readNow()), 60_000);
      destroy.onDestroy(() => clearInterval(tick));
    } catch { /* pas de minuterie : le trait reste à l'heure d'ouverture */ }
    afterNextRender(() => {
      const el = this.host.nativeElement as HTMLElement;
      this.hostW.set(el.clientWidth);
      if ('ResizeObserver' in window) {
        const ro = new ResizeObserver((e) => this.hostW.set(e[0].contentRect.width));
        ro.observe(el);
        destroy.onDestroy(() => ro.disconnect());
      }
    });
  }

  /**
   * Le creux survolé, à l'heure pleine : un fantôme d'une heure y propose
   * « + 11:00 ». Seulement sur une heure libre de la colonne, jamais pendant un
   * glisser. Au clavier, le « + » de l'en-tête du jour fait la même chose.
   */
  readonly ghost = signal<{ dow: number; hour: number } | null>(null);
  onMove(e: MouseEvent, c: DayCol): void {
    const t = e.target as HTMLElement;
    if (t.closest('.eg-ghost')) return;
    const col = e.currentTarget as HTMLElement;
    const [from, to] = this.range();
    const h = this.hourH();
    const hour = from + Math.floor((e.clientY - col.getBoundingClientRect().top) / h);
    const top = (hour - from) * h;
    const free = !this.dragId() && !t.closest('.eg-slot') && hour >= from && hour < to
      && !c.blocks.some((b) => b.top < top + h && b.top + b.height > top);
    const cur = this.ghost();
    if (!free) { if (cur) this.ghost.set(null); return; }
    if (cur?.dow !== c.v.dow || cur.hour !== hour) this.ghost.set({ dow: c.v.dow, hour });
  }
  hhmm(h: number): string { return String(h).padStart(2, '0') + ':00'; }

  open(s: SchedSlot, v: DayView): void { this.store.openItem('slot', s.id, { occ: v.date }); }
  /** « le mercredi 14 », pour les libellés des boutons du jour. */
  dayName(v: DayView): string { return 'le ' + v.label.toLowerCase() + ' ' + v.num; }
  mix(color: string, pct: number): string { return `color-mix(in srgb, ${color} ${pct}%, var(--surface))`; }
  /** L'aplat d'un créneau ; un cours annulé est plus pâle et hachuré de sa couleur. */
  slotBg(s: SchedSlot): string {
    const c = this.color(s.k);
    return this.cancelled(s.id) ? `repeating-linear-gradient(135deg, ${this.mix(c, 34)} 0 2px, transparent 2px 7px), ${this.mix(c, 8)}` : this.mix(c, 24);
  }
  /** Le survol dit tout ce que la carte ne dit plus : l'heure, le type, la période, « dehors ». */
  slotTitle(s: SchedSlot): string {
    const ed = this.ed(s.id) ? 'ÉcoleDirecte' + (this.cancelled(s.id) ? ', annulé' : this.modified(s.id) ? ', modifié' : '') : '';
    return [s.label, s.end ? s.start + ' – ' + s.end : s.start, this.typeLabel(s.k), ed || this.noteOf(s)].filter(Boolean).join(' · ');
  }

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

  /** Ce qui, sur la ligne, dit qu'un créneau n'a pas lieu toute l'année. */
  noteOf(s: SchedSlot): string {
    const cadence = s.rec === 'weekly' && s.interval && s.interval > 1 ? '1 sem. sur ' + s.interval : '';
    // Un « à partir du » déjà passé, sur un créneau hebdomadaire simple, n'apprend
    // rien : le créneau a commencé et il est là. On le tait pour ne pas répéter la
    // même date sur chaque ligne, tout en le gardant pour un démarrage futur, une
    // fin, un filtre ou une cadence bimensuelle.
    const startedPlain = !!s.from && !s.until && (!s.when || s.when === 'always') && !(s.interval && s.interval > 1) && s.from <= this.store.todayStr();
    const valid = startedPlain ? '' : validityLabel(s, (iso) => this.store.fmtNumDate(iso));
    const quand = s.rec === 'once'
      ? (s.srcId ? 'ce jour seulement' : 'ponctuel')
      : [cadence, valid, WHEN_LABELS[s.when || 'always']].filter(Boolean).join(' · ');
    return [quand, s.away ? 'dehors' : ''].filter(Boolean).join(' · ');
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

  onDragStart(s: SchedSlot): void { if (!this.ed(s.id)) this.dragId.set(s.id); }

  // ---- cours importés (lecture seule) -------------------------------------
  private ecole = inject(EcoleStore);
  private readonly lessonById = computed(() => new Map(this.ecole.lessons().map((l) => ['ed:' + l.id, l])));
  ed(id: string): boolean { return isEdSlot(id); }
  cancelled(id: string): boolean { return !!this.lessonById().get(id)?.cancelled; }
  modified(id: string): boolean { return !!this.lessonById().get(id)?.modified; }
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
}
