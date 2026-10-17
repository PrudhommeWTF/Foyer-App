import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinAsset, FinContract, FinSaving } from '../../core/finances.api';
import { FinancesStore, fmtEuros, fmtEurosInt } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { CAT_ICONS } from '../../core/constants';
import { deadlineLabel } from '../../core/deadlines';
import { ModalComponent } from '../../shared/modal';
import { ConfirmComponent } from '../../shared/confirm';
import { CheckComponent } from '../../shared/check';
import { FinAttachments } from './attachments';
import { FinContractSheet } from './contract-sheet';
import { FinRange } from './charts/range';
import { FinEntretienPanel } from './entretien-panel';
import { ASSET_KINDS, CONTRACT_KINDS, periodWord } from './contract-labels';

/**
 * Contrats : les biens et leurs contrats (fourchette annoncée face au dernier
 * prélèvement), les échéances des six prochains mois et les pistes
 * d'économies. Sur ordinateur, « Contrats et biens » montre les trois ; sur
 * téléphone, chaque sous-onglet montre le sien.
 */
@Component({
  selector: 'fin-contracts-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, FormsModule, IconComponent, ModalComponent, ConfirmComponent, CheckComponent, FinAttachments, FinContractSheet, FinRange, FinEntretienPanel],
  template: `
    @let u = store.ui();
    <div class="subtabs" role="tablist" aria-label="Contrats">
      <button role="tab" [attr.aria-selected]="u.contratsTab === 'contrats'" [class.on]="u.contratsTab === 'contrats'" (click)="store.patch({ contratsTab: 'contrats' })">Contrats et biens</button>
      <button role="tab" [attr.aria-selected]="u.contratsTab === 'echeances'" [class.on]="u.contratsTab === 'echeances'" (click)="store.patch({ contratsTab: 'echeances' })">Échéances · {{ upcoming() }}</button>
      <button role="tab" [attr.aria-selected]="u.contratsTab === 'economies'" [class.on]="u.contratsTab === 'economies'" (click)="store.patch({ contratsTab: 'economies' })">Économies · {{ fmtInt(store.savingsTotals().pending) }} €/an</button>
      @if (foyer.modEntretien()) {
        <button role="tab" [attr.aria-selected]="u.contratsTab === 'entretien'" [class.on]="u.contratsTab === 'entretien'" (click)="store.patch({ contratsTab: 'entretien' })">Entretien</button>
      }
    </div>

    @switch (u.contratsTab) {
      @case ('contrats') {
        @if (foyer.narrow()) {
          <ng-container [ngTemplateOutlet]="assetsPanel" />
        } @else {
          <div class="cols">
            <div class="col-l"><ng-container [ngTemplateOutlet]="deadlinesPanel" /><ng-container [ngTemplateOutlet]="savingsPanel" />@if (foyer.modEntretien()) { <fin-entretien-panel /> }</div>
            <div class="col-r"><ng-container [ngTemplateOutlet]="assetsPanel" /></div>
          </div>
        }
      }
      @case ('echeances') { <ng-container [ngTemplateOutlet]="deadlinesPanel" /> }
      @case ('economies') { <ng-container [ngTemplateOutlet]="savingsPanel" /> }
      @case ('entretien') { @if (foyer.modEntretien()) { <fin-entretien-panel /> } @else { <ng-container [ngTemplateOutlet]="assetsPanel" /> } }
    }

    <!-- ÉCHÉANCES : ce qui coûte de l'argent si on l'oublie -->
    <ng-template #deadlinesPanel>
      <section class="panel">
        <div class="panel-title">Échéances des six prochains mois</div>
        <div class="panel-sub">Un contrat tacitement reconduit et manqué d'un jour coûte une période de plus. Ces dates sont aussi dans le calendrier partagé et le flux ICS.</div>
        @for (d of soonDeadlines(); track d.contractId + d.kind + d.date) {
          @let urgent = d.kind === 'preavis' && d.daysAway >= 0 && d.daysAway < 30;
          <div class="dead" [class.past]="d.daysAway < 0">
            <button type="button" class="dead-main" (click)="store.editContract(d.contractId)">
              <span class="dd" [class.crit]="urgent"><b>{{ dayNum(d.date) }}</b><small>{{ monthShort(d.date) }}</small></span>
              <span class="dead-body">
                <span class="dead-title" [class.crit]="urgent">@if (urgent) {<span aria-hidden="true">⚠ </span>}{{ deadlineLabel(d.kind) }}</span>
                <span class="dead-sub">{{ d.contractName }}@if (d.provider) { · {{ d.provider }} } · {{ relative(d.daysAway) }}</span>
              </span>
            </button>
            @if (d.daysAway >= 0) {
              <button class="dead-task" (click)="store.taskFromDeadline(d)" [attr.aria-label]="'Ajouter une tâche : ' + deadlineLabel(d.kind) + ', ' + d.contractName">+ Tâche</button>
            }
          </div>
        } @empty {
          <div class="none">Aucune échéance dans les six prochains mois. Renseignez la date de reconduction et le préavis de vos contrats pour les voir ici.</div>
        }
      </section>
    </ng-template>

    <!-- PISTES D'ÉCONOMIES -->
    <ng-template #savingsPanel>
      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">Pistes d'économies</div>
          <button class="soft-btn" (click)="store.newSaving(null)">+ Piste</button>
        </div>
        @if (store.savingsTotals(); as t) {
          @if (t.count) {
            <div class="totals">
              <span>À aller chercher <b>{{ fmtInt(t.pending) }} €/an</b> · {{ t.openCount }} piste{{ t.openCount > 1 ? 's' : '' }}</span>
              <span>Déjà obtenu <b class="good">{{ fmtInt(t.done) }} €/an</b></span>
            </div>
          }
        }
        <div class="clist">
          @for (s of store.savings(); track s.id) {
            <div class="saving" [class.done]="s.status === 'faite'" [class.dropped]="s.status === 'abandonnee'">
              <button class="s-check-btn" [attr.aria-label]="s.status === 'faite' ? 'Rouvrir la piste' : 'Marquer comme faite'"
                      (click)="store.setSavingStatus(s.id, s.status === 'faite' ? 'idee' : 'faite')">
                <f-check [checked]="s.status === 'faite'" />
              </button>
              <button type="button" class="s-body" (click)="store.editSaving(s.id)">
                <span class="s-title">
                  {{ s.title }}
                  @if (s.status === 'en-cours') { <span class="tag">en cours</span> }
                  @if (s.status === 'abandonnee') { <span class="tag">abandonnée</span> }
                </span>
                <span class="s-meta">{{ savingMeta(s) }}</span>
              </button>
              @if (s.status !== 'faite' && s.status !== 'abandonnee') {
                @if (store.savingTask(s)) {
                  <span class="tag">tâche créée</span>
                } @else {
                  <button class="dead-task" (click)="store.taskFromSaving(s.id)" title="Ajouter cette piste à mes tâches">+ Tâche</button>
                }
              }
              <div class="s-gain">+{{ fmtInt(s.annualGain) }} €<span class="s-unit">/an</span></div>
            </div>
          } @empty {
            <div class="none">Aucune piste. Un contrat dont le coût réel dépasse la fourchette annoncée est souvent le meilleur endroit où en trouver une.</div>
          }
        </div>
      </section>
    </ng-template>

    <!-- BIENS ET CONTRATS -->
    <ng-template #assetsPanel>
      <section class="panel">
        <div class="panel-head">
          <div class="panel-title">Biens et contrats</div>
          <span class="head-acts">
            <button class="soft-btn" (click)="store.newAsset()">+ Bien</button>
            <button class="soft-btn" (click)="store.newContract(null)">+ Contrat</button>
          </span>
        </div>
        <div class="legend">
          <span class="lg"><span class="sw band"></span>Fourchette annoncée</span>
          <span class="lg"><span class="sw mark"></span>Dernier prélèvement</span>
          <span class="lg"><span class="sw mark off"></span>Hors fourchette</span>
        </div>
        @for (a of store.assets(); track a.id) {
          <div class="block">
            <div class="asset-head">
              <span class="asset-chip"><f-icon [path]="CAT_ICONS[iconOf(a.kind)]" [size]="17" color="var(--ink2)" [width]="2" /></span>
              <span class="asset-id">
                <b>{{ a.name }}</b>@if (a.status === 'vendu') { <span class="tag">vendu</span> }
                <small>{{ kindLabel(a.kind) }}@if (a.address) { · {{ a.address }} }@if (a.acquiredOn) { · acquis le {{ foyer.fmtNumDate(a.acquiredOn) }} }</small>
              </span>
              <button class="icon-btn sm" (click)="store.editAsset(a.id)" [attr.aria-label]="'Modifier le bien ' + a.name"><f-icon name="edit" [size]="14" color="var(--ink2)" /></button>
              <button class="icon-btn sm" (click)="store.patch({ asDelId: a.id })" [attr.aria-label]="'Supprimer le bien ' + a.name"><f-icon name="trash" [size]="14" color="var(--primary)" /></button>
            </div>
            @for (c of store.contractsOfAsset(a.id); track c.id) {
              <ng-container [ngTemplateOutlet]="contractRow" [ngTemplateOutletContext]="{ $implicit: c }" />
            } @empty {
              <div class="none">Aucun contrat rattaché à ce bien.</div>
            }
            <button class="addsub" (click)="store.newContract(a.id)">+ Contrat sur ce bien</button>
          </div>
        }
        <div class="block">
          <div class="asset-head"><span class="asset-id"><b>Sans bien rattaché</b></span></div>
          @for (c of store.looseContracts(); track c.id) {
            <ng-container [ngTemplateOutlet]="contractRow" [ngTemplateOutletContext]="{ $implicit: c }" />
          } @empty {
            <div class="none">
              @if (store.contracts().length) { Tous vos contrats sont rattachés à un bien. }
              @else { Aucun contrat pour l'instant. Commencez par ceux qui se reconduisent tout seuls : assurances, énergie, téléphonie. }
            </div>
          }
        </div>
      </section>
    </ng-template>

    <ng-template #contractRow let-c>
      @let cost = store.costOf(c.id);
      <!-- Toute la ligne ouvre la fiche ; au clavier, c'est le nom (la fourchette garde son propre focus). -->
      <div class="contract" [class.ended]="c.status === 'resilie'" (click)="store.editContract(c.id)">
        <button type="button" class="c-body" (click)="$event.stopPropagation(); store.editContract(c.id)">
          <b>{{ c.name }}{{ c.provider ? ' · ' + c.provider : '' }}</b>
          <small>{{ contractMeta(c) }}</small>
        </button>
        <fin-range class="c-range" [min]="c.amountMin" [max]="c.amountMax" [last]="cost?.lastAmount ?? null" [off]="!!cost?.offRange" />
        <span class="c-cost" [class.off]="cost?.offRange">@if (cost?.offRange) {<span aria-hidden="true">⚠ </span>}{{ costLabel(c) }}</span>
      </div>
    </ng-template>

    <!-- FORMULAIRE DE PISTE -->
    @if (store.ui().saForm) {
      <f-modal [title]="store.ui().saId ? 'Modifier la piste' : 'Nouvelle piste d’économie'" [maxWidth]="520" (close)="store.patch({ saForm: false })">
        <div class="field-label">Intitulé</div>
        <input class="input" [ngModel]="store.ui().saTitle" (ngModelChange)="store.patch({ saTitle: $event })" placeholder="Ex : Renégocier l’assurance habitation" />
        <div class="frow">
          <div class="fgrow">
            <div class="field-label">Gain annuel estimé €</div>
            <input class="input" [ngModel]="store.ui().saGain" (ngModelChange)="store.patch({ saGain: $event })" placeholder="240" inputmode="decimal" />
          </div>
          <div class="fgrow">
            <div class="field-label">Statut</div>
            <select class="input" [ngModel]="store.ui().saStatus" (ngModelChange)="store.patch({ saStatus: $event })">
              <option [ngValue]="'idee'">Idée</option>
              <option [ngValue]="'en-cours'">En cours</option>
              <option [ngValue]="'faite'">Faite</option>
              <option [ngValue]="'abandonnee'">Abandonnée</option>
            </select>
          </div>
        </div>
        <div class="frow">
          <div class="fgrow">
            <div class="field-label">Contrat concerné</div>
            <select class="input" [ngModel]="store.ui().saContract" (ngModelChange)="store.patch({ saContract: $event })">
              <option [ngValue]="null">Aucun</option>
              @for (c of store.contracts(); track c.id) { <option [ngValue]="c.id">{{ c.name }}{{ c.provider ? ' · ' + c.provider : '' }}</option> }
            </select>
          </div>
          <div class="fgrow">
            <div class="field-label">À faire avant le</div>
            <input class="input" type="date" [ngModel]="store.ui().saDate" (ngModelChange)="store.patch({ saDate: $event })" />
          </div>
        </div>
        <div class="field-label">Détail</div>
        <input class="input" [ngModel]="store.ui().saDesc" (ngModelChange)="store.patch({ saDesc: $event })" placeholder="Facultatif : ce qu'il faut faire, qui appeler" />
        <div class="hint sm">Le gain est une estimation, pas une mesure. C'est le coût réel du contrat, une fois la piste appliquée, qui dira ce qu'elle a vraiment rapporté.</div>
        <div class="modal-acts">
          @if (store.ui().saId) {
            <button class="btn btn-danger" (click)="store.patch({ saDelId: store.ui().saId })"><f-icon name="trash" [size]="16" color="#fff" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ saForm: false })">Annuler</button>
          <button class="btn btn-primary" [disabled]="store.ui().busy" (click)="store.saveSaving()">Enregistrer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().saDelId) {
      <f-confirm title="Supprimer cette piste ?" (cancel)="store.patch({ saDelId: null })" (confirm)="store.confirmSavingDel()">
        Si elle a été menée à bien, passez-la plutôt en « faite » : son gain reste compté dans ce que vous avez obtenu.
      </f-confirm>
    }

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
        @if (store.ui().asId; as aid) {
          <div class="field-label">Pièces jointes</div>
          <fin-attachments owner="asset" [ownerId]="aid" empty="Aucune pièce : acte, carte grise, diagnostic…" />
        }
        <div class="modal-acts">
          @if (store.ui().asId) {
            <button class="btn btn-danger" (click)="store.patch({ asDelId: store.ui().asId })"><f-icon name="trash" [size]="16" color="#fff" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" (click)="store.patch({ asForm: false })">Annuler</button>
          <button class="btn btn-primary" [disabled]="store.ui().busy" (click)="store.saveAsset()">Enregistrer</button>
        </div>
      </f-modal>
    }

    @if (u.coForm) { <fin-contract-sheet /> }

    @if (store.ui().asDelId) {
      <f-confirm title="Supprimer ce bien ?" (cancel)="store.patch({ asDelId: null })" (confirm)="store.confirmAssetDel()">
        Ses contrats sont conservés, ils passent simplement en « sans bien rattaché ».
      </f-confirm>
    }

    @if (store.ui().coDelId) {
      <f-confirm title="Supprimer ce contrat ?" (cancel)="store.patch({ coDelId: null })" (confirm)="store.confirmContractDel()">
        @if (store.piecesOf(store.ui().coDelId!); as n) { <strong>{{ n }} pièce{{ n > 1 ? 's' : '' }} jointe{{ n > 1 ? 's' : '' }} sera{{ n > 1 ? 'ont' : '' }} supprimée{{ n > 1 ? 's' : '' }} du disque.</strong> } Les opérations rattachées sont conservées, elles perdent seulement leur explication. Si le contrat est simplement terminé, passez-le en « résilié » plutôt que de le supprimer : son historique reste lisible.
      </f-confirm>
    }
  `,
  styles: [`
    .subtabs { display: flex; gap: 22px; border-bottom: 1px solid var(--line); margin-bottom: 18px; overflow-x: auto; }
    .subtabs button { border: none; background: none; font-family: inherit; font-size: 14.5px; font-weight: 800; color: var(--ink3); padding: 6px 0 10px; border-bottom: 3px solid transparent; cursor: pointer; white-space: nowrap; }
    .subtabs button.on { color: var(--ink); border-color: var(--primary); }
    .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); gap: 16px; align-items: start; }
    .panel { background: var(--surface); border-radius: var(--r-card-lg); padding: 20px 22px; margin-bottom: 16px; box-shadow: var(--sh-card); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .panel-title { font-size: 16px; font-weight: 800; color: var(--ink); }
    .panel-sub { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin: 4px 0 8px; line-height: 1.45; }
    .head-acts { display: flex; gap: 6px; }
    .soft-btn { border: none; background: var(--soft2); color: var(--ink2); font-family: inherit; font-size: 12.5px; font-weight: 800; border-radius: 10px; padding: 7px 12px; cursor: pointer; }
    .soft-btn:hover { color: var(--ink); }

    .dead { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); padding: 10px 0; }
    .dead.past { opacity: .55; }
    .dead-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px; border: none; background: none; text-align: left; font-family: inherit; cursor: pointer; padding: 0; }
    .dd { flex: none; width: 48px; display: flex; flex-direction: column; align-items: center; }
    .dd b { font-family: var(--font-display); font-size: 22px; color: var(--ink); line-height: 1; }
    .dd small { font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--ink3); margin-top: 3px; }
    .dd.crit b, .dead-title.crit { color: var(--status-crit); }
    .dead-body { display: flex; flex-direction: column; min-width: 0; }
    .dead-title { font-size: 14px; font-weight: 800; color: var(--ink); }
    .dead-sub { font-size: 12.5px; font-weight: 700; color: var(--ink2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .totals { display: flex; gap: 8px 24px; flex-wrap: wrap; font-size: 13.5px; font-weight: 700; color: var(--ink2); margin: 10px 0; }
    .totals b { color: var(--ink); }
    .totals b.good { color: var(--status-good); }
    .clist { display: flex; flex-direction: column; gap: 6px; }

    .legend { display: flex; gap: 16px; flex-wrap: wrap; margin: 8px 0 12px; }
    .lg { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .sw.band { width: 13px; height: 10px; border-radius: 3px; background: var(--chart-pos); opacity: .35; }
    .sw.mark { width: 3px; height: 13px; border-radius: 1px; background: var(--ink); }
    .sw.mark.off { background: var(--status-crit); }
    .block { border: 1.5px solid var(--line); border-radius: 18px; padding: 12px 16px; margin-bottom: 12px; }
    .asset-head { display: flex; align-items: center; gap: 10px; padding: 4px 0 6px; }
    .asset-chip { width: 32px; height: 32px; border-radius: 10px; background: var(--soft2); display: grid; place-items: center; flex: none; }
    .asset-id { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .asset-id b { font-size: 15.5px; font-weight: 800; color: var(--ink); }
    .asset-id small { font-size: 12.5px; font-weight: 700; color: var(--ink2); }
    .contract { display: grid; grid-template-columns: minmax(0, 1fr) minmax(80px, 180px) 90px; align-items: center; gap: 14px; border-top: 1px solid var(--line); padding: 10px 0; cursor: pointer; color: var(--ink); }
    .contract:hover .c-body b { color: var(--primary); }
    .contract.ended { opacity: .55; }
    .c-body { display: flex; flex-direction: column; min-width: 0; border: none; background: none; padding: 0; text-align: left; font-family: inherit; color: inherit; cursor: pointer; }
    .c-body b { font-size: 14px; font-weight: 800; }
    .c-body small { font-size: 12px; font-weight: 700; color: var(--ink2); }
    .c-cost { text-align: right; font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .c-cost.off { color: var(--status-crit); }
    @media (max-width: 860px) { .cols { grid-template-columns: minmax(0, 1fr); } .contract { grid-template-columns: minmax(0, 1fr) 82px; } .c-range { grid-column: 1 / -1; grid-row: 2; } }
    .addsub { border: none; background: none; font-family: inherit; font-size: 12.5px; font-weight: 800; color: var(--primary); cursor: pointer; padding: 6px 0 0; }
    .dead-task { flex: none; display: inline-flex; align-items: center; gap: 5px; border: none; border-radius: 10px; padding: 6px 11px; background: var(--surface); font-family: inherit; font-size: 12px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .dead-task:hover { color: var(--primary); }
    .hint.sm { margin-top: 8px; flex: none; }
    .tag { background: var(--soft2); border-radius: 20px; padding: 1px 8px; font-size: 10.5px; font-weight: 800; color: var(--ink2); }
    .totals { display: flex; gap: 32px; flex-wrap: wrap; margin-top: 14px; }
    .t-val { font-size: 22px; font-weight: 700; color: var(--ink); margin-top: 3px; }
    .t-unit { font-size: 13px; font-weight: 700; color: var(--ink3); }
    .t-sub { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 2px; }
    .saving { display: flex; align-items: center; gap: 11px; border-radius: 13px; padding: 9px 11px; background: var(--soft); }
    .saving.done, .saving.dropped { opacity: .6; }
    .saving.done .s-title { text-decoration: line-through; }
    .s-check-btn { flex: none; border: none; background: none; padding: 0; cursor: pointer; display: inline-flex; }
    .s-body { flex: 1; min-width: 0; cursor: pointer; display: flex; flex-direction: column; border: none; background: none; padding: 0; text-align: left; font-family: inherit; }
    .s-title { font-size: 13.5px; font-weight: 800; color: var(--ink); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .s-meta { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .s-gain { flex: none; font-size: 14px; font-weight: 800; color: var(--ink); font-variant-numeric: tabular-nums; }
    .s-unit { font-size: 11.5px; font-weight: 700; color: var(--ink3); }
    .none { font-size: 13px; font-weight: 700; color: var(--ink3); padding: 10px 0; line-height: 1.5; }
    .frow { display: flex; gap: 12px; }
    .fgrow { flex: 1; min-width: 0; }
    .fnarrow { width: 120px; flex: none; }
    @media (max-width: 560px) { .frow { flex-direction: column; } .fnarrow { width: 100%; } }
    .field-label { margin-top: 14px; }
    .frow .field-label { margin-top: 0; }
    .frow + .frow .field-label, .frow + .hint + .frow .field-label { margin-top: 14px; }
    .refield .field-label { margin-top: 0; }
    .modal-acts { display: flex; gap: 12px; margin-top: 22px; align-items: center; flex-wrap: wrap; }
    .modal-acts .spacer { flex: 1; }
    .modal-acts .grow { flex: 1; }
  `],
})
export class FinancesContractsTab {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  assetKinds = ASSET_KINDS;
  CAT_ICONS = CAT_ICONS;
  deadlineLabel = deadlineLabel;
  fmt = fmtEuros;
  fmtInt = fmtEurosInt;

  /**
   * Le serveur renvoie plus d'un an d'échéances, pour que le calendrier et le
   * flux ICS ne perdent jamais une reconduction annuelle. Cette liste garde sa
   * fenêtre de six mois : au-delà, il n'y a rien à faire aujourd'hui.
   */
  readonly soonDeadlines = computed(() => this.store.deadlines().filter((d) => d.daysAway <= 185));
  readonly upcoming = computed(() => this.soonDeadlines().filter((d) => d.daysAway >= 0).length);
  private readonly members = computed(() => this.foyer.data()?.members ?? []);

  constructor() { void this.store.loadContracts(); }

  iconOf(kind: FinAsset['kind']): string { return ASSET_KINDS.find((k) => k.id === kind)?.icon || 'facture'; }
  kindLabel(kind: FinAsset['kind']): string { return ASSET_KINDS.find((k) => k.id === kind)?.label || ''; }

  /** « dans 12 jours », « aujourd'hui », « il y a 3 jours ». */
  relative(days: number): string {
    if (days === 0) return "aujourd'hui";
    if (days > 0) return days === 1 ? 'demain' : `dans ${days} jours`;
    return days === -1 ? 'hier' : `il y a ${-days} jours`;
  }
  dayNum(iso: string): string { return String(Number(iso.slice(8, 10))); }
  monthShort(iso: string): string {
    const [y, m] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' });
  }

  /** Type · périodicité · personnes · reconduction ou préavis · pièces · résilié. */
  contractMeta(c: FinContract): string {
    const bits: string[] = [CONTRACT_KINDS.find((k) => k.id === c.kind)?.label || '', c.periodicity];
    if (c.accountId) bits.push(this.store.accountName(c.accountId));
    const names = c.memberIds.map((id) => this.members().find((m) => m.id === id)?.name).filter(Boolean).join(', ');
    if (names) bits.push(names);
    const notice = this.store.deadlines().find((d) => d.contractId === c.id && d.kind === 'preavis' && d.daysAway >= 0);
    if (notice) bits.push(`préavis le ${this.foyer.fmtNumDate(notice.date)}`);
    else if (c.renewalOn) bits.push(`reconduit le ${this.foyer.fmtNumDate(c.renewalOn)}`);
    if (c.endsOn) bits.push(`fin le ${this.foyer.fmtNumDate(c.endsOn)}`);
    const n = this.store.piecesOf(c.id);
    if (n) bits.push(`${n} pièce${n > 1 ? 's' : ''}`);
    if (c.status === 'resilie') bits.push('résilié');
    return bits.filter(Boolean).join(' · ');
  }

  /** Le dernier prélèvement quand il y en a un, sinon le montant annoncé. */
  costLabel(c: FinContract): string {
    const cost = this.store.costOf(c.id);
    if (cost?.lastAmount != null) return `${fmtEuros(cost.lastAmount)} €`;
    if (c.amountMin !== null && c.amountMax !== null && c.amountMin !== c.amountMax) return `${fmtEurosInt(c.amountMin)} à ${fmtEurosInt(c.amountMax)} €`;
    const one = c.amountMin ?? c.amountMax;
    return one !== null ? `${fmtEuros(one)} €${c.periodicity !== 'ponctuelle' ? ' / ' + periodWord(c.periodicity) : ''}` : '';
  }

  /** Contrat concerné, échéance visée, détail : ce qui aide à décider. */
  savingMeta(s: FinSaving): string {
    const bits: string[] = [];
    if (s.contractId) bits.push(this.store.contractName(s.contractId));
    if (s.targetDate) bits.push(`avant le ${this.foyer.fmtNumDate(s.targetDate)}`);
    if (s.description) bits.push(s.description);
    return bits.join(' · ');
  }
}
