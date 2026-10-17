import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { EquipementsStore } from '../../core/equipements.store';
import { IconComponent } from '../../core/icon';
import { ItemCtx } from '../../core/items';
import {
  AttachmentKind, CONDITIONS, EVENT_KINDS, EqpAttachment, EqpDetail, EqpItem, EventKind,
  attachmentLabel, categoryOf, eventLabel, statusLabel,
} from '../../core/equipements.api';
import { WARRANTY_TONE, fmtCents } from '../../core/equipements';
import { frDate } from '../../core/warranty';
import { TaskItem } from '../../core/models';
import { nextLabel } from '../../core/entretien';
import { EntretienApi } from '../../core/entretien.api';
import { fmtEurosInt } from '../../core/finances.store';
import { lastDoneDay } from '../../core/task-ops';

/**
 * La fiche d'un équipement, en lecture : ce qu'il faut au SAV d'un coup d'œil
 * (garantie, numéro de série à copier, facture), puis l'achat, les pièces
 * jointes et l'historique. Joindre un fichier et noter une panne se font d'ici,
 * sans passer en modification : ce sont les gestes du jour de la panne.
 */
@Component({
  selector: 'app-equipment-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @let it = item();
    @let d = detail();
    <div class="pill" [style.background]="tone().bg" [style.color]="tone().fg">{{ it.warranty.label }}</div>
    <div class="explain">{{ it.warranty.explain }}@if (it.warrantyNote) { <br />{{ it.warrantyNote }} }</div>

    @if (it.status !== 'en_service' || it.archivedAt) {
      <div class="status" [class.bad]="it.status === 'en_panne'">
        {{ statusLabel(it.status) }}@if (it.statusOn) { depuis le {{ fr(it.statusOn) }} }@if (it.archivedAt) { · fiche archivée }
        @if (it.replacedBy && it.replacedByName) { · remplacé par <button class="lnk" (click)="open(it.replacedBy)">{{ it.replacedByName }}</button> }
      </div>
    }

    <div class="grid">
      <div class="k">Pièce</div><div class="v">{{ it.roomName || 'Sans pièce' }}</div>
      <div class="k">Catégorie</div><div class="v">{{ cat().label }}</div>
      @if (it.brand || it.model) { <div class="k">Marque, modèle</div><div class="v">{{ [it.brand, it.model].filter(ok).join(' · ') }}</div> }
      @if (it.serial) {
        <div class="k">N° de série</div>
        <div class="v serial"><span class="mono">{{ it.serial }}</span>
          <button class="copy" (click)="copy(it.serial)"><f-icon name="copy" [size]="14" color="currentColor" [width]="2.2" /> Copier</button></div>
      }
      @if (it.purchasedOn) { <div class="k">Acheté le</div><div class="v">{{ fr(it.purchasedOn) }}</div> }
      @if (it.purchasePrice !== null) { <div class="k">Prix</div><div class="v">{{ euros(it.purchasePrice) }}</div> }
      @if (it.vendor) { <div class="k">Vendeur</div><div class="v">{{ it.vendor }}</div> }
      <div class="k">État à l’achat</div><div class="v">{{ condition() }}</div>
    </div>
    @if (it.notes) { <div class="notes">{{ it.notes }}</div> }
    @if (d?.replaces?.length) {
      <div class="small">Remplace :
        @for (r of d!.replaces; track r.id) { <button class="lnk" (click)="open(r.id)">{{ r.name }}</button> }
      </div>
    }

    <div class="overline">Pièces jointes</div>
    @if (d) {
      <div class="files">
        @for (a of d.attachmentList; track a.id) {
          <div class="file">
            <a class="thumb" [href]="url(a)" target="_blank" rel="noopener">
              @if (a.mime.startsWith('image/')) { <img [src]="url(a)" [alt]="a.name" loading="lazy" /> }
              @else { <f-icon name="documents" [size]="26" color="var(--ink3)" /> }
            </a>
            <div class="fmeta"><b>{{ attachmentLabel(a.kind) }}</b><span>{{ a.label || a.name }}</span></div>
            @if (eqp.canEdit()) { <button class="x" (click)="detach(a)" title="Retirer"><f-icon name="x" [size]="14" color="var(--ink3)" /></button> }
          </div>
        } @empty { <div class="small">Aucune pièce jointe.</div> }
      </div>
    } @else { <div class="small">Chargement…</div> }
    @if (eqp.canEdit()) {
      <div class="adds">
        <label class="add"><f-icon name="plus" [size]="14" color="currentColor" [width]="2.4" /> Photo de la plaque
          <input type="file" accept="image/*" capture="environment" hidden (change)="pick($event, 'plaque')" /></label>
        <label class="add"><f-icon name="plus" [size]="14" color="currentColor" [width]="2.4" /> Facture
          <input type="file" accept="image/*,application/pdf" hidden (change)="pick($event, 'facture')" /></label>
        <label class="add"><f-icon name="plus" [size]="14" color="currentColor" [width]="2.4" /> Notice
          <input type="file" accept="image/*,application/pdf" hidden (change)="pick($event, 'notice')" /></label>
        <label class="add"><f-icon name="plus" [size]="14" color="currentColor" [width]="2.4" /> Photo
          <input type="file" accept="image/*" hidden (change)="pick($event, 'photo')" /></label>
      </div>
      @if (sending()) { <div class="small">Envoi en cours…</div> }
    }

    @if (gestes().length) {
      <!-- Les gestes d'entretien de l'appareil (module Entretien) : la prochaine fois, et le geste d'un tap. -->
      <div class="overline">Entretien@if (coutEntretien(); as c) { <span class="ov-cost"> · environ {{ c }} € par an</span> }</div>
      <ul class="gestes">
        @for (g of gestes(); track g.id) {
          <li>
            <button class="g-name" (click)="foyer.openItem('task', g.id, undefined, true)">{{ g.text }}<span>{{ gesteNext(g) }}</span></button>
            @if (doneToday(g)) { <span class="g-ok"><f-icon name="check" [size]="12" color="var(--sage)" [width]="3" /> Fait</span> }
            @else if (!g.done) { <button class="g-fait" (click)="foyer.toggleTask(g.id)">Fait aujourd'hui</button> }
          </li>
        }
      </ul>
    }

    <div class="overline">Historique</div>
    @if (eqp.canEdit()) {
      <div class="evt-form">
        <select class="input" [ngModel]="evKind()" (ngModelChange)="evKind.set($event)">
          @for (k of eventKinds; track k.id) { <option [value]="k.id">{{ k.label }}</option> }
        </select>
        <input class="input" type="date" [ngModel]="evAt()" (ngModelChange)="evAt.set($event || '')" />
        <input class="input wide" [ngModel]="evText()" (ngModelChange)="evText.set($event)" placeholder="Ce qui s’est passé (fuite, joint changé…)" maxlength="1000" />
        <input class="input cost" inputmode="decimal" [ngModel]="evCost()" (ngModelChange)="evCost.set($event)" placeholder="Coût (€)" />
        <button class="btn btn-soft" [disabled]="eqp.busy()" (click)="addEvent()">Noter</button>
      </div>
    }
    @if (d) {
      <ul class="events">
        @for (e of d.events; track e.id) {
          <li><span class="when">{{ fr(e.at) }}</span><span class="what"><b>{{ eventLabel(e.kind) }}</b>@if (e.text) { : {{ e.text }} }@if (e.cost !== null) { · {{ euros(e.cost) }} }</span>
            @if (eqp.canEdit()) { <button class="x" (click)="dropEvent(e.id)" title="Retirer"><f-icon name="x" [size]="13" color="var(--ink3)" /></button> }</li>
        } @empty { <li class="small">Rien de noté pour l’instant.</li> }
      </ul>
    }
  `,
  styles: [`
    :host { display: block; }
    .pill { display: inline-block; padding: 7px 13px; border-radius: 20px; font-size: 13.5px; font-weight: 800; }
    .explain { font-size: 12.5px; font-weight: 600; color: var(--ink2); margin: 7px 0 4px; line-height: 1.45; }
    .status { margin-top: 10px; padding: 9px 12px; border-radius: 11px; background: var(--soft); font-size: 13px; font-weight: 700; color: var(--ink2); }
    .status.bad { background: #FCE9E3; color: #C6492F; }
    .grid { display: grid; grid-template-columns: max-content 1fr; gap: 9px 16px; margin-top: 16px; align-items: center; }
    .k { font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .03em; }
    .v { font-size: 14.5px; font-weight: 700; color: var(--ink); min-width: 0; overflow-wrap: anywhere; }
    .serial { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
    .copy { display: inline-flex; align-items: center; gap: 5px; border: none; background: var(--soft2); color: var(--ink2); border-radius: 9px; padding: 6px 10px; font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .notes { margin-top: 12px; font-size: 13.5px; font-weight: 600; color: var(--ink2); white-space: pre-wrap; line-height: 1.5; }
    .overline { margin: 18px 0 8px; }
    .small { font-size: 12.5px; font-weight: 600; color: var(--ink3); margin-top: 6px; }
    .lnk { border: none; background: none; padding: 0 3px; font: inherit; font-weight: 800; color: var(--primary); cursor: pointer; text-decoration: underline; }
    .files { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .file { position: relative; display: flex; flex-direction: column; gap: 6px; background: var(--soft); border-radius: 12px; padding: 8px; }
    .thumb { display: flex; align-items: center; justify-content: center; height: 96px; border-radius: 9px; background: var(--surface); overflow: hidden; }
    .thumb img { width: 100%; height: 100%; object-fit: cover; }
    .fmeta { display: flex; flex-direction: column; font-size: 12px; font-weight: 600; color: var(--ink2); min-width: 0; }
    .fmeta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fmeta b { color: var(--ink); font-weight: 800; }
    .x { position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; border-radius: 50%; border: none; background: var(--surface); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .adds { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .add { display: inline-flex; align-items: center; gap: 6px; padding: 9px 12px; border-radius: 11px; background: var(--soft2); color: var(--ink2); font-size: 13px; font-weight: 800; cursor: pointer; }
    .evt-form { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .evt-form .input { flex: 1 1 130px; min-width: 0; box-sizing: border-box; }
    .evt-form .wide { flex: 3 1 220px; }
    .evt-form .cost { flex: 0 1 110px; }
    select.input { appearance: auto; }
    .events { list-style: none; margin: 0; padding: 0; }
    .events li { position: relative; display: flex; gap: 12px; padding: 9px 30px 9px 0; border-top: 1px solid var(--line); font-size: 13.5px; font-weight: 600; color: var(--ink2); }
    .events li:first-child { border-top: none; }
    .events .x { top: 8px; right: 0; }
    .when { flex: none; width: 82px; font-weight: 800; color: var(--ink3); }
    .what { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .what b { color: var(--ink); }
    .ov-cost { text-transform: none; letter-spacing: 0; font-weight: 700; }
    .gestes { list-style: none; margin: 0 0 6px; padding: 0; }
    .gestes li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); }
    .gestes li:first-child { border-top: none; }
    .g-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; border: none; background: none; padding: 0; text-align: left; font: inherit; font-size: 13.5px; font-weight: 800; color: var(--ink); cursor: pointer; }
    .g-name span { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .g-fait { flex: none; border: none; border-radius: 10px; padding: 8px 11px; min-height: 36px; font: inherit; font-size: 12.5px; font-weight: 800; background: var(--sage); color: #fff; cursor: pointer; }
    .g-ok { flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 800; color: var(--sage); }
  `],
})
export class EquipmentView {
  readonly eqp = inject(EquipementsStore);
  readonly foyer = inject(FoyerStore);
  private readonly entApi = inject(EntretienApi);
  /** Le coût annuel prévu de ses gestes chiffrés : adultes seulement, comme les autres montants de la fiche. */
  readonly coutEntretien = computed(() => {
    if (this.foyer.isChild() || !this.gestes().length) return '';
    this.entApi.assurer();
    const n = this.gestes().reduce((s, g) => s + (g.done ? 0 : this.entApi.cout(g.id)?.forecast ?? 0), 0);
    return n ? fmtEurosInt(n) : '';
  });
  readonly item = input.required<EqpItem>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly eventKinds = EVENT_KINDS;
  readonly fr = frDate;
  readonly euros = fmtCents;
  readonly statusLabel = statusLabel;
  readonly attachmentLabel = attachmentLabel;
  readonly eventLabel = eventLabel;
  readonly ok = Boolean;

  readonly detail = computed<EqpDetail | null>(() => this.eqp.details()[this.item().id] ?? null);
  readonly tone = computed(() => WARRANTY_TONE[this.item().warranty.state]);
  readonly cat = computed(() => categoryOf(this.item().category));
  readonly condition = computed(() => CONDITIONS.find((c) => c.id === this.item().condition)?.label ?? '');
  readonly sending = signal(false);
  /** Ses gestes d'entretien, quand le module Entretien est allumé. */
  readonly gestes = computed(() => (this.foyer.modEntretien() ? this.foyer.gestesOf(this.item().id) : []));
  gesteNext(t: TaskItem): string { return t.done ? 'Archivé' : nextLabel(t, this.foyer.todayStr(), frDate) || (t.history?.length ? '' : 'Pas encore noté'); }
  doneToday(t: TaskItem): boolean { return lastDoneDay(t) === this.foyer.todayStr(); }

  readonly evKind = signal<EventKind>('panne');
  readonly evAt = signal(this.foyer.todayStr());
  readonly evText = signal('');
  readonly evCost = signal('');

  constructor() {
    // Le détail (pièces jointes, historique) se lit à l'ouverture de la fiche.
    effect(() => { void this.eqp.loadDetail(this.item().id); });
  }

  url(a: EqpAttachment): string { return this.eqp.attachmentUrl(a.id); }
  open(id: number): void { this.foyer.openItem('equipment', String(id), undefined, true); }

  async copy(text: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); this.foyer.toast('Numéro de série copié'); }
    catch { this.foyer.toast('Copie impossible : sélectionnez le numéro à la main.'); }
  }

  async pick(ev: Event, kind: AttachmentKind): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    this.sending.set(true);
    try {
      await this.eqp.attach(this.item().id, kind, file);
      this.foyer.toast(attachmentLabel(kind) + ' jointe');
    } catch (e) { this.foyer.toast((e as Error).message || 'L’envoi a échoué.'); }
    this.sending.set(false);
  }

  async detach(a: EqpAttachment): Promise<void> {
    if (!confirm(`Retirer « ${a.label || a.name} » de cette fiche ? Le fichier est effacé s’il ne sert à aucune autre fiche.`)) return;
    try { await this.eqp.removeAttachment(a.id); this.foyer.toast('Pièce jointe retirée'); }
    catch (e) { this.foyer.toast((e as Error).message || 'Le retrait a échoué.'); }
  }

  async addEvent(): Promise<void> {
    try {
      await this.eqp.addEvent(this.item().id, { kind: this.evKind(), text: this.evText().trim(), cost: this.evCost().trim() || null, at: this.evAt() || undefined });
      this.evText.set(''); this.evCost.set('');
      this.foyer.toast('Noté dans l’historique');
    } catch (e) { this.foyer.toast((e as Error).message || 'L’enregistrement a échoué.'); }
  }

  async dropEvent(id: number): Promise<void> {
    try { await this.eqp.archiveEvent(id); } catch (e) { this.foyer.toast((e as Error).message); }
  }
}
