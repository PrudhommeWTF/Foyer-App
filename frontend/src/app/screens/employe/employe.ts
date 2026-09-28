import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EmployesStore } from '../../core/employes.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { EmpShift } from '../../core/employes.api';
import { decHours as decH, eurosFmt as euro, hoursPlain, eurosPlain } from '../../core/employe.format';

const MONTH_FMT = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
const DOW = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const STATUT: Record<string, { label: string; cls: string }> = {
  ouvert: { label: 'Ouvert', cls: 'ouvert' }, declare: { label: 'Déclaré', cls: 'declare' },
  paye: { label: 'Payé', cls: 'paye' }, 'sans-presence': { label: 'Sans présence', cls: 'sans' },
};

interface Semaine { key: string; label: string; shifts: EmpShift[]; }

/**
 * L'écran « Ménage » : le mois en tête (heures, net, état), le bouton « Elle est
 * venue aujourd'hui » en un tap, la liste des présences par semaine, et le bloc
 * « À saisir sur le CESU » prêt à recopier. Le calcul vient du serveur : l'écran
 * n'invente jamais un « 0 h » quand il ne sait pas (mois vide, serveur injoignable
 * et mois figé sont trois états distincts).
 */
@Component({
  selector: 'screen-employe',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <div class="screen-enter">
      @if (store.indispo()) {
        <div class="card note"><f-icon name="x" [size]="20" color="#C6492F" [width]="2.4" /> Données indisponibles : le serveur ne répond pas. Réessayez dans un instant.</div>
      }

      @if (!store.employe() && !store.indispo()) {
        <div class="card create">
          <div class="ct">Aucun employé configuré</div>
          <div class="cd">Ajoutez la personne pour commencer à noter ses heures (le nom seul, aucune donnée sensible).</div>
          <div class="crow">
            <input class="input" [(ngModel)]="nom" placeholder="Nom (ex : Nolwenn)" maxlength="120" (keydown.enter)="creer()" />
            <button class="btn btn-primary" [disabled]="!nom.trim() || store.busy()" (click)="creer()">Créer</button>
          </div>
        </div>
      } @else if (store.employe(); as e) {
        <!-- En-tête : mois et navigation -->
        <div class="mois-nav">
          <button class="nav" (click)="store.shiftMonth(-1)" aria-label="Mois précédent"><f-icon name="chevronLeft" [size]="20" color="var(--ink2)" [width]="2.4" /></button>
          <div class="mois-t">{{ moisLabel() }}</div>
          <button class="nav" [disabled]="estMoisCourant()" (click)="store.shiftMonth(1)" aria-label="Mois suivant"><f-icon name="chevronRight" [size]="20" color="var(--ink2)" [width]="2.4" /></button>
        </div>

        <!-- Résumé du mois -->
        <div class="card resume">
          <div class="r-head">
            <div class="r-titre">{{ titre() }}</div>
            @if (recap(); as r) { <span class="badge {{ statut(r.status).cls }}">{{ statut(r.status).label }}</span> }
          </div>
          @if (recap(); as r) {
            <div class="r-chiffres">
              <div class="chiffre"><div class="c-val">{{ decH(r.minutes) }}</div><div class="c-lab">ce mois-ci</div></div>
              <div class="chiffre"><div class="c-val">{{ r.netCents != null ? euro(r.netCents) : '—' }}</div><div class="c-lab">net</div></div>
            </div>
            @if (!r.frozen) {
              <button class="btn btn-primary big" [disabled]="store.busy()" (click)="store.elleEstVenue()">
                <f-icon name="plus" [size]="20" color="#fff" [width]="2.6" /> Elle est venue aujourd’hui
              </button>
            } @else {
              <div class="fige"><f-icon name="lock" [size]="14" color="var(--ink3)" [width]="2.2" /> Mois figé. <button class="lien" (click)="store.rouvrir()">Rouvrir pour modifier</button></div>
            }
            <button class="btn btn-soft add-date" (click)="ouvrirAjout()">
              <f-icon name="calendar" [size]="17" color="var(--ink2)" [width]="2.2" /> Ajouter à une autre date
            </button>
          } @else if (store.loading()) {
            <div class="vide">Chargement…</div>
          }
        </div>

        <!-- Bloc CESU : la raison d'être de l'écran -->
        @if (recap(); as r) {
          @if (r.minutes > 0) {
            <div class="card cesu">
              <div class="cesu-t">À saisir sur le CESU</div>
              <div class="cesu-p">{{ moisLabel() }}</div>
              <div class="cesu-l"><span>Nombre d’heures</span><b>{{ decH(r.minutes) }}</b><button class="cp" (click)="copier(hDecimal(r.minutes), 'h')"><f-icon name="copy" [size]="14" color="var(--ink2)" [width]="2" /></button></div>
              <div class="cesu-l"><span>Salaire net</span><b>{{ r.netCents != null ? euro(r.netCents) : 'taux à régler' }}</b>@if (r.netCents != null) { <button class="cp" (click)="copier(eurosPlain(r.netCents), 'net')"><f-icon name="copy" [size]="14" color="var(--ink2)" [width]="2" /></button> }</div>
              <div class="cesu-c">Congés payés {{ store.congesInclus() ? 'inclus dans le taux (majoration de 10 %)' : 'non inclus' }}.</div>
              @if (r.buckets.length > 1) {
                <div class="cesu-d">Détail : @for (b of r.buckets; track b.netHourlyCents) { <span>{{ decH(b.minutes) }} à {{ b.netHourlyCents != null ? euro(b.netHourlyCents) : '?' }}/h</span>@if (!$last) { ; } }</div>
              }
              @if (copie()) { <div class="copie">{{ copie() }} copié</div> }
              @if (!r.frozen && r.netCents != null) { <button class="btn btn-soft decl" [disabled]="store.busy()" (click)="store.declarer()">Marquer comme déclaré</button> }
              @if (r.status === 'declare') { <button class="btn btn-soft decl" [disabled]="store.busy()" (click)="payer()">Marquer comme payé</button> }
            </div>
          } @else {
            <div class="card cesu">
              <div class="cesu-t">Aucune présence ce mois-ci</div>
              <div class="cesu-c">Notez une venue, ou marquez le mois « sans présence » pour ne pas être rappelé de le déclarer.</div>
              @if (!r.frozen) { <button class="btn btn-soft" [disabled]="store.busy()" (click)="store.sansPresence()">Marquer « sans présence »</button> }
            </div>
          }
        }

        <!-- Présences, par semaine -->
        @for (sem of semaines(); track sem.key) {
          <div class="sem">
            <div class="sem-t">{{ sem.label }}</div>
            @for (s of sem.shifts; track s.id) {
              <div class="pres">
                <button class="pres-main" (click)="ouvrir(s.id)">
                  <div class="p-jour">{{ jourLabel(s.day) }}</div>
                  <div class="p-info"><b>{{ decH(s.minutes) }}</b>@if (s.note) { <span class="p-note"> · {{ s.note }}</span> }<span class="p-qui"> · {{ auteur(s) }}</span></div>
                </button>
                @if (edit() === s.id && recap() && !recap()!.frozen) {
                  <div class="editeur">
                    <div class="e-row">
                      <input class="input" type="date" [(ngModel)]="eJour" />
                      <div class="stepper">
                        <button (click)="pas(-15)" aria-label="Moins un quart d’heure">−</button>
                        <span>{{ decH(eMin) }}</span>
                        <button (click)="pas(15)" aria-label="Plus un quart d’heure">+</button>
                      </div>
                    </div>
                    <input class="input" [(ngModel)]="eNote" placeholder="Note (facultatif)" maxlength="500" />
                    <div class="e-act">
                      <button class="btn btn-soft danger" (click)="retirer(s)"><f-icon name="trash" [size]="15" color="var(--primary)" [width]="2" /> Retirer</button>
                      <button class="btn btn-soft" (click)="edit.set(null)">Annuler</button>
                      <button class="btn btn-primary" [disabled]="store.busy()" (click)="valider(s)">Enregistrer</button>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        }

        <!-- Formulaire : ajouter une présence à une date choisie -->
        @if (ajoutOpen()) {
          <f-modal title="Ajouter une présence" [maxWidth]="420" (close)="ajoutOpen.set(false)">
            <div class="form">
              <label class="lab">Date</label>
              <input class="input" type="date" [(ngModel)]="aJour" (ngModelChange)="ajoutDoublon.set(false)" />
              <label class="lab">Durée</label>
              <div class="stepper big-step">
                <button (click)="pasAjout(-15)" aria-label="Moins un quart d’heure">−</button>
                <span>{{ decH(aMin) }}</span>
                <button (click)="pasAjout(15)" aria-label="Plus un quart d’heure">+</button>
              </div>
              <label class="lab">Note (facultatif)</label>
              <input class="input" [(ngModel)]="aNote" placeholder="Ex : grand ménage" maxlength="500" />
              @if (ajoutDoublon()) { <div class="warn"><f-icon name="x" [size]="15" color="#C6492F" [width]="2.2" /> Une présence existe déjà ce jour. Ajustez-la dans la liste.</div> }
              <div class="f-act">
                <button class="btn btn-soft" (click)="ajoutOpen.set(false)">Annuler</button>
                <button class="btn btn-primary" [disabled]="!aJour || store.busy()" (click)="enregistrerAjout()">Ajouter</button>
              </div>
            </div>
          </f-modal>
        }
      }
    </div>
  `,
  styles: [`
    .card { background: var(--surface); border-radius: 18px; padding: 16px 18px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); margin-bottom: 14px; }
    .note { display: flex; align-items: center; gap: 10px; font-size: 13.5px; font-weight: 700; color: var(--ink2); }
    .create .ct { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--ink); }
    .create .cd { font-size: 13px; font-weight: 600; color: var(--ink2); margin: 6px 0 14px; }
    .crow { display: flex; gap: 10px; } .crow .input { flex: 1; }

    .mois-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .mois-t { font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--ink); text-transform: capitalize; }
    .nav { border: none; background: var(--surface); width: 40px; height: 40px; border-radius: 12px; cursor: pointer; box-shadow: 0 6px 14px -12px rgba(90,60,40,.6); }
    .nav:disabled { opacity: .4; cursor: default; }

    .r-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .r-titre { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--ink); }
    .badge { font-size: 11px; font-weight: 800; padding: 3px 9px; border-radius: 20px; text-transform: uppercase; letter-spacing: .03em; }
    .badge.ouvert { background: var(--soft2); color: var(--ink2); }
    .badge.declare { background: #E5F0F4; color: #3E7A96; }
    .badge.paye { background: #EDF2EB; color: #5F7E5C; }
    .badge.sans { background: #FDF0DA; color: #9A6A12; }
    .r-chiffres { display: flex; gap: 26px; margin: 14px 0 16px; }
    .c-val { font-family: var(--font-display); font-size: 26px; font-weight: 800; color: var(--ink); }
    .c-lab { font-size: 12px; font-weight: 700; color: var(--ink3); }
    .btn.big { width: 100%; justify-content: center; padding: 15px; font-size: 15.5px; }
    .fige { font-size: 13px; font-weight: 700; color: var(--ink3); display: flex; align-items: center; gap: 6px; }
    .lien { border: none; background: none; color: var(--primary); font-weight: 800; cursor: pointer; padding: 0; font-size: 13px; }
    .add-date { width: 100%; justify-content: center; margin-top: 10px; }

    .form { display: flex; flex-direction: column; }
    .form .lab { font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .04em; margin: 12px 2px 6px; }
    .form .lab:first-child { margin-top: 0; }
    .big-step { align-self: flex-start; }
    .warn { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #C6492F; margin-top: 12px; }
    .f-act { display: flex; gap: 8px; margin-top: 20px; }
    .f-act .btn { flex: 1; justify-content: center; }

    .cesu-t { font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--ink); }
    .cesu-p { font-size: 13px; font-weight: 700; color: var(--ink3); text-transform: capitalize; margin-bottom: 8px; }
    .cesu-l { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line2); }
    .cesu-l span { flex: 1; font-size: 13.5px; font-weight: 700; color: var(--ink2); }
    .cesu-l b { font-size: 16px; font-weight: 800; color: var(--ink); }
    .cp { border: none; background: var(--soft2); width: 30px; height: 30px; border-radius: 9px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .cesu-c { font-size: 12.5px; font-weight: 600; color: var(--ink3); margin-top: 8px; }
    .cesu-d { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 6px; }
    .copie { font-size: 12px; font-weight: 800; color: #5F7E5C; margin-top: 8px; }
    .decl { width: 100%; justify-content: center; margin-top: 12px; }

    .sem-t { font-size: 12px; font-weight: 800; color: var(--ink3); text-transform: uppercase; letter-spacing: .05em; margin: 8px 2px; }
    .pres { background: var(--surface); border-radius: 14px; margin-bottom: 8px; box-shadow: 0 8px 20px -18px rgba(90,60,40,.6); overflow: hidden; }
    .pres-main { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; border: none; background: none; padding: 13px 16px; cursor: pointer; }
    .p-jour { font-weight: 800; font-size: 14px; color: var(--ink); text-transform: capitalize; min-width: 96px; }
    .p-info { font-size: 13.5px; color: var(--ink2); font-weight: 700; }
    .p-info b { color: var(--ink); }
    .p-note { color: var(--ink3); font-weight: 600; }
    .p-qui { color: var(--ink3); font-weight: 600; }
    .editeur { padding: 0 16px 14px; border-top: 1px solid var(--line2); }
    .e-row { display: flex; gap: 12px; align-items: center; margin: 12px 0; flex-wrap: wrap; }
    .stepper { display: inline-flex; align-items: center; gap: 12px; background: var(--soft2); border-radius: 11px; padding: 6px 10px; }
    .stepper button { border: none; background: var(--surface); width: 32px; height: 32px; border-radius: 8px; font-size: 20px; font-weight: 800; cursor: pointer; color: var(--ink); }
    .stepper span { font-weight: 800; min-width: 52px; text-align: center; }
    .e-act { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .e-act .btn { flex: 1; justify-content: center; }
    .btn-soft.danger { color: var(--primary); flex: none; }
    .vide { color: var(--ink3); font-weight: 700; font-size: 13px; padding: 6px 0; }
  `],
})
export class EmployeScreen {
  store = inject(EmployesStore);
  private foyer = inject(FoyerStore);

  decH = decH; euro = euro;
  statut = (s: string) => STATUT[s] || STATUT['ouvert'];

  readonly recap = this.store.recap;
  // Champs de saisie (ngModel simples, pas des signals : formulaires locaux éphémères).
  nom = '';

  readonly edit = signal<number | null>(null);
  eJour = ''; eNote = ''; eMin = 180;
  readonly copie = signal('');

  // Formulaire d'ajout à une date choisie (modale).
  readonly ajoutOpen = signal(false);
  readonly ajoutDoublon = signal(false);
  aJour = ''; aNote = ''; aMin = 180;

  constructor() { void this.store.init(); }

  readonly moisLabel = computed(() => MONTH_FMT.format(new Date(this.store.month() + '-01T12:00:00Z')));
  readonly titre = computed(() => { const e = this.store.employe(); return e && e.role === 'menage' ? 'Ménage' : (e?.name || 'Employé'); });
  estMoisCourant(): boolean { return this.store.month() >= this.foyer.todayStr().slice(0, 7); }

  readonly semaines = computed<Semaine[]>(() => {
    const r = this.store.recap(); if (!r) return [];
    const byWeek = new Map<string, EmpShift[]>();
    for (const s of r.shifts) {
      const monday = this.mondayOf(s.day);
      (byWeek.get(monday) ?? byWeek.set(monday, []).get(monday)!).push(s);
    }
    return [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, shifts]) => ({ key, label: 'Semaine du ' + this.jourCourt(key), shifts }));
  });

  private mondayOf(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  }
  jourLabel(iso: string): string { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); return `${DOW[dt.getUTCDay()]} ${d}`; }
  jourCourt(iso: string): string { const [, m, d] = iso.split('-'); return `${d}/${m}`; }
  auteur(s: EmpShift): string {
    const who = s.updatedBy || s.createdBy;
    const via = s.updatedVia || s.createdVia;
    const nom = who ? (this.foyer.memberName(who) || 'quelqu’un') : 'quelqu’un';
    return via ? `${nom} (via un assistant)` : nom;
  }

  hDecimal = hoursPlain;
  eurosPlain = eurosPlain;

  async creer(): Promise<void> { if (this.nom.trim()) await this.store.creerEmploye(this.nom); this.nom = ''; }

  ouvrir(id: number): void {
    if (this.edit() === id) { this.edit.set(null); return; }
    const s = this.store.recap()?.shifts.find((x) => x.id === id); if (!s) return;
    this.eJour = s.day; this.eNote = s.note; this.eMin = s.minutes; this.edit.set(id);
  }
  pas(delta: number): void { this.eMin = Math.max(15, Math.min(1440, this.eMin + delta)); }

  ouvrirAjout(): void {
    // Par défaut : le jour affiché quand on regarde un mois passé, sinon aujourd'hui ;
    // durée habituelle réglée dans les Paramètres.
    const auj = this.foyer.todayStr();
    this.aJour = this.estMoisCourant() ? auj : this.store.month() + '-01';
    this.aMin = this.store.dureeHabituelle();
    this.aNote = ''; this.ajoutDoublon.set(false); this.ajoutOpen.set(true);
  }
  pasAjout(delta: number): void { this.aMin = Math.max(15, Math.min(1440, this.aMin + delta)); }
  async enregistrerAjout(): Promise<void> {
    const r = await this.store.ajouterPresence(this.aJour, this.aMin, this.aNote);
    if (r === 'ok') this.ajoutOpen.set(false);
    else if (r === 'doublon') this.ajoutDoublon.set(true);
  }
  async valider(s: EmpShift): Promise<void> {
    await this.store.ajuster(s.id, { day: this.eJour, minutes: this.eMin, note: this.eNote.trim() });
    this.edit.set(null);
  }
  async retirer(s: EmpShift): Promise<void> { this.edit.set(null); await this.store.retirer(s); }

  async payer(): Promise<void> {
    const v = window.prompt('Montant total prélevé par le CESU (euros), facultatif :', '');
    const n = v == null || v.trim() === '' ? undefined : Number(v.replace(',', '.'));
    await this.store.payer(Number.isFinite(n as number) ? (n as number) : undefined);
  }

  async copier(text: string, quoi: 'h' | 'net'): Promise<void> {
    try { await navigator.clipboard.writeText(text); this.copie.set(quoi === 'h' ? 'Heures' : 'Net'); setTimeout(() => this.copie.set(''), 2000); }
    catch { this.foyer.toast('Copie impossible sur cet appareil.'); }
  }
}
