import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { TaskItem } from '../../core/models';
import { GROUP_ORDER, GesteGroup, freqLabel, gesteGroup, groupLabel, lastDoneLabel, nextLabel, stockLabel, stockLeftLabel, stockLow } from '../../core/entretien';
import { occurrenceProgress } from '../../core/recurrence';
import { whenLabel } from '../../core/tasks';
import { fmtShortDay } from '../../core/helpers';
import { RingCheckComponent } from '../../shared/ring-check';
import { lastDoneDay } from '../../core/task-ops';
import { GesteForm } from './geste-form';
import { EquipementsStore } from '../../core/equipements.store';
import { CarnetPeriod, EntretienApi } from '../../core/entretien.api';
import { FinancesStore, fmtEurosInt } from '../../core/finances.store';

/** Une section de l'écran : un groupe de dates, ou une pièce. */
interface Section { key: string; title: string; gestes: TaskItem[]; late?: boolean; }

/**
 * L'écran Entretien : les gestes qui reviennent dans la maison, chacun avec ce
 * qu'il faut faire, quand c'était fait et par qui, quand ça revient, et un
 * seul bouton, « Fait aujourd'hui ». Ce sont des tâches de la liste Entretien
 * (voir docs/entretien.md) : cocher ici ou dans Tâches est le même geste.
 */
@Component({
  selector: 'screen-entretien',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, FormsModule, IconComponent, ModalComponent, RingCheckComponent, GesteForm],
  template: `
    <div class="screen-enter">
      <div class="head-row">
        <p class="intro">Les gestes d'entretien qui reviennent. Quand c'est fait, un tap : la prochaine date part d'aujourd'hui.</p>
        <div class="head-act">
          @if (!store.isChild() && store.gestes().length) {
            <button class="btn btn-soft" (click)="carnet.set(true)"><f-icon name="documents" [size]="16" color="currentColor" [width]="2.2" /> Carnet</button>
          }
          <button class="btn btn-primary new-btn" (click)="ouvrirForm(null)">
            <f-icon name="plus" [size]="17" color="#fff" [width]="2.6" /> Nouveau geste
          </button>
        </div>
      </div>
      @if (couts(); as c) {
        <p class="couts">Environ <b>{{ eur(c.forecast) }} € par an</b> prévus, {{ eur(c.real12) }} € dépensés sur 12 mois.
          @if (store.modFinances()) { <button type="button" class="lien" (click)="voirFinances()">Le détail dans Finances</button> }
        </p>
      }

      @if (actifs().length) {
        <div class="seg tri" role="group" aria-label="Ranger les gestes">
          <button type="button" [class.active]="tri() === 'date'" (click)="tri.set('date')">Par date</button>
          <button type="button" [class.active]="tri() === 'piece'" (click)="tri.set('piece')">Par pièce</button>
          @if (store.modEquipements()) { <button type="button" [class.active]="tri() === 'equipement'" (click)="tri.set('equipement')">Par équipement</button> }
        </div>
        @if (tri() === 'piece' && !store.isChild()) { <button type="button" class="lien rooms-link" (click)="store.openRooms()">Gérer les pièces</button> }
      }

      @for (s of sections(); track s.key) {
        <section class="reg-sec">
          <div class="reg-head" [class.late]="s.late"><h3 class="reg-title">{{ s.title }}</h3><span class="reg-n">{{ s.gestes.length }}</span></div>
          <div class="reg-box">
            @for (t of s.gestes; track t.id) {
              <ng-container [ngTemplateOutlet]="ligne" [ngTemplateOutletContext]="{ $implicit: t }" />
            }
          </div>
        </section>
      }

      @if (archives().length) {
        <section class="reg-sec">
          <div class="reg-head">
            <button class="reg-fold quiet" (click)="voirArchives.set(!voirArchives())" [attr.aria-expanded]="voirArchives()">
              <f-icon [name]="voirArchives() ? 'chevronDown' : 'chevronRight'" [size]="15" color="var(--ink2)" [width]="2.4" />
              <span class="reg-title">{{ groupLabel('archive') }}</span><span class="reg-n">{{ archives().length }}</span>
            </button>
          </div>
          @if (voirArchives()) {
            <div class="reg-box">
              @for (t of archives(); track t.id) { <ng-container [ngTemplateOutlet]="ligne" [ngTemplateOutletContext]="{ $implicit: t }" /> }
            </div>
          }
        </section>
      }

      @if (!store.gestes().length) {
        <div class="empty">
          <f-icon name="outils" [size]="30" color="var(--ink3)" [width]="1.8" />
          <p>Aucun geste noté pour l'instant. La cartouche de la carafe, le test des détecteurs de fumée, l'entretien de la chaudière : choisissez dans le catalogue, tout est prérempli.</p>
          <button class="btn btn-primary" (click)="ouvrirForm(null)"><f-icon name="plus" [size]="17" color="#fff" [width]="2.6" /> Choisir un premier geste</button>
        </div>
      }
    </div>

    <ng-template #ligne let-t>
      @let late = isLate(t);
      @let w = whenOf(t);
      <div class="reg-row top geste" [class.arch]="t.done" (click)="store.openItem('task', t.id)">
        <!-- La case est le geste : « Fait aujourd'hui ». L'anneau se remplit d'une fois à l'autre. -->
        <f-ring-check [color]="late ? 'var(--status-crit)' : 'var(--sage)'" [progress]="ringOf(t)" [late]="late"
                      [disabled]="t.done || doneToday(t)" [label]="t.text" (toggle)="store.toggleTask(t.id)" />
        <div class="reg-main">
          <div class="reg-text">{{ t.text }}</div>
          @if (t.maintenance?.howto; as h) { <div class="g-howto" [title]="h">{{ h }}</div> }
          <div class="reg-meta">
            <!-- Sur téléphone, la date quitte sa colonne et passe en tête. -->
            @if (w && store.narrow()) { <span [class.late]="late">{{ w.day }}{{ w.rel ? ' · ' + w.rel : '' }}</span> }
            @if (store.roomName(t.maintenance?.roomId); as r) { <span><f-icon name="home" [size]="12" color="var(--ink2)" [width]="2.4" /> {{ r }}</span> }
            @if (t.rec) { <span><f-icon name="refresh" [size]="12" color="var(--ink2)" [width]="2.4" /> {{ freq(t) }}</span> }
            @if (nextNote(t); as n) { <span>{{ n }}</span> }
            @if (coutAn(t); as c) { <span>{{ c }}</span> }
            @if (eqpName(t); as e) {
              <button class="reg-link" (click)="$event.stopPropagation(); store.openItem('equipment', '' + t.maintenance?.equipmentId)">{{ e }} ›</button>
            }
          </div>
          <div class="reg-meta dim"><span [class.never]="!t.history?.length">{{ last(t) || 'Pas encore noté' }}</span></div>
          @if (t.maintenance?.stock; as st) {
            <!-- Le stock : racheter se note ici ; sous le seuil, l'article part aux courses d'un tap. -->
            <div class="g-stock" [class.low]="low(st)">
              <span [title]="stock(st)">{{ stockLeft(st) }}</span>
              <button class="reg-mini" (click)="$event.stopPropagation(); ouvrirStock(t.id)">J'en ai racheté</button>
              @if (low(st) && !t.done) {
                @if (store.onShoppingList(st.article)) { <span class="ok"><f-icon name="check" [size]="12" color="currentColor" [width]="3" /> Dans les courses</span> }
                @else { <button class="reg-mini warn" (click)="$event.stopPropagation(); store.gesteToShopping(t.id)">Ajouter aux courses</button> }
              }
            </div>
          }
        </div>
        @if (w && !store.narrow()) {
          <div class="reg-when" [class.late]="late">{{ w.day }}@if (w.rel) { <small>{{ w.rel }}</small> }</div>
        }
        <div class="g-act">
          @if (t.done) {
            <button class="fait" (click)="$event.stopPropagation(); store.archiveGeste(t.id, false)">Réactiver</button>
          } @else if (doneToday(t)) {
            <span class="ok"><f-icon name="check" [size]="13" color="currentColor" [width]="3" /> Fait aujourd'hui</span>
            <!-- Le papier du technicien, une remarque : la note de la réalisation, dans la fiche. -->
            <button class="reg-mini" (click)="$event.stopPropagation(); store.openItem('task', t.id, { note: true })">{{ store.isChild() ? 'Ajouter une note' : 'Note ou justificatif' }}</button>
          } @else {
            <button class="fait" (click)="$event.stopPropagation(); store.toggleTask(t.id)"><f-icon name="check" [size]="13" color="currentColor" [width]="3" /> Fait</button>
          }
          <button class="more" (click)="$event.stopPropagation(); ouvrirMenu(t.id)" [attr.aria-label]="'Autres actions pour ' + t.text">
            <f-icon name="more" [size]="18" color="var(--ink2)" [width]="3.2" />
          </button>
        </div>
      </div>
    </ng-template>

    @if (menuGeste(); as t) {
      <f-modal [title]="t.text" [maxWidth]="440" (close)="fermerMenu()">
        @switch (menuMode()) {
          @case ('jour') {
            <label class="lab">Fait le<input class="input" type="date" [max]="store.todayStr()" [ngModel]="jour()" (ngModelChange)="jour.set($event)" /></label>
            <label class="lab">Par
              <select class="input" [ngModel]="par()" (ngModelChange)="par.set($event)">
                <option value="">Le foyer (personne en particulier)</option>
                @for (m of store.d().members; track m.id) { <option [value]="m.id">{{ m.name }}</option> }
              </select>
            </label>
            <div class="f-act"><button class="btn btn-soft" (click)="menuMode.set('')">Retour</button>
              <button class="btn btn-primary" [disabled]="!jour()" (click)="noterJour(t)">Noter</button></div>
          }
          @case ('stock') {
            <div class="seg wrap">
              <button type="button" [class.active]="stockMode() === 'ajout'" (click)="stockMode.set('ajout')">J'en ai racheté</button>
              <button type="button" [class.active]="stockMode() === 'compte'" (click)="stockMode.set('compte')">J'ai compté</button>
            </div>
            <label class="lab sp">{{ stockMode() === 'ajout' ? 'Combien en plus' : 'Combien il en reste' }}
              <input class="input" type="number" min="0" inputmode="numeric" [ngModel]="qte()" (ngModelChange)="qte.set(+$event || 0)" /></label>
            <label class="lab">Le<input class="input" type="date" [max]="store.todayStr()" [ngModel]="jour()" (ngModelChange)="jour.set($event)" /></label>
            <div class="f-act"><button class="btn btn-soft" (click)="fermerMenu()">Annuler</button>
              <button class="btn btn-primary" [disabled]="!jour() || (stockMode() === 'ajout' && qte() < 1)" (click)="store.restockGeste(t.id, qte(), stockMode(), jour()); fermerMenu()">Enregistrer</button></div>
          }
          @case ('pause') {
            <p class="q">Le geste disparaît des échéances jusqu'à cette date, puis revient tout seul, rappel compris.</p>
            <label class="lab">En pause jusqu'au<input class="input" type="date" [min]="store.todayStr()" [ngModel]="jour()" (ngModelChange)="jour.set($event)" /></label>
            <div class="f-act"><button class="btn btn-soft" (click)="menuMode.set('')">Retour</button>
              <button class="btn btn-primary" [disabled]="!jour() || jour() <= store.todayStr()" (click)="store.pauseGeste(t.id, jour()); fermerMenu()">Mettre en pause</button></div>
          }
          @default {
            <div class="acts">
              @if (!t.done) {
                <button class="act" (click)="menuMode.set('jour'); jour.set(store.todayStr()); par.set(store.me()?.id || '')"><f-icon name="calendar" [size]="17" color="var(--ink2)" [width]="2.2" /> Fait un autre jour</button>
              }
              <button class="act" (click)="fermerMenu(); ouvrirForm(t.id)"><f-icon name="edit" [size]="17" color="var(--ink2)" [width]="2.2" /> Modifier</button>
              @if (!t.done) {
                @if (paused(t)) {
                  <button class="act" (click)="store.pauseGeste(t.id, null); fermerMenu()"><f-icon name="refresh" [size]="17" color="var(--ink2)" [width]="2.2" /> Reprendre maintenant</button>
                } @else {
                  <button class="act" (click)="menuMode.set('pause'); jour.set('')"><f-icon name="clock" [size]="17" color="var(--ink2)" [width]="2.2" /> Mettre en pause</button>
                }
                <button class="act" (click)="store.archiveGeste(t.id, true); fermerMenu()"><f-icon name="folder" [size]="17" color="var(--ink2)" [width]="2.2" /> Archiver</button>
              }
              <button class="act" (click)="fermerMenu(); store.openItem('task', t.id)"><f-icon name="eye" [size]="17" color="var(--ink2)" [width]="2.2" /> Fiche et historique</button>
            </div>
          }
        }
      </f-modal>
    }

    @if (form(); as f) { <app-geste-form [id]="f.id" (close)="form.set(null)" /> }

    @if (carnet()) {
      <f-modal title="Carnet d'entretien" [maxWidth]="440" (close)="carnet.set(false)">
        <p class="q">Chaque geste, pièce par pièce, avec ses réalisations : la date, qui l'a fait, le coût, la note et les justificatifs. Pour la vente du logement, le bailleur ou l'assureur.</p>
        <div class="seg wrap" role="group" aria-label="Période">
          <button type="button" [class.active]="periode() === '12'" (click)="periode.set('12')">12 derniers mois</button>
          <button type="button" [class.active]="periode() === '24'" (click)="periode.set('24')">2 ans</button>
          <button type="button" [class.active]="periode() === 'tout'" (click)="periode.set('tout')">Tout</button>
        </div>
        <div class="acts sp">
          <button class="act" [disabled]="exporting()" (click)="exporter('pdf')"><f-icon name="documents" [size]="17" color="var(--ink2)" [width]="2.2" /> Le carnet en PDF</button>
          <button class="act" [disabled]="exporting()" (click)="exporter('zip')"><f-icon name="folder" [size]="17" color="var(--ink2)" [width]="2.2" /> Le carnet et les justificatifs (zip)</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .head-row { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 14px; }
    .head-act { flex: none; display: flex; gap: 8px; }
    .head-act .btn { display: inline-flex; align-items: center; gap: 7px; }
    .acts.sp { margin-top: 14px; }
    .intro { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin: 2px 0; }
    .couts { font-size: 13px; font-weight: 700; color: var(--ink2); background: var(--soft); border-radius: 12px; padding: 10px 13px; margin: 0 0 12px; line-height: 1.5; }
    .couts b { color: var(--ink); }
    .lien { border: none; background: none; padding: 0; font: inherit; font-weight: 800; color: var(--primary); cursor: pointer; text-decoration: underline; }
    .rooms-link { display: block; margin: -4px 0 14px; font-size: 13px; }
    .new-btn { flex: none; display: inline-flex; align-items: center; gap: 7px; }
    .tri { margin-bottom: 6px; }
    /* Une ligne de geste : la case, le texte et ses méta, la date, puis « Fait » et « ⋯ ». */
    .geste.arch .reg-text { color: var(--ink2); }
    .g-howto { font-size: 13px; font-weight: 600; color: var(--ink2); margin: 2px 0 3px; max-width: 56ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .never { font-style: italic; }
    .g-stock { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; font-size: 12.5px; font-weight: 800; color: var(--ink2); }
    .g-stock.low { color: var(--status-crit); }
    .ok { display: inline-flex; align-items: center; gap: 4px; padding: 6px 4px; font-size: 12.5px; font-weight: 800; color: var(--status-good); white-space: nowrap; }
    .g-stock .ok { padding: 0; }
    .lab.sp { margin-top: 14px; }
    .g-act { display: flex; align-items: center; gap: 4px; flex: none; }
    .fait { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line2); border-radius: 9px; background: var(--surface); padding: 6px 11px; min-height: 32px;
            font: inherit; font-size: 12.5px; font-weight: 800; color: var(--ink); cursor: pointer; white-space: nowrap; }
    .fait:hover { border-color: var(--sage); color: var(--sage); }
    .more { flex: none; width: 32px; height: 32px; border: none; border-radius: 8px; background: none; display: grid; place-items: center; cursor: pointer; }
    .more:hover { background: var(--soft2); }
    /* Téléphone : « ⋯ » au-dessus, « Fait » dessous, calés à droite. */
    @media (max-width: 860px) { .g-act { flex-direction: column-reverse; align-items: flex-end; } }

    .empty { text-align: center; color: var(--ink2); padding: 40px 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .empty p { font-size: 14px; font-weight: 600; line-height: 1.5; max-width: 440px; margin: 0; }

    .acts { display: flex; flex-direction: column; gap: 6px; }
    .act { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: var(--soft); border-radius: 12px; padding: 13px 14px; font: inherit; font-size: 14px; font-weight: 800; color: var(--ink); cursor: pointer; text-align: left; }
    .lab { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 800; color: var(--ink2); margin-bottom: 14px; }
    .q { font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin: 0 0 14px; }
    .f-act { display: flex; gap: 8px; margin-top: 8px; }
    .f-act .btn { flex: 1; }

    @media (min-width: 861px) { :host { display: block; max-width: 760px; } }
    /* Téléphone : deux boutons ne laissent plus de place à l'introduction, ils passent dessous. */
    @media (max-width: 560px) { .head-row { flex-wrap: wrap; } .intro { flex: 1 1 100%; } }
  `],
})
export class EntretienScreen {
  readonly store = inject(FoyerStore);
  private readonly eqp = inject(EquipementsStore);
  readonly tri = signal<'date' | 'piece' | 'equipement'>('date');
  readonly voirArchives = signal(false);
  readonly form = signal<{ id: string | null } | null>(null);
  readonly menuId = signal<string | null>(null);
  readonly menuMode = signal<'' | 'jour' | 'pause' | 'stock'>('');
  readonly stockMode = signal<'ajout' | 'compte'>('ajout');
  readonly qte = signal(1);
  readonly jour = signal('');
  readonly par = signal('');
  readonly groupLabel = (g: GesteGroup) => groupLabel(g, this.horizon());

  readonly horizon = computed(() => this.store.setting('entretienHorizonJours'));
  /** Gestes en cours, par date : l'échéance la plus proche d'abord, les jamais notés par nom. */
  readonly actifs = computed(() => this.store.gestes().filter((t) => !t.done)
    .sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : a.text.localeCompare(b.text, 'fr')));
  readonly archives = computed(() => this.store.gestes().filter((t) => t.done).sort((a, b) => a.text.localeCompare(b.text, 'fr')));
  readonly sections = computed<Section[]>(() => {
    const today = this.store.todayStr(); const h = this.horizon();
    if (this.tri() === 'date') {
      return GROUP_ORDER.filter((g) => g !== 'archive')
        .map((g) => ({ key: g, title: groupLabel(g, h), gestes: this.actifs().filter((t) => gesteGroup(t, today, h) === g), late: g === 'retard' }))
        .filter((s) => s.gestes.length);
    }
    if (this.tri() === 'equipement') {
      const by = new Map<string, TaskItem[]>();
      for (const t of this.actifs()) { const k = this.eqpName(t) || 'Sans équipement'; by.set(k, [...(by.get(k) || []), t]); }
      return [...by.entries()].sort(([a], [b]) => (a === 'Sans équipement' ? 1 : b === 'Sans équipement' ? -1 : a.localeCompare(b, 'fr')))
        .map(([k, g]) => ({ key: 'e-' + k, title: k, gestes: g }));
    }
    const rooms = this.store.rooms();
    const known = new Set(rooms.map((r) => r.id));
    const out: Section[] = rooms.map((r) => ({ key: r.id, title: r.name, gestes: this.actifs().filter((t) => t.maintenance?.roomId === r.id) }));
    out.push({ key: '-', title: 'Sans pièce', gestes: this.actifs().filter((t) => !t.maintenance?.roomId || !known.has(t.maintenance.roomId)) });
    return out.filter((s) => s.gestes.length);
  });
  readonly menuGeste = computed(() => { const id = this.menuId(); return id ? this.store.task(id) ?? null : null; });

  private readonly api = inject(EntretienApi);
  private readonly fin = inject(FinancesStore);
  readonly eur = fmtEurosInt;
  constructor() { if (!this.store.isChild()) void this.api.chargerCouts(); }
  /** Le bilan des coûts, pour les adultes, dès qu'un geste est chiffré. */
  readonly couts = computed(() => { const s = this.api.couts(); return !this.store.isChild() && s?.gestes.length ? s.totals : null; });
  /** « ≈ 195 €/an », ou « sous contrat » : adultes seulement (le serveur ne sert pas les montants aux enfants). */
  coutAn(t: TaskItem): string {
    const c = this.store.isChild() || t.done ? undefined : this.api.cout(t.id);
    return !c ? '' : c.contractId !== null ? 'sous contrat' : c.forecast ? `≈ ${fmtEurosInt(c.forecast)} €/an` : '';
  }
  voirFinances(): void { this.fin.goTab('contrats'); this.fin.patch({ contratsTab: 'entretien' }); this.store.go('finances'); }

  /** « 19 sept. », « 2 nov. 2025 » : les dates courtes des lignes. */
  private fmt = (d: string): string => fmtShortDay(d, this.store.todayStr());
  /** « Chaque mois », « Toutes les 2 semaines, à date fixe ». */
  freq(t: TaskItem): string { const f = t.rec ? freqLabel(t.rec) : ''; return f.charAt(0).toUpperCase() + f.slice(1); }
  last(t: TaskItem): string { return lastDoneLabel(t, this.fmt, (id) => this.store.memberName(id)); }
  /** La colonne date : la prochaine échéance, et son relatif. Rien pour un geste jamais noté ou archivé. */
  whenOf(t: TaskItem): { day: string; rel: string } | null { return t.due && !t.done ? whenLabel(t.due, this.store.todayStr(), t.rec?.grace) : null; }
  /** Ce que la date seule ne dit pas : la pause, la reprise de saison, la fenêtre d'un geste souple. */
  nextNote(t: TaskItem): string { const n = nextLabel(t, this.store.todayStr(), this.fmt); return n.startsWith('Le ') ? '' : n; }
  /** L'anneau : vide juste après « Fait », plein à l'échéance. Un geste jamais noté a sa case pleine. */
  ringOf(t: TaskItem): number | null { return t.rec && t.due && !t.done ? occurrenceProgress(t.rec, t.due, this.store.todayStr()) : null; }
  stock = (s: NonNullable<NonNullable<TaskItem['maintenance']>['stock']>): string => stockLabel(s, this.fmt);
  stockLeft = stockLeftLabel;
  low = stockLow;
  isLate(t: TaskItem): boolean { return !t.done && gesteGroup(t, this.store.todayStr(), this.horizon()) === 'retard'; }
  paused(t: TaskItem): boolean { const p = t.maintenance?.pausedUntil; return !!p && p > this.store.todayStr(); }
  doneToday(t: TaskItem): boolean { return lastDoneDay(t) === this.store.todayStr(); }

  ouvrirForm(id: string | null): void { this.form.set({ id }); }
  ouvrirMenu(id: string): void { this.menuMode.set(''); this.menuId.set(id); }
  ouvrirStock(id: string): void { this.stockMode.set('ajout'); this.qte.set(1); this.jour.set(this.store.todayStr()); this.menuId.set(id); this.menuMode.set('stock'); }
  /** Le nom de l'appareil rattaché, si le module Équipements est allumé et la fiche connue. */
  eqpName(t: TaskItem): string {
    const id = t.maintenance?.equipmentId;
    return id && this.store.modEquipements() ? this.eqp.find(id)?.name || '' : '';
  }
  fermerMenu(): void { this.menuId.set(null); this.menuMode.set(''); }

  readonly carnet = signal(false);
  readonly periode = signal<CarnetPeriod>('12');
  readonly exporting = signal(false);
  async exporter(format: 'pdf' | 'zip'): Promise<void> {
    this.exporting.set(true);
    try { await this.api.carnet(format, this.periode()); this.carnet.set(false); }
    catch (e) { this.store.toast((e as Error).message || 'Le carnet n’a pas pu être préparé.'); }
    finally { this.exporting.set(false); }
  }
  noterJour(t: TaskItem): void { this.store.gesteFaitLe(t.id, this.jour(), this.par() || null); this.fermerMenu(); }
}
