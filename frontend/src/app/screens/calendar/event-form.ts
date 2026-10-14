import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { RECUR_LABELS } from '../../core/constants';
import { addHourHHMM, cap, dstr, mondayOf, monthIndex, monthStart, parseDay } from '../../core/helpers';
import { EventItem, Recur } from '../../core/models';
import { EventFields, eventFields } from '../../core/event-scope';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/**
 * Le formulaire d'un événement, branché dans la fiche d'élément. Le brouillon
 * est l'état local du composant : il naît à l'ouverture de l'édition et meurt
 * avec elle, rien ne traîne dans l'état d'interface du store.
 */
@Component({
  selector: 'app-event-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @if (occ()) {
      <div class="occ-note"><f-icon name="refresh" [size]="13" color="#7A9B76" [width]="2.4" /> Occurrence du {{ store.fmtNumDate(occ()) }} · {{ recurLabel(item()?.recur || 'none') }}</div>
    }
    <div class="fl">Titre</div>
    <input class="input" [ngModel]="f().title" (ngModelChange)="set({ title: $event })"
           placeholder="Ex : Rendez-vous dentiste" style="margin-bottom:18px" />

    <div class="fl">Date</div>
    <!-- Le mini-calendrier prend beaucoup de place : on ne le déplie que
         lorsqu'il n'y a pas de date déjà choisie (création globale). Sinon
         (modification, ou création sur un jour précis), une ligne compacte
         affiche la date et « Changer » déplie le calendrier à la demande. -->
    @if (calOpen()) {
      <div class="dp">
        <div class="dp-head">
          <button type="button" class="dp-nav" (click)="dpMonth.set(dpMonth() - 1)" aria-label="Mois précédent"><f-icon name="chevronLeft" [size]="15" color="var(--ink2)" [width]="2.4" /></button>
          <div class="dp-label f-display">{{ dpLabel() }}</div>
          <button type="button" class="dp-nav" (click)="dpMonth.set(dpMonth() + 1)" aria-label="Mois suivant"><f-icon name="chevronRight" [size]="15" color="var(--ink2)" [width]="2.4" /></button>
        </div>
        <div class="dp-dow"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
        <div class="dp-grid">
          @for (c of dpCells(); track c.key) {
            <div class="dp-cell" [class.sel]="c.sel" [class.between]="c.between" [class.ring]="c.isToday && !c.sel"
                 [style.opacity]="c.inMonth ? 1 : 0.35" (click)="dpPick(c.key)">{{ c.num }}</div>
          }
        </div>
      </div>
      <div class="dp-summary"><f-icon name="calendar" [size]="15" color="#E56B4E" [width]="2" /> <span>{{ dpSummary() }}</span></div>
    } @else {
      <button type="button" class="date-compact" (click)="calOpen.set(true)">
        <f-icon name="calendar" [size]="16" color="#E56B4E" [width]="2" />
        <span class="dc-label">{{ dpSummary() }}</span>
        <span class="dc-change">Changer</span>
      </button>
    }

    <label class="allday" (click)="set({ allDay: !f().allDay })">
      <span class="box" [class.on]="f().allDay">@if (f().allDay) { <f-icon name="check" [size]="13" color="#fff" [width]="3.2" /> }</span>
      <span>Journée entière</span>
    </label>
    @if (!f().allDay) {
      <div class="ev-times">
        <div>
          <div class="fl">Heure de début</div>
          <input class="input" type="time" [ngModel]="f().time" (ngModelChange)="setStart($event)" />
        </div>
        <div>
          <div class="fl">Heure de fin (option.)</div>
          <input class="input" type="time" [ngModel]="f().endTime" (ngModelChange)="set({ endTime: $event })" [disabled]="!f().time" />
        </div>
      </div>
    }

    <div class="fl">Lieu (option.)</div>
    <div class="place-field">
      <input class="input" [ngModel]="f().place" (ngModelChange)="onPlaceInput($event)"
             (focus)="placeFocused.set(true)" (blur)="onPlaceBlur()" autocomplete="off"
             placeholder="Ex : Salle des fêtes, 12 rue des Lilas" />
      @if (placeFocused() && placeSug().length) {
        <div class="place-sug">
          @for (s of placeSug(); track s) {
            <button type="button" class="place-opt" (mousedown)="pickPlace(s)">
              <f-icon name="pin" [size]="14" color="var(--ink3)" [width]="2" /> <span>{{ s }}</span>
            </button>
          }
        </div>
      }
    </div>

    <!-- Participants « Tous » par défaut : un événement du foyer concerne le
         plus souvent tout le monde. La liste vide vaut « Tous » ; cocher des
         membres restreint. Le cercle de tête bascule sur « Tous », les
         autres sur chaque membre. -->
    <div class="fl">Participants : <span class="p-val">{{ whoSummary() }}</span></div>
    <div class="participants">
      <button type="button" class="pc pc-all" [class.on]="!f().who.length"
              (click)="set({ who: [] })" title="Tous" aria-label="Tous">
        <span class="pc-face all"><f-icon name="users" [size]="21" color="#fff" [width]="2" /></span>
        @if (!f().who.length) { <span class="pc-tick"><f-icon name="check" [size]="11" color="#fff" [width]="3.6" /></span> }
      </button>
      <span class="p-sep"></span>
      @for (m of store.d().members; track m.id) {
        <button type="button" class="pc" [class.on]="f().who.includes(m.id)"
                (click)="toggleWho(m.id)" [title]="m.name" [attr.aria-label]="m.name">
          <span class="pc-face" [style.background]="m.color">{{ m.ini }}</span>
          @if (f().who.includes(m.id)) { <span class="pc-tick"><f-icon name="check" [size]="11" color="#fff" [width]="3.6" /></span> }
        </button>
      }
    </div>

    <div class="fl">Récurrence</div>
    <div class="seg-recur">
      @for (r of recurOpts; track r) {
        <button type="button" [class.active]="f().recur === r" (click)="set({ recur: r })">{{ recurLabel(r) }}</button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .occ-note { display: flex; align-items: center; gap: 6px; margin: 0 0 16px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .fl { font-size: 12px; font-weight: 800; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
    .allday { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; cursor: pointer; font-size: 14px; font-weight: 800; color: var(--ink); }
    .allday .box { width: 20px; height: 20px; flex: none; border-radius: 6px; background: var(--surface); box-shadow: inset 0 0 0 2px var(--line); display: flex; align-items: center; justify-content: center; }
    .allday .box.on { background: var(--primary); box-shadow: none; }
    .ev-times { display: flex; gap: 12px; margin-bottom: 18px; }
    .ev-times > div { flex: 1; min-width: 0; }
    .ev-times .input { width: 100%; min-width: 0; box-sizing: border-box; }
    /* Sur téléphone, les deux champs d'heure passent l'un sous l'autre. Le champ
       « time » natif d'iOS a une largeur minimale qui déborde une demi-colonne
       (les deux se chevauchaient) ; empilés, chacun prend toute la largeur. */
    @media (max-width: 560px) { .ev-times { flex-direction: column; gap: 14px; } }
    .dp { background: var(--soft); border: 2px solid var(--line); border-radius: 16px; padding: 14px; margin-bottom: 8px; }
    .dp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .dp-nav { width: 30px; height: 30px; border: none; border-radius: 9px; background: var(--surface); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .dp-label { font-size: 15px; font-weight: 700; color: var(--ink); text-transform: capitalize; }
    .dp-dow { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px; margin-bottom: 4px; }
    .dp-dow span { text-align: center; font-size: 10px; font-weight: 800; color: var(--ink3); }
    .dp-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px; }
    .dp-cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; border-radius: 9px; cursor: pointer; font-size: 13px; font-weight: 700; color: var(--ink); }
    .dp-cell.between { background: rgba(229,107,78,.14); }
    .dp-cell.sel { background: var(--primary); color: #fff; font-weight: 800; }
    .dp-cell.ring { box-shadow: inset 0 0 0 2px var(--honey); }
    .dp-summary { display: flex; align-items: center; gap: 8px; margin: 8px 0 20px; }
    .dp-summary span { font-size: 13px; font-weight: 800; color: var(--ink); }
    /* Ligne compacte de date : la date choisie, et « Changer » pour déplier le calendrier. */
    .date-compact { display: flex; align-items: center; gap: 10px; width: 100%; padding: 13px 15px; margin-bottom: 20px; border: 2px solid var(--line); border-radius: 14px; background: var(--soft); cursor: pointer; font: inherit; text-align: left; }
    .date-compact .dc-label { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .date-compact .dc-change { font-size: 13px; font-weight: 800; color: #E56B4E; }
    .date-compact:hover { border-color: var(--line2); }
    .p-val { color: var(--primary); font-weight: 800; }
    .participants { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
    .p-sep { width: 1px; align-self: stretch; min-height: 40px; background: var(--line); }
    .pc { position: relative; padding: 0; border: none; background: none; cursor: pointer; line-height: 0; }
    .pc-face { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px;
               border-radius: 999px; color: #fff; font-size: 15px; font-weight: 800; transition: opacity .12s; }
    .pc-face.all { background: linear-gradient(135deg, #E56B4E, #D9553A); }
    .pc:not(.on) .pc-face { opacity: .4; }
    .pc-tick { position: absolute; top: -1px; right: -1px; width: 18px; height: 18px; border-radius: 999px;
               background: var(--primary); border: 2px solid var(--surface); display: inline-flex; align-items: center; justify-content: center; }
    .seg-recur { display: flex; flex-wrap: wrap; gap: 8px; }
    .seg-recur button { border: none; padding: 9px 14px; border-radius: 11px; font-size: 13px; font-weight: 800; cursor: pointer; background: var(--soft); color: var(--ink2); }
    .seg-recur button.active { background: var(--primary); color: #fff; }
    .place-field { position: relative; margin-bottom: 18px; }
    .place-sug { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); background: var(--surface);
                 border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,.12);
                 overflow: hidden; max-height: 240px; overflow-y: auto; }
    .place-opt { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: none;
                 background: none; padding: 10px 13px; font-size: 13.5px; font-weight: 600; color: var(--ink);
                 cursor: pointer; }
    .place-opt + .place-opt { border-top: 1px solid var(--line); }
    .place-opt:hover { background: var(--soft); }
    .place-opt span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `],
})
export class EventForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  /** L'événement modifié, ou null à la création. */
  readonly item = input<EventItem | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);

  readonly recurOpts: Recur[] = ['none', 'daily', 'weekday', 'weekly', 'biweekly', 'monthly'];
  readonly f = signal<EventFields>(eventFields(null, '', ''));
  private initial = '';
  /** L'occurrence ouverte, quand c'est une série. */
  readonly occ = computed(() => { const ev = this.item(), o = this.ctx()?.occ || ''; return ev && o && (ev.recur || 'none') !== 'none' ? o : ''; });
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);

  // Sélecteur de date : mois affiché (index absolu, l'année comprise), et le
  // prochain clic pose-t-il le début ou la fin de la plage.
  readonly dpMonth = signal(0);
  private readonly pickStart = signal(true);
  readonly calOpen = signal(false);

  ngOnInit(): void {
    const ev = this.item(), ctx = this.ctx();
    // Création sur un jour choisi (tap sur une case) : la date est connue, le
    // calendrier reste replié. Création globale (menu « + ») : il s'ouvre.
    const date = ctx?.date || this.store.ui().selDay;
    const f = eventFields(ev, ctx?.occ || '', date);
    this.f.set(f);
    this.initial = JSON.stringify(f);
    this.dpMonth.set(monthIndex(f.start));
    this.calOpen.set(!ev && !ctx?.date);
  }

  submit(scope?: string): ItemResult {
    return this.store.saveEvent(this.f(), this.item()?.id ?? null, this.ctx()?.occ || '', scope);
  }

  set(p: Partial<EventFields>): void { this.f.update((f) => ({ ...f, ...p })); }
  toggleWho(id: string): void { const w = this.f().who; this.set({ who: w.includes(id) ? w.filter((x) => x !== id) : [...w, id] }); }

  /**
   * Heure de début. L'heure de fin suit d'une heure par défaut, pour n'avoir à
   * la préciser que lorsqu'elle diffère. On ne l'écrase pas si on l'a soi-même
   * fixée : elle suit tant qu'elle est vide ou encore égale à ce que l'ancienne
   * heure de début impliquait.
   */
  setStart(v: string): void {
    const f = this.f();
    const p: Partial<EventFields> = { time: v };
    if (v && (!f.endTime || f.endTime === addHourHHMM(f.time))) p.endTime = addHourHHMM(v);
    this.set(p);
  }

  dpPick(ds: string): void {
    const f = this.f();
    if (this.pickStart() || (f.start && f.end)) { this.set({ start: ds, end: '' }); this.pickStart.set(false); }
    else if (ds < f.start) this.set({ start: ds, end: '' });
    else if (ds === f.start) this.set({ end: '' });
    else this.set({ end: ds });
  }

  readonly dpLabel = computed(() => cap(monthStart(this.dpMonth()).toLocaleDateString(this.store.locale, { month: 'long', year: 'numeric' })));
  readonly dpSummary = computed(() => { const f = this.f(); return f.end ? `Du ${this.fmt(f.start)} au ${this.fmt(f.end)}` : `Le ${this.fmt(f.start)}`; });
  readonly dpCells = computed(() => {
    const f = this.f();
    const base = monthStart(this.dpMonth());
    const start = mondayOf(new Date(base));
    const bm = base.getMonth();
    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dstr(d);
      out.push({ key, num: d.getDate(), inMonth: d.getMonth() === bm, isToday: key === this.store.todayStr(),
        sel: key === f.start || (!!f.end && key === f.end), between: !!f.end && key > f.start && key < f.end });
    }
    return out;
  });
  private fmt(key: string): string { return parseDay(key).toLocaleDateString(this.store.locale, { weekday: 'short', day: 'numeric', month: 'long' }); }

  recurLabel(r: Recur): string { return r === 'none' ? 'Ponctuel' : RECUR_LABELS[r]; }

  /** Le résumé affiché en tête du sélecteur : « Tous » quand rien n'est coché, sinon les noms. */
  whoSummary(): string {
    const ids = this.f().who;
    if (!ids.length) return 'Tous';
    return this.store.d().members.filter((m) => ids.includes(m.id)).map((m) => m.name).join(', ') || 'Tous';
  }

  // ---- autocomplétion du lieu -------------------------------------------
  readonly placeSug = signal<string[]>([]);
  readonly placeFocused = signal(false);
  private placeTimer: ReturnType<typeof setTimeout> | null = null;

  /** La frappe met à jour le champ et, débattue, demande des suggestions. */
  onPlaceInput(v: string): void {
    this.set({ place: v });
    if (this.placeTimer) clearTimeout(this.placeTimer);
    if (v.trim().length < 3) { this.placeSug.set([]); return; }
    this.placeTimer = setTimeout(() => void this.loadPlaceSug(v.trim()), 250);
  }
  private async loadPlaceSug(q: string): Promise<void> {
    const sug = await this.store.placeSuggestions(q);
    // La frappe a pu continuer : on ne garde le résultat que s'il vaut encore pour ce que le champ contient.
    if (this.f().place.trim() === q) this.placeSug.set(sug);
  }
  /** Un lieu choisi remplit le champ et referme la liste. `mousedown` précède le blur. */
  pickPlace(s: string): void { this.set({ place: s }); this.placeSug.set([]); this.placeFocused.set(false); }
  /** Le blur ferme la liste, mais après le mousedown d'un choix éventuel. */
  onPlaceBlur(): void { setTimeout(() => { this.placeFocused.set(false); this.placeSug.set([]); }, 150); }
}
