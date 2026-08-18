import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';
import { FinConfidence, FinTransferCandidate } from '../../core/finances.api';

const CONFIDENCE: Record<FinConfidence, { label: string; color: string }> = {
  forte: { label: 'Confiance forte', color: '#6E9E5F' },
  moyenne: { label: 'À vérifier', color: '#E08D3C' },
  faible: { label: 'Douteux', color: '#C6492F' },
};

@Component({
  selector: 'fin-import-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    @if (store.ui().importError; as err) {
      <div class="banner err"><f-icon name="urgent" [size]="18" color="#8C3B26" [width]="2.2" /><span>{{ err }}</span></div>
    }

    <!-- DÉPÔT DU FICHIER -->
    @if (!store.preview()) {
      <label class="drop" [class.busy]="store.ui().importBusy"
             (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
        <input type="file" hidden accept=".csv,.tsv,.txt,.ofx,.qfx,.xml,.xls,.xlsx" (change)="onPick($event)" />
        <f-icon name="upload" [size]="30" color="var(--primary)" [width]="1.8" />
        <div class="drop-title">{{ store.ui().importBusy ? 'Lecture du fichier…' : 'Déposez un relevé, ou cliquez pour le choisir' }}</div>
        <div class="drop-sub">CSV (Bankin', séparateur point-virgule), OFX, CAMT.053, .xlsx. Rien n'est enregistré avant votre validation.</div>
      </label>
    }

    <!-- RAPPORT AVANT VALIDATION -->
    @if (store.preview(); as p) {
      <div class="card report">
        <div class="rh">
          <div>
            <div class="card-title sm">{{ p.filename }}</div>
            <div class="rmeta">{{ p.format }} · {{ p.encoding }} · {{ p.totalRows }} ligne{{ p.totalRows > 1 ? 's' : '' }} lue{{ p.totalRows > 1 ? 's' : '' }}</div>
          </div>
          <button class="icon-btn sm" (click)="store.discardPreview()" aria-label="Abandonner"><f-icon name="x" [size]="16" color="var(--ink2)" /></button>
        </div>

        <div class="figs">
          <div class="fig"><div class="fig-n f-display">{{ p.totalRows }}</div><div class="fig-l">lignes du fichier</div></div>
          <div class="fig"><div class="fig-n f-display">−{{ p.collapsed }}</div><div class="fig-l">copies du même compte</div></div>
          <div class="fig"><div class="fig-n f-display">−{{ p.duplicates }}</div><div class="fig-l">déjà en base</div></div>
          <div class="fig strong"><div class="fig-n f-display">{{ p.toInsert }}</div><div class="fig-l">nouvelles opérations</div></div>
        </div>

        <!-- Comptes inconnus : bloquant, et jamais créés d'office -->
        @if (p.unknownAccounts.length) {
          <div class="banner warn">
            <f-icon name="urgent" [size]="18" color="#B8860B" [width]="2.2" />
            <div>
              <div class="banner-title">{{ p.unknownAccounts.length }} libellé{{ p.unknownAccounts.length > 1 ? 's' : '' }} de compte non reconnu{{ p.unknownAccounts.length > 1 ? 's' : '' }}</div>
              <div class="banner-hint">Rattachez chacun à un compte. Aucun compte n'est créé automatiquement : deviner serait plus risqué qu'utile. Le rattachement est mémorisé pour les imports suivants.</div>
            </div>
          </div>
          <div class="unknowns">
            @for (u of p.unknownAccounts; track u.label) {
              <div class="unknown">
                <div class="ul">
                  <div class="ul-label">{{ u.label }}</div>
                  <div class="ul-meta">{{ u.rows }} ligne{{ u.rows > 1 ? 's' : '' }} · du {{ foyer.fmtNumDate(u.firstDate) }} au {{ foyer.fmtNumDate(u.lastDate) }}</div>
                  <div class="ul-sample">ex. {{ u.sample.join(' · ') }}</div>
                </div>
                <select class="input sel" [ngModel]="store.ui().mapping[u.label]" (ngModelChange)="setMapping(u.label, $event)">
                  <option [ngValue]="null">Rattacher à…</option>
                  @for (a of store.accounts(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
                </select>
                <button class="btn btn-soft" [disabled]="!store.ui().mapping[u.label] || store.ui().importBusy" (click)="store.mapAccount(u.label)">Rattacher</button>
              </div>
            }
          </div>
        }

        <!-- Détail par compte -->
        @if (p.perAccount.length) {
          <div class="table-wrap">
            <table class="tbl">
              <thead><tr><th>Compte</th><th>Période</th><th class="n">Opérations</th><th class="n">Déjà en base</th><th class="n">Nouvelles</th></tr></thead>
              <tbody>
                @for (a of p.perAccount; track a.accountId) {
                  <tr>
                    <td>{{ a.name }}</td>
                    <td class="dim">{{ foyer.fmtNumDate(a.from) }} → {{ foyer.fmtNumDate(a.to) }}</td>
                    <td class="n">{{ a.total }}</td>
                    <td class="n dim">{{ a.duplicates }}</td>
                    <td class="n strong">{{ a.toInsert }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (p.transferCandidates) {
          <div class="note">{{ p.transferCandidates }} virement{{ p.transferCandidates > 1 ? 's' : '' }} interne{{ p.transferCandidates > 1 ? 's' : '' }} possible{{ p.transferCandidates > 1 ? 's' : '' }} détecté{{ p.transferCandidates > 1 ? 's' : '' }}. Ils vous seront proposés après l'import, un par un : rien n'est fusionné tout seul.</div>
        }

        @if (p.rejected.length) {
          <details class="rejected">
            <summary>{{ p.rejected.length }} ligne{{ p.rejected.length > 1 ? 's' : '' }} illisible{{ p.rejected.length > 1 ? 's' : '' }}, ignorée{{ p.rejected.length > 1 ? 's' : '' }}</summary>
            @for (r of p.rejected.slice(0, 30); track r.line) {
              <div class="rej"><span class="rej-line">ligne {{ r.line }}</span> {{ r.reason }}</div>
            }
          </details>
        }

        <div class="acts">
          <button class="btn btn-soft" (click)="store.discardPreview()">Abandonner</button>
          <button class="btn btn-primary grow" [disabled]="p.blocked || !p.toInsert || store.ui().importBusy" (click)="store.commitImport()">
            {{ p.blocked ? 'Rattachez les comptes inconnus' : (p.toInsert ? 'Importer ' + p.toInsert + ' opération' + (p.toInsert > 1 ? 's' : '') : 'Rien de nouveau à importer') }}
          </button>
        </div>
      </div>
    }

    <!-- VIREMENTS INTERNES PROPOSÉS -->
    @if (store.candidates().length) {
      <div class="card">
        <div class="ch">
          <div>
            <div class="card-title sm">Virements internes proposés</div>
            <div class="rmeta">Cochez ceux à fusionner. Les deux lignes restent en base, les soldes ne bougent pas, mais l'opération sort des dépenses et des recettes.</div>
          </div>
          <button class="btn btn-primary" [disabled]="!store.pickedCount() || store.ui().importBusy" (click)="store.mergePicked()">
            Valider {{ store.pickedCount() }} rapprochement{{ store.pickedCount() > 1 ? 's' : '' }}
          </button>
        </div>

        @for (group of candidateGroups(); track group.key) {
          @if (group.key === 'faible') {
            <button class="more" (click)="store.patch({ showWeakCandidates: !store.ui().showWeakCandidates })">
              <f-icon [name]="store.ui().showWeakCandidates ? 'chevronDown' : 'chevronRight'" [size]="14" color="var(--ink2)" [width]="2.4" />
              {{ group.items.length }} rapprochement{{ group.items.length > 1 ? 's' : '' }} douteux (montants opposés, sans mention de virement)
            </button>
          }
          @if (group.key !== 'faible' || store.ui().showWeakCandidates) {
            @for (c of group.items; track store.pairKey(c)) {
              <div class="cand" [class.on]="store.isPicked(c)" (click)="store.togglePick(c)">
                <span class="tick" [class.on]="store.isPicked(c)">
                  @if (store.isPicked(c)) { <f-icon name="check" [size]="11" color="#fff" [width]="3.6" /> }
                </span>
                <div class="cand-body">
                  <div class="cand-legs">
                    <span class="leg">{{ c.debit.accountName }} · {{ foyer.fmtNumDate(c.debit.date) }} · « {{ c.debit.label }} »</span>
                    <f-icon name="chevronRight" [size]="13" color="var(--ink3)" [width]="2.4" />
                    <span class="leg">{{ c.credit.accountName }} · {{ foyer.fmtNumDate(c.credit.date) }} · « {{ c.credit.label }} »</span>
                  </div>
                  <div class="cand-why">{{ c.reason }}</div>
                </div>
                <div class="cand-right">
                  <div class="cand-amt f-display">{{ fmt(c.credit.amount) }} €</div>
                  <div class="badge" [style.background]="foyer.tint(conf(c).color)" [style.color]="conf(c).color">{{ conf(c).label }}</div>
                </div>
              </div>
            }
          }
        }
      </div>
    }


    <!-- VIREMENTS DÉJÀ VALIDÉS -->
    @if (store.transfers().length) {
      <div class="card">
        <div class="card-title sm">Virements internes validés</div>
        <div class="rmeta">Séparer un virement rend ses deux lignes à leur nature de dépense et de recette.</div>
        <div class="tlist">
          @for (t of store.transfers(); track t.group) {
            <div class="trow">
              <span class="tdate">{{ foyer.fmtNumDate(t.date) }}</span>
              <span class="tway">{{ t.from }} → {{ t.to }}</span>
              <span class="tamt f-display">{{ fmt(t.amount) }} €</span>
              <button class="btn btn-soft sm" (click)="store.splitTransfer(t.group)">Séparer</button>
            </div>
          }
        </div>
      </div>
    }

    <!-- HISTORIQUE -->
    <div class="card">
      <div class="card-title sm">Imports</div>
      <div class="rmeta">Annuler un import retire uniquement les lignes qu'il a créées. Rien d'autre ne bouge, et vous pouvez le rejouer ensuite.</div>
      <div class="ilist">
        @for (i of store.imports(); track i.id) {
          <div class="irow">
            <div class="ibody">
              <div class="iname">{{ i.filename }}</div>
              <div class="imeta">
                {{ i.format }} · {{ i.liveRows }} opération{{ i.liveRows > 1 ? 's' : '' }} en base
                @if (i.editedRows) { <span class="edited">dont {{ i.editedRows }} retouchée{{ i.editedRows > 1 ? 's' : '' }} à la main</span> }
              </div>
              @if (i.coverage.length) {
                <div class="icov">Couvre {{ foyer.fmtNumDate(i.coverage[0].from) }} → {{ foyer.fmtNumDate(i.coverage[0].to) }} sur {{ i.coverage.length }} compte{{ i.coverage.length > 1 ? 's' : '' }}</div>
              }
            </div>
            @if (i.liveRows) {
              <button class="btn btn-danger sm" (click)="store.patch({ undoImportId: i.id })">Annuler</button>
            }
          </div>
        } @empty {
          <div class="empty">Aucun import pour l'instant.</div>
        }
      </div>
    </div>

    @if (store.ui().undoImportId) {
      <f-modal [maxWidth]="440" (close)="store.patch({ undoImportId: null })">
        <div class="confirm">
          <div class="confirm-ic"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="confirm-title f-display">Annuler cet import ?</div>
          <div class="confirm-txt">
            {{ undoTarget()?.liveRows }} opération{{ (undoTarget()?.liveRows || 0) > 1 ? 's' : '' }} seront retirées.
            @if (undoTarget()?.editedRows) {
              <strong>{{ undoTarget()?.editedRows }} d'entre elles ont été modifiées à la main depuis l'import ; ces modifications seront perdues.</strong>
            }
            Vous pourrez réimporter le même fichier ensuite, sans doublon.
          </div>
          <div class="modal-acts">
            <button class="btn btn-soft grow" (click)="store.patch({ undoImportId: null })">Garder</button>
            <button class="btn btn-primary grow" [disabled]="store.ui().importBusy" (click)="store.undoImport()">Annuler l'import</button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .banner { display: flex; align-items: flex-start; gap: 12px; border-radius: 16px; padding: 14px 16px; margin-bottom: 16px; font-size: 13.5px; font-weight: 700; }
    .banner.warn { background: #FDF0DA; color: #7A5C12; }
    .banner.err { background: #FCE9E3; color: #8C3B26; align-items: center; }
    :host-context(.dark) .banner.warn { background: #3A3123; color: #E8C88A; }
    :host-context(.dark) .banner.err { background: #3A2622; color: #F0A98B; }
    .banner-title { font-weight: 800; margin-bottom: 4px; }
    .banner-hint { font-size: 12.5px; font-weight: 700; opacity: .85; line-height: 1.45; }

    .drop { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 44px 24px; border-radius: 20px; border: 2px dashed var(--line2); background: var(--surface); cursor: pointer; text-align: center; margin-bottom: 18px; }
    .drop:hover { border-color: var(--primary); background: var(--soft); }
    .drop.busy { opacity: .6; pointer-events: none; }
    .drop-title { font-size: 15.5px; font-weight: 800; color: var(--ink); margin-top: 6px; }
    .drop-sub { font-size: 12.5px; font-weight: 700; color: var(--ink3); max-width: 460px; line-height: 1.45; }

    .card { background: var(--surface); border-radius: 20px; padding: 20px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); margin-bottom: 18px; }
    .ch { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
    .rh { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .rmeta { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 3px; line-height: 1.45; max-width: 640px; }

    .figs { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
    .fig { flex: 1; min-width: 120px; background: var(--soft2); border-radius: 14px; padding: 13px 15px; }
    .fig.strong { background: var(--primary); color: #fff; }
    .fig-n { font-size: 25px; font-weight: 700; }
    .fig-l { font-size: 11.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; opacity: .7; margin-top: 2px; }

    .unknowns { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
    .unknown { display: flex; align-items: center; gap: 11px; background: var(--soft2); border-radius: 14px; padding: 12px 14px; flex-wrap: wrap; }
    .ul { flex: 1; min-width: 220px; }
    .ul-label { font-size: 13.5px; font-weight: 800; color: var(--ink); word-break: break-word; }
    .ul-meta { font-size: 12px; font-weight: 700; color: var(--ink2); margin-top: 2px; }
    .ul-sample { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 2px; font-style: italic; }
    .sel { width: auto; min-width: 180px; height: 40px; padding: 0 12px; }

    .table-wrap { overflow-x: auto; margin-bottom: 16px; }
    .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
    .tbl th { text-align: left; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--ink3); padding: 0 10px 8px 0; white-space: nowrap; }
    .tbl td { padding: 8px 10px 8px 0; font-weight: 700; color: var(--ink); border-top: 1px solid var(--line); white-space: nowrap; }
    .tbl .n { text-align: right; font-variant-numeric: tabular-nums; }
    .tbl .dim { color: var(--ink3); }
    .tbl .strong { color: var(--primary); font-weight: 800; }

    .note { font-size: 12.5px; font-weight: 700; color: var(--ink2); background: var(--soft2); border-radius: 12px; padding: 11px 13px; line-height: 1.45; margin-bottom: 14px; }
    .rejected { font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-bottom: 14px; }
    .rejected summary { cursor: pointer; }
    .rej { padding: 5px 0 0 14px; color: var(--ink3); }
    .rej-line { font-weight: 800; color: var(--ink2); }

    .acts { display: flex; gap: 12px; }
    .acts .grow { flex: 1; }

    .cand { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 14px; cursor: pointer; border: 2px solid transparent; }
    .cand:hover { background: var(--soft); }
    .cand.on { background: var(--soft); border-color: var(--primary); }
    .tick { width: 20px; height: 20px; flex: none; border-radius: 6px; border: 2px solid var(--line2); display: flex; align-items: center; justify-content: center; }
    .tick.on { background: var(--primary); border-color: var(--primary); }
    .cand-body { flex: 1; min-width: 0; }
    .cand-legs { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-size: 13px; font-weight: 700; color: var(--ink); }
    .leg { word-break: break-word; }
    .cand-why { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 3px; }
    .cand-right { flex: none; text-align: right; }
    .cand-amt { font-size: 16px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
    .badge { display: inline-block; margin-top: 4px; font-size: 10.5px; font-weight: 800; padding: 2px 8px; border-radius: 20px; }
    .more { display: flex; align-items: center; gap: 7px; margin-top: 10px; background: none; border: none; padding: 8px 0 0; font-size: 12.5px; font-weight: 800; color: var(--ink2); cursor: pointer; font-family: inherit; }

    .tlist, .ilist { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .trow { display: flex; align-items: center; gap: 12px; padding: 9px 12px; background: var(--soft2); border-radius: 12px; flex-wrap: wrap; }
    .tdate { font-size: 12.5px; font-weight: 800; color: var(--ink2); }
    .tway { flex: 1; min-width: 140px; font-size: 13px; font-weight: 700; color: var(--ink); }
    .tamt { font-size: 14px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
    .btn.sm { padding: 6px 12px; font-size: 12px; }

    .irow { display: flex; align-items: center; gap: 12px; padding: 11px 13px; background: var(--soft2); border-radius: 13px; }
    .ibody { flex: 1; min-width: 0; }
    .iname { font-size: 13.5px; font-weight: 800; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .imeta { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 2px; }
    .edited { color: #B8860B; }
    .icov { font-size: 11.5px; font-weight: 700; color: var(--ink3); margin-top: 2px; }
    .empty { font-size: 13px; font-weight: 700; color: var(--ink3); padding: 10px 0; }

    .modal-acts { display: flex; gap: 12px; margin-top: 22px; }
    .modal-acts .grow { flex: 1; }
    .confirm { text-align: center; }
    .confirm-ic { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #FCE9E3; display: flex; align-items: center; justify-content: center; }
    .confirm-title { font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-txt { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 0; line-height: 1.5; }
  `],
})
export class FinancesImportTab {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  fmt = fmtEuros;

  constructor() {
    void this.store.loadImports();
    void this.store.loadCandidates();
  }

  conf(c: FinTransferCandidate): { label: string; color: string } { return CONFIDENCE[c.confidence]; }
  setMapping(label: string, accountId: number | null): void {
    this.store.patch({ mapping: { ...this.store.ui().mapping, [label]: accountId } });
  }
  undoTarget = computed(() => this.store.imports().find((i) => i.id === this.store.ui().undoImportId));

  /** Reliable candidates first, doubtful ones behind a fold. */
  candidateGroups = computed(() => [
    { key: 'sure', items: this.store.strongCandidates() },
    { key: 'faible', items: this.store.weakCandidates() },
  ].filter((g) => g.items.length));

  onPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void this.store.upload(file);
    input.value = '';
  }
  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (file) void this.store.upload(file);
  }
}
