// Recalcul de la maîtrise du module Tables, depuis les réponses enregistrées.
//
//   Docker : docker compose exec foyer npm run tables:recalcul -- --membre m2
//   LXC    : runuser -u foyer -- node /opt/foyer/backend/dist/tables/recalcul.js --env - --membre m2 < /etc/foyer/foyer.env
//
// Options :
//   --membre <id>        le membre à recalculer (identifiant de sa fiche, ex. m2)
//   --tous               tous les membres qui ont des réponses
//   --reclasser          refait d'abord « bonne » ou « lente » de chaque réponse juste,
//                        avec le barème et le programme d'aujourd'hui : c'est le seul
//                        geste qui réécrit le passé, il est donc explicite et journalisé
//   --env <fichier|->    lit les variables KEY=VALUE d'un fichier (ou de l'entrée standard)
//
// Sans --reclasser, rien du passé ne change : la grille est reconstruite depuis les
// résultats stockés, ce qui répare une table de maîtrise abîmée ou rattrape un
// changement des règles de maîtrise (espacement, seuils) du barème. Le service
// peut tourner pendant ce temps : tout se fait dans une transaction.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrateTables } from './schema';
import { SessionRow, initTablesRepo, membersWithAnswers, programById, recomputeMember } from './repo';
import { bareme, timingFor } from './bareme';

const args = process.argv.slice(2);
const opt = (name: string): string | null => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] ?? '' : null; };
const say = (s = ''): void => { process.stdout.write(s + '\n'); };
const die = (code: number, s: string): never => { process.stderr.write('ERREUR : ' + s + '\n'); process.exit(code); };

/** KEY=VALUE, une par ligne, guillemets facultatifs, commentaires ignorés. */
function loadEnv(source: string): void {
  const text = fs.readFileSync(source === '-' ? 0 : source, 'utf-8');
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = opt('env');
if (env !== null) loadEnv(env || '-');
const DATA_DIR = process.env.FOYER_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_PATH = process.env.FOYER_DB_PATH || path.join(DATA_DIR, 'foyer.db');
if (!fs.existsSync(DB_PATH)) die(2, `base introuvable : ${DB_PATH} (FOYER_DATA_DIR ou FOYER_DB_PATH, ou --env /etc/foyer/foyer.env).`);

const db = new Database(DB_PATH);
db.pragma('busy_timeout = 5000');
migrateTables(db);
initTablesRepo(db);

const household = db.prepare('SELECT state FROM household WHERE id = 1').get() as { state: string } | undefined;
const members = (household ? (JSON.parse(household.state) as { members?: { id: string; name: string; birthday?: string | null; enfant?: boolean }[] }).members : []) ?? [];
const who = opt('membre');
const targets = args.includes('--tous') ? membersWithAnswers() : who ? [who] : die(1, 'précisez --membre <id> ou --tous.');
const reclasser = args.includes('--reclasser');
if (!targets.length) say('Aucune réponse enregistrée : rien à recalculer.');
const b = bareme(DATA_DIR);

for (const id of targets) {
  const m = members.find((x) => x.id === id);
  if (!m && !membersWithAnswers().includes(id)) { say(`${id} : aucun membre ni aucune réponse sous cet identifiant.`); continue; }
  const parisDay = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
  const fastOf = (s: SessionRow): number => {
    const p = s.program_id !== null ? programById(s.program_id) : null;
    return timingFor(b, m ?? {}, parisDay(s.started_at), p && { secondsAllowed: p.seconds_allowed, fastSeconds: p.fast_seconds }).fastMs;
  };
  const out = recomputeMember(id, b.maitrise, reclasser ? fastOf : undefined);
  const line = `${m?.name ?? id} (${id}) : ${out.pairs} opération(s) recalculée(s)` + (reclasser ? `, ${out.reclassified} réponse(s) reclassée(s) avec le barème actuel` : '');
  say(line);
  // Le même compte rendu au journal du service, quand on le lance à côté de lui.
  process.stderr.write(`[foyer] Tables : recalcul ${reclasser ? 'avec reclassement ' : ''}lancé à la main : ${line}\n`);
}
db.close();
