import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinContract, FinPeriod, FinReading } from '../../core/finances.api';
import { FinancesStore, fmtEuros, fmtEurosInt } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { SheetComponent } from '../../shared/sheet';
import { MemberPickerComponent } from '../../shared/member-picker';
import { FinAttachments } from './attachments';
import { FinKwhChart } from './charts/kwh-chart';
import { CONTRACT_KINDS, PERIODICITIES, periodWord } from './contract-labels';

/**
 * La fiche d'un contrat. En lecture d'abord : ce qu'il coûte vraiment face à
 * ce qui était annoncé, ses dates, ses références, ses pièces et, pour
 * l'énergie, les relevés du compteur. « Modifier » passe au formulaire complet
 * dans le même panneau ; un nouveau contrat s'ouvre directement en saisie.
 */
@Component({
  selector: 'fin-contract-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, SheetComponent, MemberPickerComponent, FinAttachments, FinKwhChart],
  template: `
    @let u = store.ui();
    <f-sheet [heading]="heading()" [kicker]="kicker()" [maxWidth]="u.coEdit ? 640 : 960" [full]="true" (close)="close()" (back)="close()">
      @if (!u.coEdit && contract(); as c) {
        <div class="grid">
          <section class="col">
            <div class="big f-display">{{ rangeLabel(c) }}@if (c.periodicity !== 'ponctuelle') { <small> / {{ periodWord(c.periodicity) }}</small> }</div>
            @if (store.costOf(c.id); as cost) {
              <div class="line">
                {{ cost.count }} opération{{ cost.count > 1 ? 's' : '' }} · <b>{{ fmtInt(cost.total) }} €</b> sur 12 mois
                @if (cost.lastAmount !== null) { · Dernier : <b>{{ fmt(cost.lastAmount) }} €</b> le {{ day(cost.lastDate) }} }
              </div>
              @if (cost.offRange) { <div class="off"><span aria-hidden="true">⚠</span> Hors de la fourchette annoncée</div> }
            } @else {
              <div class="line muted">Aucune opération rattachée. Rattachez-les depuis une opération, ou créez une règle pour ce contrat.</div>
            }

            <div class="sec">Dates et rattachements</div>
            <dl class="facts">
              @if (c.renewalOn) { <dt>Reconduction tacite</dt><dd>{{ foyer.fmtNumDate(c.renewalOn) }}</dd> }
              @if (noticeOf(c); as nd) { <dt>Dernier jour pour résilier</dt><dd>{{ nd }} ({{ c.noticeDays }} j de préavis)</dd> }
              @if (c.endsOn) { <dt>Fin du contrat</dt><dd>{{ foyer.fmtNumDate(c.endsOn) }}</dd> }
              <dt>Catégorie</dt><dd>{{ c.categoryId ? store.categoryPath(c.categoryId) : 'Aucune' }}</dd>
              <dt>Personnes</dt><dd>{{ memberNames(c.memberIds) || 'Le foyer' }}</dd>
              <dt>Statut</dt><dd>{{ c.status === 'resilie' ? 'Résilié' : 'Actif' }}</dd>
              @if (c.notes) { <dt>Notes</dt><dd>{{ c.notes }}</dd> }
            </dl>

            @if (c.refs.length) {
              <div class="sec">Références</div>
              <div class="box">
                @for (r of c.refs; track $index) { <div><span class="muted">{{ r.key }}</span> {{ r.value }}</div> }
              </div>
            }

            <div class="sec">Pièces jointes · {{ store.attachments().length }}</div>
            <fin-attachments owner="contract" [ownerId]="c.id" empty="Aucune pièce. Rangez ici l'échéancier, l'attestation, le dernier avis." label="+ Pièce" />

            <div class="acts">
              <button class="btn btn-soft" (click)="store.openContractOperations(c.id)">Voir ces opérations</button>
              <button class="btn btn-soft" (click)="store.ruleFromContract(c.id)">Créer une règle pour ce contrat</button>
            </div>
          </section>

          @if (c.kind === 'energie') {
            <section class="col">
              <div class="sec first">Relevés du compteur</div>
              @if (store.energy(); as e) {
                @if (e.latest?.kwhPerDay != null) {
                  <div class="line">
                    Moyenne récente <b>{{ round(e.latest!.kwhPerDay) }} kWh/jour</b>
                    @if (e.trend !== null) { <span class="trend" [class.up]="e.trend > 0" [class.down]="e.trend < 0">{{ e.trend > 0 ? '+' : '' }}{{ round(e.trend) }} % sur un an</span> }
                  </div>
                }
              }
              @if (hasBars()) {
                <fin-kwh-chart [periods]="store.periods()" [width]="foyer.narrow() ? 360 : 520" />
                <div class="legend">
                  <span class="lg"><span class="sw"></span>kWh par jour, par période de relevé</span>
                  <span class="lg"><span class="tk"></span>Même période l'an dernier</span>
                </div>
              }
              <div class="tbl-wrap">
                <table class="tbl">
                  <thead><tr><th>Relevé</th><th>Index</th><th>Période</th><th>kWh/j</th><th>c/kWh</th><th><span class="sr">Actions</span></th></tr></thead>
                  <tbody>
                    @for (r of sortedReadings(); track r.id) {
                      @let p = store.periodOf(r.id);
                      <tr [class.editing]="u.reEditId === r.id">
                        <td>{{ day(r.date) }}</td>
                        <td>{{ indexLabel(r) }}</td>
                        <td [class.gap]="!!p?.gap">{{ periodLabel(p) }}</td>
                        <td>{{ p && !p.gap ? round(p.kwhPerDay) : '' }}</td>
                        <td>{{ p?.costPerKwh != null ? round(p!.costPerKwh) : '' }}</td>
                        <td class="row-acts">
                          <button class="icon-btn sm" [attr.aria-label]="'Modifier le relevé du ' + day(r.date)" (click)="store.editReading(r)"><f-icon name="edit" [size]="13" color="var(--ink2)" /></button>
                          <button class="icon-btn sm" [attr.aria-label]="'Supprimer le relevé du ' + day(r.date)" (click)="store.deleteReading(r.id, c.id)"><f-icon name="trash" [size]="13" color="var(--primary)" /></button>
                        </td>
                      </tr>
                    } @empty {
                      <tr><td colspan="6" class="muted">Aucun relevé. Notez l'index du compteur de temps en temps : deux relevés suffisent à savoir si la consommation dérive.</td></tr>
                    }
                  </tbody>
                </table>
              </div>

              <div class="sec">{{ u.reEditId ? 'Modifier le relevé' : 'Nouveau relevé' }}</div>
              <div class="rerow">
                <label class="refield"><span class="field-label">Date</span><input class="input" type="date" [ngModel]="u.reDate" (ngModelChange)="store.patch({ reDate: $event })" /></label>
                <label class="refield"><span class="field-label">Index</span><input class="input" [ngModel]="u.reIndex" (ngModelChange)="store.patch({ reIndex: $event })" placeholder="17100" inputmode="decimal" /></label>
                <label class="refield"><span class="field-label">Heures pleines</span><input class="input" [ngModel]="u.reIndexHp" (ngModelChange)="store.patch({ reIndexHp: $event })" placeholder="facultatif" inputmode="decimal" /></label>
                <label class="refield"><span class="field-label">Heures creuses</span><input class="input" [ngModel]="u.reIndexHc" (ngModelChange)="store.patch({ reIndexHc: $event })" placeholder="facultatif" inputmode="decimal" /></label>
                <label class="refield"><span class="field-label">kWh facturés</span><input class="input" [ngModel]="u.reKwh" (ngModelChange)="store.patch({ reKwh: $event })" placeholder="sans index" inputmode="decimal" /></label>
                <label class="refield"><span class="field-label">Montant €</span><input class="input" [ngModel]="u.reCost" (ngModelChange)="store.patch({ reCost: $event })" placeholder="facultatif" inputmode="decimal" /></label>
              </div>
              <div class="acts">
                @if (u.reEditId) { <button class="btn btn-soft" (click)="store.cancelReadingEdit()">Annuler</button> }
                <button class="btn btn-soft" [disabled]="u.busy" (click)="store.saveReading(c.id)">{{ u.reEditId ? 'Enregistrer le relevé' : '+ Relevé' }}</button>
              </div>
              <div class="hint">Un index suffit. Heures pleines et creuses pour les compteurs qui les distinguent ; « kWh facturés » quand la facture donne la consommation sans index ; le montant sert au prix du kWh.</div>
            </section>
          }
        </div>
      } @else {
            <div class="frow">
              <div class="fgrow">
                <div class="field-label">Nom</div>
                <input class="input" [ngModel]="store.ui().coName" (ngModelChange)="store.patch({ coName: $event })" placeholder="Ex : Assurance véhicule" />
              </div>
              <div class="fgrow">
                <div class="field-label">Fournisseur</div>
                <input class="input" [ngModel]="store.ui().coProvider" (ngModelChange)="store.patch({ coProvider: $event })" placeholder="Ex : AXA" />
              </div>
            </div>
            <div class="frow">
              <div class="fgrow">
                <div class="field-label">Type</div>
                <select class="input" [ngModel]="store.ui().coKind" (ngModelChange)="store.patch({ coKind: $event })">
                  @for (k of contractKinds; track k.id) { <option [ngValue]="k.id">{{ k.label }}</option> }
                </select>
              </div>
              <div class="fgrow">
                <div class="field-label">Bien concerné</div>
                <select class="input" [ngModel]="store.ui().coAsset" (ngModelChange)="store.patch({ coAsset: $event })">
                  <option [ngValue]="null">Aucun</option>
                  @for (a of store.assets(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
                </select>
              </div>
            </div>

            <div class="sec-label">Ce qu'il coûte</div>
            <div class="frow">
              <div class="fgrow">
                <div class="field-label">Montant attendu, de</div>
                <input class="input" [ngModel]="store.ui().coMin" (ngModelChange)="store.patch({ coMin: $event })" placeholder="75,00" inputmode="decimal" />
              </div>
              <div class="fgrow">
                <div class="field-label">à</div>
                <input class="input" [ngModel]="store.ui().coMax" (ngModelChange)="store.patch({ coMax: $event })" placeholder="85,00" inputmode="decimal" />
              </div>
              <div class="fgrow">
                <div class="field-label">Périodicité</div>
                <select class="input" [ngModel]="store.ui().coPeriodicity" (ngModelChange)="store.patch({ coPeriodicity: $event })">
                  @for (p of periodicities; track p.id) { <option [ngValue]="p.id">{{ p.label }}</option> }
                </select>
              </div>
            </div>
            <div class="hint sm">Une fourchette plutôt qu'un montant : les cotisations bougent, et c'est le dépassement de la fourchette qui mérite un signalement.</div>

            <div class="sec-label">Dates</div>
            <div class="frow">
              <div class="fgrow">
                <div class="field-label">Reconduction tacite le</div>
                <input class="input" type="date" [ngModel]="store.ui().coRenewal" (ngModelChange)="store.patch({ coRenewal: $event })" />
              </div>
              <div class="fnarrow">
                <div class="field-label">Préavis (jours)</div>
                <input class="input" [ngModel]="store.ui().coNotice" (ngModelChange)="store.patch({ coNotice: $event })" placeholder="60" inputmode="numeric" />
              </div>
              <div class="fgrow">
                <div class="field-label">Fin du contrat</div>
                <input class="input" type="date" [ngModel]="store.ui().coEnds" (ngModelChange)="store.patch({ coEnds: $event })" />
              </div>
            </div>
            @if (noticeDate(); as nd) {
              <div class="hint sm">Dernier jour pour résilier : <strong>{{ nd }}</strong>. Cette date apparaîtra dans les échéances.</div>
            }

            <div class="sec-label">Rattachements</div>
            <div class="frow">
              <div class="fgrow">
                <div class="field-label">Compte prélevé</div>
                <select class="input" [ngModel]="store.ui().coAccount" (ngModelChange)="store.patch({ coAccount: $event })">
                  <option [ngValue]="null">Aucun</option>
                  @for (a of store.activeLedgerAccounts(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
                </select>
              </div>
              <div class="fgrow">
                <div class="field-label">Catégorie</div>
                <select class="input" [ngModel]="store.ui().coCategory" (ngModelChange)="store.patch({ coCategory: $event })">
                  <option [ngValue]="null">Aucune</option>
                  @for (c of store.rootCategories(); track c.id) {
                    <option [ngValue]="c.id">{{ c.name }}</option>
                    @for (s of store.childrenOf(c.id); track s.id) { <option [ngValue]="s.id">&nbsp;&nbsp;{{ c.name }} · {{ s.name }}</option> }
                  }
                </select>
              </div>
            </div>
            <div class="field-label">Personnes concernées</div>
            <f-member-picker [members]="members()" [selected]="store.ui().coMembers" (toggle)="store.toggleMember('coMembers', $event)" />
            <div class="hint sm">Une mutuelle peut couvrir toute la famille. Aucune sélectionnée veut dire « le foyer ».</div>

            <div class="sec-label">Références</div>
            @for (r of store.ui().coRefs; track $index; let i = $index) {
              <div class="refrow">
                <input class="input" [ngModel]="r.key" (ngModelChange)="store.patchRef(i, { key: $event })" placeholder="N° de police" />
                <input class="input" [ngModel]="r.value" (ngModelChange)="store.patchRef(i, { value: $event })" placeholder="123-456-789" />
                <button class="icon-btn" aria-label="Retirer la référence" (click)="store.removeRef(i)"><f-icon name="x" [size]="14" color="var(--ink3)" [width]="2.6" /></button>
              </div>
            }
            <button class="addsub" (click)="store.addRef()"><f-icon name="plus" [size]="13" color="var(--primary)" [width]="2.8" /> Référence</button>

            <div class="frow">
              <div class="fgrow">
                <div class="field-label">Statut</div>
                <select class="input" [ngModel]="store.ui().coStatus" (ngModelChange)="store.patch({ coStatus: $event })">
                  <option [ngValue]="'actif'">Actif</option>
                  <option [ngValue]="'resilie'">Résilié</option>
                </select>
              </div>
              <div class="fgrow">
                <div class="field-label">Notes</div>
                <input class="input" [ngModel]="store.ui().coNotes" (ngModelChange)="store.patch({ coNotes: $event })" placeholder="Facultatif" />
              </div>
            </div>
      }

      <div sheetFoot class="foot">
        @if (u.coId) { <button class="btn btn-soft danger" (click)="store.patch({ coDelId: u.coId })">Supprimer</button> }
        <span class="spacer"></span>
        @if (u.coEdit) {
          <button class="btn btn-soft" (click)="u.coId ? store.patch({ coEdit: false }) : close()">Annuler</button>
          <button class="btn btn-primary" [disabled]="u.busy" (click)="store.saveContract()">Enregistrer</button>
        } @else {
          <button class="btn btn-primary" (click)="store.patch({ coEdit: true })">Modifier</button>
        }
      </div>
    </f-sheet>
  `,
  styles: [`
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px; align-items: start; }
    .col { min-width: 0; }
    .big { font-size: 30px; font-weight: 700; color: var(--ink); }
    .big small { font-family: var(--font-body); font-size: 14px; font-weight: 700; color: var(--ink2); }
    .line { font-size: 13.5px; font-weight: 700; color: var(--ink2); margin-top: 6px; line-height: 1.5; }
    .line b { color: var(--ink); }
    .muted { color: var(--ink3); }
    .off { margin-top: 6px; font-size: 13px; font-weight: 800; color: var(--status-crit); }
    .trend { margin-left: 8px; font-weight: 800; color: var(--ink2); }
    .trend.up { color: var(--status-crit); }
    .trend.down { color: var(--status-good); }
    .sec { font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); margin: 18px 0 8px; }
    .sec.first { margin-top: 4px; }
    .facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
    .facts dt { font-weight: 700; color: var(--ink3); }
    .facts dd { margin: 0; font-weight: 800; color: var(--ink); }
    .box { border: 1.5px solid var(--line2); border-radius: 13px; padding: 10px 12px; font-size: 13.5px; font-weight: 800; color: var(--ink); display: flex; flex-direction: column; gap: 4px; }
    .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 6px; }
    .lg { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--ink2); }
    .sw { width: 11px; height: 11px; border-radius: 3px; background: var(--chart-pos); }
    .tk { width: 3px; height: 12px; border-radius: 1px; background: var(--ink); }
    .tbl-wrap { margin-top: 12px; max-height: 300px; overflow: auto; }
    .tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
    .tbl th { text-align: left; font-size: 11px; font-weight: 800; color: var(--ink3); padding: 6px; border-bottom: 1px solid var(--line); }
    .tbl td { padding: 6px; border-bottom: 1px solid var(--line); font-weight: 700; color: var(--ink); }
    .tbl td.gap { font-style: italic; color: var(--ink3); }
    .tbl tr.editing td { background: var(--soft); }
    .row-acts { white-space: nowrap; text-align: right; }
    .row-acts .icon-btn { display: inline-flex; margin-left: 4px; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .rerow { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
    .refield { display: flex; flex-direction: column; min-width: 0; }
    .refield .field-label { margin: 0 0 4px; }
    .hint { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 8px; line-height: 1.45; }
    .foot { display: flex; gap: 8px; align-items: center; }
    .spacer { flex: 1; }
    .danger { color: var(--status-crit); }
    /* Formulaire : mêmes champs qu'avant. */
    .frow { display: flex; gap: 12px; flex-wrap: wrap; }
    .fgrow { flex: 1 1 160px; min-width: 0; }
    .fnarrow { flex: 0 1 120px; min-width: 100px; }
    .field-label { margin-top: 14px; }
    .sec-label { font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); margin: 20px 0 0; }
    .hint.sm { margin-top: 6px; }
    .refrow { display: flex; gap: 8px; margin-top: 8px; }
    .refrow .input { flex: 1; min-width: 0; }
    .addsub { display: inline-flex; align-items: center; gap: 5px; margin-top: 10px; border: none; background: none; font-family: inherit; font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; padding: 0; }
  `],
})
export class FinContractSheet {
  readonly store = inject(FinancesStore);
  readonly foyer = inject(FoyerStore);
  readonly contractKinds = CONTRACT_KINDS;
  readonly periodicities = PERIODICITIES;
  readonly periodWord = periodWord;
  fmt = fmtEuros;
  fmtInt = fmtEurosInt;

  readonly contract = computed(() => { const id = this.store.ui().coId; return id ? this.store.contracts().find((c) => c.id === id) ?? null : null; });
  readonly heading = computed(() => {
    const c = this.contract();
    if (!c) return 'Nouveau contrat';
    return (this.store.ui().coEdit ? 'Modifier · ' : '') + c.name + (c.provider ? ' · ' + c.provider : '');
  });
  readonly kicker = computed(() => {
    const c = this.contract();
    if (!c) return '';
    const bits = [CONTRACT_KINDS.find((k) => k.id === c.kind)?.label ?? ''];
    if (c.assetId) bits.push(this.store.assets().find((a) => a.id === c.assetId)?.name ?? '');
    if (c.accountId) bits.push(this.store.accountName(c.accountId));
    return bits.filter(Boolean).join(' · ');
  });
  readonly members = computed(() => this.foyer.data()?.members ?? []);
  readonly sortedReadings = computed(() => [...this.store.readings()].sort((a, b) => b.date.localeCompare(a.date)));
  readonly hasBars = computed(() => this.store.periods().some((p) => p.kwhPerDay !== null && !p.gap));

  /** Aperçu du dernier jour pour résilier pendant la saisie. */
  readonly noticeDate = computed(() => {
    const u = this.store.ui();
    return this.lastDay(u.coRenewal, parseInt(u.coNotice || '0', 10));
  });
  noticeOf(c: FinContract): string { return this.lastDay(c.renewalOn ?? '', c.noticeDays); }
  private lastDay(renewal: string, days: number): string {
    if (!renewal || !days) return '';
    const d = new Date(renewal + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return this.foyer.fmtNumDate(d.toISOString().slice(0, 10));
  }

  /** « 120 à 160 € », « 39,99 € », ou le dernier prélèvement faute d'annonce. */
  rangeLabel(c: FinContract): string {
    if (c.amountMin !== null && c.amountMax !== null && c.amountMin !== c.amountMax) return `${fmtEurosInt(c.amountMin)} à ${fmtEurosInt(c.amountMax)} €`;
    const one = c.amountMin ?? c.amountMax ?? this.store.costOf(c.id)?.lastAmount ?? null;
    return one !== null ? `${fmtEuros(one)} €` : 'Montant non annoncé';
  }

  /** Les personnes encore présentes dans le foyer ; un membre supprimé ne laisse pas de vide. */
  memberNames(ids: string[]): string {
    return ids.map((id) => this.members().find((m) => m.id === id)?.name).filter(Boolean).join(', ');
  }

  day(iso: string | null): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  round(n: number | null): string { return n === null ? '' : n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }); }

  /** Ce que montrait le compteur, sous la forme où il a été saisi. */
  indexLabel(r: FinReading): string {
    if (r.indexTotal !== null) return this.round(r.indexTotal);
    if (r.indexHp !== null || r.indexHc !== null) return `${this.round(r.indexHp)} / ${this.round(r.indexHc)}`;
    return r.kwh !== null ? `${this.round(r.kwh)} kWh facturés` : '';
  }

  /** Ce que la période a consommé, ou pourquoi elle ne se mesure pas. */
  periodLabel(p: FinPeriod | undefined): string {
    if (!p) return '';
    switch (p.gap) {
      case 'premier': return 'premier relevé, rien à comparer';
      case 'index-recule': return 'index inférieur au précédent, compteur remplacé ?';
      case 'meme-jour': return 'même jour que le relevé précédent';
      case 'inconnu': return 'consommation non calculable';
      default: return `${this.round(p.kwh)} kWh · ${p.days} j`;
    }
  }

  close(): void { this.store.patch({ coForm: false, coId: null, coEdit: false, reEditId: null }); }
}
