// Sonde ÉcoleDirecte : une vraie connexion, hors service et hors CI, pour voir
// ce que le serveur répond quand quelque chose a changé (code 517, champ
// renommé, nouvelle étape de connexion).
//
//   Docker : docker compose exec foyer npm run ecole:sonde -- --compte 1
//   LXC    : runuser -u foyer -- node /opt/foyer/backend/dist/ecole/sonde.js --env - --compte 1 < /etc/foyer/foyer.env
//
// Options :
//   --liste              les comptes enregistrés, sans aucune requête
//   --compte <id>        se connecte avec ce compte (identifiants et appareil de confiance en base)
//   --fixtures <dossier> écrit chaque réponse (connexion, cahier de textes, un jour de
//                        détail, emploi du temps), anonymisée, pour régénérer test/fixtures/ecole
//   --env <fichier|->    lit les variables KEY=VALUE d'un fichier (ou de l'entrée standard)
//
// La sonde ouvre la base en lecture seule et ne répond jamais à la question de
// sécurité : elle l'affiche, et c'est Paramètres → École qui y répond. Chaque
// lancement compte comme une connexion pour ÉcoleDirecte : ne pas la lancer en
// boucle. Le jeton, l'identifiant, le mot de passe, cn et cv ne sont jamais
// affichés.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { EdClient, EdError, EdExchange } from './client';
import { open } from '../storage/secret-box';
import { edConfig } from './config';

const args = process.argv.slice(2);
const opt = (name: string): string | null => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] ?? '' : null; };
const say = (s = ''): void => { process.stdout.write(s + '\n'); };
const die = (code: number, s: string): never => { process.stderr.write('ERREUR : ' + s + '\n'); process.exit(code); };

/** KEY=VALUE, une par ligne, guillemets facultatifs, commentaires ignorés. */
function loadEnv(source: string): void {
  const text = fs.readFileSync(source === '-' ? 0 : source, 'utf-8');
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// Ce qui identifie une personne ou une session. Les identifiants numériques sont
// remplacés de façon cohérente (le même id donne le même faux id), pour que la
// fixture garde ses liens internes.
const PERSONAL = new Set(['prenom', 'nom', 'particule', 'email', 'identifiant', 'uid', 'nomEtablissement', 'codeOgec', 'logoEtablissement',
  'photo', 'token', 'accessToken', 'access_token', 'socketToken', 'cn', 'cv', 'telPortable', 'telPortableConjoint', 'adresse', 'lastConnexion',
  'nomProf', 'prof', 'commentaire', 'libelle', 'motif', 'par']);
const IDS = new Set(['id', 'idLogin', 'idEleve', 'idEtablissement', 'idReelEtab', 'idUser']);
const fakeIds = new Map<string, number>();
function anonymize(v: unknown, key = ''): unknown {
  if (Array.isArray(v)) return v.map((x) => anonymize(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, anonymize(x, k)]));
  if (key === 'question') return Buffer.from('Question anonymisée ?').toString('base64');
  if (key === 'propositions') return Buffer.from('PROPOSITION').toString('base64');
  // Un énoncé peut citer un nom : remplacé, sa forme (HTML en base64) gardée.
  if (key === 'contenu' && typeof v === 'string' && v) return Buffer.from('<p>Énoncé anonymisé, <a href="https://exemple.fr">lien</a></p>').toString('base64');
  if (IDS.has(key) && (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))) {
    const k = String(v);
    if (!fakeIds.has(k)) fakeIds.set(k, 1000000 + fakeIds.size + 1);
    return typeof v === 'number' ? fakeIds.get(k) : String(fakeIds.get(k));
  }
  if (PERSONAL.has(key) && typeof v === 'string' && v) return 'ANONYME';
  return v;
}

async function main(): Promise<void> {
  const envFile = opt('env');
  if (envFile) loadEnv(envFile);
  const dataDir = process.env.FOYER_DATA_DIR || path.join(__dirname, '..', '..', 'data');
  const dbPath = process.env.FOYER_DB_PATH || path.join(dataDir, 'foyer.db');
  if (!fs.existsSync(dbPath)) die(2, `base introuvable : ${dbPath} (FOYER_DATA_DIR ou FOYER_DB_PATH).`);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  if (args.includes('--liste')) {
    const rows = db.prepare('SELECT id, label, blocked, last_ok_at, last_error_code FROM ed_accounts WHERE archived_at IS NULL ORDER BY id').all() as Record<string, unknown>[];
    if (!rows.length) say('Aucun compte ÉcoleDirecte enregistré.');
    for (const r of rows) say(`${r['id']}\t${r['label']}\tbloqué: ${r['blocked'] ?? 'non'}\tdernière réussite: ${r['last_ok_at'] ?? 'jamais'}\tdernier code: ${r['last_error_code'] ?? '-'}`);
    return;
  }

  const id = parseInt(opt('compte') || '', 10);
  if (!Number.isInteger(id)) die(2, 'précisez --compte <id> (voir --liste).');
  const row = db.prepare('SELECT * FROM ed_accounts WHERE id = ? AND archived_at IS NULL').get(id) as Record<string, string | null> | undefined;
  if (!row) die(2, `compte ${id} introuvable.`);
  const login = open(row!['login_enc']), password = open(row!['password_enc']);
  if (login === null || password === null) die(2, 'identifiants illisibles : FOYER_SECRET_KEY absente ou différente de celle qui les a chiffrés.');
  const cn = open(row!['trusted_cn_enc']), cv = open(row!['trusted_cv_enc']);

  const fixtures = opt('fixtures');
  if (fixtures) fs.mkdirSync(fixtures, { recursive: true });
  const cfg = edConfig();
  say(`Sonde ÉcoleDirecte : compte ${id} « ${row!['label']} », ${cfg.base}, version ${cfg.version}, appareil de confiance ${cn && cv ? 'connu' : 'inconnu'}.`);
  say('Une vraie connexion part maintenant.');
  say();

  const trace = (ex: EdExchange): void => {
    say(`${ex.method} ${ex.path}  HTTP ${ex.httpStatus ?? '-'}  code ${ex.code ?? '-'}  ${ex.durationMs} ms`);
    say(`  en-têtes reçus : ${ex.headerNames.join(', ') || '(aucun)'}`);
    if (fixtures && ex.body && typeof ex.body === 'object') {
      const file = path.join(fixtures, `${ex.step}.json`);
      fs.writeFileSync(file, JSON.stringify(anonymize(ex.body), null, 2) + '\n');
      say(`  réponse anonymisée : ${file}`);
    }
  };
  const client = new EdClient({ ...cfg, trace });
  try {
    const out = await client.login(login!, password!, cn && cv ? { cn, cv } : null);
    say();
    if (out.kind === 'qcm') {
      say('ÉcoleDirecte demande la question de sécurité :');
      say('  ' + out.question);
      out.propositions.forEach((p, i) => say(`  ${i + 1}. ${p}`));
      say('La sonde ne répond pas : répondez dans Paramètres → École.');
      return;
    }
    say(`Connexion réussie : ${out.accounts.length} compte(s).`);
    for (const a of out.accounts) {
      say(`  compte ${a.type}${a.main ? ' (principal)' : ''}, ${a.students.length} élève(s)`);
      for (const e of a.students) say(`    ${e.firstName} · ${e.className || 'classe ?'} · ${e.schoolName || 'établissement ?'} · modules : ${e.modules.join(', ') || 'aucun'}`);
    }
    // Les données du premier élève : de quoi voir si le cahier de textes ou
    // l'emploi du temps ont changé de forme. Lecture seule.
    const main = out.accounts.find((x) => x.main) || out.accounts[0];
    const st = out.accounts.flatMap((x) => x.students)[0];
    if (st) {
      say();
      say(`Données de ${st.firstName} (lecture seule) :`);
      if (st.idLogin && st.idLogin !== main?.idLogin) await client.switchAccount(out.session, st.idLogin);
      const devoirs = await client.homeworkList(out.session, st.edId);
      say(`  cahier de textes : ${devoirs.length} devoir(s) à venir`);
      const jour = devoirs.map((d) => d.due).sort()[0];
      if (jour) {
        const detail = await client.homeworkDay(out.session, st.edId, jour);
        say(`  détail du ${jour} : ${detail.length} devoir(s), énoncés de ${detail.map((d) => d.html.length).join(', ') || '0'} caractère(s) HTML`);
      }
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
      const fin = new Date(today + 'T12:00:00Z'); fin.setUTCDate(fin.getUTCDate() + 6);
      const cours = await client.timetable(out.session, st.edId, today, fin.toISOString().slice(0, 10));
      say(`  emploi du temps (7 jours) : ${cours.length} cours, dont ${cours.filter((c) => c.cancelled).length} annulé(s)`);
      if (!st.modules.length || st.modules.includes('NOTES')) {
        const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
        const n = await client.grades(out.session, st.edId, m >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`);
        say(`  notes : ${n.grades.length} note(s), ${n.averages.length} moyenne(s) renvoyée(s)`);
      }
      if (!st.modules.length || st.modules.includes('VIE_SCOLAIRE')) {
        const v = await client.schoolLife(out.session, st.edId);
        say(`  vie scolaire : ${v.length} ligne(s) (${['absence', 'retard', 'sanction', 'encouragement'].map((k) => v.filter((e) => e.kind === k).length + ' ' + k).join(', ')})`);
      }
    }
  } catch (e) {
    if (e instanceof EdError) die(1, `${e.message} [famille : ${e.kind}, code ${e.code ?? '-'}, HTTP ${e.httpStatus ?? '-'}]`);
    throw e;
  }
}

main().catch((e) => die(1, (e as Error).message));
