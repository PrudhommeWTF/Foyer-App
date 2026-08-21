// Migrations du document d'état.
//
// Le document JSON du foyer change de forme au fil des tranches. Ces
// transformations sont versionnées et appliquées au démarrage, dans l'ordre, la
// version atteinte étant retenue dans `hh_meta.state_version`. Un second
// démarrage ne fait rien.
//
// Trois règles tenues par tout ce fichier :
//
//   - **Rejouable.** Chaque migration ne réagit qu'à l'ancienne forme. La
//     relancer sur des données déjà migrées ne fait rien, ce qui compte le jour
//     où une restauration ramène un document à moitié converti.
//   - **Réversible.** Le document d'origine est écrit sur le disque avant la
//     première migration en attente. Revenir en arrière, c'est remettre ce
//     fichier en base : la procédure est dans docs/cuisine-architecture.md.
//   - **Sans perte.** Une valeur qui n'a pas pu être convertie est conservée
//     telle quelle plutôt que remplacée par un défaut. Rien n'est supprimé en
//     silence.
import fs from 'fs';
import path from 'path';
import { DetectedType, detectType } from '../storage/blobs';

/** Version cible du document. À incrémenter en ajoutant une migration. */
export const STATE_VERSION = 4;

/** Le document est manipulé sans typage : ces migrations voient l'ancienne forme. */
type Doc = Record<string, any>;

export interface MigrationCtx {
  /**
   * Range une image encodée en data-URL et rend son identifiant, ou null quand
   * le contenu est illisible. L'appelant décide alors quoi faire, il n'invente rien.
   */
  storeDataUrl(ownerId: string, name: string, dataUrl: string): number | null;
  log(message: string): void;
}

export interface StateMigration {
  version: number;
  label: string;
  up: (doc: Doc, ctx: MigrationCtx) => void;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

export const STATE_MIGRATIONS: StateMigration[] = [
  {
    version: 1,
    label: 'photos de recettes rangées sur le disque',
    up: (doc, ctx) => {
      let moved = 0;
      let failed = 0;
      for (const r of arr(doc['recipes'])) {
        // `photo` disparaît du modèle, mais seulement une fois ses octets rangés.
        const photo = r['photo'];
        if (typeof photo !== 'string' || !photo.startsWith('data:')) {
          // Rien à convertir : soit déjà migré, soit jamais de photo. On retire
          // simplement la clé vide héritée.
          if ('photo' in r) delete r['photo'];
          continue;
        }
        const id = ctx.storeDataUrl(String(r['id'] ?? ''), String(r['name'] ?? 'photo'), photo);
        if (id == null) {
          // Illisible : la data-URL reste en place. Une photo qu'on ne sait pas
          // décoder est un problème à signaler, pas à effacer.
          failed++;
          continue;
        }
        r['photoId'] = id;
        delete r['photo'];
        moved++;
      }
      if (moved) ctx.log(`${moved} photo(s) de recette déplacée(s) hors du document.`);
      if (failed) {
        ctx.log(
          `${failed} photo(s) de recette illisible(s) : elles restent dans le document en l'état. ` +
          'Rouvrez la recette et reposez la photo pour la ranger sur le disque.',
        );
      }
    },
  },
  {
    version: 2,
    label: 'liste de courses : rayon par identifiant et état à trois valeurs',
    up: (doc, ctx) => {
      const aisles = arr(doc['aisles']);

      // Un rayon a désormais un rang, qui donne l'ordre de parcours du magasin.
      aisles.forEach((a, i) => { if (typeof a['position'] !== 'number') a['position'] = i; });

      // `cat` portait le NOM du rayon. Un nom qui ne correspond à aucun rayon
      // existant produisait un groupe fantôme, ni renommable ni supprimable :
      // on crée le rayon manquant plutôt que de reclasser l'article ailleurs.
      const byName = new Map<string, string>(aisles.map((a) => [String(a['name']), String(a['id'])]));
      const created: string[] = [];
      const ensure = (name: string): string => {
        const known = byName.get(name);
        if (known) return known;
        const id = 'a' + (aisles.length + 1) + '-' + Math.abs([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
        aisles.push({ id, name, color: '#8A7E74', position: aisles.length });
        byName.set(name, id);
        created.push(name);
        return id;
      };
      const fallback = (): string => ensure('À trier');

      for (const it of arr(doc['shop'])) {
        if (typeof it['aisleId'] !== 'string' || !it['aisleId']) {
          const name = typeof it['cat'] === 'string' && it['cat'].trim() ? it['cat'].trim() : '';
          it['aisleId'] = name ? ensure(name) : fallback();
        }
        delete it['cat'];

        // `done` devient un état à trois valeurs : « indisponible » n'existait pas,
        // aucun article ne peut donc l'avoir aujourd'hui.
        if (typeof it['state'] !== 'string') it['state'] = it['done'] === true ? 'panier' : 'a-prendre';
        delete it['done'];
      }
      doc['aisles'] = aisles;
      if (created.length) ctx.log(`Rayon(s) recréé(s) depuis des articles orphelins : ${created.join(', ')}.`);
    },
  },
  {
    version: 3,
    label: 'recettes : portions et temps séparés',
    up: (doc, ctx) => {
      let lus = 0;
      let illisibles = 0;
      for (const r of arr(doc['recipes'])) {
        if (!('time' in r)) continue;
        // `time` était un texte libre unique, sans dire s'il valait la
        // préparation, la cuisson ou le total. Il est repris en préparation,
        // seule lecture qui ne fabrique pas une cuisson qui n'a jamais existé.
        if (typeof r['prepMin'] !== 'number') {
          const min = parseFrenchDuration(r['time']);
          if (min != null) { r['prepMin'] = min; lus++; }
          else if (String(r['time'] ?? '').trim() && String(r['time']).trim() !== '—') illisibles++;
        }
        delete r['time'];
      }
      if (lus) ctx.log(`${lus} durée(s) de recette reprise(s) en temps de préparation.`);
      if (illisibles) {
        ctx.log(
          `${illisibles} durée(s) de recette illisible(s) et donc laissée(s) vides : ` +
          'rouvrez ces fiches pour saisir les minutes de préparation et de cuisson.',
        );
      }
    },
  },
  {
    version: 4,
    label: 'planning des repas : plusieurs plats par créneau',
    up: (doc, ctx) => {
      const meals = doc['meals'];
      if (!meals || typeof meals !== 'object' || Array.isArray(meals)) return;
      let convertis = 0;
      for (const [key, brut] of Object.entries(meals as Record<string, any>)) {
        if (!brut || typeof brut !== 'object') { meals[key] = { items: [] }; continue; }
        if (Array.isArray(brut['items'])) continue;  // déjà migré
        // Le plat unique du créneau devient le premier de la liste. Un créneau
        // qui ne portait ni recette ni texte ne portait rien : la liste est vide,
        // ce que l'écran affiche déjà comme « Libre ».
        const item = brut['rid'] ? { rid: String(brut['rid']) }
          : brut['text'] ? { text: String(brut['text']) }
          : null;
        meals[key] = { items: item ? [item] : [] };
        if (item) convertis++;
      }
      if (convertis) ctx.log(`${convertis} repas repris comme premier plat de leur créneau.`);
    },
  },
];

/**
 * Durée écrite à la française vers minutes : « 45 min », « 1 h 30 », « 1h30 »,
 * « 2 heures », « 30 ». Rend null sur ce qu'on ne sait pas lire, plutôt qu'un
 * zéro qui se ferait passer pour une vraie valeur.
 */
export function parseFrenchDuration(value: unknown): number | null {
  const s = String(value ?? '').toLowerCase().replace(',', '.').trim();
  if (!s) return null;
  const hm = /^(\d+(?:\.\d+)?)\s*(?:h|heures?)\s*(\d{1,2})?\s*(?:min|mn|minutes?)?$/.exec(s);
  if (hm) return Math.round(parseFloat(hm[1]) * 60 + (hm[2] ? parseInt(hm[2], 10) : 0));
  const m = /^(\d+(?:\.\d+)?)\s*(?:min|mn|minutes?)?$/.exec(s);
  if (m) { const n = Math.round(parseFloat(m[1])); return n > 0 ? n : null; }
  return null;
}

export interface MigrationOutcome {
  from: number;
  to: number;
  applied: { version: number; label: string }[];
  backupPath: string | null;
  notes: string[];
}

/**
 * Applique les migrations en attente au document. La sauvegarde préalable est
 * écrite par l'appelant via `backupDir` : le document d'origine part sur le
 * disque avant toute transformation, jamais après.
 */
export function migrateState(doc: Doc, from: number, ctx: Omit<MigrationCtx, 'log'>, backupDir: string | null): MigrationOutcome {
  const pending = STATE_MIGRATIONS.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  const out: MigrationOutcome = { from, to: from, applied: [], backupPath: null, notes: [] };
  if (!pending.length) return out;

  if (backupDir) out.backupPath = writeBackup(backupDir, doc, from);

  const full: MigrationCtx = { ...ctx, log: (m) => out.notes.push(m) };
  for (const m of pending) {
    m.up(doc, full);
    out.applied.push({ version: m.version, label: m.label });
    out.to = m.version;
  }
  return out;
}

/**
 * Copie du document avant transformation. Le nom porte la version de départ :
 * c'est ce qu'il faut savoir pour décider quoi restaurer, six mois plus tard.
 */
export function writeBackup(dir: string, doc: Doc, fromVersion: number): string {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `state-avant-migration-v${fromVersion}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

/**
 * Fabrique le `storeDataUrl` de la migration à partir d'une fonction de rangement.
 *
 * Le décodage et la reconnaissance du type vivent ici plutôt que chez
 * l'appelant : c'est ce qui garantit que les tests empruntent exactement le
 * chemin du démarrage. Node décode le base64 de façon permissive et rend des
 * octets pour à peu près n'importe quoi, donc le type reconnu d'après le
 * contenu est le seul juge fiable de « cette photo est lisible ».
 */
export function photoStorer(
  store: (ownerId: string, name: string, buf: Buffer, type: DetectedType) => number,
): MigrationCtx['storeDataUrl'] {
  return (ownerId, name, dataUrl) => {
    const buf = decodeDataUrl(dataUrl);
    if (!buf || !buf.length) return null;
    const type = detectType(buf);
    if (!type) return null;
    return store(ownerId, name, buf, type);
  };
}

/** Décode une data-URL en octets. Rend null sur tout ce qui n'en est pas une. */
export function decodeDataUrl(value: string): Buffer | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(value);
  if (!m) return null;
  try {
    const body = m[3];
    return m[2] ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'latin1');
  } catch { return null; }
}
