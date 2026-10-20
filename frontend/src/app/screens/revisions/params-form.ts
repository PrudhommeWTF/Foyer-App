import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ExerciseContext, ExerciseDef, NO_CONTEXT, ParamDecl, Params } from '../../core/revisions/exercises/contract';
import { FORM_CONTROLS, contentChoices, rangeTop, setParam, steps } from '../../core/revisions/form';

/**
 * Les paramètres d'un exercice, en formulaire engendré depuis leur
 * déclaration : une liste pour un entier, oui ou non, un choix, « de … à … »,
 * une liste du contenu de l'exercice (« Liste de mots »).
 * Aucun exercice n'a son formulaire à lui. Chaque changement repasse par la
 * validation commune (core/revisions/form.ts) avant de sortir.
 */
@Component({
  selector: 'rev-params-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (d of def().params; track d.key) {
      <div class="lbl" [id]="'p-' + d.key">{{ d.label }}</div>
      @switch (control(d)) {
        @case ('choix') {
          @if (d.type === 'enum') {
            <div class="seg" role="radiogroup" [attr.aria-labelledby]="'p-' + d.key">
              @for (o of d.options; track o.value) {
                <button type="button" role="radio" [attr.aria-checked]="value()[d.key] === o.value" [class.on]="value()[d.key] === o.value" (click)="set(d.key, o.value)">{{ o.label }}</button>
              }
            </div>
          }
        }
        @case ('oui-non') {
          <div class="seg" role="radiogroup" [attr.aria-labelledby]="'p-' + d.key">
            <button type="button" role="radio" [attr.aria-checked]="value()[d.key] === true" [class.on]="value()[d.key] === true" (click)="set(d.key, true)">Oui</button>
            <button type="button" role="radio" [attr.aria-checked]="value()[d.key] === false" [class.on]="value()[d.key] === false" (click)="set(d.key, false)">Non</button>
          </div>
        }
        @case ('liste') {
          @if (d.type === 'int') {
            <select [attr.aria-labelledby]="'p-' + d.key" (change)="set(d.key, +$any($event.target).value)">
              @for (v of steps(d.min, d.max); track v) { <option [value]="v" [selected]="v === value()[d.key]">{{ v }}</option> }
            </select>
          }
        }
        @case ('de-a') {
          @if (d.type === 'range') {
            @let r = pair(d.key);
            <div class="range">
              <span>de</span>
              <select [attr.aria-label]="d.label + ', de'" (change)="set(d.key, [+$any($event.target).value, r[1]])">
                @for (v of steps(d.min, top(d)); track v) { <option [value]="v" [selected]="v === r[0]">{{ v }}</option> }
              </select>
              <span>à</span>
              <select [attr.aria-label]="d.label + ', à'" (change)="set(d.key, [r[0], +$any($event.target).value])">
                @for (v of steps(r[0], top(d)); track v) { <option [value]="v" [selected]="v === r[1]">{{ v }}</option> }
              </select>
            </div>
          }
        }
        @case ('liste-contenu') {
          @if (d.type === 'content') {
            @let choix = choices(value()[d.key]);
            @if (choix.length) {
              <select [attr.aria-labelledby]="'p-' + d.key" (change)="set(d.key, $any($event.target).value)">
                @for (l of choix; track l.id) {
                  <option [value]="l.id" [selected]="l.id === value()[d.key]">{{ l.label }} ({{ l.items.length }} {{ l.items.length > 1 ? d.items : d.item }}){{ l.archived ? ', archivée' : '' }}</option>
                }
              </select>
            } @else { <div class="desc">Aucune liste pour l’instant.</div> }
          }
        }
      }
      @if (d.desc) { <div class="desc">{{ d.desc }}</div> }
    }
  `,
  styles: [`
    .lbl { margin: 16px 0 8px; font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; }
    .desc { margin-top: 6px; font-size: 12.5px; font-weight: 600; color: var(--ink2); }
    .seg { display: flex; background: var(--soft2); border-radius: 12px; padding: 3px; gap: 3px; }
    .seg button { flex: 1; border: none; background: transparent; border-radius: 10px; padding: 8px 12px; font-family: inherit; font-size: 15px; font-weight: 800; color: var(--ink2); cursor: pointer; min-height: 44px; }
    .seg button.on { background: var(--surface); color: var(--ink); box-shadow: var(--sh-float); }
    .range { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 800; color: var(--ink2); }
    select { max-width: 100%; min-height: 48px; min-width: 76px; font-size: 18px; font-weight: 800; border-radius: 12px; border: 2px solid var(--line); background: var(--surface); color: var(--ink); padding: 0 10px; font-family: inherit; }
  `],
})
export class ParamsFormComponent {
  readonly def = input.required<ExerciseDef>();
  readonly value = input.required<Params>();
  /** Les listes de l'exercice, pour un paramètre de contenu. */
  readonly ctx = input<ExerciseContext>(NO_CONTEXT);
  readonly edited = output<Params>();
  readonly steps = steps;

  control(d: ParamDecl) { return FORM_CONTROLS[d.type]; }
  top(d: Extract<ParamDecl, { type: 'range' }>): number { return rangeTop(d, this.value()); }
  pair(key: string): [number, number] { return this.value()[key] as [number, number]; }
  choices(current: unknown) { return contentChoices(this.ctx(), current); }
  set(key: string, v: Params[string]): void { this.edited.emit(setParam(this.def(), this.value(), key, v, this.ctx())); }
}
