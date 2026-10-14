import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { FoyerStore } from '../core/foyer.store';
import { IconComponent } from '../core/icon';
import { SheetComponent } from '../shared/sheet';
import { relTime } from '../core/activity';
import { ITEM_KINDS, ItemChoice, ItemForm, ItemKindId, ItemResult } from '../core/items';
import { sheetDepth } from '../core/item-sheet';
import { ITEM_REGISTRY } from './item-registry';

interface Ask { question: string; choices: ItemChoice[]; action: 'save' | 'remove'; }

/**
 * La fiche d'élément, rendue par le shell au-dessus de n'importe quel écran.
 * Elle ne connaît aucun module : elle lit le descripteur du type dans le
 * registre, affiche sa vue ou son formulaire, et porte ce qui est commun à
 * tous (Modifier, Supprimer, Sauvegarder, Annuler, « Ouvrir dans … », le
 * geste retour, Échap, l'élément disparu, la modification venue d'ailleurs).
 */
@Component({
  selector: 'app-item-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SheetComponent, NgComponentOutlet, IconComponent],
  template: `
    @if (ref(); as r) {
      <f-sheet [heading]="heading()" [kicker]="r.mode === 'vue' && item() ? meta().label : ''" [full]="r.mode === 'edition'"
               (close)="requestClose()" (back)="requestBack()">
        @if (gone()) {
          <div class="gone">
            <f-icon name="trash" [size]="22" color="var(--ink3)" [width]="2" />
            <div class="g-main">Cet élément n’existe plus.</div>
            <div class="g-sub">Il a été supprimé, peut-être depuis un autre appareil.</div>
          </div>
        } @else if (r.mode === 'vue') {
          <ng-container *ngComponentOutlet="desc().view; inputs: { item: item(), ctx: r.ctx }" />
          @if (openInShown()) {
            <button type="button" class="open-in" (click)="openIn()">{{ target().label }} <f-icon name="chevronRight" [size]="15" color="currentColor" [width]="2.4" /></button>
          }
        } @else {
          @if (remote(); as rm) {
            <div class="remote" role="status"><f-icon name="refresh" [size]="15" color="#C6492F" [width]="2.4" /> {{ rm }}</div>
          }
          <ng-container *ngComponentOutlet="desc().form!; inputs: { item: item(), ctx: r.ctx }" />
        }

        <div sheetFoot class="foot">
          @if (ask(); as q) {
            <div class="q">{{ q.question }}</div>
            <div class="row wrap">
              @for (c of q.choices; track c.scope) {
                <button type="button" class="btn" [class.btn-danger]="c.danger" [class.btn-primary]="!c.danger" [disabled]="busy()" (click)="answer(c.scope)">{{ c.label }}</button>
              }
              <button type="button" class="btn btn-soft" (click)="ask.set(null)">Annuler</button>
            </div>
          } @else if (discard()) {
            <div class="q">Abandonner les modifications ?</div>
            <div class="row">
              <button type="button" class="btn btn-soft" (click)="discard.set(null)">Non, continuer</button>
              <button type="button" class="btn btn-danger" (click)="confirmDiscard()">Abandonner</button>
            </div>
          } @else if (overwrite()) {
            <div class="q">Quelqu’un l’a modifié entre-temps sur un autre appareil. Enregistrer quand même, par-dessus ?</div>
            <div class="row">
              <button type="button" class="btn btn-soft" (click)="overwrite.set(false)">Annuler</button>
              <button type="button" class="btn btn-danger" (click)="overwrite.set(false); void save(undefined, true)">Écraser</button>
            </div>
          } @else if (gone()) {
            <div class="row"><button type="button" class="btn btn-primary grow" (click)="store.closeItem()">Fermer</button></div>
          } @else if (r.mode === 'vue') {
            <div class="row wrap">
              @if (canRemove()) {
                <button type="button" class="btn btn-ghost del" [disabled]="busy()" (click)="void remove()"><f-icon name="trash" [size]="16" color="currentColor" [width]="2.2" /> {{ meta().removeLabel || 'Supprimer' }}</button>
              }
              @for (a of actions(); track a.label) {
                <button type="button" class="btn" [class.btn-primary]="!canEdit()" [class.btn-soft]="canEdit()" (click)="a.run()"><f-icon [name]="a.icon" [size]="16" color="currentColor" [width]="2.4" /> {{ a.label }}</button>
              }
              @if (canEdit()) {
                <button type="button" class="btn btn-primary grow" (click)="edit()"><f-icon name="edit" [size]="16" color="#fff" [width]="2.2" /> Modifier</button>
              }
            </div>
          } @else {
            <div class="row">
              <button type="button" class="btn btn-soft" (click)="cancelEdit()">Annuler</button>
              <button type="button" class="btn btn-primary grow" [disabled]="busy()" (click)="void save()">{{ r.id ? 'Sauvegarder' : 'Créer' }}</button>
            </div>
          }
        </div>
      </f-sheet>
    }
  `,
  styles: [`
    .gone { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 26px 0 18px; }
    .g-main { font-size: 15.5px; font-weight: 800; color: var(--ink); }
    .g-sub { font-size: 13px; font-weight: 700; color: var(--ink2); }
    .open-in { display: inline-flex; align-items: center; gap: 4px; margin: 14px 0 4px; padding: 0; border: none; background: none;
               font: inherit; font-size: 13.5px; font-weight: 800; color: var(--primary); cursor: pointer; }
    .remote { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; padding: 10px 12px; border-radius: 12px;
              background: #FCE9E3; color: #C6492F; font-size: 12.5px; font-weight: 800; }
    .foot .q { font-size: 13.5px; font-weight: 800; color: var(--ink); margin-bottom: 10px; }
    .foot .row { display: flex; gap: 10px; align-items: center; }
    .foot .row.wrap { flex-wrap: wrap; }
    .foot .row.wrap .btn { flex: 1 1 auto; }
    .foot .grow { flex: 1; justify-content: center; }
    .foot .btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; }
    .del { color: var(--primary); }
  `],
})
export class ItemSheetComponent {
  readonly store = inject(FoyerStore);

  readonly ref = computed(() => this.store.ui().item);
  readonly desc = computed(() => ITEM_REGISTRY[this.ref()!.kind]);
  readonly meta = computed(() => this.desc().meta);
  /** L'élément, relu dans le store à chaque changement : la fiche suit ce que fait l'autre téléphone. */
  readonly item = computed(() => { const r = this.ref(); return r?.id ? this.desc().load(this.store, r.id, r.ctx) : null; });
  /** Ouvert, puis supprimé ailleurs (ou jamais trouvé) : on le dit, plutôt qu'une fiche vide. */
  readonly gone = computed(() => !!this.ref()?.id && !this.item());
  readonly heading = computed(() => {
    const r = this.ref()!, it = this.item();
    if (this.gone()) return 'Élément introuvable';
    if (r.mode === 'edition') return r.id ? this.meta().editTitle : this.meta().newTitle;
    return it ? this.desc().title(it) : '';
  });
  /** Où « Ouvrir dans … » emmène : le module du type, sauf avis contraire de l'élément. */
  readonly target = computed(() => { const it = this.item(); return (it && this.desc().openTarget?.(it, this.store)) || { label: this.meta().openLabel, screen: this.meta().screen }; });
  /** Inutile quand on y est déjà. */
  readonly openInShown = computed(() => this.store.ui().screen !== this.target().screen);
  /** Modifier et Supprimer, seulement quand ils ont un effet. */
  readonly canEdit = computed(() => { const it = this.item(); return !!it && this.meta().editable && !!this.desc().form && (this.desc().canEdit?.(it, this.store) ?? true); });
  readonly canRemove = computed(() => { const it = this.item(); return !!it && !!this.desc().remove && (this.desc().canRemove?.(it, this.store) ?? true); });
  /** Les actions propres au type (« Fait »…), sur l'élément tel qu'il est maintenant. */
  readonly actions = computed(() => { const r = this.ref(), it = this.item(); return r && it ? this.desc().actions?.(this.store, it, r.ctx) ?? [] : []; });

  // ---- états passagers de la fiche, remis à zéro à chaque changement de fiche ----
  readonly ask = signal<Ask | null>(null);
  readonly discard = signal<'back' | 'close' | null>(null);
  readonly overwrite = signal(false);
  /** L'empreinte de l'élément au moment de passer en édition. */
  private readonly baseline = signal('');

  private readonly outlet = viewChild(NgComponentOutlet);
  private form(): ItemForm | null { return (this.outlet()?.componentInstance as ItemForm | undefined) ?? null; }
  private dirty(): boolean { return this.ref()?.mode === 'edition' && !!this.form()?.dirty(); }

  /** Modifié ailleurs pendant qu'on l'édite : par qui, et quand. */
  readonly remote = computed(() => {
    const r = this.ref(), it = this.item(), base = this.baseline();
    if (r?.mode !== 'edition' || !it || !base || this.desc().fingerprint(it) === base) return '';
    const c = this.desc().changedBy?.(it);
    const who = c?.by ? this.store.memberName(c.by) : '';
    return 'Modifié' + (who ? ' par ' + who : ' ailleurs') + (c?.at ? ' ' + relTime(c.at, Date.now()) : '') + ' pendant votre saisie.';
  });

  constructor() {
    // Une autre fiche, ou l'autre mode de la même : on repart propre.
    effect(() => {
      const r = this.ref();
      const key = r ? `${r.kind}|${r.id}|${r.mode}` : '';
      untracked(() => {
        this.ask.set(null); this.discard.set(null); this.overwrite.set(false);
        const it = this.item();
        this.baseline.set(key && r!.mode === 'edition' && it ? this.desc().fingerprint(it) : '');
      });
    });
    // L'historique suit la profondeur de la fiche ; le focus revient à qui l'a ouverte.
    effect(() => {
      const r = this.ref();
      const depth = sheetDepth(r);
      untracked(() => { this.syncHistory(depth); this.syncFocus(!!r); });
    });
    const onPop = (): void => this.onPop();
    window.addEventListener('popstate', onPop);
    // Ouverte depuis une notification : l'adresse « #fiche=task:<id> » quand l'app
    // était fermée (la fiche s'ouvre alors sur l'accueil), un message du service
    // worker quand elle était déjà ouverte (la fiche s'ouvre là où l'on est).
    const asked = /^#fiche=([a-z]+):(.+)$/.exec(location.hash);
    if (asked && asked[1] in ITEM_KINDS) {
      history.replaceState(history.state, '', location.pathname + location.search);
      this.store.patch({ screen: 'home' });
      this.store.openItem(asked[1] as ItemKindId, decodeURIComponent(asked[2]));
    }
    const onMessage = (e: MessageEvent): void => {
      const m = e.data as { type?: string; kind?: string; id?: string } | null;
      if (m?.type === 'foyer-fiche' && m.kind && m.kind in ITEM_KINDS && m.id) this.store.openItem(m.kind as ItemKindId, m.id);
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('popstate', onPop);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    });
  }

  // ---- le geste retour ------------------------------------------------------
  // Chaque niveau de la fiche (et l'édition) occupe une entrée d'historique : le
  // bouton retour d'Android ou le glissé de Safari reculent d'un cran dans la
  // fiche au lieu de quitter l'application. Fermer par un bouton consomme ces
  // entrées, pour que l'historique reste propre.
  private pushed = 0;
  private ignorePops = 0;

  private syncHistory(target: number): void {
    if (target > this.pushed) {
      while (this.pushed < target) { this.pushed++; history.pushState({ foyerSheet: this.pushed }, ''); }
    } else if (target < this.pushed) {
      const n = this.pushed - target;
      this.pushed = target;
      this.ignorePops++;
      history.go(-n);
    }
  }
  private onPop(): void {
    if (this.ignorePops) { this.ignorePops--; return; }
    if (!this.pushed) return;
    this.pushed--;
    this.requestBack(true);
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(e: Event): void {
    if (!this.ref()) return;
    e.preventDefault();
    if (this.ask() || this.discard() || this.overwrite()) { this.ask.set(null); this.discard.set(null); this.overwrite.set(false); return; }
    this.requestBack();
  }

  /** Retour d'un cran : de l'édition à la vue, de la vue à la fiche précédente ou à l'écran. */
  requestBack(fromHistory = false): void {
    if (this.dirty()) {
      // Le navigateur a déjà reculé : on remet l'entrée, la fiche reste en édition.
      if (fromHistory) { this.pushed++; history.pushState({ foyerSheet: this.pushed }, ''); }
      this.discard.set('back');
      return;
    }
    this.store.backItem();
  }
  requestClose(): void {
    if (this.dirty()) { this.discard.set('close'); return; }
    this.store.closeItem();
  }
  confirmDiscard(): void {
    const what = this.discard();
    this.discard.set(null);
    if (what === 'close') this.store.closeItem(); else this.store.backItem();
  }

  // ---- focus : posé dans la fiche à l'ouverture, rendu au déclencheur ---------
  private opener: HTMLElement | null = null;
  private open = false;
  private syncFocus(open: boolean): void {
    if (open && !this.open) {
      const a = document.activeElement;
      this.opener = a instanceof HTMLElement && a !== document.body ? a : null;
    } else if (!open && this.open) {
      const o = this.opener; this.opener = null;
      if (o?.isConnected) o.focus({ preventScroll: true });
    }
    this.open = open;
  }

  // ---- actions --------------------------------------------------------------
  edit(): void { this.store.editItem(); }
  /** « Annuler » : retour à la vue, l'élément tel qu'il était ; une création se referme. */
  cancelEdit(): void { this.store.backItem(); }

  async save(scope?: string, force = false): Promise<void> {
    // Relire avant d'écrire : ce que l'autre téléphone vient d'enregistrer ne
    // s'écrase qu'après l'avoir dit, et accepté.
    if (!force) {
      await this.store.refreshDocument();
      if (this.remote()) { this.overwrite.set(true); return; }
    }
    const form = this.form(); if (!form) return;
    await this.run(() => form.submit(scope), 'save');
  }
  async remove(scope?: string): Promise<void> {
    const r = this.ref(), it = this.item(), del = this.desc().remove; if (!r || !it || !del) return;
    await this.run(() => del(this.store, it, r.ctx, scope), 'remove');
  }
  answer(scope: string): void {
    const a = this.ask(); this.ask.set(null);
    if (a?.action === 'remove') void this.remove(scope); else void this.save(scope, true);
  }
  /**
   * Un module relationnel (l'employé à domicile) répond au serveur : la fiche
   * attend sa réponse, boutons grisés, et reste ouverte si elle refuse.
   */
  readonly busy = signal(false);
  private async run(fn: () => ItemResult | Promise<ItemResult>, action: Ask['action']): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { this.handle(await fn(), action); } finally { this.busy.set(false); }
  }
  private handle(res: ItemResult, action: Ask['action']): void {
    if (res.kind === 'ask') { this.ask.set({ question: res.question, choices: res.choices, action }); return; }
    if (res.kind !== 'done') return;
    // Enregistré : retour à la vue (une création se referme). Supprimé : la fiche
    // s'en va, vers la précédente s'il y en a une.
    if (action === 'save') this.store.itemSaved(res.id); else this.store.backItem();
  }

  openIn(): void {
    const r = this.ref(), it = this.item(); if (!r || !it) return;
    this.desc().openIn(this.store, it, r.ctx);
  }
}
