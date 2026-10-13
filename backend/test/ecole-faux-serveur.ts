// Un faux serveur ÉcoleDirecte, en local, qui rejoue les fixtures de
// test/fixtures/ecole. Il vérifie au passage ce que le vrai exige : cookie GTK
// renvoyé en `x-gtk`, version d'API, jeton qui tourne à chaque échange de la
// double authentification, appareil de confiance dans `fa`.
//
// Aucun test du module ne contacte ÉcoleDirecte : c'est ce serveur qu'ils
// joignent, par FOYER_ED_API_BASE ou par la configuration du client.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const FIX = path.join(__dirname, 'fixtures', 'ecole');
export const fixture = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf-8'));

/** Aujourd'hui à Paris, et un décalage en jours : les fixtures de données portent des dates relatives (« @J+1@ »). */
export const jourParis = (n = 0): string => {
  const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const d = new Date(t + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const datee = (name: string): any => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf-8').replace(/@J([+-]\d+)@/g, (_m, n: string) => jourParis(Number(n))));
type Resume = { idDevoir: number; effectue: boolean; [k: string]: unknown };
type Entree = { aFaire?: { idDevoir: number; effectue: boolean; contenu: string }; [k: string]: unknown };

export interface Requete {
  method: string; path: string; query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  /** Le JSON qui suit « data= », quand il y en a un. */
  data: Record<string, unknown> | null;
  raw: string;
}

/** Un compte du faux serveur : ses identifiants, sa réponse de connexion, et s'il exige la question de sécurité. */
export interface CompteFaux { motdepasse: string; reponse: string; qcm: boolean; }

export interface FauxEd {
  base: string;
  requetes: Requete[];
  comptes: Record<string, CompteFaux>;
  /** La version que le serveur accepte ; une autre reçoit 517. */
  version: string;
  /** Panne forcée, par identifiant : '500' (HTTP 500), '535', 'html' (page d'erreur au lieu de JSON). */
  panne: Record<string, '500' | '535' | 'html' | undefined>;
  /** La bonne réponse à la question de sécurité. */
  bonneReponse: string;
  /** Les connexions reçues pour un identifiant. */
  connexions: (identifiant: string) => Requete[];
  /** Le cahier de textes servi (liste, par date), modifiable par les tests. */
  cahier: Record<string, Resume[]>;
  /** Le détail des devoirs (énoncés), modifiable par les tests. */
  jour: Entree[];
  edt: Record<string, unknown>[];
  /** Élèves pour qui le serveur répond 210 (rien : vacances). */
  sansDonnees: Set<number>;
  /** Les requêtes de données reçoivent 520 (jeton refusé). */
  jetonRefuse: boolean;
  /** Les envois de « fait » échouent (HTTP 500). */
  envoiEnPanne: boolean;
  /** Les corps des envois de « fait » reçus. */
  faits: { eleve: number; faits: number[]; nonFaits: number[] }[];
  /** Les notes servies (`notes`, `periodes`), modifiables par les tests. */
  notes: { notes: Record<string, unknown>[]; periodes: Record<string, unknown>[] };
  /** La vie scolaire servie, modifiable par les tests. */
  vie: { absencesRetards: Record<string, unknown>[]; sanctionsEncouragements: Record<string, unknown>[] };
  /** Remplace l'énoncé d'un devoir (le professeur l'a modifié). */
  enonce: (idDevoir: number, html: string) => void;
  fermer: () => Promise<void>;
}

/**
 * Le décodage du serveur, indulgent comme lui : un « % » qui n'introduit pas
 * deux chiffres hexadécimaux reste tel quel (le client ne l'encode pas, comme
 * la bibliothèque de référence).
 */
const decode = (s: string): string => s.replace(/(?:%[0-9A-Fa-f]{2})+/g, (m) => { try { return decodeURIComponent(m); } catch { return m; } });

const TRUSTED = fixture('doubleauth-post.json')['data'] as { cn: string; cv: string };

export async function fauxEcoleDirecte(): Promise<FauxEd> {
  const etat: FauxEd = {
    base: '', requetes: [], panne: {}, version: '4.102.0', bonneReponse: 'SAINT-ÉTIENNE',
    comptes: {
      'parent.famille': { motdepasse: 'mot de passe & 100%', reponse: 'login-famille.json', qcm: true },
      'eleve.camille': { motdepasse: 'bon-mot-de-passe', reponse: 'login-eleve.json', qcm: false },
    },
    cahier: datee('cahierdetexte.json').data, jour: datee('cahierdetexte-jour.json').data.matieres, edt: datee('emploidutemps.json').data,
    notes: datee('notes.json').data, vie: datee('viescolaire.json').data,
    sansDonnees: new Set([3000002]), jetonRefuse: false, envoiEnPanne: false, faits: [],
    enonce: (idDevoir, html) => { const e = etat.jour.find((x) => x.aFaire?.idDevoir === idDevoir); if (e?.aFaire) e.aFaire.contenu = Buffer.from(html).toString('base64'); },
    connexions: (id) => etat.requetes.filter((r) => r.path === '/v3/login.awp' && r.method === 'POST'
      && decode(String(r.data?.['identifiant'] ?? '')) === id),
    fermer: async () => { await new Promise<void>((r) => server.close(() => r())); },
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://x');
      let data: Record<string, unknown> | null = null;
      if (raw.startsWith('data=')) { try { data = JSON.parse(raw.slice(5)); } catch { /* corps illisible */ } }
      etat.requetes.push({ method: req.method || '', path: url.pathname, query: url.searchParams, headers: req.headers, data, raw });

      const json = (body: unknown, headers: Record<string, string> = {}): void => {
        res.writeHead(200, { 'content-type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      };
      if (url.searchParams.get('v') !== etat.version) return json(fixture('code-517.json'));

      if (url.pathname === '/v3/login.awp' && req.method === 'GET') {
        res.writeHead(200, { 'set-cookie': ['GTK=gtk-123; Path=/; Secure', 'autre=1; Path=/'] });
        return res.end('');
      }
      if (url.pathname === '/v3/login.awp' && req.method === 'POST') {
        // Sans GTK, le vrai serveur répond « mot de passe incorrect ».
        if (req.headers['x-gtk'] !== 'gtk-123') return json(fixture('code-505.json'));
        const id = decode(String(data?.['identifiant'] ?? ''));
        const compte = etat.comptes[id];
        const panne = etat.panne[id];
        if (panne === '500') { res.writeHead(500); return res.end('Internal Server Error'); }
        if (panne === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>maintenance</html>'); }
        if (panne === '535') return json(fixture('code-535.json'));
        if (!compte || decode(String(data?.['motdepasse'] ?? '')) !== compte.motdepasse) return json(fixture('code-505.json'));
        const fa = Array.isArray(data?.['fa']) ? (data!['fa'] as { cn: string; cv: string }[])[0] : null;
        const connu = !!fa && fa.cn === TRUSTED.cn && fa.cv === TRUSTED.cv;
        if (compte.qcm && !connu) return json(fixture('login-250.json'), { 'x-token': 'tok-250', '2FA-Token': 'deux-fa' });
        return json(fixture(compte.reponse), { 'x-token': 'tok-ok' });
      }
      if (url.pathname === '/v3/connexion/doubleauth.awp') {
        const verbe = url.searchParams.get('verbe');
        if (verbe === 'get') {
          if (req.headers['x-token'] !== 'tok-250' || req.headers['2fa-token'] !== 'deux-fa') return json({ code: 520, message: 'Token invalide', data: {} });
          return json(fixture('doubleauth-get.json'), { 'x-token': 'tok-qcm' });
        }
        if (verbe === 'post') {
          // Le jeton a tourné après la question : l'ancien ne vaut plus.
          if (req.headers['x-token'] !== 'tok-qcm') return json({ code: 520, message: 'Token invalide', data: {} });
          const choix = Buffer.from(String(data?.['choix'] ?? ''), 'base64').toString('utf8');
          if (choix !== etat.bonneReponse) return json({ code: 516, message: 'Réponse incorrecte', data: {} });
          return json(fixture('doubleauth-post.json'), { 'x-token': 'tok-fa' });
        }
      }
      // ---- Données : session obligatoire ----
      const eleve = /^\/v3\/(?:Eleves|eleves|E)\/(\d+)\//.exec(url.pathname);
      if (eleve || url.pathname === '/v3/renewtoken.awp') {
        if (etat.jetonRefuse || req.headers['x-token'] !== 'tok-ok') return json(fixture('code-520.json'));
        if (url.pathname === '/v3/renewtoken.awp') return json({ code: 200, message: '', data: {} }, { 'x-token': 'tok-ok' });
        const id = Number(eleve![1]);
        const verbe = url.searchParams.get('verbe');
        if (/\/cahierdetexte\.awp$/.test(url.pathname) && verbe === 'put') {
          if (etat.envoiEnPanne) { res.writeHead(500); return res.end('Erreur'); }
          const faits = (data?.['idDevoirsEffectues'] as number[]) || [];
          const nonFaits = (data?.['idDevoirsNonEffectues'] as number[]) || [];
          etat.faits.push({ eleve: id, faits, nonFaits });
          for (const r of Object.values(etat.cahier).flat()) { if (faits.includes(r.idDevoir)) r.effectue = true; if (nonFaits.includes(r.idDevoir)) r.effectue = false; }
          return json({ code: 200, message: '', data: {} });
        }
        if (etat.sansDonnees.has(id)) return json(fixture('code-210.json'));
        if (/\/cahierdetexte\.awp$/.test(url.pathname)) return json({ code: 200, message: '', data: etat.cahier });
        if (/\/notes\.awp$/.test(url.pathname)) return json({ code: 200, message: '', data: etat.notes });
        if (/\/viescolaire\.awp$/.test(url.pathname)) return json({ code: 200, message: '', data: etat.vie });
        const jour = /\/cahierdetexte\/(\d{4}-\d{2}-\d{2})\.awp$/.exec(url.pathname);
        if (jour) {
          const ids = new Set((etat.cahier[jour[1]] || []).map((r) => r.idDevoir));
          const effectue = new Map(Object.values(etat.cahier).flat().map((r) => [r.idDevoir, r.effectue]));
          const matieres = etat.jour.filter((e) => !e.aFaire || ids.has(e.aFaire.idDevoir))
            .map((e) => (e.aFaire ? { ...e, aFaire: { ...e.aFaire, effectue: effectue.get(e.aFaire.idDevoir) ?? false } } : e));
          return json({ code: 200, message: '', data: { date: jour[1], matieres } });
        }
        if (/\/emploidutemps\.awp$/.test(url.pathname)) {
          const from = String(data?.['dateDebut'] ?? ''), to = String(data?.['dateFin'] ?? '');
          return json({ code: 200, message: '', data: etat.edt.filter((l) => { const d = String(l['start_date']).slice(0, 10); return d >= from && d <= to; }) });
        }
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  etat.base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return etat;
}
