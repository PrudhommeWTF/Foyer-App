import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FoyerStore } from '../../core/foyer.store';
import { EntretienApi } from '../../core/entretien.api';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { CatalogueEntry, GesteDraft, bulkReady, catalogueByFamily, draftFromCatalogue, draftOf, freqLabel, draftRec, stockLabel } from '../../core/entretien';
import { REMIND_LABELS } from '../../core/tasks';
import { addDaysIso, normText } from '../../core/helpers';
import { occurrencesPerYear } from '../../core/recurrence';
import { fmtEuros, fmtEurosInt, parseEuros } from '../../core/finances.store';
import { Remind } from '../../core/models';
import { EquipementsStore } from '../../core/equipements.store';

/**
 * Créer ou modifier un geste d'entretien. À la création, on choisit d'abord
 * dans le catalogue (tout est prérempli : trois taps jusqu'au geste) ou on
 * part d'une fiche libre. Le catalogue propose, il n'impose rien : le geste
 * créé est une copie qu'on ajuste.
 */
@Component({
  selector: 'app-geste-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <f-modal [title]="titre()" [maxWidth]="520" [tall]="true" (close)="close.emit()">
      @if (choix()) {
        <!-- 1. Choisir dans le catalogue, ou partir d'une fiche libre. -->
        <button type="button" class="libre" (click)="choisir(null)">
          <f-icon name="plus" [size]="17" color="var(--primary)" [width]="2.6" /> Geste libre, sans modèle
        </button>
        <input class="input search" placeholder="Chercher : carafe, chaudière, filtre…" [ngModel]="q()" (ngModelChange)="q.set($event)" autocomplete="off" />
        <div class="hint top">Cochez-en plusieurs pour les créer d'un coup, ou touchez un geste pour l'ajuster avant.</div>
        @if (api.erreur()) { <div class="ko">{{ api.erreur() }}</div> }
        @else if (!api.catalogue()) { <div class="hint">Chargement du catalogue…</div> }
        @for (f of familles(); track f.famille) {
          <div class="field-label fam">{{ f.famille }}</div>
          @for (g of f.gestes; track g.id) {
            <div class="cat-row">
              <!-- La case : créer en lot. Pas pour un geste déjà là, ni pour une date fixe à choisir. -->
              @if (bulkReady(g) && !dejaLa(g.id)) {
                <input type="checkbox" class="pick" [checked]="coches().has(g.id)" (change)="cocher(g.id)" [attr.aria-label]="'Cocher ' + g.titre" />
              } @else { <span class="pick"></span> }
              <button type="button" class="cat" (click)="choisir(g)">
                <span class="cat-t">{{ g.titre }}</span>
                <span class="cat-s">{{ freq(g) }}@if (g.article) { · {{ g.article.nom }} }@if (dejaLa(g.id)) { <b class="deja"> · déjà dans vos gestes</b> } @else if (!bulkReady(g)) { <b class="adate"> · date à choisir dans sa fiche</b> }</span>
              </button>
            </div>
          }
        } @empty {
          @if (api.catalogue()) { <div class="hint">Rien ne correspond. Créez un geste libre.</div> }
        }
        @if (coches().size; as n) {
          <div class="f-act lot">
            @if (lotStock()) { <div class="hint lot-h">Les stocks partent de zéro : notez ce que vous avez avec « J'en ai racheté » sur chaque geste concerné.</div> }
            <button class="btn btn-soft" (click)="toutDecocher()">Tout décocher</button>
            <button class="btn btn-primary" (click)="creerLot()">Créer {{ n > 1 ? 'les ' + n + ' gestes' : 'le geste' }}</button>
          </div>
        }
      } @else {
        @let v = f();
        <div class="field-label">Le geste</div>
        <input class="input mb" placeholder="Ex : Carafe filtrante : changer la cartouche" [ngModel]="v.text" (ngModelChange)="set({ text: $event })" />

        <div class="field-label">Fréquence</div>
        <div class="seg wrap">
          <button type="button" [class.active]="!v.fixed && v.freq === 'weekly'" (click)="set({ fixed: false, freq: 'weekly' })">Semaines</button>
          <button type="button" [class.active]="!v.fixed && v.freq === 'monthly'" (click)="set({ fixed: false, freq: 'monthly' })">Mois</button>
          <button type="button" [class.active]="!v.fixed && v.freq === 'yearly'" (click)="set({ fixed: false, freq: 'yearly' })">Années</button>
          <button type="button" [class.active]="v.fixed" (click)="set({ fixed: true, fixedDate: v.fixedDate || store.todayStr() })">Date fixe</button>
        </div>
        <div class="every">
          <span>{{ v.fixed ? 'Tous les' : (v.freq === 'weekly' ? 'Toutes les' : 'Tous les') }}</span>
          <input class="input num" type="number" min="1" max="99" inputmode="numeric" [ngModel]="v.every" (ngModelChange)="set({ every: +$event || 1 })" aria-label="Nombre" />
          <span>{{ unite() }}</span>
        </div>
        <div class="hint">{{ v.fixed ? 'À date fixe : la visite de la chaudière, chaque octobre.' : 'À partir du jour où le geste est fait : trois jours de retard ne se traînent pas.' }} ({{ resume() }})</div>
        @if (v.fixed) {
          <div class="two">
            <label class="lab">À partir du<input class="input" type="date" [ngModel]="v.fixedDate" (ngModelChange)="set({ fixedDate: $event })" /></label>
            <label class="lab">Au plus tard le<input class="input" type="date" [min]="v.fixedDate" [ngModel]="finFenetre()" (ngModelChange)="setFin($event)" /></label>
          </div>
          <div class="hint">{{ v.grace ? 'Une fenêtre : le geste se fait entre ces deux dates, et n’est en retard qu’après la seconde.' : 'Sans date limite, le geste est en retard dès le lendemain.' }}</div>
        } @else {
          <label class="check"><input type="checkbox" [ngModel]="!!v.season" (ngModelChange)="set({ season: $event ? { from: '05-01', to: '09-30' } : null })" /> Seulement une partie de l’année</label>
          @if (v.season; as se) {
            <div class="every saison">
              <span>De</span>
              <select class="input" aria-label="Premier mois" [ngModel]="+se.from.slice(0, 2)" (ngModelChange)="setSaison(+$event, +se.to.slice(0, 2))">
                @for (m of mois; track $index) { <option [value]="$index + 1">{{ m }}</option> }
              </select>
              <span>à</span>
              <select class="input" aria-label="Dernier mois" [ngModel]="+se.to.slice(0, 2)" (ngModelChange)="setSaison(+se.from.slice(0, 2), +$event)">
                @for (m of mois; track $index) { <option [value]="$index + 1">{{ m }}</option> }
              </select>
            </div>
            <div class="hint">Hors saison, le geste ne revient pas et ne rappelle rien : il reprend au début de la saison suivante.</div>
          }
        }

        <div class="field-label">Pièce</div>
        <div class="chips">
          <button type="button" class="chip-o" [class.on]="!v.roomId && !roomNew().trim()" (click)="set({ roomId: null }); roomNew.set('')">Aucune</button>
          @for (r of store.rooms(); track r.id) {
            <button type="button" class="chip-o" [class.on]="v.roomId === r.id" (click)="set({ roomId: r.id }); roomNew.set('')">{{ r.name }}</button>
          }
        </div>
        <input class="input" [class.mb]="!roomNew().trim()" placeholder="Ou une nouvelle pièce : Garage, Jardin…" aria-label="Nouvelle pièce" [ngModel]="roomNew()" (ngModelChange)="roomNew.set($event); set({ roomId: null })" />
        @if (roomNew().trim()) { <div class="hint">La pièce « {{ roomNew().trim() }} » sera créée avec le geste.</div> }

        @if (store.modEquipements() && eqp.items().length) {
          <div class="field-label">Équipement <span class="opt">(facultatif)</span></div>
          <select class="input mb" [ngModel]="v.equipmentId ?? ''" (ngModelChange)="choisirEqp($event)" aria-label="Équipement">
            <option value="">Aucun</option>
            @for (e of eqp.items(); track e.id) { <option [value]="e.id">{{ e.name }}{{ e.roomName ? ' (' + e.roomName + ')' : '' }}</option> }
          </select>
        }

        <div class="field-label">Détail <span class="opt">(facultatif)</span></div>
        <textarea class="input mb" rows="2" placeholder="Ce qu'il faut savoir pour le faire" [ngModel]="v.howto" (ngModelChange)="set({ howto: $event })"></textarea>

        <label class="check"><input type="checkbox" [ngModel]="!!v.stock" (ngModelChange)="toggleStock($event)" /> Ce geste consomme quelque chose (cartouche, filtre, piles)</label>
        @if (v.stock; as st) {
          <div class="stock">
            <label class="lab">Article, tel qu'il ira dans les courses<input class="input" [ngModel]="st.article" (ngModelChange)="setStock({ article: $event })" placeholder="Cartouche Brita MAXTRA PRO" /></label>
            <div class="two">
              @if (stockActuel(); as s) {
                <div class="lab">En stock<div class="ro">{{ s }}</div></div>
              } @else {
                <label class="lab">En stock<input class="input" type="number" min="0" inputmode="numeric" [ngModel]="st.qty" (ngModelChange)="setStock({ qty: +$event || 0 })" /></label>
              }
              <label class="lab">Unité<input class="input" [ngModel]="st.unit" (ngModelChange)="setStock({ unit: $event })" placeholder="cartouche" /></label>
            </div>
            <div class="two">
              <label class="lab">Pris à chaque fois<input class="input" type="number" min="1" max="99" inputmode="numeric" [ngModel]="st.use" (ngModelChange)="setStock({ use: +$event || 1 })" /></label>
              <label class="lab">Racheter à partir de<input class="input" type="number" min="0" inputmode="numeric" [ngModel]="st.threshold" (ngModelChange)="setStock({ threshold: +$event || 0 })" /></label>
            </div>
          </div>
        }

        @if (!store.isChild()) {
          <div class="field-label">Coût <span class="opt">(facultatif, visible des adultes seulement)</span></div>
          @let contrats = store.modFinances() ? api.couts()?.contracts ?? [] : [];
          @if (contrats.length) {
            <select class="input mb-s" aria-label="Contrat qui couvre le geste" [ngModel]="contratId() ?? ''" (ngModelChange)="contratId.set($event ? +$event : null)">
              <option value="">Payé à chaque fois</option>
              @for (c of contrats; track c.id) { <option [value]="c.id">Couvert par le contrat « {{ c.name }} »{{ c.provider ? ' (' + c.provider + ')' : '' }}</option> }
            </select>
          }
          @if (contratId() === null) {
            <div class="every cout">
              <input class="input" inputmode="decimal" placeholder="0,00" aria-label="Coût à chaque fois, en euros" [ngModel]="cout()" (ngModelChange)="cout.set($event)" />
              <span>€ à chaque fois</span>
            </div>
            <div class="hint">{{ prevision() || 'La cartouche, le ramonage : noté à chaque réalisation, au prix du moment, et totalisé dans Finances.' }}</div>
          } @else {
            <div class="hint">Déjà compté dans le contrat : le geste n’ajoute rien à la dépense.</div>
          }
        }

        <div class="field-label">Qui s'en charge</div>
        <div class="chips">
          <button type="button" class="chip-o" [class.on]="!v.who.length" (click)="set({ who: [] })">Le premier qui passe</button>
          @for (m of store.d().members; track m.id) {
            <button type="button" class="chip-o" [class.on]="v.who.includes(m.id)" (click)="toggleWho(m.id)">{{ m.name }}</button>
          }
        </div>

        <div class="field-label">Rappel</div>
        <select class="input mb" [ngModel]="v.remind || ''" (ngModelChange)="set({ remind: ($event || null) })">
          <option value="">Aucun</option>
          @for (r of reminds; track r) { <option [value]="r">{{ REMIND_LABELS[r] }}</option> }
        </select>

        @if (!id() && !v.fixed) {
          <div class="field-label">Dernière fois</div>
          <div class="chips">
            <button type="button" class="chip-o" [class.on]="!v.lastDone" (click)="set({ lastDone: null })">Je ne sais pas</button>
            <button type="button" class="chip-o" [class.on]="!!v.lastDone" (click)="set({ lastDone: v.lastDone || store.todayStr() })">Je sais quand</button>
          </div>
          @if (v.lastDone) { <input class="input mb" type="date" [max]="store.todayStr()" [ngModel]="v.lastDone" (ngModelChange)="set({ lastDone: $event || null })" /> }
          @else { <div class="hint">Le geste restera « Pas encore noté », sans date ni rappel, jusqu'à la première fois.</div> }
        }

        @if (erreur()) { <div class="ko">{{ erreur() }}</div> }
        <div class="f-act">
          <button class="btn btn-soft" (click)="id() ? close.emit() : retour()">{{ id() ? 'Annuler' : 'Retour' }}</button>
          <button class="btn btn-primary" (click)="valider()">{{ id() ? 'Enregistrer' : 'Créer le geste' }}</button>
        </div>
      }
    </f-modal>
  `,
  styles: [`
    .mb { margin-bottom: 18px; }
    .opt { color: var(--ink3); font-weight: 700; text-transform: none; letter-spacing: 0; }
    .hint { font-size: 12.5px; font-weight: 600; color: var(--ink3); line-height: 1.45; margin: 8px 0 18px; }
    .ko { font-size: 12.5px; font-weight: 800; color: #C6492F; margin: 8px 0; }
    .libre { display: flex; align-items: center; gap: 8px; width: 100%; border: 2px dashed var(--line2); background: none; border-radius: 13px; padding: 13px 14px; font: inherit; font-size: 14px; font-weight: 800; color: var(--primary); cursor: pointer; margin-bottom: 12px; }
    .search { margin-bottom: 6px; }
    .hint.top { margin: 4px 0 6px; }
    .cat-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
    .cat-row .cat { flex: 1; min-width: 0; margin-bottom: 0; }
    .pick { flex: none; width: 22px; height: 22px; margin: 0; accent-color: var(--primary); cursor: pointer; }
    span.pick { cursor: default; }
    .adate { color: var(--ink2); font-weight: 800; }
    .fam { margin-top: 16px; }
    .cat { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; border: none; background: var(--soft); border-radius: 12px; padding: 11px 13px; margin-bottom: 6px; font: inherit; cursor: pointer; }
    .cat-t { font-size: 14.5px; font-weight: 800; color: var(--ink); }
    .cat-s { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .deja { color: var(--sage); font-weight: 800; }
    .seg.wrap { flex-wrap: wrap; }
    .every { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 14px; font-weight: 800; color: var(--ink2); }
    .num { width: 82px; text-align: center; }
    .mb-s { margin-bottom: 10px; }
    .cout { margin-top: 0; }
    .cout .input { width: 120px; text-align: right; }
    .saison { margin: 0 0 4px; }
    .saison select { flex: 1; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
    .lab { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 800; color: var(--ink2); min-width: 0; }
    .lab .input { min-width: 0; width: 100%; box-sizing: border-box; }
    .ro { padding: 13px 0; font-size: 13.5px; font-weight: 700; color: var(--ink); }
    .chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
    .chip-o { border: 2px solid var(--line); background: var(--surface); border-radius: 11px; padding: 8px 12px; font: inherit; font-size: 13px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .chip-o.on { border-color: var(--primary); color: var(--primary); }
    .check { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; color: var(--ink); margin-bottom: 14px; cursor: pointer; }
    .check input { width: 20px; height: 20px; accent-color: var(--primary); }
    .stock { background: var(--soft); border-radius: 13px; padding: 12px; margin-bottom: 18px; display: flex; flex-direction: column; gap: 10px; }
    .stock .two { margin-bottom: 0; }
    /* Toujours à portée de pouce : créer depuis le catalogue tient en trois taps, sans faire défiler. */
    .f-act { display: flex; gap: 8px; margin-top: 22px; position: sticky; bottom: -1px; padding: 12px 0 4px; background: var(--surface); }
    .f-act .btn { flex: 1; }
    .f-act.lot { flex-wrap: wrap; }
    .lot-h { flex-basis: 100%; margin: 0 0 4px; }
  `],
})
export class GesteForm implements OnInit {
  readonly store = inject(FoyerStore);
  readonly api = inject(EntretienApi);
  readonly eqp = inject(EquipementsStore);
  /** Le geste à modifier ; null pour en créer un. */
  readonly id = input<string | null>(null);
  readonly close = output<void>();
  readonly REMIND_LABELS = REMIND_LABELS;
  readonly reminds: Remind[] = ['morning', 'eve', 'at'];
  readonly mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  readonly choix = signal(false);
  readonly q = signal('');
  readonly f = signal<GesteDraft>(draftFromCatalogue(null, '', null));
  /** Une pièce à créer à l'enregistrement, quand celle du catalogue (ou saisie) n'existe pas encore. */
  readonly roomNew = signal('');
  readonly erreur = signal('');
  /** Le coût saisi, en euros (texte), et le contrat qui couvre le geste. Adultes seulement. */
  readonly cout = signal('');
  readonly contratId = signal<number | null>(null);
  private coutInitial = '';
  private contratInitial: number | null = null;
  /** « Environ 195 € par an (13 fois) », d'après la fréquence saisie. */
  readonly prevision = computed(() => {
    const c = parseEuros(this.cout());
    if (!c || c <= 0) return '';
    const n = occurrencesPerYear(draftRec(this.f()), this.f().fixedDate || this.store.todayStr());
    const fois = Math.round(n * 10) / 10;
    return `Environ ${fmtEurosInt(Math.round(c * n))} € par an (${String(fois).replace('.', ',')} fois).`;
  });

  readonly titre = computed(() => (this.id() ? 'Modifier le geste' : 'Nouveau geste'));
  readonly familles = computed(() => { const c = this.api.catalogue(); return c ? catalogueByFamily(c, this.q()) : []; });
  readonly unite = computed(() => { const v = this.f(); return v.fixed || v.freq === 'yearly' ? 'ans' : v.freq === 'weekly' ? 'semaines' : 'mois'; });
  readonly resume = computed(() => freqLabel(draftRec(this.f())));
  /** Le stock d'un geste existant ne se réécrit pas ici : on le montre tel qu'il est. */
  readonly stockActuel = computed(() => { const s = this.id() ? this.store.task(this.id()!)?.maintenance?.stock : undefined; return s ? stockLabel(s, (d) => this.store.fmtNumDate(d)) : ''; });

  ngOnInit(): void {
    const t = this.id() ? this.store.task(this.id()!) : undefined;
    if (!this.store.isChild()) void this.api.chargerCouts().then(() => this.lireCout());
    if (t) { this.f.set(draftOf(t)); return; }
    this.choix.set(true);
    void this.api.charger();
  }

  private lireCout(): void {
    const c = this.id() ? this.api.cout(this.id()!) : undefined;
    this.coutInitial = c?.amount ? fmtEuros(c.amount) : '';
    this.contratInitial = c?.contractId ?? null;
    this.cout.set(this.coutInitial); this.contratId.set(this.contratInitial);
  }

  freq(g: CatalogueEntry): string { return freqLabel({ freq: g.rec.freq, every: g.rec.every, base: g.rec.base }); }
  dejaLa(catalogId: string): boolean { return this.store.gestes().some((t) => t.maintenance?.catalogId === catalogId); }
  readonly bulkReady = bulkReady;
  /** Les gestes du catalogue cochés, à créer d'un coup. */
  readonly coches = signal<Set<string>>(new Set());
  cocher(id: string): void { this.coches.update((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; }); }
  /** Un des gestes cochés consomme quelque chose : sa quantité n'est pas connue. */
  readonly lotStock = computed(() => (this.api.catalogue()?.gestes || []).some((g) => this.coches().has(g.id) && !!g.article));
  toutDecocher(): void { this.coches.set(new Set()); }
  creerLot(): void {
    const c = this.api.catalogue(); if (!c) return;
    this.store.createGestesFromCatalogue(c.gestes.filter((g) => this.coches().has(g.id)));
    this.close.emit();
  }

  /** Une ligne du catalogue (ou rien : geste libre) préremplit la fiche ; sa pièce est retrouvée par son nom, sinon proposée à la création. */
  choisir(g: CatalogueEntry | null): void {
    const room = g?.piece ? this.store.rooms().find((r) => normText(r.name) === normText(g.piece!)) : undefined;
    this.f.set(draftFromCatalogue(g, this.store.todayStr(), room?.id ?? null));
    this.roomNew.set(g?.piece && !room ? g.piece : '');
    this.choix.set(false);
  }
  retour(): void { this.erreur.set(''); this.choix.set(true); void this.api.charger(); }

  set(p: Partial<GesteDraft>): void { this.f.update((f) => ({ ...f, ...p })); }
  setStock(p: Partial<NonNullable<GesteDraft['stock']>>): void { this.f.update((f) => (f.stock ? { ...f, stock: { ...f.stock, ...p } } : f)); }
  toggleStock(on: boolean): void { this.set({ stock: on ? { qty: 0, unit: '', use: 1, threshold: 1, article: '' } : null }); }
  /** Un appareil choisi range aussi le geste dans sa pièce, quand aucune n'est encore choisie. */
  choisirEqp(v: string): void {
    const id = v ? +v : null;
    const room = id ? this.eqp.find(id)?.roomId ?? null : null;
    this.set({ equipmentId: id, ...(room && !this.f().roomId && !this.roomNew().trim() ? { roomId: room } : {}) });
  }
  /** La fin de fenêtre d'un geste à date fixe : sa date plus la souplesse. */
  readonly finFenetre = computed(() => { const v = this.f(); return v.fixedDate && v.grace ? addDaysIso(v.fixedDate, v.grace) : ''; });
  setFin(iso: string): void {
    const v = this.f();
    const g = iso && v.fixedDate ? Math.round((Date.parse(iso) - Date.parse(v.fixedDate)) / 86400000) : 0;
    this.set({ grace: Math.max(0, Math.min(365, g)) });
  }
  /** Une saison en mois entiers : du 1er du premier mois au dernier jour du second (le 29 février compte). */
  setSaison(a: number, b: number): void {
    const p = (n: number): string => String(n).padStart(2, '0');
    this.set({ season: { from: `${p(a)}-01`, to: `${p(b)}-${p(new Date(Date.UTC(2024, b, 0)).getUTCDate())}` } });
  }
  toggleWho(id: string): void { const w = this.f().who; this.set({ who: w.includes(id) ? w.filter((x) => x !== id) : [...w, id] }); }

  valider(): void {
    const v = this.f();
    if (!v.text.trim()) { this.erreur.set('Dites quel est le geste.'); return; }
    if (v.fixed && !v.fixedDate) { this.erreur.set('Une date fixe demande la prochaine date.'); return; }
    if (v.stock && !v.stock.article.trim()) { this.erreur.set('Dites ce que le geste consomme, ou décochez le stock.'); return; }
    const montant = this.contratId() === null && this.cout().trim() ? parseEuros(this.cout()) : null;
    if (this.contratId() === null && this.cout().trim() && (montant === null || montant <= 0)) { this.erreur.set('Un coût s’écrit en euros : 15 ou 15,90.'); return; }
    const roomId = this.roomNew().trim() ? this.store.ensureRoom(this.roomNew()) : v.roomId;
    const d = { ...v, roomId };
    const chiffrer = !this.store.isChild() && (this.cout().trim() !== this.coutInitial || this.contratId() !== this.contratInitial);
    const enregistrer = (id: string): Promise<void> => this.api.setCout(id, montant, this.contratId(), () => this.store.flushTaskQueue())
      .then((ok) => { if (!ok) this.store.toast('Le coût n’a pas pu être enregistré : réessayez une fois en ligne.'); });
    if (this.id()) { this.store.saveGeste(this.id()!, d); if (chiffrer) void enregistrer(this.id()!); }
    else this.store.createGeste(d, chiffrer ? enregistrer : undefined);
    this.close.emit();
  }
}
