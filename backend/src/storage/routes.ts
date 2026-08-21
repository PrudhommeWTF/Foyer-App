// Surface HTTP des fichiers du foyer, montée sous /api/files.
//
// Comme les pièces Finances, tout est derrière le garde de session : une photo
// de recette n'est jamais joignable par sa seule URL.
import express, { Request, Response, Router } from 'express';
import { ACCEPTED_IMAGE_LABEL, IMAGE_MIMES, detectType } from './blobs';
import * as files from './files';

/** Une photo prise au téléphone pèse quelques mégaoctets. */
const MAX_UPLOAD = '20mb';

/** Nom de fichier pour le navigateur : les guillemets et les sauts de ligne sautent. */
const headerName = (name: string): string => name.replace(/["\\\r\n]/g, '').slice(0, 120) || 'fichier';

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
    // Le type vient des octets, jamais de l'extension : une recette n'a aucune
    // raison d'accepter un PDF déguisé en photo.
    if (!type || !IMAGE_MIMES.includes(type.mime)) {
      res.status(415).json({
        error: `Ce format d’image n’est pas pris en charge. Formats acceptés : ${ACCEPTED_IMAGE_LABEL}. `
          + 'Le type est reconnu d’après le contenu du fichier, pas d’après son extension.',
      });
      return;
    }
    try {
      const name = String(req.query['filename'] || 'photo').slice(0, 200);
      const { file, deduplicated } = files.store(kind, ownerId, name, buf, type);
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
    res.setHeader('Content-Disposition', `inline; filename="${headerName(file.name)}"`);
    // sendFile diffuse : une photo de 8 Mo ne devient jamais un tampon de 8 Mo ici.
    res.sendFile(file.path);
  });

  return r;
}
