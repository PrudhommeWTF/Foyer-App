import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Une ligne d'échéancier (Calendrier : panneau du jour, affichage Liste).
 *
 * L'heure tient une colonne de 52 px : le début dans la couleur de l'élément,
 * la fin dessous en gris. Sans heure, un libellé gris dit ce que c'est
 * (« Journée », « Tâche », « Anniv. »). Puis le titre, les méta projetées
 * (`[meta]`), et à droite ce qui est projeté en `[aside]` (les membres).
 *
 * Aucun fond, aucune bordure : la couleur ne vit qu'à un endroit, l'heure (ou
 * le point d'un élément sur la journée). Le survol pose un fond discret, réglé
 * par le parent avec `--agenda-hover`.
 */
@Component({
  selector: 'f-agenda-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'button', tabindex: '0', '(keydown.enter)': 'activate($event)', '(keydown.space)': 'activate($event)' },
  template: `
    <div class="tm" [class.lab]="!start()" [style.color]="start() ? timeColor() : null">
      @if (start()) { {{ start() }}@if (end()) { <small>{{ end() }}</small> } } @else { {{ label() }} }
    </div>
    <div class="main">
      <div class="t" [class.light]="light()" [class.strike]="strike()">
        @if (dot()) { <span class="dot" [style.background]="dot()"></span> }{{ title() }}
      </div>
      <ng-content select="[meta]" />
    </div>
    <ng-content select="[aside]" />
  `,
  styles: [`
    :host { display: flex; align-items: flex-start; gap: 14px; padding: 10px 6px; border-radius: 10px; cursor: pointer; min-width: 0; }
    :host(:hover) { background: var(--agenda-hover, var(--surface)); }
    :host(:focus-visible) { outline: 2px solid var(--ink3); outline-offset: -2px; }
    .tm { width: 52px; flex: none; font-size: 13px; font-weight: 800; line-height: 1.25; padding-top: 1px; }
    .tm small { display: block; font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .tm.lab { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .main { flex: 1; min-width: 0; }
    .t { font-size: 15px; font-weight: 700; color: var(--ink); line-height: 1.3; overflow-wrap: anywhere; }
    .t.light { font-weight: 600; }
    .t.strike { text-decoration: line-through; color: var(--ink3); }
    .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin: 0 8px 2px 0; vertical-align: middle; }
  `],
})
export class AgendaRowComponent {
  /** « 20:00 », ou vide pour un élément sans heure. */
  readonly start = input('');
  readonly end = input('');
  /** La couleur de l'heure : celle de l'événement, ou le gris d'un créneau. */
  readonly timeColor = input('var(--ink2)');
  /** Le libellé gris d'un élément sans heure. */
  readonly label = input('');
  readonly title = input('');
  /** Le point coloré d'un élément sur la journée, devant le titre. */
  readonly dot = input('');
  /** Les repères (tâches, anniversaires…) se lisent un cran plus légers. */
  readonly light = input(false);
  readonly strike = input(false);

  /** Entrée ou Espace : comme un clic, pour qui navigue au clavier. */
  activate(e: Event): void {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).click();
  }
}
