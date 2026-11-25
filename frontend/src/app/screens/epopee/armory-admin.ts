import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { CATEGORY_LABEL, Reward } from '../../core/epopee/epopee';
import { FoyerStore } from '../../core/foyer.store';

/**
 * Le catalogue de l'Armurerie, tenu par les parents : des moments et des
 * privilèges réels, à prix fixe. Changer un prix ne change pas une quête en
 * cours, qui garde celui du jour où elle a été choisie.
 */
@Component({
  selector: 'epopee-armory-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="lead">Des moments et des privilèges réels, à prix fixe et connu d’avance : rien ne se tire au sort. Avec {{ perDay() }} écu{{ perDay() > 1 ? 's' : '' }} possibles par jour, un trésor à {{ perDay() * 5 }} écus demande environ cinq jours de routines.</p>
    @for (r of rewards(); track r.id) {
      <div class="line">
        <div class="what"><div class="t">{{ r.title }}</div><div class="s">{{ label(r) }}@if (r.description) { , {{ r.description }} }</div></div>
        <label class="cost"><input class="input" type="number" min="10" max="300" inputmode="numeric" [attr.aria-label]="'Prix de ' + r.title" [value]="r.cost" (change)="prix(r, +$any($event.target).value)" /><span>écus</span></label>
        <button class="undo" [disabled]="busy()" (click)="retirer(r)">Retirer</button>
      </div>
    }
    <div class="add">
      <input class="input grow" maxlength="60" placeholder="Une nouvelle récompense" aria-label="Titre de la récompense" [value]="title()" (input)="title.set($any($event.target).value)" />
      <input class="input grow" maxlength="160" placeholder="En une phrase (facultatif)" aria-label="Description de la récompense" [value]="description()" (input)="description.set($any($event.target).value)" />
      <select class="input" aria-label="Genre de récompense" (change)="category.set($any($event.target).value)">@for (c of categories; track c.id) { <option [value]="c.id" [selected]="c.id === category()">{{ c.label }}</option> }</select>
      <label class="cost"><input class="input" type="number" min="10" max="300" inputmode="numeric" aria-label="Prix en écus" [value]="cost()" (input)="cost.set(+$any($event.target).value)" /><span>écus</span></label>
      <button class="btn btn-soft" [disabled]="busy() || !title().trim()" (click)="ajouter()">Ajouter</button>
    </div>
  `,
  styles: [`
    .lead { font-size: 14.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin: 0 0 16px; max-width: 560px; }
    .line { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line2); }
    .what { flex: 1; min-width: 0; }
    .t { font-size: 14.5px; font-weight: 700; color: var(--ink); }
    .s { font-size: 12.5px; font-weight: 600; color: var(--ink3); }
    .cost { display: flex; align-items: center; gap: 6px; flex: none; font-size: 13px; font-weight: 700; color: var(--ink2); }
    .cost .input { width: 84px; padding: 10px 12px; }
    .undo { border: none; background: none; cursor: pointer; min-height: 44px; padding: 0 8px; font: 800 13px var(--font-body); color: var(--ink2); text-decoration: underline; text-underline-offset: 3px; }
    .add { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line2); align-items: center; }
    .add .grow { flex: 1 1 220px; width: auto; }
    .add select.input { width: auto; }
    .add .btn { min-height: 48px; }
  `],
})
export class ArmoryAdmin {
  private readonly api = inject(ApiService);
  private readonly store = inject(FoyerStore);

  readonly rewards = input.required<Reward[]>();
  /** The écus a child can earn in a day, for the sentence that helps set a price. */
  readonly perDay = input(0);
  readonly changed = output<void>();

  readonly categories = (Object.keys(CATEGORY_LABEL) as Reward['category'][]).map((id) => ({ id, label: CATEGORY_LABEL[id] }));
  readonly busy = signal(false);
  readonly title = signal('');
  readonly description = signal('');
  readonly category = signal<Reward['category']>('duo');
  readonly cost = signal(20);

  label(r: Reward): string { return CATEGORY_LABEL[r.category]; }

  private async agir(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await fn(); } catch (e) { this.store.toast((e as Error).message); } finally { this.busy.set(false); this.changed.emit(); }
  }
  prix(r: Reward, cost: number): Promise<void> {
    if (cost === r.cost) return Promise.resolve();
    return this.agir(async () => { await this.api.put(`epopee/recompenses/${r.id}`, { ...r, cost }); });
  }
  retirer(r: Reward): Promise<void> {
    if (!confirm(`Retirer « ${r.title} » de l’Armurerie ? Une quête qui la vise déjà continue.`)) return Promise.resolve();
    return this.agir(async () => { await this.api.del(`epopee/recompenses/${r.id}`); });
  }
  ajouter(): Promise<void> {
    return this.agir(async () => {
      await this.api.post('epopee/recompenses', { title: this.title().trim(), description: this.description().trim(), cost: this.cost(), category: this.category() });
      this.title.set(''); this.description.set('');
    });
  }
}
