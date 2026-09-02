import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../core/icon';

/**
 * La saisie en une ligne des tuiles d'accueil.
 *
 * Repliée, elle n'est qu'un bouton : une tuile qui répond « qu'est-ce qu'il y a
 * aujourd'hui » ne doit pas être encombrée par un champ vide. Dépliée, elle
 * prend le focus, se valide à Entrée et se ferme à Échap. Deux taps au maximum,
 * sans quitter l'accueil.
 *
 * Les suggestions sont fournies par la tuile, donc par son module : ce composant
 * ne sait pas ce qu'il propose, il l'affiche.
 */
@Component({
  selector: 'f-quick-add',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  template: `
    @if (open()) {
      <div class="wrap">
        <div class="row">
          <input #field class="input sm" [ngModel]="text()" (ngModelChange)="setText($event)"
                 [placeholder]="placeholder()" (keydown.enter)="submit()" (keydown.escape)="close()" />
          <button class="go" [disabled]="!text().trim()" (click)="submit()" [attr.aria-label]="label()">
            <f-icon name="check" [size]="15" color="#fff" [width]="3" />
          </button>
        </div>
        @if (visibleSuggestions().length) {
          <div class="sugg">
            @for (s of visibleSuggestions(); track s) {
              <button class="pill" (click)="pick(s)">{{ s }}</button>
            }
          </div>
        }
      </div>
    } @else {
      <button class="opener" (click)="openNow()">
        <f-icon name="plus" [size]="14" color="var(--ink2)" [width]="2.6" /> {{ label() }}
      </button>
    }
  `,
  styles: [`
    :host { display: block; margin-top: 12px; }
    .opener {
      display: flex; align-items: center; gap: 7px; width: 100%; justify-content: center;
      border: 1px dashed var(--line2); background: transparent; cursor: pointer;
      border-radius: 12px; padding: 9px; font-size: 12.5px; font-weight: 800; color: var(--ink2);
    }
    .row { display: flex; gap: 8px; }
    .input.sm { flex: 1; min-width: 0; padding: 9px 12px; font-size: 13.5px; }
    .go {
      flex: none; width: 38px; border: none; cursor: pointer; border-radius: 11px;
      background: var(--sage); display: flex; align-items: center; justify-content: center;
    }
    .go:disabled { background: var(--line2); cursor: default; }
    .sugg { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .pill {
      border: none; cursor: pointer; background: var(--soft2); color: var(--ink);
      font-size: 12px; font-weight: 800; padding: 6px 11px; border-radius: 9px;
    }
  `],
})
export class QuickAddComponent {
  readonly label = input('Ajouter');
  readonly placeholder = input('');
  /** Propositions du module, filtrées par lui sur ce qui est tapé. */
  readonly suggestions = input<string[]>([]);
  /** Le texte tapé, publié pour que la tuile calcule ses suggestions. */
  readonly typed = output<string>();
  readonly submitted = output<string>();

  readonly open = signal(false);
  readonly text = signal('');
  private field = viewChild<ElementRef<HTMLInputElement>>('field');

  /** Une suggestion identique à ce qui est déjà tapé n'apprend rien. */
  readonly visibleSuggestions = computed(() => {
    const q = this.text().trim().toLowerCase();
    return this.suggestions().filter((s) => s.toLowerCase() !== q).slice(0, 4);
  });

  openNow(): void {
    this.open.set(true);
    // Le champ n'existe qu'une fois la vue redessinée.
    setTimeout(() => this.field()?.nativeElement.focus(), 0);
  }

  close(): void { this.open.set(false); this.text.set(''); this.typed.emit(''); }

  setText(v: string): void { this.text.set(v); this.typed.emit(v); }

  submit(): void {
    const t = this.text().trim();
    if (!t) return;
    this.submitted.emit(t);
    this.close();
  }

  pick(s: string): void {
    this.text.set(s);
    this.submit();
  }
}
