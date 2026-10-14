import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { SCHED_COLORS, SCHED_TYPES } from '../../core/constants';
import { cap, parseDay } from '../../core/helpers';
import { SchedSlot } from '../../core/models';
import { WHEN_LABELS, dowLabel, validityLabel } from '../../core/schedule';
import { isEdSlot } from '../../core/ecole-slots';
import { ItemCtx } from '../../core/items';

/** La fiche d'un créneau, en lecture : quand, à quel rythme, pour qui, et ce qu'il change aux repas et à l'agenda. */
@Component({
  selector: 'app-slot-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent],
  template: `
    @let s = item();
    <div class="row">
      <span class="ic"><f-icon name="calendar" [size]="18" color="#4E93B8" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ when() }}</div><div class="sub">{{ hours() }}</div></div>
    </div>
    @if (s.rec === 'weekly') {
      <div class="row">
        <span class="ic"><f-icon name="refresh" [size]="18" color="#7A9B76" [width]="2.2" /></span>
        <div class="txt"><div class="main">{{ rhythm() }}</div>@if (period()) { <div class="sub">{{ period() }}</div> }</div>
      </div>
    }
    <div class="row">
      <span class="ic"><f-icon name="users" [size]="18" color="#9B6FA8" [width]="2.2" /></span>
      @if (people().length) {
        <div class="people">
          @for (p of people(); track p.id) { <span class="person"><f-avatar [ini]="p.ini" [color]="p.color" [size]="26" /> {{ p.name }}</span> }
        </div>
      } @else {
        <div class="txt"><div class="main muted">Personne : à attribuer</div></div>
      }
    </div>
    <div class="row">
      <span class="ic"><span class="dot" [style.background]="color()"></span></span>
      <div class="txt"><div class="main">{{ type() }}</div>
        @if (ed()) { <div class="sub"><span class="ed-tag">ÉcoleDirecte</span> importé, se modifie dans ÉcoleDirecte</div> }
        @else if (s.srcId) { <div class="sub">Modifié pour ce jour seulement</div> }</div>
    </div>
    @if (s.away || s.sync) {
      <div class="flags">
        @if (s.away) { <div class="flag"><f-icon name="home" [size]="14" color="var(--ink2)" [width]="2.2" /> Hors du foyer : un couvert de moins aux repas qu'il couvre</div> }
        @if (s.sync) { <div class="flag"><f-icon name="calendar" [size]="14" color="var(--ink2)" [width]="2.2" /> Publié à l'agenda partagé</div> }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; }
    .row + .row { border-top: 1px solid var(--line); }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .dot { width: 12px; height: 12px; border-radius: 4px; }
    .txt { flex: 1; min-width: 0; }
    .main { font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .main.muted { color: var(--ink3); }
    .sub { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .people { flex: 1; display: flex; flex-wrap: wrap; gap: 8px 14px; }
    .person { display: inline-flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 800; color: var(--ink); }
    .ed-tag { font-size: 10.5px; font-weight: 800; color: #4E93B8; background: #E5F0F4; border-radius: 6px; padding: 2px 6px; }
    .flags { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
    .flag { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border-radius: 12px; background: var(--soft); font-size: 12.5px; font-weight: 700; color: var(--ink2); }
  `],
})
export class SlotView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<SchedSlot>();
  readonly ctx = input<ItemCtx | undefined>(undefined);

  readonly ed = computed(() => isEdSlot(this.item().id));
  private long(iso: string): string { return cap(parseDay(iso).toLocaleDateString(this.store.locale, { weekday: 'long', day: 'numeric', month: 'long' })); }
  /** Un ponctuel : sa date. Une série : l'occurrence touchée, ou son jour de la semaine. */
  readonly when = computed(() => {
    const s = this.item(), occ = this.ctx()?.occ;
    if (s.rec === 'once') return s.date ? this.long(s.date) : '';
    return occ ? this.long(occ) : dowLabel(s.dow);
  });
  readonly hours = computed(() => { const s = this.item(); return s.end ? `${s.start} - ${s.end}` : `À ${s.start}`; });
  readonly rhythm = computed(() => {
    const s = this.item(), jour = dowLabel(s.dow).toLowerCase();
    return s.interval && s.interval > 1 ? `Un ${jour} sur ${s.interval}` : `Tous les ${jour}s`;
  });
  readonly period = computed(() => {
    const s = this.item(), n = (s.skip || []).length;
    return [validityLabel(s, (iso) => this.store.fmtNumDate(iso)), WHEN_LABELS[s.when || 'always'], n ? `sauf ${n} date${n > 1 ? 's' : ''}` : '']
      .filter(Boolean).join(' · ');
  });
  readonly type = computed(() => SCHED_TYPES.find((t) => t.k === this.item().k)?.label || 'Autre');
  readonly color = computed(() => SCHED_COLORS[this.item().k] || 'var(--ink3)');
  readonly people = computed(() => {
    const members = this.store.d().members;
    return (this.item().who || []).map((id) => members.find((m) => m.id === id)).filter((m) => !!m)
      .map((m) => ({ id: m.id, name: m.name, ini: m.ini, color: this.store.memberColor(m.id) }));
  });
}
