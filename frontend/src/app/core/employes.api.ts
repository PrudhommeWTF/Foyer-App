import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

// Client léger sur /api/employes, réutilisant le jeton et la gestion d'erreurs
// d'ApiService. Le module vit dans ses propres tables relationnelles : rien ici
// ne passe par le document d'état du foyer. En PR 1, seul le contrôle du taux
// (dans les Paramètres) s'en sert ; l'écran « Ménage » ajoutera le reste.

export type EmpRole = 'menage' | 'garde' | 'jardin' | 'autre';

export interface EmpRate { id: number; employeeId: number; netHourlyCents: number; effectiveFrom: string; createdAt: string; createdBy: string | null; }
export interface EmpEmployee { id: number; name: string; role: EmpRole; active: boolean; createdAt: string; archivedAt: string | null; currentRate: { netHourlyCents: number; effectiveFrom: string } | null; }
export interface EmpBootstrap { employees: EmpEmployee[]; configuredHourlyRate: number; congesInclus: boolean; dureeHabituelle: number; rappelJour: number; }

@Injectable({ providedIn: 'root' })
export class EmployesApi {
  private api = inject(ApiService);

  bootstrap(): Promise<EmpBootstrap> { return this.api.request('employes/bootstrap'); }
  rates(employeeId?: number): Promise<{ employeeId: number; rates: EmpRate[] }> {
    return this.api.request('employes/rates' + (employeeId ? '?employee=' + employeeId : ''));
  }
  /** Règle le taux courant (euros) avec sa date d'effet : ajoute une ligne d'historique et met le réglage à jour. */
  setRate(euros: number, effectiveFrom: string, employeeId?: number): Promise<{ rate: EmpRate; rates: EmpRate[] }> {
    return this.api.put('employes/taux', { euros, effective_from: effectiveFrom, ...(employeeId ? { employee: employeeId } : {}) });
  }
  createEmployee(name: string, role: EmpRole): Promise<{ employee: EmpEmployee }> {
    return this.api.post('employes/employees', { name, role });
  }
}
