import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FinancesStore } from '../../core/finances.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { AgendaRowComponent } from '../../shared/agenda-row';
import { RingCheckComponent } from '../../shared/ring-check';
import { WhoComponent } from '../../shared/who';
import { ModalComponent } from '../../shared/modal';
import { ActivityGroup, groupActivity, recentActivity } from '../../core/activity';
import { AttentionItem, euros, homeAttention, homeBrief, interroLabel, weekdayOf } from '../../core/home-attention';
import { cap, parseDay } from '../../core/helpers';
import { WhoBadge, whoBadges } from '../../core/schedule';
import { RELEGATION_DAYS, dailyTasks, standing, todayTasks, whenLabel } from '../../core/tasks';
import { occurrenceProgress, recLabel } from '../../core/recurrence';
import { EcoleStore, subjectLabel } from '../../core/ecole.store';
import { gesteGroup, stockLow } from '../../core/entretien';
import { lastDoneDay } from '../../core/task-ops';
import { EquipementsStore } from '../../core/equipements.store';
import { EmployesStore } from '../../core/employes.store';
import { RevisionsStore } from '../../core/revisions/store';
import { HomeBase } from './home-base';

/** Le bloc Finances du bureau : le reste pour finir le mois, et où l'on en est du mois. */
type FinState =
  | { kind: 'loading' | 'error' | 'empty' }
  | { kind: 'ok'; month: string; big: string; neg: boolean; line: string; day: number; days: number };

/** Une ligne de l'agenda du bureau : événement, créneau publié ou repère du jour. */
interface AgRow { key: string; t: string; start: string; end: string; color: string; label: string; title: string; light: boolean; meta: string; metaIcon: string; who: WhoBadge[]; open: () => void; }

/** Le libellé gris d'un repère, là où un événement a son heure (comme au Calendrier). */
const EXTRA_LABELS: Record<string, string> = {
  task: 'Tâche', birthday: 'Anniv.', holiday: 'Férié', echeance: 'Échéance', cesu: 'CESU', ecole: 'Interro', garantie: 'Garantie', departure: 'Départ',
};

/**
 * L'accueil d'un adulte sur grand écran : « le point du jour ».
 *
 * De haut en bas : l'en-tête du jour et sa phrase de synthèse, les cartes
 * « À régler » (ce qui demande d'agir, avec l'action sur place), puis le temps
 * (agenda sur 4 jours, à faire, repas), puis le reste (finances, enfants, fil
 * du foyer regroupé). Les règles vivent dans core/home-attention.ts et
 * core/activity.ts ; l'écran compose.
 */
@Component({
  selector: 'app-home-desk',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent, NgTemplateOutlet, AgendaRowComponent, RingCheckComponent, WhoComponent, ModalComponent],
  template: `
    <!-- Une ligne du fil du bureau : un geste seul, ou plusieurs regroupés. -->
    <ng-template #feedRow let-g>
      <div class="fr">
        @if (g.first.author) { <f-avatar [ini]="authorIni(g.first.author)" color="#3D6FA8" [size]="22" /> } @else { <f-avatar [ini]="ini(g.first.by)" [color]="col(g.first.by)" [size]="22" /> }
        <div class="fr-b">
          <div class="ft"><b>{{ g.first.author || nm(g.first.by) }}</b>@if (g.first.via && g.first.via !== g.first.author) { <span class="act-via" [class.ed]="g.first.via === 'ÉcoleDirecte'">{{ g.first.via === 'ÉcoleDirecte' ? 'sur ÉcoleDirecte' : 'via un assistant' }}</span>} {{ g.verb }} @if (g.count === 1) {<button type="button" class="act-name" (click)="openActivity(g.first)">{{ g.bold }}</button>} @else {<b>{{ g.bold }}</b>}{{ g.tail }}</div>
          @if (g.count > 1) { <div class="fs">{{ titlesLine(g) }}</div> }
        </div>
        <span class="fm">{{ rel(g.at) }}</span>
      </div>
    </ng-template>

        <!-- ===== bureau : le point du jour =====
             D'abord ce qui demande d'agir, puis le temps (agenda, à faire, repas),
             puis le reste (finances, enfants, fil du foyer). -->
        <div class="day">
          <div class="dh">
            <span class="dh-hello f-script">{{ hello() }}</span>
            <span class="dh-date">{{ longDate() }}</span>
            @if (dayContext()) { <span class="dh-ctx"><span class="dh-band"></span>{{ dayContext() }}</span> }
          </div>
          <p class="brief">@for (p of brief(); track $index) {@if (p.b) {<b>{{ p.text }}</b>} @else {<span>{{ p.text }}</span>}}</p>

          @if (attention().length) {
            <div class="atts">
              @for (a of attShown(); track a.id) {
                <div class="att" [class.crit]="a.tone === 'crit'" [class.warn]="a.tone === 'warn'">
                  <div class="att-m"><f-icon [name]="a.icon" [size]="14" [color]="a.color" [width]="2.4" />{{ a.module }}</div>
                  <div class="att-t">{{ a.title }}</div>
                  <div class="att-s">{{ a.sub }}</div>
                  @if (!a.done) {
                    <button class="att-btn" (click)="act(a)">@if (a.action.kind === 'geste-done') {<f-icon name="check" [size]="13" color="currentColor" [width]="2.8" />}{{ a.action.label }}</button>
                  }
                </div>
              }
            </div>
            @if (attention().length > 4) {
              <button class="att-more" (click)="attAll.set(!attAll())">{{ attAll() ? 'Moins' : '+ ' + (attention().length - 4) + (attention().length - 4 > 1 ? ' autres' : ' autre') }}</button>
            }
          }

          <div class="g-main">
            <section class="blk">
              <div class="bh"><h3>Agenda</h3><button class="more" (click)="store.go('calendar')">Calendrier ›</button></div>
              <div class="box agenda">
                @for (g of agendaDays(); track g.date) {
                  <div class="aday">
                    <div class="ag-g" [class.today]="g.isToday"><div class="d">{{ g.num }}</div><div class="m">{{ g.wd }}</div></div>
                    <div class="ag-rows">
                      @for (r of g.rows; track r.key) {
                        <f-agenda-row [start]="r.start" [end]="r.end" [timeColor]="r.color" [label]="r.label" [title]="r.title" [dot]="r.start ? '' : r.color" [light]="r.light" (click)="r.open()">
                          @if (r.meta) {
                            <div meta class="reg-meta"><span>@if (r.metaIcon) {<f-icon [name]="r.metaIcon" [size]="12" color="var(--ink2)" [width]="2.2" />} @else {<span class="reg-sq" [style.background]="r.color"></span>}{{ r.meta }}</span></div>
                          }
                          @if (r.who.length) { <f-who aside [badges]="r.who" [size]="20" /> }
                        </f-agenda-row>
                      }
                    </div>
                  </div>
                } @empty {
                  <div class="empty">Rien de prévu dans les 14 prochains jours. <button class="more inline" (click)="store.openItem('event', null)">Ajouter un événement ›</button></div>
                }
              </div>
            </section>

            <div class="col">
              <section class="blk">
                <div class="bh"><h3>À faire</h3><button class="more" (click)="store.go('taches')">Tâches ›</button></div>
                <div class="reg-box">
                  @for (t of todo().rows; track t.task.id) {
                    <div class="reg-row" (click)="store.openItem('task', t.task.id)">
                      <f-ring-check [color]="t.color" [progress]="t.ring" [late]="t.late" [label]="t.task.text" (toggle)="store.toggleTask(t.task.id)" />
                      <div class="reg-main">
                        <div class="reg-text">{{ t.task.text }}</div>
                        <div class="reg-meta">
                          <span [class.late]="t.late">{{ t.when }}</span>
                          @if (t.rec) { <span><f-icon name="refresh" [size]="12" color="var(--ink2)" [width]="2.4" /> {{ t.rec }}</span> }
                          <span><span class="reg-sq" [style.background]="t.color"></span>{{ t.list }}</span>
                        </div>
                      </div>
                      @if (t.who.length) { <f-who [badges]="t.who" [size]="20" /> }
                    </div>
                  } @empty {
                    <div class="empty">Rien à faire aujourd’hui.</div>
                  }
                  @if (todo().more) { <button class="more-row" (click)="store.go('taches')">+ {{ todo().more }} {{ todo().more > 1 ? 'autres' : 'autre' }} ›</button> }
                </div>
              </section>

              @if (store.modRepas()) {
                <section class="blk">
                  <div class="bh"><h3>Repas</h3><button class="more" (click)="store.go('repas')">Planning ›</button></div>
                  <div class="box meals">
                    @for (r of mealsGrid(); track r.date) {
                      <div class="mrow" [style.grid-template-columns]="mealCols()">
                        <span class="ml">{{ r.label }}</span>
                        @for (m of r.slots; track m.key) {
                          <button class="mi" [class.none]="!m.label" (click)="store.openMeal(r.date, m.key)"><small>{{ m.short }}</small>{{ m.label || '·' }}</button>
                        }
                      </div>
                    }
                    <button class="more inline" (click)="store.go('repas')">Planifier la semaine ›</button>
                  </div>
                </section>
              }
            </div>
          </div>

          <div class="g-low" [style.--low-cols]="lowCols()">
            @if (store.modFinances() && fin(); as f) {
              <section class="blk">
                <div class="bh"><h3>Finances</h3><button class="more" (click)="store.go('finances')">Détails ›</button></div>
                <div class="box kpi">
                  @switch (f.kind) {
                    @case ('ok') {
                      @let o = finOk();
                      <div class="kl">Reste pour finir {{ o.month }}</div>
                      <div class="kv" [class.neg]="o.neg">{{ o.big }}</div>
                      @if (o.line) { <div class="ks">{{ o.line }}</div> }
                      <div class="bar"><span [style.width.%]="(100 * o.day) / o.days"></span></div>
                      <div class="ks">Jour {{ o.day }} sur {{ o.days }}</div>
                    }
                    @case ('loading') { <div class="ks">Chargement du relevé...</div> }
                    @case ('error') { <div class="ks">Relevé indisponible pour le moment.</div> }
                    @case ('empty') { <div class="ks">Le module Finances n'est pas encore utilisé.</div> }
                  }
                </div>
              </section>
            }
            @if (kids().length) {
              <section class="blk">
                <div class="bh"><h3>Les enfants</h3>
                  @if (store.modEcole()) { <button class="more" (click)="store.go('ecole')">École ›</button> } @else { <button class="more" (click)="store.go('revisions')">Révisions ›</button> }
                </div>
                <div class="box kids">
                  @for (k of kids(); track k.id) {
                    <div class="kid-r" [class.inert]="!k.follow" (click)="k.follow ? revisions.openFollow(k.id) : null">
                      <f-avatar [ini]="k.ini" [color]="k.color" [size]="28" />
                      <div class="kid-b">
                        <div class="kid-n">{{ k.name }}</div>
                        @if (k.hw) { <button class="kid-l" (click)="$event.stopPropagation(); k.hwId ? store.openItem('homework', k.hwId) : store.go('ecole')"><f-icon name="ecole" [size]="12" color="var(--ink2)" [width]="2.2" /> {{ k.hw }}</button> }
                        @if (k.rev) { <span class="kid-l"><f-icon name="grille" [size]="12" color="var(--ink2)" [width]="2.2" /> {{ k.rev }}</span> }
                      </div>
                    </div>
                  }
                  @if (store.modEcole() && ecole.syncLine(); as sl) { <div class="sync" [class.ko]="!sl.ok">{{ sl.ok ? 'ÉcoleDirecte : ' + sl.text.charAt(0).toLowerCase() + sl.text.slice(1) : sl.text }}</div> }
                </div>
              </section>
            }
            <section class="blk">
              <div class="bh"><h3>Dans le foyer</h3>@if (feed().length) { <button class="more" (click)="feedAll.set(true)">Tout ›</button> }</div>
              <div class="box feed-d">
                @for (g of feed(); track $index) { <ng-container [ngTemplateOutlet]="feedRow" [ngTemplateOutletContext]="{ $implicit: g }" /> }
                @empty { <div class="empty">Rien de récent pour l’instant.</div> }
              </div>
            </section>
          </div>
        </div>
        @if (feedAll()) {
          <f-modal title="Dans le foyer" [maxWidth]="580" [tall]="true" (close)="feedAll.set(false)">
            <div class="feed-d all">
              @for (g of feedFull(); track $index) { <ng-container [ngTemplateOutlet]="feedRow" [ngTemplateOutletContext]="{ $implicit: g }" /> }
            </div>
          </f-modal>
        }
  `,
  styles: [`
    :host { display: block; }
    .act-via { font-size: 10.5px; font-weight: 800; color: var(--violet); background: rgba(155,111,168,.14); padding: 1px 7px; border-radius: 20px; white-space: nowrap; }
    .act-via.ed { color: #3D6FA8; background: #E3ECF7; }
    /* Le nom est un lien vers l'élément, coupé en fin de ligne comme le texte qui l'entoure. */
    .act-name { display: inline; font: inherit; font-weight: 800; color: var(--ink); background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
    .act-name:hover { color: var(--primary); text-decoration: underline; }
    .day { max-width: 1400px; margin: 0 auto; }
    .dh { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 14px; }
    .dh-hello { font-size: 34px; font-weight: 700; color: var(--primary); line-height: 1; }
    .dh-date { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--ink); }
    .dh-ctx { display: inline-flex; align-items: center; gap: 7px; margin-left: 6px; font-size: 13px; font-weight: 800; color: var(--ink2); }
    .dh-band { width: 14px; height: 3px; border-radius: 2px; background: #D99A2B; }
    .brief { margin: 8px 0 18px; font-size: 15px; font-weight: 600; color: var(--ink2); }
    .brief b { color: var(--ink); font-weight: 800; }

    /* une surface par bloc : 1px de ligne en clair, rien en sombre, aucune ombre */
    .box, .att { background: var(--surface); border-radius: 16px; border: 1px solid var(--line); }
    :host-context(:root.dark) .box, :host-context(:root.dark) .att { border-color: transparent; }
    .blk { min-width: 0; }
    .bh { display: flex; align-items: baseline; gap: 8px; margin: 0 2px 8px; }
    .bh h3 { margin: 0; font-family: var(--font-display); font-size: 16.5px; font-weight: 700; color: var(--ink); }
    .more { margin-left: auto; border: none; background: none; padding: 0; font: inherit; font-size: 13px; font-weight: 800; color: var(--ink2); cursor: pointer; white-space: nowrap; }
    .more:hover { color: var(--ink); }
    .more.inline { margin: 6px 0 0; }
    .empty { padding: 14px 16px; font-size: 13.5px; font-weight: 700; color: var(--ink3); }
    .empty .more.inline { margin: 0 0 0 6px; }

    /* à régler */
    .atts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .att { display: flex; flex-direction: column; gap: 3px; padding: 14px 14px 12px; min-width: 0; }
    .att-m { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: var(--ink2); }
    .att-t { margin-top: 4px; font-size: 15px; font-weight: 800; color: var(--ink); line-height: 1.3; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
    .att-s { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .att.crit .att-s { color: var(--status-crit); }
    .att.warn .att-s { color: var(--status-warn); }
    .att-btn { margin-top: auto; align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line2); background: none; border-radius: 9px; padding: 5px 11px; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--ink); cursor: pointer; }
    .att-s + .att-btn { margin-top: 10px; }
    .att-btn:hover { background: var(--soft); }
    .att-more { display: block; margin: 8px 2px 0 auto; border: none; background: none; padding: 0; font: inherit; font-size: 13px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .g-main { display: grid; grid-template-columns: 1.25fr 1fr; gap: 22px; margin-top: 26px; align-items: start; }
    .col { display: grid; gap: 22px; align-content: start; min-width: 0; }
    .g-low { display: grid; grid-template-columns: var(--low-cols); gap: 22px; margin-top: 22px; align-items: start; }

    /* agenda : un échéancier, le jour en gouttière */
    .agenda { padding: 4px 14px; --agenda-hover: var(--soft); }
    .aday { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 0 4px; padding: 8px 0; border-top: 1px solid var(--line); }
    .aday:first-child { border-top: none; }
    .ag-g { padding-top: 8px; }
    .ag-g .d { font-family: var(--font-display); font-size: 26px; font-weight: 700; line-height: 1; letter-spacing: -.02em; color: var(--ink); font-variant-numeric: tabular-nums; }
    .ag-g .m { margin-top: 2px; font-size: 11.5px; font-weight: 800; color: var(--ink2); }
    .ag-g.today .d, .ag-g.today .m { color: var(--primary); }
    .ag-rows { min-width: 0; }
    .ag-rows f-agenda-row { padding: 6px; }

    /* à faire */
    .more-row { display: block; width: 100%; border: none; background: var(--surface); padding: 10px 16px; text-align: left; font: inherit; font-size: 13px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .more-row:hover { background: var(--soft); }

    /* repas */
    .meals { padding: 10px 14px; }
    .mrow { display: grid; gap: 10px; align-items: baseline; padding: 6px 0; border-top: 1px solid var(--line); }
    .mrow:first-child { border-top: none; }
    .ml { font-size: 13px; font-weight: 800; color: var(--ink); }
    .mi { min-width: 0; border: none; background: none; padding: 2px 0; text-align: left; font: inherit; font-size: 14px; font-weight: 700; color: var(--ink); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mi small { display: block; font-size: 11px; font-weight: 800; color: var(--ink3); }
    .mi.none { color: var(--ink3); }
    .mi:hover { color: var(--primary); }

    /* finances */
    .kpi { padding: 14px 16px; }
    .kl { font-size: 12.5px; font-weight: 800; color: var(--ink2); }
    .kv { margin-top: 2px; font-family: var(--font-display); font-size: 30px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; color: var(--ink); font-variant-numeric: tabular-nums; }
    .kv.neg { color: var(--status-crit); }
    .ks { font-size: 12px; font-weight: 700; color: var(--ink3); font-variant-numeric: tabular-nums; }
    .bar { height: 6px; margin: 10px 0 4px; border-radius: 3px; background: var(--soft2); overflow: hidden; }
    .bar span { display: block; height: 100%; border-radius: 3px; background: var(--ink3); }

    /* les enfants */
    .kids { padding: 6px 14px; }
    .kid-r { display: flex; gap: 12px; padding: 9px 0; border-top: 1px solid var(--line); cursor: pointer; }
    .kid-r:first-child { border-top: none; }
    .kid-r.inert { cursor: default; }
    .kid-b { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
    .kid-n { font-size: 14.5px; font-weight: 700; color: var(--ink); }
    .kid-l { display: inline-flex; align-items: center; gap: 5px; border: none; background: none; padding: 0; font: inherit; font-size: 12px; font-weight: 700; color: var(--ink2); text-align: left; }
    button.kid-l { cursor: pointer; }
    button.kid-l:hover { color: var(--ink); }
    .sync { padding: 6px 0 8px; border-top: 1px solid var(--line); font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .sync.ko { color: var(--status-crit); }

    /* dans le foyer */
    .feed-d { padding: 4px 14px; }
    .feed-d.all { padding: 0; border: none; }
    .feed-d > .empty { padding: 10px 0; }
    .fr { display: flex; align-items: flex-start; gap: 11px; padding: 9px 0; border-top: 1px solid var(--line); }
    .fr:first-child { border-top: none; }
    .fr-b { flex: 1; min-width: 0; }
    .ft { font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.35; }
    .ft b, .ft .act-name { color: var(--ink); font-weight: 800; }
    .fs { margin-top: 1px; font-size: 12px; font-weight: 600; color: var(--ink3); }
    .fm { flex: none; font-size: 11.5px; font-weight: 700; color: var(--ink3); white-space: nowrap; }

    @media (max-width: 1180px) {
      .atts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .g-main, .g-low { grid-template-columns: minmax(0, 1fr); }
    }

  `],
})
export class HomeDeskComponent extends HomeBase {
  private fins = inject(FinancesStore);
  readonly ecole = inject(EcoleStore);
  readonly revisions = inject(RevisionsStore);
  private eqp = inject(EquipementsStore);
  private emp = inject(EmployesStore);

  /**
   * Le bloc Finances du bureau : le reste pour finir le mois en grand, une ligne
   * de contexte, et la barre du mois. Pas de ligne à zéro.
   */
  readonly fin = computed<FinState | null>(() => {
    if (this.store.isChild()) return null;
    const home = this.fins.home();
    if (!home) return this.fins.homeError() ? { kind: 'error' } : { kind: 'loading' };
    if (!home.accounts) return { kind: 'empty' };
    const rest = this.fins.homeRemaining() ?? 0;
    const fixed = this.fins.homeFixedDue();
    const [y, m] = home.month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const today = this.store.todayStr();
    const line = [home.currentBalance !== null ? `comptes courants ${euros(home.currentBalance)}` : '', fixed > 0 ? `charges fixes à venir ${euros(fixed)}` : ''].filter(Boolean).join(' · ');
    return {
      kind: 'ok', month: parseDay(home.month + '-01').toLocaleDateString(this.store.locale, { month: 'long' }),
      big: euros(rest).replace('-', '−'), neg: rest < 0, line: cap(line), day: today.startsWith(home.month) ? Number(today.slice(8, 10)) : days, days,
    };
  });

  /** Vue affinée quand `fin()` vaut « ok », pour l'accès aux champs dans le template. */
  readonly finOk = computed(() => this.fin() as Extract<FinState, { kind: 'ok' }>);

  // ===== bureau : le point du jour =====

  /** « Vendredi 30 octobre ». */
  readonly longDate = computed(() => cap(this.store.fmtLongDate(this.store.todayStr())));

  /** Le repère du jour : la période de vacances et sa rentrée, un jour férié. Vide sinon. */
  readonly dayContext = computed(() => {
    const today = this.store.todayStr(); const cal = this.store.calendar();
    const parts: string[] = [];
    const sh = this.store.schoolHolidays().find((h) => today >= h.start && today <= h.end);
    if (sh) {
      let i = 1;
      for (; i <= 30; i++) { const ds = this.store.addDays(today, i); const dow = parseDay(ds).getDay(); const f = cal(ds); if (dow !== 0 && dow !== 6 && !f.holiday && !f.schoolHoliday) break; }
      const back = this.store.addDays(today, i);
      parts.push(`${sh.name} · rentrée ${i === 1 ? 'demain' : i < 7 ? weekdayOf(back) : 'le ' + this.store.fmtNumDate(back)}`);
    }
    const ferie = this.store.dayExtras(today).find((x) => x.kind === 'holiday');
    if (ferie) parts.push(`${ferie.label}, jour férié`);
    return parts.join(' · ');
  });

  /**
   * Ce qui demande d'agir, toutes sources : chaque module éteint passe `null`
   * et ne produit rien. La règle (seuils, titres, ordre) vit dans home-attention.ts.
   */
  readonly attention = computed<AttentionItem[]>(() => {
    const d = this.store.seenData();
    if (!d || this.store.isChild()) return [];
    const today = this.store.todayStr();
    const ent = this.store.modEntretien() ? this.store.gestes().filter((t) => !t.done) : null;
    const home = this.store.modFinances() ? this.fins.home() : null;
    const nc = this.store.modEcole() ? this.ecole.nextClassByStudent() : null;
    const sl = this.store.modEcole() ? this.ecole.syncLine() : null;
    const eqp = this.store.modEquipements() && this.eqp.boot() ? this.eqp.items() : null;
    return homeAttention({
      today, fmt: (iso) => this.store.fmtNumDate(iso),
      gestes: ent && ent.filter((t) => ['retard', 'bientot'].includes(gesteGroup(t, today, 2)))
        .map((t) => ({ id: t.id, text: t.text, due: t.due!, late: gesteGroup(t, today, 2) === 'retard', doneToday: lastDoneDay(t) === today })),
      finances: home && home.accounts && this.fins.homeRemaining() !== null ? { remaining: this.fins.homeRemaining()!, fixedDue: this.fins.homeFixedDue() } : null,
      preps: this.prepAlerts().map((a) => ({ listId: a.list.id, name: a.list.forMember ? this.store.memberName(a.list.forMember) || a.list.name : a.list.name, forMember: !!a.list.forMember, days: a.days, remaining: a.remaining })),
      repas: this.store.modRepas() ? [0, 1, 2].flatMap((i) => { const ds = this.store.addDays(today, i); return this.store.mealSlots().map((s) => ({ date: ds, key: s.key, planned: !!this.store.mealLabel(d.meals[ds + '-' + s.key]) })); }) : null,
      ecole: nc || sl ? {
        syncKo: sl && !sl.ok ? sl.text : null,
        tests: (nc?.students ?? []).flatMap((s) => s.items.filter((h) => h.isTest && !h.done).map((h) => ({ id: String(h.id), student: s.name, subject: subjectLabel(h.subject), day: nc!.day, due: nc!.date, count: s.items.filter((x) => !x.done).length }))),
      } : null,
      contrats: home ? home.deadlines.filter((x) => x.kind === 'preavis').map((x) => ({ contractId: x.contractId, name: x.contractName, date: x.date, daysAway: x.daysAway })) : null,
      releves: home ? home.energy.due.map((r) => ({ contractId: r.contractId, name: r.name, daysSince: r.daysSince })) : null,
      stocks: ent && ent.filter((t) => stockLow(t.maintenance?.stock)).map((t) => ({ id: t.id, article: t.maintenance!.stock!.article, onList: this.store.onShoppingList(t.maintenance!.stock!.article) })),
      equipements: eqp && eqp.filter((e) => !e.archivedAt && (e.status === 'en_panne' || (e.status === 'en_service' && e.warranty.state === 'expire_bientot')))
        .map((e) => ({ id: e.id, name: e.name, panne: e.status === 'en_panne', until: e.warranty.until })),
      cesu: this.store.modEmploye() ? this.emp.cesuDue() : null,
    });
  });
  /** Le bandeau montre 4 cartes ; « + n autres » déplie les suivantes. */
  readonly attAll = signal(false);
  readonly attShown = computed(() => (this.attAll() ? this.attention() : this.attention().slice(0, 4)));

  /** Les rendez-vous du jour : événements et créneaux à heure, sans les journées entières ni les repères. */
  private readonly rdvToday = computed(() => {
    const today = this.store.todayStr();
    return this.store.eventsForDay(today).filter((ev) => !this.isAllDay(ev)).length + this.store.slotEventsForDay(today).length;
  });
  readonly brief = computed(() => {
    const d = this.store.seenData(); const today = this.store.todayStr();
    const noDinner = !!d && this.store.modRepas() && this.store.mealSlots().some((s) => s.key === 'soir') && !this.store.mealLabel(d.meals[today + '-soir']);
    return homeBrief(this.rdvToday(), this.attention().length, noDinner);
  });

  /**
   * L'agenda du bureau : les 4 prochains jours qui ont quelque chose, cherchés sur
   * 14 jours. Événements, créneaux publiés et repères du jour (tâches,
   * anniversaires, fériés, échéances…), comme au Calendrier ; la période de
   * vacances n'y est pas, l'en-tête la dit déjà.
   */
  readonly agendaDays = computed(() => {
    const d = this.store.seenData();
    if (!d) return [];
    const today = this.store.todayStr(); const members = d.members;
    const lists = new Set(this.store.visibleTaskLists().map((l) => l.id));
    const out: { date: string; num: number; wd: string; isToday: boolean; rows: AgRow[] }[] = [];
    for (let i = 0; i < 14 && out.length < 4; i++) {
      const ds = this.store.addDays(today, i);
      const rows: AgRow[] = [];
      for (const ev of this.store.eventsForDay(ds)) {
        const timed = !this.isAllDay(ev);
        rows.push({ key: 'e' + ev.id, t: timed ? ev.time : '', start: timed ? ev.time : '', end: timed ? ev.endTime || '' : '', color: this.evColor(ev), label: 'Journée', title: ev.title, light: false,
          meta: ev.place || '', metaIcon: 'pin', who: whoBadges(ev, members), open: () => this.store.openItem('event', ev.id, { occ: ds }) });
      }
      for (const se of this.store.slotEventsForDay(ds)) {
        rows.push({ key: 's' + se.id, t: se.time, start: se.time, end: se.end, color: 'var(--ink2)', label: '', title: se.title, light: false,
          meta: 'Emploi du temps', metaIcon: 'planning', who: whoBadges(se, members), open: () => this.store.openSlotEvent(se.slotId, ds) });
      }
      for (const x of this.store.dayExtras(ds)) {
        if (x.kind === 'school' || x.done) continue;
        const task = x.kind === 'task' && x.id ? d.tasks.find((t) => t.id === x.id) : undefined;
        // Une tâche d'une liste que ce membre ne voit pas (privée, module éteint) n'a rien à faire ici.
        if (x.kind === 'task' && (!task || !lists.has(task.listId))) continue;
        const time = task?.time || '';
        rows.push({ key: 'x' + x.kind + (x.id || x.label), t: time, start: time, end: '', color: x.color, label: EXTRA_LABELS[x.kind] || 'Repère', title: x.label, light: true,
          meta: task ? '' : x.sub || '', metaIcon: '', who: task ? whoBadges(task, members) : [], open: () => (task ? this.store.openItem('task', task.id) : this.store.go('calendar')) });
      }
      if (!rows.length) continue;
      rows.sort((a, b) => a.t.localeCompare(b.t));
      out.push({ date: ds, num: parseDay(ds).getDate(), wd: i === 0 ? 'aujourd’hui' : parseDay(ds).toLocaleDateString(this.store.locale, { weekday: 'short' }), isToday: i === 0, rows });
    }
    return out;
  });

  /**
   * « À faire » : comme l'affaire du jour de Tâches (listes « tâches » et
   * « devoirs » que ce membre voit, le vieux retard relégué derrière le jour
   * même et jamais décompté), puis ce qui vient dans les 7 jours. Les gestes
   * d'entretien y montent aussi, sauf ceux déjà dans « À régler ». Six lignes,
   * le reste se compte.
   */
  readonly todo = computed(() => {
    const d = this.store.seenData();
    if (!d) return { rows: [], more: 0 };
    const today = this.store.todayStr(); const until = this.store.addDays(today, 7);
    const shown = new Set(this.attention().filter((a) => a.action.kind === 'geste-done').map((a) => a.action.ref));
    const lists = new Map(d.taskLists.map((l) => [l.id, l]));
    const visible = new Set(this.store.visibleTaskLists().map((l) => l.id));
    const pool = [...dailyTasks(d.tasks, d.taskLists, this.store.currentMemberId()), ...this.store.gestes().filter((t) => visible.has(t.listId))]
      .filter((t) => !shown.has(t.id) && !t.done && !t.parentId);
    const soon = pool.filter((t) => standing(t, today) === 'soon' && t.due! <= until)
      .sort((a, b) => a.due!.localeCompare(b.due!) || (a.time || '').localeCompare(b.time || ''));
    const all = [...todayTasks(pool, today, pool.length).lines.filter((l) => l.task.due), ...soon.map((task) => ({ task, late: 0 }))];
    const rows = all.slice(0, 6).map(({ task: t, late }) => {
      const l = lists.get(t.listId); const w = whenLabel(t.due!, today, t.rec?.grace);
      return { task: t, color: l?.color || '#8A7E74', list: l?.name || 'Sans liste', late: late > 0, when: late > 0 && late <= RELEGATION_DAYS && w.rel ? w.rel : w.day,
        rec: t.rec ? recLabel(t.rec, (iso) => this.store.fmtNumDate(iso)) : '', ring: t.rec ? occurrenceProgress(t.rec, t.due!, today) : null, who: whoBadges(t, d.members) };
    });
    return { rows, more: all.length - rows.length };
  });

  /** Les repas d'aujourd'hui et de demain, une case par créneau actif. */
  readonly mealsGrid = computed(() => {
    const d = this.store.seenData();
    return [{ date: this.store.todayStr(), label: 'Aujourd’hui' }, { date: this.tomorrowStr(), label: 'Demain' }].map((r) => ({
      ...r, slots: this.store.mealSlots().map((s) => ({ key: s.key, short: s.short, label: this.store.mealLabel(d?.meals[r.date + '-' + s.key]) })),
    }));
  });
  readonly mealCols = computed(() => `96px repeat(${this.store.mealSlots().length}, minmax(0, 1fr))`);

  /**
   * « Les enfants » : une ligne par enfant, élève ÉcoleDirecte ou suivi en
   * Révisions. Les devoirs du prochain jour de classe, puis les révisions du
   * jour, sans jamais reprocher un zéro.
   */
  readonly kids = computed(() => {
    const members = this.store.seenData()?.members || [];
    const nc = this.store.modEcole() ? this.ecole.nextClassByStudent() : null;
    const rev = this.store.modRevisions() ? this.revisions.kidsToday() : {};
    const ids = [...new Set([...(nc?.students.map((s) => s.memberId) ?? []), ...this.store.children().filter((k) => rev[k.id] !== undefined).map((k) => k.id)])];
    return ids.map((id) => {
      const m = members.find((x) => x.id === id);
      const st = nc?.students.find((s) => s.memberId === id);
      let hw = '', hwId = '';
      if (st && nc) {
        const todo = st.items.filter((h) => !h.done);
        const test = todo.find((h) => h.isTest);
        const autres = todo.length - (test ? 1 : 0);
        hw = test ? interroLabel(subjectLabel(test.subject), nc.day) + (autres ? `, ${autres} autre${autres > 1 ? 's' : ''} devoir${autres > 1 ? 's' : ''}` : '')
          : todo.length ? `${todo.length} devoir${todo.length > 1 ? 's' : ''} pour ${nc.day}` : `Rien pour ${nc.day}`;
        hwId = test ? String(test.id) : todo.length === 1 ? String(todo[0].id) : '';
      }
      const n = rev[id];
      return {
        id, name: m?.name || st?.name || '', ini: m?.ini || '?', color: this.store.memberColor(id), hw, hwId, follow: n !== undefined,
        rev: n === undefined ? '' : n ? `${n} session${n > 1 ? 's' : ''} de révision aujourd’hui` : 'Pas encore révisé aujourd’hui',
      };
    });
  });

  /** La rangée basse se partage entre les blocs présents : un bloc seul prend toute la largeur. */
  readonly lowCols = computed(() => {
    const n = 1 + Number(this.store.modFinances() && this.fin() !== null) + Number(this.kids().length > 0);
    return n === 3 ? '1fr 1fr 1.1fr' : n === 2 ? '1fr 1.1fr' : '1fr';
  });

  /** Le fil du foyer, regroupé : trois groupes sur l'accueil, tout dans la fenêtre « Tout ». */
  readonly feed = computed(() => { const d = this.store.seenData(); return d ? groupActivity(recentActivity(d, 30)).slice(0, 3) : []; });
  readonly feedFull = computed(() => { const d = this.store.seenData(); return d ? groupActivity(recentActivity(d, 50)) : []; });
  readonly feedAll = signal(false);
  /** Les trois premiers titres d'un groupe, pour la sous-ligne. */
  titlesLine(g: ActivityGroup): string { return g.titles.slice(0, 3).join(', ') + (g.titles.length > 3 ? '…' : ''); }

  /** Le bouton d'une carte « À régler ». */
  act(a: AttentionItem): void {
    const r = a.action.ref;
    switch (a.action.kind) {
      case 'geste-done': this.store.toggleTask(r); break;
      case 'finances': this.fins.goTab('apercu'); this.store.go('finances'); break;
      case 'prep': this.openPrep(r); break;
      case 'repas': this.store.go('repas'); break;
      case 'devoir': this.store.openItem('homework', r); break;
      case 'ecole': this.store.go('ecole'); break;
      case 'contrat': case 'releve': void this.fins.openContract(Number(r)); break;
      case 'stock': this.store.gesteToShopping(r); break;
      case 'equipement': this.store.openItem('equipment', r); break;
      case 'cesu': this.store.go('employe'); break;
    }
  }
}
