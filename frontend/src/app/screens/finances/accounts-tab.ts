import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { SheetComponent } from '../../shared/sheet';
import { FinLoanChart } from './charts/loan-chart';
import { ConfirmComponent } from '../../shared/confirm';
import { WhoComponent } from '../../shared/who';
import { MemberPickerComponent } from '../../shared/member-picker';
import { CheckComponent } from '../../shared/check';
import { whoBadges } from '../../core/schedule';
import { AccountKind, FinAccount } from '../../core/finances.api';

const KINDS: { k: AccountKind; label: string; color: string }[] = [
  { k: 'courant', label: 'Courant', color: '#4E93B8' },
  { k: 'pro', label: 'Professionnel', color: '#9B6FA8' },
  { k: 'epargne', label: 'Épargne', color: '#7A9B76' },
  { k: 'credit', label: 'Crédit', color: '#B8735A' },
];

@Component({
  selector: 'fin-accounts-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, SheetComponent, ConfirmComponent, WhoComponent, MemberPickerComponent, CheckComponent, FinLoanChart],
  template: `
    <div class="bar">
      <div class="worth">
        Patrimoine net : <b [class.neg]="worth().net < 0">{{ eurInt(worth().net) }}</b>
        · {{ eurInt(worth().assets) }} d'avoirs@if (worth().debts) {, {{ eurInt(worth().debts) }} restant dû}
      </div>
      <div class="spacer"></div>
      @if (archivedCount()) {
        <button class="btn btn-soft" (click)="store.patch({ acShowArchived: !store.ui().acShowArchived })" [attr.aria-pressed]="store.ui().acShowArchived">
          {{ store.ui().acShowArchived ? 'Masquer' : 'Afficher' }} les archivés ({{ archivedCount() }})
        </button>
      }
      <button class="btn btn-primary" (click)="store.newAccount()"><f-icon name="plus" [size]="16" color="#fff" [width]="2.6" /> Compte</button>
    </div>

    <div class="grid">
      @for (a of shown(); track a.id) {
        <button type="button" class="card" [class.arch]="a.archived" (click)="store.editAccount(a.id)" [attr.aria-label]="'Modifier le compte ' + a.name">
          <div class="top">
            <div class="idz">
              <div class="badge" [style.background]="foyer.tint(kindColor(a.kind))" [style.color]="kindColor(a.kind)">{{ kindLabel(a.kind) }}</div>
              @if (a.archived) { <div class="badge muted">Archivé</div> }
            </div>
            @if (a.memberIds.length) {
              <f-who [badges]="holderBadges(a.memberIds)" [size]="26" />
            }
          </div>
          <div class="name">{{ a.name }}</div>
          @if (a.kind === 'credit') {
            @if (loan(a.id); as l) {
              <div class="bal f-display">{{ eurInt(l.owed) }} <small>restant dû</small></div>
              <div class="gauge" role="img" [attr.aria-label]="round(l.progress * 100) + ' % remboursé'"><div class="fill" [style.width]="pct(l.progress)"></div></div>
              <div class="meta">
                {{ round(l.progress * 100) }} % remboursé sur {{ eurInt(l.principal) }} · {{ l.left }} échéance{{ l.left > 1 ? 's' : '' }}
                · {{ fmt(a.loan!.payment) }} €@if (a.loan!.insurance) { + {{ fmt(a.loan!.insurance) }} € d'assurance} / mois
                · dernière le {{ foyer.fmtNumDate(l.endsOn) }}
              </div>
            } @else {
              <div class="bal f-display muted">·</div>
              <div class="meta muted">Termes du prêt à renseigner</div>
            }
          } @else {
            <div class="bal f-display" [class.neg]="store.balanceOf(a.id) < 0">{{ fmt(store.balanceOf(a.id)) }} €</div>
            @if (spark(a.id); as sp) {
              <svg class="spark" viewBox="0 0 200 40" preserveAspectRatio="none" role="img" aria-label="Solde sur six mois"><polyline [attr.points]="sp" /></svg>
            }
            <div class="meta">
              @if (cov(a.id); as c) {
                @if (c.count) {
                  <span>{{ c.count }} opération{{ c.count > 1 ? 's' : '' }}, jusqu'au {{ foyer.fmtNumDate(c.lastDate || '') }}</span>
                } @else { <span class="muted">Aucune opération</span> }
              }
              @if (store.aliasesOf(a.id).length; as n) { <span>· {{ n }} alias</span> }
            </div>
            @if (a.openingDate) { <div class="anchor">{{ anchorLabel(a) }}</div> }
          }
        </button>
      } @empty {
        <div class="empty">
          <div class="empty-title">Aucun compte</div>
          <div class="empty-txt">Créez d'abord vos comptes bancaires : ils portent les opérations et les soldes.</div>
        </div>
      }
    </div>

    @for (a of credits(); track a.id) {
      <section class="panel">
        <div class="p-head">
          <div class="p-title">{{ a.name }} · capital restant dû</div>
          <button class="btn btn-soft sm" (click)="toggleTable(a.id)" [attr.aria-expanded]="openTable() === a.id">Tableau d'amortissement</button>
        </div>
        @if (store.schedules()[a.id]; as sch) {
          @if (sch.length) {
            <fin-loan-chart [schedule]="sch" [today]="foyer.todayStr()" [width]="foyer.narrow() ? 380 : 900" [height]="foyer.narrow() ? 220 : 260" />
            <div class="legend">
              <span class="lg"><span class="ln"></span>Capital restant dû</span>
              <span class="lg"><span class="tk"></span>Aujourd'hui</span>
            </div>
            @if (openTable() === a.id) {
              <div class="tbl-wrap">
                <table class="tbl">
                  <thead><tr><th>Date</th><th>Échéance</th><th>Capital</th><th>Intérêts</th><th>Assurance</th><th>Restant dû</th></tr></thead>
                  <tbody>
                    @for (i of sch; track i.n) {
                      <tr [class.past]="i.date <= foyer.todayStr()">
                        <td>{{ foyer.fmtNumDate(i.date) }}</td><td>{{ fmt(i.total) }} €</td><td>{{ fmt(i.principal) }} €</td>
                        <td>{{ fmt(i.interest) }} €</td><td>{{ fmt(i.insurance) }} €</td><td>{{ fmt(i.owed) }} €</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          } @else {
            <div class="meta muted">Échéancier indisponible : vérifiez les termes du prêt.</div>
          }
        } @else {
          <div class="meta">Chargement de l'échéancier…</div>
        }
      </section>
    }

    <!-- FORMULAIRE DE COMPTE -->
    @if (store.ui().acForm) {
      <f-sheet [heading]="store.ui().acId ? 'Modifier le compte' : 'Nouveau compte'" [maxWidth]="560" [full]="true"
               (close)="store.patch({ acForm: false })" (back)="store.patch({ acForm: false })">
        <div class="field-label first">Nom du compte</div>
        <input class="input" [ngModel]="store.ui().acName" (ngModelChange)="store.patch({ acName: $event })" placeholder="Ex : Compte joint" />

        <div class="field-label">Type</div>
        <div class="seg">
          @for (k of kinds; track k.k) {
            <button [class.active]="store.ui().acKind === k.k" (click)="store.patch({ acKind: k.k })">{{ k.label }}</button>
          }
        </div>

        <div class="field-label">Titulaires</div>
        <f-member-picker [members]="members()" [selected]="store.ui().acMembers" (toggle)="store.toggleMember('acMembers', $event)" />
        <div class="hint sm">Un compte joint en a deux. Aucun sélectionné veut dire « le foyer ».</div>

        @if (store.ui().acKind === 'credit') {
          <div class="field-label">Termes du prêt</div>
          <div class="frow">
            <div class="fgrow">
              <div class="field-label sm">Capital emprunté €</div>
              <input class="input" [ngModel]="store.ui().acPrincipal" (ngModelChange)="store.patch({ acPrincipal: $event })" placeholder="200 000,00" inputmode="decimal" />
            </div>
            <div class="fnarrow">
              <div class="field-label sm">Taux annuel %</div>
              <input class="input" [ngModel]="store.ui().acRate" (ngModelChange)="store.patch({ acRate: $event })" placeholder="3,00" inputmode="decimal" />
            </div>
          </div>
          <div class="frow">
            <div class="fgrow">
              <div class="field-label sm">Mensualité €</div>
              <input class="input" [ngModel]="store.ui().acPayment" (ngModelChange)="store.patch({ acPayment: $event })" placeholder="1 109,20" inputmode="decimal" />
            </div>
            <div class="fgrow">
              <div class="field-label sm">Assurance €/mois</div>
              <input class="input" [ngModel]="store.ui().acInsurance" (ngModelChange)="store.patch({ acInsurance: $event })" placeholder="0,00" inputmode="decimal" />
            </div>
            <div class="fgrow">
              <div class="field-label sm">Première échéance</div>
              <input class="input" type="date" [ngModel]="store.ui().acFirstOn" (ngModelChange)="store.patch({ acFirstOn: $event })" />
            </div>
          </div>
          <div class="note">
            Recopiez ces quatre chiffres de votre offre de prêt. Tout le reste se calcule :
            capital restant dû, part d'intérêts de chaque échéance, date de fin, intérêts de l'année.
            La mensualité s'entend hors assurance : laissez l'assurance à zéro si elle y est déjà comprise.
          </div>
        }

        <div class="frow">
          <div class="fgrow">
            <div class="field-label">{{ store.ui().acKind === 'credit' ? 'Capital restant dû €' : "Solde d'ouverture €" }}</div>
            <input class="input" [ngModel]="store.ui().acOpening" (ngModelChange)="store.patch({ acOpening: $event })" placeholder="0,00" inputmode="decimal" />
          </div>
          <div class="fgrow">
            <div class="field-label">À la date du</div>
            <input class="input" type="date" [ngModel]="store.ui().acOpeningDate" (ngModelChange)="store.patch({ acOpeningDate: $event })" />
          </div>
        </div>
        @if (store.ui().acKind === 'credit') {
          <div class="note">
            Facultatif, et c'est le recalage : après un remboursement anticipé ou une
            renégociation, recopiez ici le capital restant dû lu sur votre relevé, avec sa date.
            Le tableau d'amortissement repart de ce chiffre. Laissez vide pour suivre l'offre
            de prêt d'origine.
          </div>
        } @else {
          <div class="note">
            Avec une date, le solde affiché part de ce montant et n'ajoute que les opérations
            postérieures : celles du jour même et d'avant sont considérées comme
            déjà comprises dedans, comme sur un relevé bancaire. Sans date, le solde d'ouverture
            s'ajoute à toutes les opérations enregistrées.
          </div>
        }

        <label class="check" (click)="store.patch({ acArchived: !store.ui().acArchived })">
          <f-check [checked]="store.ui().acArchived" />
          <span>Compte archivé (historique conservé, plus d'alerte de mois incomplet)</span>
        </label>

        @if (store.ui().acId && store.ui().acKind !== 'credit') {
          <div class="field-label">Libellés d'export rattachés</div>
          <div class="note">
            Un même compte peut apparaître sous plusieurs libellés dans les exports de votre banque
            (changement de nom, compte synchronisé par deux connexions). Déclarez-les ici pour que
            l'import les reconnaisse comme un seul compte.
          </div>
          <div class="alias-list">
            @for (al of store.aliasesOf(store.ui().acId!); track al.id) {
              <div class="alias">
                <span class="alias-txt">{{ al.labelRaw }}</span>
                <button class="icon-btn sm" (click)="store.removeAlias(al.id)"><f-icon name="x" [size]="14" color="var(--ink2)" /></button>
              </div>
            } @empty { <div class="alias-empty">Aucun libellé rattaché pour l'instant.</div> }
          </div>
          <div class="alias-add">
            <input class="input" [ngModel]="store.ui().acAliasInput" (ngModelChange)="store.patch({ acAliasInput: $event })"
                   (keydown.enter)="store.addAlias()" placeholder="Coller le libellé exact vu dans l'export" />
            <button class="btn btn-soft" (click)="store.addAlias()">Ajouter</button>
          </div>
        }

        <div class="modal-acts">
          @if (store.ui().acId) {
            <button class="btn btn-danger" (click)="store.patch({ acDelId: store.ui().acId })"><f-icon name="trash" [size]="16" color="#fff" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ acForm: false })">Annuler</button>
          <button class="btn btn-primary" [disabled]="store.ui().busy" (click)="store.saveAccount()">Enregistrer</button>
        </div>
      </f-sheet>
    }

    @if (store.ui().acDelId) {
      <f-confirm [maxWidth]="420" title="Supprimer ce compte ?" (cancel)="store.patch({ acDelId: null })" (confirm)="store.confirmAccountDel()">
        « {{ delName() }} » et ses libellés d'export seront retirés. Un compte qui porte des
        opérations ne peut pas être supprimé : archivez-le plutôt.
      </f-confirm>
    }
  `,
  styles: [`
    .hint { font-size: 12.5px; font-weight: 700; color: var(--ink3); line-height: 1.5; }
    .hint.sm { margin-top: 8px; }
    .bar { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; margin-bottom: 16px; }
    .spacer { flex: 1; }
    .worth { font-size: 14px; font-weight: 700; color: var(--ink2); }
    .worth b { color: var(--ink); font-weight: 800; }
    .neg { color: var(--status-crit) !important; }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
    :host-context(.shell.narrow) .grid { grid-template-columns: 1fr; }
    .card { background: var(--surface); border-radius: 18px; padding: 18px; box-shadow: var(--sh-card); cursor: pointer; border: none; text-align: left; font-family: inherit; color: inherit; display: block; width: 100%; }
    .card:hover { background: var(--soft); }
    .card.arch { opacity: .62; }
    .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
    .idz { display: flex; gap: 6px; flex-wrap: wrap; }
    .badge { font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 20px; text-transform: uppercase; letter-spacing: .03em; }
    .badge.muted { background: var(--soft2); color: var(--ink3); }
    .name { font-size: 15px; font-weight: 800; color: var(--ink); }
    .bal { font-size: 25px; font-weight: 700; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
    .meta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 12px; font-weight: 700; color: var(--ink3); }
    .meta .muted, .alias-empty { font-style: italic; }
    .aliases { margin-top: 8px; font-size: 11.5px; font-weight: 800; color: var(--ink3); }
    .gauge { margin-top: 8px; height: 7px; border-radius: 99px; background: var(--soft2); overflow: hidden; }
    .fill { height: 100%; border-radius: 99px; background: var(--chart-pos); }
    .bal small { font-family: var(--font-body); font-size: 13px; font-weight: 700; color: var(--ink2); }
    .spark { display: block; width: 100%; height: 40px; margin: 4px 0 6px; }
    .spark polyline { fill: none; stroke: var(--chart-pos); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
    .panel { background: var(--surface); border-radius: var(--r-card-lg); padding: 20px 22px; box-shadow: var(--sh-card); margin-top: 16px; }
    .p-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .p-title { font-size: 16px; font-weight: 800; color: var(--ink); }
    .btn.sm { padding: 7px 12px; font-size: 12.5px; }
    .legend { display: flex; gap: 16px; margin-top: 8px; }
    .lg { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .lg .ln { width: 14px; height: 3px; border-radius: 2px; background: var(--chart-pos); }
    .lg .tk { width: 3px; height: 13px; border-radius: 1px; background: var(--ink); }
    .tbl-wrap { margin-top: 14px; max-height: 380px; overflow: auto; border-radius: 12px; border: 1px solid var(--line); }
    .tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
    .tbl th { position: sticky; top: 0; background: var(--soft); text-align: right; padding: 7px 10px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--ink3); }
    .tbl td { text-align: right; padding: 6px 10px; border-top: 1px solid var(--line); color: var(--ink); font-weight: 700; white-space: nowrap; }
    .tbl th:first-child, .tbl td:first-child { text-align: left; }
    .tbl tr.past td { color: var(--ink3); }
    .field-label.sm { font-size: 10.5px; }
    .anchor { margin-top: 6px; font-size: 11.5px; font-weight: 700; color: var(--ink3); line-height: 1.35; }
    .empty { grid-column: 1 / -1; background: var(--surface); border-radius: 16px; padding: 34px 24px; text-align: center; box-shadow: var(--sh-card); }
    .empty-title { font-size: 15px; font-weight: 800; color: var(--ink); }
    .empty-txt { font-size: 13px; font-weight: 700; color: var(--ink3); margin-top: 6px; }

    .frow { display: flex; gap: 12px; }
    .fgrow { flex: 1; min-width: 0; }
    @media (max-width: 520px) { .frow { flex-direction: column; } }
    .field-label { margin-top: 16px; }
    .field-label.first { margin-top: 0; }
    .frow .field-label { margin-top: 16px; }
    .note { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 8px; line-height: 1.45; }
    .check { display: flex; align-items: flex-start; gap: 10px; margin-top: 16px; font-size: 13px; font-weight: 700; color: var(--ink2); cursor: pointer; }
    .alias-list { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
    .alias { display: flex; align-items: center; gap: 8px; background: var(--soft2); border-radius: 11px; padding: 7px 8px 7px 12px; }
    .alias-txt { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 700; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .alias-empty { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 10px; }
    .alias-add { display: flex; gap: 9px; margin-top: 10px; }
    .alias-add .input { flex: 1; min-width: 0; }
    .modal-acts { display: flex; gap: 12px; margin-top: 22px; align-items: center; }
    .modal-acts .spacer { flex: 1; }
    .modal-acts .grow { flex: 1; }
  `],
})
export class FinancesAccountsTab {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  kinds = KINDS;
  fmt = fmtEuros;

  members = computed(() => this.foyer.data()?.members || []);
  /** Les titulaires en pastilles, un membre supprimé du foyer tombant de lui-même. */
  holderBadges(ids: string[]) { return whoBadges({ who: ids }, this.members()); }
  kindLabel(k: AccountKind): string { return KINDS.find((x) => x.k === k)?.label || k; }
  kindColor(k: AccountKind): string { return KINDS.find((x) => x.k === k)?.color || '#8A7E74'; }
  cov(id: number) { return this.store.coverageOf(id); }
  loan(id: number) { return this.store.loanOf(id); }
  pct(v: number): string { return `${Math.max(0, Math.min(100, v * 100))}%`; }
  round(v: number): number { return Math.round(v); }
  /** Date du solde, et ce qu'elle écarte : sans ça, les opérations d'avant semblent perdues. */
  anchorLabel(a: FinAccount): string {
    const base = `Solde constaté le ${this.foyer.fmtNumDate(a.openingDate || '')}`;
    const n = this.store.ignoredOpsOf(a.id);
    if (!n) return base;
    const s = n > 1 ? 's' : '';
    return `${base}, ${n} opération${s} antérieure${s} déjà comprise${s}`;
  }
  delName = computed(() => this.store.accounts().find((a) => a.id === this.store.ui().acDelId)?.name || '');

  /** Euros entiers : un patrimoine se lit à l'euro, pas au centime. */
  eurInt = (cents: number): string => (cents < 0 ? '−' : '') + Math.round(Math.abs(cents) / 100).toLocaleString('fr-FR') + ' €';

  readonly archivedCount = computed(() => this.store.accounts().filter((a) => a.archived).length);
  /** Les archivés restent repliés tant qu'on ne demande pas à les voir. */
  readonly shown = computed(() => this.store.accounts().filter((a) => !a.archived || this.store.ui().acShowArchived));
  readonly credits = computed(() => this.store.accounts().filter((a) => a.kind === 'credit' && !a.archived && a.loan));

  /** Avoirs (comptes actifs hors crédit) moins capital restant dû des crédits actifs. */
  readonly worth = computed(() => {
    const active = this.store.accounts().filter((a) => !a.archived);
    const assets = active.filter((a) => a.kind !== 'credit').reduce((t, a) => t + this.store.balanceOf(a.id), 0);
    const debts = active.filter((a) => a.kind === 'credit').reduce((t, a) => t + (this.store.loanOf(a.id)?.owed ?? 0), 0);
    return { assets, debts, net: assets - debts };
  });

  /** La petite courbe des six derniers mois, en points SVG (200 × 40). */
  spark(id: number): string | null {
    const h = this.store.history()[id] ?? [];
    if (h.length < 2) return null;
    const mn = Math.min(...h), span = Math.max(...h) - mn || 1;
    return h.map((v, i) => `${(i / (h.length - 1)) * 200},${36 - ((v - mn) / span) * 32}`).join(' ');
  }

  readonly openTable = signal<number | null>(null);
  toggleTable(id: number): void { this.openTable.set(this.openTable() === id ? null : id); }

  constructor() {
    // L'échéancier de chaque crédit se charge à l'affichage (et après une modification des termes).
    effect(() => { for (const a of this.credits()) if (!this.store.schedules()[a.id]) void this.store.loadSchedule(a.id); });
  }
}
