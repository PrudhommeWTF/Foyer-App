import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinAsset, FinContract, FinContractKind, FinDeadlineKind } from '../../core/finances.api';
import { FinancesStore, fmtEuros, fmtEurosInt } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { CAT_ICONS } from '../../core/constants';
import { ModalComponent } from '../../shared/modal';

const ASSET_KINDS: { id: FinAsset['kind']; label: string; icon: string }[] = [
  { id: 'immobilier', label: 'Bien immobilier', icon: 'maison' },
  { id: 'vehicule', label: 'Véhicule', icon: 'voiture' },
  { id: 'autre', label: 'Autre', icon: 'facture' },
];

const CONTRACT_KINDS: { id: FinContractKind; label: string }[] = [
  { id: 'assurance', label: 'Assurance' },
  { id: 'energie', label: 'Énergie' },
  { id: 'telecom', label: 'Téléphonie et internet' },
  { id: 'abonnement', label: 'Abonnement' },
  { id: 'credit', label: 'Crédit' },
  { id: 'sante', label: 'Santé' },
  { id: 'autre', label: 'Autre' },
];

const PERIODICITIES: { id: FinContract['periodicity']; label: string }[] = [
  { id: 'mensuelle', label: 'Mensuelle' },
  { id: 'trimestrielle', label: 'Trimestrielle' },
  { id: 'semestrielle', label: 'Semestrielle' },
  { id: 'annuelle', label: 'Annuelle' },
  { id: 'ponctuelle', label: 'Ponctuelle' },
];

const DEADLINE_LABEL: Record<FinDeadlineKind, string> = {
  preavis: 'Dernier jour pour résilier',
  renouvellement: 'Reconduction tacite',
  fin: 'Fin du contrat',
};

@Component({
  selector: 'fin-contracts-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <!-- ÉCHÉANCES : ce qui coûte de l'argent si on l'oublie -->
    @if (store.deadlines().length) {
      <div class="panel">
        <div class="panel-title">Échéances des six prochains mois</div>
        <div class="panel-sub">Un contrat tacitement reconduit et manqué d'un jour coûte une période de plus</div>
        <div class="deads">
          @for (d of store.deadlines(); track d.contractId + d.kind) {
            <div class="dead" [class.urgent]="d.kind === 'preavis' && d.daysAway >= 0 && d.daysAway <= 30"
                 [class.past]="d.daysAway < 0" (click)="store.editContract(d.contractId)">
              <div class="dead-when">
                <div class="dead-date">{{ foyer.fmtNumDate(d.date) }}</div>
                <div class="dead-in">{{ relative(d.daysAway) }}</div>
              </div>
              <div class="dead-body">
                <div class="dead-title">{{ DEADLINE_LABEL[d.kind] }}</div>
                <div class="dead-sub">{{ d.contractName }}@if (d.provider) { · {{ d.provider }} }</div>
              </div>
              @if (d.kind === 'preavis') {
                <f-icon name="urgent" [size]="17" [color]="d.daysAway < 0 ? 'var(--ink3)' : '#C6492F'" [width]="2.2" />
              }
            </div>
          }
        </div>
      </div>
    }

    <div class="bar">
      <div class="hint">Un contrat explique des opérations : rattachez-les pour comparer ce que vous payez à ce qui était annoncé.</div>
      <div class="spacer"></div>
      <button class="btn btn-soft" (click)="store.newAsset()"><f-icon name="plus" [size]="16" color="var(--ink2)" [width]="2.6" /> Bien</button>
      <button class="btn btn-primary" (click)="store.newContract(null)"><f-icon name="plus" [size]="16" color="#fff" [width]="2.6" /> Contrat</button>
    </div>

    <!-- BIENS, chacun avec ses contrats -->
    @for (a of store.assets(); track a.id) {
      <div class="panel asset">
        <div class="asset-head">
          <div class="asset-chip"><f-icon [path]="CAT_ICONS[iconOf(a.kind)]" [size]="18" color="var(--ink2)" [width]="2" /></div>
          <div class="asset-id">
            <div class="asset-name">{{ a.name }}@if (a.status === 'vendu') { <span class="tag">vendu</span> }</div>
            <div class="asset-meta">{{ kindLabel(a.kind) }}@if (a.address) { · {{ a.address }} }@if (a.acquiredOn) { · acquis le {{ foyer.fmtNumDate(a.acquiredOn) }} }</div>
          </div>
          <button class="icon-btn sm" (click)="store.editAsset(a.id)" aria-label="Modifier le bien"><f-icon name="edit" [size]="14" color="var(--ink2)" /></button>
          <button class="icon-btn sm" (click)="store.patch({ asDelId: a.id })" aria-label="Supprimer le bien"><f-icon name="trash" [size]="14" color="var(--primary)" /></button>
        </div>
        <div class="clist">
          @for (c of store.contractsOfAsset(a.id); track c.id) {
            <div class="contract" (click)="store.editContract(c.id)">
              <div class="c-body">
                <div class="c-name">{{ c.name }}@if (c.status === 'resilie') { <span class="tag">résilié</span> }</div>
                <div class="c-meta">{{ contractMeta(c) }}</div>
              </div>
              <div class="c-cost">{{ costLabel(c) }}</div>
            </div>
          } @empty {
            <div class="none">Aucun contrat rattaché à ce bien.</div>
          }
        </div>
        <button class="addsub" (click)="store.newContract(a.id)"><f-icon name="plus" [size]="13" color="var(--primary)" [width]="2.8" /> Contrat sur ce bien</button>
      </div>
    }

    <!-- CONTRATS SANS BIEN -->
    <div class="panel">
      <div class="panel-title">Contrats sans bien rattaché</div>
      <div class="clist">
        @for (c of store.looseContracts(); track c.id) {
          <div class="contract" (click)="store.editContract(c.id)">
            <div class="c-body">
              <div class="c-name">{{ c.name }}@if (c.status === 'resilie') { <span class="tag">résilié</span> }</div>
              <div class="c-meta">{{ contractMeta(c) }}</div>
            </div>
            <div class="c-cost">{{ costLabel(c) }}</div>
          </div>
        } @empty {
          <div class="none">
            @if (store.contracts().length) {
              Tous vos contrats sont rattachés à un bien.
            } @else {
              Aucun contrat pour l'instant. Commencez par ceux qui se reconduisent tout seuls : assurances, énergie, téléphonie.
            }
          </div>
        }
      </div>
    </div>

    <!-- FORMULAIRE DE BIEN -->
    @if (store.ui().asForm) {
      <f-modal [title]="store.ui().asId ? 'Modifier le bien' : 'Nouveau bien'" [maxWidth]="500" (close)="store.patch({ asForm: false })">
        <div class="field-label">Nom</div>
        <input class="input" [ngModel]="store.ui().asName" (ngModelChange)="store.patch({ asName: $event })" placeholder="Ex : Maison de Quincy" />
        <div class="frow">
          <div class="fgrow">
            <div class="field-label">Type</div>
            <select class="input" [ngModel]="store.ui().asKind" (ngModelChange)="store.patch({ asKind: $event })">
              @for (k of assetKinds; track k.id) { <option [ngValue]="k.id">{{ k.label }}</option> }
            </select>
          </div>
          <div class="fgrow">
            <div class="field-label">Statut</div>
            <select class="input" [ngModel]="store.ui().asStatus" (ngModelChange)="store.patch({ asStatus: $event })">
              <option [ngValue]="'actif'">Actif</option>
              <option [ngValue]="'vendu'">Vendu</option>
            </select>
          </div>
        </div>
        <div class="field-label">Adresse ou immatriculation</div>
        <input class="input" [ngModel]="store.ui().asAddress" (ngModelChange)="store.patch({ asAddress: $event })" placeholder="Facultatif" />
        <div class="frow">
          <div class="fgrow">
            <div class="field-label">Acquis le</div>
            <input class="input" type="date" [ngModel]="store.ui().asAcquired" (ngModelChange)="store.patch({ asAcquired: $event })" />
          </div>
          <div class="fgrow">
            <div class="field-label">Vendu le</div>
            <input class="input" type="date" [ngModel]="store.ui().asSold" (ngModelChange)="store.patch({ asSold: $event })" />
          </div>
        </div>
        <div class="field-label">Notes</div>
        <input class="input" [ngModel]="store.ui().asNotes" (ngModelChange)="store.patch({ asNotes: $event })" placeholder="Facultatif" />
        <div class="modal-acts">
          @if (store.ui().asId) {
            <button class="btn btn-danger" (click)="store.patch({ asDelId: store.ui().asId })"><f-icon name="trash" [size]="16" color="var(--primary)" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ asForm: false })">Annuler</button>
          <button class="btn btn-primary" [disabled]="store.ui().busy" (click)="store.saveAsset()">Enregistrer</button>
        </div>
      </f-modal>
    }

    <!-- FORMULAIRE DE CONTRAT -->
    @if (store.ui().coForm) {
      <f-modal [title]="store.ui().coId ? 'Modifier le contrat' : 'Nouveau contrat'" [maxWidth]="600" (close)="store.patch({ coForm: false })">
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
              @for (a of store.activeAccounts(); track a.id) { <option [ngValue]="a.id">{{ a.name }}</option> }
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
          <div class="fgrow">
            <div class="field-label">Membre</div>
            <select class="input" [ngModel]="store.ui().coMember" (ngModelChange)="store.patch({ coMember: $event })">
              <option value="">Le foyer</option>
              @for (m of members(); track m.id) { <option [value]="m.id">{{ m.name }}</option> }
            </select>
          </div>
        </div>

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

        @if (store.ui().coId; as cid) {
          @if (store.costOf(cid); as cost) {
            <div class="cost-box" [class.off]="cost.offRange">
              <div class="cost-line">
                <strong>{{ cost.count }} opération{{ cost.count > 1 ? 's' : '' }}</strong> rattachée{{ cost.count > 1 ? 's' : '' }} sur douze mois,
                <strong>{{ fmtInt(cost.total) }} €</strong> au total.
              </div>
              @if (cost.lastAmount !== null) {
                <div class="cost-line">
                  Dernier prélèvement : {{ fmt(cost.lastAmount) }} € le {{ foyer.fmtNumDate(cost.lastDate || '') }}.
                  @if (cost.offRange) { <span class="off-txt">Hors de la fourchette annoncée.</span> }
                </div>
              }
              <button class="linkbtn" (click)="store.openContractOperations(cid)">Voir ces opérations</button>
            </div>
          } @else {
            <div class="cost-box">
              <div class="cost-line">Aucune opération rattachée. Rattachez-les depuis une opération, ou créez une règle « rattacher au contrat ».</div>
            </div>
          }
        }

        <div class="modal-acts">
          @if (store.ui().coId) {
            <button class="btn btn-danger" (click)="store.patch({ coDelId: store.ui().coId })"><f-icon name="trash" [size]="16" color="var(--primary)" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ coForm: false })">Annuler</button>
          <button class="btn btn-primary" [disabled]="store.ui().busy" (click)="store.saveContract()">Enregistrer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().asDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ asDelId: null })">
        <div class="confirm">
          <div class="confirm-ic"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="confirm-title f-display">Supprimer ce bien ?</div>
          <div class="confirm-txt">Ses contrats sont conservés, ils passent simplement en « sans bien rattaché ».</div>
          <div class="modal-acts">
            <button class="btn btn-soft grow" (click)="store.patch({ asDelId: null })">Annuler</button>
            <button class="btn btn-primary grow" (click)="store.confirmAssetDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }

    @if (store.ui().coDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ coDelId: null })">
        <div class="confirm">
          <div class="confirm-ic"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="confirm-title f-display">Supprimer ce contrat ?</div>
          <div class="confirm-txt">Les opérations rattachées sont conservées, elles perdent seulement leur explication. Si le contrat est simplement terminé, passez-le en « résilié » plutôt que de le supprimer : son historique reste lisible.</div>
          <div class="modal-acts">
            <button class="btn btn-soft grow" (click)="store.patch({ coDelId: null })">Annuler</button>
            <button class="btn btn-primary grow" (click)="store.confirmContractDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .panel { background: var(--surface); border-radius: 18px; padding: 18px; margin-bottom: 14px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .panel-title { font-size: 15px; font-weight: 800; color: var(--ink); }
    .panel-sub { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 2px; }

    .deads { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .dead { display: flex; align-items: center; gap: 13px; border-radius: 13px; padding: 9px 11px; background: var(--soft); cursor: pointer; }
    .dead:hover { background: var(--soft2); }
    .dead.urgent { background: #FCE9E3; }
    :host-context(.dark) .dead.urgent { background: #3A2622; }
    .dead.past { opacity: .6; }
    .dead-when { flex: none; width: 96px; }
    .dead-date { font-size: 13px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
    .dead-in { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .dead-body { flex: 1; min-width: 0; }
    .dead-title { font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .dead-sub { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
    .spacer { flex: 1; }
    .hint { font-size: 12.5px; font-weight: 700; color: var(--ink3); flex: 1; min-width: 220px; line-height: 1.5; }
    .hint.sm { margin-top: 8px; flex: none; }

    .asset-head { display: flex; align-items: center; gap: 12px; }
    .asset-chip { width: 38px; height: 38px; flex: none; border-radius: 12px; background: var(--soft2); display: flex; align-items: center; justify-content: center; }
    .asset-id { flex: 1; min-width: 0; }
    .asset-name { font-size: 15px; font-weight: 800; color: var(--ink); display: flex; align-items: center; gap: 7px; }
    .asset-meta { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag { background: var(--soft2); border-radius: 20px; padding: 1px 8px; font-size: 10.5px; font-weight: 800; color: var(--ink2); }

    .clist { display: flex; flex-direction: column; gap: 7px; margin-top: 12px; }
    .contract { display: flex; align-items: center; gap: 12px; border-radius: 13px; padding: 9px 11px; background: var(--soft); cursor: pointer; }
    .contract:hover { background: var(--soft2); }
    .c-body { flex: 1; min-width: 0; }
    .c-name { font-size: 13.5px; font-weight: 800; color: var(--ink); display: flex; align-items: center; gap: 7px; }
    .c-meta { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .c-cost { flex: none; font-size: 12.5px; font-weight: 800; color: var(--ink2); font-variant-numeric: tabular-nums; text-align: right; }
    .none { font-size: 13px; font-weight: 700; color: var(--ink3); padding: 10px 0; line-height: 1.5; }
    .addsub { margin-top: 10px; background: none; border: none; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; font-family: inherit; padding: 4px 0; }
    .icon-btn.sm { width: 30px; height: 30px; flex: none; border: none; border-radius: 9px; background: var(--soft2); display: flex; align-items: center; justify-content: center; cursor: pointer; }

    .frow { display: flex; gap: 12px; }
    .fgrow { flex: 1; min-width: 0; }
    .fnarrow { width: 120px; flex: none; }
    @media (max-width: 560px) { .frow { flex-direction: column; } .fnarrow { width: 100%; } }
    .field-label { margin-top: 14px; }
    .frow .field-label { margin-top: 0; }
    .frow + .frow .field-label, .frow + .hint + .frow .field-label { margin-top: 14px; }
    .sec-label { margin-top: 20px; margin-bottom: 9px; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--ink3); }
    .refrow { display: flex; gap: 8px; margin-bottom: 8px; }
    .refrow .input { flex: 1; min-width: 0; }
    .icon-btn { width: 38px; height: 38px; flex: none; border: none; border-radius: 11px; background: var(--soft2); display: flex; align-items: center; justify-content: center; cursor: pointer; }

    .cost-box { margin-top: 18px; background: var(--soft); border-radius: 14px; padding: 12px 14px; }
    .cost-box.off { background: #FDF0DA; }
    :host-context(.dark) .cost-box.off { background: #3A3123; }
    .cost-line { font-size: 12.5px; font-weight: 700; color: var(--ink2); line-height: 1.6; }
    .cost-box.off .cost-line { color: #7A5C12; }
    :host-context(.dark) .cost-box.off .cost-line { color: #E8C88A; }
    .off-txt { font-weight: 800; }
    .linkbtn { margin-top: 8px; background: none; border: none; padding: 0; font-family: inherit; font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; }

    .modal-acts { display: flex; gap: 12px; margin-top: 22px; align-items: center; flex-wrap: wrap; }
    .modal-acts .spacer { flex: 1; }
    .modal-acts .grow { flex: 1; }
    .confirm { text-align: center; }
    .confirm-ic { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #FCE9E3; display: flex; align-items: center; justify-content: center; }
    .confirm-title { font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-txt { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 0; line-height: 1.5; }
  `],
})
export class FinancesContractsTab {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  assetKinds = ASSET_KINDS;
  contractKinds = CONTRACT_KINDS;
  periodicities = PERIODICITIES;
  CAT_ICONS = CAT_ICONS;
  DEADLINE_LABEL = DEADLINE_LABEL;
  fmt = fmtEuros;
  fmtInt = fmtEurosInt;

  /** Household members, for the « qui porte ce contrat » selector. */
  members = computed(() => this.foyer.data()?.members ?? []);

  constructor() { void this.store.loadContracts(); }

  iconOf(kind: FinAsset['kind']): string { return ASSET_KINDS.find((k) => k.id === kind)?.icon || 'facture'; }
  kindLabel(kind: FinAsset['kind']): string { return ASSET_KINDS.find((k) => k.id === kind)?.label || ''; }

  /** « dans 12 jours », « aujourd'hui », « il y a 3 jours ». */
  relative(days: number): string {
    if (days === 0) return "aujourd'hui";
    if (days > 0) return days === 1 ? 'demain' : `dans ${days} jours`;
    return days === -1 ? 'hier' : `il y a ${-days} jours`;
  }

  contractMeta(c: FinContract): string {
    const bits: string[] = [CONTRACT_KINDS.find((k) => k.id === c.kind)?.label || ''];
    if (c.provider) bits.push(c.provider);
    if (c.accountId) bits.push(this.store.accountName(c.accountId));
    if (c.renewalOn) bits.push(`reconduit le ${this.foyer.fmtNumDate(c.renewalOn)}`);
    return bits.filter(Boolean).join(' · ');
  }

  /** Expected amount, or the real one when operations back it up. */
  costLabel(c: FinContract): string {
    const cost = this.store.costOf(c.id);
    if (cost?.lastAmount != null) return `${fmtEuros(cost.lastAmount)} €`;
    if (c.amountMin !== null && c.amountMax !== null && c.amountMin !== c.amountMax) {
      return `${fmtEurosInt(c.amountMin)} à ${fmtEurosInt(c.amountMax)} €`;
    }
    const one = c.amountMin ?? c.amountMax;
    return one !== null ? `${fmtEuros(one)} €` : '';
  }

  /** Live preview of the notice deadline while the form is being filled. */
  noticeDate = computed(() => {
    const u = this.store.ui();
    const days = parseInt(u.coNotice || '0', 10);
    if (!u.coRenewal || !days) return '';
    const d = new Date(u.coRenewal + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return this.foyer.fmtNumDate(d.toISOString().slice(0, 10));
  });
}
