// Réduire une photo avant de l'envoyer : une plaque signalétique photographiée à
// l'iPhone fait 4 032 × 3 024 px et 3 à 5 Mo ; ramenée à 2 000 px de côté en
// JPEG, elle reste lisible et pèse moins d'un mégaoctet. Le serveur refuse ce
// qui dépasse (voir backend/src/equipements/routes.ts) : ce code n'est pas une
// politesse, c'est la condition pour que la photo passe.
//
// Redessiner l'image dans un canvas a deux effets voulus : la sortie est
// toujours un JPEG (un HEIC que Safari sait lire en ressort converti), et les
// métadonnées EXIF disparaissent, position GPS comprise.

/** Plus grand côté accepté, le même que celui du serveur. */
export const MAX_SIDE = 2000;

/** Les dimensions réduites, proportions gardées. Une image déjà petite n'est pas agrandie. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

export class ImageUnreadable extends Error {}

/** Le nom de la photo une fois convertie : même nom, extension .jpg. */
export const jpegName = (name: string): string => (name.replace(/\.[^.]+$/, '') || 'photo') + '.jpg';

/**
 * La photo réduite en JPEG (qualité 0,85). `createImageBitmap` applique
 * l'orientation EXIF : une photo prise en portrait reste en portrait.
 */
export async function resizePhoto(file: File): Promise<File> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    throw new ImageUnreadable(/hei[cf]/i.test(file.type + file.name)
      ? 'Ce navigateur ne sait pas lire les photos HEIC. Ouvrez-la dans Aperçu (Fichier > Exporter, format JPEG), ou prenez la photo depuis Foyer sur l’iPhone.'
      : 'Cette image est illisible. Formats acceptés : JPEG, PNG ou WEBP.');
  }
  const { width, height } = fitWithin(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
  if (!blob) throw new ImageUnreadable('La photo n’a pas pu être convertie. Réessayez.');
  return new File([blob], jpegName(file.name), { type: 'image/jpeg' });
}

/** Une photo à réduire, ou un document (PDF) à envoyer tel quel. */
export const isImageFile = (f: File): boolean => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|hei[cf])$/i.test(f.name);
