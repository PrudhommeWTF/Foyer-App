import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { Routine, STEP_ICONS, StepDraft, draftsError, moved, newDraft, toDraft } from '../../core/epopee/epopee';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';

/**
 * Régler une routine, ou en créer une : son nom, son heure, et ses étapes (une
 * consigne chacune, un pictogramme, une durée de sablier, des écus). Rien ne
 * part avant « Enregistrer », qui envoie la liste entière dans son ordre. Sans
 * `routine`, c'est une création pour l'enfant `memberId`.
 */
@Component({
  selector: 'epopee-routine-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ModalComponent],
  template: `
    <f-modal [title]="(routine() ? 'Régler la routine de ' : 'Une nouvelle routine pour ') + name()" [maxWidth]="640" [tall]="true" (close)="closed.emit(false)">
      <div class="top">
        <label class="grow"><span class="field-label">Nom</span><input class="input" maxlength="60" placeholder="Le retour de l’école" [value]="title()" (input)="title.set($any($event.target).value)" /></label>
        <label><span class="field-label">Heure</span><input class="input" type="time" [value]="time()" (input)="time.set($any($event.target).value)" /></label>
      </div>

      @for (s of steps(); track $index; let i = $index) {
        <div class="step">
          <div class="s-head">
            <span class="num">{{ i + 1 }}</span>
            <input class="input" maxlength="60" placeholder="La consigne, en quelques mots" [attr.aria-label]="'Consigne de l’étape ' + (i + 1)" [value]="s.title" (input)="set(i, { title: $any($event.target).value })" />
            <button class="icon-btn sm" [disabled]="i === 0" (click)="move(i, -1)" [attr.aria-label]="'Monter l’étape ' + (i + 1)"><f-icon name="arrowUp" [size]="16" /></button>
            <button class="icon-btn sm" [disabled]="i === steps().length - 1" (click)="move(i, 1)" [attr.aria-label]="'Descendre l’étape ' + (i + 1)"><f-icon name="arrowDown" [size]="16" /></button>
            <button class="icon-btn sm" [disabled]="steps().length === 1" (click)="remove(i)" [attr.aria-label]="'Retirer l’étape ' + (i + 1)"><f-icon name="trash" [size]="16" /></button>
          </div>
          <input class="input hint" maxlength="120" placeholder="Une phrase pour l’enfant (facultatif)" [attr.aria-label]="'Phrase de l’étape ' + (i + 1)" [value]="s.hint" (input)="set(i, { hint: $any($event.target).value })" />
          <div class="s-opts">
            <label><span class="field-label">Pictogramme</span>
              <span class="pick"><f-icon [name]="s.icon" [size]="20" color="var(--primary)" [width]="2" />
                <select class="input" [value]="s.icon" (change)="set(i, { icon: $any($event.target).value })">@for (ic of icons; track ic.name) { <option [value]="ic.name" [selected]="ic.name === s.icon">{{ ic.label }}</option> }</select></span>
            </label>
            <label><span class="field-label">Sablier (min)</span><input class="input" type="number" min="1" max="60" inputmode="numeric" [value]="s.minutes" (input)="set(i, { minutes: +$any($event.target).value })" /></label>
            <div><span class="field-label">Écus</span>
              <div class="ecus" role="radiogroup" [attr.aria-label]="'Écus de l’étape ' + (i + 1)">@for (n of [0, 1, 2, 3]; track n) { <button role="radio" [attr.aria-checked]="s.ecus === n" [class.on]="s.ecus === n" (click)="set(i, { ecus: n })">{{ n }}</button> }</div>
            </div>
          </div>
        </div>
      }
      @if (steps().length < 12) { <button class="btn btn-soft btn-block" (click)="add()"><f-icon name="plus" [size]="16" [width]="2.4" /> Ajouter une étape</button> }

      <p class="sum">{{ total() }} écu{{ total() > 1 ? 's' : '' }} possible{{ total() > 1 ? 's' : '' }} avec cette routine. Le sablier est un repère : passé le temps, l’écu reste acquis.</p>
      @if (erreur(); as e) { <p class="err" role="alert">{{ e }}</p> }
      <div class="foot">
        @if (routine()) { <button class="btn btn-ghost del" [disabled]="busy()" (click)="supprimer()">Retirer cette routine</button> }
        <button class="btn btn-ghost" (click)="closed.emit(false)">Annuler</button>
        <button class="btn btn-primary" [disabled]="busy()" (click)="save()">Enregistrer</button>
      </div>
    </f-modal>
  `,
  styles: [`
    .top { display: flex; gap: 12px; margin-bottom: 18px; }
    .grow { flex: 1; }
    .step { padding: 14px; border-radius: 16px; background: var(--soft2); margin-bottom: 10px; }
    .s-head { display: flex; align-items: center; gap: 8px; }
    .s-head .input { flex: 1; min-width: 0; }
    .num { width: 28px; height: 28px; flex: none; border-radius: 50%; background: var(--surface); display: flex; align-items: center; justify-content: center; font: 800 13px var(--font-display); color: var(--ink2); }
    .hint { margin-top: 8px; font-size: 14px; }
    .s-opts { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; align-items: flex-end; }
    .s-opts label { flex: 1 1 130px; }
    .s-opts .field-label { margin-bottom: 6px; }
    .pick { display: flex; align-items: center; gap: 8px; }
    .ecus { display: flex; gap: 5px; }
    .ecus button { width: 44px; height: 46px; border-radius: var(--r-input); border: 2px solid var(--line); background: var(--surface); color: var(--ink2); font: 800 15px var(--font-body); cursor: pointer; }
    .ecus button.on { border-color: #D99427; background: #FDF0DA; color: #7D5400; }
    .icon-btn:disabled { opacity: .35; cursor: default; }
    .sum { margin: 16px 0 0; font-size: 13.5px; font-weight: 600; color: var(--ink2); line-height: 1.5; }
    .err { margin: 10px 0 0; font-size: 14px; font-weight: 700; color: var(--primary); }
    .foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 18px; }
    .del { margin-right: auto; padding-left: 0; }
  `],
})
export class RoutineEditor {
  private readonly api = inject(ApiService);
  private readonly store = inject(FoyerStore);

  /** The routine to edit, or null to create one. */
  readonly routine = input<Routine | null>(null);
  readonly memberId = input.required<string>();
  readonly name = input.required<string>();
  /** True when the routine was saved: the screen reloads. */
  readonly closed = output<boolean>();

  readonly icons = STEP_ICONS;
  readonly title = signal('');
  readonly time = signal('');
  readonly steps = signal<StepDraft[]>([]);
  readonly erreur = signal('');
  readonly busy = signal(false);
  readonly total = computed(() => this.steps().reduce((n, s) => n + s.ecus, 0));

  ngOnInit(): void {
    const r = this.routine();
    if (r) { this.title.set(r.title); this.time.set(r.time); this.steps.set(r.steps.map(toDraft)); }
    // A new routine starts in the afternoon, where the proposed ones leave a gap, with one step to fill in.
    else { this.time.set('16:45'); this.steps.set([newDraft()]); }
  }

  set(i: number, patch: Partial<StepDraft>): void { this.steps.update((l) => l.map((s, k) => (k === i ? { ...s, ...patch } : s))); }
  move(i: number, dir: -1 | 1): void { this.steps.update((l) => moved(l, i, dir)); }
  remove(i: number): void { this.steps.update((l) => l.filter((_, k) => k !== i)); }
  add(): void { this.steps.update((l) => [...l, newDraft()]); }

  async save(): Promise<void> {
    const e = draftsError(this.title(), this.time(), this.steps());
    this.erreur.set(e); if (e || this.busy()) return;
    this.busy.set(true);
    try {
      const r = this.routine(), body = {
        title: this.title().trim(), time: this.time(),
        steps: this.steps().map((s) => ({ id: s.id, title: s.title.trim(), hint: s.hint.trim(), icon: s.icon, seconds: s.minutes * 60, ecus: s.ecus })),
      };
      if (r) await this.api.put(`epopee/routines/${r.id}`, body); else await this.api.post(`epopee/membres/${this.memberId()}/routines`, body);
      this.store.toast(r ? 'Routine enregistrée.' : 'Routine créée.');
      this.closed.emit(true);
    } catch (x) { this.erreur.set((x as Error).message); } finally { this.busy.set(false); }
  }

  async supprimer(): Promise<void> {
    const r = this.routine();
    if (!r || this.busy() || !confirm(`Retirer la routine « ${r.title} » de ${this.name()} ? Les écus qu’elle a fait gagner restent.`)) return;
    this.busy.set(true);
    try { await this.api.del(`epopee/routines/${r.id}`); this.store.toast('Routine retirée.'); this.closed.emit(true); }
    catch (x) { this.erreur.set((x as Error).message); } finally { this.busy.set(false); }
  }
}
