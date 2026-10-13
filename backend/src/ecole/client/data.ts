// Lecture des réponses de données : cahier de textes et emploi du temps.
//
// Formes constatées dans `ecoledirecte_api` 0.4.0 (`client.py` : get_homeworks,
// get_homeworks_by_date, get_edt) et la documentation communautaire
// EduWireApps/ecoledirecte-api-docs :
//
//   cahier de textes, liste  : data = { "AAAA-MM-JJ": [ { idDevoir, matiere,
//                              codeMatiere, donneLe, effectue, interrogation,
//                              rendreEnLigne, aFaire } ] }
//   cahier de textes, un jour : data = { date, matieres: [ { id, matiere,
//                              codeMatiere, nomProf, interrogation, aFaire: {
//                              idDevoir, contenu (HTML en base64), donneLe,
//                              effectue, rendreEnLigne, documents[] } } ] }
//   emploi du temps          : data = [ { id, matiere, text, typeCours,
//                              start_date, end_date ("AAAA-MM-JJ HH:MM", heure
//                              de Paris), prof, salle, isAnnule, isModifie } ]
//
// Lecture prudente, comme pour la connexion : un champ absent donne une valeur
// vide, jamais une exception.

export interface EdHomeworkSummary {
  edId: number; due: string; subject: string; subjectCode: string;
  givenOn: string; done: boolean; isTest: boolean; online: boolean;
}

export interface EdHomeworkDetail extends EdHomeworkSummary {
  teacher: string;
  /** L'énoncé en HTML, décodé du base64 mais pas nettoyé : c'est l'affaire de l'appelant. */
  html: string;
  documents: number;
}

export interface EdLesson {
  edId: number; day: string; start: string; end: string;
  subject: string; teacher: string; room: string; kind: string;
  cancelled: boolean; modified: boolean;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number => { const n = typeof v === 'number' ? v : parseInt(str(v), 10); return Number.isFinite(n) ? n : 0; };
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const unb64 = (v: unknown): string => { const s = str(v); if (!s) return ''; try { return Buffer.from(s, 'base64').toString('utf8'); } catch { return ''; } };

export function parseHomeworkList(data: unknown): EdHomeworkSummary[] {
  const out: EdHomeworkSummary[] = [];
  for (const [due, items] of Object.entries(obj(data))) {
    if (!DAY.test(due)) continue;
    for (const raw of arr(items)) {
      const e = obj(raw);
      const edId = num(e['idDevoir']);
      if (!edId) continue;
      out.push({
        edId, due, subject: str(e['matiere']), subjectCode: str(e['codeMatiere']),
        givenOn: str(e['donneLe']), done: bool(e['effectue']), isTest: bool(e['interrogation']), online: bool(e['rendreEnLigne']),
      });
    }
  }
  return out;
}

export function parseHomeworkDay(data: unknown, day: string): EdHomeworkDetail[] {
  const d = obj(data);
  const due = DAY.test(str(d['date'])) ? str(d['date']) : day;
  const out: EdHomeworkDetail[] = [];
  for (const raw of arr(d['matieres'])) {
    const m = obj(raw);
    const a = obj(m['aFaire']);
    // Une matière sans « à faire » ne porte que le contenu de séance : pas un devoir.
    if (!Object.keys(a).length) continue;
    const edId = num(a['idDevoir']) || num(m['id']);
    if (!edId) continue;
    out.push({
      edId, due, subject: str(m['matiere']), subjectCode: str(m['codeMatiere']), teacher: str(m['nomProf']),
      givenOn: str(a['donneLe']), done: bool(a['effectue']), isTest: bool(m['interrogation']), online: bool(a['rendreEnLigne']),
      html: unb64(a['contenu']), documents: arr(a['documents']).length,
    });
  }
  return out;
}

export function parseTimetable(data: unknown): EdLesson[] {
  const out: EdLesson[] = [];
  for (const raw of arr(data)) {
    const e = obj(raw);
    const [day, start] = str(e['start_date']).split(' ');
    const [endDay, end] = str(e['end_date']).split(' ');
    if (!DAY.test(day) || !/^\d{2}:\d{2}$/.test(start || '') || !/^\d{2}:\d{2}$/.test(end || '') || endDay !== day) continue;
    out.push({
      edId: num(e['id']), day, start, end,
      subject: str(e['matiere']) || str(e['text']), teacher: str(e['prof']), room: str(e['salle']), kind: str(e['typeCours']),
      cancelled: bool(e['isAnnule']), modified: bool(e['isModifie']),
    });
  }
  return out;
}

// ---- Notes et vie scolaire ------------------------------------------------
//
// notes      : data = { notes: [ { id, devoir, codePeriode, codeMatiere,
//              libelleMatiere, typeDevoir, valeur, noteSur, coef, moyenneClasse,
//              minClasse, maxClasse, nonSignificatif, date } ], periodes: [ {
//              codePeriode, periode, dateDebut, dateFin, cloture,
//              ensembleMatieres: { moyenneGenerale, moyenneClasse, disciplines:
//              [ { codeMatiere, discipline, moyenne, moyenneClasse, moyenneMin,
//              moyenneMax, coef } ] } } ] }
// vie scolaire : data = { absencesRetards: [...], sanctionsEncouragements:
//              [...] }, chaque ligne { id, typeElement, date, displayDate,
//              libelle, motif, justifie, par, commentaire }
//
// Les valeurs sont des chaînes à virgule (« 12,5 ») qu'on garde telles quelles :
// Foyer affiche ce qu'ÉcoleDirecte renvoie et ne recalcule rien.

export interface EdGrade {
  edId: number; date: string; subject: string; subjectCode: string; label: string; kind: string;
  valueRaw: string; valueNum: number | null; outOf: string; coefficient: string;
  classAverage: string; classMin: string; classMax: string; periodCode: string; notSignificant: boolean;
}
export interface EdAverage {
  periodCode: string; periodLabel: string; periodFrom: string; periodTo: string; closed: boolean;
  subjectCode: string; subject: string; average: string; classAverage: string; classMin: string; classMax: string; coefficient: string;
}
export type EdLifeKind = 'absence' | 'retard' | 'sanction' | 'encouragement';
export interface EdLifeItem {
  edId: number; kind: EdLifeKind; date: string; displayDate: string; label: string; reason: string;
  justified: boolean | null; by: string; comment: string;
}

/** « 14,5 » → 14.5 ; « Abs », « NN », « Disp » → null. */
export const gradeNumber = (raw: string): number | null => {
  const t = raw.trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const day = (v: unknown): string => { const s = str(v).slice(0, 10); return DAY.test(s) ? s : ''; };

export function parseGrades(data: unknown): { grades: EdGrade[]; averages: EdAverage[] } {
  const d = obj(data);
  const grades = arr(d['notes']).map(obj).map((n): EdGrade => {
    const valueRaw = str(n['valeur']);
    return {
      edId: num(n['id']), date: day(n['date']), subject: str(n['libelleMatiere']), subjectCode: str(n['codeMatiere']),
      label: str(n['devoir']), kind: str(n['typeDevoir']), valueRaw, valueNum: gradeNumber(valueRaw), outOf: str(n['noteSur']),
      coefficient: str(n['coef']), classAverage: str(n['moyenneClasse']), classMin: str(n['minClasse']), classMax: str(n['maxClasse']),
      periodCode: str(n['codePeriode']), notSignificant: bool(n['nonSignificatif']),
    };
  }).filter((g) => g.edId > 0);
  const averages: EdAverage[] = [];
  for (const p of arr(d['periodes']).map(obj)) {
    const ens = obj(p['ensembleMatieres']);
    const base = { periodCode: str(p['codePeriode']), periodLabel: str(p['periode']), periodFrom: day(p['dateDebut']), periodTo: day(p['dateFin']), closed: bool(p['cloture']) };
    if (!base.periodCode) continue;
    // La moyenne générale, quand l'établissement la publie, est une ligne de plus.
    if (str(ens['moyenneGenerale'])) averages.push({ ...base, subjectCode: '_GENERALE', subject: 'Moyenne générale', average: str(ens['moyenneGenerale']), classAverage: str(ens['moyenneClasse']), classMin: str(ens['moyenneMin']), classMax: str(ens['moyenneMax']), coefficient: '' });
    for (const m of arr(ens['disciplines']).map(obj)) {
      const code = str(m['codeMatiere']) + (str(m['codeSousMatiere']) ? '/' + str(m['codeSousMatiere']) : '');
      if (!code) continue;
      averages.push({ ...base, subjectCode: code, subject: str(m['discipline']), average: str(m['moyenne']), classAverage: str(m['moyenneClasse']), classMin: str(m['moyenneMin']), classMax: str(m['moyenneMax']), coefficient: str(m['coef']) });
    }
  }
  return { grades, averages };
}

const lifeKind = (t: string, fromSanctions: boolean): EdLifeKind => {
  const k = t.toLowerCase();
  if (k.includes('retard')) return 'retard';
  if (k.includes('absence')) return 'absence';
  if (k.includes('encourag') || k.includes('felicit') || k.includes('félicit')) return 'encouragement';
  return fromSanctions ? 'sanction' : 'absence';
};

export function parseLife(data: unknown): EdLifeItem[] {
  const d = obj(data);
  const read = (list: unknown, fromSanctions: boolean): EdLifeItem[] => arr(list).map(obj).map((e) => ({
    edId: num(e['id']), kind: lifeKind(str(e['typeElement']), fromSanctions), date: day(e['date']), displayDate: str(e['displayDate']),
    label: str(e['libelle']), reason: str(e['motif']), justified: e['justifie'] === undefined || e['justifie'] === null ? null : bool(e['justifie']),
    by: str(e['par']), comment: str(e['commentaire']),
  })).filter((e) => e.edId > 0);
  return [...read(d['absencesRetards'], false), ...read(d['sanctionsEncouragements'], true)];
}
