// Surface HTTP du canal push, montée sous /api/push, derrière le garde de session.
//
// Un appareil s'abonne pour le membre connecté ; un membre ne voit et ne
// retire que ses appareils, mais le journal des envois est celui du foyer :
// « Marie n'a aucun appareil abonné » est une information pour Thomas aussi.
import express, { Request, Response, Router } from 'express';
import { addDevice, isPushEndpointAllowed, isSubscription, listDevices, notify, publicKey, recentSends, removeDevice, removeDeviceByEndpoint } from './push';
import { log } from '../log';

export function pushRouter(memberOf: (req: Request) => string | null, appUrl: () => string): Router {
  const r = express.Router();
  r.use(express.json({ limit: '16kb' }));

  r.get('/status', (req: Request, res: Response) => {
    const me = memberOf(req);
    res.json({
      publicKey: publicKey(),
      devices: me ? listDevices(me).map((d) => ({ id: d.id, ua: d.ua, createdAt: d.createdAt, lastOkAt: d.lastOkAt, lastError: d.lastError })) : [],
      /** Qui du foyer a au moins un appareil : dit à qui les rappels peuvent arriver. */
      subscribed: [...new Set(listDevices().map((d) => d.memberId))],
      sends: recentSends(),
    });
  });

  r.post('/subscribe', (req: Request, res: Response) => {
    const me = memberOf(req);
    if (!me) { res.status(400).json({ error: 'Ce compte n’est rattaché à aucun membre du foyer.' }); return; }
    const sub = req.body?.subscription;
    if (!isSubscription(sub)) { res.status(400).json({ error: 'Abonnement illisible : le navigateur n’a pas rendu ce qu’on attendait.' }); return; }
    if (!isPushEndpointAllowed(sub.endpoint)) { res.status(400).json({ error: 'Cet abonnement ne vise pas un service de notifications connu.' }); return; }
    const d = addDevice(me, sub, String(req.body?.ua || req.headers['user-agent'] || ''));
    log.info(`Notifications : appareil abonné pour ${me} (${d.ua.slice(0, 60)}).`);
    res.status(201).json({ id: d.id, ua: d.ua, createdAt: d.createdAt, lastOkAt: d.lastOkAt, lastError: d.lastError });
  });

  /** Ce navigateur se désabonne : il ne connaît que son adresse, pas l'identifiant en base. */
  r.post('/unsubscribe', (req: Request, res: Response) => {
    const me = memberOf(req);
    const endpoint = String(req.body?.endpoint || '');
    if (!me || !endpoint) { res.status(400).json({ error: 'Abonnement inconnu.' }); return; }
    res.json({ removed: removeDeviceByEndpoint(me, endpoint) });
  });

  r.delete('/subscribe/:id', (req: Request, res: Response) => {
    const me = memberOf(req);
    const id = parseInt(req.params.id, 10);
    if (!me || !Number.isInteger(id)) { res.status(400).json({ error: 'Appareil inconnu.' }); return; }
    if (!removeDevice(me, id)) { res.status(404).json({ error: 'Appareil inconnu, ou pas le vôtre.' }); return; }
    res.json({ ok: true });
  });

  /** Une vraie notification, tout de suite, sur mes appareils : c'est le seul test qui vaille. */
  r.post('/test', async (req: Request, res: Response) => {
    const me = memberOf(req);
    if (!me) { res.status(400).json({ error: 'Ce compte n’est rattaché à aucun membre du foyer.' }); return; }
    // `notify` peut rejeter (base, envoi) : sans ce filet, la promesse rejetée
    // laissait la requête sans réponse. Ce routeur n'a pas le wrapper route() de
    // server.ts, d'où le try/catch local.
    try {
      const key = 'test|' + Date.now().toString(36);
      const report = await notify(key, [me], { kind: 'test', title: 'Foyer : test', body: 'Si vous lisez ceci, les rappels arrivent sur cet appareil.', url: appUrl() });
      const m = report.members[0];
      log.info(`Notifications : test pour ${me} → ${m.status}${m.error ? ' (' + m.error + ')' : ''}`);
      res.json(m);
    } catch (e) {
      log.erreur('Notifications : test impossible', e);
      res.status(500).json({ error: 'Erreur interne du serveur.' });
    }
  });

  return r;
}
