// Lecture de la réponse de connexion : les comptes et les élèves qu'ils donnent
// à voir.
//
// Forme constatée dans `ecoledirecte_api` 0.4.0 et la documentation
// communautaire (EduWireApps/ecoledirecte-api-docs, « Login ») :
//
//   data.accounts[] : { id, idLogin, typeCompte ('1' famille, 'E' élève,
//                       'P' professeur), main, prenom, nom, nomEtablissement,
//                       modules[]{ code, enable }, profile }
//   famille         : profile.eleves[]{ id, prenom, nom, classe{ libelle },
//                       nomEtablissement?, modules[] }
//   élève           : profile.classe{ libelle }
//
// Tout est lu prudemment : un champ absent donne une chaîne vide, jamais une
// exception, parce que le serveur omet volontiers ce qu'il n'a pas.

export interface EdStudentInfo {
  /** Identifiant de l'élève chez ÉcoleDirecte : c'est lui qui sert dans les chemins `/Eleves/{id}/…`. */
  edId: number;
  /** Le compte de connexion qui donne accès à cet élève (`renewtoken` pour passer de l'un à l'autre). */
  idLogin: number;
  firstName: string;
  lastName: string;
  className: string;
  schoolName: string;
  /** Codes des modules ÉcoleDirecte actifs pour cet élève (CAHIER_DE_TEXTES, NOTES, EDT…). */
  modules: string[];
}

export interface EdAccountInfo {
  edUserId: number;
  idLogin: number;
  type: 'famille' | 'eleve' | 'autre';
  main: boolean;
  students: EdStudentInfo[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number => { const n = typeof v === 'number' ? v : parseInt(str(v), 10); return Number.isFinite(n) ? n : 0; };
const enabledModules = (v: unknown): string[] => arr(v).map(obj).filter((m) => m['enable'] === true).map((m) => str(m['code'])).filter(Boolean);

export function parseAccounts(data: unknown): EdAccountInfo[] {
  return arr(obj(data)['accounts']).map(obj).map((a): EdAccountInfo => {
    const profile = obj(a['profile']);
    const idLogin = num(a['idLogin']) || num(a['id']);
    const school = str(a['nomEtablissement']);
    const type = str(a['typeCompte']);
    if (type === '1') {
      return {
        edUserId: num(a['id']), idLogin, type: 'famille', main: a['main'] === true,
        students: arr(profile['eleves']).map(obj).map((e) => ({
          edId: num(e['id']), idLogin,
          firstName: str(e['prenom']), lastName: str(e['nom']),
          className: str(obj(e['classe'])['libelle']),
          schoolName: str(e['nomEtablissement']) || school,
          modules: enabledModules(e['modules']),
        })).filter((e) => e.edId > 0),
      };
    }
    if (type === 'E') {
      return {
        edUserId: num(a['id']), idLogin, type: 'eleve', main: a['main'] === true,
        students: [{
          edId: num(a['id']), idLogin,
          firstName: str(a['prenom']), lastName: str(a['nom']),
          className: str(obj(profile['classe'])['libelle']),
          schoolName: school,
          modules: enabledModules(a['modules']),
        }],
      };
    }
    return { edUserId: num(a['id']), idLogin, type: 'autre', main: a['main'] === true, students: [] };
  });
}
