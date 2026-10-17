import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FinAction, FinActionKind, FinCondition, FinConditionField, FinConditionOp, FinPreviewRow, FinRule } from '../../core/finances.api';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { SheetComponent } from '../../shared/sheet';
import { ConfirmComponent } from '../../shared/confirm';
import { ToggleComponent } from '../../shared/toggle';
import { CheckComponent } from '../../shared/check';
import { AlertComponent } from '../../shared/alert';

const FIELDS: { id: FinConditionField; label: string }[] = [
  { id: 'label', label: 'Libellé' },
  { id: 'amount', label: 'Montant' },
  { id: 'sens', label: 'Sens' },
  { id: 'account', label: 'Compte' },
  { id: 'dayOfMonth', label: 'Jour du mois' },
  { id: 'date', label: 'Date' },
];

const OPS: Record<FinConditionOp, string> = {
  contains: 'contient', notContains: 'ne contient pas', equals: 'est égal à', startsWith: 'commence par',
  regex: 'correspond à (expression régulière)', gt: 'supérieur à', lt: 'inférieur à', between: 'entre',
  is: 'est', isNot: 'n’est pas', before: 'avant le', after: 'après le',
};

const ACTIONS: { id: FinActionKind; label: string; short: string }[] = [
  { id: 'category', label: 'Ranger dans une catégorie', short: 'Catégorie' },
  { id: 'contract', label: 'Rattacher à un contrat', short: 'Contrat' },
  { id: 'label', label: 'Réécrire le libellé', short: 'Libellé' },
  { id: 'tag', label: 'Ajouter une étiquette', short: 'Étiquette' },
  { id: 'transfer', label: 'Marquer comme virement interne', short: 'Virement interne' },
];

@Component({
  selector: 'fin-rules-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, FormsModule, IconComponent, SheetComponent, ConfirmComponent, ToggleComponent, CheckComponent, AlertComponent],
  template: `
    @let u = store.ui();
    <div class="intro">
      <div class="intro-txt">Évaluées dans l'ordre ; la dernière qui décide gagne ; une catégorie choisie à la main n'est pas touchée.</div>
      <div class="intro-acts">
        <button class="btn btn-soft" [disabled]="u.ruleBusy || !store.rules().length" [attr.aria-expanded]="u.applyOpen" (click)="store.patch({ applyOpen: !u.applyOpen })">Réappliquer… ▾</button>
        <button class="btn btn-primary" (click)="store.newRule()"><f-icon name="plus" [size]="16" color="#fff" [width]="2.6" /> Règle</button>
      </div>
    </div>

    @if (u.applyOpen) {
      <section class="apply">
        <div class="seg small" role="radiogroup" aria-label="Sur quelles opérations">
          <button role="radio" [attr.aria-checked]="u.applyScope === 'all'" [class.active]="u.applyScope === 'all'" (click)="store.patch({ applyScope: 'all' })">Tout l'historique</button>
          <button role="radio" [attr.aria-checked]="u.applyScope === 'period'" [class.active]="u.applyScope === 'period'" (click)="store.patch({ applyScope: 'period' })">Une période</button>
          <button role="radio" [attr.aria-checked]="u.applyScope === 'account'" [class.active]="u.applyScope === 'account'" (click)="store.patch({ applyScope: 'account' })">Un compte</button>
        </div>
        @if (u.applyScope === 'period') {
          <div class="apply-row">
            <label>Du <input class="input" type="date" [ngModel]="u.applyFrom" (ngModelChange)="store.patch({ applyFrom: $event })" /></label>
            <label>au <input class="input" type="date" [ngModel]="u.applyTo" (ngModelChange)="store.patch({ applyTo: $event })" /></label>
          </div>
        }
        @if (u.applyScope === 'account') {
          <select class="input" [ngModel]="u.applyAccount" (ngModelChange)="store.patch({ applyAccount: $event })" aria-label="Compte">
            <option [ngValue]="null">Choisir un compte…</option>
            @for (a of store.ledgerAccounts(); track a.id) { <option [ngValue]="a.id">{{ a.name }}{{ a.archived ? ' (archivé)' : '' }}</option> }
          </select>
        }
        <label class="check" (click)="store.patch({ applyForce: !u.applyForce })">
          <f-check [checked]="u.applyForce" />
          <span>Écraser aussi les catégories choisies à la main (à n'utiliser qu'après un grand ménage)</span>
        </label>
        <div class="apply-acts">
          <button class="btn btn-soft" (click)="store.patch({ applyOpen: false })">Annuler</button>
          <button class="btn btn-primary" [disabled]="u.ruleBusy" (click)="store.applyAll()">Réappliquer</button>
        </div>
      </section>
    }

    @if (u.ruleError && !u.ruleForm) {
      <f-alert kind="error" class="mb"><span>{{ u.ruleError }}</span></f-alert>
    }

    @if (store.applyReport(); as r) {
      <div class="report">
        <div class="report-head">
          <div class="report-title">{{ r.examined }} opération{{ r.examined > 1 ? 's' : '' }} passée{{ r.examined > 1 ? 's' : '' }} en revue, {{ r.changed }} modifiée{{ r.changed > 1 ? 's' : '' }}</div>
          <button class="icon-btn" aria-label="Fermer le rapport" (click)="store.applyReport.set(null)"><f-icon name="x" [size]="14" color="var(--ink3)" [width]="2.6" /></button>
        </div>
        @if (r.manualKept) {
          <div class="report-note">{{ r.manualKept }} opération{{ r.manualKept > 1 ? 's' : '' }} conservée{{ r.manualKept > 1 ? 's' : '' }} telle{{ r.manualKept > 1 ? 's' : '' }} quelle{{ r.manualKept > 1 ? 's' : '' }} : catégorie choisie à la main.</div>
        }
        @for (p of r.perRule; track p.ruleId) {
          <div class="report-line"><span class="report-name">{{ p.name }}</span><span class="report-n">{{ p.changed }}</span></div>
        }
      </div>
    }

    <div class="main" [class.with-form]="u.ruleForm && !foyer.narrow()">
      <div class="list">
        @for (r of store.rules(); track r.id; let i = $index) {
          <div class="rule" [class.off]="!r.enabled" [class.picked]="u.ruleForm && u.ruleId === r.id">
            <div class="rule-ord">
              <button class="ord" [disabled]="i === 0" [attr.aria-label]="'Monter la règle ' + (i + 1)" (click)="store.moveRule(r.id, -1)"><f-icon name="arrowUp" [size]="13" color="var(--ink2)" [width]="2.6" /></button>
              <span class="ord-n">{{ i + 1 }}</span>
              <button class="ord" [disabled]="i + 1 >= store.rules().length" [attr.aria-label]="'Descendre la règle ' + (i + 1)" (click)="store.moveRule(r.id, 1)"><f-icon name="arrowDown" [size]="13" color="var(--ink2)" [width]="2.6" /></button>
            </div>
            <button type="button" class="sentence" (click)="store.editRule(r.id)" [attr.aria-label]="'Modifier la règle ' + (i + 1) + ' : ' + plain(r)">
              @for (t of sentence(r); track $index) {
                @switch (t.k) {
                  @case ('txt') { <span class="w">{{ t.t }}</span> }
                  @case ('key') { <span class="tk key">{{ t.t }}</span> }
                  @default { <span class="tk">{{ t.t }}</span> }
                }
              }
              @if (r.stop) { <span class="tk mute">arrêt</span> }
              @if (!r.enabled) { <span class="tk mute">désactivée</span> }
            </button>
            <f-toggle [on]="r.enabled" [label]="(r.enabled ? 'Désactiver' : 'Activer') + ' la règle ' + (i + 1)" (toggled)="store.toggleRule(r.id)" />
          </div>
        } @empty {
          <div class="empty">
            <div class="empty-title">Aucune règle pour l'instant</div>
            <div class="empty-txt">Une règle range automatiquement les opérations qui se répètent. Le cas typique : deux contrats du même assureur au libellé bancaire identique, séparés par leur seul montant.</div>
          </div>
        }

        @if (store.tags().length) {
          <div class="tags-block">
            <div class="tags-title">Étiquettes posées par les règles</div>
            <div class="tags">
              @for (t of store.tags(); track t.id) {
                <button class="tagchip" (click)="store.filterByTag(t.name)" [attr.aria-label]="'Voir les ' + t.count + ' opérations étiquetées ' + t.name">{{ t.name }} · {{ t.count }}</button>
              }
            </div>
          </div>
        }
      </div>

      @if (u.ruleForm && !foyer.narrow()) {
        <aside class="side" aria-label="Éditeur de règle">
          <div class="kicker">{{ editorTitle() }}</div>
          <ng-container [ngTemplateOutlet]="editor" />
        </aside>
      }
    </div>

    @if (u.ruleForm && foyer.narrow()) {
      <f-sheet [heading]="editorTitle()" [full]="true" (close)="store.patch({ ruleForm: false })" (back)="store.patch({ ruleForm: false })">
        <ng-container [ngTemplateOutlet]="editor" />
      </f-sheet>
    }

    <!-- ÉDITEUR DE RÈGLE, en phrases -->
    <ng-template #editor>
        <div class="field-label">Nom de la règle</div>
        <input class="input" [ngModel]="store.ui().ruleName" (ngModelChange)="store.patch({ ruleName: $event })" placeholder="Ex : Assurance véhicule (AXA)" />

        <div class="sec">
          <div class="sec-head">
            <span class="say">Si</span>
            <div class="seg small" role="radiogroup" aria-label="Combinaison des conditions">
              <button role="radio" [attr.aria-checked]="store.ui().ruleMatch === 'all'" [class.active]="store.ui().ruleMatch === 'all'" (click)="store.patch({ ruleMatch: 'all' })">toutes</button>
              <button role="radio" [attr.aria-checked]="store.ui().ruleMatch === 'any'" [class.active]="store.ui().ruleMatch === 'any'" (click)="store.patch({ ruleMatch: 'any' })">au moins une</button>
            </div>
            <span class="say">les conditions :</span>
          </div>

          @for (c of store.ui().ruleConditions; track $index; let i = $index) {
            <div class="cond">
              <select class="input mini" [ngModel]="c.field" (ngModelChange)="store.setConditionField(i, $event)">
                @for (f of fields; track f.id) { <option [ngValue]="f.id">{{ f.label }}</option> }
              </select>
              <select class="input mini" [ngModel]="c.op" (ngModelChange)="store.patchCondition(i, { op: $event })">
                @for (o of store.opsFor(c.field); track o) { <option [ngValue]="o">{{ OPS[o] }}</option> }
              </select>
              <div class="vals">
              @switch (c.field) {
                @case ('account') {
                  <select class="input grow" [ngModel]="c.value" (ngModelChange)="store.patchCondition(i, { value: $event })">
                    <option value="">Choisir…</option>
                    @for (a of store.ledgerAccounts(); track a.id) { <option [ngValue]="strId(a.id)">{{ a.name }}</option> }
                  </select>
                }
                @case ('sens') {
                  <select class="input grow" [ngModel]="c.value" (ngModelChange)="store.patchCondition(i, { value: $event })">
                    <option value="">Choisir…</option>
                    <option value="depense">une dépense</option>
                    <option value="recette">une recette</option>
                  </select>
                }
                @case ('date') {
                  <input class="input grow" type="date" [ngModel]="c.value" (ngModelChange)="store.patchCondition(i, { value: $event })" />
                  @if (c.op === 'between') {
                    <input class="input grow" type="date" [ngModel]="c.value2" (ngModelChange)="store.patchCondition(i, { value2: $event })" />
                  }
                }
                @default {
                  <input class="input grow" [ngModel]="c.value" (ngModelChange)="store.patchCondition(i, { value: $event })"
                         [placeholder]="c.field === 'amount' ? '600' : c.field === 'dayOfMonth' ? '5' : 'Prlv Sepa Axa'" />
                  @if (c.op === 'between') {
                    <input class="input grow" [ngModel]="c.value2" (ngModelChange)="store.patchCondition(i, { value2: $event })"
                           [placeholder]="c.field === 'amount' ? '700' : '10'" />
                  }
                }
              }
              </div>
              <button class="icon-btn" aria-label="Retirer la condition" [disabled]="store.ui().ruleConditions.length < 2" (click)="store.removeCondition(i)">
                <f-icon name="x" [size]="14" color="var(--ink3)" [width]="2.6" />
              </button>
            </div>
          }
          <button class="add" (click)="store.addCondition()"><f-icon name="plus" [size]="14" color="var(--ink2)" [width]="2.6" /> Condition : libellé, montant, sens, compte, jour du mois, date</button>
          @if (amountHint()) { <div class="hint">Les montants se comparent en valeur absolue : « entre 600 et 700 » attrape un prélèvement de -635,46 €. Utilisez le critère « Sens » pour distinguer dépense et recette.</div> }
        </div>

        <div class="sec">
          <div class="say">Alors :</div>
          @for (a of store.ui().ruleActions; track $index; let i = $index) {
            <div class="cond">
              <div class="act-name">{{ actionLabel(a.kind) }}</div>
              <div class="vals">
              @switch (a.kind) {
                @case ('category') {
                  <select class="input grow" [ngModel]="a.value" (ngModelChange)="store.patchAction(i, $event)">
                    <option value="">Sans catégorie</option>
                    @for (c of store.rootCategories(); track c.id) {
                      <option [ngValue]="strId(c.id)">{{ c.name }}</option>
                      @for (s of store.childrenOf(c.id); track s.id) { <option [ngValue]="strId(s.id)">&nbsp;&nbsp;{{ c.name }} · {{ s.name }}</option> }
                    }
                  </select>
                }
                @case ('contract') {
                  <select class="input grow" [ngModel]="a.value" (ngModelChange)="store.patchAction(i, $event)">
                    <option value="">Aucun contrat</option>
                    @for (c of store.activeContracts(); track c.id) { <option [ngValue]="strId(c.id)">{{ c.name }}{{ c.provider ? ' · ' + c.provider : '' }}</option> }
                  </select>
                }
                @case ('transfer') { <div class="grow hint inline">L’opération sort des dépenses et des ressources du mois.</div> }
                @default {
                  <input class="input grow" [ngModel]="a.value" (ngModelChange)="store.patchAction(i, $event)"
                         [placeholder]="a.kind === 'tag' ? 'vacances' : 'Assurance voiture'" />
                }
              }
              </div>
              <button class="icon-btn" aria-label="Retirer l’action" [disabled]="store.ui().ruleActions.length < 2" (click)="store.removeAction(i)">
                <f-icon name="x" [size]="14" color="var(--ink3)" [width]="2.6" />
              </button>
            </div>
          }
          <div class="add-row">
            @for (a of actions; track a.id) {
              <button class="add" (click)="store.addAction(a.id)"><f-icon name="plus" [size]="14" color="var(--ink2)" [width]="2.6" /> {{ a.label }}</button>
            }
          </div>
        </div>

        <label class="check" (click)="store.patch({ ruleStop: !store.ui().ruleStop })">
          <f-check [checked]="store.ui().ruleStop" />
          <span>Arrêter là : les règles suivantes ne s'appliquent pas aux opérations retenues</span>
        </label>
        <label class="check" (click)="store.patch({ ruleEnabled: !store.ui().ruleEnabled })">
          <f-check [checked]="store.ui().ruleEnabled" />
          <span>Active</span>
        </label>

        @if (store.ui().ruleError; as err) { <f-alert kind="error" class="inmodal"><span>{{ err }}</span></f-alert> }

        @if (store.rulePreview(); as p) {
          <div class="preview">
            <div class="preview-head">
              {{ p.matched }} opération{{ p.matched > 1 ? 's' : '' }} retenue{{ p.matched > 1 ? 's' : '' }},
              {{ p.wouldChange }} serai{{ p.wouldChange > 1 ? 'ent' : 't' }} modifiée{{ p.wouldChange > 1 ? 's' : '' }}
              @if (p.manualKept) { <span class="kept">· {{ p.manualKept }} corrigée{{ p.manualKept > 1 ? 's' : '' }} à la main, laissée{{ p.manualKept > 1 ? 's' : '' }} intacte{{ p.manualKept > 1 ? 's' : '' }}</span> }
            </div>
            @for (row of p.rows; track row.id) {
              <div class="prow">
                <span class="pdate">{{ foyer.fmtNumDate(row.date) }}</span>
                <span class="plabel">{{ row.label }}</span>
                <span class="pamt">{{ row.amount > 0 ? '+' : '−' }}{{ fmt(abs(row.amount)) }} €</span>
                <span class="pnew">{{ changeText(row) }}</span>
              </div>
            } @empty {
              <div class="prow empty-row">Aucune opération existante ne correspond. La règle s’appliquera aux prochains imports.</div>
            }
          </div>
        }

        <div class="modal-acts">
          <button class="btn btn-soft" (click)="store.patch({ ruleForm: false })">Fermer</button>
          @if (store.ui().ruleId) {
            <button class="btn btn-danger" (click)="store.patch({ ruleDelId: store.ui().ruleId })"><f-icon name="trash" [size]="16" color="#fff" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" [disabled]="store.ui().ruleBusy" (click)="store.previewRule()">Tester</button>
          <button class="btn btn-primary" [disabled]="store.ui().ruleBusy" (click)="store.saveRule()">Enregistrer et appliquer</button>
        </div>
    </ng-template>

    @if (store.ui().ruleDelId) {
      <f-confirm title="Supprimer cette règle ?" (cancel)="store.patch({ ruleDelId: null })" (confirm)="store.confirmRuleDel()">
        « {{ delName() }} » ne s’appliquera plus. Les opérations qu’elle avait rangées gardent leur catégorie, elles passent simplement en classement manuel.
      </f-confirm>
    }
  `,
  styles: [`
    .intro { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; background: var(--surface); border-radius: 16px; padding: 16px 18px; margin-bottom: 12px; box-shadow: var(--sh-card); }
    .intro-txt { flex: 1; min-width: 260px; font-size: 13px; font-weight: 700; color: var(--ink2); line-height: 1.55; }
    .intro-acts { display: flex; gap: 10px; flex-wrap: wrap; }
    .check.force { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; font-size: 12.5px; font-weight: 700; color: var(--ink3); cursor: pointer; }

    f-alert.mb { display: block; margin-bottom: 16px; }
    f-alert.inmodal { display: block; margin-top: 16px; }

    .report { background: var(--soft); border-radius: 16px; padding: 14px 16px; margin-bottom: 16px; }
    .report-head { display: flex; align-items: center; gap: 10px; }
    .report-title { flex: 1; font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .report-note { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 4px; }
    .report-line { display: flex; gap: 10px; font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 6px; }
    .report-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .report-n { font-variant-numeric: tabular-nums; font-weight: 800; }

    .rule.off { opacity: .55; }

    .empty { background: var(--surface); border-radius: 16px; padding: 34px 24px; text-align: center; box-shadow: var(--sh-card); }
    .empty-title { font-size: 15px; font-weight: 800; color: var(--ink); }
    .empty-txt { font-size: 13px; font-weight: 700; color: var(--ink3); margin: 6px auto 0; max-width: 460px; line-height: 1.55; }


    .sec { margin-top: 22px; }
    .seg.small button { font-size: 12px; padding: 6px 12px; }
    .input.mini { height: 38px; width: 132px; flex: none; padding: 0 10px; font-size: 12.5px; }
    .input.grow { height: 38px; flex: 1; min-width: 0; padding: 0 10px; font-size: 12.5px; }
    .act-name { width: 132px; flex: none; font-size: 12.5px; font-weight: 800; color: var(--ink2); }
    .icon-btn { width: 30px; height: 30px; flex: none; border: none; border-radius: 9px; background: var(--soft2); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .icon-btn:disabled { opacity: .3; cursor: default; }
    .add { display: inline-flex; align-items: center; gap: 6px; border: none; border-radius: 11px; padding: 8px 13px; background: var(--soft); font-size: 12.5px; font-weight: 800; color: var(--ink2); cursor: pointer; font-family: inherit; }
    .add-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
    .hint { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 8px; line-height: 1.5; }
    .hint.inline { margin-top: 0; align-self: center; }

    .preview { margin-top: 18px; background: var(--soft); border-radius: 14px; padding: 12px 14px; max-height: 260px; overflow: auto; }
    .preview-head { font-size: 13px; font-weight: 800; color: var(--ink); margin-bottom: 8px; }
    .kept { font-weight: 700; color: var(--ink3); }
    .prow { display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 700; color: var(--ink2); padding: 5px 0; border-top: 1px solid var(--line); }
    .prow.empty-row { color: var(--ink3); display: block; }
    .pdate { flex: none; font-variant-numeric: tabular-nums; color: var(--ink3); }
    .plabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pamt { flex: none; font-variant-numeric: tabular-nums; }
    .pnew { flex: none; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink3); }

    .field-label { margin-top: 0; }
    .check { display: flex; align-items: flex-start; gap: 10px; margin-top: 14px; font-size: 13px; font-weight: 700; color: var(--ink2); cursor: pointer; }
    .modal-acts { display: flex; gap: 12px; margin-top: 22px; align-items: center; flex-wrap: wrap; }
    .modal-acts .spacer { flex: 1; }
    .modal-acts .grow { flex: 1; }
    .cond { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .vals { flex: 1; min-width: 0; display: flex; gap: 8px; }
    @media (max-width: 560px) {
      .cond { flex-wrap: wrap; }
      .input.mini, .act-name { width: 100%; }
      .vals { flex-basis: 100%; }
    }
    .apply { background: var(--surface); border-radius: 16px; padding: 14px 16px; margin-bottom: 12px; box-shadow: var(--sh-card); display: flex; flex-direction: column; gap: 10px; }
    .apply-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .apply-row label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--ink2); }
    .apply-acts { display: flex; gap: 8px; justify-content: flex-end; }
    .main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    .main.with-form { grid-template-columns: minmax(0, 1.2fr) minmax(360px, 1fr); }
    .list { min-width: 0; }
    .rule { display: flex; align-items: flex-start; gap: 12px; background: var(--surface); border: 1.5px solid var(--line); border-radius: 16px; padding: 12px 14px; margin-bottom: 10px; }
    .rule.picked { border-color: var(--primary); }
    .rule.off .sentence { opacity: .55; }
    .rule-ord { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: none; }
    .ord { border: none; background: none; padding: 2px; cursor: pointer; display: grid; place-items: center; }
    .ord:disabled { opacity: .25; cursor: default; }
    .ord-n { min-width: 26px; height: 26px; border-radius: 8px; background: var(--soft2); display: grid; place-items: center; font-size: 12.5px; font-weight: 800; color: var(--ink2); }
    .sentence { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; border: none; background: none; text-align: left; font-family: inherit; cursor: pointer; padding: 2px 0; }
    .w { font-size: 14px; font-weight: 700; color: var(--ink2); }
    .tk { border-radius: 9px; padding: 4px 9px; background: var(--soft2); font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .tk.key { background: var(--tint-primary); color: var(--status-crit); }
    .tk.mute { background: none; color: var(--ink3); font-size: 12.5px; }
    .tags-block { background: var(--surface); border-radius: var(--r-card-lg); padding: 16px 18px; box-shadow: var(--sh-card); margin-top: 6px; }
    .tags-title { font-size: 15px; font-weight: 800; color: var(--ink); margin-bottom: 10px; }
    .tags { display: flex; flex-wrap: wrap; gap: 8px; }
    .tagchip { border: none; border-radius: 11px; padding: 7px 12px; background: var(--soft2); font-family: inherit; font-size: 13px; font-weight: 800; color: var(--ink2); cursor: pointer; }
    .side { background: var(--surface); border-radius: var(--r-card-lg); padding: 18px 20px; box-shadow: var(--sh-card); position: sticky; top: 12px; max-height: calc(100vh - 120px); overflow-y: auto; }
    .kicker { font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--ink3); margin-bottom: 8px; }
    .say { font-size: 15px; font-weight: 800; color: var(--ink); }
    .sec-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  `],
})
export class FinancesRulesTab {
  store = inject(FinancesStore);
  foyer = inject(FoyerStore);
  fields = FIELDS;
  actions = ACTIONS;
  OPS = OPS;
  fmt = fmtEuros;
  abs = Math.abs;

  constructor() { void this.store.loadRules(); }

  /** ngValue keeps the type: the engine stores every condition value as text. */
  strId(id: number): string { return String(id); }

  actionLabel(kind: FinActionKind): string { return ACTIONS.find((a) => a.id === kind)?.short || kind; }

  amountHint = computed(() => this.store.ui().ruleConditions.some((c) => c.field === 'amount'));

  delName = computed(() => this.store.rules().find((r) => r.id === this.store.ui().ruleDelId)?.name || '');

  private conditionText(c: FinCondition): string {
    const field = FIELDS.find((f) => f.id === c.field)?.label || c.field;
    const value = c.field === 'account' ? this.store.accountName(parseInt(c.value, 10))
      : c.field === 'sens' ? (c.value === 'depense' ? 'une dépense' : 'une recette')
      : c.field === 'date' ? this.foyer.fmtNumDate(c.value)
      : c.value;
    const second = c.op === 'between'
      ? ` et ${c.field === 'date' ? this.foyer.fmtNumDate(c.value2) : c.value2}`
      : '';
    return `${field} ${OPS[c.op]} ${value}${second}`;
  }

  describeConditions(r: FinRule): string {
    return r.conditions.map((c) => this.conditionText(c)).join(r.matchMode === 'all' ? ' et ' : ' ou ');
  }

  private actionText(a: FinAction): string {
    switch (a.kind) {
      case 'category': return `ranger dans « ${this.store.categoryPath(parseInt(a.value, 10) || null)} »`;
      case 'contract': return `rattacher au contrat « ${this.store.contractName(parseInt(a.value, 10) || null)} »`;
      case 'label': return `réécrire le libellé en « ${a.value} »`;
      case 'tag': return `étiqueter « ${a.value} »`;
      default: return 'marquer comme virement interne';
    }
  }

  describeActions(r: FinRule): string { return r.actions.map((a) => this.actionText(a)).join(', '); }

  /** La règle en une phrase, pour un lecteur d'écran. */
  plain(r: FinRule): string { return `si ${this.describeConditions(r)}, alors ${this.describeActions(r)}`; }

  readonly editorTitle = computed(() => {
    const id = this.store.ui().ruleId;
    const i = id ? this.store.rules().findIndex((r) => r.id === id) : -1;
    return i >= 0 ? `Modifier la règle ${i + 1}` : 'Nouvelle règle';
  });

  /**
   * La règle en phrase découpée : des mots, des clés (le critère, l'action) et
   * des valeurs, pour la lire d'un coup d'œil. « Si le libellé contient
   * CARREFOUR → catégorie Alimentation ».
   */
  sentence(r: FinRule): { t: string; k: 'txt' | 'key' | 'val' }[] {
    const out: { t: string; k: 'txt' | 'key' | 'val' }[] = [];
    r.conditions.forEach((c, i) => {
      out.push({ t: i === 0 ? 'Si le' : r.matchMode === 'all' ? 'et le' : 'ou le', k: 'txt' });
      out.push({ t: (FIELDS.find((f) => f.id === c.field)?.label || c.field).toLowerCase(), k: 'key' });
      out.push({ t: OPS[c.op], k: 'val' });
      const v = c.field === 'account' ? this.store.accountName(parseInt(c.value, 10))
        : c.field === 'sens' ? (c.value === 'depense' ? 'dépense' : 'recette')
        : c.field === 'date' ? this.foyer.fmtNumDate(c.value)
        : c.field === 'amount' ? `${c.value}${c.op === 'between' ? '' : ' €'}` : c.value;
      const v2 = c.op === 'between' ? ` et ${c.field === 'date' ? this.foyer.fmtNumDate(c.value2) : c.value2}${c.field === 'amount' ? ' €' : ''}` : '';
      out.push({ t: v + v2, k: 'val' });
    });
    r.actions.forEach((a, i) => {
      out.push({ t: i === 0 ? '→' : '+', k: 'txt' });
      switch (a.kind) {
        case 'category': out.push({ t: 'catégorie', k: 'key' }, { t: this.store.categoryPath(parseInt(a.value, 10) || null), k: 'val' }); break;
        case 'contract': out.push({ t: 'contrat', k: 'key' }, { t: this.store.contractName(parseInt(a.value, 10) || null), k: 'val' }); break;
        case 'label': out.push({ t: 'libellé', k: 'key' }, { t: a.value, k: 'val' }); break;
        case 'tag': out.push({ t: 'étiquette', k: 'key' }, { t: a.value, k: 'val' }); break;
        default: out.push({ t: 'virement interne', k: 'key' });
      }
    });
    return out;
  }

  /** What the previewed rule would do to one row, in the row's own terms. */
  changeText(row: FinPreviewRow): string {
    if (!row.changes) return row.manual ? `${this.store.categoryPath(row.categoryId)} (gardée)` : 'déjà à jour';
    const bits: string[] = [];
    if (row.manual) bits.push(`${this.store.categoryPath(row.categoryId)} (gardée)`);
    else if (row.newCategoryId !== null || this.hasCategoryAction()) bits.push(`${this.store.categoryPath(row.categoryId)} → ${this.store.categoryPath(row.newCategoryId)}`);
    if (row.newContractId) bits.push(`contrat → ${this.store.contractName(row.newContractId)}`);
    if (row.newLabel) bits.push(`libellé → « ${row.newLabel} »`);
    if (row.newTags.length) bits.push(`étiquette ${row.newTags.join(', ')}`);
    if (row.newTransfer) bits.push('virement interne');
    return bits.join(' · ') || 'aucun changement';
  }

  private hasCategoryAction(): boolean { return this.store.ui().ruleActions.some((a) => a.kind === 'category'); }
}
