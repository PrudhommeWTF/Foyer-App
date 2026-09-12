import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild, viewChildren } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FoyerStore } from '../../core/foyer.store';
import { AdminStore } from '../../core/admin.store';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { WhoComponent } from '../../shared/who';
import { recentActivity, relTime } from '../../core/activity';
import { EventItem, TaskItem, TaskList } from '../../core/models';
import { WhoBadge, whoBadges } from '../../core/schedule';
import { cap, parseDay } from '../../core/helpers';
import { navGroupsFor } from '../../shell/nav';

/** Une entrée « à venir » du bandeau : un évènement de l'agenda, ou une tâche datée. */
type Ahead =
  | { date: string; time: string; kind: 'event'; ev: EventItem }
  | { date: string; time: string; kind: 'task'; task: TaskItem; list: string; color: string };

interface FinLine { label: string; value: string; tone: 'pos' | 'neg' | 'ink'; }
type FinState =
  | { kind: 'hidden' | 'loading' | 'error' | 'empty' }
  | { kind: 'ok'; month: string; lines: FinLine[] };

/** Une tuile de module de la grille mobile. */
interface Mod { id: string; label: string; icon: string; color: string; sub: string; }

/** La couleur d'accent de chaque module, pour colorer son icône dans la grille. */
const MOD_COLOR: Record<string, string> = {
  calendar: '#E56B4E', courses: '#7A9B76', taches: '#9B6FA8',
  repas: '#4E93B8', recettes: '#E56B4E', finances: '#7A9B76',
  planning: '#4E93B8', contacts: '#9B6FA8', fidelite: '#F0B24B', lieux: '#4E93B8',
};

/** Les sections du carousel mobile, dans l'ordre. */
const SLIDES: { key: 'activity' | 'agenda' | 'tasks' | 'meals'; label: string }[] = [
  { key: 'activity', label: 'Activité' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'tasks', label: 'Tâches' },
  { key: 'meals', label: 'Repas' },
];

/**
 * L'accueil, façon « mur de la famille ».
 *
 * Sur grand écran, deux colonnes : le fil de ce qui a récemment changé à gauche,
 * un bandeau à droite (prochains rendez-vous, dernières tâches, repas du jour,
 * sommaire des finances).
 *
 * Sur petit écran, la même matière tient dans un carousel qui tourne (une section
 * à la fois, des pastilles pour sauter de l'une à l'autre), suivi d'une grille des
 * modules du foyer sur deux colonnes. Les cinq cartes sont écrites une seule fois
 * (des `ng-template`) et rendues aux deux endroits.
 *
 * L'écran compose, il ne calcule pas de règle métier : chaque bloc lit son
 * fournisseur (le store, le fil d'activité, les finances) et se contente de le
 * mettre en forme.
 */
@Component({
  selector: 'screen-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent, WhoComponent, NgTemplateOutlet],
  template: `
    <!-- Invitation à activer les rappels, au premier lancement installé. -->
    <ng-template #pushCard>
      <div class="card push-invite">
        <div class="pi-head"><f-icon name="bell" [size]="18" color="var(--primary)" [width]="2.2" /><span>Recevoir les rappels sur cet appareil</span></div>
        <p class="pi-text">Tâches à faire, affectations, échéances : Foyer vous préviendra ici, même l'app fermée.</p>
        <div class="pi-actions">
          <button class="btn btn-primary" (click)="admin.enablePush()" [disabled]="admin.pushBusy()">Activer</button>
          <button class="btn btn-ghost" (click)="admin.snoozePushInvite()">Plus tard</button>
        </div>
      </div>
    </ng-template>

    <!-- ===== les cinq cartes, écrites une fois ===== -->
    <ng-template #feedCard>
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
    </ng-template>

    <ng-template #agendaCard>
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
    </ng-template>

    <ng-template #tasksCard>
      <div class="card rc">
        <div class="rc-head"><span>Dernières tâches</span><button class="rc-link" (click)="store.go('taches')">Tâches</button></div>
        @for (a of prepAlerts(); track a.list.id) {
          <div class="rc-row prep" (click)="openPrep(a.list.id)">
            <f-icon name="suitcase" [size]="14" [color]="a.list.color" [width]="2.2" />
            <span class="prep-line">{{ prepLine(a) }}</span>
          </div>
        }
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
    </ng-template>

    <ng-template #mealsCard>
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
    </ng-template>

    <ng-template #finCard>
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
    </ng-template>

    <div class="screen-enter">
      <div class="home-head">
        <div>
          <div class="hello f-script">{{ hello() }}</div>
          <div class="screen-sub">{{ store.fmtLongDate(store.todayStr()) }}</div>
        </div>
      </div>

      @if (store.data() && admin.pushInvite()) { <ng-container [ngTemplateOutlet]="pushCard" /> }

      @if (!store.data()) {
        <!-- ===== aucun document chargé (réseau coupé au démarrage) ===== -->
        <div class="card no-doc">
          <f-icon name="urgent" [size]="36" color="#C2503A" [width]="2" />
          <div class="nd-title">On n'a pas pu charger votre foyer</div>
          <div class="nd-msg">{{ store.docError() || 'Le serveur est injoignable pour le moment. Vérifiez votre connexion, puis réessayez.' }}</div>
          <button class="btn btn-primary" (click)="reload()" [disabled]="reloading()">
            @if (reloading()) { Chargement... } @else { Réessayer }
          </button>
        </div>
      } @else if (store.narrow()) {
        <!-- ===== mobile : carousel + grille de modules ===== -->
        <div class="home-m">
          <div class="carousel">
            <div class="track fscroll-x" #track (scroll)="onScroll(track)" (pointerdown)="onTouch()">
              @for (sl of slides(); track sl.key) {
                <div class="slide">
                  @switch (sl.key) {
                    @case ('activity') { <ng-container [ngTemplateOutlet]="feedCard" /> }
                    @case ('agenda') { <ng-container [ngTemplateOutlet]="agendaCard" /> }
                    @case ('tasks') { <ng-container [ngTemplateOutlet]="tasksCard" /> }
                    @case ('meals') { <ng-container [ngTemplateOutlet]="mealsCard" /> }
                  }
                </div>
              }
            </div>
            <div class="pills">
              @for (sl of slides(); track sl.key; let i = $index) {
                <button #pillBtn class="pill" [class.on]="active() === i" (click)="goSlide(i)">{{ sl.label }}</button>
              }
            </div>
          </div>

          <div class="mods">
            @for (m of modules(); track m.id) {
              <button class="mod" (click)="store.go(m.id)">
                <span class="mod-ic" [style.background]="store.tint(m.color)"><f-icon [name]="m.icon" [size]="23" [color]="m.color" [width]="2.1" /></span>
                <span class="mod-b">
                  <span class="mod-l">{{ m.label }}</span>
                  <span class="mod-s">{{ m.sub }}</span>
                </span>
              </button>
            }
          </div>
        </div>
      } @else {
        <!-- ===== desktop : fil + bandeau ===== -->
        <div class="home-wrap">
          <ng-container [ngTemplateOutlet]="feedCard" />
          <div class="rail">
            <ng-container [ngTemplateOutlet]="agendaCard" />
            <ng-container [ngTemplateOutlet]="tasksCard" />
            <ng-container [ngTemplateOutlet]="mealsCard" />
            @if (fin() !== null) { <ng-container [ngTemplateOutlet]="finCard" /> }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .hello { font-size: 40px; color: var(--primary); line-height: .9; font-weight: 700; }
    .home-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 22px; }

    /* ===== aucun document chargé ===== */
    .no-doc { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; padding: 44px 24px; max-width: 460px; margin: 0 auto; }
    .nd-title { font-size: 17px; font-weight: 800; color: var(--ink); }
    .nd-msg { font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; }
    .no-doc .btn { margin-top: 6px; }

    /* ===== invitation aux rappels ===== */
    .push-invite { background: var(--soft); padding: 18px 20px; margin-bottom: 18px; }
    .pi-head { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 800; color: var(--ink); }
    .pi-text { margin: 8px 0 14px; font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; }
    .pi-actions { display: flex; gap: 10px; flex-wrap: wrap; }

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
    .rc-row.prep .prep-line { flex: 1; min-width: 0; font-size: 13px; font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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

    /* ===== mobile : carousel + grille ===== */
    .home-m { display: flex; flex-direction: column; gap: 20px; }
    .fscroll-x { -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .fscroll-x::-webkit-scrollbar { display: none; }
    .track { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; align-items: stretch; }
    .slide { flex: 0 0 100%; scroll-snap-align: center; display: flex; box-sizing: border-box; }
    .slide > .card { flex: 1; }
    .pills { display: flex; gap: 8px; margin-top: 12px; overflow-x: auto; }
    .pill { flex: none; border: none; background: var(--soft); color: var(--ink2); border-radius: 20px; padding: 7px 15px; font-size: 12px; font-weight: 800; cursor: pointer; }
    .pill.on { background: #FCE9E3; color: var(--primary); }
    :host-context(:root.dark) .pill.on { background: rgba(229,107,78,.18); }

    .mods { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .mod { display: flex; align-items: center; gap: 12px; padding: 13px 14px; border-radius: 18px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; text-align: left; min-width: 0; }
    .mod:active { background: var(--soft); }
    .mod-ic { width: 46px; height: 46px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex: none; }
    .mod-b { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .mod-l { font-size: 13.5px; font-weight: 800; color: var(--ink); line-height: 1.2; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
    .mod-s { font-size: 11px; font-weight: 700; color: var(--ink3); line-height: 1.25; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  `],
})
export class HomeScreen {
  store = inject(FoyerStore);
  admin = inject(AdminStore);
  private fins = inject(FinancesStore);

  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  private readonly pillEls = viewChildren<ElementRef<HTMLElement>>('pillBtn');
  readonly active = signal(0);
  /** Un rechargement du document est en cours (bouton « Réessayer »). */
  readonly reloading = signal(false);
  private lastTouch = 0;
  private readonly reduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();

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

    // Le carousel tourne tout seul (sauf mouvement réduit) : une section toutes
    // les 6 secondes, mise en pause tant que le doigt est posé récemment.
    const timer = setInterval(() => this.autoAdvance(), 6000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    // La pastille active reste visible : la file de pastilles déborde de l'écran,
    // et une section atteinte hors champ ne se verrait pas sans ça.
    effect(() => { this.pillEls()[this.active()]?.nativeElement.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); });
  }

  readonly hello = computed(() => { const n = this.store.me()?.name; return n ? 'Bonjour ' + n : 'Bonjour'; });

  // Sur petit écran, quatre lignes suffisent (le carousel est court) ; sur grand
  // écran le fil prend toute la colonne, il en montre douze.
  readonly activity = computed(() => { const d = this.store.data(); return d ? recentActivity(d, this.store.narrow() ? 4 : 12) : []; });

  /** Les sections du carousel mobile. */
  readonly slides = computed(() => SLIDES);

  /**
   * Les modules ouverts à ce compte, tels que la navigation les groupe. Comme
   * cette grille remplace le menu du bas sur mobile, elle porte aussi l'accès
   * aux paramètres (adultes), seul point d'entrée qui vivait dans ce menu.
   */
  /**
   * Les départs proches : une liste de préparation dans sa fenêtre de rappel
   * (J-N à J-0) où il reste des affaires à préparer. La ligne d'accueil s'efface
   * dès que tout est prêt ou le départ passé.
   */
  readonly prepAlerts = computed<{ list: TaskList; days: number; remaining: number }[]>(() => {
    const d = this.store.data();
    if (!d) return [];
    const today = parseDay(this.store.todayStr());
    const out: { list: TaskList; days: number; remaining: number }[] = [];
    for (const l of this.store.visibleTaskLists()) {
      if (l.kind !== 'preparation' || !l.departure) continue;
      const days = Math.round((parseDay(l.departure).getTime() - today.getTime()) / 86_400_000);
      if (days < 0 || days > (l.remindDaysBefore ?? 3)) continue;
      const remaining = (d.tasks || []).filter((t) => t.listId === l.id && !t.done).length;
      if (remaining > 0) out.push({ list: l, days, remaining });
    }
    return out.sort((a, b) => a.days - b.days);
  });
  prepLine(a: { list: TaskList; days: number; remaining: number }): string {
    const nom = a.list.forMember ? this.store.memberName(a.list.forMember) : a.list.name;
    const quand = a.days > 1 ? `dans ${a.days} jours` : a.days === 1 ? 'demain' : 'aujourd’hui';
    return `Départ de ${nom} ${quand} : ${a.remaining} affaire${a.remaining > 1 ? 's' : ''} à préparer`;
  }
  openPrep(id: string): void { this.store.go('taches'); this.store.patch({ activeList: id }); }

  readonly modules = computed<Mod[]>(() => {
    const d = this.store.data();
    if (!d) return [];
    const mods: Mod[] = navGroupsFor(this.store.isChild()).flatMap((g) => g.items).map((it) => ({
      id: it.id, label: it.label, icon: it.icon, color: MOD_COLOR[it.id] || '#E56B4E', sub: this.moduleSub(it.id),
    }));
    if (!this.store.isChild()) mods.push({ id: 'settings', label: 'Paramètres', icon: 'gear', color: '#8A7E74', sub: 'Réglages et compte' });
    return mods;
  });

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

  // ---- carousel ----
  onScroll(el: HTMLElement): void {
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    const c = Math.min(Math.max(i, 0), this.slides().length - 1);
    if (c !== this.active()) this.active.set(c);
  }
  onTouch(): void { this.lastTouch = Date.now(); }

  /** Relance le chargement du document ; le store repose `docError` en cas d'échec. */
  async reload(): Promise<void> {
    if (this.reloading()) return;
    this.reloading.set(true);
    try { await this.store.reloadDocument(); } finally { this.reloading.set(false); }
  }
  goSlide(i: number): void {
    this.lastTouch = Date.now();
    const el = this.track()?.nativeElement;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
    this.active.set(i);
  }
  private autoAdvance(): void {
    if (this.reduced || !this.store.narrow()) return;
    if (Date.now() - this.lastTouch < 7000) return;
    const el = this.track()?.nativeElement;
    const n = this.slides().length;
    if (!el || n < 2) return;
    el.scrollTo({ left: ((this.active() + 1) % n) * el.clientWidth, behavior: 'smooth' });
  }

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

  /** Le sous-titre d'une tuile de module : un compte réel, jamais un décor. */
  private moduleSub(id: string): string {
    const d = this.store.data();
    if (!d) return '';
    const n = (k: number, one: string, many: string, zero: string) => (k === 0 ? zero : k === 1 ? `1 ${one}` : `${k} ${many}`);
    switch (id) {
      case 'calendar': return n(this.store.eventsForDay(this.store.todayStr()).length, 'évènement aujourd’hui', 'évènements aujourd’hui', 'Rien de prévu aujourd’hui');
      case 'courses': return n(d.shop.filter((s) => s.state === 'a-prendre').length, 'article à prendre', 'articles à prendre', 'Rien à prendre');
      case 'taches': {
        const lists = new Set(this.store.visibleTaskLists().map((l) => l.id));
        return n(d.tasks.filter((t) => !t.done && lists.has(t.listId)).length, 'tâche en cours', 'tâches en cours', 'Tout est fait');
      }
      case 'repas': {
        const days = new Set(this.store.weekDays());
        let k = 0;
        for (const [key, v] of Object.entries(d.meals || {})) if (days.has(key.slice(0, 10)) && this.store.mealLabel(v)) k++;
        return k === 0 ? 'Aucun repas prévu' : n(k, 'repas prévu', 'repas prévus', '');
      }
      case 'recettes': return n(d.recipes.length, 'recette', 'recettes', 'Aucune recette');
      case 'finances': return 'Comptes et budget du mois';
      case 'planning': return n(d.sched.length, 'créneau', 'créneaux', 'Aucun créneau');
      case 'contacts': return n(d.contacts.length, 'contact', 'contacts', 'Aucun contact');
      case 'fidelite': return n(d.cards.length, 'carte', 'cartes', 'Aucune carte');
      case 'lieux': return n((d.places || []).length, 'lieu', 'lieux', 'Aucun lieu');
      default: return '';
    }
  }
}
