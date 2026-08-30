import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { ModalComponent } from '../shared/modal';
import { PlanLine, scaleLabel } from '../core/shopping-plan';

interface Groupe { name: string; color: string; lines: PlanLine[]; }

/**
 * Ce que deviendra la liste de courses, montré avant d'y toucher.
 *
 * C'est le seul moment où une erreur de lecture d'ingrédient se rattrape sans
 * avoir à défaire des courses déjà commencées : d'où le détail, y compris de ce
 * qui a été écarté et de ce qui n'a pas été compris.
 */
@Component({
  selector: 'app-generate-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ModalComponent],
  template: `
    @let rep = store.genReport();
    @if (rep) {
      <f-modal title="Liste depuis les repas" [maxWidth]="560" (close)="store.patch({ genOpen: false })">
        <div class="bilan">
          <div class="b-item"><b>{{ rep.add.length }}</b> à ajouter</div>
          @if (rep.update.length) { <div class="b-item"><b>{{ rep.update.length }}</b> à compléter</div> }
          @if (rep.remove.length) { <div class="b-item"><b>{{ rep.remove.length }}</b> à retirer</div> }
          @if (rep.present.length) { <div class="b-item soft"><b>{{ rep.present.length }}</b> déjà sur la liste</div> }
        </div>

        @if (!rep.add.length && !rep.update.length && !rep.remove.length) {
          <div class="note">Rien à changer : la liste contient déjà tout ce que les repas de la semaine demandent.</div>
        }

        @if (rep.scaled.length || rep.unscaled.length) {
          <div class="note">
            @for (s of rep.scaled; track s.recipe) {
              <div>« {{ s.recipe }} » {{ scaleLabel(s) }}.</div>
            }
            @for (u of rep.unscaled; track u) {
              <div>« {{ u }} » n'indique pas ses portions : quantités reprises telles quelles.</div>
            }
          </div>
        }

        @for (g of groupes(); track g.name) {
          <div class="grp">
            <div class="grp-head"><span class="dot" [style.background]="g.color"></span>{{ g.name }}</div>
            @for (l of g.lines; track l.name) {
              <div class="row" [class.have]="store.hasHave(l)">
                <div class="r-name">{{ l.name }}</div>
                <div class="r-qty">{{ l.qty }}</div>
                <button class="why" (click)="store.toggleHave(l)"
                        [title]="store.hasHave(l) ? 'Finalement, l’ajouter' : 'J’ai déjà ça : ne pas l’acheter'">
                  <f-icon [name]="store.hasHave(l) ? 'plus' : 'check'" [size]="15"
                          [color]="store.hasHave(l) ? 'var(--ink3)' : 'var(--sage)'" [width]="2.6" />
                </button>
                <button class="why" (click)="toggle(l.name)" [title]="'D’où vient cette ligne'">
                  <f-icon name="eye" [size]="15" color="var(--ink3)" />
                </button>
              </div>
              @if (open() === l.name) {
                <div class="src">
                  @for (s of l.sources; track $index) { <div>{{ s.recipe }} : {{ s.raw }}</div> }
                </div>
              }
            }
          </div>
        }

        @if (rep.update.length) {
          <div class="grp">
            <div class="grp-head"><span class="dot" style="background:var(--ink3)"></span>Quantités à compléter</div>
            @for (u of rep.update; track u.item.id) {
              <div class="row"><div class="r-name">{{ u.line.name }}</div><div class="r-qty">{{ u.item.qty || '—' }} → {{ u.line.qty }}</div></div>
            }
          </div>
        }

        @if (rep.remove.length) {
          <div class="grp">
            <div class="grp-head"><span class="dot" style="background:#E56B4E"></span>Plus demandé par aucun repas</div>
            @for (i of rep.remove; track i.id) {
              <div class="row"><div class="r-name">{{ i.name }}</div><div class="r-qty">retiré</div></div>
            }
            <div class="hint">Seuls les articles générés et jamais cochés sont retirés. Ce que vous avez ajouté à la main reste.</div>
          </div>
        }

        @if (rep.pantry.length) {
          <div class="grp">
            <div class="grp-head"><span class="dot" style="background:#F0B24B"></span>Fond de placard, écarté</div>
            <div class="hint">Sel, huile, épices : supposés déjà là. Touchez pour en ajouter un quand même.</div>
            <div class="pantry">
              @for (l of rep.pantry; track l.name) {
                <button class="p-chip" [class.on]="store.isPantryPicked(l.name)" (click)="store.togglePantryPick(l.name)">
                  {{ l.name }}@if (l.qty) { <span class="p-q">{{ l.qty }}</span> }
                </button>
              }
            </div>
          </div>
        }

        @if (rep.stocked.length) {
          <div class="grp">
            <div class="grp-head"><span class="dot" style="background:#7A9B76"></span>Vous m'aviez dit en avoir</div>
            <div class="hint">Écartés pour cette fois. Touchez pour en racheter quand même : la note disparaît alors.</div>
            <div class="pantry">
              @for (x of rep.stocked; track x.line.name) {
                <button class="p-chip" [class.on]="store.isStockPicked(x.line)" (click)="store.toggleStockPick(x.line)">
                  {{ x.line.name }} <span class="p-q">{{ store.stockAgeLabel(x.days) }}</span>
                </button>
              }
            </div>
          </div>
        }

        @if (rep.unknown.length) {
          <div class="grp warnbox">
            <div class="grp-head"><span class="dot" style="background:#C6492F"></span>Lignes non reconnues</div>
            <div class="hint">Elles sont ajoutées telles quelles, dans « {{ fallbackName() }} ». Rien n'est perdu, mais leur quantité n'a pas pu être additionnée.</div>
            @for (u of rep.unknown; track $index) {
              <div class="row"><div class="r-name">{{ u.raw }}</div><div class="r-qty">{{ u.recipe }}</div></div>
            }
          </div>
        }

        <div class="modal-actions">
          <button class="btn btn-soft grow" (click)="store.patch({ genOpen: false })">Annuler</button>
          <button class="btn btn-primary grow2" (click)="store.applyList()">Mettre la liste à jour</button>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .bilan { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .b-item { background: var(--soft2); border-radius: 11px; padding: 9px 13px; font-size: 13px; font-weight: 700; color: var(--ink2); }
    .b-item b { color: var(--ink); font-size: 15px; }
    .b-item.soft { opacity: .7; }
    .note { background: var(--soft); border-radius: 13px; padding: 11px 13px; font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; margin-bottom: 16px; }
    .grp { margin-bottom: 18px; }
    .grp-head { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 13px; font-weight: 700; color: var(--ink2); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 3px; flex: none; }
    .row { display: flex; align-items: center; gap: 10px; min-height: 40px; border-top: 1px solid var(--line); }
    .row.have { opacity: .45; }
    .row.have .r-name { text-decoration: line-through; }
    .r-name { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 700; color: var(--ink); overflow-wrap: anywhere; }
    .r-qty { font-size: 13px; font-weight: 800; color: var(--ink3); flex: none; }
    .why { border: none; background: none; cursor: pointer; padding: 4px; display: flex; }
    .src { font-size: 12px; font-weight: 600; color: var(--ink3); padding: 4px 0 8px 2px; line-height: 1.5; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink2); line-height: 1.45; margin: 6px 0 8px; }
    .pantry { display: flex; flex-wrap: wrap; gap: 8px; }
    .p-chip { border: 2px solid var(--line2); background: transparent; color: var(--ink2); border-radius: 12px; padding: 8px 12px; font-size: 13px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .p-chip.on { background: var(--sage); border-color: var(--sage); color: #fff; }
    .p-q { font-size: 11.5px; opacity: .75; }
    .warnbox { background: #FCE9E3; border-radius: 14px; padding: 12px 14px; }
    .modal-actions { display: flex; gap: 12px; align-items: center; margin-top: 4px; }
    .modal-actions .grow { flex: 1; }
    .modal-actions .grow2 { flex: 1.4; }
  `],
})
export class GenerateModal {
  readonly scaleLabel = scaleLabel;
  store = inject(FoyerStore);
  /** Ligne dont on montre la provenance. Une seule à la fois, pour ne pas noyer. */
  private opened = signal('');
  open = this.opened.asReadonly();
  toggle(name: string): void { this.opened.set(this.opened() === name ? '' : name); }

  groupes = computed<Groupe[]>(() => {
    const rep = this.store.genReport(); const d = this.store.data();
    if (!rep || !d) return [];
    return d.aisles
      .map((a) => ({ name: a.name, color: a.color, lines: rep.add.filter((l) => l.aisleId === a.id) }))
      .filter((g) => g.lines.length);
  });

  /** Rayon où atterrit ce qui n'a pas été reconnu, nommé tel qu'il l'est chez soi. */
  fallbackName = computed(() => {
    const d = this.store.data();
    return d?.aisles.find((a) => a.id === this.store.defaultAisleId())?.name || 'À trier';
  });
}
