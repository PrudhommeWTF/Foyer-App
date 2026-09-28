import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

// Client léger sur /api/employes, réutilisant le jeton et la gestion d'erreurs
// d'ApiService. Le module vit dans ses propres tables relationnelles : rien ici
// ne passe par le document d'état du foyer. En PR 1, seul le contrôle du taux
// (dans les Paramètres) s'en sert ; l'écran « Ménage » ajoutera le reste.

// Les catégories d'emploi, calquées sur les activités déclarables au CESU
// (même liste que le backend). L'ordre est celui du sélecteur.
export type EmpRole = 'menage' | 'garde' | 'soutien' | 'jardin' | 'bricolage' | 'repas' | 'seniors' | 'informatique' | 'autre';
export const EMP_ROLES: { id: EmpRole; label: string }[] = [
  { id: 'menage', label: 'Ménage / repassage' },
  { id: 'garde', label: 'Garde d’enfants' },
  { id: 'soutien', label: 'Soutien scolaire' },
  { id: 'jardin', label: 'Jardinage' },
  { id: 'bricolage', label: 'Petit bricolage' },
  { id: 'repas', label: 'Préparation de repas' },
  { id: 'seniors', label: 'Assistance aux personnes âgées' },
  { id: 'informatique', label: 'Assistance informatique' },
  { id: 'autre', label: 'Autre' },
];
export const empRoleLabel = (role: string): string => EMP_ROLES.find((r) => r.id === role)?.label || 'Employé';

export interface EmpRate { id: number; employeeId: number; netHourlyCents: number; effectiveFrom: string; createdAt: string; createdBy: string | null; }
export interface EmpEmployee { id: number; name: string; role: EmpRole; active: boolean; createdAt: string; archivedAt: string | null; currentRate: { netHourlyCents: number; effectiveFrom: string } | null; openMonths: string[]; }
export interface EmpBootstrap { employees: EmpEmployee[]; congesInclus: boolean; dureeHabituelle: number; rappelJour: number; }

export type EmpMonthStatus = 'ouvert' | 'declare' | 'paye' | 'sans-presence';
export interface EmpShift { id: number; employeeId: number; day: string; minutes: number; note: string; createdAt: string; createdBy: string | null; createdVia: string | null; updatedAt: string | null; updatedBy: string | null; updatedVia: string | null; }
export interface EmpRateBucket { netHourlyCents: number | null; minutes: number; netCents: number | null; }
export interface EmpMonthRecap {
  employeeId: number; month: string; status: EmpMonthStatus; frozen: boolean;
  minutes: number; netCents: number | null; buckets: EmpRateBucket[];
  declaredAt: string | null; paidAt: string | null; urssafTotalCents: number | null;
  shifts: EmpShift[];
}

@Injectable({ providedIn: 'root' })
export class EmployesApi {
  private api = inject(ApiService);

  bootstrap(): Promise<EmpBootstrap> { return this.api.request('employes/bootstrap'); }
  rates(employeeId?: number): Promise<{ employeeId: number; rates: EmpRate[] }> {
    return this.api.request('employes/rates' + (employeeId ? '?employee=' + employeeId : ''));
  }
  /** Ajoute un taux daté (euros) pour l'employé : une ligne d'historique à partir de la date d'effet. */
  setRate(euros: number, effectiveFrom: string, employeeId?: number): Promise<{ rate: EmpRate; rates: EmpRate[] }> {
    return this.api.put('employes/taux', { euros, effective_from: effectiveFrom, ...(employeeId ? { employee: employeeId } : {}) });
  }
  createEmployee(name: string, role: EmpRole, euros?: number): Promise<{ employee: EmpEmployee }> {
    return this.api.post('employes/employees', { name, role, ...(euros != null ? { euros } : {}) });
  }
  editEmployee(id: number, patch: { name?: string; role?: EmpRole }): Promise<{ employee: EmpEmployee }> {
    return this.api.put('employes/employees/' + id, patch);
  }
  archiveEmployee(id: number): Promise<{ ok: true }> {
    return this.api.post('employes/employees/' + id + '/archive', {});
  }

  month(mois: string, employeeId?: number): Promise<EmpMonthRecap> {
    return this.api.request('employes/month?month=' + mois + (employeeId ? '&employee=' + employeeId : ''));
  }
  addShift(body: { day?: string; minutes?: number; note?: string; force?: boolean }, employeeId?: number): Promise<{ shift?: EmpShift; duplicate?: EmpShift }> {
    return this.api.post('employes/shifts' + (employeeId ? '?employee=' + employeeId : ''), body);
  }
  editShift(id: number, body: { day?: string; minutes?: number; note?: string }): Promise<{ shift: EmpShift }> {
    return this.api.put('employes/shifts/' + id, body);
  }
  archiveShift(id: number): Promise<{ ok: true }> {
    return this.api.post('employes/shifts/' + id + '/archive', {});
  }
  declare(mois: string, body: { date?: string; note?: string } = {}, employeeId?: number): Promise<EmpMonthRecap> {
    return this.api.post('employes/month/declare' + (employeeId ? '?employee=' + employeeId : ''), { month: mois, ...body });
  }
  pay(mois: string, body: { date?: string; urssaf_total?: number } = {}, employeeId?: number): Promise<EmpMonthRecap> {
    return this.api.post('employes/month/pay' + (employeeId ? '?employee=' + employeeId : ''), { month: mois, ...body });
  }
  reopen(mois: string, employeeId?: number): Promise<EmpMonthRecap> {
    return this.api.post('employes/month/reopen' + (employeeId ? '?employee=' + employeeId : ''), { month: mois });
  }
  noPresence(mois: string, employeeId?: number): Promise<EmpMonthRecap> {
    return this.api.post('employes/month/no-presence' + (employeeId ? '?employee=' + employeeId : ''), { month: mois });
  }
}
