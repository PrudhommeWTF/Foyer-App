// Surface HTTP des réglages, montée sous /api/settings.
//
// Le contrôle est **ici, côté serveur**, pas dans l'écran : masquer un onglet
// n'a jamais empêché personne d'appeler l'API.
//
//   - lire     : tout membre connecté. Un adulte a le droit de savoir comment
//                le foyer est réglé, et voit ses propres préférences.
//   - écrire   : un réglage **du foyer** engage tout le monde, donc
//                administrateur uniquement ; une **préférence personnelle**
//                n'engage que soi, donc chacun écrit la sienne, et seulement la
//                sienne. Le tri se fait clé par clé, à la portée déclarée.
import express, { Request, Response, Router } from 'express';
import { ALL, SECTIONS } from './registry';
import { applySettings, effectiveSetting, readSettings, settingsLog } from './repo';

/** Un lot vient d'un écran, pas d'une file : quelques clés, jamais des centaines. */
const MAX_KEYS = 100;
const MAX_BODY = '64kb';
const LOG_MAX = 200;

export interface SettingsDeps {
  /** Le membre du foyer derrière la requête, ou null. */
  memberId: (req: Request) => string | null;
  isAdmin: (req: Request) => boolean;
  /** Les réglages du foyer qu'une variable d'environnement écrase, avec sa valeur. */
  overrides: () => Record<string, string>;
  /** Les réglages fixés par la machine, tels qu'ils s'appliquent. Secrets exclus. */
  deployment: () => { key: string; value: string; set: boolean }[];
}

export function settingsRouter(deps: SettingsDeps): Router {
  const r = express.Router();
  r.use(express.json({ limit: MAX_BODY }));

  /**
   * Tout ce qu'il faut pour engendrer la page : les déclarations, les valeurs
   * effectives, et ce que l'environnement impose. L'interface n'a rien à
   * deviner, et ne peut donc pas laisser croire qu'un réglage sans effet est actif.
   */
  r.get('/', (req: Request, res: Response) => {
    const { values, stored, version } = readSettings(deps.memberId(req));
    // `values` porte ce qui **s'applique**, variable d'environnement comprise.
    // Renvoyer la valeur du document pour un réglage écrasé donnerait un
    // interrupteur allumé sous une explication disant qu'il est éteint : le
    // mensonge exact que ce chantier existe pour supprimer.
    const overrides = deps.overrides();
    for (const key of Object.keys(overrides)) values[key] = effectiveSetting(key);
    res.json({
      sections: SECTIONS,
      registry: ALL,
      values,
      stored,
      overrides,
      deployment: deps.deployment(),
      version,
      canEdit: deps.isAdmin(req),
      log: settingsLog(LOG_MAX),
    });
  });

  r.patch('/', (req: Request, res: Response) => {
    const changes = req.body?.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      res.status(400).json({ error: 'Réglages attendus dans « changes », sous la forme { clé: valeur }.' });
      return;
    }
    const keys = Object.keys(changes);
    if (keys.length > MAX_KEYS) {
      res.status(413).json({ error: `Lot trop gros : ${keys.length} réglages pour un maximum de ${MAX_KEYS}.` });
      return;
    }
    try {
      const out = applySettings(changes as Record<string, unknown>, deps.memberId(req), deps.isAdmin(req));
      if (out.refused.length) {
        // Un droit manquant est un 403, une valeur qui ne va pas un 422 : ce
        // n'est pas le même geste pour la personne en face, et l'écran n'a pas à
        // deviner lequel des deux lui est arrivé. Dans les deux cas le message
        // part clé par clé, pour se placer au bon champ.
        const droit = out.refused.some((f) => f.kind === 'droit');
        res.status(droit ? 403 : 422).json({ error: out.refused[0].error, refused: out.refused });
        return;
      }
      if (out.changed.length) {
        // eslint-disable-next-line no-console
        console.log(`[foyer] Réglages : ${out.changed.join(', ')} modifié(s) par ${deps.memberId(req) || '(membre inconnu)'}.`);
      }
      res.json(out);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[foyer] Réglages : erreur inattendue en écrivant un lot', e);
      res.status(500).json({ error: 'Erreur en enregistrant les réglages : ' + (e as Error).message });
    }
  });

  return r;
}
