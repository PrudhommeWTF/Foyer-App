import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { FinancesStore, fmtEuros, fmtEurosInt } from '../../core/finances.store';
import { EntretienApi } from '../../core/entretien.api';
import { IconComponent } from '../../core/icon';
import { StampComponent } from '../../shared/stamp';
import { WhoComponent } from '../../shared/who';
import { TaskItem } from '../../core/models';
import { REMIND_LABELS, dueLabel, subProgress, subtasksOf } from '../../core/tasks';
import { recLabel } from '../../core/recurrence';
import { whoBadges } from '../../core/schedule';
import { ItemCtx } from '../../core/items';
import { stockLabel } from '../../core/entretien';
import { parisDay } from '../../core/task-ops';
import { RealisationsComponent } from '../entretien/realisations';

/**
 * La fiche d'une tâche, en lecture : pour qui, pour quand, à quel rythme, la
 * note entière, les sous-tâches (qu'on coche ici même) et ce qui a été fait.
 */
@Component({
  selector: 'app-task-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, StampComponent, WhoComponent, RealisationsComponent],
  template: `
    @let t = item();
    @if (parent(); as p) {
      <button type="button" class="parent" (click)="store.openItem('task', p.id, undefined, true)">
        <f-icon name="chevronLeft" [size]="14" color="currentColor" [width]="2.4" /> Sous-tâche de « {{ p.text }} »
      </button>
    }
    @if (t.done) {
      <div class="done-band"><f-icon name="check" [size]="15" color="#fff" [width]="3" /> {{ doneText() }}</div>
    }
    @if (t.due) {
      <div class="row">
        <span class="ic"><f-icon name="calendar" [size]="18" [color]="late() ? '#C6492F' : '#E56B4E'" [width]="2.2" /></span>
        <div class="txt"><div class="main" [class.late]="late()">{{ due() }}</div>
          @if (t.remind) { <div class="sub"><f-icon name="bell" [size]="11" color="var(--ink3)" [width]="2.4" /> Rappel {{ remind() }}</div> }</div>
      </div>
    }
    @if (t.rec) {
      <div class="row">
        <span class="ic"><f-icon name="refresh" [size]="18" color="#7A9B76" [width]="2.2" /></span>
        <div class="txt"><div class="main">{{ rec() }}</div></div>
      </div>
    }
    <div class="row">
      <span class="ic"><f-icon name="users" [size]="18" color="#9B6FA8" [width]="2.2" /></span>
      @if (t.who.length) { <f-who [badges]="badges()" [size]="26" /><span class="names">{{ names() }}</span> }
      @else { <div class="txt"><div class="main muted">Personne en particulier</div></div> }
    </div>
    <div class="row">
      <span class="ic"><span class="dot" [style.background]="listColor()"></span></span>
      <div class="txt"><div class="main">{{ listName() }}</div>
        @if (t.cat || t.edId) { <div class="sub">@if (t.edId) { <span class="ed-tag">ÉcoleDirecte</span> } {{ t.cat }}</div> }</div>
    </div>
    @if (t.maintenance; as m) {
      <!-- Geste d'entretien : ce qui se règle dans l'écran Entretien, montré ici en lecture. -->
      @if (store.roomName(m.roomId); as r) {
        <div class="row">
          <span class="ic"><f-icon name="home" [size]="18" color="#7A9B76" [width]="2.2" /></span>
          <div class="txt"><div class="main">{{ r }}</div>@if (paused()) { <div class="sub">{{ paused() }}</div> }</div>
        </div>
      }
      @if (m.stock) {
        <div class="row">
          <span class="ic"><f-icon name="panier" [size]="18" color="#7A9B76" [width]="2.2" /></span>
          <div class="txt"><div class="main">{{ stock() }}</div><div class="sub">{{ m.stock.article }} · {{ m.stock.use }} par geste, racheter à partir de {{ m.stock.threshold }}</div></div>
        </div>
      }
      @if (cout(); as c) {
        <div class="row">
          <span class="ic"><f-icon name="budget" [size]="18" color="#7A9B76" [width]="2.2" /></span>
          <div class="txt"><div class="main">{{ c.main }}</div>@if (c.sub) { <div class="sub">{{ c.sub }}</div> }</div>
        </div>
      }
      @if (m.howto) { <div class="note">{{ m.howto }}</div> }
    }
    @if (t.note) {
      <div class="note">{{ t.note }}</div>
    }
    @if (t.shopListId || (t.contractId && canFinances())) {
      <div class="links">
        @if (t.shopListId) {
          <button type="button" class="link" (click)="store.openShoppingList(t.shopListId!)">
            <f-icon name="panier" [size]="14" color="var(--sage)" [width]="2.2" />
            {{ store.shopRemaining(t.shopListId!) }} article{{ store.shopRemaining(t.shopListId!) > 1 ? 's' : '' }} à prendre
          </button>
        }
        @if (t.contractId && canFinances()) {
          <button type="button" class="link ext" (click)="openContract(t.contractId!)">
            <f-icon name="budget" [size]="14" color="var(--ink2)" [width]="2.2" /> Ouvrir le contrat
          </button>
        }
      </div>
    }
    @if (subs().length) {
      <div class="field-label">Sous-tâches · {{ progress() }}</div>
      <div class="subs">
        @for (sb of subs(); track sb.id) {
          <div class="sub-row">
            <button type="button" class="tick" [class.on]="sb.done" (click)="store.toggleTask(sb.id)" [attr.aria-label]="(sb.done ? 'Rouvrir ' : 'Cocher ') + sb.text">
              @if (sb.done) { <f-icon name="check" [size]="11" color="#fff" [width]="3.4" /> }
            </button>
            <span class="sub-text" [class.strike]="sb.done">{{ sb.text }}</span>
          </div>
        }
      </div>
    }
    @if (geste() && store.modEntretien()) {
      <!-- Un geste d'entretien : tout son historique, avec la note et les justificatifs de chaque réalisation. -->
      <app-realisations [item]="t" [openNote]="!!ctx()?.note" />
    } @else if (t.history?.length) {
      <!-- Les réalisations d'une série : la dernière d'abord, cinq au plus. -->
      <div class="field-label">Réalisations · {{ t.history!.length }}</div>
      @for (h of lastDone(); track h.at) {
        <div class="hist-line">{{ store.fmtNumDate(day(h.at)) }}{{ h.by ? ' par ' + store.memberName(h.by) : '' }}@if (h.due) { <span class="hist-due"> · prévue le {{ store.fmtNumDate(h.due) }}</span> }</div>
      }
    }
    <f-stamp [fem]="true" [createdBy]="store.memberName(t.by || '')" [createdAt]="t.at"
             [modifiedBy]="store.memberName(t.upBy || '')" [modifiedAt]="t.upAt" />
  `,
  styles: [`
    :host { display: block; }
    .parent { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 8px; padding: 0; border: none; background: none; font: inherit; font-size: 13px; font-weight: 800; color: var(--primary); cursor: pointer; }
    .done-band { display: flex; align-items: center; gap: 8px; margin: 2px 0 8px; padding: 9px 12px; border-radius: 12px; background: var(--sage); color: #fff; font-size: 13px; font-weight: 800; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; }
    .row + .row { border-top: 1px solid var(--line); }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .dot { width: 12px; height: 12px; border-radius: 4px; }
    .txt { flex: 1; min-width: 0; }
    .main { font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .main.late { color: #C6492F; }
    .main.muted { color: var(--ink3); }
    .sub { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .names { font-size: 14px; font-weight: 800; color: var(--ink); }
    .ed-tag { font-size: 10.5px; font-weight: 800; color: #4E93B8; background: #E5F0F4; border-radius: 6px; padding: 2px 6px; }
    .note { margin: 6px 0 4px; padding: 11px 13px; border-radius: 12px; background: var(--soft); font-size: 14px; font-weight: 600; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
    .links { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 2px; }
    .link { display: inline-flex; align-items: center; gap: 6px; border: none; border-radius: 10px; padding: 7px 11px; background: #EDF2EB; color: var(--sage); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .link.ext { background: var(--soft); color: var(--ink2); }
    .field-label { margin-top: 16px; }
    .subs { display: flex; flex-direction: column; gap: 6px; }
    .sub-row { display: flex; align-items: center; gap: 10px; background: var(--soft); border-radius: 12px; padding: 9px 12px; }
    .tick { width: 22px; height: 22px; flex: none; border-radius: 7px; border: 2px solid var(--line2); background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; position: relative; }
    .tick::before { content: ''; position: absolute; inset: -10px; }
    .tick.on { background: var(--sage); border-color: var(--sage); }
    .sub-text { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .sub-text.strike { color: var(--ink3); text-decoration: line-through; }
    .hist-line { font-size: 12.5px; font-weight: 700; color: var(--ink2); padding: 4px 0; }
    .hist-due { color: var(--ink3); }
    f-stamp { display: block; margin-top: 12px; }
  `],
})
export class TaskView {
  readonly store = inject(FoyerStore);
  private readonly fin = inject(FinancesStore);
  private readonly entApi = inject(EntretienApi);
  /** Ce que coûte un geste d'entretien : adultes seulement, lu à part (les montants ne sont pas dans le document). */
  readonly cout = computed(() => {
    const t = this.item();
    if (!t.maintenance || this.store.isChild()) return null;
    this.entApi.assurer();
    const c = this.entApi.cout(t.id);
    if (!c) return null;
    const contrat = c.contractId !== null ? this.entApi.couts()?.contracts.find((x) => x.id === c.contractId)?.name : '';
    const main = c.contractId !== null ? `Couvert par le contrat « ${contrat || '?'} »` : c.forecast ? `Environ ${fmtEurosInt(c.forecast)} € par an` : 'Pas de coût prévu';
    const sub = [c.amount ? `${fmtEuros(c.amount)} € à chaque fois` : '', c.real12 ? `${fmtEurosInt(c.real12)} € sur 12 mois` : ''].filter(Boolean).join(' · ');
    return { main, sub };
  });
  readonly item = input.required<TaskItem>();
  readonly ctx = input<ItemCtx | undefined>(undefined);

  readonly parent = computed(() => { const p = this.item().parentId; return p ? this.store.task(p) ?? null : null; });
  readonly subs = computed(() => subtasksOf(this.store.d().tasks, this.item().id));
  readonly progress = computed(() => { const p = subProgress(this.subs()); return p ? `${p.done}/${p.total}` : ''; });
  readonly due = computed(() => { const t = this.item(); return dueLabel(t.due, t.time, this.store.todayStr(), (iso) => this.store.fmtNumDate(iso), t.rec?.grace); });
  readonly late = computed(() => { const t = this.item(); return !t.done && !!t.due && t.due < this.store.todayStr(); });
  readonly rec = computed(() => { const r = this.item().rec; return r ? recLabel(r, (iso) => this.store.fmtNumDate(iso)) : ''; });
  readonly remind = computed(() => { const r = this.item().remind; return r ? REMIND_LABELS[r].toLowerCase() : ''; });
  readonly badges = computed(() => whoBadges(this.item(), this.store.d().members));
  readonly names = computed(() => this.item().who.map((id) => this.store.memberName(id)).filter(Boolean).join(', '));
  private readonly list = computed(() => this.store.d().taskLists.find((l) => l.id === this.item().listId));
  readonly listName = computed(() => this.list()?.name || 'Liste supprimée');
  readonly listColor = computed(() => this.list()?.color || 'var(--primary)');
  readonly geste = computed(() => this.list()?.kind === 'entretien');
  readonly lastDone = computed(() => (this.item().history || []).slice(-5).reverse());
  readonly stock = computed(() => { const s = this.item().maintenance?.stock; return s ? stockLabel(s, (d) => this.store.fmtNumDate(d)) : ''; });
  readonly paused = computed(() => { const p = this.item().maintenance?.pausedUntil; return p && p > this.store.todayStr() ? 'En pause jusqu’au ' + this.store.fmtNumDate(p) : ''; });
  /** Le jour d'une réalisation, à Paris : une coche à 0 h 30 est du jour même, pas de la veille en UTC. */
  readonly day = parisDay;
  readonly doneText = computed(() => {
    const t = this.item();
    const qui = t.doneBy ? ' par ' + this.store.memberName(t.doneBy) : '';
    const quand = t.doneAt ? ' le ' + this.store.fmtNumDate(t.doneAt.slice(0, 10)) : '';
    return 'Faite' + qui + quand;
  });
  /** Les contrats sont des Finances : réservés aux adultes, module allumé. */
  readonly canFinances = computed(() => !this.store.isChild() && this.store.modFinances());
  openContract(id: number): void { this.store.closeItem(); void this.fin.openContract(id); }
}
