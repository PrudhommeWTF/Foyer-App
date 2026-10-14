// L'employé à domicile, tel qu'il se déclare à la fiche d'élément. Seul un
// administrateur le modifie ou le retire ; retirer le fait quitter la liste,
// ses heures et déclarations restent (rien n'est jamais effacé dans ce module).
import type { FoyerStore } from '../../core/foyer.store';
import { EmployesStore } from '../../core/employes.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { EmpEmployee } from '../../core/employes.api';
import { EmployeeView } from './employee-view';
import { EmployeeForm } from './employee-form';

const emp = (s: FoyerStore): EmployesStore => s.injector.get(EmployesStore);

export const EMPLOYEE_ITEM: ItemKind<EmpEmployee, FoyerStore> = {
  meta: ITEM_KINDS.employee,
  load: (s, id) => emp(s).employes().find((e) => e.id === Number(id)) ?? null,
  title: (e) => e.name,
  view: EmployeeView,
  form: EmployeeForm,
  canEdit: (_e, s) => s.isAdmin(),
  canRemove: (_e, s) => s.isAdmin(),
  remove: async (s, e, _ctx, scope) => {
    if (!scope) {
      return { kind: 'ask', question: 'Retirer « ' + e.name + ' » de la liste ? Ses heures et déclarations restent enregistrées : rien n’est effacé.',
        choices: [{ scope: 'all', label: 'Retirer de la liste', danger: true }] };
    }
    try { await emp(s).archiverEmploye(e.id); s.toast('Employé retiré de la liste'); return { kind: 'done' }; }
    catch (err) { s.toast((err as Error).message || 'Le retrait a échoué.'); return { kind: 'invalid' }; }
  },
  // Le module s'ouvre sur ses heures.
  openIn: (s, e) => { s.go('employe'); emp(s).selectEmploye(e.id); },
  fingerprint: (e) => JSON.stringify(e),
};
