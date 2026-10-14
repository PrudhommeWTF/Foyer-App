import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { EcoleApi, EdHomework, EdLessonView, EdVue, EdVueStudent } from './ecole.api';
import { DayExtra, FoyerStore } from './foyer.store';
import { CAL_KINDS } from './constants';
import { lessonSlots } from './ecole-slots';

/** « MATHEMATIQUES » → « Mathematiques » : ÉcoleDirecte écrit souvent les matières en capitales. */
export const subjectLabel = (s: string): string => {
  const t = (s || '').trim();
  if (!t) return 'Devoir';
  const lower = t === t.toUpperCase() ? t.toLowerCase() : t;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

/** « de mathématiques », « d’anglais » : l'élision devant une voyelle. */
export const deMatiere = (s: string): string => { const m = subjectLabel(s).toLowerCase(); return (/^[aeiouyéèêàâîôûh]/.test(m) ? 'd’' : 'de ') + m; };

/**
 * État du module École côté écran. Tout vient de /api/ecole : le serveur seul
 * parle à ÉcoleDirecte, et il ne renvoie à un enfant que ce qui le concerne.
 *
 * Chargé dès la connexion (le module nourrit aussi l'emploi du temps, la
 * présence aux repas, l'accueil et l'agenda), puis relu toutes les cinq
 * minutes : la synchronisation avec ÉcoleDirecte, elle, tourne côté serveur
 * à son propre rythme.
 */
@Injectable({ providedIn: 'root' })
export class EcoleStore {
  private api = inject(EcoleApi);
  readonly foyer = inject(FoyerStore);

  readonly vue = signal<EdVue | null>(null);
  readonly lessons = signal<EdLessonView[]>([]);
  /** Le serveur n'a pas répondu : l'écran le dit au lieu d'afficher « rien à faire ». */
  readonly indispo = signal(false);
  /** Les devoirs en cours d'envoi au serveur, pour griser leur case. */
  readonly busy = signal<ReadonlySet<number>>(new Set());

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const on = this.foyer.authed() && this.foyer.modEcole();
      if (on && !this.timer) { void this.load(); this.timer = setInterval(() => void this.load(), 5 * 60_000); }
      if (!on && this.timer) { clearInterval(this.timer); this.timer = null; this.vue.set(null); this.lessons.set([]); }
    });
    effect(() => this.foyer.setExternalDayExtras('ecole', this.dayExtras()));
    effect(() => this.foyer.setExternalSlots('ecole', lessonSlots(this.lessons(), subjectLabel)));
  }

  async load(): Promise<void> {
    const today = this.foyer.todayStr();
    try {
      const [v, c] = await Promise.all([this.api.vue(), this.api.cours(this.foyer.addDays(today, -14), this.foyer.addDays(today, 35))]);
      this.vue.set(v); this.lessons.set(c.lessons); this.indispo.set(false);
    } catch { this.indispo.set(true); }
  }

  readonly students = computed<EdVueStudent[]>(() => this.vue()?.students ?? []);
  readonly homework = computed<EdHomework[]>(() => this.vue()?.homework ?? []);

  studentOfMember(memberId: string): EdVueStudent | undefined { return this.students().find((s) => s.memberId === memberId); }
  homeworkOf(studentId: number): EdHomework[] { return this.homework().filter((h) => h.studentId === studentId); }

  /** Cocher ou décocher : l'écran change tout de suite, le serveur répond avec l'état vrai. */
  /** Coche ou décoche ; renvoie le devoir tel qu'enregistré (inchangé si l'envoi échoue). */
  async setDone(h: EdHomework, fait: boolean): Promise<EdHomework> {
    const swap = (x: EdHomework): void => this.vue.update((v) => (v ? { ...v, homework: v.homework.map((y) => (y.id === x.id ? x : y)) } : v));
    swap({ ...h, done: fait, pending: true });
    this.busy.update((s) => new Set([...s, h.id]));
    let out = h;
    try {
      out = (await this.api.fait(h.id, fait)).homework;
    } catch (e) {
      this.foyer.toast((e as Error).message || 'La case n’a pas pu être enregistrée.');
    }
    swap(out);
    this.busy.update((s) => { const n = new Set(s); n.delete(h.id); return n; });
    return out;
  }

  /**
   * Ce que l'accueil dit en une ligne : par enfant, ce qui reste pour demain,
   * dont les interrogations. Les devoirs eux-mêmes sont déjà dans la tuile Tâches.
   */
  readonly tomorrowLines = computed<string[]>(() => {
    const v = this.vue();
    if (!v) return [];
    const demain = this.foyer.addDays(v.today, 1);
    return v.students.map((s) => {
      const name = this.foyer.memberName(s.memberId) || s.firstName;
      const todo = v.homework.filter((h) => h.studentId === s.id && h.due === demain && !h.done);
      if (!todo.length) return `${name} : rien pour demain`;
      const tests = todo.filter((h) => h.isTest);
      return `${name} : ${todo.length} devoir${todo.length > 1 ? 's' : ''} pour demain`
        + (tests.length ? `, dont ${tests.length === 1 ? 'une interrogation ' + deMatiere(tests[0].subject) : tests.length + ' interrogations'}` : '');
    });
  });

  /** La même chose en une ligne courte, pour la tuile de la grille d'accueil : « Demain : Léna 1 · Nolan 2, 1 interro ». */
  readonly tomorrowShort = computed<string>(() => {
    const v = this.vue();
    if (!v || !v.students.length) return '';
    const demain = this.foyer.addDays(v.today, 1);
    const todo = v.homework.filter((h) => h.due === demain && !h.done);
    const tests = todo.filter((h) => h.isTest).length;
    return 'Demain : ' + v.students.map((s) => `${this.foyer.memberName(s.memberId) || s.firstName} ${todo.filter((h) => h.studentId === s.id).length}`).join(' · ')
      + (tests ? `, ${tests} interro${tests > 1 ? 's' : ''}` : '');
  });

  /**
   * L'état de la synchronisation, en clair. Jamais une donnée périmée
   * présentée comme fraîche : la dernière réussite est datée, l'échec dit.
   */
  readonly syncLine = computed<{ ok: boolean; text: string } | null>(() => {
    const st = this.students();
    if (!st.length) return null;
    const failing = st.filter((s) => s.dataError || (s.account && !['ok', 'jamais'].includes(s.account.state)));
    const last = st.map((s) => s.dataOkAt).filter((x): x is string => !!x).sort().pop() || null;
    if (!failing.length) return { ok: true, text: last ? 'Synchronisé ' + this.ago(last) : 'Pas encore synchronisé' };
    const noms = failing.map((s) => this.foyer.memberName(s.memberId) || s.firstName).join(', ');
    const since = failing.map((s) => s.dataErrorAt).filter((x): x is string => !!x).sort()[0];
    return { ok: false, text: `ÉcoleDirecte indisponible${failing.length < st.length ? ' pour ' + noms : ''}${since ? ' depuis ' + this.when(since) : ''}${last ? ', dernière réussite ' + this.ago(last) : ''}` };
  });

  /** Les interrogations à l'agenda : un repère au jour, pas un événement. */
  private dayExtras(): Record<string, DayExtra[]> {
    const out: Record<string, DayExtra[]> = {};
    const v = this.vue();
    if (!v) return out;
    for (const h of v.homework) {
      if (!h.isTest || h.archived) continue;
      const name = (h.memberId && this.foyer.memberName(h.memberId)) || '';
      (out[h.due] ??= []).push({ kind: 'ecole', label: 'Interro ' + subjectLabel(h.subject).toLowerCase(), color: CAL_KINDS['ecole'].color, sub: name || undefined });
    }
    return out;
  }

  /** « il y a 25 min », « à 14:02 », « hier à 18:00 ». */
  ago(iso: string): string {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    if (min < 1) return 'à l’instant';
    if (min < 60) return `il y a ${min} min`;
    return this.when(iso);
  }
  when(iso: string): string {
    const d = new Date(iso);
    const hm = d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
    const day = d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
    const today = this.foyer.todayStr();
    if (day === today) return 'à ' + hm;
    if (day === this.foyer.addDays(today, -1)) return 'hier à ' + hm;
    return 'le ' + d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' }) + ' à ' + hm;
  }
}
