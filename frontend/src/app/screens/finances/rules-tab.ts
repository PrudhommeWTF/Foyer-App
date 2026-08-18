import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FinAction, FinActionKind, FinCondition, FinConditionField, FinConditionOp, FinPreviewRow, FinRule } from '../../core/finances.api';
import { FinancesStore, fmtEuros } from '../../core/finances.store';
import { FoyerStore } from '../../core/foyer.store';
import { IconComponent } from '../../core/icon';
import { ModalComponent } from '../../shared/modal';

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
  { id: 'label', label: 'Réécrire le libellé', short: 'Libellé' },
  { id: 'tag', label: 'Ajouter une étiquette', short: 'Étiquette' },
  { id: 'transfer', label: 'Marquer comme virement interne', short: 'Virement interne' },
];

@Component({
  selector: 'fin-rules-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, ModalComponent],
  template: `
    <div class="intro">
      <div class="intro-txt">
        Les règles sont évaluées <strong>dans l’ordre</strong>, de haut en bas, sur chaque opération importée ou saisie.
        La dernière qui décide d’un champ l’emporte. Une catégorie corrigée à la main n’est jamais écrasée par un rejeu.
      </div>
      <div class="intro-acts">
        <button class="btn btn-soft" [disabled]="store.ui().ruleBusy || !store.rules().length" (click)="store.applyAll()">
          <f-icon name="refresh" [size]="16" color="var(--ink2)" [width]="2.2" /> Réappliquer sur l’historique
        </button>
        <button class="btn btn-primary" (click)="store.newRule()"><f-icon name="plus" [size]="16" color="#fff" [width]="2.6" /> Nouvelle règle</button>
      </div>
    </div>

    <label class="check force">
      <input type="checkbox" [ngModel]="store.ui().applyForce" (ngModelChange)="store.patch({ applyForce: $event })" />
      <span>Écraser aussi les catégories corrigées à la main (à n’utiliser qu’après un grand ménage)</span>
    </label>

    @if (store.ui().ruleError; as err) {
      <div class="banner err"><f-icon name="urgent" [size]="18" color="var(--primary)" [width]="2.2" /><span>{{ err }}</span></div>
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

    <div class="rules">
      @for (r of store.rules(); track r.id; let i = $index) {
        <div class="rule" [class.off]="!r.enabled">
          <div class="rule-ord">
            <button class="ord" [disabled]="i === 0" aria-label="Monter la règle" (click)="store.moveRule(r.id, -1)"><f-icon name="chevronLeft" [size]="13" color="var(--ink2)" [width]="2.6" /></button>
            <span class="ord-n">{{ i + 1 }}</span>
            <button class="ord" [disabled]="i + 1 >= store.rules().length" aria-label="Descendre la règle" (click)="store.moveRule(r.id, 1)"><f-icon name="chevronRight" [size]="13" color="var(--ink2)" [width]="2.6" /></button>
          </div>
          <div class="rule-body" (click)="store.editRule(r.id)">
            <div class="rule-name">
              {{ r.name }}
              @if (r.stop) { <span class="tag">arrêt</span> }
              @if (!r.enabled) { <span class="tag">désactivée</span> }
            </div>
            <div class="rule-when">Si {{ r.matchMode === 'all' ? 'toutes' : 'au moins une' }} : {{ describeConditions(r) }}</div>
            <div class="rule-then">Alors {{ describeActions(r) }}</div>
          </div>
          <button class="toggle" [class.on]="r.enabled" [attr.aria-label]="r.enabled ? 'Désactiver la règle' : 'Activer la règle'" (click)="store.toggleRule(r.id)"><span class="knob"></span></button>
        </div>
      } @empty {
        <div class="empty">
          <div class="empty-title">Aucune règle pour l’instant</div>
          <div class="empty-txt">
            Une règle range automatiquement les opérations qui se répètent. Le cas typique : deux contrats du même
            assureur au libellé bancaire identique, séparés par leur seul montant.
          </div>
        </div>
      }
    </div>

    @if (store.tags().length) {
      <div class="tags-block">
        <div class="overline">Étiquettes posées par les règles</div>
        <div class="tags">
          @for (t of store.tags(); track t.id) {
            <button class="tagchip" (click)="store.filterByTag(t.name)">{{ t.name }} <span class="tagn">{{ t.count }}</span></button>
          }
        </div>
      </div>
    }

    <!-- ÉDITEUR DE RÈGLE -->
    @if (store.ui().ruleForm) {
      <f-modal [title]="store.ui().ruleId ? 'Modifier la règle' : 'Nouvelle règle'" [maxWidth]="640" (close)="store.patch({ ruleForm: false })">
        <div class="field-label">Nom de la règle</div>
        <input class="input" [ngModel]="store.ui().ruleName" (ngModelChange)="store.patch({ ruleName: $event })" placeholder="Ex : Assurance véhicule (AXA)" />

        <div class="sec">
          <div class="sec-head">
            <div class="overline">Conditions</div>
            <div class="seg small">
              <button [class.active]="store.ui().ruleMatch === 'all'" (click)="store.patch({ ruleMatch: 'all' })">Toutes</button>
              <button [class.active]="store.ui().ruleMatch === 'any'" (click)="store.patch({ ruleMatch: 'any' })">Au moins une</button>
            </div>
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
                    @for (a of store.accounts(); track a.id) { <option [ngValue]="strId(a.id)">{{ a.name }}</option> }
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
          <button class="add" (click)="store.addCondition()"><f-icon name="plus" [size]="14" color="var(--ink2)" [width]="2.6" /> Ajouter une condition</button>
          @if (amountHint()) { <div class="hint">Les montants se comparent en valeur absolue : « entre 600 et 700 » attrape un prélèvement de -635,46 €. Utilisez le critère « Sens » pour distinguer dépense et recette.</div> }
        </div>

        <div class="sec">
          <div class="overline">Actions</div>
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

        <label class="check">
          <input type="checkbox" [ngModel]="store.ui().ruleStop" (ngModelChange)="store.patch({ ruleStop: $event })" />
          <span>Arrêter là : ne pas évaluer les règles suivantes sur les opérations retenues</span>
        </label>
        <label class="check">
          <input type="checkbox" [ngModel]="store.ui().ruleEnabled" (ngModelChange)="store.patch({ ruleEnabled: $event })" />
          <span>Règle active</span>
        </label>

        @if (store.ui().ruleError; as err) { <div class="banner err inmodal"><f-icon name="urgent" [size]="17" color="var(--primary)" [width]="2.2" /><span>{{ err }}</span></div> }

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
          @if (store.ui().ruleId) {
            <button class="btn btn-danger" (click)="store.patch({ ruleDelId: store.ui().ruleId })"><f-icon name="trash" [size]="16" color="var(--primary)" /> Supprimer</button>
          }
          <div class="spacer"></div>
          <button class="btn btn-soft" [disabled]="store.ui().ruleBusy" (click)="store.previewRule()">Tester</button>
          <button class="btn btn-primary" [disabled]="store.ui().ruleBusy" (click)="store.saveRule()">Enregistrer et appliquer</button>
        </div>
      </f-modal>
    }

    @if (store.ui().ruleDelId) {
      <f-modal [maxWidth]="400" (close)="store.patch({ ruleDelId: null })">
        <div class="confirm">
          <div class="confirm-ic"><f-icon name="trash" [size]="26" color="var(--primary)" [width]="2" /></div>
          <div class="confirm-title f-display">Supprimer cette règle ?</div>
          <div class="confirm-txt">« {{ delName() }} » ne s’appliquera plus. Les opérations qu’elle avait rangées gardent leur catégorie, elles passent simplement en classement manuel.</div>
          <div class="modal-acts">
            <button class="btn btn-soft grow" (click)="store.patch({ ruleDelId: null })">Annuler</button>
            <button class="btn btn-primary grow" (click)="store.confirmRuleDel()">Supprimer</button>
          </div>
        </div>
      </f-modal>
    }
  `,
  styles: [`
    .intro { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; background: var(--surface); border-radius: 16px; padding: 16px 18px; margin-bottom: 12px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .intro-txt { flex: 1; min-width: 260px; font-size: 13px; font-weight: 700; color: var(--ink2); line-height: 1.55; }
    .intro-acts { display: flex; gap: 10px; flex-wrap: wrap; }
    .check.force { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; font-size: 12.5px; font-weight: 700; color: var(--ink3); cursor: pointer; }

    .banner { display: flex; align-items: center; gap: 12px; border-radius: 16px; padding: 13px 16px; margin-bottom: 16px; font-size: 13.5px; font-weight: 700; background: #FCE9E3; color: #8C3B26; }
    :host-context(.dark) .banner { background: #3A2622; color: #F0A98B; }
    .banner.inmodal { margin: 16px 0 0; }

    .report { background: var(--soft); border-radius: 16px; padding: 14px 16px; margin-bottom: 16px; }
    .report-head { display: flex; align-items: center; gap: 10px; }
    .report-title { flex: 1; font-size: 13.5px; font-weight: 800; color: var(--ink); }
    .report-note { font-size: 12.5px; font-weight: 700; color: var(--ink3); margin-top: 4px; }
    .report-line { display: flex; gap: 10px; font-size: 12.5px; font-weight: 700; color: var(--ink2); margin-top: 6px; }
    .report-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .report-n { font-variant-numeric: tabular-nums; font-weight: 800; }

    .rules { display: flex; flex-direction: column; gap: 10px; }
    .rule { display: flex; align-items: center; gap: 13px; background: var(--surface); border-radius: 16px; padding: 12px 16px; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .rule.off { opacity: .55; }
    .rule-ord { display: flex; flex-direction: column; align-items: center; gap: 1px; flex: none; }
    .ord { width: 26px; height: 20px; border: none; border-radius: 7px; background: var(--soft2); display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .ord:first-child f-icon { transform: rotate(90deg); }
    .ord:last-child f-icon { transform: rotate(90deg); }
    .ord:disabled { opacity: .3; cursor: default; }
    .ord-n { font-size: 11px; font-weight: 800; color: var(--ink3); }
    .rule-body { flex: 1; min-width: 0; cursor: pointer; }
    .rule-name { font-weight: 800; font-size: 14.5px; color: var(--ink); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
    .rule-when, .rule-then { font-size: 12px; font-weight: 700; color: var(--ink3); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag { background: var(--soft2); border-radius: 20px; padding: 1px 8px; font-size: 10.5px; font-weight: 800; color: var(--ink2); }
    .toggle { width: 42px; height: 24px; flex: none; border: none; border-radius: 20px; background: var(--soft2); position: relative; cursor: pointer; padding: 0; }
    .toggle.on { background: var(--primary); }
    .knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .16s ease; }
    .toggle.on .knob { left: 21px; }

    .empty { background: var(--surface); border-radius: 16px; padding: 34px 24px; text-align: center; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .empty-title { font-size: 15px; font-weight: 800; color: var(--ink); }
    .empty-txt { font-size: 13px; font-weight: 700; color: var(--ink3); margin: 6px auto 0; max-width: 460px; line-height: 1.55; }

    .tags-block { margin-top: 22px; }
    .tags { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
    .tagchip { border: none; border-radius: 20px; padding: 6px 13px; background: var(--surface); font-size: 12.5px; font-weight: 800; color: var(--ink2); cursor: pointer; font-family: inherit; box-shadow: 0 10px 24px -20px rgba(90,60,40,.6); }
    .tagn { color: var(--ink3); }

    .sec { margin-top: 22px; }
    .sec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .seg.small button { font-size: 12px; padding: 6px 12px; }
    .cond { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .vals { flex: 1; min-width: 0; display: flex; gap: 8px; }
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
    .confirm { text-align: center; }
    .confirm-ic { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; background: #FCE9E3; display: flex; align-items: center; justify-content: center; }
    .confirm-title { font-size: 20px; font-weight: 700; color: var(--ink); }
    .confirm-txt { font-size: 14px; font-weight: 600; color: var(--ink2); margin: 8px 0 0; line-height: 1.5; }
    @media (max-width: 560px) {
      .cond { flex-wrap: wrap; }
      .input.mini, .act-name { width: 100%; }
      .vals { flex-basis: 100%; }
    }
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
      case 'label': return `réécrire le libellé en « ${a.value} »`;
      case 'tag': return `étiqueter « ${a.value} »`;
      default: return 'marquer comme virement interne';
    }
  }

  describeActions(r: FinRule): string { return r.actions.map((a) => this.actionText(a)).join(', '); }

  /** What the previewed rule would do to one row, in the row's own terms. */
  changeText(row: FinPreviewRow): string {
    if (!row.changes) return row.manual ? `${this.store.categoryPath(row.categoryId)} (gardée)` : 'déjà à jour';
    const bits: string[] = [];
    if (row.manual) bits.push(`${this.store.categoryPath(row.categoryId)} (gardée)`);
    else if (row.newCategoryId !== null || this.hasCategoryAction()) bits.push(`${this.store.categoryPath(row.categoryId)} → ${this.store.categoryPath(row.newCategoryId)}`);
    if (row.newLabel) bits.push(`libellé → « ${row.newLabel} »`);
    if (row.newTags.length) bits.push(`étiquette ${row.newTags.join(', ')}`);
    if (row.newTransfer) bits.push('virement interne');
    return bits.join(' · ') || 'aucun changement';
  }

  private hasCategoryAction(): boolean { return this.store.ui().ruleActions.some((a) => a.kind === 'category'); }
}
