import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { FoyerStore } from '../../core/foyer.store';
import { Demande, Entry, Exploit, Kid, Routine, dailyEcus, doneCount, earned, hourLabel, nextStep, pendingEcus, withPending } from '../../core/epopee/epopee';
import { EpopeeStore } from '../../core/epopee/store';
import { IconComponent } from '../../core/icon';
import { sessionUuid } from '../../core/revisions/revisions';
import { AvatarComponent } from '../../shared/avatar';
import { ToggleComponent } from '../../shared/toggle';
import { ArmoryAdmin } from './armory-admin';
import { QuestPanel } from './quest-panel';
import { RoutineEditor } from './routine-editor';
import { EpopeeRunner } from './runner';

const WHEN = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Beyond this, counting coins one by one stops helping: the number alone speaks. */
const COINS_MAX = 30;

/**
 * Épopée : la besace d'écus de chaque enfant et ses routines du jour. Un adulte
 * enrôle, crédite (exploit convenu d'un geste, bravo en quelques mots), répond
 * aux exploits signalés, règle les routines (routine-editor.ts) et relit le
 * journal ; un enfant voit sa besace, déroule ses routines pas à pas (runner.ts)
 * et signale un exploit. L'Armurerie (quest-panel.ts, armory-admin.ts) porte
 * les récompenses, la quête en cours et les souvenirs. Le solde et chaque montant
 * viennent du serveur (grand livre en ajout seul), l'écran ne calcule rien.
 */
@Component({
  selector: 'screen-epopee',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent, ToggleComponent, EpopeeRunner, RoutineEditor, QuestPanel, ArmoryAdmin],
  template: `
    <div class="screen-enter">
      @if (running(); as run) { <epopee-runner [routine]="run.routine" [day]="run.day" [timer]="run.timer" (closed)="fermer()" /> }
      @if (editing(); as ed) { <epopee-routine-editor [routine]="ed.routine" [name]="ed.name" (closed)="finEdition($event)" /> }
      @if (erreur(); as e) {
        <div class="card empty"><div class="empty-title">L’Épopée ne répond pas</div><div class="empty-text">{{ e }}</div><button class="btn btn-primary" (click)="charger()">Réessayer</button></div>
      } @else if (kids(); as liste) {
        @if (!liste.length) {
          <div class="card empty">
            <div class="empty-ico"><f-icon name="bouclier" [size]="30" color="var(--ink3)" [width]="1.8" /></div>
            <div class="empty-title">Aucun enfant dans le foyer</div>
            <div class="empty-text">L’Épopée est pour les enfants. Cochez « enfant » sur la fiche d’un membre (Paramètres, Membres), il apparaîtra ici.</div>
          </div>
        }
        @for (k of liste; track k.memberId) {
          <section class="card kid">
            @if (!store.isChild()) {
              <header class="kid-head"><f-avatar [ini]="k.ini" [color]="k.color" [size]="40" /><h2>{{ k.name }}</h2></header>
            }
            @if (!k.enrolled) {
              @if (store.isChild()) {
                <div class="empty-title">Ton épopée n’a pas encore commencé</div>
                <p class="lead">Demande à tes parents de t’enrôler : ta besace t’attend, avec des écus dedans dès le départ.</p>
              } @else {
                <p class="lead">Enrôler {{ k.name }} lui ouvre une besace, avec {{ amorce }} écus d’amorce dedans : elle ne commence jamais vide, et ces écus-là ne se reprennent pas.</p>
                <button class="btn btn-primary" [disabled]="busy()" (click)="enroler(k)"><f-icon name="bouclier" [size]="18" color="#fff" [width]="2.2" /> Enrôler {{ k.name }}</button>
              }
            } @else {
              @if (!store.isChild()) {
                @for (q of attente(k); track q.id) {
                  <div class="ask">
                    <div class="what"><div class="t">{{ k.name }} signale : {{ q.title }}</div><div class="s">+{{ q.ecus }} écu{{ q.ecus > 1 ? 's' : '' }} si c’est validé</div></div>
                    <button class="btn btn-sage" [disabled]="busy()" (click)="decider(k, q, true)">Valider</button>
                    <button class="btn btn-soft" [disabled]="busy()" (click)="decider(k, q, false)">Pas tout à fait</button>
                  </div>
                }
              }
              <div class="pouch">
                @if (store.isChild() && k.display === 'pieces') { <div class="solde solo">Ma besace</div> } @else { <div class="solde"><span class="n">{{ k.balance }}</span> écu{{ k.balance! > 1 ? 's' : '' }}</div> }
                <div class="floor"><f-icon name="bouclier" [size]="14" color="#9D6B00" [width]="2.2" /> {{ k.floor }} {{ store.isChild() ? 'sont à toi pour toujours' : 'protégés' }}</div>
              </div>
              @if (k.balance! <= coinsMax) {
                <div class="coins" [class.big]="store.isChild() && k.display === 'pieces'" [attr.aria-hidden]="!(store.isChild() && k.display === 'pieces')" [attr.aria-label]="k.balance + ' écus'">@for (c of coins(k); track $index) { <span class="coin" [class.kept]="c"></span> }</div>
              }

              <epopee-quest-panel [kid]="k" [rewards]="recompenses()" [child]="store.isChild()" (changed)="charger()" />

              @if (k.routines?.length) {
                <div class="routines">
                  @for (r of k.routines; track r.id) {
                    <div class="routine" [class.done]="isDone(r)">
                      <div class="r-ico"><f-icon [name]="r.kind === 'matin' ? 'sun' : 'moon'" [size]="22" [color]="r.kind === 'matin' ? '#D99427' : '#4E5AA8'" [width]="2" /></div>
                      <div class="r-what">
                        <div class="t">{{ r.title }}</div>
                        <div class="s">{{ routineLine(r) }}</div>
                        <div class="r-dots" aria-hidden="true">@for (st of r.steps; track st.id) { <span [class.fait]="st.status === 'fait'" [class.saute]="st.status === 'saute'"></span> }</div>
                      </div>
                      @if (store.isChild() && !isDone(r)) { <button class="btn btn-primary" (click)="lancer(k, r)">{{ started(r) ? 'Continuer' : 'Commencer' }}</button> }
                      @if (!store.isChild()) { <button class="btn btn-soft" (click)="regler(k, r)">Régler</button> }
                    </div>
                  }
                </div>
              } @else if (!store.isChild()) {
                <div class="routines none">
                  <p class="lead">{{ k.name }} n’a pas encore de routine. Les routines proposées (matin et soir, cinq étapes chacune) se posent d’un geste.</p>
                  <button class="btn btn-soft" [disabled]="busy()" (click)="poserRoutines(k)">Poser les routines proposées</button>
                </div>
              }

              @if (store.isChild() && exploits().length) {
                <div class="feats">
                  <div class="field-label">J’ai réussi un exploit</div>
                  @for (x of exploits(); track x.id) {
                    @let q = demandeDe(k, x);
                    <div class="feat" [class.ok]="q?.status === 'validee'">
                      <div class="what"><div class="t">{{ x.title }}</div><div class="s">{{ featLine(x, q) }}</div></div>
                      @if (q?.status === 'attente') { <span class="wait">En attente</span> }
                      @else if (q?.status !== 'validee') { <button class="btn btn-soft" [disabled]="busy()" (click)="signaler(k, x)">C’est fait !</button> }
                    </div>
                  }
                </div>
              }
              @if (!store.isChild() && exploits().length) {
                <div class="express">
                  <div class="field-label">Créditer un exploit</div>
                  <div class="chips">@for (x of exploits(); track x.id) { <button class="chip" [disabled]="busy()" (click)="crediter(k, x)">{{ x.title }} <b>+{{ x.ecus }}</b></button> }</div>
                </div>
              }

              @if (!store.isChild()) {
                <div class="bravo">
                  <label class="field-label" [attr.for]="'bravo-' + k.memberId">Bravo spontané</label>
                  <div class="bravo-row">
                    <input class="input" [id]="'bravo-' + k.memberId" maxlength="120" placeholder="Ce que vous avez vu, en quelques mots" [value]="note()[k.memberId] || ''" (input)="setNote(k.memberId, $any($event.target).value)" (keydown.enter)="bravo(k)" />
                    <div class="ecus" role="radiogroup" aria-label="Nombre d’écus">
                      @for (n of [1, 2, 3]; track n) { <button role="radio" [attr.aria-checked]="ecusFor(k.memberId) === n" [class.on]="ecusFor(k.memberId) === n" (click)="setEcus(k.memberId, n)">+{{ n }}</button> }
                    </div>
                  </div>
                  <button class="btn btn-primary" [disabled]="busy()" (click)="bravo(k)">Donner {{ ecusFor(k.memberId) }} écu{{ ecusFor(k.memberId) > 1 ? 's' : '' }} à {{ k.name }}</button>
                </div>
              }

              @if (lines(k); as j) {
                @if (j.length) {
                  <details class="journal" [open]="store.isChild()">
                    <summary>{{ store.isChild() ? 'Ce que tu as gagné' : 'Journal' }}</summary>
                    @for (e of j; track e.id) {
                      <div class="line" [class.off]="e.cancelled || e.kind === 'annulation'">
                        <div class="what">
                          <div class="t">{{ label(e) }}</div>
                          <div class="s">{{ sub(e) }}</div>
                        </div>
                        <div class="d" [class.neg]="e.delta < 0">{{ e.delta > 0 ? '+' : '' }}{{ e.delta }}</div>
                        @if (!store.isChild() && e.kind !== 'amorce' && e.kind !== 'annulation' && e.kind !== 'echange' && !e.cancelled) { <button class="undo" [disabled]="busy()" (click)="annuler(k, e)">Annuler</button> }
                      </div>
                    }
                  </details>
                }
              }
              @if (!store.isChild()) {
                <details class="journal">
                  <summary>Réglages de {{ k.name }}</summary>
                  <div class="set"><div class="what"><div class="t">Montrer les pièces sans le nombre</div><div class="s">Pour un enfant qui ne lit pas encore les nombres : il compte ses écus du doigt.</div></div>
                    <f-toggle [on]="k.display === 'pieces'" label="Montrer les pièces sans le nombre" (toggled)="reglage(k, { display: $event ? 'pieces' : 'nombre' })" /></div>
                  <div class="set"><div class="what"><div class="t">Sablier dans les routines</div><div class="s">Un repère de durée à chaque étape. Sans lui, l’enfant avance à son rythme, sans décompte.</div></div>
                    <f-toggle [on]="!!k.timer" label="Sablier dans les routines" (toggled)="reglage(k, { timer: $event })" /></div>
                  @if (k.routines?.length) {
                    <div class="set"><div class="what"><div class="t">{{ jour(k) }} écus possibles par jour</div><div class="s">Avec les routines telles qu’elles sont réglées. À garder en tête pour le prix des récompenses.</div></div>
                      <button class="btn btn-soft" [disabled]="busy()" (click)="remettre(k)">Revenir aux routines proposées</button></div>
                  }
                  <button class="btn btn-ghost retire" [disabled]="busy()" (click)="retirer(k)">Retirer {{ k.name }} de l’Épopée</button>
                </details>
              }
            }
          </section>
        }
        @if (!store.isChild() && anyEnrolled()) {
          <section class="card kid">
            <header class="kid-head"><h2>Exploits convenus</h2></header>
            <p class="lead">Ce que vous créditez d’un geste, et ce qu’un enfant peut signaler. Peu d’exploits, bien choisis, valent mieux qu’une longue liste.</p>
            @for (x of exploits(); track x.id) {
              <div class="line">
                <div class="what"><div class="t">{{ x.title }}</div></div>
                <div class="ecus" role="radiogroup" [attr.aria-label]="'Écus de ' + x.title">@for (n of [1, 2, 3]; track n) { <button role="radio" [attr.aria-checked]="x.ecus === n" [class.on]="x.ecus === n" [disabled]="busy()" (click)="prixExploit(x, n)">+{{ n }}</button> }</div>
                <button class="undo" [disabled]="busy()" (click)="retirerExploit(x)">Retirer</button>
              </div>
            }
            <div class="bravo-row add">
              <input class="input" maxlength="60" placeholder="Un nouvel exploit, en quelques mots" aria-label="Nouvel exploit" [value]="nouveau()" (input)="nouveau.set($any($event.target).value)" (keydown.enter)="ajouterExploit()" />
              <button class="btn btn-soft" [disabled]="busy() || !nouveau().trim()" (click)="ajouterExploit()">Ajouter</button>
            </div>
          </section>
          <section class="card kid">
            <header class="kid-head"><h2>L’Armurerie</h2></header>
            <epopee-armory-admin [rewards]="recompenses()" [perDay]="jourMax()" (changed)="charger()" />
          </section>
        }
      }
    </div>
  `,
  styles: [`
    .kid { margin-bottom: 18px; max-width: 720px; }
    .kid-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .kid-head h2 { margin: 0; font-family: var(--font-display); font-size: 20px; font-weight: 800; color: var(--ink); }
    .lead { font-size: 14.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin: 0 0 16px; max-width: 520px; }
    .pouch { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px 16px; }
    .solde { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--ink2); }
    .solde .n { font-size: 44px; font-weight: 800; color: var(--ink); line-height: 1; }
    .floor { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px; border-radius: 999px; background: #FDF0DA; color: #7D5400; font-size: 12.5px; font-weight: 800; }
    .coins { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
    .coin { width: 22px; height: 22px; border-radius: 50%; background: #F0B24B; box-shadow: 0 2px 0 #D99427; }
    .coin.kept { outline: 2px solid #9D6B00; outline-offset: 1px; }
    .ask { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 14px; margin-bottom: 14px; border-radius: 18px; background: #FDF0DA; }
    .ask .btn, .feat .btn, .set .btn { min-height: 46px; flex: none; }
    .solde.solo { font-size: 22px; font-weight: 800; color: var(--ink); }
    .coins.big { gap: 10px; }
    .coins.big .coin { width: 38px; height: 38px; box-shadow: 0 3px 0 #D99427; }
    .feats, .express { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line2); }
    .feat, .set { display: flex; align-items: center; gap: 12px; padding: 10px 0; }
    .feat + .feat, .set + .set { border-top: 1px solid var(--line2); }
    .feat.ok .t { color: #476645; }
    .wait { font-size: 12.5px; font-weight: 800; color: #7D5400; background: #FDF0DA; padding: 6px 11px; border-radius: 999px; flex: none; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { min-height: 46px; padding: 0 14px; border-radius: 14px; border: 2px solid var(--line); background: var(--surface); color: var(--ink); font: 700 14px var(--font-body); cursor: pointer; }
    .chip b { margin-left: 6px; color: #7D5400; }
    .chip:disabled { opacity: .5; cursor: default; }
    .bravo-row.add { margin: 14px 0 0; }
    .routines { margin-top: 20px; display: grid; gap: 10px; }
    .routines.none { padding-top: 18px; border-top: 1px solid var(--line2); }
    .routine { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 18px; background: var(--soft2); }
    .routine.done { background: #EDF2EB; }
    .r-ico { width: 44px; height: 44px; border-radius: 13px; background: var(--surface); display: flex; align-items: center; justify-content: center; flex: none; }
    .r-what { flex: 1; min-width: 0; }
    .r-dots { display: flex; gap: 5px; margin-top: 7px; }
    .r-dots span { width: 11px; height: 11px; border-radius: 50%; background: var(--line); }
    .r-dots span.fait { background: #F0B24B; }
    .r-dots span.saute { background: none; border: 2px solid var(--line); }
    .routine .btn { min-height: 48px; flex: none; }
    .bravo { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line2); }
    .bravo-row { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
    .bravo-row .input { flex: 1 1 220px; width: auto; }
    .ecus { display: flex; gap: 6px; }
    .ecus button { min-width: 48px; height: 48px; border-radius: var(--r-input); border: 2px solid var(--line); background: var(--surface); color: var(--ink2); font: 800 15px var(--font-body); cursor: pointer; }
    .ecus button.on { border-color: #D99427; background: #FDF0DA; color: #7D5400; }
    .journal { margin-top: 20px; }
    .journal summary { cursor: pointer; font-size: 13px; font-weight: 800; color: var(--ink3); padding: 8px 0; }
    .line { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line2); }
    .what { flex: 1; min-width: 0; }
    .t { font-size: 14.5px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .s { font-size: 12.5px; font-weight: 600; color: var(--ink3); }
    .d { font-family: var(--font-display); font-size: 18px; font-weight: 800; color: #7D5400; }
    .d.neg { color: var(--ink2); }
    .line.off .t, .line.off .d { color: var(--ink3); }
    .line.off .t { text-decoration: line-through; }
    .undo { border: none; background: none; cursor: pointer; min-height: 44px; padding: 0 8px; font: 800 13px var(--font-body); color: var(--ink2); text-decoration: underline; text-underline-offset: 3px; }
    .retire { margin-top: 14px; padding-left: 0; font-size: 13px; }
    .card.empty { padding: 44px 24px; text-align: center; max-width: 720px; }
    .empty-ico { display: flex; justify-content: center; margin-bottom: 12px; }
    .empty-title { font-family: var(--font-display); font-size: 19px; font-weight: 800; color: var(--ink); margin-bottom: 6px; }
    .empty-text { font-size: 14px; font-weight: 600; color: var(--ink2); max-width: 420px; margin: 0 auto 18px; line-height: 1.5; }
  `],
})
export class EpopeeScreen {
  private readonly api = inject(ApiService);
  readonly store = inject(FoyerStore);
  private readonly epopee = inject(EpopeeStore);

  /** The amorce a child receives on enrolment; the server decides, this is only the sentence that announces it. */
  readonly amorce = 5;
  readonly coinsMax = COINS_MAX;
  readonly erreur = this.epopee.erreur;
  readonly busy = signal(false);
  readonly note = signal<Record<string, string>>({});
  private readonly ecus = signal<Record<string, number>>({});
  /** The routine being run, full screen: by its ids, so it follows what the store learns. */
  private readonly run = signal<{ memberId: string; routineId: string } | null>(null);
  private readonly edit = signal<{ memberId: string; routineId: string } | null>(null);
  readonly exploits = this.epopee.exploits;
  readonly recompenses = this.epopee.recompenses;
  /** The most écus an enrolled child can earn in a day: what the armoury weighs its prices against. */
  readonly jourMax = computed(() => Math.max(0, ...(this.kids() || []).filter((k) => k.enrolled).map((k) => dailyEcus(k.routines || []))));
  readonly nouveau = signal('');

  /**
   * The pouches joined to the members of the document (name, colour), in the
   * household's order, with what this device marked and has not sent yet.
   */
  readonly kids = computed<Kid[] | null>(() => {
    const b = this.epopee.besaces(); if (!b) return null;
    const pending = this.epopee.pending();
    return (this.store.d()?.members || []).flatMap((m) => {
      const x = b.find((y) => y.memberId === m.id); if (!x) return [];
      const day = x.day ?? '', routines = x.routines || [];
      return [{ ...x, name: m.name, ini: m.ini, color: m.color, routines: withPending(routines, pending, day), balance: x.balance === null ? null : x.balance + pendingEcus(routines, pending, day) }];
    });
  });
  readonly running = computed(() => {
    const r = this.run(); if (!r) return null;
    const k = this.kids()?.find((x) => x.memberId === r.memberId), routine = k?.routines?.find((x) => x.id === r.routineId);
    return k && routine ? { routine, day: k.day ?? '', timer: k.timer !== false } : null;
  });
  readonly editing = computed(() => {
    const e = this.edit(); if (!e) return null;
    const k = this.kids()?.find((x) => x.memberId === e.memberId), routine = k?.routines?.find((x) => x.id === e.routineId);
    return k && routine ? { routine, name: k.name } : null;
  });
  readonly anyEnrolled = computed(() => !!this.kids()?.some((k) => k.enrolled));

  constructor() { void this.charger(); }

  charger(): Promise<void> { return this.epopee.charger(); }

  isDone(r: Routine): boolean { return nextStep(r) < 0; }
  started(r: Routine): boolean { return doneCount(r) > 0; }
  routineLine(r: Routine): string {
    const n = doneCount(r), g = earned(r), pauses = !this.store.isChild() && r.pauses ? `, ${r.pauses} pause${r.pauses > 1 ? 's' : ''}` : '';
    if (this.isDone(r)) return `Fait${g ? `, +${g} écu${g > 1 ? 's' : ''}` : ''}${pauses}`;
    return n ? `${n} étape${n > 1 ? 's' : ''} sur ${r.steps.length}${pauses}` : `${hourLabel(r.time)}, ${r.steps.length} étapes${pauses}`;
  }
  regler(k: Kid, r: Routine): void { this.edit.set({ memberId: k.memberId, routineId: r.id }); }
  finEdition(saved: boolean): void { this.edit.set(null); if (saved) void this.charger(); }
  jour(k: Kid): number { return dailyEcus(k.routines || []); }
  attente(k: Kid): Demande[] { return (k.demandes || []).filter((q) => q.status === 'attente'); }
  /** The child's latest report of this feat today, if any. */
  demandeDe(k: Kid, x: Exploit): Demande | undefined { return (k.demandes || []).find((q) => q.exploitId === x.id); }
  featLine(x: Exploit, q: Demande | undefined): string {
    const ecus = `+${x.ecus} écu${x.ecus > 1 ? 's' : ''}`;
    if (q?.status === 'attente') return `${ecus}, quand papa ou maman aura vu`;
    if (q?.status === 'validee') return `Validé${q.decidedBy ? ' par ' + q.decidedBy : ''}, ${ecus}`;
    if (q?.status === 'refusee') return 'Pas tout à fait cette fois. Tu peux réessayer.';
    return ecus;
  }
  lancer(k: Kid, r: Routine): void { this.run.set({ memberId: k.memberId, routineId: r.id }); }
  fermer(): void { this.run.set(null); void this.charger(); }

  /** One flag per coin: true for those of the protected floor. */
  coins(k: Kid): boolean[] { return Array.from({ length: Math.max(0, k.balance ?? 0) }, (_, i) => i < (k.floor ?? 0)); }
  /** A child reads what they earned: what was cancelled, and its cancellation, stay out of their sight. */
  lines(k: Kid): Entry[] { return (k.journal || []).filter((e) => !this.store.isChild() || (!e.cancelled && e.kind !== 'annulation')); }
  label(e: Entry): string { return e.kind === 'amorce' ? 'Écus d’amorce' : e.kind === 'annulation' ? 'Annulation' : e.kind === 'echange' ? `Trésor : ${e.note || 'échange'}` : e.note || (e.kind === 'etape' ? 'Étape de routine' : e.kind === 'exploit' ? 'Exploit' : 'Bravo'); }
  sub(e: Entry): string { return [WHEN.format(new Date(e.at)), e.by, e.cancelled ? 'annulé' : ''].filter(Boolean).join(', '); }
  ecusFor(id: string): number { return this.ecus()[id] || 1; }
  setEcus(id: string, n: number): void { this.ecus.update((x) => ({ ...x, [id]: n })); }
  setNote(id: string, v: string): void { this.note.update((x) => ({ ...x, [id]: v })); }

  private async agir(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await fn(); await this.charger(); } catch (e) { this.store.toast((e as Error).message); } finally { this.busy.set(false); }
  }

  enroler(k: Kid): Promise<void> {
    return this.agir(async () => { await this.api.post(`epopee/membres/${k.memberId}/enrolement`); this.store.toast(`${k.name} entre dans l’Épopée.`); });
  }
  /** The toast that follows a credit: five seconds to take it back, no confirmation before. */
  private credited(k: Kid, id: string, n: number): void {
    this.store.toastWithUndo(`+${n} écu${n > 1 ? 's' : ''} pour ${k.name}.`, () => void this.agir(async () => { await this.api.post(`epopee/journal/${encodeURIComponent(id)}/annulation`); }));
  }
  bravo(k: Kid): Promise<void> {
    return this.agir(async () => {
      const n = this.ecusFor(k.memberId), id = sessionUuid();
      await this.api.post(`epopee/membres/${k.memberId}/bravos`, { id, ecus: n, note: (this.note()[k.memberId] || '').trim() || null });
      this.setNote(k.memberId, ''); this.setEcus(k.memberId, 1);
      this.credited(k, id, n);
    });
  }
  /** Crédit express : one tap credits, the toast offers to undo. */
  crediter(k: Kid, x: Exploit): Promise<void> {
    return this.agir(async () => { const id = sessionUuid(); await this.api.post(`epopee/membres/${k.memberId}/exploits`, { id, exploitId: x.id }); this.credited(k, id, x.ecus); });
  }
  decider(k: Kid, q: Demande, accept: boolean): Promise<void> {
    return this.agir(async () => {
      await this.api.post(`epopee/demandes/${q.id}/decision`, { accept });
      this.store.toast(accept ? `+${q.ecus} écu${q.ecus > 1 ? 's' : ''} pour ${k.name}.` : `Réponse donnée à ${k.name} : pas tout à fait.`);
    });
  }
  signaler(k: Kid, x: Exploit): Promise<void> {
    return this.agir(async () => { await this.api.post(`epopee/membres/${k.memberId}/demandes`, { id: sessionUuid(), exploitId: x.id }); this.store.toast('C’est noté. Papa ou maman va regarder.'); });
  }
  reglage(k: Kid, patch: { display?: 'nombre' | 'pieces'; timer?: boolean }): Promise<void> {
    return this.agir(async () => { await this.api.request(`epopee/membres/${k.memberId}/reglages`, { method: 'PATCH', body: JSON.stringify(patch) }); });
  }
  remettre(k: Kid): Promise<void> {
    if (!confirm(`Revenir aux routines proposées pour ${k.name} ? Ses routines actuelles seront remplacées ; ce qu’il a déjà gagné reste.`)) return Promise.resolve();
    return this.agir(async () => { await this.api.post(`epopee/membres/${k.memberId}/routines/gabarit`, { replace: true }); });
  }
  ajouterExploit(): Promise<void> {
    const title = this.nouveau().trim(); if (!title) return Promise.resolve();
    return this.agir(async () => { await this.api.post('epopee/exploits', { title, ecus: 1 }); this.nouveau.set(''); });
  }
  prixExploit(x: Exploit, ecus: number): Promise<void> {
    if (x.ecus === ecus) return Promise.resolve();
    return this.agir(async () => { await this.api.put(`epopee/exploits/${x.id}`, { title: x.title, ecus }); });
  }
  retirerExploit(x: Exploit): Promise<void> {
    if (!confirm(`Retirer « ${x.title} » des exploits convenus ? Les écus déjà gagnés avec restent.`)) return Promise.resolve();
    return this.agir(async () => { await this.api.del(`epopee/exploits/${x.id}`); });
  }
  annuler(k: Kid, e: Entry): Promise<void> {
    if (!confirm(`Reprendre ${e.delta > 1 ? `ces ${e.delta} écus` : 'cet écu'} à ${k.name} ?`)) return Promise.resolve();
    return this.agir(async () => { await this.api.post(`epopee/journal/${encodeURIComponent(e.id)}/annulation`); });
  }
  poserRoutines(k: Kid): Promise<void> {
    return this.agir(async () => { await this.api.post(`epopee/membres/${k.memberId}/routines/gabarit`); });
  }
  retirer(k: Kid): Promise<void> {
    if (!confirm(`Retirer ${k.name} de l’Épopée ? Sa besace et son journal sont conservés, et reviennent si vous l’enrôlez à nouveau.`)) return Promise.resolve();
    return this.agir(async () => { await this.api.del(`epopee/membres/${k.memberId}/enrolement`); });
  }
}
