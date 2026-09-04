// Surface HTTP des réglages, montée sous /api/settings.
//
// Le contrôle est **ici, côté serveur**, pas dans l'écran : masquer un onglet
// n'a jamais empêché personne d'appeler l'API. Lire les réglages est ouvert à
// tout membre connecté (un adulte a le droit de savoir comment le foyer est
// réglé) ; les écrire est réservé à un administrateur.
import express, { Request, Response, Router } from 'express';
import { ALL, SECTIONS } from './registry';
import { applySettings, readSettings, settingsLog } from './repo';

/** Un lot vient d'un écran, pas d'une file : quelques clés, jamais des centaines. */
const MAX_KEYS = 100;
const MAX_BODY = '64kb';
const LOG_MAX = 200;

export interface SettingsDeps {
  /** Le membre du foyer derrière la requête, ou null. */
  memberId: (req: Request) => string | null;
  isAdmin: (req: Request) => boolean;
  /** Les variables d'environnement posées, pour dire quel réglage est imposé. */
  envValue: (name: string) => string | undefined;
}

export function settingsRouter(deps: SettingsDeps): Router {
  const r = express.Router();
  r.use(express.json({ limit: MAX_BODY }));

  const admin = (req: Request, res: Response, next: express.NextFunction): void => {
    if (!deps.isAdmin(req)) {
      res.status(403).json({ error: 'Seul un administrateur du foyer peut modifier les réglages.' });
      return;
    }
    next();
  };

  /**
   * Tout ce qu'il faut pour engendrer la page : les déclarations, les valeurs
   * effectives, et ce que l'environnement impose. L'interface n'a rien à
   * deviner, et ne peut donc pas laisser croire qu'un réglage sans effet est actif.
   */
  r.get('/', (req: Request, res: Response) => {
    const { values, stored, version } = readSettings();
    const overrides: Record<string, string> = {};
    for (const d of ALL) {
      if (!d.envOverride) continue;
      const posee = deps.envValue(d.envOverride);
      if (posee !== undefined && posee !== '') overrides[d.key] = posee;
    }
    res.json({
      sections: SECTIONS,
      registry: ALL,
      values,
      stored,
      overrides,
      version,
      canEdit: deps.isAdmin(req),
      log: settingsLog(LOG_MAX),
    });
  });

  r.patch('/', admin, (req: Request, res: Response) => {
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
      const out = applySettings(changes as Record<string, unknown>, deps.memberId(req));
      if (out.refused.length) {
        // 422 et non 400 : la requête est bien formée, c'est la valeur qui ne va
        // pas, et l'écran a besoin du message clé par clé pour le placer au bon champ.
        res.status(422).json({ error: out.refused[0].error, refused: out.refused });
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
