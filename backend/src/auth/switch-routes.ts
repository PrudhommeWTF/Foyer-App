// Le portail enfant : un parent ouvre, sur son appareil, la session d'un enfant
// du foyer, et la reprend en redonnant son mot de passe.
//
// Rien de nouveau dans les droits. La session ouverte est celle du membre
// enfant, avec exactement les gardes d'une session d'enfant ordinaire ; ce
// fichier ne règle que la façon d'y entrer et d'en sortir.
//
//   - **Entrer** est un acte du parent : réservé à une session d'adulte, jamais
//     par un jeton d'accès (donc jamais par un assistant), jamais depuis la
//     session d'un enfant. Le cookie du parent est **remplacé**, pas gardé de
//     côté : il n'y a qu'une session sur l'appareil, et c'est celle de l'enfant.
//   - **Sortir** exige le mot de passe du parent, puis son code s'il a posé un
//     second facteur, avec les mêmes compteurs que la connexion (auth/limits.ts).
//     Un échec laisse la session de l'enfant telle quelle.
//
// Chaque entrée et chaque sortie est journalisée, et retenue dans
// `auth_switches` (auth/switches.ts), que la fiche de l'enfant affiche.
import express, { Response, Router } from 'express';
import { HouseholdState } from '../models';
import { getHousehold, getUserById, UserRow } from '../db';
import { verifier } from './passwords';
import { log } from '../log';
import { authLimiter, echec, jsonSmall, Refus, succes, temporisation, verifierSecondFacteur } from './limits';
import { appareil, closeSwitch, extendSwitch, getSwitch, listSwitches, openSwitch } from './switches';
import {
  AuthedRequest, auth, currentMember, denySwitched, denyToken, requireAdulte, route, setSessionCookie, sign,
  signSwitched, signerDefi, verifierDefi,
} from './session';

const members = (): HouseholdState['members'] => (getHousehold().state as HouseholdState).members;
const nomDe = (id: string | null): string => (id && members().find((m) => m.id === id)?.name) || 'un membre retiré';

/** L'écran d'où le parent est parti, pour l'y ramener : un identifiant d'écran, rien d'autre. */
const ecran = (v: unknown): string | null => (typeof v === 'string' && /^[a-z][a-z-]{0,31}$/.test(v) ? v : null);

function refuser(res: Response, r: Refus): void {
  if (r.retryAfter) res.set('Retry-After', String(r.retryAfter));
  res.status(r.status).json({ error: r.error });
}

/**
 * Le retour a réussi : la ligne du journal se referme, le cookie du parent est
 * réémis (sa durée d'origine), et la réponse dit vers quel écran revenir.
 */
function reprendre(req: AuthedRequest, res: Response, parent: UserRow): void {
  const sw = req.switched!;
  const row = getSwitch(sw.sid);
  closeSwitch(sw.sid, 'retour', sw.viaMemberId);
  log.info(`Portail enfant : ${nomDe(sw.viaMemberId)} (${parent.email}) a repris sa session, fin de celle de ${nomDe(sw.memberId)} sur ${row?.device || 'un appareil'} (${req.ip || 'adresse inconnue'}).`);
  setSessionCookie(req, res, sign(parent, sw.remember), sw.remember);
  res.json({ user: { email: parent.email, name: parent.name, memberId: parent.member_id }, from: row?.from_screen ?? null });
}

export function switchRouter(): Router {
  const r = express.Router();

  /**
   * Revenir au parent, premier temps : son mot de passe. Les compteurs sont ceux
   * de la connexion, sur l'adresse du parent : un enfant qui s'acharne sur
   * l'iPad bute sur la même temporisation que n'importe qui d'autre.
   */
  r.post('/auth/switch/back', authLimiter, auth, denyToken, jsonSmall, route(async (req, res) => {
    const sw = req.switched;
    if (!sw) { res.status(409).json({ error: 'Aucune session d’enfant n’est ouverte sur cet appareil.' }); return; }
    const parent = getUserById(sw.via)!;
    const adresse = req.ip || 'inconnue';
    const now = Date.now();
    const attendre = temporisation(parent.email, adresse, now, 'Retour au parent');
    if (attendre) { refuser(res, attendre); return; }
    if (!await verifier(String(req.body?.password ?? ''), parent.password_hash)) {
      echec(parent.email, adresse, now);
      log.attention(`Portail enfant : retour refusé, mot de passe de ${parent.email} incorrect depuis la session de ${nomDe(sw.memberId)} (${adresse}).`);
      res.status(401).json({ error: 'Mot de passe incorrect.' });
      return;
    }
    // Second facteur posé : comme à la connexion, l'ardoise n'est pas effacée
    // avant le code, sinon qui détient le mot de passe essaierait les codes sans fin.
    if (parent.totp_secret) {
      res.json({ totpRequired: true, challenge: signerDefi(parent, sw.remember, sw.sid) });
      return;
    }
    succes(parent.email, adresse);
    reprendre(req, res, parent);
  }));

  /** Revenir au parent, second temps : le code de son téléphone, ou un code de secours. */
  r.post('/auth/switch/back/totp', authLimiter, auth, denyToken, jsonSmall, route(async (req, res) => {
    const sw = req.switched;
    if (!sw) { res.status(409).json({ error: 'Aucune session d’enfant n’est ouverte sur cet appareil.' }); return; }
    let charge: { id: number; tv: number; sb?: number };
    try { charge = verifierDefi(String(req.body?.challenge ?? '')); } catch {
      res.status(401).json({ error: 'Cette demande a expiré. Reprenez depuis votre mot de passe.' });
      return;
    }
    const parent = getUserById(sw.via)!;
    // Le défi doit être né de **cette** session d'enfant, pour **ce** parent, et
    // le mot de passe ne doit pas avoir changé entre-temps.
    if (charge.sb !== sw.sid || charge.id !== parent.id || charge.tv !== parent.token_version || !parent.totp_secret) {
      res.status(401).json({ error: 'Cette demande n’est plus valable. Reprenez depuis votre mot de passe.' });
      return;
    }
    const refus = verifierSecondFacteur(parent, String(req.body?.code ?? ''), req.ip || 'inconnue', Date.now());
    if (refus) { refuser(res, refus); return; }
    reprendre(req, res, parent);
  }));

  /**
   * Ouvrir la session d'un enfant du foyer. Un geste du parent, sans
   * confirmation : il est dans sa propre session, et le retour, lui, se paie
   * d'un mot de passe.
   */
  r.post('/auth/switch/:memberId', auth, denyToken, denySwitched, requireAdulte, jsonSmall, (req: AuthedRequest, res: Response) => {
    const parent = req.user ? getUserById(req.user.id) : undefined;
    const moi = currentMember(req);
    if (!parent || !moi) { res.status(401).json({ error: 'Non authentifié' }); return; }
    const child = members().find((m) => m.id === req.params.memberId);
    if (!child) { res.status(404).json({ error: 'Membre introuvable.' }); return; }
    if (!child.enfant) { res.status(403).json({ error: 'Seule la session d’un enfant du foyer peut s’ouvrir depuis la vôtre.' }); return; }
    const device = appareil(String(req.headers['user-agent'] || ''), req.body?.tactile === true);
    const at = new Date().toISOString();
    // La ligne naît avant le jeton, qui porte son identifiant ; son échéance
    // réelle est posée juste après la signature.
    // La session de l'enfant survit à la fermeture de l'application (l'iPad reste
    // « Raphaël » jusqu'au retour d'un parent) : son cookie est toujours durable.
    // Le retour, lui, rend au parent la durée qu'il avait choisie.
    const remember = req.user?.rm ?? true;
    const sid = openSwitch({
      parentUserId: parent.id, parentMemberId: moi.id, childMemberId: child.id, device,
      fromScreen: ecran(req.body?.from), remember, startedAt: at, expiresAt: at,
    });
    const { token, expiresAt } = signSwitched({ mid: child.id, via: parent.id, vtv: parent.token_version, sid, at });
    extendSwitch(sid, expiresAt);
    setSessionCookie(req, res, token, true);
    log.info(`Portail enfant : ${moi.name} (${parent.email}) a ouvert la session de ${child.name} sur ${device} (${req.ip || 'adresse inconnue'}).`);
    res.json({ memberId: child.id, name: child.name, expiresAt });
  });

  /**
   * Le journal des sessions ouvertes pour un enfant, pour sa fiche dans
   * Paramètres → Membres : qui, quand, sur quel appareil, et si elle est encore
   * ouverte. Réservé aux adultes, comme l'écran qui l'affiche.
   */
  r.get('/members/:memberId/switches', auth, denyToken, requireAdulte, (req: AuthedRequest, res: Response) => {
    const now = new Date().toISOString();
    res.json({
      switches: listSwitches(String(req.params.memberId)).map((s) => ({
        id: s.id, by: s.parent_member_id, byName: nomDe(s.parent_member_id), device: s.device,
        startedAt: s.started_at, endedAt: s.ended_at, endReason: s.end_reason,
        endedBy: s.ended_by_member_id, open: !s.ended_at && s.expires_at > now,
      })),
    });
  });

  /**
   * Fermer à distance une session d'enfant : l'iPad est resté chez les
   * grands-parents, ou il a disparu. La session ne vaut plus dès la requête
   * suivante de l'appareil, qui revient à l'écran de connexion.
   */
  r.post('/members/:memberId/switches/:sid/close', auth, denyToken, requireAdulte, (req: AuthedRequest, res: Response) => {
    const sid = parseInt(String(req.params.sid), 10);
    const row = Number.isInteger(sid) ? getSwitch(sid) : undefined;
    if (!row || row.child_member_id !== req.params.memberId) { res.status(404).json({ error: 'Session introuvable.' }); return; }
    const moi = currentMember(req)!;
    if (!closeSwitch(sid, 'fermee', moi.id)) { res.status(409).json({ error: 'Cette session est déjà fermée.' }); return; }
    log.info(`Portail enfant : ${moi.name} a fermé à distance la session de ${nomDe(row.child_member_id)} sur ${row.device}.`);
    res.json({ ok: true });
  });

  return r;
}
