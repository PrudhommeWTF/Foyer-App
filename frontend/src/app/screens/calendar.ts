import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore, DayExtra } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { WhoComponent } from '../shared/who';
import { DOW, RECUR_LABELS, CAL_KINDS, SCHED_COLORS } from '../core/constants';
import { cap, parseDay, dstr, isoWeek } from '../core/helpers';
import { EventItem, Recur } from '../core/models';
import { SlotEvent, WhoBadge, whoBadges } from '../core/schedule';

/** Un élément d'agenda du jour : un événement propre, ou une occurrence de créneau publié. Trié par heure, les deux mêlés. */
type DayItem = { t: string; kind: 'event'; ev: EventItem } | { t: string; kind: 'slot'; se: SlotEvent };
/** `covered` : au moins une barre « journée entière » traverse ce jour (il n'est donc pas libre). */
interface MonthCell { key: string; num: number; inMonth: boolean; items: DayItem[]; extras: DayExtra[]; more: number; covered: boolean; }
/** Une barre d'événement sur la journée entière dans une semaine du mois : de la colonne `col`, sur `span` jours, sur la voie `lane`. */
interface Bar { id: string; ev: EventItem; col: number; span: number; lane: number; startsHere: boolean; endsHere: boolean; }
interface WeekRow { key: string; days: MonthCell[]; bars: Bar[]; lanes: number; }

@Component({
  selector: 'screen-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent, WhoComponent],
  template: `
    <div class="screen-enter">
      <div class="cal-wrap">
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
              <div class="navs">
                <button class="nav-btn" (click)="nav(-1)"><f-icon name="chevronLeft" [size]="18" color="var(--ink2)" [width]="2.2" /></button>
                <button class="nav-btn" (click)="nav(1)"><f-icon name="chevronRight" [size]="18" color="var(--ink2)" [width]="2.2" /></button>
              </div>
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
                    @for (c of wk.days; track c.key) {
                      <div class="mcell" [class.sel]="c.key === sel()" [class.today]="c.key === store.todayStr()" [class.dim]="!c.inMonth"
                           (click)="cellClick(c)" (dblclick)="addAt(c.key)">
                        <span class="mnum">{{ c.num }}</span>
                        @for (it of c.items; track $index) {
                          @if (it.kind === 'event') {
                            <div class="chip-ev tap" [style.background]="store.tint(eventColor(it.ev))" [style.color]="eventColor(it.ev)" (click)="openEventChip($event, it.ev.id)">{{ it.ev.title }}</div>
                          } @else {
                            <div class="chip-ex slotev tap" [style.border-left]="'3px solid ' + slotColor(it.se.k)" (click)="openSlot($event, it.se)">
                              <f-icon name="planning" [size]="10" [color]="slotColor(it.se.k)" [width]="2.4" />
                              <span class="ex-lbl">{{ it.se.title }}</span>
                            </div>
                          }
                        }
                        @for (ex of c.extras; track $index) {
                          <div class="chip-ex" [class.tap]="ex.id" [style.border-left]="'3px solid ' + ex.color" (click)="openExtra($event, ex)">
                            <span class="ex-dot" [style.background]="ex.color"></span>
                            <span class="ex-lbl" [class.strike]="ex.done">{{ ex.label }}</span>
                          </div>
                        }
                        @if (c.more) { <span class="more">+{{ c.more }}</span> }
                      </div>
                    }
                  </div>
                  @if (wk.bars.length) {
                    <div class="week-bars">
                      @for (b of wk.bars; track b.id) {
                        <div class="bar tap" [class.ol]="!b.startsHere" [class.or]="!b.endsHere"
                             [style.grid-column]="b.col + ' / span ' + b.span" [style.grid-row]="b.lane + 1"
                             [style.background]="eventColor(b.ev)" (click)="openEventChip($event, b.ev.id)">{{ b.startsHere ? b.ev.title : '' }}</div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          } @else {
            <div class="cols" [style.grid-template-columns]="'repeat(' + cols().length + ',1fr)'">
              @for (col of cols(); track col.key) {
                <div class="col">
                  <div class="col-head"
                       [style.background]="col.isSel ? 'var(--primary)' : (col.isToday ? 'var(--honey)' : 'var(--surface)')"
                       [style.color]="(col.isSel || col.isToday) ? '#fff' : 'var(--ink2)'"
                       (click)="addAt(col.key)">
                    <span class="col-dow">{{ col.dow }}</span>
                    <span class="col-num f-display">{{ col.num }}</span>
                  </div>
                  <div class="col-body">
                    @for (it of col.items; track $index) {
                      @if (it.kind === 'event') {
                        <div class="col-ev" [style.border-left]="'4px solid ' + eventColor(it.ev)" (click)="store.editEvent(it.ev.id)">
                          <div class="ce-time f-display">{{ timeLabel(it.ev) }}</div>
                          <div class="ce-title">{{ it.ev.title }}</div>
                          @if (it.ev.who.length) { <div class="ce-who"><f-who [badges]="eventBadges(it.ev)" /></div> }
                        </div>
                      } @else {
                        <div class="col-ev slotev" [style.border-left]="'4px solid ' + slotColor(it.se.k)" (click)="openSlot($event, it.se)">
                          <div class="ce-time f-display">{{ it.se.time }}{{ it.se.end ? ' – ' + it.se.end : '' }}</div>
                          <div class="ce-title">{{ it.se.title }}</div>
                          <div class="slotev-foot">
                            <f-who [badges]="slotBadges(it.se)" />
                            <span class="slotev-tag"><f-icon name="planning" [size]="11" [color]="slotColor(it.se.k)" [width]="2.4" /> Emploi du temps</span>
                          </div>
                        </div>
                      }
                    } @empty {
                      @if (!col.extras.length) {
                        <div class="col-empty" (click)="addAt(col.key)">Libre</div>
                      }
                    }
                    @for (ex of col.extras; track $index) {
                      <div class="col-ex" [class.tap]="ex.id" [style.border-left]="'3px solid ' + ex.color" (click)="openExtra($event, ex)">
                        <span class="ex-dot" [style.background]="ex.color"></span>
                        <span class="ex-lbl" [class.strike]="ex.done">{{ ex.label }}</span>
                        @if (ex.sub) { <span class="ex-sub">{{ ex.sub }}</span> }
                      </div>
                    }
                    <button class="col-add" (click)="addAt(col.key)"><f-icon name="plus" [size]="16" color="var(--ink3)" /></button>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- ===== agenda side panel ===== -->
        <div class="side">
          <button class="btn btn-primary btn-block add-ev" (click)="store.openEvent()"><f-icon name="plus" [size]="18" color="#fff" /> Ajouter un événement</button>
          <div class="legend">
            @for (lk of legendKinds; track lk.k) {
              <span class="lg-item"><span class="ex-dot" [style.background]="lk.color"></span>{{ lk.label }}</span>
            }
          </div>
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
          <div class="side-sel">{{ selLabel() }}</div>
          @for (it of selItems(); track $index) {
            @if (it.kind === 'event') {
              <div class="side-ev" [style.border-left]="'4px solid ' + eventColor(it.ev)" (click)="store.editEvent(it.ev.id)">
                <div class="se-top">
                  <div class="se-time f-display">{{ timeLabel(it.ev) }}</div>
                  @if (it.ev.recur !== 'none') {
                    <span class="se-recur"><f-icon name="refresh" [size]="12" color="#7A9B76" [width]="2.4" /> {{ recurLabel(it.ev.recur) }}</span>
                  }
                </div>
                <div class="se-title">{{ it.ev.title }}</div>
                @if (it.ev.place) { <div class="se-place"><f-icon name="pin" [size]="13" color="var(--ink3)" [width]="2" /> {{ it.ev.place }}</div> }
                @if (it.ev.end && it.ev.end !== it.ev.date) {
                  <div class="se-span"><f-icon name="calendar" [size]="13" color="#4E93B8" [width]="2.2" /> du {{ fmtShort(it.ev.date) }} au {{ fmtShort(it.ev.end) }}</div>
                }
                @if (it.ev.who.length) { <div class="se-who"><f-who [badges]="eventBadges(it.ev)" /></div> }
              </div>
            } @else {
              <div class="side-ev slotev" [style.border-left]="'4px solid ' + slotColor(it.se.k)" (click)="openSlot($event, it.se)">
                <div class="se-top">
                  <div class="se-time f-display">{{ it.se.time }}{{ it.se.end ? ' – ' + it.se.end : '' }}</div>
                  <span class="se-slot"><f-icon name="planning" [size]="12" [color]="slotColor(it.se.k)" [width]="2.4" /> Emploi du temps</span>
                </div>
                <div class="se-title">{{ it.se.title }}</div>
                <div class="se-who"><f-who [badges]="slotBadges(it.se)" /></div>
              </div>
            }
          } @empty {
            @if (!selExtras().length) {
              <div class="side-empty">Aucun événement ce jour</div>
            }
          }
          @if (selExtras().length) {
            <div class="side-extras">
              @for (ex of selExtras(); track $index) {
                <div class="side-ex" [class.tap]="ex.id" [style.border-left]="'4px solid ' + ex.color" (click)="openExtra($event, ex)">
                  <span class="ex-dot" [style.background]="ex.color"></span>
                  <span class="sx-lbl" [class.strike]="ex.done">{{ ex.label }}</span>
                  @if (ex.sub) { <span class="sx-sub">{{ ex.sub }}</span> }
                </div>
              }
            </div>
          }
        </div>
      </div>

      <!-- ===== event modal ===== -->
      @if (store.ui().showEvent) {
        <f-modal [title]="modalTitle()" [maxWidth]="470" (close)="store.patch({ showEvent: false })">
          <div class="fl">Titre</div>
          <input class="input" [ngModel]="store.ui().evTitle" (ngModelChange)="store.patch({ evTitle: $event })"
                 placeholder="Ex : Rendez-vous dentiste" style="margin-bottom:18px" />

          <label class="allday" (click)="store.patch({ evAllDay: !store.ui().evAllDay })">
            <span class="box" [class.on]="store.ui().evAllDay">@if (store.ui().evAllDay) { <f-icon name="check" [size]="13" color="#fff" [width]="3.2" /> }</span>
            <span>Journée entière</span>
          </label>
          @if (!store.ui().evAllDay) {
            <div class="ev-times">
              <div>
                <div class="fl">Heure de début</div>
                <input class="input" type="time" [ngModel]="store.ui().evTime" (ngModelChange)="store.setEventStart($event)" />
              </div>
              <div>
                <div class="fl">Heure de fin (option.)</div>
                <input class="input" type="time" [ngModel]="store.ui().evEndTime" (ngModelChange)="store.patch({ evEndTime: $event })" [disabled]="!store.ui().evTime" />
              </div>
            </div>
          }

          <div class="fl">Lieu (option.)</div>
          <input class="input" [ngModel]="store.ui().evPlace" (ngModelChange)="store.patch({ evPlace: $event })"
                 placeholder="Ex : Salle des fêtes, 12 rue des Lilas" style="margin-bottom:18px" />

          <div class="fl">Date</div>
          <div class="dp">
            <div class="dp-head">
              <button class="dp-nav" (click)="store.patch({ dpMonth: store.ui().dpMonth - 1 })"><f-icon name="chevronLeft" [size]="15" color="var(--ink2)" [width]="2.4" /></button>
              <div class="dp-label f-display">{{ dpLabel() }}</div>
              <button class="dp-nav" (click)="store.patch({ dpMonth: store.ui().dpMonth + 1 })"><f-icon name="chevronRight" [size]="15" color="var(--ink2)" [width]="2.4" /></button>
            </div>
            <div class="dp-dow"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
            <div class="dp-grid">
              @for (c of dpCells(); track c.key) {
                <div class="dp-cell" [class.sel]="c.sel" [class.between]="c.between" [class.ring]="c.isToday && !c.sel"
                     [style.opacity]="c.inMonth ? 1 : 0.35" (click)="store.dpPick(c.key)">{{ c.num }}</div>
              }
            </div>
          </div>
          <div class="dp-summary"><f-icon name="calendar" [size]="15" color="#E56B4E" [width]="2" /> <span>{{ dpSummary() }}</span></div>

          <div class="fl">Assigné à</div>
          <!-- Plusieurs membres possibles : un repas de famille, une sortie, un
               trajet concernent plus d'une personne. Aucun est licite (événement
               du foyer). -->
          <div class="seg-members">
            @for (m of d().members; track m.id) {
              <button [style.background]="store.ui().evWho.includes(m.id) ? m.color : 'var(--soft)'"
                      [style.color]="store.ui().evWho.includes(m.id) ? '#fff' : 'var(--ink2)'"
                      (click)="store.toggleEvWho(m.id)">{{ m.name }}</button>
            }
          </div>

          <div class="fl">Récurrence</div>
          <div class="seg-recur">
            @for (r of recurOpts; track r) {
              <button [class.active]="store.ui().evRecur === r" (click)="store.patch({ evRecur: r })">{{ recurLabel(r) }}</button>
            }
          </div>

          <div class="modal-foot">
            @if (store.ui().evEditId) {
              <button class="btn btn-ghost del" (click)="store.delEvent()">Supprimer</button>
            }
            <button class="btn btn-primary" (click)="store.saveEvent()">Enregistrer</button>
          </div>
        </f-modal>
      }
    </div>
  `,
  styles: [`
    .cal-wrap { display: flex; gap: 24px; align-items: flex-start; }
    .cal-card { flex: 1; min-width: 0; }
    .side { width: 320px; flex: none; display: flex; flex-direction: column; gap: 12px; }
    :host-context(.shell.narrow) .cal-wrap { flex-direction: column; }
    :host-context(.shell.narrow) .side { width: auto; }
    @media (max-width: 860px) { .cal-wrap { flex-direction: column; } .side { width: auto; } }

    .cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; flex-wrap: wrap; gap: 12px; }
    .head-left { display: flex; align-items: center; gap: 12px; }
    .cal-title { font-size: 22px; font-weight: 700; color: var(--ink); }
    .today-btn { border: none; font-size: 12.5px; font-weight: 800; color: var(--ink2); background: var(--soft); border-radius: 10px; padding: 7px 12px; cursor: pointer; }
    .head-right { display: flex; align-items: center; gap: 12px; }
    .seg2 { display: flex; gap: 3px; background: var(--soft); border-radius: 12px; padding: 4px; }
    .seg2 button { padding: 7px 13px; border: none; background: transparent; border-radius: 9px; font-size: 12.5px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .seg2 button.active { background: var(--surface); color: var(--ink); box-shadow: 0 4px 10px -6px rgba(90,60,40,.5); }
    .navs { display: flex; gap: 8px; }
    .nav-btn { width: 38px; height: 38px; border: none; border-radius: 12px; background: var(--soft); display: flex; align-items: center; justify-content: center; cursor: pointer; }

    .dow-row { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px; margin-bottom: 6px; }
    .dow { text-align: center; font-size: 12px; font-weight: 800; color: var(--ink3); padding: 4px; }
    /* Cases resserrées (gap 2px, coins peu arrondis) : une barre « journée
       entière » peut alors s'étaler d'une case à l'autre en une ligne continue,
       posée dans .week-bars par-dessus la semaine. Le haut de chaque case laisse
       la place aux voies de barres (--lanes, porté par la semaine). */
    .month { display: flex; flex-direction: column; gap: 2px; }
    .week { position: relative; }
    .week-cells { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px; }
    .mcell { position: relative; min-height: 94px; border-radius: 5px; padding: calc(26px + var(--lanes,0) * 20px) 6px 6px; background: var(--soft); cursor: pointer; display: flex; flex-direction: column; gap: 3px; box-sizing: border-box; overflow: hidden; }
    .mcell.dim { opacity: .5; }
    .mcell.sel { box-shadow: inset 0 0 0 2px var(--primary); }
    .mcell.today:not(.sel) { box-shadow: inset 0 0 0 2px var(--honey); }
    .mnum { position: absolute; top: 5px; right: 8px; font-size: 13px; font-weight: 800; color: var(--ink2); }
    .week-bars { position: absolute; top: 24px; left: 0; right: 0; display: grid; grid-template-columns: repeat(7,1fr); grid-auto-rows: 18px; gap: 2px; pointer-events: none; z-index: 1; }
    .bar { pointer-events: auto; height: 16px; align-self: center; border-radius: 5px; padding: 0 7px; font-size: 10.5px; font-weight: 800; line-height: 16px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .bar.ol { border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: -2px; padding-left: 9px; }
    .bar.or { border-top-right-radius: 0; border-bottom-right-radius: 0; margin-right: -2px; }
    .chip-ev { border-radius: 5px; padding: 2px 6px; font-size: 10px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .more { font-size: 10px; font-weight: 800; color: var(--ink3); }
    @media (max-width: 860px) { .mcell { min-height: 68px; } }

    .cols { display: grid; gap: 10px; align-items: start; }
    .col { background: var(--soft); border-radius: 16px; padding: 10px; min-height: 300px; display: flex; flex-direction: column; }
    .col-head { display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 11px; padding: 8px 6px; margin-bottom: 10px; cursor: pointer; }
    .col-dow { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .col-num { font-size: 17px; font-weight: 700; }
    .col-body { display: flex; flex-direction: column; gap: 7px; flex: 1; }
    .col-ev { background: var(--surface); border-radius: 11px; padding: 9px 10px; cursor: pointer; box-shadow: 0 6px 14px -12px rgba(90,60,40,.6); }
    .ce-time { font-size: 12px; font-weight: 700; color: var(--ink2); }
    .ce-title { font-size: 13px; font-weight: 800; color: var(--ink); line-height: 1.2; margin-top: 1px; }
    .ce-who { display: flex; align-items: center; gap: 5px; margin-top: 5px; }
    .ce-who span:last-child { font-size: 11px; font-weight: 700; color: var(--ink3); }
    .dot { width: 16px; height: 16px; border-radius: 50%; color: #fff; font-size: 9px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex: none; }
    .col-empty { flex: 1; min-height: 60px; display: flex; align-items: center; justify-content: center; color: var(--ink3); font-size: 12px; font-weight: 700; cursor: pointer; }
    .col-add { border: none; background: transparent; display: flex; align-items: center; justify-content: center; padding: 6px; cursor: pointer; border-radius: 9px; }
    .col-add:hover { background: var(--surface); }

    .add-ev { margin-bottom: 6px; }

    /* ===== mini-calendrier ===== */
    .mini { background: var(--surface); border-radius: 16px; padding: 12px 12px 8px; box-shadow: 0 10px 24px -18px rgba(90,60,40,.6); }
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
    .side-sel { font-size: 13px; font-weight: 800; color: var(--ink2); text-transform: capitalize; margin: 4px 2px 0; }

    .side-ev { background: var(--surface); border-radius: 18px; padding: 16px; box-shadow: 0 10px 24px -18px rgba(90,60,40,.6); cursor: pointer; }
    .se-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .se-time { font-size: 16px; font-weight: 700; color: var(--ink); }
    .se-recur { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 800; color: #7A9B76; background: #EDF2EB; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
    .se-title { font-weight: 800; font-size: 15px; color: var(--ink); margin-top: 4px; }
    .se-span { display: flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 800; color: #4E93B8; margin-top: 6px; }
    .se-place { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--ink2); margin-top: 5px; }
    .se-who { display: flex; align-items: center; gap: 7px; margin-top: 8px; }
    .se-who .dot { width: 20px; height: 20px; font-size: 10px; }
    .se-who span:last-child { font-size: 13px; font-weight: 700; color: var(--ink2); }
    .side-empty { background: var(--surface); border-radius: 18px; padding: 28px; text-align: center; color: var(--ink3); font-weight: 700; font-size: 14px; box-shadow: 0 10px 24px -18px rgba(90,60,40,.6); }

    /* ===== informational overlay items (holidays, school, birthdays, tasks) ===== */
    .ex-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
    .tap { cursor: pointer; }
    .ex-lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* Une tâche faite est barrée dans le calendrier comme dans sa liste. */
    .ex-lbl.strike, .sx-lbl.strike { text-decoration: line-through; color: var(--ink3); }
    .chip-ex { display: flex; align-items: center; gap: 4px; border-radius: 6px; padding: 2px 5px; background: var(--surface); font-size: 10px; font-weight: 800; color: var(--ink2); white-space: nowrap; overflow: hidden; }
    .col-ex { display: flex; align-items: center; gap: 6px; background: var(--surface); border-radius: 10px; padding: 6px 9px; font-size: 12px; font-weight: 800; color: var(--ink2); }
    .col-ex .ex-sub { margin-left: auto; font-size: 10.5px; font-weight: 700; color: var(--ink3); flex: none; }
    .legend { display: flex; flex-wrap: wrap; gap: 8px 12px; padding: 2px 2px 4px; }
    .lg-item { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 800; color: var(--ink3); }
    @media (max-width: 520px) { .legend { display: none; } }
    .side-extras { display: flex; flex-direction: column; gap: 8px; }
    .side-ex { display: flex; align-items: center; gap: 9px; background: var(--surface); border-radius: 14px; padding: 12px 14px; box-shadow: 0 8px 20px -18px rgba(90,60,40,.6); }
    .side-ex .ex-dot { width: 10px; height: 10px; }
    .sx-lbl { font-size: 13.5px; font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sx-sub { margin-left: auto; font-size: 12px; font-weight: 700; color: var(--ink3); flex: none; }

    /* ===== événements venus de l'emploi du temps ===== */
    /* Dérivés d'un créneau, ils s'ouvrent sur leur créneau source : un fond
       légèrement teinté et une étiquette « Emploi du temps » les distinguent
       d'un événement propre à l'agenda, qu'on modifie sur place. */
    .col-ev.slotev, .side-ev.slotev { background: color-mix(in srgb, var(--ink) 3%, var(--surface)); }
    .slotev-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 6px; }
    .slotev-tag, .se-slot { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 800; color: var(--ink3); white-space: nowrap; }
    .se-slot { font-size: 11px; background: var(--soft); padding: 3px 9px; border-radius: 20px; }
    .side-ev.slotev .se-who { margin-top: 8px; }
    .chip-ex.slotev { gap: 3px; }

    .fl { font-size: 12px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .allday { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; cursor: pointer; font-size: 14px; font-weight: 800; color: var(--ink); }
    .allday .box { width: 20px; height: 20px; flex: none; border-radius: 6px; background: var(--surface); box-shadow: inset 0 0 0 2px var(--line); display: flex; align-items: center; justify-content: center; }
    .allday .box.on { background: var(--primary); box-shadow: none; }
    .ev-times { display: flex; gap: 12px; margin-bottom: 18px; }
    .ev-times > div { flex: 1; min-width: 0; }
    .ev-times .input { width: 100%; }
    .dp { background: var(--soft); border: 2px solid var(--line); border-radius: 16px; padding: 14px; margin-bottom: 8px; }
    .dp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .dp-nav { width: 30px; height: 30px; border: none; border-radius: 9px; background: var(--surface); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .dp-label { font-size: 15px; font-weight: 700; color: var(--ink); text-transform: capitalize; }
    .dp-dow { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px; margin-bottom: 4px; }
    .dp-dow span { text-align: center; font-size: 10px; font-weight: 800; color: var(--ink3); }
    .dp-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px; }
    .dp-cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border-radius: 9px; cursor: pointer; font-size: 13px; font-weight: 700; color: var(--ink); }
    .dp-cell.between { background: rgba(229,107,78,.14); }
    .dp-cell.sel { background: var(--primary); color: #fff; font-weight: 800; }
    .dp-cell.ring { box-shadow: inset 0 0 0 2px var(--honey); }
    .dp-summary { display: flex; align-items: center; gap: 8px; margin: 8px 0 20px; }
    .dp-summary span { font-size: 13px; font-weight: 800; color: var(--ink); }
    .seg-members { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .seg-members button { border: none; padding: 9px 14px; border-radius: 11px; font-size: 13px; font-weight: 800; cursor: pointer; }
    .seg-recur { display: flex; flex-wrap: wrap; gap: 8px; }
    .seg-recur button { border: none; padding: 9px 14px; border-radius: 11px; font-size: 13px; font-weight: 800; cursor: pointer; background: var(--soft); color: var(--ink2); }
    .seg-recur button.active { background: var(--primary); color: #fff; }
    .modal-foot { display: flex; gap: 12px; align-items: center; margin-top: 26px; }
    .modal-foot .btn-primary { flex: 1; }
    .del { color: var(--primary); }
  `],
})
export class CalendarScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  weekdays = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  recurOpts: Recur[] = ['none', 'daily', 'weekday', 'weekly', 'biweekly', 'monthly'];

  cv = computed(() => this.store.ui().calView);
  sel = computed(() => this.store.ui().selDay);

  headerLabel = computed(() => {
    const v = this.store.ui().calView;
    const a = parseDay(this.store.ui().calAnchor);
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
    const a = parseDay(this.store.ui().calAnchor);
    const start = this.monday(new Date(a.getFullYear(), a.getMonth(), 1));
    const month = a.getMonth();
    const allDay = (this.store.data()?.events || []).filter((e) => (e.recur || 'none') === 'none' && this.isAllDay(e));
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
      const days: MonthCell[] = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(wsD); d.setDate(wsD.getDate() + i); const key = dstr(d);
        // Les événements « journée entière » non récurrents sont des barres, pas des pastilles de case.
        const items = this.dayItems(key).filter((it) => it.kind !== 'event' || !((it.ev.recur || 'none') === 'none' && this.isAllDay(it.ev)));
        const extras = this.store.dayExtras(key);
        const hidden = Math.max(0, items.length - 2) + Math.max(0, extras.length - 2);
        days.push({ key, num: d.getDate(), inMonth: d.getMonth() === month, items: items.slice(0, 2), extras: extras.slice(0, 2), more: hidden, covered: covered.has(i + 1) });
      }
      rows.push({ key: weekStart, days, bars, lanes: laneEnd.length });
    }
    return rows;
  });

  cols = computed(() => {
    const v = this.store.ui().calView;
    if (v === 'month') return [];
    const a = parseDay(this.store.ui().calAnchor);
    const start = v === 'week' ? this.monday(a) : a;
    const n = v === 'week' ? 7 : 3;
    const selDay = this.store.ui().selDay;
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dstr(d);
      out.push({ key, dow: DOW[(d.getDay() + 6) % 7], num: d.getDate(), items: this.dayItems(key), extras: this.store.dayExtras(key), isToday: key === this.store.todayStr(), isSel: key === selDay });
    }
    return out;
  });

  selItems = computed(() => this.dayItems(this.store.ui().selDay));
  selExtras = computed(() => this.store.dayExtras(this.store.ui().selDay));

  /**
   * L'agenda d'un jour, événements propres et créneaux publiés **mêlés et triés
   * par heure**. Sans cela, un créneau de midi s'affichait après un événement de
   * 20 h, parce que les deux vivaient dans deux listes séparées. Une heure vide
   * (« — », événement sur la journée) passe en tête.
   */
  dayItems(key: string): DayItem[] {
    const evs: DayItem[] = this.store.eventsForDay(key).map((ev) => ({ t: /^\d\d:\d\d/.test(ev.time) ? ev.time : '', kind: 'event', ev }));
    const slots: DayItem[] = this.store.slotEventsForDay(key).map((se) => ({ t: se.time, kind: 'slot', se }));
    return [...evs, ...slots].sort((a, b) => a.t.localeCompare(b.t));
  }

  /** « 12:00 – 12:45 », ou « 12:00 » sans fin, ou « — » sans heure. */
  timeLabel(ev: EventItem): string { return ev.endTime ? ev.time + ' – ' + ev.endTime : ev.time; }
  selLabel = computed(() => cap(parseDay(this.store.ui().selDay).toLocaleDateString(this.store.locale, { weekday: 'long', day: 'numeric', month: 'long' })));

  legendKinds = [
    ...['holiday', 'school', 'birthday', 'task', 'echeance'].map((k) => ({ k, color: CAL_KINDS[k].color, label: CAL_KINDS[k].label })),
    { k: 'planning', color: SCHED_COLORS['ecole'], label: 'Emploi du temps' },
  ];

  // ===== mini-calendrier du panneau latéral =====
  miniDows = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  miniLabel = computed(() => cap(parseDay(this.store.ui().miniAnchor).toLocaleDateString(this.store.locale, { month: 'long', year: 'numeric' })));

  /** Six semaines du mois affiché, chacune avec son numéro de semaine ISO. */
  miniRows = computed(() => {
    const a = parseDay(this.store.ui().miniAnchor);
    const start = this.monday(new Date(a.getFullYear(), a.getMonth(), 1));
    const month = a.getMonth();
    const today = this.store.todayStr();
    const sel = this.store.ui().selDay;
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

  miniNav(kind: 'month' | 'year', dir: number): void {
    const a = parseDay(this.store.ui().miniAnchor);
    if (kind === 'month') a.setMonth(a.getMonth() + dir); else a.setFullYear(a.getFullYear() + dir);
    this.store.patch({ miniAnchor: dstr(a) });
  }

  /** Sauter à une date : on la sélectionne, la vue principale suit, le mini reste sur ce mois. */
  pickMini(key: string): void {
    this.store.patch({ selDay: key, calAnchor: key, miniAnchor: key });
  }

  /** Une pastille d'événement dans une case de mois ouvre l'événement, sans déclencher la création. */
  openEventChip(e: Event, id: string): void {
    e.stopPropagation();
    this.store.editEvent(id);
  }

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

  modalTitle = computed(() => (this.store.ui().evEditId ? "Modifier l'événement" : 'Nouvel événement'));
  dpLabel = computed(() => cap(new Date(2026, 6 + this.store.ui().dpMonth, 1).toLocaleDateString(this.store.locale, { month: 'long', year: 'numeric' })));
  dpSummary = computed(() => {
    const s = this.store.ui();
    return s.evEnd ? `Du ${this.fmtSummary(s.evStart)} au ${this.fmtSummary(s.evEnd)}` : `Le ${this.fmtSummary(s.evStart)}`;
  });

  dpCells = computed(() => {
    const s = this.store.ui();
    const base = new Date(2026, 6 + s.dpMonth, 1);
    const start = this.monday(base);
    const bm = base.getMonth();
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dstr(d);
      const isSel = key === s.evStart || (!!s.evEnd && key === s.evEnd);
      const between = !!s.evEnd && key > s.evStart && key < s.evEnd;
      out.push({ key, num: d.getDate(), inMonth: d.getMonth() === bm, isToday: key === this.store.todayStr(), sel: isSel, between });
    }
    return out;
  });

  private monday(d: Date): Date {
    const x = new Date(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }

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

  fmtSummary(key: string): string {
    return parseDay(key).toLocaleDateString(this.store.locale, { weekday: 'short', day: 'numeric', month: 'long' });
  }

  recurLabel(r: Recur): string {
    return r === 'none' ? 'Ponctuel' : RECUR_LABELS[r];
  }

  setView(v: 'month' | 'week' | '3'): void { this.store.patch({ calView: v }); }

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
    this.store.openEvent();
  }

  /** Un repère qui est une tâche s'ouvre d'un tap ; les autres (férié, anniversaire, échéance) restent des repères. */
  openExtra(e: Event, ex: DayExtra): void {
    if (!ex.id) return;
    e.stopPropagation();
    this.store.openTaskItem(ex.id);
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
