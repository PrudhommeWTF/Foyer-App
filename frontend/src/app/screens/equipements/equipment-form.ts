import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { EquipementsStore } from '../../core/equipements.store';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';
import { CATEGORIES, CONDITIONS, EqpItem, STATUSES } from '../../core/equipements.api';
import { ItemDraft, WARRANTY_TONE, draftOf, fieldsOf, parseMonths } from '../../core/equipements';
import { computeWarranty } from '../../core/warranty';

/**
 * Le formulaire d'un équipement. À la création, trois champs suffisent
 * (désignation, pièce, photo de la plaque prise sur le moment) ; « Plus de
 * détails » ouvre le reste, qu'on complétera plus tard. En modification, tout
 * est là, et la pastille de garantie se recalcule pendant qu'on tape. Réservé
 * aux adultes (la fiche ne l'ouvre pas pour un enfant).
 */
@Component({
  selector: 'app-equipment-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @let v = f();
    <div class="field-label">Désignation</div>
    <input class="input" [ngModel]="v.name" (ngModelChange)="set({ name: $event })" placeholder="Lave-vaisselle, ampli du salon…" maxlength="120" />

    <div class="field-label mt">Pièce</div>
    @if (rooms().length) {
      <select class="input" [ngModel]="v.room" (ngModelChange)="set({ room: $event })">
        <option value="">Sans pièce</option>
        @for (r of rooms(); track r.id) { <option [value]="r.id">{{ r.name }}</option> }
      </select>
    } @else { <div class="hint">Aucune pièce pour l’instant : l’écran Équipements propose d’en créer.</div> }

    @if (!item()) {
      <div class="field-label mt">Photo de la plaque signalétique</div>
      <label class="photo">
        {{ plaque() ? plaque()!.name : 'Prendre la photo' }}
        <input type="file" accept="image/*" capture="environment" hidden (change)="pickPlaque($event)" />
      </label>
      <div class="hint">Marque, modèle et numéro de série se lisent dessus : la fiche peut se compléter plus tard.</div>
      @if (!more()) { <button type="button" class="more" (click)="more.set(true)">Plus de détails</button> }
    }

    @if (item() || more()) {
      <div class="field-label mt">Catégorie</div>
      <select class="input" [ngModel]="v.category" (ngModelChange)="set({ category: $event })">
        @for (c of categories; track c.id) { <option [value]="c.id">{{ c.label }}</option> }
      </select>
      <div class="two mt">
        <label class="lab">Marque<input class="input" [ngModel]="v.brand" (ngModelChange)="set({ brand: $event })" maxlength="80" /></label>
        <label class="lab">Modèle<input class="input" [ngModel]="v.model" (ngModelChange)="set({ model: $event })" maxlength="80" /></label>
      </div>
      <label class="lab mt">Numéro de série<input class="input mono" [ngModel]="v.serial" (ngModelChange)="set({ serial: $event })" maxlength="80" autocapitalize="characters" /></label>

      <div class="overline">Achat</div>
      <div class="two">
        <label class="lab">Date d’achat<input class="input" type="date" [ngModel]="v.purchasedOn" (ngModelChange)="set({ purchasedOn: $event || '' })" /></label>
        <label class="lab">Prix (€)<input class="input" inputmode="decimal" [ngModel]="v.price" (ngModelChange)="set({ price: $event })" placeholder="549,99" /></label>
      </div>
      <label class="lab mt">Vendeur<input class="input" [ngModel]="v.vendor" (ngModelChange)="set({ vendor: $event })" maxlength="120" placeholder="Darty, Leboncoin…" /></label>
      <label class="lab mt">État à l’achat
        <select class="input" [ngModel]="v.condition" (ngModelChange)="set({ condition: $event })">
          @for (c of conditions; track c.id) { <option [value]="c.id">{{ c.label }}</option> }
        </select>
      </label>
      @if (eqp.assets().length) {
        <label class="lab mt">Bien
          <select class="input" [ngModel]="v.asset" (ngModelChange)="set({ asset: $event })">
            <option value="">Non précisé</option>
            @for (a of eqp.assets(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
          </select>
        </label>
      }

      <div class="overline">Garantie</div>
      <div class="two">
        <label class="lab">Durée (mois)<input class="input" inputmode="numeric" [ngModel]="v.months" (ngModelChange)="set({ months: $event })" placeholder="Règle par défaut" /></label>
        <label class="lab">Ou date de fin<input class="input" type="date" [ngModel]="v.until" (ngModelChange)="set({ until: $event || '' })" /></label>
      </div>
      <div class="preview"><span class="pill" [style.background]="tone().bg" [style.color]="tone().fg">{{ preview().label }}</span> {{ preview().explain }}</div>
      <label class="lab mt">Note sur la garantie<input class="input" [ngModel]="v.warrantyNote" (ngModelChange)="set({ warrantyNote: $event })" maxlength="500" placeholder="Extension Darty, contrat n°…" /></label>

      @if (item()) {
        <div class="overline">Statut</div>
        <select class="input" [ngModel]="v.status" (ngModelChange)="set({ status: $event })">
          @for (s of statuses; track s.id) { <option [value]="s.id">{{ s.label }}</option> }
        </select>
        @if (v.status === 'remplace') {
          <label class="lab mt">Remplacé par
            <select class="input" [ngModel]="replacement()" (ngModelChange)="replacement.set($event)">
              <option value="">Non précisé</option>
              @for (o of others(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }
            </select>
          </label>
        }
      }
      <label class="lab mt">Notes<textarea class="input" rows="3" [ngModel]="v.notes" (ngModelChange)="set({ notes: $event })" maxlength="2000"></textarea></label>
    }
  `,
  styles: [`
    :host { display: block; }
    .mt { margin-top: 14px; }
    select.input { appearance: auto; width: 100%; }
    .two { display: flex; gap: 10px; }
    .lab { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .04em; }
    .lab .input { width: 100%; box-sizing: border-box; text-transform: none; letter-spacing: 0; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .hint { font-size: 12px; font-weight: 600; color: var(--ink3); margin-top: 7px; line-height: 1.5; }
    .overline { margin: 20px 0 8px; }
    .photo { display: flex; align-items: center; justify-content: center; min-height: 52px; border-radius: 13px; border: 2px dashed var(--line2); font-size: 14px; font-weight: 800; color: var(--ink2); cursor: pointer; padding: 0 12px; text-align: center; overflow-wrap: anywhere; }
    .more { margin-top: 14px; border: none; background: none; padding: 0; font: inherit; font-size: 13.5px; font-weight: 800; color: var(--primary); cursor: pointer; }
    .preview { margin-top: 10px; font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.6; }
    .pill { display: inline-block; padding: 4px 10px; border-radius: 16px; font-weight: 800; margin-right: 4px; }
    textarea.input { resize: vertical; font: inherit; }
  `],
})
export class EquipmentForm implements ItemForm, OnInit {
  readonly foyer = inject(FoyerStore);
  readonly eqp = inject(EquipementsStore);
  readonly item = input<EqpItem | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly categories = CATEGORIES;
  readonly conditions = CONDITIONS;
  readonly statuses = STATUSES;

  readonly f = signal<ItemDraft>(draftOf(null));
  private initial: ItemDraft = draftOf(null);
  readonly plaque = signal<File | null>(null);
  readonly more = signal(false);
  readonly replacement = signal('');
  readonly dirty = computed(() => JSON.stringify(this.f()) !== JSON.stringify(this.initial) || !!this.plaque() || !!this.replacement());

  readonly rooms = this.foyer.rooms;
  readonly others = computed(() => this.eqp.items().filter((i) => i.id !== this.item()?.id));
  /** La garantie telle qu'elle sera, calculée comme le serveur la calculera. */
  readonly preview = computed(() => {
    const v = this.f(), m = parseMonths(v.months);
    return computeWarranty({ purchasedOn: v.purchasedOn || null, condition: v.condition, warrantyMonths: m === 'invalide' ? null : m, warrantyUntil: v.until || null },
      this.eqp.rules(), this.foyer.todayStr());
  });
  readonly tone = computed(() => WARRANTY_TONE[this.preview().state]);

  ngOnInit(): void { this.f.set(draftOf(this.item())); this.initial = this.f(); }
  set(p: Partial<ItemDraft>): void { this.f.update((f) => ({ ...f, ...p })); }
  pickPlaque(ev: Event): void { const i = ev.target as HTMLInputElement; this.plaque.set(i.files?.[0] ?? null); i.value = ''; }

  async submit(): Promise<ItemResult> {
    const v = this.f(), it = this.item();
    if (!v.name.trim()) { this.foyer.toast('Indique une désignation'); return { kind: 'invalid' }; }
    if (parseMonths(v.months) === 'invalide') { this.foyer.toast('La durée de garantie est un nombre entier de mois, de 0 à 240'); return { kind: 'invalid' }; }
    try {
      if (!it) {
        const created = await this.eqp.create(fieldsOf(v, null));
        const photo = this.plaque();
        if (photo) {
          // La fiche existe déjà : une photo refusée ne la fait pas disparaître, on le dit.
          try { await this.eqp.attach(created.id, 'plaque', photo); }
          catch (e) { this.foyer.toast('Fiche créée, mais la photo n’est pas passée : ' + ((e as Error).message || 'envoi impossible')); return { kind: 'done' }; }
        }
        this.foyer.toast('Équipement ajouté');
        return { kind: 'done' };
      }
      const by = Number(this.replacement());
      const patch = fieldsOf(v, this.initial);
      // « Remplacé par » passe par sa propre route : elle date le statut et pose le lien.
      if (by) delete patch.status;
      if (Object.keys(patch).length) await this.eqp.update(it.id, patch);
      if (by) await this.eqp.replace(it.id, by);
      // Plus en service : ses gestes d'entretien n'ont plus d'objet, on propose de les archiver.
      const gone = by ? 'remplace' : v.status;
      if (gone !== this.initial.status && (gone === 'remplace' || gone === 'jete' || gone === 'donne_vendu') && this.foyer.modEntretien()) {
        this.foyer.proposeArchiveGestesOf(it.id, v.name.trim());
      }
      return { kind: 'done' };
    } catch (e) {
      this.foyer.toast((e as Error).message || 'L’enregistrement a échoué.');
      return { kind: 'invalid' };
    }
  }
}
