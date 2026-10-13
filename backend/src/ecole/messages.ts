// Le texte des notifications du module École. Pur : des lignes entrent, un
// titre et un corps sortent. Une notification par élève et par sorte à chaque
// passage : une note seule se dit en clair (« Nolan : 15/20 en histoire »),
// plusieurs se regroupent (« Nolan : 3 nouvelles notes »).
import { subjectLabel } from './html';

export interface Message { title: string; body: string; }

const lower = (s: string): string => subjectLabel(s).toLowerCase();
const fr = (day: string | null): string => (day ? day.split('-').reverse().slice(0, 2).join('/') : '');
const DOW = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « aujourd'hui », « hier », « demain », « jeudi », « le 12/10 ». */
export function relativeDay(day: string | null, today: string): string {
  if (!day) return '';
  const diff = Math.round((Date.parse(day + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86_400_000);
  if (diff === 0) return 'aujourd’hui';
  if (diff === -1) return 'hier';
  if (diff === 1) return 'demain';
  if (diff > 1 && diff < 7) return DOW[new Date(day + 'T12:00:00Z').getUTCDay()];
  return 'le ' + fr(day);
}

export interface GradeLike { subject: string; valueRaw: string; valueNum: number | null; outOf: string; label: string; classAverage: string; }

/** « 15/20 en histoire », « Abs en anglais ». La valeur telle qu'ÉcoleDirecte la donne. */
export function gradeLine(g: GradeLike): string {
  const v = g.valueNum !== null && g.outOf ? `${g.valueRaw}/${g.outOf}` : g.valueRaw || 'note';
  return `${v} en ${lower(g.subject)}`;
}

export function gradesMessage(name: string, grades: GradeLike[]): Message {
  if (grades.length === 1) {
    const g = grades[0];
    return { title: `${name} : ${gradeLine(g)}`, body: [g.label, g.classAverage ? `moyenne de la classe ${g.classAverage}` : ''].filter(Boolean).join(' · ') || 'Nouvelle note sur ÉcoleDirecte.' };
  }
  return { title: `${name} : ${grades.length} nouvelles notes`, body: grades.map(gradeLine).join(' · ') };
}

export interface LifeLike { kind: 'absence' | 'retard' | 'sanction' | 'encouragement'; date: string | null; label: string; reason: string; justified: boolean | null; }

const LIFE_LABEL: Record<LifeLike['kind'], string> = {
  absence: 'absence enregistrée', retard: 'retard enregistré', sanction: 'sanction enregistrée', encouragement: 'encouragement',
};

export function lifeLine(e: LifeLike, today: string): string {
  const when = relativeDay(e.date, today);
  const justif = e.kind === 'absence' || e.kind === 'retard' ? (e.justified === null ? '' : e.justified ? ', justifié' + (e.kind === 'absence' ? 'e' : '') : ', non justifié' + (e.kind === 'absence' ? 'e' : '')) : '';
  return `${LIFE_LABEL[e.kind]}${when ? ' ' + when : ''}${justif}`;
}

export function lifeMessage(name: string, items: LifeLike[], today: string): Message {
  if (items.length === 1) {
    const e = items[0];
    return { title: `${name} : ${lifeLine(e, today)}`, body: [e.label, e.reason].filter(Boolean).join(' · ') || 'Voir la vie scolaire sur ÉcoleDirecte.' };
  }
  return { title: `${name} : ${items.length} nouveaux événements de vie scolaire`, body: items.map((e) => lifeLine(e, today)).join(' · ') };
}

export interface HomeworkLike { subject: string; due: string; isTest: boolean; }

export function homeworkMessage(name: string, items: HomeworkLike[], today: string): Message {
  if (items.length === 1) {
    const h = items[0];
    return { title: `${name} : ${h.isTest ? 'interrogation' : 'nouveau devoir'} ${lower(h.subject).match(/^[aeiouyéèêàâîôûh]/) ? 'd’' : 'de '}${lower(h.subject)} pour ${relativeDay(h.due, today)}`, body: 'Dans l’écran École et la liste de ses devoirs.' };
  }
  return { title: `${name} : ${items.length} nouveaux devoirs`, body: items.map((h) => `${subjectLabel(h.subject)} pour ${relativeDay(h.due, today)}`).join(' · ') };
}

/** Le rappel du soir : ce qui reste à faire pour demain. */
export function eveningMessage(name: string, items: HomeworkLike[]): Message {
  const tests = items.filter((h) => h.isTest).length;
  return {
    title: `${name} : ${items.length} devoir${items.length > 1 ? 's' : ''} pour demain${tests ? `, dont ${tests === 1 ? 'une interrogation' : tests + ' interrogations'}` : ''}`,
    body: items.map((h) => subjectLabel(h.subject) + (h.isTest ? ' (interrogation)' : '')).join(' · '),
  };
}
