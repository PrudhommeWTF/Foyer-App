import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';

interface Projet { id: string; name: string; rev: number; thumbnail: { pagecount: number; md5: string } | null; updatedAt: string; }
/** An example shipped with the editor: a ready-made project the child gets a copy of. */
interface Exemple { id: string; name: string; desc: string; image: string; json: unknown; }

/** Below this width the editor is not usable: the library stays, creation and editing go. */
const NARROW = '(max-width: 760px)';

/**
 * Atelier code : la bibliothèque de projets de celui qui est connecté. L'éditeur
 * lui-même est une page à part (atelier/petits/editor.html, code tiers adapté) :
 * cet écran crée, range et ouvre, il ne dessine aucun bloc.
 */
@Component({
  selector: 'screen-atelier',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="screen-enter">
      @if (narrow()) {
        <div class="note">Pour créer, ouvre l’Atelier sur l’iPad ou l’ordinateur.</div>
      } @else {
        <div class="head-row">
          <div class="count">@if (projets()?.length; as n) { {{ n }} projet{{ n > 1 ? 's' : '' }} }</div>
          <button class="btn btn-primary" [disabled]="busy()" (click)="creer()"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Nouveau projet</button>
        </div>
      }

      @if (erreur(); as e) {
        <div class="card empty"><div class="empty-title">L’Atelier ne répond pas</div><div class="empty-text">{{ e }}</div>
          <button class="btn btn-primary" (click)="charger()">Réessayer</button></div>
      } @else if (projets(); as liste) {
        @if (!liste.length) {
          <div class="card empty">
            <div class="empty-ico"><f-icon name="blocs" [size]="30" color="var(--ink3)" [width]="1.8" /></div>
            <div class="empty-title">Pas encore de projet</div>
            <div class="empty-text">Un projet, c’est une petite histoire : des personnages, un décor, et des blocs à emboîter pour les faire bouger.</div>
            @if (!narrow()) { <button class="btn btn-primary" [disabled]="busy()" (click)="creer()"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Créer mon premier projet</button> }
          </div>
        } @else {
          <div class="tiles">
            @for (p of liste; track p.id) {
              <div class="tile">
                @if (narrow()) {
                  <div class="thumb">@if (p.thumbnail; as t) { <img [src]="vignette(t.md5)" alt="" /> } @else { <f-icon name="blocs" [size]="34" color="var(--ink3)" [width]="1.6" /> }</div>
                } @else {
                  <button class="thumb" (click)="ouvrir(p.id)" [attr.aria-label]="'Ouvrir ' + p.name">@if (p.thumbnail; as t) { <img [src]="vignette(t.md5)" alt="" /> } @else { <f-icon name="blocs" [size]="34" color="var(--ink3)" [width]="1.6" /> }</button>
                }
                <div class="tname">{{ p.name }}</div>
                @if (!narrow()) {
                  <div class="acts">
                    <button (click)="renommer(p)" aria-label="Renommer" title="Renommer"><f-icon name="edit" [size]="17" color="var(--ink2)" [width]="2" /></button>
                    <button (click)="dupliquer(p)" aria-label="Dupliquer" title="Dupliquer"><f-icon name="copy" [size]="17" color="var(--ink2)" [width]="2" /></button>
                    <button (click)="supprimer(p)" aria-label="Supprimer" title="Supprimer"><f-icon name="trash" [size]="17" color="var(--ink2)" [width]="2" /></button>
                  </div>
                }
              </div>
            }
          </div>
        }
      }

      @if (!narrow() && exemples().length) {
        <div class="sep">Partir d’un exemple</div>
        <div class="tiles">
          @for (e of exemples(); track e.id) {
            <div class="tile">
              <button class="thumb" [disabled]="busy()" (click)="partirDe(e)" [attr.aria-label]="'Partir de l’exemple ' + e.name"><img [src]="exempleUrl(e.image)" alt="" /></button>
              <div class="tname">{{ e.name }}</div>
              <div class="tdesc">{{ e.desc }}</div>
            </div>
          }
        </div>
      }

      <details class="apropos">
        <summary>À propos de l’Atelier code</summary>
        <p>L’Atelier code est construit à partir du code source ouvert de ScratchJr, publié par le Massachusetts Institute of Technology sous licence BSD 3 clauses. Il est sans lien avec la Scratch Foundation ni approbation de sa part.
          <a [href]="exempleUrl('../LICENSE.txt')" target="_blank" rel="noopener">Texte de la licence</a></p>
        <p>Les personnages et les décors de la bibliothèque viennent de Scratch, sous licence Creative Commons Attribution-ShareAlike 2.0 : « Scratch is developed by the Lifelong Kindergarten Group at the MIT Media Lab. See http://scratch.mit.edu. »
          <a [href]="exempleUrl('../svglibrary/LICENCE.md')" target="_blank" rel="noopener">Détail et licence</a></p>
        <p>Boulon, le robot de l’Atelier, a été dessiné pour Foyer.</p>
      </details>
    </div>
  `,
  styles: [`
    .head-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 20px; min-height: 44px; }
    .count { font-family: var(--font-display); font-size: 18px; font-weight: 800; color: var(--ink); }
    .note { background: var(--surface); border-radius: 14px; padding: 14px 16px; margin-bottom: 18px; font-size: 14px; font-weight: 700; color: var(--ink2); }
    .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
    .tile { background: var(--surface); border-radius: 18px; padding: 10px; box-shadow: 0 8px 20px -18px rgba(90,60,40,.7); }
    .thumb { display: flex; align-items: center; justify-content: center; width: 100%; aspect-ratio: 4 / 3; border: none; border-radius: 12px; background: #F5F2F7; overflow: hidden; padding: 0; }
    button.thumb { cursor: pointer; }
    button.thumb:active { transform: scale(.98); }
    .thumb img { width: 100%; height: 100%; object-fit: contain; }
    .tname { margin: 10px 4px 4px; font-weight: 800; font-size: 15px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tdesc { margin: 0 4px 6px; font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.4; }
    .sep { display: flex; align-items: center; gap: 12px; margin: 28px 0 16px; font-size: 13px; font-weight: 800; color: var(--ink3); }
    .sep::before, .sep::after { content: ''; flex: 1; height: 1px; background: var(--line2); }
    .apropos { margin-top: 32px; font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.55; }
    .apropos summary { cursor: pointer; font-weight: 800; color: var(--ink3); padding: 8px 0; }
    .apropos p { margin: 8px 0; max-width: 640px; }
    .apropos a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
    .acts { display: flex; gap: 4px; }
    .acts button { width: 44px; height: 44px; border: none; border-radius: 12px; background: none; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .acts button:hover { background: var(--line2); }
    .card.empty { padding: 44px 24px; text-align: center; border-radius: 20px; background: var(--surface); box-shadow: 0 8px 20px -18px rgba(90,60,40,.7); }
    .empty-ico { display: flex; justify-content: center; margin-bottom: 12px; }
    .empty-title { font-family: var(--font-display); font-size: 19px; font-weight: 800; color: var(--ink); margin-bottom: 6px; }
    .empty-text { font-size: 14px; font-weight: 600; color: var(--ink2); max-width: 420px; margin: 0 auto 18px; line-height: 1.5; }
  `],
})
export class AtelierScreen {
  private readonly api = inject(ApiService);
  private readonly store = inject(FoyerStore);

  readonly projets = signal<Projet[] | null>(null);
  readonly erreur = signal('');
  readonly busy = signal(false);
  readonly narrow = signal(false);
  readonly exemples = signal<Exemple[]>([]);

  constructor() {
    try {
      const mq = matchMedia(NARROW), on = (): void => this.narrow.set(mq.matches);
      on(); mq.addEventListener('change', on);
      inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', on));
    } catch { /* no matchMedia: the wide layout stays */ }
    void this.charger();
    // Shipped with the editor, as a static file: no example, no section.
    fetch(this.exempleUrl('exemples.json')).then((r) => (r.ok ? r.json() : [])).then((l: Exemple[]) => this.exemples.set(l)).catch(() => { /* offline: the section stays hidden */ });
  }

  async charger(): Promise<void> {
    this.erreur.set('');
    try { this.projets.set((await this.api.request<{ projets: Projet[] }>('atelier/projets')).projets); }
    catch (e) { this.erreur.set((e as Error).message); }
  }

  /** The editor is a page of its own, served next to the application. */
  ouvrir(id: string): void { location.href = new URL(`atelier/petits/editor.html?pmd5=${encodeURIComponent(id)}&mode=edit`, document.baseURI).href; }
  exempleUrl(file: string): string { return new URL(`atelier/petits/samples/${file}`, document.baseURI).href; }
  vignette(name: string): string { return new URL(`api/atelier/medias/${encodeURIComponent(name)}`, document.baseURI).href; }

  private async agir(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await fn(); } catch (e) { this.store.toast((e as Error).message); } finally { this.busy.set(false); }
  }

  creer(): Promise<void> {
    return this.agir(async () => {
      const n = (this.projets()?.length ?? 0) + 1;
      const { projet } = await this.api.post<{ projet: Projet }>('atelier/projets', { name: `Projet ${n}`, level: 'petits' });
      this.ouvrir(projet.id);
    });
  }
  /** The child never edits the example itself: a project of their own is created from it. */
  partirDe(e: Exemple): Promise<void> {
    return this.agir(async () => {
      const { projet } = await this.api.post<{ projet: Projet }>('atelier/projets', { name: e.name, level: 'petits' });
      // The picture of the example becomes the first thumbnail of the copy; the editor replaces it at the first change.
      const image = await (await fetch(this.exempleUrl(e.image))).blob();
      const { name } = await this.api.upload<{ name: string }>('atelier/medias', new File([image], e.image));
      const pages = (e.json as { pages: unknown[] }).pages.length;
      await this.api.put(`atelier/projets/${projet.id}`, { rev: projet.rev, name: e.name, json: JSON.stringify(e.json), thumbnail: JSON.stringify({ pagecount: pages, md5: name }) });
      this.ouvrir(projet.id);
    });
  }
  renommer(p: Projet): Promise<void> {
    const name = prompt('Le nom du projet :', p.name)?.trim();
    if (!name || name === p.name) return Promise.resolve();
    return this.agir(async () => { await this.api.request(`atelier/projets/${p.id}`, { method: 'PATCH', body: JSON.stringify({ name: name.slice(0, 80) }) }); await this.charger(); });
  }
  dupliquer(p: Projet): Promise<void> {
    return this.agir(async () => { await this.api.post(`atelier/projets/${p.id}/copie`, { name: `${p.name} (copie)`.slice(0, 80) }); await this.charger(); });
  }
  supprimer(p: Projet): Promise<void> {
    if (!confirm(`Supprimer « ${p.name} » ? Un parent pourra le retrouver pendant quelque temps.`)) return Promise.resolve();
    return this.agir(async () => { await this.api.del(`atelier/projets/${p.id}`); await this.charger(); });
  }
}
