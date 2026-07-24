import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore, DayExtra } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { DOW, RECUR_LABELS, CAL_KINDS } from '../core/constants';
import { cap, parseDay, dstr } from '../core/helpers';
import { Recur } from '../core/models';

interface Chip { title: string; bg: string; fg: string; }
interface MonthCell { key: string; num: number; inMonth: boolean; chips: Chip[]; extras: DayExtra[]; more: number; }

@Component({
  selector: 'screen-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
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
            <div class="month-grid">
              @for (c of monthCells(); track c.key) {
                <div class="mcell"
                     [style.background]="c.key === sel() ? 'rgba(229,107,78,.14)' : 'var(--soft)'"
                     [style.border]="cellBorder(c.key)"
                     (click)="store.patch({ selDay: c.key })">
                  <span class="mnum" [style.color]="c.inMonth ? 'var(--ink)' : 'var(--ink3)'">{{ c.num }}</span>
                  @for (chip of c.chips; track $index) {
                    <div class="chip-ev" [style.background]="chip.bg" [style.color]="chip.fg">{{ chip.title }}</div>
                  }
                  @for (ex of c.extras; track $index) {
                    <div class="chip-ex" [style.border-left]="'3px solid ' + ex.color">
                      <span class="ex-dot" [style.background]="ex.color"></span>
                      <span class="ex-lbl">{{ ex.label }}</span>
                    </div>
                  }
                  @if (c.more) { <span class="more">+{{ c.more }} autre</span> }
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
                    @for (e of col.events; track e.id) {
                      <div class="col-ev" [style.border-left]="'4px solid ' + store.memberColor(e.who)" (click)="store.editEvent(e.id)">
                        <div class="ce-time f-display">{{ e.time }}</div>
                        <div class="ce-title">{{ e.title }}</div>
                        <div class="ce-who">
                          <span class="dot" [style.background]="store.memberColor(e.who)">{{ store.memberIni(e.who) }}</span>
                          <span>{{ store.memberName(e.who) }}</span>
                        </div>
                      </div>
                    } @empty {
                      @if (!col.extras.length) {
                        <div class="col-empty" (click)="addAt(col.key)">Libre</div>
                      }
                    }
                    @for (ex of col.extras; track $index) {
                      <div class="col-ex" [style.border-left]="'3px solid ' + ex.color">
                        <span class="ex-dot" [style.background]="ex.color"></span>
                        <span class="ex-lbl">{{ ex.label }}</span>
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
          <div class="side-title f-display">{{ selLabel() }}</div>
          <div class="side-date">{{ store.fmtNumDate(sel()) }}</div>
          @for (e of selEvents(); track e.id) {
            <div class="side-ev" [style.border-left]="'4px solid ' + store.memberColor(e.who)" (click)="store.editEvent(e.id)">
              <div class="se-top">
                <div class="se-time f-display">{{ e.time }}</div>
                @if (e.recur !== 'none') {
                  <span class="se-recur"><f-icon name="refresh" [size]="12" color="#7A9B76" [width]="2.4" /> {{ recurLabel(e.recur) }}</span>
                }
              </div>
              <div class="se-title">{{ e.title }}</div>
              @if (e.end && e.end !== e.date) {
                <div class="se-span"><f-icon name="calendar" [size]="13" color="#4E93B8" [width]="2.2" /> du {{ fmtShort(e.date) }} au {{ fmtShort(e.end) }}</div>
              }
              <div class="se-who">
                <span class="dot" [style.background]="store.memberColor(e.who)">{{ store.memberIni(e.who) }}</span>
                <span>{{ store.memberName(e.who) }}</span>
              </div>
            </div>
          } @empty {
            @if (!selExtras().length) {
              <div class="side-empty">Aucun événement ce jour</div>
            }
          }
          @if (selExtras().length) {
            <div class="side-extras">
              @for (ex of selExtras(); track $index) {
                <div class="side-ex" [style.border-left]="'4px solid ' + ex.color">
                  <span class="ex-dot" [style.background]="ex.color"></span>
                  <span class="sx-lbl">{{ ex.label }}</span>
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

          <div class="fl">Heure</div>
          <input class="input" [ngModel]="store.ui().evTime" (ngModelChange)="store.patch({ evTime: $event })"
                 placeholder="08:00" style="width:130px;margin-bottom:18px" />

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
          <div class="seg-members">
            @for (m of d().members; track m.id) {
              <button [style.background]="store.ui().evWho === m.id ? m.color : 'var(--soft)'"
                      [style.color]="store.ui().evWho === m.id ? '#fff' : 'var(--ink2)'"
                      (click)="store.patch({ evWho: m.id })">{{ m.name }}</button>
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

    .dow-row { display: grid; grid-template-columns: repeat(7,1fr); gap: 6px; margin-bottom: 8px; }
    .dow { text-align: center; font-size: 12px; font-weight: 800; color: var(--ink3); padding: 4px; }
    .month-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 6px; }
    .mcell { min-height: 92px; border-radius: 14px; padding: 8px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; box-sizing: border-box; overflow: hidden; }
    .mnum { font-size: 13px; font-weight: 800; align-self: flex-end; }
    .chip-ev { border-radius: 6px; padding: 2px 6px; font-size: 10px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
    .side-title { font-size: 18px; font-weight: 700; color: var(--ink); text-transform: capitalize; margin: 6px 0 2px; }
    .side-date { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-bottom: 6px; }
    .side-ev { background: var(--surface); border-radius: 18px; padding: 16px; box-shadow: 0 10px 24px -18px rgba(90,60,40,.6); cursor: pointer; }
    .se-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .se-time { font-size: 16px; font-weight: 700; color: var(--ink); }
    .se-recur { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 800; color: #7A9B76; background: #EDF2EB; padding: 3px 9px; border-radius: 20px; white-space: nowrap; }
    .se-title { font-weight: 800; font-size: 15px; color: var(--ink); margin-top: 4px; }
    .se-span { display: flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 800; color: #4E93B8; margin-top: 6px; }
    .se-who { display: flex; align-items: center; gap: 7px; margin-top: 8px; }
    .se-who .dot { width: 20px; height: 20px; font-size: 10px; }
    .se-who span:last-child { font-size: 13px; font-weight: 700; color: var(--ink2); }
    .side-empty { background: var(--surface); border-radius: 18px; padding: 28px; text-align: center; color: var(--ink3); font-weight: 700; font-size: 14px; box-shadow: 0 10px 24px -18px rgba(90,60,40,.6); }

    /* ===== informational overlay items (holidays, school, birthdays, tasks) ===== */
    .ex-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
    .ex-lbl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

    .fl { font-size: 12px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
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
  recurOpts: Recur[] = ['none', 'daily', 'weekday', 'weekly', 'monthly'];

  cv = computed(() => this.store.ui().calView);
  sel = computed(() => this.store.ui().selDay);

  headerLabel = computed(() => {
    const v = this.store.ui().calView;
    const a = parseDay(this.store.ui().calAnchor);
    if (v === 'month') return cap(a.toLocaleDateString(this.store.locale(), { month: 'long', year: 'numeric' }));
    const start = v === 'week' ? this.monday(a) : a;
    const end = new Date(start);
    end.setDate(start.getDate() + (v === 'week' ? 6 : 2));
    return cap(this.rangeLabel(start, end));
  });

  monthCells = computed<MonthCell[]>(() => {
    const a = parseDay(this.store.ui().calAnchor);
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const start = this.monday(first);
    const month = a.getMonth();
    const out: MonthCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dstr(d);
      const evs = this.store.eventsForDay(key);
      out.push({
        key,
        num: d.getDate(),
        inMonth: d.getMonth() === month,
        chips: evs.slice(0, 2).map((e) => ({ title: e.title, bg: this.store.tint(this.store.memberColor(e.who)), fg: this.store.memberColor(e.who) })),
        extras: this.store.dayExtras(key).slice(0, 2),
        more: evs.length > 2 ? evs.length - 2 : 0,
      });
    }
    return out;
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
      out.push({ key, dow: DOW[(d.getDay() + 6) % 7], num: d.getDate(), events: this.store.eventsForDay(key), extras: this.store.dayExtras(key), isToday: key === this.store.todayStr(), isSel: key === selDay });
    }
    return out;
  });

  selEvents = computed(() => this.store.eventsForDay(this.store.ui().selDay));
  selExtras = computed(() => this.store.dayExtras(this.store.ui().selDay));
  selLabel = computed(() => cap(parseDay(this.store.ui().selDay).toLocaleDateString(this.store.locale(), { weekday: 'long', day: 'numeric', month: 'long' })));

  legendKinds = ['holiday', 'school', 'birthday', 'task'].map((k) => ({ k, color: CAL_KINDS[k].color, label: CAL_KINDS[k].label }));

  modalTitle = computed(() => (this.store.ui().evEditId ? "Modifier l'événement" : 'Nouvel événement'));
  dpLabel = computed(() => cap(new Date(2026, 6 + this.store.ui().dpMonth, 1).toLocaleDateString(this.store.locale(), { month: 'long', year: 'numeric' })));
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
      return `${start.getDate()}–${end.getDate()} ${start.toLocaleDateString(this.store.locale(), { month: 'long' })}`;
    }
    return `${start.getDate()} ${start.toLocaleDateString(this.store.locale(), { month: 'short' })} – ${end.getDate()} ${end.toLocaleDateString(this.store.locale(), { month: 'short' })}`;
  }

  fmtShort(key: string): string {
    const d = parseDay(key);
    return `${d.getDate()} ${d.toLocaleDateString(this.store.locale(), { month: 'short' })}`;
  }

  fmtSummary(key: string): string {
    return parseDay(key).toLocaleDateString(this.store.locale(), { weekday: 'short', day: 'numeric', month: 'long' });
  }

  recurLabel(r: Recur): string {
    return r === 'none' ? 'Ponctuel' : RECUR_LABELS[r];
  }

  cellBorder(key: string): string {
    if (key === this.store.ui().selDay) return '2px solid var(--primary)';
    if (key === this.store.todayStr()) return '2px solid var(--honey)';
    return '2px solid transparent';
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
}
