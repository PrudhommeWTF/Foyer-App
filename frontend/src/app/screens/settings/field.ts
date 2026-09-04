import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingDecl, checkValue } from '../../core/settings/registry';

/**
 * Un réglage, rendu depuis sa déclaration.
 *
 * C'est le seul endroit qui sait dessiner un réglage. Ajouter un module ne
 * rouvre donc pas la page Paramètres : il suffit de déclarer la clé, et elle
 * apparaît ici, au bon endroit, avec sa description, sa valeur par défaut et son
 * contrôle de saisie.
 *
 * Trois choses ne sont jamais tues, parce que chacune est une façon de mentir :
 * ce que le réglage change (la description), ce qu'il vaudrait si on n'y avait
 * pas touché (le défaut, et le geste pour y revenir), et **pourquoi il est
 * grisé** quand il l'est.
 */
@Component({
  selector: 'f-setting',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @let d = decl();
    <div class="f" [class.off]="!!lock()" [id]="'reglage-' + d.key">
      <div class="row">
        <div class="txt">
          <div class="lab">
            {{ d.label }}
            @if (d.scope === 'personnel') { <span class="tag perso">Personnel</span> }
            @if (where(); as w) { <span class="tag sec">{{ w }}</span> }
          </div>
          <div class="desc">{{ d.desc }}</div>
        </div>

        @if (d.type === 'bool' && !readonly()) {
          <button class="sw" [class.on]="value() === true" [disabled]="!!lock()"
            [attr.aria-label]="d.label" [attr.aria-pressed]="value() === true"
            (click)="poser(!value())"><span class="knob"></span></button>
        }
      </div>

      @if (readonly() && d.type === 'bool') { <div class="ro">{{ value() ? 'Activé' : 'Désactivé' }}</div> }

      @if (!readonly()) {
      @switch (d.type) {
        @case ('enum') {
          <select class="input" [disabled]="!!lock()" [ngModel]="value()" (ngModelChange)="poser($event)">
            @for (o of d.options || []; track o.value) { <option [value]="o.value">{{ o.label }}</option> }
          </select>
        }
        @case ('int') {
          <input class="input num" type="number" inputmode="numeric" [disabled]="!!lock()"
            [attr.min]="d.min ?? null" [attr.max]="d.max ?? null"
            [ngModel]="brouillon()" (ngModelChange)="brouillon.set($event)"
            (blur)="valider()" (keydown.enter)="valider()" />
        }
        @case ('time') {
          <input class="input num" type="time" [disabled]="!!lock()"
            [ngModel]="brouillon()" (ngModelChange)="brouillon.set($event)"
            (blur)="valider()" (keydown.enter)="valider()" />
        }
        @case ('text') {
          <input class="input" type="text" [disabled]="!!lock()" [attr.maxlength]="d.maxLength ?? 200"
            [ngModel]="brouillon()" (ngModelChange)="brouillon.set($event)"
            (blur)="valider()" (keydown.enter)="valider()" />
        }
      }
      }

      @if (d.type === 'secret') {
        <!-- Un secret ne s'affiche jamais, même masqué derrière des points : ce
             qu'on a besoin de savoir est s'il est posé, pas ce qu'il vaut. -->
        <div class="secret" [class.ok]="pose()">{{ pose() ? 'Défini' : 'Non défini' }}</div>
      }

      @if (erreur()) { <div class="ko">{{ erreur() }}</div> }

      @if (readonly()) {
        @if (d.type !== 'secret') { <div class="ro">{{ affiche() || '(vide)' }}</div> }
      } @else {
      <div class="foot">
        <span class="def">Par défaut : {{ lisible(d.default) }}</span>
        @if (!lock() && !parDefaut()) {
          <button class="reset" (click)="poser(d.default)">Revenir au défaut</button>
        }
      </div>
      }

      @if (lock(); as raison) { <div class="lock">{{ raison }}</div> }
    </div>
  `,
  styles: [`
    .f { padding: 14px 15px; border-radius: 14px; background: var(--soft); }
    .f.off { opacity: .62; }
    .row { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
    .txt { min-width: 0; }
    .lab { font-size: 14px; font-weight: 800; color: var(--ink); line-height: 1.35; }
    .desc { font-size: 12px; font-weight: 700; color: var(--ink2); line-height: 1.5; margin-top: 3px; }
    .tag { font-size: 9.5px; font-weight: 800; padding: 2px 6px; border-radius: 5px; text-transform: uppercase; letter-spacing: .04em; vertical-align: 2px; margin-left: 6px; white-space: nowrap; }
    .tag.perso { background: #F2ECF5; color: #8A5C97; }
    .tag.sec { background: var(--soft2); color: var(--ink3); text-transform: none; letter-spacing: 0; font-size: 10.5px; }
    :host-context(:root.dark) .tag.perso { background: rgba(155,111,168,.22); color: #C9A7D3; }

    /* 46 px de haut : la cible reste confortable au pouce sur un téléphone. */
    .sw { width: 50px; height: 30px; flex: none; border-radius: 20px; background: var(--line2); position: relative; transition: background .2s; border: none; padding: 0; cursor: pointer; }
    .sw.on { background: var(--primary); }
    .sw:disabled { cursor: not-allowed; }
    .sw .knob { position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; transition: left .2s; }
    .sw.on .knob { left: 23px; }

    .input { margin-top: 11px; width: 100%; }
    .input.num { max-width: 190px; }
    .input:disabled { cursor: not-allowed; }

    .ko { margin-top: 8px; font-size: 12px; font-weight: 800; color: #C6492F; line-height: 1.45; }
    .lock { margin-top: 9px; font-size: 11.5px; font-weight: 700; color: var(--ink3); line-height: 1.5; border-left: 3px solid var(--line2); padding-left: 9px; }

    .ro { margin-top: 10px; font-size: 13px; font-weight: 800; color: var(--ink); background: var(--soft2); border-radius: 10px; padding: 9px 12px; word-break: break-all; }
    .secret { margin-top: 10px; display: inline-block; font-size: 11.5px; font-weight: 800; padding: 5px 11px; border-radius: 20px; background: var(--soft2); color: var(--ink3); }
    .secret.ok { background: #EDF2EB; color: #5F7E5C; }
    :host-context(:root.dark) .secret.ok { background: rgba(122,155,118,.22); color: #A9C4A4; }

    .foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
    .def { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .reset { border: none; background: none; padding: 0; cursor: pointer; font-size: 11.5px; font-weight: 800; color: var(--primary); }
  `],
})
export class SettingFieldComponent {
  readonly decl = input.required<SettingDecl>();
  readonly value = input.required<boolean | number | string>();
  /** Vide quand le réglage est modifiable ; sinon la raison, affichée telle quelle. */
  readonly lock = input('');
  /** Section d'origine, montrée seulement dans les résultats de recherche. */
  readonly where = input('');
  /** Réglage fixé par la machine : montré tel qu'il s'applique, jamais modifiable. */
  readonly readonly = input(false);
  /** Pour un secret : est-il posé ? Sa valeur, elle, ne sort jamais du serveur. */
  readonly pose = input(false);
  /** Pour un réglage en lecture seule : la valeur telle qu'elle s'applique. */
  readonly affiche = input('');
  readonly change = output<boolean | number | string>();

  /**
   * Ce que la personne est en train de taper, avant validation. Il repart de la
   * valeur en vigueur dès qu'elle change ailleurs : l'autre administrateur, un
   * retour au défaut, un rechargement du document.
   */
  readonly brouillon = linkedSignal(() => String(this.value()));
  readonly erreur = signal('');

  readonly parDefaut = computed(() => this.value() === this.decl().default);

  lisible(v: boolean | number | string): string {
    if (typeof v === 'boolean') return v ? 'activé' : 'désactivé';
    if (v === '') return 'aucune';
    const o = (this.decl().options || []).find((x) => x.value === v);
    return o ? o.label : String(v);
  }

  poser(v: boolean | number | string): void {
    this.erreur.set('');
    this.change.emit(v);
  }

  /**
   * Valide ce qui vient d'être tapé. Une valeur refusée **reste affichée** avec
   * son message : la remettre à zéro sans explication est exactement ce qui fait
   * croire à une panne.
   */
  valider(): void {
    const brut = this.brouillon();
    if (brut === String(this.value())) { this.erreur.set(''); return; }
    const checked = checkValue(this.decl(), brut);
    if (!checked.ok) { this.erreur.set(checked.error); return; }
    this.erreur.set('');
    this.change.emit(checked.value);
  }
}
