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
import { DetectedType, GENERIC_TYPE, detectType } from '../storage/blobs';
import type { OwnerKind } from '../storage/files';

/** Version cible du document. À incrémenter en ajoutant une migration. */
export const STATE_VERSION = 7;

/** Le document est manipulé sans typage : ces migrations voient l'ancienne forme. */
type Doc = Record<string, any>;

export interface MigrationCtx {
  /**
   * Range des octets encodés en data-URL et rend leur identifiant, ou null quand
   * le contenu est illisible. L'appelant décide alors quoi faire, il n'invente rien.
   */
  storeDataUrl(ownerKind: OwnerKind, ownerId: string, name: string, dataUrl: string): number | null;
  log(message: string): void;
}

export interface StateMigration {
  version: number;
  label: string;
  up: (doc: Doc, ctx: MigrationCtx) => void;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Les jours tels que `SchedSlot.day` les nommait avant la migration 6. */
const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

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
        const id = ctx.storeDataUrl('recipe', String(r['id'] ?? ''), String(r['name'] ?? 'photo'), photo);
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
  {
    version: 5,
    label: 'documents rangés sur le disque',
    up: (doc, ctx) => {
      // Même dette que les photos de recettes, un module plus loin : les octets
      // d'un passeport scanné voyageaient dans chaque enregistrement de l'état,
      // y compris pour cocher un article de courses depuis un magasin.
      let moved = 0;
      const failed: string[] = [];
      for (const f of arr(doc['files'])) {
        const data = f['data'];
        if (typeof data !== 'string' || !data.startsWith('data:')) {
          if ('data' in f) delete f['data'];
          continue;
        }
        const name = String(f['name'] ?? 'document');
        const id = ctx.storeDataUrl('document', String(f['id'] ?? ''), name, data);
        if (id == null) {
          // Illisible : la data-URL reste en place. Un document qu'on ne sait pas
          // décoder est un problème à signaler, pas à effacer.
          failed.push(name);
          continue;
        }
        f['fileId'] = id;
        delete f['data'];
        moved++;
      }
      if (moved) ctx.log(`${moved} document(s) déplacé(s) hors du document d'état.`);
      if (failed.length) {
        // Nommés, et pas seulement comptés : ce sont eux qui continuent de peser
        // sur chaque enregistrement, et c'est la seule façon de savoir lesquels
        // rouvrir.
        ctx.log(
          `${failed.length} document(s) illisible(s), laissé(s) dans le document d'état : ${failed.slice(0, 5).join(', ')}` +
          (failed.length > 5 ? ', …' : '') + '. Rouvrez ces fiches et reposez le fichier pour le ranger sur le disque.',
        );
      }
    },
  },
  {
    version: 6,
    label: 'emploi du temps : créneaux à plusieurs membres, jour numéroté',
    up: (doc, ctx) => {
      // Deux dettes soldées d'un coup, parce qu'elles touchent les deux mêmes
      // champs de chaque créneau :
      //
      //   - `who` portait **un** membre. Un créneau qui concerne toute la
      //     famille demandait donc quatre saisies, quatre modifications et
      //     quatre suppressions.
      //   - `day` portait le nom français du jour. Le reste de l'application
      //     compte déjà en lundi = 1 (voir presence.ts) : une chaîne à traduire
      //     à chaque calcul de date n'avait pas lieu d'être.
      const connus = new Set(arr(doc['members']).map((m) => String(m['id'])));
      let orphelins = 0;
      const sansJour: string[] = [];

      for (const s of arr(doc['sched'])) {
        // Un membre qui n'existe pas laisse le créneau **sans** membre plutôt
        // que de l'emporter avec lui : l'écran l'affiche alors « sans membre »,
        // ce qui se répare en deux gestes. Le supprimer serait une perte muette.
        if (Array.isArray(s['who'])) {
          s['who'] = s['who'].filter((x: unknown) => typeof x === 'string' && connus.has(x));
        } else {
          const id = typeof s['who'] === 'string' ? s['who'].trim() : '';
          if (id && !connus.has(id)) orphelins++;
          s['who'] = id && connus.has(id) ? [id] : [];
        }

        if (typeof s['dow'] !== 'number' || s['dow'] < 1 || s['dow'] > 7) {
          const i = JOURS.indexOf(String(s['day'] ?? ''));
          if (i >= 0) s['dow'] = i + 1;
          else {
            // Un nom de jour illisible ne peut venir que d'une retouche à la
            // main. Le créneau est gardé, posé au lundi, et **nommé** dans le
            // journal : c'est la seule façon d'aller le remettre au bon jour.
            s['dow'] = 1;
            sansJour.push(String(s['label'] ?? '(sans intitulé)'));
          }
        }
        delete s['day'];
      }

      if (orphelins) {
        ctx.log(
          `${orphelins} créneau(x) d'emploi du temps rattaché(s) à un membre inconnu : ils sont conservés ` +
          'sans membre et signalés dans l\'écran Emploi du temps, où il suffit de leur en attribuer un.',
        );
      }
      if (sansJour.length) {
        ctx.log(
          `${sansJour.length} créneau(x) au jour illisible, placé(s) au lundi : ${sansJour.slice(0, 5).join(', ')}` +
          (sansJour.length > 5 ? ', …' : '') + '. Rouvrez-les pour les remettre au bon jour.',
        );
      }
    },
  },
  {
    version: 7,
    label: 'emploi du temps : récurrence et périodes de validité',
    up: (doc) => {
      // Jusqu'ici un créneau n'avait pas de récurrence **parce que tout était
      // récurrent** : « tous les lundis, pour toujours ». C'est exactement
      // `rec: 'weekly'` sans période de validité, donc la conversion ne change
      // aucun comportement, elle rend la règle explicite.
      //
      // Les autres champs (date, from, until, when, skip) restent absents : ils
      // sont facultatifs, et leur absence est déjà la valeur par défaut.
      for (const s of arr(doc['sched'])) {
        if (s['rec'] !== 'weekly' && s['rec'] !== 'once') s['rec'] = 'weekly';
      }
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
 *
 * Un document de famille, lui, peut légitimement être un format que le
 * détecteur ne nomme pas (un .odt, un traitement de texte exotique). Le refuser
 * le laisserait en data-URL dans l'état, c'est-à-dire exactement la dette qu'on
 * solde : il est rangé sous le type neutre.
 */
export function fileStorer(
  store: (ownerKind: OwnerKind, ownerId: string, name: string, buf: Buffer, type: DetectedType) => number,
): MigrationCtx['storeDataUrl'] {
  return (ownerKind, ownerId, name, dataUrl) => {
    const buf = decodeDataUrl(dataUrl);
    if (!buf || !buf.length) return null;
    const type = detectType(buf);
    if (!type && ownerKind !== 'document') return null;
    return store(ownerKind, ownerId, name, buf, type ?? GENERIC_TYPE);
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
