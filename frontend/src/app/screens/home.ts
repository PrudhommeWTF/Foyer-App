import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { AvatarComponent } from '../shared/avatar';
import { TODAY } from '../core/constants';

@Component({
  selector: 'screen-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AvatarComponent],
  template: `
    <div class="screen-enter">
      <div class="screen-head">
        <div>
          <div class="hello f-script">Bonjour {{ d().profile.name }}</div>
          <div class="screen-sub">Jeudi 16 juillet · {{ today().length }} événements, {{ openTasks() }} tâches et le dîner vous attendent</div>
        </div>
        <button class="btn btn-sage" (click)="store.generateList()"><f-icon name="bolt" [size]="20" color="#fff" /> Courses rapides depuis les repas</button>
      </div>

      <div class="grid">
        <div class="card tall">
          <div class="ch"><div class="card-title">Aujourd'hui</div><span class="link" (click)="store.go('calendar')">Voir l'agenda</span></div>
          <div class="agenda">
            @for (e of today(); track e.id) {
              <div class="ev" [style.border-left]="'4px solid ' + store.memberColor(e.who)">
                <div class="ev-time f-display">{{ e.time }}</div>
                <div class="ev-body">
                  <div class="ev-title">{{ e.title }}</div>
                  <div class="ev-who"><f-avatar [ini]="store.memberIni(e.who)" [color]="store.memberColor(e.who)" [size]="18" /><span>{{ store.memberName(e.who) }}</span></div>
                </div>
              </div>
            } @empty { <div class="empty">Rien de prévu aujourd'hui 🎉</div> }
          </div>
        </div>

        <div class="card">
          <div class="ch"><div class="card-title sm">Tâches · {{ openTasks() }}</div><span class="link" (click)="store.go('taches')">Tout voir</span></div>
          <div class="tasks">
            @for (t of dashTasks(); track t.id) {
              <div class="task">
                <span class="tick" (click)="store.toggleTask(t.id)"></span>
                <span class="ttext">{{ t.text }}</span>
                <f-avatar [ini]="store.memberIni(t.who)" [color]="store.memberColor(t.who)" [size]="18" />
              </div>
            }
          </div>
        </div>

        <div class="card dinner">
          <div class="overline" style="color:rgba(255,255,255,.85)">Au dîner ce soir</div>
          <div class="dinner-name f-display">{{ dinner().name }}</div>
          <div class="dinner-meta">{{ dinner().meta }}</div>
          <button class="dinner-cta" (click)="store.go('repas')">Voir la recette</button>
        </div>

        <div class="card">
          <div class="ch"><div class="card-title sm">Budget juillet</div><span class="link" (click)="store.go('budget')">Détails</span></div>
          <div class="budget-amt f-display">{{ fmtInt(spent()) }} €<span class="budget-total"> / {{ fmtInt(total()) }} €</span></div>
          <div class="bar"><div class="bar-fill" [style.width.%]="barW()"></div></div>
          <div class="budget-left">Il reste {{ fmtInt(total() - spent()) }} € ce mois-ci</div>
        </div>

        <div class="card span2">
          <div class="ch"><div class="card-title sm">Courses · {{ shopDone() }}/{{ shopTotal() }}</div><span class="link" (click)="store.go('courses')">Ouvrir la liste</span></div>
          <div class="shop-grid">
            @for (it of dashShop(); track it.id) {
              <div class="shop-it" (click)="store.toggleShop(it.id)">
                <span class="tick" [class.on]="it.done">@if (it.done) { <f-icon name="check" [size]="11" color="#fff" [width]="3.6" /> }</span>
                <span class="shop-name" [class.done]="it.done">{{ it.name }}</span>
                <span class="shop-qty">{{ it.qty }}</span>
              </div>
            }
          </div>
        </div>

        <div class="card">
          <div class="ch"><div class="card-title sm">Messagerie</div><span class="link" (click)="store.go('messages')">Ouvrir</span></div>
          <div class="msgs">
            @for (m of dashMsgs(); track $index) {
              <div class="msg">
                <f-avatar [ini]="store.memberIni(m.who)" [color]="store.memberColor(m.who)" [size]="30" />
                <div><div class="msg-name">{{ store.memberName(m.who) }}</div><div class="msg-text">{{ m.text }}</div></div>
              </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .hello { font-size: 40px; color: var(--primary); line-height: .9; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; align-items: start; }
    .narrow-1 { grid-template-columns: 1fr; }
    :host-context(.shell.narrow) .grid { grid-template-columns: 1fr; }
    .card.tall { grid-row: span 2; }
    .card.span2 { grid-column: span 2; }
    :host-context(.shell.narrow) .card.span2 { grid-column: auto; }
    .ch { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .card-title.sm { font-size: 17px; }
    .link { font-size: 13px; font-weight: 800; color: var(--primary); cursor: pointer; }
    .agenda { display: flex; flex-direction: column; gap: 12px; }
    .ev { display: flex; gap: 14px; padding: 14px; border-radius: 16px; background: var(--soft); }
    .ev-time { font-size: 16px; font-weight: 700; color: var(--ink); min-width: 48px; }
    .ev-title { font-weight: 800; font-size: 15px; color: var(--ink); }
    .ev-who { display: flex; align-items: center; gap: 6px; margin-top: 5px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .empty { color: var(--ink2); font-weight: 700; font-size: 14px; padding: 20px 0; }
    .tasks { display: flex; flex-direction: column; gap: 10px; }
    .task { display: flex; align-items: center; gap: 11px; }
    .ttext { flex: 1; font-size: 13.5px; font-weight: 700; color: var(--ink); }
    .dinner { background: linear-gradient(135deg, #F0B24B, #E59A2E); color: #fff; box-shadow: 0 14px 30px -16px rgba(240,178,75,.6); }
    .dinner-name { font-size: 24px; font-weight: 700; margin: 8px 0 4px; line-height: 1.05; }
    .dinner-meta { font-size: 13px; font-weight: 700; opacity: .85; }
    .dinner-cta { margin-top: 16px; width: 100%; background: rgba(255,255,255,.25); border: none; border-radius: 12px; padding: 10px; color: #fff; font-size: 13px; font-weight: 800; cursor: pointer; }
    .budget-amt { font-size: 28px; font-weight: 700; color: var(--ink); }
    .budget-total { font-size: 15px; color: var(--ink3); font-weight: 700; }
    .bar { height: 9px; background: var(--line2); border-radius: 8px; margin-top: 12px; overflow: hidden; }
    .bar-fill { height: 100%; background: linear-gradient(90deg, #F0B24B, #E56B4E); border-radius: 8px; }
    .budget-left { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 8px; }
    .shop-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
    :host-context(.shell.narrow) .shop-grid { grid-template-columns: 1fr; }
    .shop-it { display: flex; align-items: center; gap: 11px; cursor: pointer; }
    .tick { width: 20px; height: 20px; flex: none; border-radius: 6px; border: 2px solid var(--line2); background: transparent; display: flex; align-items: center; justify-content: center; }
    .tick.on { background: var(--sage); border-color: var(--sage); }
    .shop-name { flex: 1; font-size: 13.5px; font-weight: 700; color: var(--ink); }
    .shop-name.done { color: var(--ink3); text-decoration: line-through; }
    .shop-qty { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .msgs { display: flex; flex-direction: column; gap: 12px; }
    .msg { display: flex; gap: 10px; }
    .msg-name { font-size: 12px; font-weight: 800; color: var(--ink2); }
    .msg-text { font-size: 13px; font-weight: 700; color: var(--ink); line-height: 1.3; }
  `],
})
export class HomeScreen {
  store = inject(FoyerStore);
  d = this.store.data as () => NonNullable<ReturnType<FoyerStore['data']>>;

  today = computed(() => this.store.eventsForDay(TODAY));
  openTasks = computed(() => this.d().tasks.filter((t) => !t.done).length);
  dashTasks = computed(() => this.d().tasks.filter((t) => !t.done).slice(0, 5));
  dashShop = computed(() => this.d().shop.slice(0, 8));
  dashMsgs = computed(() => this.d().msgs.slice(-3));
  shopTotal = computed(() => this.d().shop.length);
  shopDone = computed(() => this.d().shop.filter((x) => x.done).length);

  spent = computed(() => this.d().tx.filter((t) => (t.m || 0) === 0 && !t.income).reduce((a, t) => a + t.amount, 0));
  total = computed(() => this.d().bcats.reduce((a, c) => a + c.budget, 0));
  barW = computed(() => (this.total() > 0 ? Math.min(this.spent() / this.total() * 100, 100) : 0));

  dinner = computed(() => {
    const v = this.d().meals[TODAY + '-soir'];
    if (v?.rid) { const r = this.d().recipes.find((x) => x.id === v.rid); if (r) return { name: r.name, meta: `${r.time} · niveau ${r.level.toLowerCase()}` }; }
    if (v?.text) return { name: v.text, meta: 'Repas libre' };
    return { name: 'Rien de prévu', meta: 'Ajoutez un repas au planning' };
  });

  fmtInt(n: number): string { return Math.round(n).toLocaleString('fr-FR'); }
}
