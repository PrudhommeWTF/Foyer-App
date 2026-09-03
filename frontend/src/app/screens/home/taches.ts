import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { TaskItem } from '../../core/models';
import { whoBadges } from '../../core/schedule';
import { TaskComposerComponent } from '../taches/composer';
import { TileComponent } from '../../shared/tile';
import { WhoComponent } from '../../shared/who';
import { TachesTileData } from '../../core/tiles/taches.tile';
import { HomeTile } from './base';

@Component({
  selector: 'tile-taches',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TileComponent, WhoComponent, TaskComposerComponent],
  template: `
    <f-tile [title]="tile().title" [badge]="badge()" [link]="tile().link" [state]="state()" [raison]="raison()" [collapsed]="collapsed()"
            (open)="dash.open(tile())" (retry)="dash.retry(tile())">
      @if (data(); as d) {
        <div class="tasks">
          @for (l of d.lines; track l.task.id) {
            <div class="task">
              <button class="tick" (click)="store.toggleTask(l.task.id)" [attr.aria-label]="'Cocher ' + l.task.text"></button>
              <span class="ttext">
                {{ l.task.text }}
                @if (l.task.time && !l.late) { <span class="late">{{ l.task.time }}</span> }
                @if (l.late) { <span class="late">depuis {{ lateLabel(l.late) }}</span> }
              </span>
              <!-- Écrit, pas dessiné : un chevron seul demanderait de deviner, et
                   sur téléphone il n'y a pas d'infobulle pour lever le doute. -->
              <button class="later" (click)="store.postponeTask(l.task.id)">demain</button>
              @if (l.task.who.length) { <f-who [badges]="badges(l.task)" [size]="18" /> }
            </div>
          }
        </div>
      }
      @if (state().kind !== 'error' && state().kind !== 'loading') {
        <!-- La même saisie que l'écran Tâches : membre, date et heure se règlent ici aussi. -->
        <app-task-composer opener="Nouvelle tâche" (saved)="store.createTask($event)" />
      }
    </f-tile>
  `,
  styles: [`
    :host { display: block; }
    .tasks { display: flex; flex-direction: column; gap: 10px; }
    .task { display: flex; align-items: center; gap: 9px; }
    .tick { width: 22px; height: 22px; flex: none; border-radius: 7px; border: 2px solid var(--line2); background: transparent; cursor: pointer; position: relative; padding: 0; }
    .tick::before { content: ''; position: absolute; inset: -10px; }
    .ttext { flex: 1; font-size: 13.5px; font-weight: 700; color: var(--ink); min-width: 0; }
    /* Le retard se dit, il ne crie pas : c'est une précision, pas une alarme. */
    .late { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-left: 6px; white-space: nowrap; }
    .later {
      flex: none; border: none; cursor: pointer; padding: 4px 9px; border-radius: 8px;
      background: var(--soft2); color: var(--ink2); font-size: 11.5px; font-weight: 800;
    }
  `],
})
export class TachesTile extends HomeTile<TachesTileData> {
  /** Le compteur ne s'affiche que s'il y a quelque chose pour aujourd'hui. */
  readonly badge = computed(() => { const d = this.data(); return d && d.due ? d.due + ' aujourd’hui' : ''; });

  badges(t: TaskItem) { return whoBadges(t, this.store.data()?.members || []); }

  lateLabel(days: number): string {
    if (days < 7) return days + (days > 1 ? ' jours' : ' jour');
    if (days < 60) { const w = Math.round(days / 7); return w + (w > 1 ? ' semaines' : ' semaine'); }
    return Math.round(days / 30) + ' mois';
  }
}
