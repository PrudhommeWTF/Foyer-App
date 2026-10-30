import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { EcoleApi, EdAverageView, EdGradeView, EdHomework, EdLessonView, EdVue, EdVueStudent } from './ecole.api';
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
      if (!on && this.timer) { clearInterval(this.timer); this.timer = null; this.vue.set(null); this.lessons.set([]); this.archive.set([]); this.notes.set({}); }
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

  /**
   * Les devoirs passés déjà lus (archives comprises), et les notes par élève :
   * gardés ici plutôt que dans l'écran, pour qu'une fiche les retrouve par
   * leur identifiant, et que revenir sur l'écran ne les relise pas.
   */
  readonly archive = signal<EdHomework[]>([]);
  readonly notes = signal<Record<number, { grades: EdGradeView[]; averages: EdAverageView[] }>>({});

  /** Lit l'historique d'un élève une fois (jusqu'à hier). */
  async loadArchive(studentId: number): Promise<void> {
    if (this.archive().some((h) => h.studentId === studentId)) return;
    const today = this.vue()?.today || this.foyer.todayStr();
    const got = (await this.api.archives(studentId, '2000-01-01', this.foyer.addDays(today, -1))).homework;
    this.archive.update((l) => [...l.filter((h) => h.studentId !== studentId), ...got]);
  }
  /** Lit les notes et moyennes d'un élève, à chaque ouverture de l'onglet (elles bougent). */
  async loadNotes(studentId: number): Promise<void> {
    const r = await this.api.notes(studentId);
    this.notes.update((n) => ({ ...n, [studentId]: { grades: r.grades, averages: r.averages } }));
  }

  /** Un devoir par son identifiant : à venir, ou déjà dans l'historique lu. */
  homeworkById(id: number): EdHomework | null {
    return this.homework().find((h) => h.id === id) ?? this.archive().find((h) => h.id === id) ?? null;
  }
  /** Une note par son identifiant, avec l'élève et la moyenne de sa matière sur sa période quand ÉcoleDirecte la donne. */
  gradeById(id: number): { grade: EdGradeView; studentId: number; average: EdAverageView | null } | null {
    for (const [sid, n] of Object.entries(this.notes())) {
      const grade = n.grades.find((g) => g.id === id);
      if (grade) {
        const average = n.averages.find((a) => a.periodCode === grade.period && subjectLabel(a.subject) === subjectLabel(grade.subject)) ?? null;
        return { grade, studentId: Number(sid), average };
      }
    }
    return null;
  }

  /** Coche ou décoche ; renvoie le devoir tel qu'enregistré (inchangé si l'envoi échoue). L'historique lu suit. */
  async setDone(h: EdHomework, fait: boolean): Promise<EdHomework> {
    const swap = (x: EdHomework): void => {
      this.vue.update((v) => (v ? { ...v, homework: v.homework.map((y) => (y.id === x.id ? x : y)) } : v));
      this.archive.update((l) => l.map((y) => (y.id === x.id ? x : y)));
    };
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
   * Ce que l'accueil montre de demain : par enfant, un devoir par ligne (les
   * interrogations d'abord), qui s'ouvre en fiche. Un enfant sans rien pour
   * demain garde sa ligne, pour qu'on sache qu'il n'a rien plutôt qu'oublié.
   */
  readonly tomorrowByStudent = computed<{ id: number; name: string; items: EdHomework[] }[]>(() => {
    const v = this.vue();
    if (!v) return [];
    const demain = this.foyer.addDays(v.today, 1);
    return v.students.map((s) => ({
      id: s.id, name: this.foyer.memberName(s.memberId) || s.firstName,
      items: v.homework.filter((h) => h.studentId === s.id && h.due === demain && !h.archived)
        .sort((a, b) => Number(a.done) - Number(b.done) || Number(b.isTest) - Number(a.isTest) || a.subject.localeCompare(b.subject)),
    }));
  });

  /**
   * Les devoirs du prochain jour de classe (ni week-end, ni férié, ni vacances),
   * par enfant : en vacances le vendredi, c'est la rentrée du lundi qui compte.
   * `day` le dit comme on le dirait : « demain », « lundi ».
   */
  readonly nextClassByStudent = computed<{ date: string; day: string; students: { id: number; memberId: string; name: string; items: EdHomework[] }[] } | null>(() => {
    const v = this.vue();
    if (!v) return null;
    const cal = this.foyer.calendar();
    let date = '', i = 1;
    for (; i <= 21; i++) {
      const ds = this.foyer.addDays(v.today, i); const dow = new Date(ds + 'T12:00:00Z').getUTCDay(); const info = cal(ds);
      if (dow !== 0 && dow !== 6 && !info.holiday && !info.schoolHoliday) { date = ds; break; }
    }
    if (!date) return null;
    const day = i === 1 ? 'demain' : new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'UTC' });
    return { date, day, students: v.students.map((s) => ({
      id: s.id, memberId: s.memberId, name: this.foyer.memberName(s.memberId) || s.firstName,
      items: v.homework.filter((h) => h.studentId === s.id && h.due === date && !h.archived)
        .sort((a, b) => Number(a.done) - Number(b.done) || Number(b.isTest) - Number(a.isTest) || a.subject.localeCompare(b.subject)),
    })) };
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
