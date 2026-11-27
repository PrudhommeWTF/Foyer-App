import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { AtelierStore } from '../../core/atelier/store';
import { Defi, NIVEAU, NIVEAUX, Niveau, Projet, levelsLine, roomLine } from '../../core/atelier/atelier';
import { AtelierAide } from './aide';
/** An example shipped with the editor: a ready-made project the child gets a copy of. */
interface Exemple { id: string; name: string; desc: string; image: string; json: unknown; }

/** Below this width the editor is not usable: the library stays, creation and editing go. */
const NARROW = '(max-width: 760px)';

/**
 * Atelier code : la bibliothèque de projets de celui qui est connecté. Les deux
 * éditeurs (petits et grands codeurs) sont des pages à part (atelier/<niveau>/editor.html,
 * code tiers adapté) : cet écran crée, range et ouvre, il ne dessine aucun bloc.
 *
 * Un adulte y trouve aussi un onglet par autre membre : ses projets en lecture
 * seule, ceux qu'il a supprimés (à restaurer) et la place qu'il occupe. Chacun
 * y voit les projets que les autres partagent, et peut en faire une copie.
 */
/** What it takes to open a project in its editor. */
type Ouvrable = { id: string; level: Niveau; defi?: string | null };

@Component({
  selector: 'screen-atelier',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, AtelierAide],
  template: `
    <div class="screen-enter">
      @if (!store.isChild() && atelier.members().length) {
        <div class="tabs" role="tablist">
          <button role="tab" [class.on]="!who()" [attr.aria-selected]="!who()" (click)="voir(null)">Mes projets</button>
          @for (m of atelier.members(); track m.id) {
            <button role="tab" [class.on]="who() === m.id" [attr.aria-selected]="who() === m.id" (click)="voir(m.id)">{{ m.name }}</button>
          }
        </div>
      }

      @if (membre(); as m) {
        <!-- Un autre membre, vu par un adulte : tout se regarde, rien ne se modifie. -->
        <div class="head-row">
          <div class="count">{{ m.projets ? m.projets + ' projet' + (m.projets > 1 ? 's' : '') : 'Pas encore de projet' }}</div>
          <div class="room">{{ room(m.octets) }}</div>
        </div>
        @if (m.enfant) {
          <div class="lv">
            <span class="lv-l">{{ m.name }} peut créer dans :</span>
            @for (c of choixNiveaux; track c.label) {
              <button [class.on]="memes(m.niveaux, c.levels)" [attr.aria-pressed]="memes(m.niveaux, c.levels)" [disabled]="busy()" (click)="regler(m.id, c.levels)">{{ c.label }}</button>
            }
          </div>
        }
        @if (autres(); as liste) {
          <div class="tiles">
            @for (p of liste; track p.id) {
              <div class="tile">
                <button class="thumb" (click)="regarder(p)" [attr.aria-label]="'Regarder ' + p.name">@if (p.thumbnail; as t) { <img [src]="vignette(t.md5, p.memberId)" alt="" /> } @else { <f-icon name="blocs" [size]="34" color="var(--ink3)" [width]="1.6" /> }</button>
                <div class="tname">{{ p.name }}</div>
                <div class="tlevel">{{ niveau(p) }}@if (p.shared) { · partagé }</div>
                @if (!narrow()) {
                  <div class="acts"><button (click)="ouvrir(p)" aria-label="Voir les blocs" title="Voir les blocs, sans rien modifier"><f-icon name="eye" [size]="17" color="var(--ink2)" [width]="2" /></button></div>
                }
              </div>
            }
          </div>
          @if (corbeille().length) {
            <div class="sep">Supprimés, à restaurer pendant {{ store.setting('atelierCorbeilleJours') }} jours</div>
            <div class="tiles">
              @for (p of corbeille(); track p.id) {
                <div class="tile">
                  <div class="thumb">@if (p.thumbnail; as t) { <img [src]="vignette(t.md5, p.memberId)" alt="" /> } @else { <f-icon name="blocs" [size]="34" color="var(--ink3)" [width]="1.6" /> }</div>
                  <div class="tname">{{ p.name }}</div>
                  <div class="tlevel">{{ niveau(p) }}</div>
                  <button class="btn btn-ghost restore" [disabled]="busy()" (click)="restaurer(p)"><f-icon name="refresh" [size]="16" color="var(--ink2)" [width]="2" /> Restaurer</button>
                </div>
              }
            </div>
          }
        } @else if (erreur(); as e) {
          <div class="card empty"><div class="empty-title">L’Atelier ne répond pas</div><div class="empty-text">{{ e }}</div><button class="btn btn-primary" (click)="voir(m.id)">Réessayer</button></div>
        }
      } @else {
      @if (narrow()) {
        <div class="note">Ici, tu peux regarder tes projets. Pour créer, ouvre l’Atelier sur l’iPad ou l’ordinateur.</div>
      } @else {
        <div class="head-row">
          <div class="count">@if (projets()?.length; as n) { {{ n }} projet{{ n > 1 ? 's' : '' }} }</div>
          <button class="btn btn-primary" [disabled]="busy()" (click)="nouveau()" [attr.aria-expanded]="deux() ? choix() : null"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Nouveau projet</button>
        </div>
        @if (choix() && deux()) {
          <div class="niveaux">
            <button class="niveau" [disabled]="busy()" (click)="creer('petits')">
              <span class="ntitle">Petits codeurs</span>
              <span class="ndesc">Des blocs en images à emboîter, pour raconter une histoire. Pas besoin de savoir lire.</span>
            </button>
            <button class="niveau" [disabled]="busy()" (click)="creer('grands')">
              <span class="ntitle">Grands codeurs</span>
              <span class="ndesc">Des blocs écrits, des variables et des conditions, pour fabriquer un jeu ou une animation.</span>
            </button>
          </div>
        }
      }

      @if (erreur(); as e) {
        <div class="card empty">
          @if (dernier(); as d) {
            <div class="empty-title">Pas de réseau</div>
            <div class="empty-text">La liste de tes projets n’est pas disponible, mais tu peux continuer « {{ d.name }} » : il s’enregistrera au retour du réseau.</div>
            <button class="btn btn-primary" (click)="narrow() ? regarder(d) : ouvrir(d)">Continuer « {{ d.name }} »</button>
          } @else {
            <div class="empty-title">L’Atelier ne répond pas</div><div class="empty-text">{{ e }}</div>
            <button class="btn btn-primary" (click)="charger()">Réessayer</button>
          }
        </div>
      } @else if (projets(); as liste) {
        @if (!liste.length) {
          <div class="card empty">
            <div class="empty-ico"><f-icon name="blocs" [size]="30" color="var(--ink3)" [width]="1.8" /></div>
            <div class="empty-title">Pas encore de projet</div>
            <div class="empty-text">Un projet, c’est une petite histoire : des personnages, un décor, et des blocs à emboîter pour les faire bouger.</div>
            @if (!narrow()) { <button class="btn btn-primary" [disabled]="busy()" (click)="nouveau()"><f-icon name="plus" [size]="18" color="#fff" [width]="2.4" /> Créer mon premier projet</button> }
          </div>
        } @else {
          <div class="tiles">
            @for (p of liste; track p.id) {
              <div class="tile">
                @if (narrow()) {
                  <button class="thumb" (click)="regarder(p)" [attr.aria-label]="'Regarder ' + p.name">@if (p.thumbnail; as t) { <img [src]="vignette(t.md5)" alt="" /> } @else { <f-icon name="blocs" [size]="34" color="var(--ink3)" [width]="1.6" /> }</button>
                } @else {
                  <button class="thumb" (click)="ouvrir(p)" [attr.aria-label]="'Ouvrir ' + p.name">@if (p.thumbnail; as t) { <img [src]="vignette(t.md5)" alt="" /> } @else { <f-icon name="blocs" [size]="34" color="var(--ink3)" [width]="1.6" /> }</button>
                }
                <div class="tname">{{ p.name }}</div>
                <div class="tlevel">{{ niveau(p) }}@if (p.shared && partage()) { · partagé avec la famille }</div>
                @if (!narrow()) {
                  <div class="acts">
                    @if (partage()) {
                      <button [class.on]="p.shared" (click)="partager(p)" [attr.aria-label]="p.shared ? 'Ne plus partager' : 'Partager avec la famille'" [attr.aria-pressed]="p.shared" [title]="p.shared ? 'Ne plus partager' : 'Partager avec la famille'"><f-icon name="users" [size]="17" [color]="p.shared ? 'var(--accent, #E56B4E)' : 'var(--ink2)'" [width]="2" /></button>
                    }
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

      @if (famille().length) {
        <div class="sep">Projets de la famille</div>
        <div class="tiles">
          @for (p of famille(); track p.id) {
            <div class="tile">
              <button class="thumb" (click)="regarder(p)" [attr.aria-label]="'Regarder ' + p.name">@if (p.thumbnail; as t) { <img [src]="vignette(t.md5, p.memberId)" alt="" /> } @else { <f-icon name="blocs" [size]="34" color="var(--ink3)" [width]="1.6" /> }</button>
              <div class="tname">{{ p.name }}</div>
              <div class="tlevel">de {{ p.memberName }} · {{ niveau(p) }}</div>
              @if (!narrow()) {
                <div class="acts"><button [disabled]="busy()" (click)="copier(p)" aria-label="En faire une copie à moi" title="En faire une copie à moi"><f-icon name="copy" [size]="17" color="var(--ink2)" [width]="2" /></button></div>
              }
            </div>
          }
        </div>
      }

      @if (!narrow() && defis().length && ouvert('grands')) {
        <div class="sep">Relever un défi (grands codeurs)</div>
        <div class="tiles">
          @for (d of defis(); track d.id) {
            <div class="tile defi">
              <div class="tname">{{ d.name }}</div>
              <div class="tdesc">{{ d.desc }}</div>
              <button class="btn btn-ghost restore" [disabled]="busy()" (click)="relever(d, 'grands')">Commencer</button>
            </div>
          }
        </div>
      }

      @if (!narrow() && petitsDefis().length && ouvert('petits')) {
        <div class="sep">Relever un défi (petits codeurs)</div>
        <div class="tiles">
          @for (d of petitsDefis(); track d.id) {
            <div class="tile">
              <button class="thumb blocs" [disabled]="busy()" (click)="relever(d, 'petits')" [attr.aria-label]="'Relever le défi ' + d.name"><img [src]="petitsUrl('defis/' + d.image)" alt="" /></button>
              <div class="tname">{{ d.name }}</div>
              <div class="tdesc">{{ d.desc }}</div>
            </div>
          }
        </div>
      }

      @if (!narrow() && exemples().length && ouvert('petits')) {
        <div class="sep">Partir d’un exemple (petits codeurs)</div>
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

      }

      <button class="btn btn-ghost aide" (click)="aide.set(true)">Comment ça marche ?</button>
      @if (aide()) { <atelier-aide (close)="aide.set(false)" /> }

      <details class="apropos">
        <summary>À propos de l’Atelier code</summary>
        <p>L’Atelier code est sans lien avec la Scratch Foundation ni approbation de sa part. Le niveau « Petits codeurs » est construit à partir du code source ouvert de ScratchJr, publié par le Massachusetts Institute of Technology sous licence BSD 3 clauses.
          <a [href]="exempleUrl('../LICENSE.txt')" target="_blank" rel="noopener">Texte de la licence</a></p>
        <p>Le niveau « Grands codeurs » est construit à partir du code source de l’éditeur de Scratch, publié par la Scratch Foundation sous licence GNU Affero General Public License, version 3. Cette licence vous donne le droit d’en recevoir le code source : il est fait du code d’origine@if (amont(); as a) {, version {{ a.version }}, à ce
          <a [href]="a.depot + '/tree/' + a.commit" target="_blank" rel="noopener">point précis de son histoire</a>}, et des modifications de Foyer, publiées avec
          <a href="https://github.com/PrudhommeWTF/Foyer-App/tree/main/frontend/vendor/atelier/grands" target="_blank" rel="noopener">le code de Foyer</a>.
          <a [href]="grandsUrl('LICENSE.txt')" target="_blank" rel="noopener">Texte de la licence</a></p>
        <p>Les personnages, les décors et les sons de la bibliothèque viennent de Scratch, sous licence Creative Commons Attribution-ShareAlike 2.0 : « Scratch is developed by the Lifelong Kindergarten Group at the MIT Media Lab. See http://scratch.mit.edu. »
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
    .thumb.blocs { background: #fff; border: 1px solid var(--line); padding: 10px; }
    button.thumb { cursor: pointer; }
    button.thumb:active { transform: scale(.98); }
    .thumb img { width: 100%; height: 100%; object-fit: contain; }
    .tname { margin: 10px 4px 4px; font-weight: 800; font-size: 15px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tlevel { margin: 0 4px 4px; font-size: 12px; font-weight: 700; color: var(--ink3); }
    .niveaux { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-bottom: 22px; }
    .niveau { display: flex; flex-direction: column; gap: 6px; text-align: left; padding: 18px; border: 2px solid var(--line2); border-radius: 18px; background: var(--surface); cursor: pointer; min-height: 44px; }
    .niveau:hover { border-color: var(--ink3); }
    .ntitle { font-family: var(--font-display); font-size: 17px; font-weight: 800; color: var(--ink); }
    .ndesc { font-size: 13px; font-weight: 600; color: var(--ink2); line-height: 1.45; }
    .lv { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: -6px 0 20px; }
    .lv-l { font-size: 14px; font-weight: 700; color: var(--ink2); }
    .lv button { min-height: 44px; padding: 0 14px; border: 2px solid var(--line2); border-radius: 14px; background: var(--surface); font: inherit; font-weight: 800; font-size: 13px; color: var(--ink2); cursor: pointer; }
    .lv button.on { border-color: var(--ink); color: var(--ink); }
    .tile.defi { display: flex; flex-direction: column; padding: 14px; }
    .tile.defi .tname { margin-top: 0; white-space: normal; }
    .tile.defi .tdesc { flex: 1; }
    .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
    .tabs button { min-height: 44px; padding: 0 16px; border: none; border-radius: 22px; background: var(--surface); font: inherit; font-weight: 800; font-size: 14px; color: var(--ink2); cursor: pointer; }
    .tabs button.on { background: var(--ink); color: var(--bg, #fff); }
    .room { font-size: 13px; font-weight: 700; color: var(--ink3); }
    .restore { width: 100%; justify-content: center; margin-top: 4px; min-height: 44px; }
    .aide { margin-top: 28px; min-height: 44px; }
    .acts button.on { background: var(--line2); }
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
  readonly store = inject(FoyerStore);
  readonly atelier = inject(AtelierStore);

  readonly projets = signal<Projet[] | null>(null);
  readonly erreur = signal('');
  readonly busy = signal(false);
  readonly narrow = signal(false);
  /** The project last opened on this device by this member, left by the editor for when the list cannot load. */
  readonly dernier = signal<{ id: string; name: string; level: Niveau } | null>(null);
  /** Whether the two levels are offered, after « Nouveau projet ». */
  readonly choix = signal(false);
  readonly exemples = signal<Exemple[]>([]);
  /** What the other members share: to watch, or to copy. */
  readonly famille = signal<Projet[]>([]);
  /** For an adult: the member whose workshop is shown, null for one's own. */
  readonly who = signal<string | null>(null);
  readonly membre = computed(() => this.atelier.members().find((m) => m.id === this.who()) ?? null);
  readonly autres = signal<Projet[] | null>(null);
  readonly corbeille = signal<Projet[]>([]);
  readonly aide = signal(false);
  /** The guided challenges shipped with the 'Grands codeurs' editor. */
  private readonly tousDefis = signal<Defi[]>([]);
  readonly defis = computed(() => this.tousDefis().filter((d) => !d.camera || this.store.setting('atelierCamera') !== false));
  /** Those of the 'Petits codeurs' editor: one picture each, the script to rebuild. */
  readonly petitsDefis = signal<(Defi & { image: string })[]>([]);
  /** Where the 'Grands codeurs' editor comes from: the upstream repository and the pinned commit. */
  readonly amont = signal<{ depot: string; commit: string; version: string } | null>(null);
  /** Both levels are open to whoever is logged in: « Nouveau projet » then asks which one. */
  readonly deux = computed(() => this.atelier.levels().length > 1);
  readonly choixNiveaux: readonly { label: string; levels: Niveau[] }[] = [
    { label: levelsLine(['petits']), levels: ['petits'] }, { label: levelsLine(['grands']), levels: ['grands'] }, { label: levelsLine(NIVEAUX), levels: [...NIVEAUX] },
  ];
  /** Sharing between brothers and sisters, as long as the household allows it. */
  readonly partage = computed(() => this.store.setting('atelierPartageFratrie') !== false);

  constructor() {
    try {
      const mq = matchMedia(NARROW), on = (): void => this.narrow.set(mq.matches);
      on(); mq.addEventListener('change', on);
      inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', on));
    } catch { /* no matchMedia: the wide layout stays */ }
    void this.charger();
    // Shipped with the editor, as a static file: no example, no section.
    fetch(this.exempleUrl('exemples.json')).then((r) => (r.ok ? r.json() : [])).then((l: Exemple[]) => this.exemples.set(l)).catch(() => { /* offline: the section stays hidden */ });
    fetch(this.petitsUrl('defis/defis.json')).then((r) => (r.ok ? r.json() : [])).then((l: (Defi & { image: string })[]) => this.petitsDefis.set(l)).catch(() => { /* offline: the section stays hidden */ });
    fetch(this.grandsUrl('defis.json')).then((r) => (r.ok ? r.json() : [])).then((l: Defi[]) => this.tousDefis.set(l)).catch(() => { /* offline: the section stays hidden */ });
    fetch(this.grandsUrl('amont.json')).then((r) => (r.ok ? r.json() : null)).then((a) => this.amont.set(a)).catch(() => { /* offline: the sentence does without the link */ });
  }

  async charger(): Promise<void> {
    this.erreur.set('');
    try {
      this.projets.set((await this.api.request<{ projets: Projet[] }>('atelier/projets')).projets);
      // Without sharing, or without network, the section simply does not show
      this.api.request<{ projets: Projet[] }>('atelier/projets/famille').then((r) => this.famille.set(r.projets), () => this.famille.set([]));
    } catch (e) {
      this.erreur.set((e as Error).message);
      try {
        const d = JSON.parse(localStorage.getItem('foyer.atelier.dernier') || 'null') as { membre: string; id: string; name: string; level?: Niveau } | null;
        this.dernier.set(d && d.membre === this.store.me()?.id ? { id: d.id, name: d.name, level: d.level ?? 'petits' } : null);
      } catch { this.dernier.set(null); }
    }
  }

  /** An adult opens the workshop of another member: its projects, and what was deleted. */
  async voir(id: string | null): Promise<void> {
    this.who.set(id); this.autres.set(null); this.corbeille.set([]); this.erreur.set(''); this.choix.set(false);
    if (!id) { void this.charger(); return; }
    try {
      const m = encodeURIComponent(id);
      const [live, gone] = await Promise.all([
        this.api.request<{ projets: Projet[] }>(`atelier/projets?membre=${m}`), this.api.request<{ projets: Projet[] }>(`atelier/projets?membre=${m}&corbeille=1`),
      ]);
      if (this.who() !== id) return;
      this.autres.set(live.projets); this.corbeille.set(gone.projets);
    } catch (e) { this.erreur.set((e as Error).message); }
  }
  niveau(p: { level: Niveau }): string { return NIVEAU[p.level]; }
  ouvert(level: Niveau): boolean { return this.atelier.levels().includes(level); }
  memes(a: readonly Niveau[], b: readonly Niveau[]): boolean { return a.length === b.length && a.every((l) => b.includes(l)); }
  /** One level open: the project is created at once; two: the child chooses. */
  nouveau(): void { if (this.deux()) this.choix.set(!this.choix()); else void this.creer(this.atelier.levels()[0]); }
  /** A parent opens one level, the other, or both to a child. */
  regler(id: string, levels: Niveau[]): Promise<void> {
    return this.agir(async () => { await this.api.put(`atelier/membres/${encodeURIComponent(id)}/niveaux`, { niveaux: levels }); await this.atelier.load(); });
  }
  room(octets: number): string { return roomLine(octets, this.atelier.quotaMo()); }

  /** Each editor is a page of its own, served next to the application, with its own way of naming the project. */
  private page(p: Ouvrable, watch: boolean): string {
    // A project created for a guided challenge opens with its card, every time it is edited
    const id = encodeURIComponent(p.id), defi = watch ? '' : p.defi ?? '';
    const query = p.level === 'grands' ? `projet=${id}${watch ? '&vue=plein' : ''}${defi ? `&defi=${encodeURIComponent(defi)}` : ''}` : `pmd5=${id}&mode=${watch ? 'look&vue=plein' : 'edit'}${defi ? `&defi=${encodeURIComponent(defi)}` : ''}`;
    return new URL(`atelier/${p.level}/editor.html?${query}`, document.baseURI).href;
  }
  ouvrir(p: Ouvrable): void { location.href = this.page(p, false); }
  grandsUrl(file: string): string { return new URL(`atelier/grands/${file}`, document.baseURI).href; }
  petitsUrl(file: string): string { return new URL(`atelier/petits/${file}`, document.baseURI).href; }
  exempleUrl(file: string): string { return new URL(`atelier/petits/samples/${file}`, document.baseURI).href; }
  /** On a phone the editor cannot be used: the project opens to be watched, full screen. */
  regarder(p: Ouvrable): void { location.href = this.page(p, true); }
  /** A thumbnail is a file of the owner of the project: said so when it is someone else's. */
  vignette(name: string, owner?: string): string {
    const whose = owner && owner !== this.store.me()?.id ? `?membre=${encodeURIComponent(owner)}` : '';
    return new URL(`api/atelier/medias/${encodeURIComponent(name)}${whose}`, document.baseURI).href;
  }

  private async agir(fn: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await fn(); } catch (e) { this.store.toast((e as Error).message); } finally { this.busy.set(false); }
  }

  creer(level: Niveau): Promise<void> {
    return this.agir(async () => {
      const n = (this.projets()?.length ?? 0) + 1;
      const { projet } = await this.api.post<{ projet: Projet }>('atelier/projets', { name: `Projet ${n}`, level });
      this.ouvrir(projet);
    });
  }
  /** A guided challenge: a new project of one's own, which remembers its challenge and opens with it. */
  relever(d: Defi, level: Niveau): Promise<void> {
    return this.agir(async () => {
      const { projet } = await this.api.post<{ projet: Projet }>('atelier/projets', { name: d.name.slice(0, 80), level, defi: d.id });
      this.ouvrir(projet);
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
      this.ouvrir(projet);
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
  partager(p: Projet): Promise<void> {
    return this.agir(async () => {
      await this.api.request(`atelier/projets/${p.id}`, { method: 'PATCH', body: JSON.stringify({ shared: !p.shared }) });
      this.store.toast(p.shared ? `« ${p.name} » n’est plus partagé.` : `« ${p.name} » est partagé avec la famille.`);
      await this.charger();
    });
  }
  /** One's own copy of a project someone else shares: the original is never touched. */
  copier(p: Projet): Promise<void> {
    return this.agir(async () => {
      await this.api.post(`atelier/projets/${p.id}/copie`, { name: `${p.name} (copie)`.slice(0, 80) });
      this.store.toast(`« ${p.name} » est copié dans tes projets.`);
      await this.charger();
    });
  }
  restaurer(p: Projet): Promise<void> {
    return this.agir(async () => {
      await this.api.post(`atelier/projets/${p.id}/restaurer`, {});
      this.store.toast(`« ${p.name} » est de retour dans les projets de ${this.membre()?.name ?? 'son auteur'}.`);
      await Promise.all([this.voir(this.who()), this.atelier.load()]);
    });
  }
  supprimer(p: Projet): Promise<void> {
    if (!confirm(`Supprimer « ${p.name} » ? Un parent pourra le retrouver pendant quelque temps.`)) return Promise.resolve();
    return this.agir(async () => { await this.api.del(`atelier/projets/${p.id}`); await this.charger(); });
  }
}
