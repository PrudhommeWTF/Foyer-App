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
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  etat.base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return etat;
}
