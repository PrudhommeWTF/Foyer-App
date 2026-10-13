// Client HTTP de l'API JSON d'ÉcoleDirecte : connexion, cookie GTK, question de
// sécurité (QCM), jeton de session.
//
// L'API n'est pas publique. Ce qui suit est la lecture de deux sources, à
// relire quand elle change :
//   - la bibliothèque Python `ecoledirecte` (dépôt hacf-fr/ecoledirecte_api,
//     `src/ecoledirecte_api/client.py` et `const.py`, version 0.4.0 du
//     11/10/2026), utilisée par l'intégration Home Assistant
//     hacf-fr/hass-ecoledirecte ;
//   - la documentation communautaire EduWireApps/ecoledirecte-api-docs.
// Aucun code n'en est repris : seulement les chemins, les corps et les en-têtes.
//
// Le flux, tel qu'implémenté :
//   1. GET  /v3/login.awp?gtk=1&v=<version> : le serveur pose le cookie GTK,
//      qu'on renvoie en en-tête `x-gtk` (et en cookie) à la connexion ;
//   2. POST /v3/login.awp?v=<version>, corps brut `data=<JSON>` :
//        sans appareil connu : { identifiant, motdepasse, isReLogin: false }
//        avec appareil connu : les mêmes + cn, cv au premier niveau,
//                              uuid: "" et fa: [{ cn, cv }]
//      identifiant et mot de passe sont encodés « façon URL » DANS le JSON ;
//   3. le jeton arrive dans l'en-tête de réponse `x-token` (repli : champ
//      `token` du JSON) et repart tel quel en en-tête `x-token`. Il change à
//      chaque échange de la double authentification. Depuis août 2026, un
//      en-tête `2FA-Token` peut aussi arriver : il repart tel quel ;
//   4. code 250 : POST /v3/connexion/doubleauth.awp?verbe=get (corps data={})
//      rend la question et les propositions en base64 ; ?verbe=post avec
//      data={"choix": "<base64 du texte choisi>"} rend cn et cv, l'appareil de
//      confiance, à garder et à renvoyer à chaque connexion suivante.
//
// Ce dossier ne dépend de rien d'autre dans Foyer. Ni base, ni réglage, ni
// journal : la configuration arrive par le constructeur, et c'est l'appelant
// qui décide quoi écrire où. Jamais un identifiant, un mot de passe, un jeton,
// cn ni cv dans un message d'erreur.
import { EdAccountInfo, parseAccounts } from './accounts';
import { EdAverage, EdGrade, EdHomeworkDetail, EdHomeworkSummary, EdLesson, EdLifeItem, parseGrades, parseHomeworkDay, parseHomeworkList, parseLife, parseTimetable } from './data';
import { EdError, errorOfCode } from './errors';

export interface EdConfig {
  /** Racine de l'API, sans le `/v3` : https://api.ecoledirecte.com. */
  base: string;
  /** La version d'API annoncée dans `v=` ; trop ancienne, le serveur répond 517. */
  version: string;
  /** Le jeton est lié au User-Agent qui l'a obtenu : il ne change jamais en cours de session. */
  userAgent: string;
  /** Le site dont l'application web se réclame (en-têtes Origin et Referer). */
  origin: string;
  timeoutMs?: number;
  /** Remplaçable pour les tests, qui ne font jamais d'appel réseau. */
  fetch?: typeof fetch;
  /** Chaque échange, pour la sonde de diagnostic. Jamais branché en service. */
  trace?: (ex: EdExchange) => void;
}

export interface EdExchange {
  step: string; method: string; path: string;
  httpStatus: number | null; code: number | null; durationMs: number;
  /** En-têtes de réponse reçus (noms seulement : leurs valeurs portent le jeton). */
  headerNames: string[];
  body: unknown;
}

/** L'appareil de confiance obtenu en répondant à la question de sécurité. */
export interface Trusted { cn: string; cv: string; }

/** Une session en cours : jeton, en-tête 2FA, cookies. Opaque pour l'appelant. */
export class EdSession {
  token = '';
  twoFa = '';
  gtk = '';
  readonly cookies = new Map<string, string>();
}

export type LoginOutcome =
  | { kind: 'ok'; accounts: EdAccountInfo[]; session: EdSession }
  | { kind: 'qcm'; question: string; propositions: string[]; challenge: EdSession };

/**
 * L'encodage des identifiants que fait la bibliothèque de référence :
 * `urllib.parse.quote(s, safe="~()*!.'%\\")`. Comme `encodeURIComponent`, sauf
 * que `%` et la barre oblique inverse restent tels quels.
 */
export const encodeCredential = (s: string): string =>
  encodeURIComponent(s).replace(/%25/g, '%').replace(/%5C/gi, '\\');

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s: unknown): string => (typeof s === 'string' ? Buffer.from(s, 'base64').toString('utf8') : '');

interface Reply { status: number; json: Record<string, unknown>; code: number; }

export class EdClient {
  constructor(private readonly cfg: EdConfig) {}

  /**
   * Se connecte. Rend les comptes, ou la question de sécurité quand le serveur
   * l'exige (code 250) : l'appelant la montre à un humain et ne retente rien
   * tout seul. Toute autre issue est une `EdError`.
   */
  async login(identifiant: string, motdepasse: string, trusted?: Trusted | null): Promise<LoginOutcome> {
    const s = new EdSession();
    // Une version d'API refusée l'est dès cette première requête (517 en JSON,
    // sans cookie) : le dire tel quel plutôt qu'un « GTK absent » trompeur.
    const g = await this.call(s, 'gtk', 'GET', '/login.awp?gtk=1');
    if (g.code !== 200 && g.code !== 210) throw this.fail(g);
    s.gtk = s.cookies.get('GTK') || '';
    if (!s.gtk) throw new EdError('gtk', 'ÉcoleDirecte n’a pas fourni le cookie GTK : le flux de connexion a peut-être changé (voir docs/ecole.md).');

    const payload: Record<string, unknown> = { identifiant: encodeCredential(identifiant), motdepasse: encodeCredential(motdepasse), isReLogin: false };
    if (trusted) Object.assign(payload, { cn: trusted.cn, cv: trusted.cv, uuid: '', fa: [{ cn: trusted.cn, cv: trusted.cv }] });
    const r = await this.call(s, 'connexion', 'POST', '/login.awp', payload);
    if (!s.token && typeof r.json['token'] === 'string') s.token = r.json['token'];
    // Le GTK ne sert qu'à la connexion : la bibliothèque de référence le retire ensuite.
    s.gtk = '';

    if (r.code === 200) return { kind: 'ok', accounts: parseAccounts(r.json['data']), session: s };
    if (r.code !== 250) throw this.fail(r);

    const q = await this.call(s, 'qcm-question', 'POST', '/connexion/doubleauth.awp?verbe=get', {});
    if (q.code !== 200) throw this.fail(q);
    const data = (q.json['data'] || {}) as Record<string, unknown>;
    const question = unb64(data['question']);
    const propositions = (Array.isArray(data['propositions']) ? data['propositions'] : []).map(unb64).filter(Boolean);
    if (!question || !propositions.length) throw new EdError('inattendu', 'ÉcoleDirecte demande la question de sécurité mais n’en a pas fourni le texte.', q.code, q.status);
    return { kind: 'qcm', question, propositions, challenge: s };
  }

  /**
   * Répond à la question de sécurité avec le texte d'une des propositions. Rend
   * l'appareil de confiance ; l'appelant le garde et se reconnecte avec.
   */
  async answerQcm(challenge: EdSession, choice: string): Promise<Trusted> {
    const r = await this.call(challenge, 'qcm-reponse', 'POST', '/connexion/doubleauth.awp?verbe=post', { choix: b64(choice) });
    if (r.code !== 200) throw this.fail(r);
    const data = (r.json['data'] || {}) as Record<string, unknown>;
    const cn = typeof data['cn'] === 'string' ? data['cn'] : '';
    const cv = typeof data['cv'] === 'string' ? data['cv'] : '';
    if (!cn || !cv) throw new EdError('inattendu', 'ÉcoleDirecte a accepté la réponse sans rendre d’appareil de confiance.', r.code, r.status);
    return { cn, cv };
  }

  // ---- Données (session ouverte par `login`) ------------------------------

  /**
   * Passe la session sur un autre compte rattaché (parents dont les enfants
   * sont dans deux établissements). Chemin et corps : `renewtoken.awp`, comme
   * l'intégration Home Assistant.
   */
  async switchAccount(s: EdSession, idLogin: number): Promise<void> {
    await this.data(s, 'changement-compte', '/renewtoken.awp?verbe=post', { idUser: idLogin, uuid: '' });
  }

  /** Les devoirs à venir, sans leur énoncé : une ligne par devoir, avec sa date de rendu. */
  async homeworkList(s: EdSession, studentId: number): Promise<EdHomeworkSummary[]> {
    return parseHomeworkList(await this.data(s, 'cahier-de-textes', `/Eleves/${studentId}/cahierdetexte.awp?verbe=get`, {}));
  }

  /** Le détail d'un jour : l'énoncé (HTML), le professeur. */
  async homeworkDay(s: EdSession, studentId: number, day: string): Promise<EdHomeworkDetail[]> {
    return parseHomeworkDay(await this.data(s, 'cahier-de-textes-jour', `/Eleves/${studentId}/cahierdetexte/${day}.awp?verbe=get`, {}), day);
  }

  /** Marque des devoirs faits, ou défaits, chez ÉcoleDirecte. */
  async setHomeworkDone(s: EdSession, studentId: number, done: number[], notDone: number[]): Promise<void> {
    await this.data(s, 'devoirs-faits', `/Eleves/${studentId}/cahierdetexte.awp?verbe=put`, { idDevoirsEffectues: done, idDevoirsNonEffectues: notDone });
  }

  /** Les cours entre deux dates incluses (AAAA-MM-JJ). */
  async timetable(s: EdSession, studentId: number, from: string, to: string): Promise<EdLesson[]> {
    return parseTimetable(await this.data(s, 'emploi-du-temps', `/E/${studentId}/emploidutemps.awp?verbe=get`, { dateDebut: from, dateFin: to, avecTrous: false }));
  }

  /** Les notes et les moyennes d'une année scolaire (« 2026-2027 »). */
  async grades(s: EdSession, studentId: number, schoolYear: string): Promise<{ grades: EdGrade[]; averages: EdAverage[] }> {
    return parseGrades(await this.data(s, 'notes', `/eleves/${studentId}/notes.awp?verbe=get`, { anneeScolaire: schoolYear }));
  }

  /** Absences, retards, sanctions et encouragements. */
  async schoolLife(s: EdSession, studentId: number): Promise<EdLifeItem[]> {
    return parseLife(await this.data(s, 'vie-scolaire', `/eleves/${studentId}/viescolaire.awp?verbe=get`, {}));
  }

  /** Un échange de données : 200 rend `data`, 210 (rien, vacances) rend un vide, le reste est une erreur. */
  private async data(s: EdSession, step: string, path: string, body: unknown): Promise<unknown> {
    const r = await this.call(s, step, 'POST', path, body);
    if (r.code === 210) return {};
    if (r.code !== 200) throw this.fail(r);
    return r.json['data'];
  }

  private fail(r: Reply): EdError {
    return errorOfCode(r.code, typeof r.json['message'] === 'string' ? r.json['message'] : '', r.status, this.cfg.version);
  }

  /** Un échange : en-têtes de navigateur, jeton, cookies, et la réponse lue comme JSON. */
  private async call(s: EdSession, step: string, method: 'GET' | 'POST', path: string, data?: unknown): Promise<Reply> {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${this.cfg.base.replace(/\/+$/, '')}/v3${path}${sep}v=${encodeURIComponent(this.cfg.version)}`;
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'fr-FR,fr;q=0.9',
      'content-type': 'application/x-www-form-urlencoded',
      origin: this.cfg.origin,
      referer: this.cfg.origin.replace(/\/+$/, '') + '/',
      'user-agent': this.cfg.userAgent,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
    };
    if (s.gtk) headers['x-gtk'] = s.gtk;
    if (s.token) headers['x-token'] = s.token;
    if (s.twoFa) headers['2fa-token'] = s.twoFa;
    if (s.cookies.size) headers['cookie'] = [...s.cookies].map(([k, v]) => `${k}=${v}`).join('; ');

    const t0 = Date.now();
    const pathOnly = path.split('?')[0];
    let res: Response;
    try {
      res = await (this.cfg.fetch || fetch)(url, {
        method, headers,
        // Corps brut, comme l'application web : « data= » suivi du JSON, non encodé.
        body: method === 'POST' ? 'data=' + JSON.stringify(data ?? {}) : undefined,
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000),
      });
    } catch (e) {
      const err = e as Error;
      const why = err.name === 'TimeoutError' ? 'délai dépassé' : (((err as Error & { cause?: Error }).cause)?.message || err.message);
      this.cfg.trace?.({ step, method, path: pathOnly, httpStatus: null, code: null, durationMs: Date.now() - t0, headerNames: [], body: null });
      throw new EdError('indisponible', `ÉcoleDirecte injoignable (${why}).`);
    }

    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) s.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const token = res.headers.get('x-token');
    if (token) s.token = token;
    const twoFa = res.headers.get('2fa-token');
    if (twoFa) s.twoFa = twoFa;

    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try { const p = JSON.parse(text); if (p && typeof p === 'object' && !Array.isArray(p)) json = p; } catch { /* pas du JSON */ }
    const code = json && typeof json['code'] === 'number' ? json['code'] : json ? parseInt(String(json['code'] ?? ''), 10) || null : null;
    this.cfg.trace?.({ step, method, path: pathOnly, httpStatus: res.status, code, durationMs: Date.now() - t0, headerNames: [...res.headers.keys()], body: json ?? text.slice(0, 500) });

    // La requête GTK ne rend rien d'utile dans son corps : seul le cookie compte.
    if (step === 'gtk' && res.status < 500) return { status: res.status, json: json || {}, code: json && code !== null ? code : 200 };
    if (res.status >= 500) throw new EdError('indisponible', `ÉcoleDirecte indisponible (HTTP ${res.status}).`, code, res.status);
    if (!json || code === null) throw new EdError('indisponible', `Réponse illisible d’ÉcoleDirecte (HTTP ${res.status}, pas du JSON attendu).`, null, res.status);
    return { status: res.status, json, code };
  }
}
