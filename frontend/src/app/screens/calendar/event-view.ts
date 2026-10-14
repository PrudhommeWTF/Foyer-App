import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { AvatarComponent } from '../../shared/avatar';
import { StampComponent } from '../../shared/stamp';
import { cap, parseDay } from '../../core/helpers';
import { EventItem } from '../../core/models';
import { isSeries, recurText } from '../../core/event-scope';
import { ItemCtx } from '../../core/items';

/**
 * Plans sur les appareils Apple, Google Maps ailleurs : l'application de cartes
 * du téléphone s'ouvre sur l'adresse. Lue une fois, l'appareil ne change pas.
 */
const APPLE = typeof navigator !== 'undefined' && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
const mapsUrl = (place: string): string => APPLE
  ? 'https://maps.apple.com/?q=' + encodeURIComponent(place)
  : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place);

/** La fiche d'un événement, en lecture : quand, à quel rythme, où, avec qui, et par qui. */
@Component({
  selector: 'app-event-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent, StampComponent],
  template: `
    @let ev = item();
    <div class="row">
      <span class="ic"><f-icon name="calendar" [size]="18" color="#E56B4E" [width]="2.2" /></span>
      <div class="txt"><div class="main">{{ when() }}</div><div class="sub">{{ hours() }}</div></div>
    </div>
    @if (series()) {
      <div class="row">
        <span class="ic"><f-icon name="refresh" [size]="18" color="#7A9B76" [width]="2.2" /></span>
        <div class="txt"><div class="main">{{ recur() }}</div><div class="sub">{{ seriesSub() }}</div></div>
      </div>
    }
    @if (ev.place) {
      <a class="row link" [href]="maps()" target="_blank" rel="noopener">
        <span class="ic"><f-icon name="pin" [size]="18" color="#4E93B8" [width]="2.2" /></span>
        <div class="txt"><div class="main">{{ ev.place }}</div><div class="sub">Ouvrir dans {{ apple ? 'Plans' : 'Maps' }}</div></div>
        <f-icon name="chevronRight" [size]="16" color="var(--ink3)" [width]="2.4" />
      </a>
    }
    <div class="row">
      <span class="ic"><f-icon name="users" [size]="18" color="#9B6FA8" [width]="2.2" /></span>
      @if (people().length) {
        <div class="people">
          @for (p of people(); track p.id) {
            <span class="person"><f-avatar [ini]="p.ini" [color]="p.color" [size]="26" /> {{ p.name }}</span>
          }
        </div>
      } @else {
        <div class="txt"><div class="main">Tout le foyer</div></div>
      }
    </div>
    <f-stamp [createdBy]="store.memberName(ev.by || '')" [createdAt]="ev.at"
             [modifiedBy]="store.memberName(ev.upBy || '')" [modifiedAt]="ev.upAt" />
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 13px; padding: 11px 0; color: inherit; text-decoration: none; }
    .row + .row { border-top: 1px solid var(--line); }
    .ic { width: 36px; height: 36px; flex: none; border-radius: 11px; background: var(--soft); display: flex; align-items: center; justify-content: center; }
    .txt { flex: 1; min-width: 0; }
    .main { font-size: 15px; font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
    .sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .link { cursor: pointer; }
    .link .sub { color: #4E93B8; }
    .people { flex: 1; display: flex; flex-wrap: wrap; gap: 8px 14px; }
    .person { display: inline-flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 800; color: var(--ink); }
    f-stamp { display: block; margin-top: 10px; }
  `],
})
export class EventView {
  readonly store = inject(FoyerStore);
  readonly item = input.required<EventItem>();
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly apple = APPLE;

  readonly series = computed(() => isSeries(this.item()));
  /** L'occurrence ouverte d'une série, sinon le jour de l'événement. */
  private readonly day = computed(() => (this.series() && this.ctx()?.occ) || this.item().date);
  private long(iso: string): string { return cap(parseDay(iso).toLocaleDateString(this.store.locale, { weekday: 'long', day: 'numeric', month: 'long', year: parseDay(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })); }
  readonly when = computed(() => {
    const ev = this.item();
    if (!this.series() && ev.end && ev.end !== ev.date) return `Du ${this.long(ev.date).toLowerCase()} au ${this.long(ev.end).toLowerCase()}`;
    return this.long(this.day());
  });
  readonly hours = computed(() => {
    const ev = this.item();
    if (ev.allDay || !ev.time || ev.time === '—') return 'Journée entière';
    return ev.endTime ? `${ev.time} - ${ev.endTime}` : `À ${ev.time}`;
  });
  readonly recur = computed(() => recurText(this.item()));
  readonly seriesSub = computed(() => {
    const ev = this.item();
    const n = (ev.skip || []).length;
    return `Depuis le ${this.store.fmtNumDate(ev.date)}` + (n ? `, sauf ${n} date${n > 1 ? 's' : ''}` : '');
  });
  readonly maps = computed(() => mapsUrl(this.item().place || ''));
  readonly people = computed(() => {
    const members = this.store.d().members;
    return this.item().who.map((id) => members.find((m) => m.id === id)).filter((m) => !!m)
      .map((m) => ({ id: m.id, name: m.name, ini: m.ini, color: this.store.memberColor(m.id) }));
  });
}
