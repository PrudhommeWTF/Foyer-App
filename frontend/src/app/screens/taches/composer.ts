import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { LIST_ICONS } from '../../core/constants';
import { Remind, SchedSlot, TaskItem, TaskRec } from '../../core/models';
import { TaskDraft } from '../../core/task-ops';
import { REMINDS, REMIND_LABELS, dueLabel, quickDates } from '../../core/tasks';
import { DOW_SHORT, FREQ_LABELS, recLabel } from '../../core/recurrence';
import { busyOn, conflictsAt, freestDay, slotLabel } from '../../core/availability';
import { normText } from '../../core/helpers';
import { AvatarComponent } from '../../shared/avatar';

type Panel = '' | 'who' | 'date' | 'list' | 'cat' | 'note' | 'doc' | 'rec';
/** Au-delà, la liste des documents se cherche plutôt qu'elle ne se lit. */
const DOCS_SHOWN = 8;
type Scope = 'one' | 'all';

/**
 * La saisie d'une tâche : un champ, et une barre d'action dessous.
 *
 * C'est le point qui décide si le module est utilisé. Une tâche doit se créer
 * en moins de trois secondes : on tape, on valide. Les attributs (membres, date
 * et heure, liste, catégorie, note) se règlent **avant** de valider, dans la
 * barre sous le champ, sans ouvrir de formulaire. Chaque bouton de la barre
 * déplie un petit panneau et se referme au choix suivant.
 *
 * Le même composant sert à modifier une tâche existante (`task` renseignée) :
 * mêmes réglages, un bouton de plus pour supprimer. Sur une série, enregistrer
 * ou supprimer demande « cette occurrence ou toute la série », en une ligne.
 *
 * Le panneau de la date lit l'emploi du temps des membres affectés, sans rien
 * y écrire : ce qu'ils ont ce jour-là, un conflit à l'heure choisie, et le jour
 * le plus libre de la semaine, en un tap.
 *
 * Replié derrière un bouton quand `opener` est donné : sur l'accueil, une tuile
 * qui répond « qu'est-ce qu'il y a aujourd'hui » ne doit pas être encombrée
 * par un champ vide.
 */
@Component({
  selector: 'app-task-composer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, AvatarComponent],
  template: `
    @if (opener() && !shown()) {
      <button class="opener" (click)="show()">
        <f-icon name="plus" [size]="14" color="var(--ink2)" [width]="2.6" /> {{ opener() }}
      </button>
    } @else {
      <div class="composer" [class.compact]="!!opener()">
        <div class="row">
          <input #field class="input" [placeholder]="task() ? 'Intitulé' : 'Ajouter une tâche…'" enterkeyhint="done"
                 autocomplete="off" autocapitalize="sentences"
                 [ngModel]="text()" (ngModelChange)="text.set($event)"
                 (focus)="focused.set(true)" (keydown.enter)="task() ? askOrDo('save') : submit()" (keydown.escape)="escape()" />
          @if (!task()) {
            <button class="go" [disabled]="!text().trim()" (click)="submit()" aria-label="Ajouter">
              <f-icon name="check" [size]="18" color="#fff" [width]="3" />
            </button>
          }
        </div>

        @if (suggestions().length) {
          <div class="sugg">
            @for (sg of suggestions(); track sg) {
              <button class="pill" (click)="pick(sg)">{{ sg }}</button>
            }
          </div>
        }

        @if (expanded()) {
          <!-- La barre d'action : tout se règle ici, avant de valider. -->
          <div class="bar">
            <button class="opt" [class.on]="who().length" [class.open]="panel() === 'who'" (click)="toggle('who')">
              @if (who().length) {
                <span class="avs">
                  @for (m of whoMembers(); track m.id) { <f-avatar [ini]="m.ini" [color]="m.color" [size]="20" border="2px solid var(--surface)" /> }
                </span>
              } @else { <f-icon name="users" [size]="15" color="currentColor" [width]="2.2" /> Personne }
            </button>
            @if (!isSub()) {
              <button class="opt" [class.on]="due()" [class.open]="panel() === 'date'" (click)="toggle('date')">
                <f-icon name="calendar" [size]="15" color="currentColor" [width]="2.2" /> {{ due() ? dueText() : 'Date' }}
                @if (due() && remind()) { <f-icon name="bell" [size]="13" color="currentColor" [width]="2.4" /> }
              </button>
            }
            @if (isSub()) { <span class="opt sub-note"><f-icon name="checklist" [size]="15" color="currentColor" [width]="2.2" /> Sous-tâche de « {{ parentText() }} »</span> }
            <button class="opt" [class.open]="panel() === 'list'" [disabled]="isSub()" (click)="toggle('list')">
              @if (listObj(); as l) {
                <f-icon [path]="listIcon(l.icon)" [size]="15" [color]="l.color" [width]="2.2" /> {{ l.name }}
              } @else { <f-icon name="checklist" [size]="15" color="currentColor" [width]="2.2" /> Liste }
            </button>
            <button class="opt" [class.on]="cat()" [class.open]="panel() === 'cat'" (click)="toggle('cat')">
              <f-icon name="folder" [size]="15" color="currentColor" [width]="2.2" /> {{ cat() || 'Catégorie' }}
            </button>
            <button class="opt" [class.on]="note().trim()" [class.open]="panel() === 'note'" (click)="toggle('note')">
              <f-icon name="edit" [size]="15" color="currentColor" [width]="2.2" /> Note
            </button>
            @if (files().length || docId()) {
              <button class="opt" [class.on]="docId()" [class.open]="panel() === 'doc'" (click)="toggle('doc')">
                <f-icon name="documents" [size]="15" color="currentColor" [width]="2.2" /> <span class="clip">{{ docObj()?.name || 'Document' }}</span>
              </button>
            }
            @if (!isSub()) {
              <button class="opt" [class.on]="rec()" [class.open]="panel() === 'rec'" (click)="toggle('rec')">
                <f-icon name="refresh" [size]="15" color="currentColor" [width]="2.2" /> {{ rec() ? recText() : 'Répéter' }}
              </button>
            }
          </div>

          @switch (panel()) {
            @case ('who') {
              <div class="panel">
                <div class="members">
                  <button class="mem" [class.on]="!who().length" (click)="who.set([])">
                    <span class="nobody"><f-icon name="users" [size]="18" color="var(--ink2)" [width]="2.2" /></span>
                    <span class="mem-name">Personne</span>
                  </button>
                  @for (m of members(); track m.id) {
                    <button class="mem" [class.on]="has(m.id)" (click)="toggleWho(m.id)">
                      <f-avatar [ini]="m.ini" [color]="m.color" [size]="40" [border]="has(m.id) ? '3px solid var(--ink)' : '3px solid transparent'" />
                      <span class="mem-name">{{ m.name }}</span>
                    </button>
                  }
                </div>
                <div class="hint">Sans personne, c’est pour le premier qui passe.</div>
              </div>
            }
            @case ('date') {
              <div class="panel">
                <div class="chips">
                  @for (q of quick(); track q.label) {
                    <button class="chip" [class.active]="due() === q.date" (click)="setDue(q.date)">{{ q.label }}</button>
                  }
                  <button class="chip" [class.active]="!due()" (click)="setDue(null)">Sans date</button>
                </div>
                <div class="dt">
                  <input class="input sm" type="date" [ngModel]="due() || ''" (ngModelChange)="setDue($event || null)" />
                  <input class="input sm" type="time" [disabled]="!due()" [ngModel]="time() || ''" (ngModelChange)="time.set($event || null)" />
                  @if (time()) { <button class="chip" (click)="time.set(null)">Sans heure</button> }
                </div>
                @if (due()) {
                  <!-- Le rappel se règle ici, à côté de l'heure : c'est un attribut de la date. -->
                  <div class="chips">
                    <span class="lbl"><f-icon name="bell" [size]="14" color="var(--ink2)" [width]="2.2" /> Rappel</span>
                    <button class="chip" [class.active]="!remind()" (click)="remind.set(null)">Aucun</button>
                    @for (r of reminds; track r) {
                      <button class="chip" [class.active]="remind() === r" (click)="remind.set(r)">{{ remindLabel(r) }}</button>
                    }
                  </div>
                  @if (remind() && !time() && (remind() === 'at' || remind() === '1h')) { <div class="hint">Sans heure, la tâche est prise à 9 h.</div> }
                }
                @if (avail(); as a) {
                  <!-- L'emploi du temps des membres affectés, lu, jamais modifié. -->
                  <div class="hint avail">
                    @if (a.clash) { <span class="clash">À cette heure : {{ a.clash }}.</span> }
                    @else if (a.busy) { Ce jour-là : {{ a.busy }}. }
                    @else { Rien dans l’emploi du temps ce jour-là. }
                  </div>
                  @if (a.suggest) {
                    <div class="chips"><button class="chip" (click)="setDue(a.suggest)">Jour le plus libre : {{ dayName(a.suggest) }}</button></div>
                  }
                }
              </div>
            }
            @case ('doc') {
              <div class="panel">
                <div class="chips">
                  <button class="chip" [class.active]="!docId()" (click)="docId.set(null); panel.set('')">Aucun</button>
                  @for (f of docMatches(); track f.id) {
                    <button class="chip clip" [class.active]="docId() === f.id" (click)="docId.set(f.id); panel.set('')">{{ f.name }}</button>
                  }
                </div>
                @if (files().length > docsShown || docQuery()) {
                  <input class="input sm" placeholder="Chercher un document…" [ngModel]="docQuery()" (ngModelChange)="docQuery.set($event)" (keydown.enter)="$event.stopPropagation()" />
                }
                <div class="hint">La tâche ouvrira ce document en un tap.</div>
              </div>
            }
            @case ('list') {
              <div class="panel">
                <div class="chips">
                  @for (l of lists(); track l.id) {
                    <button class="chip lchip" [class.active]="list() === l.id" [style.border-color]="list() === l.id ? l.color : 'var(--line2)'" (click)="list.set(l.id); panel.set('')">
                      <span class="dot" [style.background]="l.color"></span>{{ l.name }}
                      @if (l.scope !== 'shared') { <f-icon name="lock" [size]="12" color="var(--ink3)" [width]="2.4" /> }
                    </button>
                  }
                </div>
              </div>
            }
            @case ('cat') {
              <div class="panel">
                <div class="chips">
                  <button class="chip" [class.active]="!cat()" (click)="cat.set(''); panel.set('')">Aucune</button>
                  @for (c of cats(); track c) {
                    <button class="chip" [class.active]="cat() === c" (click)="cat.set(c); panel.set('')">{{ c }}</button>
                  }
                </div>
                <input class="input sm" placeholder="Autre catégorie…" [ngModel]="catFree()" (ngModelChange)="catFree.set($event)"
                       (keydown.enter)="$event.stopPropagation(); useFreeCat()" (blur)="useFreeCat()" />
              </div>
            }
            @case ('note') {
              <div class="panel">
                <textarea class="input" rows="3" placeholder="Une précision, une adresse, une référence…"
                          [ngModel]="note()" (ngModelChange)="note.set($event)"></textarea>
              </div>
            }
            @case ('rec') {
              <div class="panel">
                <div class="chips">
                  <button class="chip" [class.active]="!rec()" (click)="setFreq(null)">Jamais</button>
                  @for (f of freqs; track f) {
                    <button class="chip" [class.active]="rec()?.freq === f" (click)="setFreq(f)">{{ freqLabel(f) }}</button>
                  }
                </div>
                @if (rec(); as r) {
                  <!-- Les deux modes, explicites : c'est le choix qui compte vraiment. -->
                  <div class="seg sm">
                    <button [class.active]="r.base === 'due'" (click)="patchRec({ base: 'due' })">À date fixe</button>
                    <button [class.active]="r.base === 'done'" (click)="patchRec({ base: 'done' })">Après la réalisation</button>
                  </div>
                  <div class="hint">{{ r.base === 'done' ? 'La suivante part du jour où c’est fait : faite dimanche avec deux jours de retard, la prochaine tombe le dimanche d’après.' : 'La suivante suit le calendrier, même si celle-ci est faite en retard. Les occurrences manquées ne sont pas rattrapées.' }}</div>
                  <div class="dt">
                    <label class="lbl">Toutes les <input class="input sm num" type="number" min="1" max="99" [ngModel]="r.every" (ngModelChange)="patchRec({ every: num($event, 1, 99) })" /> {{ unitLabel(r) }}</label>
                  </div>
                  @if (r.freq === 'weekly' && r.base === 'due') {
                    <div class="chips">
                      @for (d of dows; track d) {
                        <button class="chip dow" [class.active]="hasDay(d)" (click)="toggleDay(d)">{{ dowShort(d) }}</button>
                      }
                    </div>
                  }
                  <div class="dt">
                    <label class="lbl">Souplesse <input class="input sm num" type="number" min="0" max="365" [ngModel]="r.grace || 0" (ngModelChange)="patchRec({ grace: num($event, 0, 365) || undefined })" /> jours avant d’être en retard</label>
                    <label class="lbl">Jusqu’au <input class="input sm" type="date" [ngModel]="r.until || ''" (ngModelChange)="patchRec({ until: $event || null })" /></label>
                  </div>
                  @if (!due()) { <div class="hint">Une série a toujours une échéance : la première sera aujourd’hui.</div> }
                }
              </div>
            }
          }

          @if (task(); as t) {
            @if (ask()) {
              <!-- Sur une série, la question est posée simplement, et une seule fois. -->
              <div class="ask">
                <div class="ask-q">{{ ask() === 'save' ? 'Appliquer la modification à…' : 'Cette tâche revient. Que faire ?' }}</div>
                <div class="ask-btns">
                  <button class="btn btn-soft grow" (click)="answer('one')">{{ ask() === 'save' ? 'Cette occurrence seulement' : 'Passer cette occurrence' }}</button>
                  <button class="btn btn-primary grow" (click)="answer('all')">{{ ask() === 'save' ? 'Toute la série' : 'Supprimer la série' }}</button>
                </div>
                <button class="ask-cancel" (click)="ask.set('')">Revenir</button>
              </div>
            } @else {
              <div class="foot">
                <button class="btn btn-soft del" (click)="askOrDo('delete')" aria-label="Supprimer"><f-icon name="trash" [size]="18" color="var(--primary)" [width]="2.2" /></button>
                <button class="btn btn-soft grow" (click)="closed.emit()">Annuler</button>
                <button class="btn btn-primary grow2" [disabled]="!text().trim()" (click)="askOrDo('save')">Enregistrer</button>
              </div>
              @if (t.rec) { <div class="hint">{{ recText() }}</div> }
            }
          }
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .opener {
      display: flex; align-items: center; gap: 7px; width: 100%; justify-content: center; margin-top: 12px;
      border: 1px dashed var(--line2); background: transparent; cursor: pointer;
      border-radius: 12px; padding: 9px; font-size: 12.5px; font-weight: 800; color: var(--ink2);
    }
    .composer.compact { margin-top: 12px; }
    .row { display: flex; gap: 10px; }
    .row .input { flex: 1; min-width: 0; }
    .compact .row .input { padding: 9px 12px; font-size: 13.5px; }
    .go { width: 46px; height: 46px; flex: none; border: none; border-radius: 12px; background: var(--primary); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 8px 16px -8px rgba(229,107,78,.7); }
    .compact .go { width: 40px; height: 40px; }
    .go:disabled { background: var(--line2); box-shadow: none; cursor: default; }
    .sugg { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .pill { border: none; cursor: pointer; background: var(--soft2); color: var(--ink); font-size: 12.5px; font-weight: 800; padding: 7px 11px; border-radius: 9px; }

    /* La barre : des boutons qui disent leur valeur. Un bouton réglé se colore. */
    .bar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .opt { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 5px 11px; border-radius: 10px; border: 1.5px solid var(--line2); background: var(--surface); color: var(--ink2); font: inherit; font-size: 12.5px; font-weight: 800; cursor: pointer; }
    .opt.on { color: var(--ink); border-color: var(--ink3); }
    .opt.open { background: var(--soft); border-color: var(--ink); color: var(--ink); }
    .clip { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .opt:disabled { opacity: .55; cursor: default; }
    .sub-note { color: var(--ink2); }
    .avail .clash { color: #C6492F; }
    .avs { display: inline-flex; }
    .avs > :not(:first-child) { margin-left: -6px; }

    .panel { margin-top: 10px; padding: 12px; border-radius: 14px; background: var(--soft); display: flex; flex-direction: column; gap: 10px; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip { min-height: 36px; }
    .chip.active { background: var(--ink); color: #fff; }
    .lchip { display: inline-flex; align-items: center; gap: 7px; border: 2px solid var(--line2); }
    .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
    .dt { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .input.sm { padding: 8px 11px; font-size: 13.5px; }
    .dt .input.sm { flex: 1; min-width: 130px; }
    .members { display: flex; flex-wrap: wrap; gap: 12px; }
    .mem { display: flex; flex-direction: column; align-items: center; gap: 5px; cursor: pointer; border: none; background: transparent; padding: 0; font: inherit; }
    .mem-name { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .mem.on .mem-name { color: var(--ink); }
    .nobody { width: 40px; height: 40px; border-radius: 50%; border: 3px solid transparent; background: var(--soft2); display: flex; align-items: center; justify-content: center; box-sizing: border-box; }
    .mem.on .nobody { border-color: var(--ink); }
    .hint { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    textarea.input { resize: vertical; font: inherit; }

    .seg.sm button { padding: 8px 10px; font-size: 12.5px; }
    .lbl { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; color: var(--ink2); flex-wrap: wrap; }
    .input.sm.num { width: 64px; min-width: 0; flex: none; }
    .chip.dow { min-width: 44px; justify-content: center; }
    .ask { margin-top: 18px; padding: 12px; border-radius: 14px; background: var(--soft); display: flex; flex-direction: column; gap: 10px; }
    .ask-q { font-size: 13px; font-weight: 800; color: var(--ink); }
    .ask-btns { display: flex; gap: 10px; }
    .ask-cancel { align-self: center; border: none; background: transparent; color: var(--ink3); font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
    .foot { display: flex; gap: 12px; align-items: center; margin-top: 18px; }
    .foot .grow { flex: 1; }
    .foot .grow2 { flex: 1.4; }
    .foot .del { width: 50px; flex: none; padding: 0; }
  `],
})
export class TaskComposerComponent {
  readonly store = inject(FoyerStore);

  /** Tâche à modifier. Null : on en crée une. */
  readonly task = input<TaskItem | null>(null);
  /** Liste visée par défaut. Vide : celle qui est ouverte à l'écran. */
  readonly listId = input('');
  /** Libellé du bouton replié. Vide : toujours déplié. */
  readonly opener = input('');

  /** `scope` ne compte que pour une série modifiée : cette occurrence, ou toute la série. */
  readonly saved = output<TaskDraft & { scope: Scope }>();
  readonly deleted = output<Scope>();
  readonly closed = output<void>();

  readonly shown = signal(false);
  readonly focused = signal(false);
  readonly text = signal('');
  readonly who = signal<string[]>([]);
  readonly due = signal<string | null>(null);
  readonly time = signal<string | null>(null);
  readonly cat = signal('');
  readonly catFree = signal('');
  readonly note = signal('');
  readonly list = signal('');
  readonly rec = signal<TaskRec | null>(null);
  readonly remind = signal<Remind | null>(null);
  readonly docId = signal<string | null>(null);
  readonly docQuery = signal('');
  readonly docsShown = DOCS_SHOWN;
  readonly reminds = REMINDS;
  readonly panel = signal<Panel>('');
  /** La question « cette occurrence ou toute la série » est ouverte, pour enregistrer ou supprimer. */
  readonly ask = signal<'' | 'save' | 'delete'>('');
  readonly freqs: TaskRec['freq'][] = ['daily', 'weekly', 'monthly', 'yearly'];
  readonly dows = [1, 2, 3, 4, 5, 6, 7];
  private field = viewChild<ElementRef<HTMLInputElement>>('field');

  /** La liste ouverte à l'écran. Mémorisée : l'effet ne repart que si elle change vraiment. */
  private readonly activeList = computed(() => this.listId() || this.store.activeTaskListId());

  constructor() {
    // Prérempli depuis la tâche à modifier ; sinon la saisie suit la liste
    // ouverte à l'écran, y compris quand on en change ou qu'on vient d'en créer une.
    effect(() => {
      const t = this.task();
      const fallback = this.activeList();
      untracked(() => {
        if (t) {
          this.text.set(t.text); this.who.set([...t.who]); this.due.set(t.due); this.time.set(t.time ?? null);
          this.cat.set(t.cat || ''); this.note.set(t.note || ''); this.list.set(t.listId); this.rec.set(t.rec ? { ...t.rec } : null); this.remind.set(t.remind ?? null);
          this.docId.set(t.docId ?? null);
        } else {
          this.list.set(fallback);
        }
      });
    });
  }

  /** La barre se montre dès qu'on écrit, ou toujours quand on modifie. */
  readonly expanded = computed(() => !!this.task() || this.focused() || !!this.text().trim() || !!this.panel());
  readonly members = computed(() => this.store.data()?.members || []);
  readonly whoMembers = computed(() => { const ids = new Set(this.who()); return this.members().filter((m) => ids.has(m.id)); });
  readonly lists = computed(() => { this.store.ui(); return this.store.visibleTaskLists(); });
  readonly listObj = computed(() => this.lists().find((l) => l.id === this.list()) || null);
  readonly cats = computed(() => this.store.taskCategories());
  readonly quick = computed(() => quickDates(this.store.todayStr()));
  readonly dueText = computed(() => dueLabel(this.due(), this.time(), this.store.todayStr(), (iso) => this.store.fmtNumDate(iso), this.rec()?.grace));
  readonly recText = computed(() => { const r = this.rec(); return r ? recLabel(r, (iso) => this.store.fmtNumDate(iso)) : ''; });
  /**
   * Une sous-tâche se modifie ici comme une autre, mais sans date, sans
   * répétition et sans changer de liste : ces trois-là sont l'affaire du parent,
   * et le serveur les écarterait. Un bouton qui ne fait rien serait pire que
   * l'absence de bouton.
   */
  readonly isSub = computed(() => !!this.task()?.parentId);
  readonly parentText = computed(() => {
    const p = this.task()?.parentId;
    return (p && this.store.task(p)?.text) || 'la tâche parente';
  });
  /** Ce que la liste a déjà vu : pas en modification, où l'intitulé est déjà là. */
  readonly suggestions = computed(() => this.task() ? [] : this.store.taskSuggestions(this.list(), this.text()));
  readonly files = computed(() => this.store.data()?.files || []);
  readonly docObj = computed(() => this.files().find((f) => f.id === this.docId()) || null);
  readonly docMatches = computed(() => {
    const q = normText(this.docQuery());
    return this.files().filter((f) => !q || normText(f.name).includes(q)).slice(0, DOCS_SHOWN);
  });
  /**
   * Ce que l'emploi du temps dit des membres affectés, le jour choisi : leurs
   * créneaux, un conflit à l'heure choisie, et le jour le plus libre à venir.
   * Null sans membre ni date : il n'y a alors rien à lire.
   */
  readonly avail = computed(() => {
    const who = this.who(); const due = this.due(); const d = this.store.data();
    if (!who.length || !due || !d) return null;
    const cal = this.store.calendar();
    const busy = busyOn(d.sched, due, who, cal);
    const time = this.time();
    const label = (s: SchedSlot): string => (who.length > 1 ? this.names(s.who.filter((m) => who.includes(m))) + ' : ' : '') + slotLabel(s);
    const best = freestDay(d.sched, who, this.store.todayStr(), 7, cal);
    return {
      clash: (time ? conflictsAt(busy, time) : []).map(label).join(', '),
      busy: busy.map(label).join(', '),
      suggest: best && best.date !== due ? best.date : null,
    };
  });
  private names(ids: string[]): string { return ids.map((id) => this.store.memberName(id)).filter(Boolean).join(', '); }
  /** « demain », « jeudi », « 12/09/2026 » : en minuscule, le mot vient au milieu d'une phrase. */
  dayName(iso: string): string { const l = dueLabel(iso, null, this.store.todayStr(), (d) => this.store.fmtNumDate(d)); return l.charAt(0).toLowerCase() + l.slice(1); }

  listIcon(k: string): string { return LIST_ICONS[k] || LIST_ICONS['checklist']; }
  has(id: string): boolean { return this.who().includes(id); }
  toggleWho(id: string): void { this.who.update((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id])); }
  toggle(p: Panel): void { this.panel.update((cur) => (cur === p ? '' : p)); }
  setDue(d: string | null): void { this.due.set(d); if (!d) this.time.set(null); }
  useFreeCat(): void { const c = this.catFree().trim(); if (c) { this.cat.set(c); this.catFree.set(''); this.panel.set(''); } }

  freqLabel(f: TaskRec['freq']): string { return FREQ_LABELS[f]; }
  remindLabel(r: Remind): string { return REMIND_LABELS[r]; }
  unitLabel(r: TaskRec): string {
    const n = r.every > 1;
    return r.freq === 'daily' ? (n ? 'jours' : 'jour') : r.freq === 'weekly' ? (n ? 'semaines' : 'semaine') : r.freq === 'monthly' ? 'mois' : (n ? 'ans' : 'an');
  }
  dowShort(d: number): string { return DOW_SHORT[d]; }
  num(v: unknown, min: number, max: number): number { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }
  setFreq(f: TaskRec['freq'] | null): void {
    if (!f) { this.rec.set(null); return; }
    const cur = this.rec();
    this.rec.set({ freq: f, every: cur?.every || 1, base: cur?.base || 'due', ...(cur?.grace ? { grace: cur.grace } : {}), ...(cur?.until ? { until: cur.until } : {}) });
    if (!this.due()) this.due.set(this.store.todayStr());
  }
  patchRec(p: Partial<TaskRec>): void {
    const cur = this.rec(); if (!cur) return;
    const next: TaskRec = { ...cur, ...p };
    if (next.grace === undefined) delete next.grace;
    if (!next.until) delete next.until;
    this.rec.set(next);
  }
  hasDay(d: number): boolean { return !!this.rec()?.days?.includes(d); }
  toggleDay(d: number): void {
    const cur = this.rec(); if (!cur) return;
    const days = (cur.days || []).includes(d) ? (cur.days || []).filter((x) => x !== d) : [...(cur.days || []), d].sort((a, b) => a - b);
    const next: TaskRec = { ...cur, days };
    if (!days.length) delete next.days;
    this.rec.set(next);
  }

  /** Enregistrer ou supprimer une série demande la portée ; une tâche simple agit tout de suite. */
  askOrDo(what: 'save' | 'delete'): void {
    if (this.task()?.rec) { this.ask.set(what); return; }
    if (what === 'save') this.submit('all'); else this.deleted.emit('all');
  }
  answer(scope: Scope): void {
    const what = this.ask(); this.ask.set('');
    if (what === 'save') this.submit(scope); else if (what === 'delete') this.deleted.emit(scope);
  }

  show(): void {
    this.shown.set(true);
    setTimeout(() => this.field()?.nativeElement.focus(), 0);
  }

  pick(s: string): void { this.text.set(s); this.submit(); }

  escape(): void {
    if (this.panel()) { this.panel.set(''); return; }
    this.reset();
    this.shown.set(false);
    this.focused.set(false);
    this.closed.emit();
  }

  submit(scope: Scope = 'all'): void {
    const text = this.text().trim();
    if (!text) return;
    this.saved.emit({ text, listId: this.list(), who: this.who(), due: this.due(), time: this.time(), cat: this.cat(), note: this.note(), rec: this.rec(), remind: this.due() ? this.remind() : null, docId: this.docId(), scope });
    if (this.task()) return;
    // La liste reste, tout le reste repart à zéro : la tâche suivante n'a pas
    // de raison d'hériter de la date ni du membre de la précédente.
    this.reset();
    if (this.opener()) { this.shown.set(false); this.focused.set(false); }
    else this.field()?.nativeElement.focus();
  }

  private reset(): void {
    this.text.set(''); this.who.set([]); this.due.set(null); this.time.set(null); this.cat.set(''); this.catFree.set(''); this.note.set(''); this.rec.set(null); this.remind.set(null); this.docId.set(null); this.docQuery.set(''); this.panel.set('');
  }
}
