import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EmployesStore } from '../../core/employes.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { EmpShift, empRoleLabel } from '../../core/employes.api';
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
  imports: [IconComponent],
  template: `
    <div class="screen-enter">
      @if (store.indispo()) {
        <div class="card note"><f-icon name="x" [size]="20" color="#C6492F" [width]="2.4" /> Données indisponibles : le serveur ne répond pas. Réessayez dans un instant.</div>
      }

      @if (!store.employe() && !store.indispo()) {
        <div class="card create">
          <div class="ct">Aucun employé configuré</div>
          @if (store.foyer.isAdmin()) {
            <div class="cd">Ajoutez la personne pour commencer à noter ses heures (nom et prénom, la catégorie CESU et le taux horaire, rien d’autre).</div>
            <button class="btn btn-primary" (click)="store.foyer.openItem('employee', null)"><f-icon name="userPlus" [size]="18" color="#fff" [width]="2.4" /> Ajouter un employé</button>
          } @else {
            <div class="cd">Aucun employé n’est encore configuré. Demandez à un administrateur du foyer de l’ajouter.</div>
          }
        </div>
      } @else if (store.employe(); as e) {
        <!-- Sélecteur d'employé (plusieurs contrats possibles) -->
        @if (store.employes().length > 1 || store.foyer.isAdmin()) {
          <div class="emps">
            @for (em of store.employes(); track em.id) {
              <button class="emp-chip" [class.on]="em.id === e.id" (click)="store.selectEmploye(em.id)">
                <span class="ec-nom">{{ em.name }}</span>
                <span class="ec-h">{{ decH(store.minutesOf(em.id)) }}</span>
              </button>
            }
            @if (store.foyer.isAdmin()) { <button class="emp-add" (click)="store.foyer.openItem('employee', null)" aria-label="Ajouter un employé"><f-icon name="plus" [size]="16" color="var(--ink2)" [width]="2.4" /></button> }
          </div>
        }

        <!-- En-tête : mois et navigation -->
        <div class="mois-nav">
          <button class="nav" (click)="store.shiftMonth(-1)" aria-label="Mois précédent"><f-icon name="chevronLeft" [size]="20" color="var(--ink2)" [width]="2.4" /></button>
          <div class="mois-t">{{ moisLabel() }}</div>
          <button class="nav" [disabled]="estMoisCourant()" (click)="store.shiftMonth(1)" aria-label="Mois suivant"><f-icon name="chevronRight" [size]="20" color="var(--ink2)" [width]="2.4" /></button>
        </div>

        <!-- Résumé du mois -->
        <div class="card resume">
          <div class="r-head">
            <!-- Le nom ouvre la fiche de l'employé : taux et historique ; un administrateur la modifie. -->
            <button class="r-ident" (click)="store.foyer.openItem('employee', '' + e.id)">
              <span class="r-titre">{{ e.name }}</span>
              <span class="r-role">{{ roleLabel(e.role) }} <f-icon name="chevronRight" [size]="13" color="var(--ink3)" [width]="2.4" /></span>
            </button>
            <div class="r-side">
              @if (recap(); as r) { <span class="badge {{ statut(r.status).cls }}">{{ statut(r.status).label }}</span> }
            </div>
          </div>
          @if (recap(); as r) {
            <div class="r-chiffres">
              <div class="chiffre"><div class="c-val">{{ decH(r.minutes) }}</div><div class="c-lab">ce mois-ci</div></div>
              <div class="chiffre"><div class="c-val">{{ r.netCents != null ? euro(r.netCents) : '—' }}</div><div class="c-lab">net</div></div>
            </div>
            @if (!r.frozen) {
              <button class="btn btn-primary big" [disabled]="store.busy()" (click)="store.elleEstVenue()">
                <f-icon name="plus" [size]="20" color="#fff" [width]="2.6" /> Présence aujourd’hui
              </button>
            } @else {
              <div class="fige"><f-icon name="lock" [size]="14" color="var(--ink3)" [width]="2.2" /> Mois figé. <button class="lien" (click)="store.rouvrir()">Rouvrir pour modifier</button></div>
            }
            <button class="btn btn-soft add-date" (click)="store.foyer.openItem('shift', null)">
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
                <button class="pres-main" (click)="store.foyer.openItem('shift', '' + s.id)">
                  <div class="p-jour">{{ jourLabel(s.day) }}</div>
                  <div class="p-info"><b>{{ decH(s.minutes) }}</b>@if (s.note) { <span class="p-note"> · {{ s.note }}</span> }<span class="p-qui"> · {{ auteur(s) }}</span></div>
                </button>
              </div>
            }
          </div>
        }

      }

    </div>
  `,
  styles: [`
    .card { background: var(--surface); border-radius: 18px; padding: 16px 18px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); margin-bottom: 14px; }
    .note { display: flex; align-items: center; gap: 10px; font-size: 13.5px; font-weight: 700; color: var(--ink2); }
    .create .ct { font-family: var(--font-display); font-size: 18px; font-weight: 700; color: var(--ink); }
    .create .cd { font-size: 13px; font-weight: 600; color: var(--ink2); margin: 6px 0 14px; }

    .emps { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; align-items: stretch; }
    .emp-chip { border: none; background: var(--surface); color: var(--ink2); cursor: pointer; box-shadow: 0 6px 14px -12px rgba(90,60,40,.6); border-radius: 16px; padding: 8px 14px; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left; }
    .emp-chip .ec-nom { font-weight: 800; font-size: 13px; }
    .emp-chip .ec-h { font-weight: 700; font-size: 11.5px; opacity: .7; }
    .emp-chip.on { background: var(--primary); color: #fff; }
    .emp-add { border: none; background: var(--soft2); border-radius: 16px; min-width: 40px; cursor: pointer; display: flex; align-items: center; justify-content: center; }

    .mois-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .mois-t { font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--ink); text-transform: capitalize; }
    .nav { border: none; background: var(--surface); width: 40px; height: 40px; border-radius: 12px; cursor: pointer; box-shadow: 0 6px 14px -12px rgba(90,60,40,.6); }
    .nav:disabled { opacity: .4; cursor: default; }

    .r-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .r-ident { display: flex; flex-direction: column; align-items: flex-start; padding: 0; border: none; background: none; font: inherit; text-align: left; cursor: pointer; min-width: 0; }
    .r-titre { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--ink); }
    .r-role { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 2px; }
    .r-side { display: flex; align-items: center; gap: 8px; }
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

    .sem-t { font-size: 13.5px; font-weight: 800; color: var(--ink3); margin: 8px 2px; }
    .pres { background: var(--surface); border-radius: 14px; margin-bottom: 8px; box-shadow: 0 8px 20px -18px rgba(90,60,40,.6); overflow: hidden; }
    .pres-main { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; border: none; background: none; padding: 13px 16px; cursor: pointer; }
    .p-jour { font-weight: 800; font-size: 14px; color: var(--ink); text-transform: capitalize; min-width: 96px; }
    .p-info { font-size: 13.5px; color: var(--ink2); font-weight: 700; }
    .p-info b { color: var(--ink); }
    .p-note { color: var(--ink3); font-weight: 600; }
    .p-qui { color: var(--ink3); font-weight: 600; }
    .vide { color: var(--ink3); font-weight: 700; font-size: 13px; padding: 6px 0; }
  `],
})
export class EmployeScreen {
  store = inject(EmployesStore);
  private foyer = inject(FoyerStore);

  decH = decH; euro = euro;
  roleLabel = empRoleLabel;
  statut = (s: string) => STATUT[s] || STATUT['ouvert'];

  readonly recap = this.store.recap;

  readonly copie = signal('');

  constructor() { void this.store.init(); }

  readonly moisLabel = computed(() => MONTH_FMT.format(new Date(this.store.month() + '-01T12:00:00Z')));
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
