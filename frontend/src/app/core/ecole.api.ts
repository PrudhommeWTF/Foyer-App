import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

// Client léger sur /api/ecole. Le navigateur ne parle jamais à ÉcoleDirecte et
// ne voit jamais d'identifiant, de mot de passe ni d'appareil de confiance :
// seulement des dates (« enregistrés le … ») et des états.

export type EdState = 'ok' | 'jamais' | 'erreur' | 'qcm' | 'identifiants' | 'version' | 'cle' | 'pause' | 'pause-auto';
export type EdLinkState = 'propose' | 'confirme' | 'ignore' | 'aucun';

export interface EdStudent {
  id: number; firstName: string; lastName: string; className: string; schoolName: string;
  memberId: string | null; matchSource: 'prenom' | 'manuel' | null; linkState: EdLinkState;
}

export interface EdAccount {
  id: number; label: string; accountType: 'famille' | 'eleve' | null; state: EdState;
  credsSetAt: string | null; trustedSince: string | null;
  pendingQcm: { question: string; propositions: string[]; askedAt: string } | null;
  enabled: boolean; lastSyncAt: string | null; lastOkAt: string | null;
  lastError: { at: string; code: number | null; kind: string | null; message: string | null } | null;
  consecutiveFailures: number; pausedUntil: string | null; alertedAt: string | null; nextRunAt: string | null;
  students: EdStudent[];
}

export interface EdLogLine { id: number; accountId: number | null; at: string; scope: string; ok: boolean; httpStatus: number | null; edCode: number | null; message: string; durationMs: number | null; }

export interface EdEtat {
  keyState: 'ok' | 'absente' | 'trop-courte';
  apiBase: string; apiVersion: string; inPause: boolean;
  accounts: EdAccount[]; journal: EdLogLine[];
}

/** Ce qu'une connexion a donné, à afficher tout de suite sous le bouton. */
export type EdResult =
  | { kind: 'ok'; students: number }
  | { kind: 'qcm'; question: string; propositions: string[]; changed?: boolean }
  | { kind: 'erreur'; errorKind: string; code: number | null; message: string };

@Injectable({ providedIn: 'root' })
export class EcoleApi {
  private api = inject(ApiService);

  etat(): Promise<EdEtat> { return this.api.request('ecole/etat'); }
  create(label: string, identifiant: string, motdepasse: string): Promise<{ result: EdResult; account: EdAccount }> {
    return this.api.post('ecole/comptes', { label, identifiant, motdepasse });
  }
  update(id: number, body: { label?: string; identifiant?: string; motdepasse?: string }): Promise<{ result: EdResult | null; account: EdAccount }> {
    return this.api.put('ecole/comptes/' + id, body);
  }
  connect(id: number): Promise<{ result: EdResult; account: EdAccount }> { return this.api.post('ecole/comptes/' + id + '/connexion', {}); }
  answer(id: number, choix: number): Promise<{ result: EdResult; account: EdAccount }> { return this.api.post('ecole/comptes/' + id + '/qcm', { choix }); }
  pause(id: number, pause: boolean): Promise<{ account: EdAccount }> { return this.api.post('ecole/comptes/' + id + '/pause', { pause }); }
  remove(id: number): Promise<{ ok: true }> { return this.api.del('ecole/comptes/' + id); }
  link(studentId: number, action: 'confirmer' | 'associer' | 'ignorer' | 'dissocier', memberId?: string): Promise<{ account: EdAccount }> {
    return this.api.put('ecole/eleves/' + studentId, { action, ...(memberId ? { memberId } : {}) });
  }
}
