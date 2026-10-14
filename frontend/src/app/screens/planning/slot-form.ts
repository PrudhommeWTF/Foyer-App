import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { SCHED_AWAY_DEFAULT, SCHED_COLORS, SCHED_TYPES } from '../../core/constants';
import { SchedSlot, SchedType } from '../../core/models';
import { dowLabel } from '../../core/schedule';
import { SlotFields, mondayOf, periodShown, slotFields, slotOf } from '../../core/slot-form';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/**
 * Le formulaire d'un créneau dans la fiche : rythme, jour, qui, heures,
 * intitulé, type, et les deux cases qui changent quelque chose ailleurs (les
 * couverts, l'agenda partagé). Le brouillon vit ici : rien n'est écrit avant
 * « Sauvegarder », et la portée d'une série se demande à ce moment-là.
 */
@Component({
  selector: 'app-slot-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent],
  template: `
    @let v = f();
    @if (occNote(); as n) { <div class="occ-note"><f-icon name="refresh" [size]="14" color="var(--ink2)" [width]="2.2" /> {{ n }}</div> }

    <div class="seg wrap">
      <button type="button" [class.active]="v.rec === 'weekly' && v.every === 1" (click)="setEvery(1)">Toutes les semaines</button>
      <button type="button" [class.active]="v.rec === 'weekly' && v.every === 2" (click)="setEvery(2)">Toutes les 2 semaines</button>
      <button type="button" [class.active]="v.rec === 'once'" (click)="set({ rec: 'once' })">Une seule fois</button>
    </div>
    @if (v.rec === 'weekly' && v.every === 2) {
      <div class="hint">Une semaine sur deux, à partir du {{ store.fmtNumDate(v.from || monday()) }} (le point de départ se règle plus bas).</div>
    }

    @if (v.rec === 'once') {
      <div class="field-label">Date</div>
      <input class="input" type="date" [ngModel]="v.date" (ngModelChange)="set({ date: $event })" />
    } @else {
      <div class="field-label">Jour</div>
      <div class="seg wrap">
        @for (n of days; track n) {
          <button type="button" [class.active]="v.dow === n" (click)="set({ dow: n })">{{ label(n) }}</button>
        }
      </div>
    }

    <div class="field-label">Qui</div>
    <div class="who-opts">
      @for (m of store.d().members; track m.id) {
        @let on = v.who.includes(m.id);
        <button type="button" class="who-opt" [class.on]="on" [style.border-color]="on ? m.color : 'transparent'" (click)="toggleWho(m.id)">
          <f-avatar [ini]="m.ini" [color]="m.color" [size]="24" />
          <span>{{ m.name }}</span>
        </button>
      }
    </div>

    <div class="form-row">
      <div class="field">
        <div class="field-label">Début</div>
        <input class="input" type="time" [ngModel]="v.start" (ngModelChange)="set({ start: $event })" />
      </div>
      <div class="field">
        <div class="field-label">Fin (option.)</div>
        <input class="input" type="time" [ngModel]="v.end" (ngModelChange)="set({ end: $event })" />
      </div>
    </div>

    <div class="field-label">Intitulé</div>
    <!-- Ce qu'on a déjà écrit fait office de modèles : « École », « Car »,
         « Cabinet » reviennent tous les jours, et une bibliothèque de
         modèles serait une seconde chose à tenir à jour. -->
    <input class="input" list="sched-labels" [ngModel]="v.label" (ngModelChange)="set({ label: $event })" placeholder="Ex : Cours de piano" />
    <datalist id="sched-labels">
      @for (l of store.labelSuggestions(); track l) { <option [value]="l"></option> }
    </datalist>

    <div class="field-label">Type</div>
    <div class="type-opts">
      @for (t of types; track t.k) {
        <button type="button" class="type-opt" [class.on]="v.type === t.k" [style.border-color]="v.type === t.k ? t.color : 'transparent'"
                [style.background]="tintOf(t.k)" [style.color]="t.color" (click)="setType(t.k)">
          <span class="dot" [style.background]="t.color"></span>{{ t.label }}
        </button>
      }
    </div>

    <!-- C'est cette case, et elle seule, qui décide des couverts. Le type ne
         fait que la pré-cocher : le télétravail et le sport à la maison existent. -->
    <button type="button" class="away-row" [class.on]="v.away" (click)="set({ away: !v.away })">
      <span class="box">@if (v.away) { <f-icon name="check" [size]="13" color="#fff" [width]="3" /> }</span>
      <span class="away-txt">
        <b>Hors du foyer</b>
        <span class="away-hint">Personne n’est attendu à table pendant ce créneau : les repas qu’il couvre comptent un couvert de moins.</span>
      </span>
    </button>

    <!-- Le créneau ressort dans le calendrier partagé, pour qui ne regarde que
         lui. Rien n'est recopié : ses occurrences sont dérivées du créneau. -->
    <button type="button" class="away-row" [class.on]="v.sync" (click)="set({ sync: !v.sync })">
      <span class="box">@if (v.sync) { <f-icon name="check" [size]="13" color="#fff" [width]="3" /> }</span>
      <span class="away-txt">
        <b>Publier à l’agenda</b>
        <span class="away-hint">{{ v.rec === 'once'
          ? 'Ce créneau apparaît dans le calendrier partagé à sa date.'
          : 'Toutes les occurrences de ce créneau apparaissent dans le calendrier partagé.' }}</span>
      </span>
    </button>

    <!-- Les réglages de période sont repliés : ils ne servent pas à la saisie
         courante, et le formulaire ne doit demander que le nécessaire. -->
    @if (v.rec === 'weekly') {
      @if (more()) {
        <div class="form-row">
          <div class="field">
            <div class="field-label">À partir du (option.)</div>
            <input class="input" type="date" [ngModel]="v.from" (ngModelChange)="set({ from: $event })" />
          </div>
          <div class="field">
            <div class="field-label">Jusqu’au (option.)</div>
            <input class="input" type="date" [ngModel]="v.until" (ngModelChange)="set({ until: $event })" />
          </div>
        </div>
        <div class="field-label">Seulement</div>
        <div class="seg wrap">
          <button type="button" [class.active]="v.when === 'always'" (click)="set({ when: 'always' })">Toute l’année</button>
          <button type="button" [class.active]="v.when === 'school'" (click)="set({ when: 'school' })">En période scolaire</button>
          <button type="button" [class.active]="v.when === 'holidays'" (click)="set({ when: 'holidays' })">Pendant les vacances</button>
        </div>
      } @else {
        <button type="button" class="more" (click)="more.set(true)">
          <f-icon name="calendar" [size]="14" color="var(--ink2)" [width]="2.2" /> Période de validité et vacances
        </button>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .occ-note { display: flex; align-items: center; gap: 6px; margin: 0 0 14px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .hint { font-size: 12px; font-weight: 700; color: var(--ink2); margin: 8px 0 16px; line-height: 1.35; }
    .more { display: inline-flex; align-items: center; gap: 6px; margin: 12px 0 4px; padding: 8px 13px; border: none; border-radius: 11px; background: var(--soft2); color: var(--ink2); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .seg.wrap { flex-wrap: wrap; margin-bottom: 6px; }
    .form-row { display: flex; gap: 12px; margin-bottom: 4px; }
    .field { flex: 1; min-width: 0; }
    .field .input { width: 100%; min-width: 0; box-sizing: border-box; }
    /* Le champ « time » natif d'iOS déborde une demi-colonne : empilés sur téléphone. */
    @media (max-width: 560px) { .form-row { flex-direction: column; gap: 0; } }
    .field-label { margin-top: 4px; }
    .input { margin-bottom: 4px; }
    .who-opts { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 8px; }
    .who-opt { display: flex; align-items: center; gap: 8px; padding: 7px 14px 7px 7px; border-radius: 13px; background: var(--soft); color: var(--ink); font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; border: 2px solid transparent; }
    .who-opt.on { background: var(--soft2); }
    .type-opts { display: flex; flex-wrap: wrap; gap: 9px; margin-bottom: 12px; }
    .type-opt { display: flex; align-items: center; gap: 7px; padding: 9px 14px; border-radius: 11px; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; border: 2px solid transparent; }
    .type-opt .dot { width: 9px; height: 9px; border-radius: 3px; }
    .away-row { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 11px 13px; border: none; border-radius: 13px; background: var(--soft); font: inherit; text-align: left; cursor: pointer; margin-bottom: 6px; }
    .away-row.on { background: color-mix(in srgb, var(--primary) 10%, var(--surface)); }
    .away-row .box { flex: none; width: 19px; height: 19px; border-radius: 6px; background: var(--surface); box-shadow: inset 0 0 0 2px var(--soft2); display: inline-flex; align-items: center; justify-content: center; margin-top: 1px; }
    .away-row.on .box { background: var(--primary); box-shadow: none; }
    .away-txt { display: flex; flex-direction: column; gap: 3px; font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .away-hint { font-size: 11.5px; font-weight: 700; color: var(--ink2); line-height: 1.35; }
  `],
})
export class SlotForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  /** Le créneau modifié, ou null à la création (`ctx.date`, `ctx.time`, ou `ctx.copy` pour dupliquer). */
  readonly item = input<SchedSlot | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);

  readonly days = [1, 2, 3, 4, 5, 6, 7];
  readonly types = SCHED_TYPES;
  readonly f = signal<SlotFields>(slotFields(null, '', { date: '', who: [], start: '' }));
  readonly more = signal(false);
  private initial = '';

  /** La date de l'occurrence ouverte, ou le jour choisi pour une création. */
  private readonly occ = computed(() => this.ctx()?.occ || this.ctx()?.date || this.store.todayStr());
  readonly monday = computed(() => mondayOf(this.occ()));
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);
  /** Sur une série, dire quelle occurrence on a ouverte : la portée se demandera à l'enregistrement. */
  readonly occNote = computed(() => {
    const s = this.item(), o = this.ctx()?.occ;
    return s?.rec === 'weekly' && o ? 'Ouvert sur le ' + this.store.fmtNumDate(o) : '';
  });

  ngOnInit(): void {
    const s = this.item(), c = this.ctx();
    const date = c?.date || c?.occ || this.store.todayStr();
    // Dupliquer : un créneau neuf, pré-rempli de l'original, sans ses exceptions.
    const src = !s && c?.copy ? this.store.schedAll().find((x) => x.id === c.copy) ?? null : null;
    const f = slotFields(s ?? src, this.occ(), this.store.slotDefaults(date, c?.time || ''));
    this.f.set(f);
    this.initial = JSON.stringify(f);
    this.more.set(periodShown(f, this.store.todayStr()));
  }

  submit(scope?: string): ItemResult {
    const forme = slotOf(this.f(), this.occ());
    if (typeof forme === 'string') { this.store.toast(forme); return { kind: 'invalid' }; }
    return this.store.saveSlot(this.item()?.id ?? null, forme, this.occ(), scope);
  }

  set(p: Partial<SlotFields>): void { this.f.update((f) => ({ ...f, ...p })); }
  toggleWho(id: string): void { const w = this.f().who; this.set({ who: w.includes(id) ? w.filter((x) => x !== id) : [...w, id] }); }
  /** Le type pré-coche « Hors du foyer » : l'école oui, la maison non. La case reste maîtresse. */
  setType(k: SchedType): void { this.set({ type: k, away: !!SCHED_AWAY_DEFAULT[k] }); }
  /** Une semaine sur deux a besoin d'un point de départ : on le montre, et on déplie la période. */
  setEvery(n: number): void {
    this.set({ rec: 'weekly', every: n, ...(n > 1 && !this.f().from ? { from: this.monday() } : {}) });
    if (n > 1) this.more.set(true);
  }

  label(n: number): string { return dowLabel(n); }
  tintOf(k: string): string { return `color-mix(in srgb, ${SCHED_COLORS[k] || 'var(--ink3)'} 14%, var(--surface))`; }
}
