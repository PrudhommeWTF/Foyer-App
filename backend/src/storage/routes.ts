// Surface HTTP des fichiers du foyer, montée sous /api/files.
//
// Comme les pièces Finances, tout est derrière le garde de session : une photo
// de recette n'est jamais joignable par sa seule URL.
import { contentDisposition } from '../headers';
import express, { NextFunction, Request, Response, Router } from 'express';
import { ACCEPTED_IMAGE_LABEL, DetectedType, GENERIC_TYPE, IMAGE_MIMES, INLINE_MIMES, detectType } from './blobs';
import * as files from './files';

/** Une photo prise au téléphone pèse quelques mégaoctets, le scan d'un dossier plus encore. */
const MAX_UPLOAD = '20mb';
const MAX_UPLOAD_LISIBLE = '20 Mo';

/**
 * Ce que chaque genre de propriétaire accepte. Le type vient des octets, jamais
 * de l'extension : une recette n'a aucune raison d'accepter un PDF déguisé en
 * photo. Un dossier de famille, lui, reçoit des pièces d'identité, des factures
 * et des tableurs : refuser ce que le détecteur ne sait pas nommer écarterait un
 * .odt ou un .txt sans raison, donc les octets inconnus y sont rangés sous le
 * type neutre.
 */
const ACCEPTS: Record<files.OwnerKind, { ok: (t: DetectedType | null) => boolean; refus: string }> = {
  recipe: {
    ok: (t) => !!t && IMAGE_MIMES.includes(t.mime),
    refus: `Ce format d’image n’est pas pris en charge. Formats acceptés : ${ACCEPTED_IMAGE_LABEL}. `
      + 'Le type est reconnu d’après le contenu du fichier, pas d’après son extension.',
  },
  document: { ok: () => true, refus: '' },
};

export function filesRouter(): Router {
  const r = express.Router();

  r.post('/', express.raw({ type: '*/*', limit: MAX_UPLOAD }), (req: Request, res: Response) => {
    const kind = String(req.query['owner'] ?? '') as files.OwnerKind;
    if (!files.OWNER_KINDS.includes(kind)) {
      res.status(400).json({ error: 'Type de rattachement inconnu : attendu ' + files.OWNER_KINDS.join(', ') + '.' });
      return;
    }
    const ownerId = String(req.query['id'] ?? '').slice(0, 80);
    if (!ownerId) { res.status(400).json({ error: 'Identifiant de rattachement manquant.' }); return; }

    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || !buf.length) {
      res.status(400).json({ error: 'Aucun fichier reçu. Envoyez le contenu brut du fichier dans le corps de la requête.' });
      return;
    }
    const type = detectType(buf);
    if (!ACCEPTS[kind].ok(type)) { res.status(415).json({ error: ACCEPTS[kind].refus }); return; }
    try {
      const name = String(req.query['filename'] || 'fichier').slice(0, 200);
      const { file, deduplicated } = files.store(kind, ownerId, name, buf, type ?? GENERIC_TYPE);
      res.status(201).json({ file, deduplicated });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[foyer] Fichiers : échec de l’enregistrement', e);
      res.status(500).json({ error: 'Enregistrement du fichier impossible : ' + (e as Error).message });
    }
  });

  r.get('/:id', (req: Request, res: Response) => {
    const id = parseInt(String(req.params['id'] ?? ''), 10);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Identifiant de fichier invalide.' }); return; }
    const file = files.fileOf(id);
    if (!file) {
      const known = files.get(id);
      if (!known) { res.status(404).json({ error: 'Fichier introuvable.' }); return; }
      res.status(410).json({
        error: 'Le fichier est absent du disque. Restaurez le répertoire « pieces » de vos sauvegardes, '
          + 'ou reposez la photo depuis l’application.',
      });
      return;
    }
    res.setHeader('Content-Type', file.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Les octets sont adressés par leur empreinte : le contenu d'un identifiant
    // ne change jamais, le navigateur peut le garder longtemps.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    // Un type qu'on ne sait pas afficher part en téléchargement plutôt que d'être
    // rendu dans l'origine de l'application : c'est ce qui sépare une pièce
    // jointe d'une page servie par le foyer.
    const mode = INLINE_MIMES.includes(file.mime) ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', contentDisposition(mode, file.name, 'fichier'));
    // sendFile diffuse : une photo de 8 Mo ne devient jamais un tampon de 8 Mo ici.
    res.sendFile(file.path);
  });

  // Suppression immédiate, et pas seulement au ménage du démarrage : la copie
  // d'une pièce d'identité n'a pas à rester sur le disque jusqu'au prochain
  // redémarrage parce que quelqu'un l'a retirée de l'application.
  r.delete('/:id', (req: Request, res: Response) => {
    const id = parseInt(String(req.params['id'] ?? ''), 10);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Identifiant de fichier invalide.' }); return; }
    if (!files.remove(id)) { res.status(404).json({ error: 'Fichier introuvable.' }); return; }
    res.status(204).end();
  });

  // Un fichier trop lourd ressortait en page HTML d'Express, sans dire la limite.
  // Le scan d'un dossier médical entier atteint vite 20 Mo : autant le dire.
  r.use((err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type !== 'entity.too.large') { next(err); return; }
    res.status(413).json({ error: `Ce fichier dépasse la taille maximale acceptée (${MAX_UPLOAD_LISIBLE}).` });
  });

  return r;
}
