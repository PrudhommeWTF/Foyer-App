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
  halfBoard: boolean; dataOkAt: string | null; dataError: string | null;
}

/** Un élève tel que l'écran École le voit (adulte : tous ; enfant : lui seul). */
export interface EdVueStudent {
  id: number; memberId: string; firstName: string; lastName: string; className: string; schoolName: string;
  halfBoard: boolean; dataOkAt: string | null; dataError: string | null; dataErrorAt: string | null;
  account: { state: EdState; lastOkAt: string | null; lastError: string | null; pausedUntil: string | null } | null;
}

export interface EdHomework {
  id: number; studentId: number; memberId: string | null; due: string; subject: string; teacher: string;
  html: string; text: string; isTest: boolean; online: boolean; givenOn: string | null;
  /** La coche de la tâche quand elle existe, sinon la valeur gardée par le module. */
  done: boolean;
  /** Coché ou décoché dans Foyer, pas encore accepté par ÉcoleDirecte. */
  pending: boolean;
  doneError: string | null;
  modifiedAt: string | null; archived: boolean; taskId: string | null;
}

export interface EdVue { today: string; students: EdVueStudent[]; homework: EdHomework[]; }

export interface EdLessonView {
  id: number; studentId: number; memberId: string | null; halfBoard: boolean;
  day: string; start: string; end: string; subject: string; teacher: string; room: string; kind: string;
  cancelled: boolean; modified: boolean;
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
  halfBoard(studentId: number, halfBoard: boolean): Promise<{ account: EdAccount }> {
    return this.api.put('ecole/eleves/' + studentId, { action: 'demi-pension', halfBoard });
  }

  // ---- Lecture : tout membre (un enfant ne reçoit que ce qui le concerne) ----
  vue(): Promise<EdVue> { return this.api.request('ecole/vue'); }
  cours(from: string, to: string): Promise<{ lessons: EdLessonView[] }> { return this.api.request(`ecole/cours?from=${from}&to=${to}`); }
  archives(studentId: number, from: string, to: string): Promise<{ homework: EdHomework[] }> {
    return this.api.request(`ecole/eleves/${studentId}/devoirs?archives=1&from=${from}&to=${to}`);
  }
  fait(homeworkId: number, fait: boolean): Promise<{ homework: EdHomework }> { return this.api.post('ecole/devoirs/' + homeworkId + '/fait', { fait }); }
}
