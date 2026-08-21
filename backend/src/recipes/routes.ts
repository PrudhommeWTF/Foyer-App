// Surface HTTP de l'import de recette, montée sous /api/recipes.
//
// Le brief du foyer n'autorise qu'une sortie réseau côté recettes : « l'import
// depuis une URL, déclenché par l'utilisateur, journalisé, et désactivable par
// configuration ». Ce fichier tient les trois.
import express, { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { detectType, IMAGE_MIMES } from '../storage/blobs';
import * as files from '../storage/files';
import { FetchError, fetchPublic } from './fetch';
import { ImportError, parseRecipePage } from './schema-org';

/** Coupure franche : `FOYER_RECIPE_IMPORT=false` et le foyer ne sort plus du tout. */
export const importEnabled = (): boolean => !/^(0|false|no|off)$/i.test(process.env.FOYER_RECIPE_IMPORT || '');

/**
 * Un import est un geste humain : quelques-uns par soirée, jamais une rafale.
 * La limite protège autant le site d'en face que le conteneur.
 */
const importLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop d’imports d’affilée. Réessayez dans quelques minutes.' },
});

export function recipesRouter(): Router {
  const r = express.Router();
  r.use(express.json({ limit: '8kb' }));

  r.post('/import', importLimiter, async (req: Request, res: Response) => {
    if (!importEnabled()) {
      res.status(503).json({
        error: 'L’import de recette est désactivé sur ce serveur (FOYER_RECIPE_IMPORT=false).',
      });
      return;
    }

    const url = String(req.body?.url ?? '').trim();
    if (!url) { res.status(400).json({ error: 'Collez l’adresse de la page de la recette.' }); return; }
    // L'identifiant de la recette existe avant l'enregistrement : c'est lui qui
    // sert de propriétaire à la photo téléchargée.
    const recipeId = String(req.body?.recipeId ?? '').slice(0, 80);

    try {
      const page = await fetchPublic(url, 'text/html,application/xhtml+xml');
      if (page.contentType && !/html|xml/.test(page.contentType)) {
        throw new ImportError('Ce lien ne pointe pas sur une page web (' + page.contentType.split(';')[0] + ').');
      }

      const { recipe, warnings } = parseRecipePage(page.body.toString('utf8'), page.url);

      // La photo est un supplément : son échec ne fait pas échouer l'import.
      let photoId: number | null = null;
      if (recipe.imageUrl && recipeId) {
        try {
          photoId = await downloadPhoto(recipe.imageUrl, recipeId, recipe.name);
        } catch (e) {
          warnings.push('La photo n’a pas pu être récupérée : ' + (e as Error).message);
        }
      }

      // Journalisé, comme demandé : une sortie réseau doit laisser une trace.
      // eslint-disable-next-line no-console
      console.log(`[foyer] Recettes : import de ${page.url} → « ${recipe.name} » (${recipe.ingr.length} ingrédients, ${recipe.steps.length} étapes${photoId ? ', photo' : ''}).`);

      res.json({ recipe: { ...recipe, imageUrl: undefined }, photoId, warnings });
    } catch (e) {
      if (e instanceof FetchError || e instanceof ImportError) {
        // eslint-disable-next-line no-console
        console.warn(`[foyer] Recettes : import de ${url} refusé — ${e.message}`);
        res.status(422).json({ error: e.message });
        return;
      }
      // eslint-disable-next-line no-console
      console.error('[foyer] Recettes : erreur inattendue pendant un import', e);
      res.status(500).json({ error: 'Erreur pendant l’import : ' + (e as Error).message });
    }
  });

  return r;
}

/** Télécharge l'illustration et la range comme n'importe quelle photo de recette. */
async function downloadPhoto(imageUrl: string, recipeId: string, recipeName: string): Promise<number | null> {
  const img = await fetchPublic(imageUrl, 'image/*');
  const type = detectType(img.body);
  // Le type vient des octets, jamais de l'extension ni de l'en-tête annoncé.
  if (!type || !IMAGE_MIMES.includes(type.mime)) throw new ImportError('format d’image non pris en charge');
  return files.store('recipe', recipeId, recipeName, img.body, type).file.id;
}
