import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { PALETTE } from '../../core/constants';
import { RAYONS } from '../../core/articles';
import { Aisle, Rayon } from '../../core/models';
import { ItemCtx, ItemForm, ItemResult } from '../../core/items';

/** Le formulaire d'un rayon : nom, couleur, et le type qui range les ingrédients générés. */
@Component({
  selector: 'app-aisle-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @let v = f();
    <div class="field-label">Nom du rayon</div>
    <input class="input mb" placeholder="Ex : Boulangerie, Surgelés…" [ngModel]="v.name" (ngModelChange)="set({ name: $event })" />
    <div class="field-label">Couleur</div>
    <div class="swatch-row mb">
      @for (c of PALETTE; track c) {
        <button type="button" class="swatch" [style.background]="c" [style.box-shadow]="v.color === c ? '0 0 0 3px var(--surface), 0 0 0 5px ' + c : ''"
                (click)="set({ color: c })" [attr.aria-label]="'Couleur ' + ($index + 1)" [attr.aria-pressed]="v.color === c"></button>
      }
    </div>
    <div class="field-label">Type de rayon</div>
    <div class="hint">Sert à ranger automatiquement les ingrédients générés depuis les repas. Facultatif : sans lui, le nom du rayon suffit souvent.</div>
    <div class="seg-wrap">
      <button type="button" class="seg-opt" [class.on]="!v.kind" (click)="set({ kind: '' })">Aucun</button>
      @for (r of RAYONS; track r.key) {
        <button type="button" class="seg-opt" [class.on]="v.kind === r.key" (click)="set({ kind: r.key })">{{ r.name }}</button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .mb { margin-bottom: 20px; }
    .hint { font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin-bottom: 10px; }
    .seg-wrap { display: flex; flex-wrap: wrap; gap: 8px; }
    .seg-opt { display: flex; align-items: center; gap: 7px; padding: 11px 15px; border-radius: 11px; font: inherit; font-size: 13.5px; font-weight: 800; cursor: pointer; background: var(--soft2); color: var(--ink2); border: 2px solid transparent; }
    .seg-opt.on { background: var(--primary); color: #fff; }
  `],
})
export class AisleForm implements ItemForm, OnInit {
  readonly store = inject(FoyerStore);
  readonly item = input<Aisle | null>(null);
  readonly ctx = input<ItemCtx | undefined>(undefined);
  readonly PALETTE = PALETTE;
  readonly RAYONS = RAYONS;

  readonly f = signal<{ name: string; color: string; kind: Rayon | '' }>({ name: '', color: '#7A9B76', kind: '' });
  private initial = '';
  readonly dirty = computed(() => JSON.stringify(this.f()) !== this.initial);

  ngOnInit(): void {
    const a = this.item();
    this.f.set(a ? { name: a.name, color: a.color, kind: a.kind || '' } : { name: '', color: '#7A9B76', kind: '' });
    this.initial = JSON.stringify(this.f());
  }
  submit(): ItemResult { return this.store.saveAisle(this.item()?.id ?? null, this.f()); }
  set(p: Partial<{ name: string; color: string; kind: Rayon | '' }>): void { this.f.update((f) => ({ ...f, ...p })); }
}
