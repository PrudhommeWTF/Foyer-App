import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FoyerStore, DayExtra } from '../../core/foyer.store';
import { AdminStore } from '../../core/admin.store';
import { EmployesStore } from '../../core/employes.store';
import { IconComponent } from '../../core/icon';
import { WhoComponent } from '../../shared/who';
import { AgendaRowComponent } from '../../shared/agenda-row';
import { DOW, RECUR_LABELS, CAL_KINDS, SCHED_COLORS, SCHED_DAYS } from '../../core/constants';
import { cap, parseDay, dstr, fmtShortDay, isoWeek, mondayOf } from '../../core/helpers';
import { layoutTimed } from '../../core/day-layout';
import { EventItem, Recur } from '../../core/models';
import { SlotEvent, WhoBadge, whoBadges } from '../../core/schedule';
import { HolidayBand, holidayBands } from '../../core/agenda';

/** Le libellé gris d'un repère, là où un événement a son heure. */
const EXTRA_LABELS: Record<string, string> = {
  task: 'Tâche', birthday: 'Anniv.', holiday: 'Férié', school: 'Vacances', echeance: 'Échéance', cesu: 'CESU', ecole: 'Interro', garantie: 'Garantie',
};
const SHORT_DOW = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const SHORT_MON = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Un élément d'agenda du jour : un événement propre, ou une occurrence de créneau publié. Trié par heure, les deux mêlés. */
type DayItem = { t: string; kind: 'event'; ev: EventItem } | { t: string; kind: 'slot'; se: SlotEvent };
/** `covered` : au moins une barre « journée entière » traverse ce jour (il n'est donc pas libre). */
interface MonthCell { key: string; num: number; inMonth: boolean; items: DayItem[]; extras: DayExtra[]; more: number; covered: boolean; }
/** Une barre d'événement sur la journée entière dans une semaine du mois : de la colonne `col`, sur `span` jours, sur la voie `lane`. */
interface Bar { id: string; ev: EventItem; col: number; span: number; lane: number; startsHere: boolean; endsHere: boolean; }
interface WeekRow { key: string; week: number; days: MonthCell[]; bars: Bar[]; hbars: HolidayBand[]; lanes: number; }
/** Un élément posé dans la grille horaire : sa place en pourcentage de la journée, et sa colonne de chevauchement. */
interface PlacedItem { it: DayItem; top: number; height: number; left: number; width: number; }
/** Une rangée de l'échéancier (affichage Liste) : la date, puis les vacances qui commencent là, les éléments et les repères. */
interface ListDay { key: string; num: number; mon: string; dow: string; long: string; isToday: boolean; isSel: boolean; items: DayItem[]; extras: DayExtra[]; hols: { name: string; range: string }[]; }
/** Une colonne-jour de la grille horaire : en-tête, bandeau « journée entière » et éléments horaires posés. */
interface GridCol { key: string; dow: string; num: number; isToday: boolean; isSel: boolean; allDay: EventItem[]; extras: DayExtra[]; timed: PlacedItem[]; }

// Gabarit d'une case du mois, en miroir de la CSS `.mcell` : la hauteur d'une
// case (min-height), l'espace réservé en haut (numéro du jour + voies de barres
// « journée entière ») et la hauteur d'une pastille. La vue mois s'en sert pour
// remplir chaque case jusqu'au bord avant de replier le surplus en « +x »,
// plutôt qu'un plafond fixe. Recalculé à chaque changement de taille de fenêtre.
const CELL_CHROME = 268;   // espace vertical hors grille (cf. calc((100vh - 268)/6))
const CELL_MIN = 94;       // min-height plancher sur grand écran
const CELL_MIN_NARROW = 68; // min-height sur mobile (max-width: 860px)
const CELL_PAD_TOP = 26;   // padding haut de base (numéro du jour)
const CELL_LANE_H = 20;    // hauteur d'une voie de barre (par --lanes)
const CELL_PAD_BOTTOM = 6;
const CHIP_H = 16;         // hauteur d'une pastille (.chip-ev / .chip-ex)
const CHIP_GAP = 3;        // gouttière verticale entre pastilles
const MORE_H = 13;         // hauteur de la mention « +x »

// La grille horaire des vues Semaine / 3 jours (`.tg-body`) tenait sur 24 heures
// d'une hauteur fixe (`--hour-h`), laissant du vide sous elle sur grand écran.
// On mesure la place réellement disponible sous son haut (le bandeau « journée
// entière » qui la précède peut grandir) et on étire l'heure pour l'occuper,
// sans jamais descendre sous la hauteur de base (fenêtre courte : la grille
// garde sa taille lisible et la page défile, comme avant).
const HOUR_H_MIN = 27;         // --hour-h de base (grand écran)
const HOUR_H_MIN_NARROW = 24;  // --hour-h de base (mobile)
const GRID_BOTTOM_GAP = 40;    // marge conservée sous la grille jusqu'au bas de la fenêtre

@Component({
  selector: 'screen-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, IconComponent, WhoComponent, AgendaRowComponent],
  template: `
    <div class="screen-enter">
      <div class="cal-wrap" [class.no-side]="!store.ui().calSide && !store.narrow()">
        <!-- ===== calendar card ===== -->
        <div class="card cal-card">
          <div class="cal-head">
            <div class="head-left">
              <div class="cal-title f-display">{{ headerLabel() }}</div>
              <button class="today-btn" (click)="goToday()">Aujourd'hui</button>
            </div>
            <div class="head-right">
              <div class="seg2">
                <button [class.active]="cv() === '3'" (click)="setView('3')">3 jours</button>
                <button [class.active]="cv() === 'week'" (click)="setView('week')">Semaine</button>
                <button [class.active]="cv() === 'month'" (click)="setView('month')">Mois</button>
              </div>
              @if (cv() !== 'month') {
                <div class="seg2 disp" title="Affichage des vues Semaine et 3 jours">
                  <button [class.active]="display() === 'grid'" (click)="setDisplay('grid')" title="Grille horaire (24 h)"><f-icon name="clock" [size]="15" [color]="display() === 'grid' ? 'var(--ink)' : 'var(--ink2)'" [width]="2.2" /></button>
                  <button [class.active]="display() === 'list'" (click)="setDisplay('list')" title="Liste"><f-icon name="taches" [size]="15" [color]="display() === 'list' ? 'var(--ink)' : 'var(--ink2)'" [width]="2.2" /></button>
                </div>
              }
              <div class="navs">
                <button class="nav-btn" (click)="nav(-1)"><f-icon name="chevronLeft" [size]="18" color="var(--ink2)" [width]="2.2" /></button>
                <button class="nav-btn" (click)="nav(1)"><f-icon name="chevronRight" [size]="18" color="var(--ink2)" [width]="2.2" /></button>
              </div>
              @if (!store.narrow()) {
                <button class="nav-btn side-toggle" [class.active]="store.ui().calSide" (click)="toggleSide()"
                        [title]="store.ui().calSide ? 'Masquer le panneau' : 'Afficher le panneau'" [attr.aria-label]="store.ui().calSide ? 'Masquer le panneau' : 'Afficher le panneau'">
                  <f-icon name="panelRight" [size]="17" [color]="store.ui().calSide ? 'var(--primary)' : 'var(--ink2)'" [width]="2.2" />
                </button>
              }
            </div>
          </div>

          @if (cv() === 'month') {
            <div class="dow-row">
              @for (w of weekdays; track w) { <div class="dow">{{ w }}</div> }
            </div>
            <div class="month">
              @for (wk of weeks(); track wk.key) {
                <div class="week" [style.--lanes]="wk.lanes">
                  <div class="week-cells">
                    @for (c of wk.days; track c.key; let first = $first) {
                      <div class="mcell" [class.sel]="c.key === sel()" [class.today]="c.key === store.todayStr()" [class.dim]="!c.inMonth"
                           (click)="cellClick(c)" (dblclick)="addAt(c.key)">
                        @if (first) { <span class="wknum" title="Semaine">S{{ wk.week }}</span> }
                        <span class="mnum">{{ c.num }}</span>
                        @for (it of c.items; track $index) {
                          @if (it.kind === 'event') {
                            <!-- Avec une heure, c'est l'heure qui porte la couleur ; sans heure, un point. -->
                            <div class="chip-ev tap" (click)="openEventChip($event, it.ev.id, c.key)">
                              @if (hasTime(it.ev)) { <span class="ch-t" [style.color]="eventColor(it.ev)">{{ it.ev.time }}</span> }
                              @else { <span class="ch-dot" [style.background]="eventColor(it.ev)"></span> }
                              <span class="ch-l">{{ it.ev.title }}</span>
                            </div>
                          } @else {
                            <div class="chip-ev tap slotev" (click)="openSlot($event, it.se)">
                              <span class="ch-t" [style.color]="slotColor(it.se.k)">{{ it.se.time }}</span>
                              <span class="ch-l">{{ it.se.title }}</span>
                            </div>
                          }
                        }
                        @for (ex of c.extras; track $index) {
                          <div class="chip-ev" [class.tap]="ex.id" (click)="openExtra($event, ex)">
                            @if (ex.kind === 'task') { <span class="ch-box"></span> } @else { <span class="ch-dot" [style.background]="ex.color"></span> }
                            <span class="ch-l" [class.strike]="ex.done">{{ ex.label }}</span>
                          </div>
                        }
                        @if (c.more) { <span class="more">+{{ c.more }}</span> }
                      </div>
                    }
                  </div>
                  @if (wk.bars.length || wk.hbars.length) {
                    <div class="week-bars">
                      @for (b of wk.bars; track b.id) {
                        <div class="bar tap" [class.ol]="!b.startsHere" [class.or]="!b.endsHere"
                             [style.grid-column]="b.col + ' / span ' + b.span" [style.grid-row]="b.lane + 1"
                             [style.background]="eventColor(b.ev)" (click)="openEventChip($event, b.ev.id)">{{ b.startsHere ? b.ev.title : '' }}</div>
                      }
                      @for (b of wk.hbars; track b.name + b.col) {
                        <div class="bar hband" [class.ol]="!b.startsHere" [class.or]="!b.endsHere"
                             [style.grid-column]="b.col + ' / span ' + b.span" [style.grid-row]="b.lane + 1">{{ b.startsHere ? b.name : '' }}</div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          } @else {
            @if (display() === 'grid') {
              <div class="tgrid" [class.narrow]="store.narrow()" [style.--cols]="grid().length" [style.--hour-h]="hourH() + 'px'">
                <div class="tg-row tg-heads">
                  <div class="tg-gutter-cell"></div>
                  @for (col of grid(); track col.key) {
                    <button class="tg-head" [class.today]="col.isToday" [class.sel]="col.isSel" (click)="selectDay(col.key)" (dblclick)="addAt(col.key)">
                      {{ col.dow }} {{ col.num }}
                    </button>
                  }
                </div>
                <!-- Les vacances, soulignées d'un trait miel sur toute leur durée, au-dessus des colonnes. -->
                @if (dayBands().length) {
                  <div class="tg-row tg-hbands">
                    <div class="tg-gutter-cell"></div>
                    <div class="tg-hb-in" [style.grid-template-columns]="'repeat(' + grid().length + ',minmax(0,1fr))'">
                      @for (b of dayBands(); track b.name + b.col) {
                        <div class="tg-hband" [style.grid-column]="b.col + ' / span ' + b.span" [style.grid-row]="b.lane + 1">{{ b.name }}</div>
                      }
                    </div>
                  </div>
                }
                <!-- Le bandeau « journée entière » : événements sans heure et repères (tâches, anniversaires…), qui ne tiennent pas dans l'horaire. -->
                <div class="tg-row tg-allday">
                  <div class="tg-gutter-cell tg-ad-label">journée</div>
                  @for (col of grid(); track col.key) {
                    <div class="tg-ad-cell">
                      @for (ev of col.allDay; track ev.id) {
                        <div class="tg-ad-chip tap" (click)="openEv(ev.id, col.key)"><span class="ch-dot" [style.background]="eventColor(ev)"></span><span class="ch-l">{{ ev.title }}</span></div>
                      }
                      @for (ex of col.extras; track $index) {
                        <div class="tg-ad-chip" [class.tap]="ex.id" (click)="openExtra($event, ex)"><span class="ch-dot" [style.background]="ex.color"></span><span class="ch-l" [class.strike]="ex.done">{{ ex.label }}</span></div>
                      }
                    </div>
                  }
                </div>
                <!-- La grille des 24 heures : gouttière des heures, puis une colonne par jour où les événements sont posés à leur heure, les chevauchements côte à côte. -->
                <div class="tg-row tg-body">
                  <div class="tg-gutter">
                    @for (h of tgHours; track h) { <div class="tg-hour"><span>{{ hourLabel(h) }}</span></div> }
                  </div>
                  @for (col of grid(); track col.key) {
                    <div class="tg-col" [class.today]="col.isToday">
                      @for (h of tgHours; track h) { <div class="tg-line"></div> }
                      @for (p of col.timed; track $index) {
                        @if (p.it.kind === 'event') {
                          <!-- Un aplat de la couleur, sans bordure : le titre reste à l'encre. -->
                          <div class="tg-ev" [style.top.%]="p.top" [style.height.%]="p.height" [style.left.%]="p.left" [style.width.%]="p.width"
                               [style.background]="mix(eventColor(p.it.ev), 24)" (click)="openEv(p.it.ev.id, col.key)">
                            <span class="tg-ev-title">{{ p.it.ev.title }}</span>
                            <span class="tg-ev-t">{{ timeLabel(p.it.ev) }}</span>
                          </div>
                        } @else {
                          <div class="tg-ev slotev" [style.top.%]="p.top" [style.height.%]="p.height" [style.left.%]="p.left" [style.width.%]="p.width"
                               [style.background]="mix(slotColor(p.it.se.k), 14)" (click)="openSlot($event, p.it.se)">
                            <span class="tg-ev-title"><f-icon name="planning" [size]="11" color="var(--ink2)" [width]="2.4" /> {{ p.it.se.title }}</span>
                            <span class="tg-ev-t">{{ p.it.se.time }}{{ p.it.se.end ? ' – ' + p.it.se.end : '' }}</span>
                          </div>
                        }
                      }
                      @if (col.isToday) { <div class="tg-now" [style.top.%]="nowMin() / 14.4" aria-hidden="true"></div> }
                    </div>
                  }
                </div>
              </div>
            } @else {
              <!-- L'échéancier : un jour par rangée, la date dans la gouttière, puis la journée, ligne à ligne. -->
              <div class="ag-list" style="--agenda-hover: var(--soft)">
                @for (day of listDays(); track day.key) {
                  @let empty = !day.items.length && !day.extras.length && !day.hols.length;
                  <div class="ag-day">
                    <button class="ag-g" [class.today]="day.isToday" [class.sel]="day.isSel" (click)="selectDay(day.key)" (dblclick)="addAt(day.key)"
                            [attr.aria-label]="'Choisir le ' + day.long">
                      <span class="ag-num f-display">{{ day.num }}</span>
                      <span class="ag-mon">{{ day.mon }} · {{ day.dow }}</span>
                    </button>
                    <div class="ag-body">
                      @for (h of day.hols; track h.name) {
                        <div class="band-row"><span class="band-l"></span>{{ h.name }}<small>{{ h.range }}</small></div>
                      }
                      @for (it of day.items; track $index) {
                        <ng-container [ngTemplateOutlet]="agItem" [ngTemplateOutletContext]="{ $implicit: it, key: day.key }" />
                      }
                      @for (ex of day.extras; track $index) {
                        <ng-container [ngTemplateOutlet]="agExtra" [ngTemplateOutletContext]="{ $implicit: ex }" />
                      }
                      @if (empty) {
                        <div class="ag-free">Libre · <button class="reg-link" (click)="addAt(day.key)">Ajouter</button></div>
                      } @else {
                        <button class="ag-add" (click)="addAt(day.key)"><f-icon name="plus" [size]="13" color="currentColor" [width]="2.4" /> Ajouter</button>
                      }
                    </div>
                  </div>
                }
              </div>
            }
          }
        </div>

        <!-- ===== agenda side panel ===== -->
        <div class="side">
          @if (!store.isChild()) { <button class="btn btn-primary btn-block add-ev" (click)="store.openItem('event', null)"><f-icon name="plus" [size]="18" color="#fff" /> Ajouter un événement</button> }
          @if (admin.icsUrl()) {
            <button class="btn btn-soft btn-block ics-btn" (click)="copyIcs()"><f-icon name="copy" [size]="16" color="var(--ink2)" [width]="2.2" /> Copier le lien du calendrier (ICS)</button>
          }
          <!-- Filtres : chaque case montre ou cache un type d'élément dans toutes les vues. -->
          <div class="filters">
            @for (fk of filterKinds(); track fk.k) {
              <button class="filt" [class.off]="!shown(fk.k)" (click)="toggleKind(fk.k)" [attr.aria-pressed]="shown(fk.k)">
                <span class="filt-box" [style.background]="shown(fk.k) ? fk.color : 'transparent'" [style.border-color]="fk.color">
                  @if (shown(fk.k)) { <f-icon name="check" [size]="11" color="#fff" [width]="3.4" /> }
                </span>
                <span class="filt-lbl">{{ fk.label }}</span>
              </button>
            }
          </div>
          <!-- Sur mobile, le mini-calendrier et le détail du jour sélectionné sont
               masqués (voir .side-detail) : la vue principale et le bouton d'ajout
               suffisent, et l'écran reste court. -->
          <div class="side-detail">
          <!-- Un mini-calendrier plutôt qu'une date en toutes lettres : il montre
               le mois d'un coup d'oeil et permet de sauter à n'importe quel jour,
               numéros de semaine compris. -->
          <div class="mini">
            <div class="mini-head">
              <div class="mini-title f-display">{{ miniLabel() }}</div>
              <div class="mini-navs">
                <button class="mini-nav" title="Année précédente" (click)="miniNav('year', -1)"><f-icon name="chevronLeft" [size]="13" color="var(--ink2)" [width]="2.6" /><f-icon name="chevronLeft" [size]="13" color="var(--ink2)" [width]="2.6" /></button>
                <button class="mini-nav" title="Mois précédent" (click)="miniNav('month', -1)"><f-icon name="chevronLeft" [size]="15" color="var(--ink2)" [width]="2.4" /></button>
                <button class="mini-nav" title="Mois suivant" (click)="miniNav('month', 1)"><f-icon name="chevronRight" [size]="15" color="var(--ink2)" [width]="2.4" /></button>
                <button class="mini-nav" title="Année suivante" (click)="miniNav('year', 1)"><f-icon name="chevronRight" [size]="13" color="var(--ink2)" [width]="2.6" /><f-icon name="chevronRight" [size]="13" color="var(--ink2)" [width]="2.6" /></button>
              </div>
            </div>
            <div class="mini-grid">
              <span class="mini-wk mini-corner"></span>
              @for (w of miniDows; track $index) { <span class="mini-dow">{{ w }}</span> }
              @for (row of miniRows(); track row.week) {
                <span class="mini-wk">{{ row.week }}</span>
                @for (c of row.days; track c.key) {
                  <button class="mini-day" [class.out]="!c.inMonth" [class.today]="c.today" [class.sel]="c.sel"
                          [class.has]="c.dots" (click)="pickMini(c.key)">{{ c.num }}</button>
                }
              }
            </div>
          </div>
          <div class="side-day">
            <div class="sd-g">
              <div class="sd-d f-display" [class.today]="sel() === store.todayStr()">{{ selDay().num }}</div>
              <div class="sd-m">{{ selDay().mon }} · {{ selDay().dow }}</div>
            </div>
            <div class="sd-r">
              <div class="sd-t">{{ selLabel() }}</div>
              @for (h of selHols(); track h.name) { <div class="sd-b"><span class="band-l"></span>{{ h.name }} · jusqu’au {{ h.until }}</div> }
            </div>
          </div>
          <div class="side-list">
            @for (it of selItems(); track $index) {
              <ng-container [ngTemplateOutlet]="agItem" [ngTemplateOutletContext]="{ $implicit: it, key: sel() }" />
            }
            @for (ex of selExtras(); track $index) {
              <ng-container [ngTemplateOutlet]="agExtra" [ngTemplateOutletContext]="{ $implicit: ex }" />
            }
            @if (!selItems().length && !selExtras().length) {
              <div class="side-empty">Aucun événement ce jour</div>
            }
          </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Une ligne d'échéancier : un événement, ou une occurrence de créneau publié. -->
    <ng-template #agItem let-it let-key="key">
      @if (it.kind === 'event') {
        @let ev = it.ev;
        <f-agenda-row [start]="hasTime(ev) ? ev.time : ''" [end]="ev.endTime || ''" [timeColor]="eventColor(ev)" label="Journée"
                      [dot]="hasTime(ev) ? '' : eventColor(ev)" [title]="ev.title" (click)="openEv(ev.id, key)">
          @if (ev.place || ev.recur !== 'none' || (ev.end && ev.end !== ev.date)) {
            <div meta class="reg-meta">
              @if (ev.place) { <span><f-icon name="pin" [size]="12" color="var(--ink2)" [width]="2.2" /> {{ ev.place }}</span> }
              @if (ev.recur !== 'none') { <span><f-icon name="refresh" [size]="12" color="var(--ink2)" [width]="2.4" /> {{ recurLabel(ev.recur) }}</span> }
              @if (ev.end && ev.end !== ev.date) { <span><f-icon name="calendar" [size]="12" color="var(--ink2)" [width]="2.2" /> du {{ fmtShort(ev.date) }} au {{ fmtShort(ev.end) }}</span> }
            </div>
          }
          @if (ev.who.length) { <f-who aside [badges]="eventBadges(ev)" [size]="22" /> }
        </f-agenda-row>
      } @else {
        <f-agenda-row [start]="it.se.time" [end]="it.se.end" [title]="it.se.title" (click)="openSlot($event, it.se)">
          <div meta class="reg-meta"><span><f-icon name="planning" [size]="12" color="var(--ink2)" [width]="2.2" /> Emploi du temps</span></div>
          <f-who aside [badges]="slotBadges(it.se)" [size]="22" />
        </f-agenda-row>
      }
    </ng-template>
    <!-- Un repère (tâche, anniversaire, férié…) : un libellé gris à la place de l'heure. -->
    <ng-template #agExtra let-ex>
      <f-agenda-row [label]="extraLabel(ex.kind)" [title]="ex.label" [light]="true" [strike]="!!ex.done" [class.inert]="!ex.id" (click)="openExtra($event, ex)">
        @if (ex.sub) { <div meta class="reg-meta"><span><span class="reg-sq" [style.background]="ex.color"></span>{{ ex.sub }}</span></div> }
      </f-agenda-row>
    </ng-template>
  `,
  styles: [`
    :host { display: block; container-type: inline-size; }
    .cal-wrap { display: flex; gap: 24px; align-items: flex-start; }
    .cal-card { flex: 1; min-width: 0; }
    .side { width: 320px; flex: none; display: flex; flex-direction: column; gap: 12px; }
    /* Panneau masqué : le calendrier reprend toute la largeur (grand écran seulement). */
    .cal-wrap.no-side .side { display: none; }
    .nav-btn.side-toggle.active { background: var(--soft2); }
    /* En pile, les cartes s'étirent à toute la largeur : sans « stretch », un
       flex en colonne aligné « flex-start » les dimensionne à leur contenu, et
       un libellé long les fait déborder à droite. */
    :host-context(.shell.narrow) .cal-wrap { flex-direction: column; align-items: stretch; }
    :host-context(.shell.narrow) .side { width: auto; }
    @media (max-width: 860px) { .cal-wrap { flex-direction: column; align-items: stretch; } .side { width: auto; } }
    /* En largeur moyenne, le panneau passe sous le calendrier. Requête de
       conteneur : c'est la largeur réelle de l'écran Calendrier qui décide. */
    @container (max-width: 1040px) { .cal-wrap { flex-direction: column; align-items: stretch; } .side { width: auto; } }
    .side-detail { display: flex; flex-direction: column; gap: 10px; }
    /* Sur mobile, le mini-calendrier et le détail du jour sont masqués : la vue et le bouton d'ajout suffisent. */
    :host-context(.shell.narrow) .side-detail { display: none; }
    @media (max-width: 860px) { .side-detail { display: none; } }

    .cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; flex-wrap: wrap; gap: 12px; }
    .head-left { display: flex; align-items: center; gap: 12px; }
    .cal-title { font-size: 22px; font-weight: 700; color: var(--ink); }
    .today-btn { border: none; font-size: 12.5px; font-weight: 800; color: var(--ink2); background: var(--soft); border-radius: 10px; padding: 7px 12px; cursor: pointer; }
    .head-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .seg2 { display: flex; gap: 3px; background: var(--soft); border-radius: 12px; padding: 4px; }
    .seg2 button { padding: 7px 13px; border: none; background: transparent; border-radius: 9px; font-size: 12.5px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .seg2 button.active { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
    .seg2.disp button { padding: 7px 9px; display: inline-flex; align-items: center; }
    .navs { display: flex; gap: 8px; }
    .nav-btn { width: 38px; height: 38px; border: none; border-radius: 12px; background: var(--soft); display: flex; align-items: center; justify-content: center; cursor: pointer; }

    /* ===== vue Mois ===== */
    .dow-row { display: grid; grid-template-columns: repeat(7,minmax(0,1fr)); gap: 2px; margin-bottom: 6px; }
    .dow { text-align: center; font-size: 12px; font-weight: 800; color: var(--ink3); padding: 4px; }
    /* Cases resserrées : une barre « journée entière » peut s'étaler d'une case à
       l'autre en une ligne continue, posée dans .week-bars par-dessus la semaine. */
    .month { display: flex; flex-direction: column; gap: 2px; }
    .week { position: relative; }
    .week-cells { display: grid; grid-template-columns: repeat(7,minmax(0,1fr)); gap: 2px; }
    .mcell { position: relative; min-height: 94px; border-radius: 5px; padding: calc(26px + var(--lanes,0) * 20px) 6px 6px; background: var(--soft); cursor: pointer; display: flex; flex-direction: column; gap: 3px; box-sizing: border-box; overflow: hidden; }
    .mcell.dim { opacity: .5; }
    .mcell.sel { box-shadow: inset 0 0 0 2px var(--primary); }
    .mnum { position: absolute; top: 5px; right: 8px; font-size: 13px; font-weight: 800; color: var(--ink2); }
    /* Aujourd'hui : le numéro en pastille, plus de cadre autour de la case. */
    .mcell.today .mnum { top: 3px; right: 5px; min-width: 22px; padding: 2px 5px; border-radius: 7px; background: var(--primary); color: #fff; text-align: center; }
    .wknum { position: absolute; top: 5px; left: 8px; font-size: 11px; font-weight: 800; color: var(--ink3); opacity: .8; }
    .week-bars { position: absolute; top: 24px; left: 0; right: 0; display: grid; grid-template-columns: repeat(7,minmax(0,1fr)); grid-auto-rows: 18px; gap: 2px; pointer-events: none; z-index: 1; }
    .bar { pointer-events: auto; height: 16px; align-self: center; border-radius: 5px; padding: 0 7px; font-size: 10.5px; font-weight: 800; line-height: 16px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .bar.ol { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: -2px; padding-left: 9px; }
    .bar.or { border-top-right-radius: 0; border-bottom-right-radius: 0; margin-right: -2px; }
    /* Les vacances : pas d'aplat, le nom souligné d'un trait miel sur toute la durée. */
    .bar.hband { pointer-events: none; color: var(--ink); background: none; border-radius: 0; padding: 0 4px; line-height: 14px; border-bottom: 2px solid var(--honey); cursor: default; }
    /* Une pastille du mois : sans fond. L'heure (ou le point) porte la couleur, le titre reste à l'encre. */
    .chip-ev { display: flex; align-items: center; gap: 4px; min-height: 16px; font-size: 11px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; }
    .ch-t { flex: none; font-size: 11.5px; font-weight: 800; }
    .ch-l { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .chip-ev.slotev .ch-l { color: var(--ink2); font-weight: 600; }
    .ch-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
    .ch-box { width: 10px; height: 10px; border-radius: 3px; border: 1.5px solid var(--ink3); flex: none; box-sizing: border-box; }
    .strike { text-decoration: line-through; color: var(--ink3); }
    .more { font-size: 10px; font-weight: 800; color: var(--ink3); }
    @media (max-width: 860px) { .mcell { min-height: 68px; } }
    @media (min-width: 861px) { .mcell { min-height: max(94px, calc((100vh - 268px) / 6)); } }

    /* ===== affichage Liste : l'échéancier ===== */
    .ag-day { display: flex; gap: 14px; padding: 14px 0; border-top: 1px solid var(--line2); }
    .ag-day:first-child { border-top: none; padding-top: 2px; }
    .ag-g { width: 70px; flex: none; align-self: flex-start; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; border: none; background: none; border-radius: 10px; padding: 6px 8px; cursor: pointer; color: var(--ink); font-family: inherit; text-align: left; }
    .ag-g.sel { background: var(--soft); }
    .ag-g.today { color: var(--primary); }
    .ag-num { font-size: 28px; font-weight: 700; line-height: 1; }
    .ag-mon { font-size: 12px; font-weight: 800; color: var(--ink2); white-space: nowrap; }
    .ag-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .ag-free { padding: 12px 6px; font-size: 13px; font-weight: 700; color: var(--ink3); }
    .ag-free .reg-link { font-size: 13px; color: var(--ink2); }
    /* « + Ajouter » se montre au survol de la journée ; toujours là au doigt et au clavier. */
    .ag-add { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; border: none; background: none; padding: 6px 6px 2px 72px; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--ink3); cursor: pointer; opacity: 0; transition: opacity .15s ease; }
    .ag-day:hover .ag-add, .ag-add:focus-visible { opacity: 1; }
    .ag-add:hover { color: var(--ink2); }
    @media (hover: none) { .ag-add { opacity: 1; } }
    .band-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 6px 8px; font-size: 13px; font-weight: 800; color: var(--ink); }
    .band-row small { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .band-l { display: inline-block; width: 14px; height: 3px; border-radius: 2px; background: var(--honey); flex: none; }
    /* Les méta d'une ligne : un lieu long passe à la ligne plutôt que de déborder. */
    .reg-meta > * { white-space: normal; }
    f-agenda-row.inert { cursor: default; }
    f-agenda-row.inert:hover { background: none; }

    /* ===== grille horaire (vues Semaine / 3 jours) ===== */
    /* Toutes les rangées partagent le même gabarit de colonnes : la gouttière des
       heures puis une colonne par jour, si bien que tout s'aligne verticalement. */
    .tgrid { --gutter: 34px; --hour-h: 27px; }
    .tgrid.narrow { --gutter: 28px; --hour-h: 24px; }
    .tg-row { display: grid; grid-template-columns: var(--gutter) repeat(var(--cols,3), minmax(0,1fr)); gap: 0 6px; }
    .tg-heads { margin-bottom: 6px; }
    /* En-têtes : du texte, la date du jour en orange, la sélection soulignée. Plus d'aplat. */
    .tg-head { position: relative; border: none; background: none; padding: 6px 4px 8px; font: inherit; font-size: 13px; font-weight: 800; color: var(--ink2); text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tg-head.today { color: var(--primary); }
    .tg-head.sel::after { content: ''; position: absolute; left: 4px; right: 4px; bottom: 2px; height: 2px; border-radius: 2px; background: var(--primary); }
    .tg-hbands { margin-bottom: 4px; }
    .tg-hb-in { grid-column: 2 / -1; display: grid; gap: 4px 6px; grid-auto-rows: 20px; }
    .tg-hband { align-self: center; padding: 0 4px 1px; font-size: 12px; font-weight: 800; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 2px solid var(--honey); }
    .tg-allday { margin-bottom: 6px; }
    .tg-gutter-cell { min-width: 0; }
    .tg-ad-label { display: flex; align-items: flex-start; justify-content: flex-end; padding: 3px 4px 0 0; font-size: 9.5px; font-weight: 800; color: var(--ink3); }
    .tg-ad-cell { display: flex; flex-direction: column; gap: 3px; padding: 3px 2px; min-width: 0; }
    /* Bandeau « journée » : un point de couleur et le texte à l'encre, sans fond. */
    .tg-ad-chip { display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; }
    .tg-ad-chip .ch-dot { width: 6px; height: 6px; }
    .tap { cursor: pointer; }
    .tg-body { align-items: start; }
    .tg-gutter { height: calc(24 * var(--hour-h)); }
    .tg-hour { height: var(--hour-h); border-top: 1px solid var(--line); text-align: right; padding-right: 6px; }
    .tg-hour span { font-size: 9.5px; font-weight: 800; color: var(--ink3); display: inline-block; transform: translateY(-6px); }
    .tg-col { position: relative; height: calc(24 * var(--hour-h)); border-radius: 10px; overflow: hidden; min-width: 0; }
    .tg-line { height: var(--hour-h); border-top: 1px solid var(--line); }
    .tg-line:first-child { border-top: none; }
    /* Un événement posé à son heure : un aplat de sa couleur, sans bordure ni ombre ; le titre à l'encre. */
    .tg-ev { position: absolute; overflow: hidden; border-radius: 6px; padding: 3px 6px; cursor: pointer; box-sizing: border-box; border: 1px solid var(--surface); }
    .tg-ev-title { display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 800; color: var(--ink); line-height: 1.2; overflow: hidden; }
    .tg-ev-t { display: block; font-size: 11px; font-weight: 700; color: var(--ink2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tg-ev.slotev .tg-ev-title { color: var(--ink2); font-weight: 700; }
    .tgrid.narrow .tg-ev { padding: 2px 3px; }
    .tgrid.narrow .tg-ev-t { display: none; }
    /* Maintenant : un trait orange, avec sa pastille, dans la colonne du jour. */
    .tg-now { position: absolute; left: 0; right: 0; height: 2px; background: var(--primary); z-index: 2; pointer-events: none; }
    .tg-now::before { content: ''; position: absolute; left: -1px; top: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--primary); }

    .add-ev { margin-bottom: 6px; }

    /* ===== mini-calendrier ===== */
    .mini { background: var(--surface); border-radius: 16px; padding: 12px 12px 8px; border: 1px solid var(--line); }
    :host-context(:root.dark) .mini { border-color: transparent; }
    .mini-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .mini-title { font-size: 15px; font-weight: 700; color: var(--ink); text-transform: capitalize; }
    .mini-navs { display: flex; gap: 2px; }
    .mini-nav { display: inline-flex; align-items: center; border: none; background: var(--soft); border-radius: 8px; padding: 5px 5px; cursor: pointer; }
    .mini-nav:hover { background: var(--soft2); }
    .mini-nav f-icon + f-icon { margin-left: -7px; }
    .mini-grid { display: grid; grid-template-columns: 22px repeat(7, 1fr); gap: 2px; align-items: center; }
    .mini-dow { text-align: center; font-size: 10.5px; font-weight: 800; color: var(--ink3); padding: 2px 0; }
    .mini-wk { text-align: center; font-size: 10px; font-weight: 800; color: var(--ink3); opacity: .7; }
    .mini-corner { visibility: hidden; }
    .mini-day { position: relative; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border: none; background: transparent; border-radius: 9px; cursor: pointer; font-size: 12.5px; font-weight: 700; color: var(--ink); font-family: inherit; }
    .mini-day:hover { background: var(--soft); }
    .mini-day.out { color: var(--ink3); opacity: .55; }
    .mini-day.today { box-shadow: inset 0 0 0 2px var(--honey); }
    .mini-day.sel { background: var(--primary); color: #fff; font-weight: 800; box-shadow: none; }
    .mini-day.has::after { content: ''; position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%); width: 4px; height: 4px; border-radius: 50%; background: var(--primary); }
    .mini-day.sel.has::after { background: #fff; }

    /* ===== panneau du jour ===== */
    .side-day { display: flex; gap: 14px; align-items: center; margin: 8px 2px 0; padding-bottom: 12px; border-bottom: 1px solid var(--line2); }
    .sd-g { flex: none; }
    .sd-d { font-size: 30px; font-weight: 700; line-height: 1; color: var(--ink); }
    .sd-d.today { color: var(--primary); }
    .sd-m { font-size: 12px; font-weight: 800; color: var(--ink2); margin-top: 3px; white-space: nowrap; }
    .sd-r { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .sd-t { font-size: 15px; font-weight: 800; color: var(--ink); }
    .sd-b { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .side-list { display: flex; flex-direction: column; }
    .side-empty { padding: 22px 6px; text-align: center; color: var(--ink3); font-weight: 700; font-size: 14px; }

    /* Filtres d'affichage : une case par type. Décochée, le type disparaît de toutes les vues. */
    .filters { display: flex; flex-wrap: wrap; gap: 6px 8px; padding: 2px 2px 4px; }
    .filt { display: inline-flex; align-items: center; gap: 6px; border: none; background: var(--soft); border-radius: 20px; padding: 5px 11px 5px 6px; cursor: pointer; font-size: 11.5px; font-weight: 800; color: var(--ink2); }
    .filt.off { opacity: .55; }
    .filt-box { width: 16px; height: 16px; flex: none; border-radius: 5px; border: 2px solid; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; }
    .ics-btn { margin-bottom: 2px; }
  `],
})
export class CalendarScreen {
  store = inject(FoyerStore);
  admin = inject(AdminStore);
  d = this.store.d;

  weekdays = SCHED_DAYS;
  recurOpts: Recur[] = ['none', 'daily', 'weekday', 'weekly', 'biweekly', 'monthly'];

  /**
   * Types d'éléments qu'on peut montrer ou cacher, avec leur pastille de légende.
   * Le repère CESU n'est proposé qu'aux adultes : le module Employé à domicile
   * est invisible aux enfants, jusque dans la légende.
   */
  filterKinds = computed(() => [
    { k: 'event', color: CAL_KINDS['event'].color, label: 'Événements' },
    { k: 'planning', color: SCHED_COLORS['ecole'], label: 'Emploi du temps' },
    ...['task', 'birthday', 'holiday', 'school', 'echeance', ...(this.store.isChild() ? [] : ['cesu']), ...(this.store.modEcole() ? ['ecole'] : []), ...(this.store.modEquipements() ? ['garantie'] : [])].map((k) => ({ k, color: CAL_KINDS[k].color, label: CAL_KINDS[k].label })),
  ]);
  /** Les types masqués, en ensemble : le filtre s'applique partout où un élément est produit. */
  hidden = computed(() => new Set(this.store.ui().calHidden));
  shown(k: string): boolean { return !this.hidden().has(k); }
  toggleKind(k: string): void {
    const cur = this.store.ui().calHidden;
    this.store.patch({ calHidden: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] });
  }

  // `ui` est un seul signal : lire `store.ui().calAnchor` directement dans un
  // computed lourd le lie à *tout* l'état d'interface, si bien que chaque frappe
  // dans la modale d'événement recalculait 42 jours. Ces computed étroits font
  // barrière : `weeks`, `cols`... ne repartent que quand leur valeur change.
  cv = computed(() => this.store.ui().calView);
  display = computed(() => this.store.ui().calDisplay);
  sel = computed(() => this.store.ui().selDay);
  calAnchor = computed(() => this.store.ui().calAnchor);
  // Le mini-calendrier partage l'ancre de la vue principale : naviguer d'un côté
  // (flèches de la vue, « Aujourd'hui », ou flèches mois/année du mini) suit de
  // l'autre, sans deux ancres à tenir d'accord.
  miniAnchor = computed(() => this.store.ui().calAnchor);

  /** Les heures pleines, pour la gouttière et les lignes de la grille horaire. */
  readonly tgHours = Array.from({ length: 24 }, (_, h) => h);

  /** Étiquette d'heure de la gouttière : deux chiffres et un « h » (01h, 02h, …). */
  hourLabel(h: number): string { return String(h).padStart(2, '0') + 'h'; }

  // La taille de la fenêtre, suivie en direct : la vue mois calcule combien de
  // pastilles tiennent dans une case à partir de la hauteur disponible, et doit
  // donc se recalculer quand l'utilisateur redimensionne la fenêtre.
  private readonly viewport = signal(this.readViewport());
  private readViewport(): { w: number; h: number } {
    try { return { w: window.innerWidth, h: window.innerHeight }; } catch { return { w: 1280, h: 900 }; }
  }
  private readonly host = inject(ElementRef<HTMLElement>);

  // La hauteur d'une heure dans la grille Semaine / 3 jours, étirée pour remplir
  // la fenêtre. Mesurée après rendu : le haut de la grille dépend du bandeau
  // « journée entière » qui la précède, dont la hauteur varie selon les repères.
  readonly hourH = signal(HOUR_H_MIN);

  constructor() {
    // Instancié pour son effet : le module Employé à domicile pose les repères
    // de déclaration CESU sur l'agenda (adultes uniquement, sans écran ouvert).
    inject(EmployesStore);
    try {
      const tick = setInterval(() => this.nowMin.set(this.readNow()), 60_000);
      inject(DestroyRef).onDestroy(() => clearInterval(tick));
    } catch { /* pas de minuterie : le trait reste à l'heure d'ouverture */ }
    try {
      const onResize = () => this.viewport.set(this.readViewport());
      window.addEventListener('resize', onResize, { passive: true });
      inject(DestroyRef).onDestroy(() => window.removeEventListener('resize', onResize));
    } catch { /* pas de fenêtre (SSR) : la valeur par défaut suffit */ }

    // Recalcule après chaque rendu qui touche la grille : changement de vue, de
    // données (bandeau « journée entière »), ou de taille de fenêtre. Le haut de
    // la grille ne dépendant pas de `--hour-h`, la mesure converge en un tour :
    // sa propre écriture relance l'effet, qui remesure la même valeur et s'arrête.
    afterRenderEffect(() => {
      this.cv(); this.display(); this.grid(); this.viewport();
      this.measureGridHour();
    });
  }

  /** Étire l'heure pour que la grille horaire descende près du bas de la fenêtre. */
  private measureGridHour(): void {
    const body = this.host.nativeElement.querySelector('.tg-body') as HTMLElement | null;
    if (!body) return;
    let winH: number;
    try { winH = window.innerHeight; } catch { return; }
    const min = this.store.narrow() ? HOUR_H_MIN_NARROW : HOUR_H_MIN;
    const avail = winH - body.getBoundingClientRect().top - GRID_BOTTOM_GAP;
    const next = Math.max(min, Math.round(avail / 24));
    if (Math.abs(next - this.hourH()) > 0.5) this.hourH.set(next);
  }

  /** Hauteur d'une case du mois, telle que la CSS la fixe (min-height). */
  private cellHeight(): number {
    const { w, h } = this.viewport();
    if (w <= 860) return CELL_MIN_NARROW;
    return Math.max(CELL_MIN, (h - CELL_CHROME) / 6);
  }

  /**
   * Combien de pastilles tiennent dans une case du mois, selon sa hauteur
   * disponible (la case, moins le numéro du jour et les `lanes` voies de barres),
   * et la hauteur d'une pastille. `full` : le nombre affichable sans « +x » ;
   * `withMore` : le nombre affichable en réservant la ligne « +x ».
   */
  private cellCapacity(lanes: number): { full: number; withMore: number } {
    const content = this.cellHeight() - (CELL_PAD_TOP + lanes * CELL_LANE_H) - CELL_PAD_BOTTOM;
    const stride = CHIP_H + CHIP_GAP;
    const full = Math.max(0, Math.floor((content + CHIP_GAP) / stride));
    const withMore = Math.max(0, Math.floor((content - MORE_H) / stride));
    return { full, withMore };
  }

  headerLabel = computed(() => {
    const v = this.cv();
    const a = parseDay(this.calAnchor());
    if (v === 'month') return cap(a.toLocaleDateString(this.store.locale, { month: 'long', year: 'numeric' }));
    const start = v === 'week' ? this.monday(a) : a;
    const end = new Date(start);
    end.setDate(start.getDate() + (v === 'week' ? 6 : 2));
    return cap(this.rangeLabel(start, end));
  });

  /** Un événement occupe-t-il la journée entière ? Le drapeau, ou l'absence d'heure. */
  private isAllDay(ev: EventItem): boolean { return !!ev.allDay || !ev.time || ev.time === '—'; }

  /**
   * Le mois par **semaines**, chacune portant ses barres d'événements « journée
   * entière » : un tel événement, surtout multi-jours, s'y dessine comme une
   * ligne continue traversant les jours, plutôt qu'une pastille répétée dans
   * chaque case. Les événements horaires et les repères restent dans les cases.
   */
  weeks = computed<WeekRow[]>(() => {
    const a = parseDay(this.calAnchor());
    const start = this.monday(new Date(a.getFullYear(), a.getMonth(), 1));
    const month = a.getMonth();
    const allDay = this.hidden().has('event') ? [] : (this.store.data()?.events || []).filter((e) => (e.recur || 'none') === 'none' && this.isAllDay(e));
    const dayIx = (iso: string, ws: string) => Math.round((parseDay(iso).getTime() - parseDay(ws).getTime()) / 86_400_000);
    const rows: WeekRow[] = [];
    for (let w = 0; w < 6; w++) {
      const wsD = new Date(start); wsD.setDate(start.getDate() + w * 7);
      const weekStart = dstr(wsD);
      const weD = new Date(wsD); weD.setDate(wsD.getDate() + 6);
      const weekEnd = dstr(weD);
      // Barres : les événements « journée entière » qui touchent la semaine,
      // rangés par voie pour ne pas se chevaucher (le plus tôt et le plus long d'abord).
      const overlap = allDay.filter((e) => (e.end || e.date) >= weekStart && e.date <= weekEnd)
        .sort((x, y) => x.date.localeCompare(y.date) || (y.end || y.date).localeCompare(x.end || x.date));
      const laneEnd: number[] = [];
      const bars: Bar[] = [];
      const covered = new Set<number>();
      for (const e of overlap) {
        const endRange = e.end || e.date;
        const s = e.date < weekStart ? weekStart : e.date;
        const en = endRange > weekEnd ? weekEnd : endRange;
        const col = dayIx(s, weekStart) + 1;
        const span = dayIx(en, weekStart) - dayIx(s, weekStart) + 1;
        let lane = laneEnd.findIndex((end) => end < col);
        if (lane === -1) { lane = laneEnd.length; laneEnd.push(0); }
        laneEnd[lane] = col + span - 1;
        for (let c = col; c < col + span; c++) covered.add(c);
        bars.push({ id: e.id + ':' + weekStart, ev: e, col, span, lane, startsHere: s === e.date, endsHere: en === endRange });
      }
      // Les vacances scolaires s'étalent en barres continues, sur leurs propres
      // voies posées après celles des événements, et non plus en pastille répétée
      // chaque jour (elles sont donc retirées des repères de case ci-dessous).
      const eventLanes = laneEnd.length;
      const hbars = (this.hidden().has('school') ? [] : holidayBands(this.store.schoolHolidays(), weekStart, weekEnd, CAL_KINDS['school'].color))
        .map((b) => ({ ...b, lane: b.lane + eventLanes }));
      const holidayLanes = hbars.length ? Math.max(...hbars.map((b) => b.lane)) + 1 - eventLanes : 0;
      // Combien de pastilles tiennent dans une case de cette semaine : la hauteur
      // dépend des voies de barres qui rabotent le haut de chaque case.
      const cap = this.cellCapacity(eventLanes + holidayLanes);
      const days: MonthCell[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(wsD); d.setDate(wsD.getDate() + i); const key = dstr(d);
        // Les événements « journée entière » non récurrents sont des barres, pas des pastilles de case.
        const items = this.dayItems(key).filter((it) => it.kind !== 'event' || !((it.ev.recur || 'none') === 'none' && this.isAllDay(it.ev)));
        const extras = this.visExtras(key).filter((e) => e.kind !== 'school');
        // On remplit la case jusqu'au bord ; le surplus se replie en « +x », et
        // seulement s'il déborde vraiment. Les pastilles d'abord, puis les repères.
        const total = items.length + extras.length;
        let vItems = items, vExtras = extras, more = 0;
        if (total > cap.full) {
          const k = Math.min(cap.withMore, total);
          vItems = items.slice(0, k);
          vExtras = extras.slice(0, Math.max(0, k - vItems.length));
          more = total - (vItems.length + vExtras.length);
        }
        days.push({ key, num: d.getDate(), inMonth: d.getMonth() === month, items: vItems, extras: vExtras, more, covered: covered.has(i + 1) });
      }
      rows.push({ key: weekStart, week: isoWeek(wsD), days, bars, hbars, lanes: eventLanes + holidayLanes });
    }
    return rows;
  });

  /** L'échéancier des vues 3 jours / Semaine en affichage Liste : une rangée par jour. */
  listDays = computed<ListDay[]>(() => {
    const v = this.cv();
    if (v === 'month') return [];
    const a = parseDay(this.calAnchor());
    const start = v === 'week' ? this.monday(a) : a;
    const n = v === 'week' ? 7 : 3;
    const first = dstr(start);
    const today = this.store.todayStr();
    const selDay = this.sel();
    const hols = this.hidden().has('school') ? [] : this.store.schoolHolidays();
    const out: ListDay[] = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dstr(d);
      const last = i === n - 1 ? key : '';
      // Les vacances : une ligne au jour où elles commencent (ou au premier jour affiché si elles ont commencé avant).
      const here = hols.filter((h) => (h.start < first ? first : h.start) === key && h.end >= first && (!last || h.start <= last))
        .map((h) => ({ name: h.name, range: `du ${fmtShortDay(h.start, today)} au ${fmtShortDay(h.end, today)}` }));
      out.push({
        key, num: d.getDate(), mon: SHORT_MON[d.getMonth()], dow: SHORT_DOW[(d.getDay() + 6) % 7], long: this.fmtShort(key),
        isToday: key === today, isSel: key === selDay, items: this.dayItems(key), extras: this.visExtras(key).filter((e) => e.kind !== 'school'), hols: here,
      });
    }
    return out;
  });

  /**
   * Les colonnes de la grille horaire (Semaine ou 3 jours). Chaque colonne porte
   * son bandeau « journée entière » (événements sans heure et repères) et ses
   * événements horaires posés à leur heure, les chevauchements répartis côte à
   * côte. Vide en vue Mois.
   */
  grid = computed<GridCol[]>(() => {
    const v = this.cv();
    if (v === 'month') return [];
    const a = parseDay(this.calAnchor());
    const start = v === 'week' ? this.monday(a) : a;
    const n = v === 'week' ? 7 : 3;
    const wide = !this.store.narrow();
    const today = this.store.todayStr();
    const selDay = this.sel();
    const out: GridCol[] = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dstr(d);
      const items = this.dayItems(key);
      const allDay: EventItem[] = [];
      const rest: DayItem[] = [];
      for (const it of items) {
        if (it.kind === 'event' && this.isAllDay(it.ev)) allDay.push(it.ev);
        else rest.push(it);
      }
      const timed = this.layoutDay(rest);
      // Comme en liste, les vacances passent dans le bandeau étalé au-dessus en large, et restent par jour en pile.
      const extras = wide ? this.visExtras(key).filter((e) => e.kind !== 'school') : this.visExtras(key);
      out.push({ key, dow: SHORT_DOW[(d.getDay() + 6) % 7], num: d.getDate(), isToday: key === today, isSel: key === selDay, allDay, extras, timed });
    }
    return out;
  });

  /**
   * Pose les éléments horaires d'un jour dans la grille (voir core/day-layout.ts) :
   * chacun à sa hauteur, en pourcentage de la journée, les chevauchements côte à côte.
   */
  private layoutDay(items: DayItem[]): PlacedItem[] {
    return layoutTimed<DayItem>(items.map((it) => it.kind === 'event'
      ? { item: it, start: it.ev.time, end: it.ev.endTime || '' }
      : { item: it, start: it.se.time, end: it.se.end || '' }))
      .map((p) => ({ it: p.item, top: (p.s / 1440) * 100, height: Math.max(1.8, ((p.e - p.s) / 1440) * 100), left: (p.col / p.cols) * 100, width: 100 / p.cols }));
  }

  /** Les vacances scolaires étalées sur la plage visible (semaine ou 3 jours), en barres. Vide en vue mois, en pile mobile, ou sans vacances. */
  dayBands = computed<HolidayBand[]>(() => {
    const v = this.cv();
    if (v === 'month' || this.store.narrow()) return [];
    const a = parseDay(this.calAnchor());
    const start = v === 'week' ? this.monday(a) : a;
    const n = v === 'week' ? 7 : 3;
    const end = new Date(start); end.setDate(start.getDate() + n - 1);
    if (this.hidden().has('school')) return [];
    return holidayBands(this.store.schoolHolidays(), dstr(start), dstr(end), CAL_KINDS['school'].color);
  });

  selItems = computed(() => this.dayItems(this.sel()));
  /** Les repères du jour choisi ; les vacances sont dites dans l'en-tête du panneau. */
  selExtras = computed(() => this.visExtras(this.sel()).filter((e) => e.kind !== 'school'));
  /** L'en-tête du panneau : le numéro du jour en grand, « oct. · sam. ». */
  selDay = computed(() => { const d = parseDay(this.sel()); return { num: d.getDate(), mon: SHORT_MON[d.getMonth()], dow: SHORT_DOW[(d.getDay() + 6) % 7] }; });
  /** Les vacances en cours le jour choisi, avec leur fin. */
  selHols = computed(() => {
    const k = this.sel();
    if (this.hidden().has('school')) return [];
    return this.store.schoolHolidays().filter((h) => h.start <= k && h.end >= k).map((h) => ({ name: h.name, until: fmtShortDay(h.end, this.store.todayStr()) }));
  });

  /** L'heure qu'il est, en minutes, pour le trait « maintenant » de la grille. Rafraîchie chaque minute. */
  readonly nowMin = signal(this.readNow());
  private readNow(): number { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  /** Les repères d'un jour, moins les types masqués par les filtres. */
  private visExtras(key: string): DayExtra[] {
    const h = this.hidden();
    return h.size ? this.store.dayExtras(key).filter((e) => !h.has(e.kind)) : this.store.dayExtras(key);
  }

  /**
   * L'agenda d'un jour, événements propres et créneaux publiés **mêlés et triés
   * par heure**. Sans cela, un créneau de midi s'affichait après un événement de
   * 20 h, parce que les deux vivaient dans deux listes séparées. Une heure vide
   * (« — », événement sur la journée) passe en tête.
   */
  dayItems(key: string): DayItem[] {
    const h = this.hidden();
    const evs: DayItem[] = h.has('event') ? [] : this.store.eventsForDay(key).map((ev) => ({ t: /^\d\d:\d\d/.test(ev.time) ? ev.time : '', kind: 'event', ev }));
    const slots: DayItem[] = h.has('planning') ? [] : this.store.slotEventsForDay(key).map((se) => ({ t: se.time, kind: 'slot', se }));
    return [...evs, ...slots].sort((a, b) => a.t.localeCompare(b.t));
  }

  /** Un événement a-t-il une heure ? Sinon il se lit « Journée », avec un point. */
  hasTime(ev: EventItem): boolean { return !this.isAllDay(ev); }
  /** « Tâche », « Anniv. », « Férié »… : ce qu'un repère affiche à la place de l'heure. */
  extraLabel(kind: string): string { return EXTRA_LABELS[kind] || 'Repère'; }
  /** L'aplat d'un élément de la grille : sa couleur mêlée à la surface. */
  mix(color: string, pct: number): string { return `color-mix(in srgb, ${color} ${pct}%, var(--surface))`; }

  /** « 12:00 – 12:45 », ou « 12:00 » sans fin, ou « — » sans heure. */
  timeLabel(ev: EventItem): string { return ev.endTime ? ev.time + ' – ' + ev.endTime : ev.time; }
  selLabel = computed(() => cap(parseDay(this.sel()).toLocaleDateString(this.store.locale, { weekday: 'long', day: 'numeric', month: 'long' })));

  // ===== mini-calendrier du panneau latéral =====
  miniDows = DOW.map((d) => d[0]);
  miniLabel = computed(() => cap(parseDay(this.miniAnchor()).toLocaleDateString(this.store.locale, { month: 'long', year: 'numeric' })));

  /** Six semaines du mois affiché, chacune avec son numéro de semaine ISO. */
  miniRows = computed(() => {
    const a = parseDay(this.miniAnchor());
    const start = this.monday(new Date(a.getFullYear(), a.getMonth(), 1));
    const month = a.getMonth();
    const today = this.store.todayStr();
    const sel = this.sel();
    const rows: { week: number; days: { key: string; num: number; inMonth: boolean; today: boolean; sel: boolean; dots: boolean }[] }[] = [];
    for (let r = 0; r < 6; r++) {
      const days = [];
      let week = 0;
      for (let c = 0; c < 7; c++) {
        const d = new Date(start); d.setDate(start.getDate() + r * 7 + c);
        if (c === 0) week = isoWeek(d);
        const key = dstr(d);
        const dots = !!this.store.eventsForDay(key).length || !!this.store.slotEventsForDay(key).length || !!this.store.dayExtras(key).length;
        days.push({ key, num: d.getDate(), inMonth: d.getMonth() === month, today: key === today, sel: key === sel, dots });
      }
      rows.push({ week, days });
    }
    return rows;
  });

  /**
   * Les flèches mois / année du mini déplacent l'ancre partagée : la vue
   * principale suit d'autant. On vise le 1er du mois visé plutôt que de décaler
   * la date en place, pour qu'un 31 janvier ne saute pas février.
   */
  miniNav(kind: 'month' | 'year', dir: number): void {
    const a = parseDay(this.store.ui().calAnchor);
    const next = kind === 'month' ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : new Date(a.getFullYear() + dir, a.getMonth(), 1);
    this.store.patch({ calAnchor: dstr(next) });
  }

  /** Sauter à une date : on la sélectionne, la vue principale s'y ancre, le mini suit. */
  pickMini(key: string): void {
    this.store.patch({ selDay: key, calAnchor: key });
  }

  /** Une pastille d'événement dans une case de mois ouvre l'événement, sans déclencher la création. */
  openEventChip(e: Event, id: string, occ = ''): void {
    e.stopPropagation();
    this.openEv(id, occ);
  }
  /** Un événement s'ouvre en fiche par-dessus l'agenda, sur l'occurrence touchée : le mois affiché ne bouge pas. */
  openEv(id: string, occ: string): void { this.store.openItem('event', id, { occ }); }

  /**
   * Clic sur une case du mois. Sur un jour **libre**, on ouvre la création, geste
   * rapide attendu. Sur un jour qui porte déjà des événements, la modale serait
   * gênante : le simple clic sélectionne le jour (le panneau latéral le détaille),
   * et c'est le **double-clic** qui ouvre alors la création, comme le bouton
   * « Ajouter un événement » du panneau.
   */
  cellClick(c: MonthCell): void {
    if (c.items.length || c.extras.length || c.covered) this.store.patch({ selDay: c.key });
    else this.addAt(c.key);
  }

  private monday(d: Date): Date { return mondayOf(new Date(d)); }

  private rangeLabel(start: Date, end: Date): string {
    if (start.getMonth() === end.getMonth()) {
      return `${start.getDate()}–${end.getDate()} ${start.toLocaleDateString(this.store.locale, { month: 'long' })}`;
    }
    return `${start.getDate()} ${start.toLocaleDateString(this.store.locale, { month: 'short' })} – ${end.getDate()} ${end.toLocaleDateString(this.store.locale, { month: 'short' })}`;
  }

  fmtShort(key: string): string {
    const d = parseDay(key);
    return `${d.getDate()} ${d.toLocaleDateString(this.store.locale, { month: 'short' })}`;
  }

  recurLabel(r: Recur): string {
    return r === 'none' ? 'Ponctuel' : RECUR_LABELS[r];
  }

  setView(v: 'month' | 'week' | '3'): void { this.store.patch({ calView: v }); }
  setDisplay(v: 'grid' | 'list'): void { this.store.patch({ calDisplay: v }); }
  /** Sélectionne le jour d'une colonne (le panneau latéral le détaille) sans ouvrir la création. */
  selectDay(key: string): void { this.store.patch({ selDay: key }); }
  /** Affiche ou masque le bandeau de droite ; le calendrier reprend alors toute la largeur. */
  toggleSide(): void { this.store.patch({ calSide: !this.store.ui().calSide }); }

  /** Copie le lien du flux ICS dans le presse-papiers, pour l'abonner depuis un autre agenda. */
  async copyIcs(): Promise<void> {
    const url = this.admin.icsUrl();
    if (!url) return;
    try { await navigator.clipboard.writeText(url); this.store.toast('Lien du calendrier copié'); }
    catch { this.store.toast('Copie impossible sur ce navigateur'); }
  }

  goToday(): void { this.store.patch({ calAnchor: this.store.todayStr(), selDay: this.store.todayStr() }); }

  nav(dir: number): void {
    const a = parseDay(this.store.ui().calAnchor);
    const v = this.store.ui().calView;
    if (v === 'month') a.setMonth(a.getMonth() + dir);
    else if (v === 'week') a.setDate(a.getDate() + dir * 7);
    else a.setDate(a.getDate() + dir * 3);
    this.store.patch({ calAnchor: dstr(a) });
  }

  addAt(key: string): void {
    this.store.patch({ selDay: key });
    this.store.openItem('event', null, { date: key });
  }

  /** Un repère qui est une tâche s'ouvre d'un tap ; les autres (férié, anniversaire, échéance) restent des repères. */
  openExtra(e: Event, ex: DayExtra): void {
    if (!ex.id) return;
    e.stopPropagation();
    this.store.openItem('task', ex.id);
  }

  /** Couleur du type de créneau, pour marquer d'un coup d'oeil un événement d'emploi du temps. */
  slotColor(k: string): string { return SCHED_COLORS[k] || 'var(--ink3)'; }

  /** Les pastilles d'identité d'un créneau publié : plusieurs membres, comme dans l'emploi du temps. */
  slotBadges(se: SlotEvent): WhoBadge[] { return whoBadges({ who: se.who }, this.d().members); }

  /** Les pastilles d'un événement : ses membres, dans l'ordre du foyer. */
  eventBadges(ev: EventItem): WhoBadge[] { return whoBadges({ who: ev.who }, this.d().members); }

  /** Couleur d'un événement : celle de son premier membre, ou la couleur « Événement » quand il n'en porte aucun. */
  eventColor(ev: EventItem): string { return ev.who.length ? this.store.memberColor(ev.who[0]) : CAL_KINDS['event'].color; }

  /** Un événement d'agenda venu d'un créneau s'ouvre sur son créneau source, pas sur une copie. */
  openSlot(e: Event, se: SlotEvent): void {
    e.stopPropagation();
    this.store.openSlotEvent(se.slotId, se.date);
  }

}
