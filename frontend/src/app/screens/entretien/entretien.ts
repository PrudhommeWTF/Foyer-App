import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { TaskItem } from '../../core/models';
import { GROUP_ORDER, GesteGroup, freqLabel, gesteGroup, groupLabel, lastDoneLabel, nextLabel, stockLabel, stockLow } from '../../core/entretien';
import { lastDoneDay } from '../../core/task-ops';
import { GesteForm } from './geste-form';
import { EquipementsStore } from '../../core/equipements.store';
import { EntretienApi } from '../../core/entretien.api';
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
  imports: [NgTemplateOutlet, FormsModule, IconComponent, ModalComponent, GesteForm],
  template: `
    <div class="screen-enter">
      <div class="head-row">
        <p class="intro">Les gestes d'entretien qui reviennent. Quand c'est fait, un tap : la prochaine date part d'aujourd'hui.</p>
        <button class="btn btn-primary new-btn" (click)="ouvrirForm(null)">
          <f-icon name="plus" [size]="17" color="#fff" [width]="2.6" /> Nouveau geste
        </button>
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
      }

      @for (s of sections(); track s.key) {
        <div class="sec-title" [class.late]="s.late">{{ s.title }} · {{ s.gestes.length }}</div>
        @for (t of s.gestes; track t.id) {
          <ng-container [ngTemplateOutlet]="ligne" [ngTemplateOutletContext]="{ $implicit: t }" />
        }
      }

      @if (archives().length) {
        <button class="arch-toggle" (click)="voirArchives.set(!voirArchives())">
          <f-icon [name]="voirArchives() ? 'chevronDown' : 'chevronRight'" [size]="15" color="var(--ink3)" [width]="2.4" />
          {{ groupLabel('archive') }} · {{ archives().length }}
        </button>
        @if (voirArchives()) {
          @for (t of archives(); track t.id) { <ng-container [ngTemplateOutlet]="ligne" [ngTemplateOutletContext]="{ $implicit: t }" /> }
        }
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
      <div class="geste" [class.arch]="t.done">
        <button class="g-body" (click)="store.openItem('task', t.id)">
          <span class="g-title">{{ t.text }}</span>
          @if (t.maintenance?.howto) { <span class="g-howto">{{ t.maintenance.howto }}</span> }
          <span class="g-meta">
            @if (store.roomName(t.maintenance?.roomId); as r) { <span class="room"><f-icon name="home" [size]="12" color="var(--ink3)" [width]="2.4" /> {{ r }}</span> }
            @if (t.rec) { <span>{{ freq(t) }}</span> }
            @if (coutAn(t); as c) { <span>{{ c }}</span> }
          </span>
          @if (eqpName(t); as e) {
            <span class="eqp" role="link" (click)="$event.stopPropagation(); store.openItem('equipment', '' + t.maintenance?.equipmentId)">{{ e }}</span>
          }
          <span class="g-last" [class.never]="!t.history?.length">{{ last(t) || 'Pas encore noté' }}</span>
          @if (next(t); as n) { <span class="g-next" [class.late]="isLate(t)">{{ n }}</span> }
          @if (t.maintenance?.stock; as st) { <span class="g-stock" [class.low]="low(st)">{{ stock(st) }}</span> }
        </button>
        @if (t.maintenance?.stock; as st) {
          <!-- Le stock : racheter se note ici ; sous le seuil, l'article part aux courses d'un tap. -->
          <div class="g-stock-act">
            <button class="mini" (click)="ouvrirStock(t.id)">J'en ai racheté</button>
            @if (low(st) && !t.done) {
              @if (store.onShoppingList(st.article)) { <span class="mini ok"><f-icon name="check" [size]="12" color="var(--sage)" [width]="3" /> Dans les courses</span> }
              @else { <button class="mini warn" (click)="store.gesteToShopping(t.id)">Ajouter aux courses</button> }
            }
          </div>
        }
        <div class="g-act">
          @if (t.done) {
            <button class="fait soft" (click)="store.archiveGeste(t.id, false)">Réactiver</button>
          } @else if (doneToday(t)) {
            <span class="fait ok"><f-icon name="check" [size]="14" color="var(--sage)" [width]="3" /> Fait aujourd'hui</span>
          } @else {
            <button class="fait" (click)="store.toggleTask(t.id)">Fait aujourd'hui</button>
          }
          <button class="more" (click)="ouvrirMenu(t.id)" [attr.aria-label]="'Autres actions pour ' + t.text">
            <f-icon name="more" [size]="20" color="var(--ink2)" [width]="3.2" />
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
  `,
  styles: [`
    .head-row { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 14px; }
    .intro { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin: 2px 0; }
    .couts { font-size: 13px; font-weight: 700; color: var(--ink2); background: var(--soft); border-radius: 12px; padding: 10px 13px; margin: 0 0 12px; line-height: 1.5; }
    .couts b { color: var(--ink); }
    .lien { border: none; background: none; padding: 0; font: inherit; font-weight: 800; color: var(--primary); cursor: pointer; text-decoration: underline; }
    .new-btn { flex: none; display: inline-flex; align-items: center; gap: 7px; }
    .tri { margin-bottom: 6px; }
    .sec-title { font-size: 12px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; margin: 18px 0 9px; }
    .sec-title.late { color: #C6492F; }

    .geste { display: flex; flex-direction: column; gap: 10px; background: var(--surface); border-radius: var(--r-card); padding: 12px 12px 12px 16px; box-shadow: 0 12px 28px -22px rgba(90,60,40,.55); margin-bottom: 10px; border-left: 4px solid var(--sage); }
    .geste.arch { opacity: .7; border-left-color: var(--line2); }
    .g-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; border: none; background: none; padding: 0; text-align: left; font: inherit; cursor: pointer; }
    .g-title { font-size: 15.5px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .g-howto { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.4; }
    .g-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; font-weight: 700; color: var(--ink3); }
    .room { display: inline-flex; align-items: center; gap: 4px; }
    .g-last { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .g-last.never { color: var(--ink3); font-style: italic; }
    .g-next { font-size: 12.5px; font-weight: 800; color: var(--ink); }
    .g-next.late { color: #C6492F; }
    .g-stock { font-size: 12px; font-weight: 700; color: var(--ink2); }
    .g-stock.low { color: #9A6A12; }
    .eqp { align-self: flex-start; font-size: 12px; font-weight: 800; color: #4E93B8; background: #E5F0F4; border-radius: 7px; padding: 2px 8px; cursor: pointer; }
    .g-stock-act { display: flex; flex-wrap: wrap; gap: 6px; }
    .mini { display: inline-flex; align-items: center; gap: 4px; border: none; border-radius: 10px; padding: 8px 11px; min-height: 36px; font: inherit; font-size: 12.5px; font-weight: 800; background: var(--soft); color: var(--ink2); cursor: pointer; }
    .mini.warn { background: #FDF0DA; color: #9A6A12; }
    .mini.ok { background: #EDF2EB; color: var(--sage); cursor: default; }
    .lab.sp { margin-top: 14px; }
    .g-act { display: flex; align-items: center; gap: 8px; }
    /* Le geste : grand, à un tap, tenu au pouce sur téléphone. */
    .fait { flex: 1; justify-content: center; border: none; border-radius: 12px; padding: 11px 13px; min-height: 44px; font: inherit; font-size: 13px; font-weight: 800; background: var(--sage); color: #fff; cursor: pointer; white-space: nowrap; }
    .fait.soft { background: var(--soft2); color: var(--ink2); }
    .fait.ok { display: inline-flex; align-items: center; gap: 5px; background: #EDF2EB; color: var(--sage); cursor: default; }
    .more { flex: none; width: 44px; height: 44px; border: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; cursor: pointer; }

    .arch-toggle { display: inline-flex; align-items: center; gap: 6px; border: none; background: none; padding: 16px 0 8px; font: inherit; font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; cursor: pointer; }
    .empty { text-align: center; color: var(--ink2); padding: 40px 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .empty p { font-size: 14px; font-weight: 600; line-height: 1.5; max-width: 440px; margin: 0; }

    .acts { display: flex; flex-direction: column; gap: 6px; }
    .act { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: var(--soft); border-radius: 12px; padding: 13px 14px; font: inherit; font-size: 14px; font-weight: 800; color: var(--ink); cursor: pointer; text-align: left; }
    .lab { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 800; color: var(--ink2); margin-bottom: 14px; }
    .q { font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin: 0 0 14px; }
    .f-act { display: flex; gap: 8px; margin-top: 8px; }
    .f-act .btn { flex: 1; }

    @media (min-width: 861px) { :host { display: block; max-width: 760px; } }
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

  private fmt = (d: string): string => this.store.fmtNumDate(d);
  freq(t: TaskItem): string { return t.rec ? freqLabel(t.rec) : ''; }
  last(t: TaskItem): string { return lastDoneLabel(t, this.fmt, (id) => this.store.memberName(id)); }
  next(t: TaskItem): string { return nextLabel(t, this.store.todayStr(), this.fmt); }
  stock = (s: NonNullable<NonNullable<TaskItem['maintenance']>['stock']>): string => stockLabel(s, this.fmt);
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
  noterJour(t: TaskItem): void { this.store.gesteFaitLe(t.id, this.jour(), this.par() || null); this.fermerMenu(); }
}
