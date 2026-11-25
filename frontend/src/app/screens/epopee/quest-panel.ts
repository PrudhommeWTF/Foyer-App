import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { CATEGORY_LABEL, Kid, Quest, Reward, currentQuest, dailyEcus, longDay, missing, reachLine } from '../../core/epopee/epopee';
import { fanfare } from '../../core/epopee/sound';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { sessionUuid } from '../../core/revisions/revisions';

/** Beyond this price, a belt of coin slots no longer reads at a glance: the bar takes over. */
const BELT_MAX = 40;

/**
 * L'Armurerie d'un enfant : choisir un trésor, sceller le pacte (un parent),
 * voir la quête avancer, échanger ses écus, puis garder le souvenir du moment
 * vécu. Une seule quête à la fois. Les prix et les soldes viennent du serveur.
 */
@Component({
  selector: 'epopee-quest-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @let k = kid();
    @let bal = k.balance ?? 0;
    <div class="quest-panel">
      @if (quest(); as q) {
        @if (q.status === 'active') {
          <div class="quest">
            <div class="q-head"><f-icon name="bouclier" [size]="20" color="#7D5400" [width]="2.2" /><span>{{ child() ? 'Ma quête' : 'La quête de ' + k.name }}</span></div>
            <h3>{{ q.title }}</h3>
            @if (belt(q)) {
              <div class="belt" role="img" [attr.aria-label]="bal + ' écus sur ' + q.cost">@for (on of slots(q, bal); track $index) { <span [class.on]="on"></span> }</div>
            } @else {
              <div class="meter" role="img" [attr.aria-label]="bal + ' écus sur ' + q.cost"><div class="fill" [style.width.%]="pct(q, bal)"></div><div class="mark" [style.left.%]="floorPct(q)" title="Les écus d’amorce"></div></div>
              <div class="count"><b>{{ shown(q, bal) }}</b> / {{ q.cost }} écus</div>
            }
            <p class="reach">{{ line(q, bal) }}</p>
            @if (q.pact; as p) {
              @if (p.date || p.items || p.rule) {
                <ul class="pact">
                  @if (p.date) { <li><b>Quand :</b> {{ day(p.date) }}</li> }
                  @if (p.items) { <li><b>À préparer :</b> {{ p.items }}</li> }
                  @if (p.rule) { <li><b>Notre règle :</b> {{ p.rule }}</li> }
                </ul>
              }
              @if (p.note) { <p class="word">« {{ p.note }} »@if (p.by) { <span>{{ p.by }}</span> }</p> }
            }
            @if (!left(q, bal)) { <button class="btn btn-primary go" [disabled]="busy()" (click)="echanger(q)">{{ child() ? 'Échanger mes écus contre mon trésor' : 'Échanger les écus de ' + k.name }}</button> }
            @if (!child()) { <button class="link" [disabled]="busy()" (click)="abandonner(q)">Abandonner cette quête</button> }
          </div>
        } @else if (child()) {
          <div class="quest wait">
            <div class="q-head"><f-icon name="clock" [size]="20" color="#7D5400" [width]="2.2" /><span>Trésor choisi</span></div>
            <h3>{{ q.title }}</h3>
            <p class="reach">Papa ou maman va préparer le pacte avec toi. Tes écus ne bougent pas.</p>
            <button class="btn btn-soft" [disabled]="busy()" (click)="abandonner(q)">Finalement, garder mes écus pour plus tard</button>
          </div>
        } @else {
          <div class="quest wait">
            <div class="q-head"><f-icon name="bouclier" [size]="20" color="#7D5400" [width]="2.2" /><span>{{ k.name }} vise un trésor</span></div>
            <h3>{{ q.title }} <small>{{ q.cost }} écus</small></h3>
            <p class="reach">{{ line(q, bal) }}. Sceller le pacte, c’est vous engager sur le moment : dites quand, avec quoi, et à quelle condition.</p>
            <div class="form">
              <label><span class="field-label">Quand (si vous le savez)</span><input class="input" type="date" [value]="pactDate()" (input)="pactDate.set($any($event.target).value)" /></label>
              <label><span class="field-label">À préparer</span><input class="input" maxlength="200" placeholder="La tente, les lampes torches" [value]="pactItems()" (input)="pactItems.set($any($event.target).value)" /></label>
              <label><span class="field-label">Notre règle</span><input class="input" maxlength="200" placeholder="Sans écran, extinction à 21 h 30" [value]="pactRule()" (input)="pactRule.set($any($event.target).value)" /></label>
              <label><span class="field-label">Un mot d’encouragement</span><input class="input" maxlength="200" placeholder="Ce que vous voulez lui dire" [value]="pactNote()" (input)="pactNote.set($any($event.target).value)" /></label>
            </div>
            <div class="row">
              <button class="btn btn-primary" [disabled]="busy()" (click)="sceller(q)">Sceller le pacte</button>
              <button class="btn btn-soft" [disabled]="busy()" (click)="abandonner(q)">Pas celui-ci</button>
            </div>
          </div>
        }
      } @else if (rewards().length) {
        <div class="armory">
          <div class="field-label">{{ child() ? 'L’Armurerie : choisis ton prochain trésor' : 'Choisir un trésor pour ' + k.name }}</div>
          @for (r of rewards(); track r.id) {
            <div class="reward" [class.near]="!gap(r.cost, bal)">
              <div class="what">
                <div class="t">{{ r.title }} <span class="cat">{{ cat(r) }}</span></div>
                @if (r.description) { <div class="d">{{ r.description }}</div> }
                <div class="s">{{ r.cost }} écus. {{ lineFor(r.cost, bal) }}</div>
              </div>
              <button class="btn btn-soft" [disabled]="busy()" (click)="choisir(r)">{{ child() ? 'Je le vise' : 'Choisir' }}</button>
            </div>
          }
        </div>
      }

      @for (t of tickets(); track t.id) {
        <div class="quest ticket">
          <div class="q-head"><f-icon name="check" [size]="20" color="#476645" [width]="2.6" /><span>Trésor gagné</span></div>
          <h3>{{ t.title }}</h3>
          @if (child()) {
            <p class="reach">Tu l’as gagné. Il reste à le vivre ensemble@if (t.pact?.date; as d) { , {{ day(d) }} }.</p>
          } @else {
            <p class="reach">{{ k.name }} a échangé ses écus. À vous de tenir le pacte@if (t.pact?.date; as d) { , prévu {{ day(d) }} }. Une fois le moment vécu, gardez-en le souvenir.</p>
            <div class="form">
              <label><span class="field-label">Son moment préféré</span><input class="input" maxlength="300" placeholder="Ce que {{ k.name }} en a dit" [value]="memChild()[t.id] || ''" (input)="setMem(memChild, t.id, $any($event.target).value)" /></label>
              <label><span class="field-label">Votre mot</span><textarea class="input" maxlength="600" placeholder="Ce que vous voulez qu’il relise plus tard" [value]="memParent()[t.id] || ''" (input)="setMem(memParent, t.id, $any($event.target).value)"></textarea></label>
            </div>
            <button class="btn btn-sage" [disabled]="busy()" (click)="vecu(t)">Marquer comme vécu</button>
          }
        </div>
      }

      @if (k.souvenirs?.length) {
        <details class="memories">
          <summary>{{ child() ? 'Mes souvenirs' : 'Souvenirs' }} ({{ k.souvenirs!.length }})</summary>
          @for (m of k.souvenirs; track m.id) {
            <div class="memory">
              <div class="t">{{ m.title }}</div>
              @if (m.honoredAt) { <div class="s">{{ day(m.honoredAt) }}</div> }
              @if (m.memory?.child) { <p class="said">« {{ m.memory!.child }} »</p> }
              @if (m.memory?.parent) { <p class="word">{{ m.memory!.parent }}@if (m.memory!.by) { <span>{{ m.memory!.by }}</span> }</p> }
            </div>
          }
        </details>
      }
    </div>
  `,
  styles: [`
    .quest-panel { margin-top: 20px; display: grid; gap: 12px; }
    .quest { padding: 18px; border-radius: 22px; background: #FDF0DA; }
    .quest.wait { background: var(--soft2); }
    .quest.ticket { background: #EDF2EB; }
    .q-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: #7D5400; }
    .ticket .q-head { color: #476645; }
    h3 { margin: 8px 0 12px; font-family: var(--font-display); font-size: 24px; font-weight: 800; line-height: 1.2; color: var(--ink); }
    h3 small { font-size: 15px; font-weight: 700; color: var(--ink2); margin-left: 6px; }
    .meter { position: relative; height: 16px; border-radius: 99px; background: #F0DFC0; overflow: hidden; }
    .fill { height: 100%; border-radius: 99px; background: linear-gradient(90deg, #F0B24B, #E56B4E); transition: width .7s ease-out; }
    .mark { position: absolute; top: 0; bottom: 0; width: 2px; background: #7D5400; opacity: .55; }
    .count { margin-top: 8px; font-size: 15px; font-weight: 700; color: var(--ink2); }
    .count b { font-family: var(--font-display); font-size: 26px; font-weight: 800; color: var(--ink); }
    .belt { display: flex; flex-wrap: wrap; gap: 8px; }
    .belt span { width: 34px; height: 34px; border-radius: 50%; background: #F5EEE2; box-shadow: inset 0 0 0 2px #EFE3D2; }
    .belt span.on { background: #F0B24B; box-shadow: 0 3px 0 #D99427; }
    .reach { margin: 10px 0 0; font-size: 15px; font-weight: 600; color: var(--ink2); line-height: 1.5; }
    .pact { margin: 14px 0 0; padding: 12px 14px; list-style: none; border-radius: 14px; background: var(--surface); font-size: 14.5px; font-weight: 600; color: var(--ink); display: grid; gap: 6px; }
    .word { margin: 14px 0 0; font-family: var(--font-script); font-size: 22px; line-height: 1.3; color: var(--ink); }
    .word span { display: block; font-family: var(--font-body); font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 2px; }
    .said { margin: 8px 0 0; font-size: 15px; font-weight: 700; color: var(--ink); }
    .go { width: 100%; min-height: 64px; margin-top: 16px; font-family: var(--font-display); font-size: 19px; border-radius: 18px; }
    .link { display: block; margin-top: 12px; border: none; background: none; cursor: pointer; min-height: 44px; padding: 0; font: 800 13px var(--font-body); color: var(--ink2); text-decoration: underline; text-underline-offset: 3px; }
    .form { display: grid; gap: 12px; margin: 16px 0; }
    .form .field-label { margin-bottom: 6px; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; }
    .quest .btn { min-height: 48px; }
    .wait > .btn { margin-top: 14px; }
    .armory { padding-top: 18px; border-top: 1px solid var(--line2); }
    .reward { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line2); }
    .reward .what { flex: 1; min-width: 0; }
    .reward .t { font-size: 15.5px; font-weight: 800; color: var(--ink); }
    .reward .d { font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin-top: 2px; }
    .reward .s { font-size: 13px; font-weight: 700; color: #7D5400; margin-top: 4px; }
    .reward .btn { min-height: 46px; flex: none; }
    .reward.near .btn { background: #FDF0DA; color: #7D5400; }
    .cat { margin-left: 6px; padding: 2px 8px; border-radius: 99px; background: var(--soft2); font-size: 11.5px; font-weight: 800; color: var(--ink2); white-space: nowrap; }
    .memories summary { cursor: pointer; font-size: 13px; font-weight: 800; color: var(--ink3); padding: 8px 0; }
    .memory { padding: 12px 0; border-top: 1px solid var(--line2); }
    .memory .t { font-size: 15px; font-weight: 800; color: var(--ink); }
    .memory .s { font-size: 12.5px; font-weight: 600; color: var(--ink3); }
    @media (prefers-reduced-motion: reduce) { .fill { transition: none; } }
  `],
})
export class QuestPanel {
  private readonly api = inject(ApiService);
  private readonly store = inject(FoyerStore);

  readonly kid = input.required<Kid>();
  readonly rewards = input.required<Reward[]>();
  /** True in a child's session: the words speak to the child, and only a child's gestures are offered. */
  readonly child = input(false);
  /** Something changed on the server: the screen reloads. */
  readonly changed = output<void>();

  readonly busy = signal(false);
  readonly pactDate = signal('');
  readonly pactItems = signal('');
  readonly pactRule = signal('');
  readonly pactNote = signal('');
  readonly memChild = signal<Record<string, string>>({});
  readonly memParent = signal<Record<string, string>>({});

  readonly quest = computed(() => currentQuest(this.kid().quetes || []));
  readonly tickets = computed(() => (this.kid().quetes || []).filter((q) => q.status === 'atteinte'));
  private readonly perDay = computed(() => dailyEcus(this.kid().routines || []));

  /** Coin slots rather than a bar: for a child shown coins without numbers, and a price that fits on the belt. */
  belt(q: Quest): boolean { return this.kid().display === 'pieces' && q.cost <= BELT_MAX; }
  slots(q: Quest, bal: number): boolean[] { return Array.from({ length: q.cost }, (_, i) => i < bal); }
  pct(q: Quest, bal: number): number { return Math.min(100, Math.round((bal / q.cost) * 100)); }
  floorPct(q: Quest): number { return Math.min(100, Math.round(((this.kid().floor ?? 0) / q.cost) * 100)); }
  shown(q: Quest, bal: number): number { return Math.min(bal, q.cost); }
  left(q: Quest, bal: number): number { return missing(q.cost, bal); }
  gap(cost: number, bal: number): number { return missing(cost, bal); }
  line(q: Quest, bal: number): string { return reachLine(q.cost, bal, this.perDay(), this.child()); }
  lineFor(cost: number, bal: number): string { return reachLine(cost, bal, this.perDay(), this.child()); }
  cat(r: Reward): string { return CATEGORY_LABEL[r.category]; }
  day(d: string): string { return longDay(d.slice(0, 10)); }
  setMem(target: typeof this.memChild, id: string, v: string): void { target.update((x) => ({ ...x, [id]: v })); }

  private async agir(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await fn(); this.changed.emit(); } catch (e) { this.store.toast((e as Error).message); } finally { this.busy.set(false); }
  }

  choisir(r: Reward): Promise<void> {
    return this.agir(async () => {
      await this.api.post(`epopee/membres/${this.kid().memberId}/quetes`, { id: sessionUuid(), rewardId: r.id });
      this.store.toast(this.child() ? 'C’est noté. Papa ou maman va préparer le pacte.' : `« ${r.title} » est choisi : il reste à sceller le pacte.`);
    });
  }
  sceller(q: Quest): Promise<void> {
    return this.agir(async () => {
      await this.api.post(`epopee/quetes/${q.id}/pacte`, { date: this.pactDate() || null, items: this.pactItems().trim(), rule: this.pactRule().trim(), note: this.pactNote().trim() });
      this.pactDate.set(''); this.pactItems.set(''); this.pactRule.set(''); this.pactNote.set('');
      this.store.toast('Le pacte est scellé.');
    });
  }
  abandonner(q: Quest): Promise<void> {
    if (!this.child() && q.status === 'active' && !confirm(`Abandonner la quête « ${q.title} » ? Les écus de ${this.kid().name} restent dans sa besace.`)) return Promise.resolve();
    return this.agir(async () => { await this.api.post(`epopee/quetes/${q.id}/abandon`); });
  }
  echanger(q: Quest): Promise<void> {
    return this.agir(async () => { await this.api.post(`epopee/quetes/${q.id}/echange`); fanfare(); this.store.toast(this.child() ? 'Trésor gagné !' : `Trésor gagné pour ${this.kid().name}.`); });
  }
  vecu(q: Quest): Promise<void> {
    return this.agir(async () => {
      await this.api.post(`epopee/quetes/${q.id}/vecu`, { child: (this.memChild()[q.id] || '').trim(), parent: (this.memParent()[q.id] || '').trim() });
      this.store.toast('Souvenir gardé.');
    });
  }
}
