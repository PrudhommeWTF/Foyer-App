// Le contrôle d'un fichier téléversé par un module (factures des équipements,
// justificatifs de l'entretien) : une photo réduite ou un PDF, reconnus d'après
// leur contenu, jamais d'après le nom ou l'en-tête annoncé.
import { DetectedType, detectType } from './blobs';
import { imageSize } from './image-size';

/** Plus grand côté accepté pour une photo. L'application réduit avant l'envoi ; le serveur vérifie. */
export const MAX_IMAGE_SIDE = 2000;
export const PHOTO_MIMES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

export type UploadCheck = { ok: true; type: DetectedType } | { ok: false; status: number; error: string };

/** Accepte une photo JPEG, PNG ou WEBP d'au plus MAX_IMAGE_SIDE de côté, et un PDF si `pdf`. */
export function checkUpload(buf: unknown, pdf: boolean): UploadCheck {
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, status: 400, error: 'Aucun fichier reçu. Envoyez le contenu brut du fichier dans le corps de la requête.' };
  const type = detectType(buf);
  if (type?.mime === 'image/heic') {
    return { ok: false, status: 415, error: 'Photo HEIC non acceptée : ouvrez-la dans Aperçu (Fichier > Exporter, format JPEG) ou prenez-la depuis Foyer sur l’iPhone, qui l’envoie en JPEG.' };
  }
  if (!type || !(PHOTO_MIMES.includes(type.mime) || (pdf && type.mime === 'application/pdf'))) {
    return { ok: false, status: 415, error: `Format non pris en charge. Formats acceptés : JPEG, PNG ou WEBP${pdf ? ', ou PDF' : ''}. Le type est reconnu d’après le contenu du fichier.` };
  }
  if (type.mime !== 'application/pdf') {
    const size = imageSize(buf, type.mime);
    if (!size) return { ok: false, status: 415, error: 'Image illisible : son en-tête ne donne pas ses dimensions.' };
    if (Math.max(size.width, size.height) > MAX_IMAGE_SIDE) {
      return { ok: false, status: 422, error: `Photo de ${size.width} × ${size.height} px : Foyer n’accepte que des photos réduites à ${MAX_IMAGE_SIDE} px de côté. L’application les réduit d’elle-même ; si vous envoyez par l’API, réduisez-la d’abord.` };
    }
  }
  return { ok: true, type };
}
