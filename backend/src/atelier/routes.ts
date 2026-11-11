// Surface HTTP du module « Atelier code », montée sous /api/atelier derrière la
// session, `requireMember` et le drapeau `modAtelier`. Pas de jeton d'accès.
//
// Qui a le droit de quoi :
//   - un enfant lit et écrit **ses** projets et **ses** médias, et rien d'autre ;
//   - un adulte lit ceux de tout le monde, n'écrit que les siens, et lui seul
//     restaure un projet supprimé ;
//   - personne ne supprime pour de bon : « supprimer » archive.
//
// Les opérations sont exactement celles que le pont de l'éditeur appelle
// (frontend/vendor/atelier/petits/src/tablet/Web.js). Aucune n'accepte de SQL.
import express, { Request, Response, Router } from 'express';
import { Member } from '../models';
import { log } from '../log';
import { AuthedRequest, currentMember } from '../auth/session';
import { effectiveSetting } from '../settings/repo';
import * as files from '../storage/files';
import { detectType } from '../storage/blobs';
import { imageSize } from '../storage/image-size';
import { sanitizeSvg } from './svg';
import * as repo from './repo';

/** Garde-fous techniques, pas des réglages : au-delà, ce n'est plus un projet ni un dessin d'enfant. */
const MAX_PROJECT_BYTES = 1024 * 1024;
const MAX_MEDIA_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1024;
const MEDIA_NAME = /^[0-9a-f]{32}\.(svg|png)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SVG_TYPE = { mime: 'image/svg+xml', ext: '.svg' };

class Invalid extends Error {}
const text = (v: unknown, what: string, max: number, required = true): string => {
  if (v === undefined || v === null || v === '') { if (required) throw new Invalid(`${what} : valeur attendue.`); return ''; }
  if (typeof v !== 'string' || v.length > max) throw new Invalid(`${what} : texte d’au plus ${max} caractères attendu.`);
  return v.trim();
};
const optional = (v: unknown, what: string, max: number): string | null => text(v, what, max, false) || null;
const mediaName = (v: unknown, what: string, required = true): string | null => {
  if ((v === undefined || v === null || v === '') && !required) return null;
  if (typeof v !== 'string' || !MEDIA_NAME.test(v)) throw new Invalid(`${what} : nom de média attendu.`);
  return v;
};

const me = (req: Request): Member => currentMember(req as AuthedRequest)!;
const handler = (fn: (req: Request, res: Response) => void) => (req: Request, res: Response): void => {
  try { fn(req, res); }
  catch (e) {
    if (e instanceof Invalid) { res.status(400).json({ error: e.message }); return; }
    log.erreur('Atelier : erreur inattendue', e);
    res.status(500).json({ error: 'Atelier : ' + (e as Error).message });
  }
};

/** Le JSON d'un projet, vérifié en taille et en forme générale. Le sens appartient à l'éditeur. */
function projectJson(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.length) throw new Invalid('json : le projet est attendu en texte JSON.');
  if (Buffer.byteLength(raw) > MAX_PROJECT_BYTES) throw new Invalid('Ce projet est trop gros pour être enregistré. Enlève des personnages ou des pages.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Invalid('json : JSON illisible.'); }
  const p = parsed as { pages?: unknown };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(p.pages) || p.pages.length > 4 || p.pages.some((x) => typeof x !== 'string')) {
    throw new Invalid('json : ce n’est pas un projet de l’Atelier.');
  }
  return raw;
}
/** La vignette telle que l'éditeur la décrit : {pagecount, md5}, md5 étant un média du membre. */
function thumbnailJson(raw: unknown, memberId: string): string | null {
  if (raw === undefined || raw === null || raw === '' || raw === 'null') return null;
  let t: { pagecount?: unknown; md5?: unknown };
  try { t = JSON.parse(String(raw)); } catch { throw new Invalid('thumbnail : JSON illisible.'); }
  const name = mediaName(t?.md5, 'thumbnail.md5')!;
  if (!repo.getMedia(memberId, name)) throw new Invalid('thumbnail : vignette inconnue.');
  return JSON.stringify({ pagecount: typeof t.pagecount === 'number' ? t.pagecount : 1, md5: name });
}

/** Ce que l'éditeur et l'écran Foyer lisent d'un projet. `rev` est le compteur de concurrence. */
export const projectView = (p: repo.ProjectRow, withJson = false) => ({
  id: p.id, memberId: p.member_id, level: p.level, name: p.name, thumbnail: p.thumbnail_json ? JSON.parse(p.thumbnail_json) as { pagecount: number; md5: string } : null,
  editorVersion: p.editor_version, rev: p.version, isSample: !!p.is_sample, copiedFrom: p.copied_from, createdAt: p.created_at, updatedAt: p.updated_at,
  archivedAt: p.archived_at, ...(withJson ? { json: p.json } : {}),
});
const assetView = (a: repo.AssetRow) => ({ id: a.id, md5: a.md5, altmd5: a.altmd5, name: a.name, scale: a.scale, width: a.width, height: a.height, ext: a.ext, version: a.editor_version });

export function atelierRouter(members: () => Member[]): Router {
  const r = Router();
  const json = express.json({ limit: MAX_PROJECT_BYTES + 256 * 1024 });
  const limits = () => ({ projets: Number(effectiveSetting('atelierProjetsMax')), quotaMo: Number(effectiveSetting('atelierQuotaMo')) });

  /**
   * Le membre dont on lit les données : soi par défaut, un autre (`?membre=`) pour
   * un adulte seulement. Rend null après avoir répondu quand c'est refusé.
   */
  const reader = (req: Request, res: Response): string | null => {
    const asked = req.query['membre'];
    if (asked === undefined || asked === me(req).id) return me(req).id;
    if (me(req).enfant) { res.status(403).json({ error: 'Tu ne peux voir que tes projets.' }); return null; }
    if (typeof asked !== 'string' || !members().some((m) => m.id === asked)) { res.status(404).json({ error: 'Membre inconnu.' }); return null; }
    return asked;
  };
  /** Un projet que la session a le droit de lire (le sien, ou n'importe lequel pour un adulte), ou null après réponse. */
  const readable = (req: Request, res: Response): repo.ProjectRow | null => {
    const id = String(req.params['id']);
    const p = UUID.test(id) ? repo.getProject(id) : null;
    if (!p) { res.status(404).json({ error: 'Projet introuvable.' }); return null; }
    if (p.member_id !== me(req).id && me(req).enfant) { res.status(403).json({ error: 'Ce projet n’est pas à toi.' }); return null; }
    return p;
  };
  /** Un projet que la session a le droit de modifier : le sien, non archivé. */
  const writable = (req: Request, res: Response): repo.ProjectRow | null => {
    const p = readable(req, res);
    if (!p) return null;
    if (p.member_id !== me(req).id) { res.status(403).json({ error: 'On ne modifie que ses propres projets.' }); return null; }
    if (p.archived_at) { res.status(410).json({ error: 'Ce projet a été supprimé.' }); return null; }
    return p;
  };

  // ---- contexte ----
  r.get('/contexte', handler((req, res) => {
    const l = limits(), m = me(req);
    res.json({ membre: { id: m.id, name: m.name, enfant: !!m.enfant }, limites: l, utilise: { projets: repo.countProjects(m.id), octets: repo.usedBytes(m.id) } });
  }));

  // ---- projets ----
  r.get('/projets', handler((req, res) => {
    const memberId = reader(req, res); if (!memberId) return;
    // La corbeille ne se lit que par un adulte : c'est lui qui restaure.
    const archived = req.query['corbeille'] === '1';
    if (archived && me(req).enfant) { res.status(403).json({ error: 'Seul un adulte voit les projets supprimés.' }); return; }
    res.json({ projets: repo.projectsOf(memberId, archived).map((p) => projectView(p)) });
  }));

  r.post('/projets', json, handler((req, res) => {
    const m = me(req), l = limits();
    if (repo.countProjects(m.id) >= l.projets) {
      res.status(409).json({ error: `Tu as déjà ${l.projets} projets : c’est le maximum. Supprime un vieux projet pour en créer un nouveau.`, code: 'projets_max' });
      return;
    }
    const level = req.body?.level ?? 'petits';
    if (!repo.LEVELS.includes(level)) throw new Invalid('level : niveau inconnu.');
    const p = repo.createProject(m.id, level, text(req.body?.name, 'name', 80));
    log.info(`Atelier : projet « ${p.name} » créé par ${m.name}.`);
    res.status(201).json({ projet: projectView(p, true) });
  }));

  r.get('/projets/:id', handler((req, res) => {
    const p = readable(req, res); if (!p) return;
    res.json({ projet: projectView(p, true) });
  }));

  r.put('/projets/:id', json, handler((req, res) => {
    const p = writable(req, res); if (!p) return;
    const rev = req.body?.rev;
    if (typeof rev !== 'number' || !Number.isInteger(rev)) throw new Invalid('rev : la version lue est attendue.');
    const saved = repo.saveProject(p.id, rev, {
      name: text(req.body?.name, 'name', 80), json: projectJson(req.body?.json),
      thumbnailJson: thumbnailJson(req.body?.thumbnail, p.member_id), editorVersion: optional(req.body?.editorVersion, 'editorVersion', 40),
    });
    // Un autre appareil a enregistré entre-temps : on rend ce que le serveur
    // détient, à l'éditeur de proposer le choix. Jamais d'écrasement silencieux.
    if (!saved) { res.status(409).json({ error: 'Ce projet a été modifié sur un autre appareil.', code: 'conflit', projet: projectView(repo.getProject(p.id)!) }); return; }
    res.json({ projet: projectView(saved) });
  }));

  r.patch('/projets/:id', json, handler((req, res) => {
    const p = writable(req, res); if (!p) return;
    repo.renameProject(p.id, text(req.body?.name, 'name', 80));
    res.json({ projet: projectView(repo.getProject(p.id)!) });
  }));

  r.post('/projets/:id/copie', json, handler((req, res) => {
    const p = writable(req, res); if (!p) return;
    const m = me(req), l = limits();
    if (repo.countProjects(m.id) >= l.projets) {
      res.status(409).json({ error: `Tu as déjà ${l.projets} projets : c’est le maximum. Supprime un vieux projet pour en créer un nouveau.`, code: 'projets_max' });
      return;
    }
    const copy = repo.createProject(m.id, p.level, text(req.body?.name, 'name', 80), p);
    log.info(`Atelier : projet « ${p.name} » dupliqué en « ${copy.name} » par ${m.name}.`);
    res.status(201).json({ projet: projectView(copy) });
  }));

  r.delete('/projets/:id', handler((req, res) => {
    const p = writable(req, res); if (!p) return;
    repo.archiveProject(p.id);
    log.info(`Atelier : projet « ${p.name} » supprimé (archivé) par ${me(req).name}.`);
    res.json({ ok: true });
  }));

  r.post('/projets/:id/restaurer', handler((req, res) => {
    const p = readable(req, res); if (!p) return;
    if (me(req).enfant) { res.status(403).json({ error: 'Demande à un parent de retrouver ce projet.' }); return; }
    repo.restoreProject(p.id);
    log.info(`Atelier : projet « ${p.name} » de ${members().find((m) => m.id === p.member_id)?.name ?? p.member_id} restauré par ${me(req).name}.`);
    res.json({ projet: projectView(repo.getProject(p.id)!) });
  }));

  // ---- médias ----
  const refuse = (req: Request, res: Response, status: number, error: string, why: string): void => {
    log.info(`Atelier : média refusé à ${me(req).name} (${why}).`);
    res.status(status).json({ error });
  };

  r.post('/medias', express.raw({ type: '*/*', limit: MAX_MEDIA_BYTES }), handler((req, res) => {
    const m = me(req), body = req.body as unknown;
    if (!Buffer.isBuffer(body) || !body.length) { refuse(req, res, 400, 'Aucun fichier reçu.', 'corps vide'); return; }
    let buf = body, type = detectType(body);
    if (type?.mime === 'image/png') {
      const size = imageSize(buf, type.mime);
      if (!size || Math.max(size.width, size.height) > MAX_IMAGE_SIDE) { refuse(req, res, 422, 'Cette image est trop grande.', `image de plus de ${MAX_IMAGE_SIDE} px ou illisible`); return; }
    } else if (!type && buf.subarray(0, 512).toString('utf8').trimStart().startsWith('<')) {
      // Le type n'est pas cru sur parole : un SVG est ce qui survit au nettoyage.
      const clean = sanitizeSvg(buf.toString('utf8'));
      if (!clean.ok) { refuse(req, res, 422, clean.error, 'SVG refusé au nettoyage'); return; }
      buf = Buffer.from(clean.svg, 'utf8'); type = SVG_TYPE;
    } else { refuse(req, res, 415, 'Ce type de fichier n’est pas accepté dans l’Atelier.', `type ${type?.mime ?? 'inconnu'}`); return; }
    const quota = limits().quotaMo * 1024 * 1024;
    if (repo.usedBytes(m.id) + buf.length > quota) {
      refuse(req, res, 413, 'Il n’y a plus de place pour tes dessins. Demande à un parent de faire du rangement dans tes projets.', `quota de ${limits().quotaMo} Mo atteint`);
      return;
    }
    const { media, existed } = repo.putMedia(m.id, buf, type);
    res.status(existed ? 200 : 201).json({ name: media.name });
  }));

  r.get('/medias/:name', handler((req, res) => {
    const memberId = reader(req, res); if (!memberId) return;
    const name = String(req.params['name']);
    const media = MEDIA_NAME.test(name) ? repo.getMedia(memberId, name) : null;
    const f = media && files.fileOf(media.file_id);
    if (!media || !f) { res.status(404).json({ error: 'Média introuvable.' }); return; }
    res.setHeader('Content-Type', media.mime);
    // Un SVG ouvert comme un document s'exécuterait : il n'est servi que comme
    // une image inerte, sans rien pouvoir charger ni lancer.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Content-Disposition', `attachment; filename="${media.name}"`);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(f.path);
  }));

  // L'éditeur demande le retrait d'une vignette remplacée ou d'un dessin retiré.
  // Le serveur ne retire que ce que plus rien ne cite : une demande à tort ne
  // peut pas abîmer un projet.
  r.delete('/medias/:name', handler((req, res) => {
    const m = me(req), name = String(req.params['name']);
    const media = MEDIA_NAME.test(name) ? repo.getMedia(m.id, name) : null;
    if (media && !repo.mediaReferenced(m.id, name)) repo.removeMedia(media);
    res.json({ ok: true });
  }));

  // ---- mes personnages, mes décors ----
  const kind = (v: unknown): repo.AssetKind => { if (!repo.ASSET_KINDS.includes(v as repo.AssetKind)) throw new Invalid('kind : personnage ou decor attendu.'); return v as repo.AssetKind; };

  r.get('/elements', handler((req, res) => {
    const memberId = reader(req, res); if (!memberId) return;
    res.json({ elements: repo.assetsOf(memberId, kind(req.query['kind'])).map(assetView) });
  }));

  r.post('/elements', json, handler((req, res) => {
    const m = me(req), b = req.body ?? {};
    const md5 = mediaName(b.md5, 'md5')!, altmd5 = mediaName(b.altmd5, 'altmd5', false);
    if (!repo.getMedia(m.id, md5) || (altmd5 && !repo.getMedia(m.id, altmd5))) throw new Invalid('Dessin inconnu : il doit être envoyé avant d’être rangé.');
    const a = repo.addAsset(m.id, kind(b.kind), {
      md5, altmd5, name: optional(b.name, 'name', 80), scale: optional(b.scale, 'scale', 12), width: optional(b.width, 'width', 12),
      height: optional(b.height, 'height', 12), ext: optional(b.ext, 'ext', 8), editor_version: optional(b.version, 'version', 40),
    });
    res.status(201).json({ element: assetView(a) });
  }));

  r.delete('/elements/:id', handler((req, res) => {
    const a = repo.getAsset(parseInt(String(req.params['id']), 10));
    if (!a || a.member_id !== me(req).id) { res.status(404).json({ error: 'Élément introuvable.' }); return; }
    repo.archiveAsset(a.id);
    res.json({ ok: true });
  }));

  return r;
}
