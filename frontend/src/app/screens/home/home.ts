import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { WhoComponent } from '../../shared/who';
import { recentActivity } from '../../core/activity';
import { relTime } from '../../core/activity';
import { EventItem, TaskItem } from '../../core/models';
import { WhoBadge, whoBadges } from '../../core/schedule';
import { cap, parseDay } from '../../core/helpers';

/** Une entrée « à venir » du bandeau : un évènement de l'agenda, ou une tâche datée. */
type Ahead =
  | { date: string; time: string; kind: 'event'; ev: EventItem }
  | { date: string; time: string; kind: 'task'; task: TaskItem; list: string; color: string };

interface FinLine { label: string; value: string; tone: 'pos' | 'neg' | 'ink'; }
type FinState =
  | { kind: 'hidden' | 'loading' | 'error' | 'empty' }
  | { kind: 'ok'; month: string; lines: FinLine[] };

/**
 * L'accueil, façon « mur de la famille ».
 *
 * Une colonne : le fil de ce qui a récemment changé (tâches cochées, articles
 * ajoutés...). Un bandeau à droite : les prochains rendez-vous, les dernières
 * tâches, les repas du jour, et un sommaire des finances. Pas de « bouton
 * exprimez-vous » : le bouton « + » de la barre couvre déjà la création.
 *
 * L'écran compose, il ne calcule pas de règle métier : chaque bloc lit son
 * fournisseur (le store, le fil d'activité, les finances) et se contente de le
 * mettre en forme.
 */
@Component({
  selector: 'screen-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent, WhoComponent],
  template: `
    <div class="screen-enter">
      <div class="home-head">
        <div>
          <div class="hello f-script">{{ hello() }}</div>
          <div class="screen-sub">{{ store.fmtLongDate(store.todayStr()) }}</div>
        </div>
        @if (store.data()) {
          <button class="btn btn-sage" (click)="store.prepareList(store.weekDays())">
            <f-icon name="bolt" [size]="20" color="#fff" /> Courses de la semaine depuis les repas
          </button>
        }
      </div>

      <div class="home-wrap">
        <!-- ===== fil d'activité ===== -->
        <div class="card feed">
          <div class="feed-head">
            <f-icon name="bolt" [size]="17" color="#E56B4E" [width]="2.2" />
            <span>Activité récente</span>
          </div>
          @for (a of activity(); track $index) {
            <div class="act">
              <f-avatar [ini]="ini(a.by)" [color]="col(a.by)" [size]="36" />
              <div class="act-b">
                <div class="act-l"><b>{{ nm(a.by) }}</b> {{ a.verb }} <b>« {{ a.what }} »</b></div>
                <div class="act-m">
                  <span class="act-where" [style.background]="store.tint(a.color)" [style.color]="a.color">{{ a.where }}</span>
                  <span class="act-t">{{ rel(a.at) }}</span>
                </div>
              </div>
            </div>
          } @empty {
            <div class="feed-empty">
              Rien de récent pour l'instant. Dès qu'une tâche est cochée ou qu'un article rejoint les courses, ça s'affiche ici.
            </div>
          }
        </div>

        <!-- ===== bandeau ===== -->
        <div class="rail">
          <!-- prochains évènements -->
          <div class="card rc">
            <div class="rc-head"><span>Prochains évènements</span><button class="rc-link" (click)="store.go('calendar')">Agenda</button></div>
            @for (a of nextAgenda(); track $index) {
              @if (a.kind === 'event') {
                <div class="rc-row ev" (click)="store.editEvent(a.ev.id)">
                  <div class="ev-when" [style.background]="store.tint(evColor(a.ev))" [style.color]="evColor(a.ev)">
                    <span class="ev-day">{{ dayLabel(a.date) }}</span>
                    <span class="ev-time">{{ a.ev.time === '—' ? 'jour.' : a.ev.time }}</span>
                  </div>
                  <div class="rc-main">
                    <div class="rc-title">{{ a.ev.title }}</div>
                    @if (a.ev.who.length) { <f-who [badges]="badges(a.ev)" /> }
                  </div>
                </div>
              } @else {
                <div class="rc-row ev" (click)="store.openTaskItem(a.task.id)">
                  <div class="ev-when" [style.background]="store.tint(a.color)" [style.color]="a.color">
                    <span class="ev-day">{{ dayLabel(a.date) }}</span>
                    <span class="ev-time">@if (a.task.time) { {{ a.task.time }} } @else { <f-icon name="taches" [size]="12" [color]="a.color" [width]="2.4" /> }</span>
                  </div>
                  <div class="rc-main">
                    <div class="rc-title">{{ a.task.text }}</div>
                    <span class="rc-sub">{{ a.list }}</span>
                  </div>
                </div>
              }
            } @empty {
              <div class="rc-empty">Rien à venir.</div>
            }
          </div>

          <!-- dernières tâches -->
          <div class="card rc">
            <div class="rc-head"><span>Dernières tâches</span><button class="rc-link" (click)="store.go('taches')">Tâches</button></div>
            @for (t of latestTasks(); track t.t.id) {
              <div class="rc-row task" (click)="store.openTaskItem(t.t.id)">
                <span class="t-dot" [style.background]="t.color" [class.done]="t.t.done"></span>
                <span class="t-text" [class.strike]="t.t.done">{{ t.t.text }}</span>
                <span class="t-list">{{ t.list }}</span>
              </div>
            } @empty {
              <div class="rc-empty">Aucune tâche pour l'instant.</div>
            }
          </div>

          <!-- repas du jour -->
          <div class="card rc">
            <div class="rc-head"><span>Repas du jour</span><button class="rc-link" (click)="store.go('repas')">Planning</button></div>
            @for (m of todayMeals(); track m.key) {
              <div class="rc-row meal" (click)="store.go('repas')">
                <span class="m-dot" [style.background]="m.dot"></span>
                <span class="m-slot">{{ m.short }}</span>
                <span class="m-dish" [class.none]="!m.label">{{ m.label || 'À planifier' }}</span>
              </div>
            }
          </div>

          <!-- finances -->
          @if (fin() !== null) {
            <div class="card rc fin">
              <div class="rc-head"><span>Finances</span><button class="rc-link" (click)="store.go('finances')">Détails</button></div>
              @switch (fin()!.kind) {
                @case ('ok') {
                  <div class="fin-month">{{ finOk().month }}</div>
                  @for (l of finOk().lines; track $index) {
                    <div class="rc-row fin-line">
                      <span class="f-label">{{ l.label }}</span>
                      <span class="f-val" [class.pos]="l.tone === 'pos'" [class.neg]="l.tone === 'neg'">{{ l.value }} €</span>
                    </div>
                  }
                }
                @case ('loading') { <div class="rc-empty">Chargement du relevé...</div> }
                @case ('error') { <div class="rc-empty">Relevé indisponible pour le moment.</div> }
                @case ('empty') { <div class="rc-empty">Le module Finances n'est pas encore utilisé.</div> }
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .hello { font-size: 40px; color: var(--primary); line-height: .9; font-weight: 700; }
    .home-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }

    .home-wrap { display: grid; grid-template-columns: 1fr 344px; gap: 20px; align-items: start; }
    :host-context(.shell.narrow) .home-wrap { grid-template-columns: 1fr; }
    @media (max-width: 900px) { .home-wrap { grid-template-columns: 1fr; } }

    /* ===== fil d'activité ===== */
    .feed { padding: 20px 22px; }
    .feed-head { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 800; color: var(--ink); margin-bottom: 14px; }
    .act { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
    .act:first-of-type { border-top: none; padding-top: 2px; }
    .act-b { min-width: 0; flex: 1; }
    .act-l { font-size: 14px; color: var(--ink2); line-height: 1.35; }
    .act-l b { color: var(--ink); font-weight: 800; }
    .act-m { display: flex; align-items: center; gap: 8px; margin-top: 5px; }
    .act-where { font-size: 10.5px; font-weight: 800; padding: 2px 9px; border-radius: 20px; white-space: nowrap; }
    .act-t { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .feed-empty { padding: 30px 10px; text-align: center; color: var(--ink3); font-weight: 700; font-size: 13.5px; line-height: 1.5; }

    /* ===== bandeau ===== */
    .rail { display: flex; flex-direction: column; gap: 16px; }
    .rc { padding: 16px 18px; }
    .rc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13.5px; font-weight: 800; color: var(--ink); margin-bottom: 10px; }
    .rc-link { border: none; background: var(--soft); border-radius: 9px; padding: 5px 11px; font-size: 11.5px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .rc-link:hover { background: var(--soft2); }
    .rc-empty { font-size: 12.5px; font-weight: 700; color: var(--ink3); padding: 6px 2px 4px; }
    .rc-row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line); cursor: pointer; }
    .rc-row:first-of-type { border-top: none; }

    /* prochains évènements */
    .ev-when { flex: none; width: 52px; height: 40px; border-radius: 11px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .ev-day { font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .02em; }
    .ev-time { font-size: 12px; font-weight: 800; }
    .rc-main { min-width: 0; flex: 1; }
    .rc-title { font-size: 13.5px; font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rc-sub { display: block; margin-top: 2px; font-size: 11px; font-weight: 700; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rc-main f-who { margin-top: 4px; display: block; }

    /* dernières tâches */
    .t-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .t-dot.done { opacity: .4; }
    .t-text { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 700; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .t-text.strike { text-decoration: line-through; color: var(--ink3); font-weight: 600; }
    .t-list { flex: none; font-size: 11px; font-weight: 800; color: var(--ink3); }

    /* repas du jour */
    .m-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .m-slot { flex: none; width: 46px; font-size: 12px; font-weight: 800; color: var(--ink2); }
    .m-dish { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .m-dish.none { color: var(--ink3); font-weight: 700; font-style: italic; }

    /* finances */
    .fin-month { font-size: 11.5px; font-weight: 800; color: var(--ink3); text-transform: capitalize; margin-bottom: 2px; }
    .fin-line { cursor: default; }
    .f-label { flex: 1; font-size: 13px; font-weight: 700; color: var(--ink2); }
    .f-val { font-size: 13.5px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
    .f-val.pos { color: #5F9A55; }
    .f-val.neg { color: #C2503A; }
  `],
})
export class HomeScreen {
  store = inject(FoyerStore);
  private fins = inject(FinancesStore);

  constructor() {
    // L'accueil demande aux finances le mois courant, une fois, et le laisse
    // suivre l'horloge du foyer. Un compte enfant n'a pas accès au module :
    // l'appeler ne rendrait qu'un 403.
    let asked = '';
    effect(() => {
      if (!this.store.authed() || this.store.isChild()) return;
      const month = this.store.todayStr().slice(0, 7);
      if (!month || month === asked) return;
      asked = month;
      void this.fins.loadHome(month);
    });
  }

  readonly hello = computed(() => { const n = this.store.me()?.name; return n ? 'Bonjour ' + n : 'Bonjour'; });

  readonly activity = computed(() => { const d = this.store.data(); return d ? recentActivity(d, 12) : []; });

  /**
   * Les 4 prochaines échéances de l'agenda, aujourd'hui compris et jusqu'à deux
   * mois devant : les évènements et les tâches datées, mêlés et triés par date
   * puis par heure. Une tâche sans heure passe en tête de son jour.
   */
  readonly nextAgenda = computed<Ahead[]>(() => {
    const d = this.store.data();
    if (!d) return [];
    const today = this.store.todayStr();
    const horizon = this.store.addDays(today, 62);
    const out: Ahead[] = [];
    for (let i = 0; i < 62; i++) {
      const day = this.store.addDays(today, i);
      for (const ev of this.store.eventsForDay(day)) out.push({ date: day, time: ev.time === '—' ? '' : ev.time, kind: 'event', ev });
    }
    const lists = new Map(this.store.visibleTaskLists().map((l) => [l.id, l]));
    for (const t of d.tasks || []) {
      if (t.done || !t.due || t.due < today || t.due > horizon) continue;
      const l = lists.get(t.listId);
      if (!l) continue;
      out.push({ date: t.due, time: t.time || '', kind: 'task', task: t, list: l.name, color: l.color });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).slice(0, 4);
  });

  /** Les 4 tâches les plus récemment ajoutées, dans les listes que ce membre voit. */
  readonly latestTasks = computed(() => {
    const d = this.store.data();
    if (!d) return [];
    const lists = new Map(this.store.visibleTaskLists().map((l) => [l.id, l]));
    return (d.tasks || [])
      .filter((t) => lists.has(t.listId))
      .slice()
      .sort((a, b) => (b.at || '').localeCompare(a.at || ''))
      .slice(0, 4)
      .map((t) => ({ t, list: lists.get(t.listId)!.name, color: lists.get(t.listId)!.color }));
  });

  /** Les créneaux de repas du jour et leurs plats. */
  readonly todayMeals = computed(() => {
    const d = this.store.data();
    const today = this.store.todayStr();
    return this.store.mealSlots().map((s) => ({ key: s.key, short: s.short, dot: s.dot, label: this.store.mealLabel(d?.meals[today + '-' + s.key]) }));
  });

  /** Le sommaire des finances : caché pour un enfant, sinon quatre lignes du mois. */
  readonly fin = computed<FinState | null>(() => {
    if (this.store.isChild()) return null;
    const home = this.fins.home();
    if (!home) return this.fins.homeError() ? { kind: 'error' } : { kind: 'loading' };
    if (!home.accounts) return { kind: 'empty' };
    const s = home.summary;
    const sign = (c: number): 'pos' | 'neg' | 'ink' => (c > 0 ? 'pos' : c < 0 ? 'neg' : 'ink');
    const lines: FinLine[] = [
      { label: 'Revenus', value: fmtEuros(s.income), tone: 'pos' },
      { label: 'Dépenses', value: fmtEuros(s.expense), tone: 'neg' },
      { label: 'Solde du mois', value: fmtEuros(s.balance), tone: sign(s.balance) },
      home.currentBalance !== null
        ? { label: 'Comptes courants', value: fmtEuros(home.currentBalance), tone: sign(home.currentBalance) }
        : { label: 'Budget du mois', value: fmtEuros(s.budgetTotal), tone: 'ink' },
    ];
    return { kind: 'ok', month: cap(parseDay(home.month + '-01').toLocaleDateString(this.store.locale, { month: 'long', year: 'numeric' })), lines };
  });

  /** Vue affinée quand `fin()` vaut « ok », pour l'accès aux champs dans le template. */
  readonly finOk = computed(() => this.fin() as { kind: 'ok'; month: string; lines: FinLine[] });

  // ---- helpers de rendu ----
  ini(id: string | null): string { return (id && (this.store.data()?.members || []).find((m) => m.id === id)?.ini) || '?'; }
  col(id: string | null): string { return id ? this.store.memberColor(id) : '#8A7E74'; }
  nm(id: string | null): string { return (id && this.store.memberName(id)) || 'Quelqu’un'; }
  rel(iso: string): string { return relTime(iso, Date.now()); }

  badges(ev: EventItem): WhoBadge[] { return whoBadges({ who: ev.who }, this.store.data()?.members || []); }
  evColor(ev: EventItem): string { return ev.who.length ? this.store.memberColor(ev.who[0]) : '#E56B4E'; }

  /** « Auj. », « Demain », sinon « lun. 12 ». */
  dayLabel(date: string): string {
    const today = this.store.todayStr();
    if (date === today) return 'Auj.';
    if (date === this.store.addDays(today, 1)) return 'Demain';
    return cap(parseDay(date).toLocaleDateString(this.store.locale, { weekday: 'short', day: 'numeric' }));
  }
}
