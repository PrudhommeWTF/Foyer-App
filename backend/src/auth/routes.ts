// Surface HTTP des comptes et des sessions, montée sous /api : création du foyer
// (onboarding), connexion en un ou deux temps (second facteur), déconnexion, le
// compte courant et ses identifiants, l'enrôlement/retrait du second facteur, et
// la gestion des accès des membres par un administrateur.
//
// Dernier gros bloc sorti de server.ts. Il s'appuie sur le kit d'authentification
// (auth/session.ts) qu'il importe directement, et porte ses propres garde-fous de
// débit (authLimiter) et compteurs de temporisation (parCompte/parAdresse), qui
// ne servaient qu'ici.
import express, { Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  countUsers, createUserWithMember, findUserByEmail, getUserById, getUserByMemberId,
  getHousehold, saveHousehold, listMemberAccounts, deleteUser, setPasswordHash,
  updateUserCredentials, activerTotp, desactiverTotp, setTotpPending, setTotpRecovery,
  totpRecovery, setTotpLastStep, SecoursRange, db,
} from '../db';
import { buildInitialState, HouseholdState } from '../seed';
import { aRehacher, hacher, verifier } from './passwords';
import { empreinteSecours, genererSecours, genererSecret, otpauthUri, secretLisible, verifierCode } from './totp';
import { SEUILS_ADRESSE, SEUILS_COMPTE, Throttle, messageAttente } from './throttle';
import { log } from '../log';
import {
  AuthedRequest, SESSION_COOKIE, aRenouveler, auth, currentMember, hashLeurre, motDePasseBon,
  ouvrirSession, pwdMin, pwdTropCourt, requireAdmin, route, setSessionCookie, sign, signerDefi, verifierDefi,
} from './session';

const EMAIL_RE = /^\S+@\S+\.\S+$/;
const jsonSmall = express.json({ limit: '256kb' });

/**
 * Le garde-fou grossier des routes d'identifiants : il borne le débit brut, pas
 * les tentatives. La vraie temporisation est dans auth/throttle.ts, par compte
 * visé et par adresse, et c'est elle qui distingue un attaquant d'une famille.
 *
 * Les requêtes **réussies ne comptent plus** : sans cela, trente connexions
 * légitimes dans le quart d'heure fermaient la porte à la trente-et-unième, et
 * un foyer de cinq personnes sur quatre appareils y arrive.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez dans quelques minutes.' },
});

/**
 * Les deux compteurs de tentatives : par compte visé, et par adresse. Voir
 * auth/throttle.ts pour les seuils et la raison de leur écart.
 */
const parCompte = new Throttle(SEUILS_COMPTE);
const parAdresse = new Throttle(SEUILS_ADRESSE);

export function authRouter(): Router {
  const r = express.Router();

  // ---- First-run setup (onboarding) ----
  r.get('/setup/status', (_req, res) => {
    res.json({ needsSetup: countUsers() === 0 });
  });

  r.post('/setup', authLimiter, jsonSmall, route(async (req, res) => {
    if (countUsers() > 0) {
      res.status(409).json({ error: 'La configuration a déjà été effectuée' });
      return;
    }
    const { household, admin, members } = req.body || {};
    if (!household?.name?.trim()) { res.status(400).json({ error: 'Le nom du foyer est requis' }); return; }
    if (!admin?.name?.trim()) { res.status(400).json({ error: 'Votre prénom est requis' }); return; }
    if (!admin?.email?.trim() || !EMAIL_RE.test(String(admin.email).trim())) { res.status(400).json({ error: 'Email administrateur invalide' }); return; }
    if (String(admin.password || '').length < pwdMin()) { res.status(400).json({ error: pwdTropCourt() }); return; }

    // Normalise members (drop nameless entries) and validate optional per-member credentials.
    const rawMembers = Array.isArray(members) ? members : [];
    const normMembers = rawMembers
      .filter((m: { name?: string }) => (m?.name || '').trim())
      .map((m: { name: string; role?: string; color?: string; email?: string; password?: string; birthday?: string | null }, i: number) => ({
        id: 'm' + (i + 1),
        name: String(m.name).trim(),
        role: (m.role || '').trim(),
        color: m.color || '#4E93B8',
        birthday: m.birthday || null,
        email: (m.email || '').trim(),
        password: m.password || '',
      }));

    for (const m of normMembers) {
      const hasEmail = !!m.email;
      const hasPwd = !!m.password;
      if (hasEmail !== hasPwd) { res.status(400).json({ error: `Membre « ${m.name} » : renseignez email ET mot de passe, ou aucun des deux` }); return; }
      if (hasEmail && !EMAIL_RE.test(m.email)) { res.status(400).json({ error: `Email invalide pour « ${m.name} »` }); return; }
      if (hasPwd && m.password.length < pwdMin()) { res.status(400).json({ error: `Mot de passe de « ${m.name} » : ${pwdMin()} caractères minimum` }); return; }
    }

    // Every login email must be unique (across admin + members) and not already taken.
    const logins = [String(admin.email).trim(), ...normMembers.filter((m) => m.email).map((m) => m.email)].map((e) => e.toLowerCase());
    if (new Set(logins).size !== logins.length) { res.status(400).json({ error: 'Deux comptes utilisent le même email' }); return; }
    for (const e of logins) { if (findUserByEmail(e)) { res.status(409).json({ error: `Un compte existe déjà avec l'email ${e}` }); return; } }

    const state = buildInitialState({
      household: { name: household.name, theme: household.theme, academie: household.academie },
      admin: { name: admin.name, role: admin.role, color: admin.color, email: admin.email, birthday: admin.birthday || null },
      members: normMembers.map((m) => ({ id: m.id, name: m.name, role: m.role, color: m.color, birthday: m.birthday, email: m.email || undefined })),
    });

    // Hacher d'abord (asynchrone), écrire ensuite, en une seule transaction. Sinon
    // un INSERT qui échoue à mi-chemin (double soumission, disque plein) laisse un
    // admin sans foyer : countUsers() > 0 fait alors répondre 409 à /setup, et
    // l'installation est bloquée sans interface pour s'en sortir. Tout ou rien.
    const adminHash = await hacher(String(admin.password));
    const memberCreds: { email: string; hash: string; name: string; id: string }[] = [];
    for (const m of normMembers) {
      if (m.email && m.password) memberCreds.push({ email: m.email, hash: await hacher(m.password), name: m.name, id: m.id });
    }
    const adminUser = db.transaction(() => {
      const au = createUserWithMember(String(admin.email), adminHash, String(admin.name).trim(), state.members[0].id);
      for (const c of memberCreds) createUserWithMember(c.email, c.hash, c.name, c.id);
      saveHousehold(state);
      return au;
    })();
    ouvrirSession(req, res, adminUser, true, 201);
  }));

  r.post('/auth/login', authLimiter, jsonSmall, route(async (req, res) => {
    const { email, password } = req.body || {};
    // « Se souvenir de moi » (défaut oui) : décide de la durée du cookie, et
    // voyage jusqu'au second facteur via le défi pour ne pas être perdu en route.
    const remember = req.body?.remember !== false;
    if (!email || !password) {
      res.status(400).json({ error: 'Email et mot de passe requis' });
      return;
    }
    const cible = String(email).trim().toLowerCase();
    const adresse = req.ip || 'inconnue';
    const now = Date.now();

    // Le compte visé d'abord : c'est lui qu'un bourrage distribué garde constant
    // pendant qu'il change d'adresse.
    const attente = Math.max(parCompte.attente(cible, now), parAdresse.attente(adresse, now));
    if (attente > 0) {
      log.attention(`Connexion refusée (temporisation, ${Math.ceil(attente / 1000)} s) pour ${cible} depuis ${adresse}.`);
      res.status(429).set('Retry-After', String(Math.ceil(attente / 1000))).json({ error: messageAttente(attente) });
      return;
    }

    const user = findUserByEmail(cible);
    // Le compte inconnu paie la même vérification que le compte connu : sans cela
    // le chronomètre dit lequel des deux existe. Voir HASH_LEURRE.
    const bon = await verifier(String(password), user ? user.password_hash : await hashLeurre());
    if (!user || !bon) {
      parCompte.echec(cible, now);
      parAdresse.echec(adresse, now);
      log.attention(`Connexion refusée pour ${cible} depuis ${adresse}.`);
      res.status(401).json({ error: 'Identifiants invalides' });
      return;
    }
    // Seul instant où le mot de passe en clair est disponible : on en profite pour
    // refaire un condensat trop faible. Personne n'a rien à faire, et le parc se
    // met à niveau au fil des connexions. La version du jeton ne bouge pas.
    if (aRehacher(user.password_hash)) {
      try { setPasswordHash(user.id, await hacher(String(password))); log.info(`Compte : condensat de ${user.email} remis au coût courant.`); }
      catch (e) { log.attention('Compte : remise à niveau du condensat impossible', e); }
    }

    // Second facteur posé : le mot de passe ne suffit pas, et l'ardoise n'est
    // **pas** effacée. L'effacer ici laisserait qui détient le mot de passe
    // essayer un million de codes sans jamais recroiser la temporisation.
    if (user.totp_secret) {
      log.info(`Connexion : mot de passe accepté pour ${user.email} depuis ${adresse}, code du second facteur attendu.`);
      res.json({ totpRequired: true, challenge: signerDefi(user, remember) });
      return;
    }

    parCompte.succes(cible);
    parAdresse.succes(adresse);
    log.info(`Connexion réussie : ${user.email} depuis ${adresse}.`);
    ouvrirSession(req, res, user, remember);
  }));

  // Il n'y a pas d'inscription libre : un accès s'ouvre depuis la fiche d'un
  // membre (`POST /members/:memberId/account`, réservé à un administrateur), ce qui
  // rattache le compte à quelqu'un du foyer. Un formulaire d'inscription public
  // n'aurait produit que des comptes sans membre, c'est-à-dire sans accès à quoi
  // que ce soit, tout en offrant à Internet une route de création de comptes.

  /**
   * Le second temps de la connexion : le code du téléphone, ou un code de secours.
   *
   * Le défi remis au premier temps ne vaut rien d'autre que cela : il est signé
   * avec un autre secret que les sessions, il porte la version du jeton du compte,
   * et il expire en cinq minutes.
   *
   * La temporisation continue de courir sur le compte visé. Un code fait six
   * chiffres, soit un million de combinaisons : sans elle, quelqu'un qui détient
   * le mot de passe les essaierait toutes en une soirée, et le second facteur ne
   * serait qu'un ralentisseur.
   */
  r.post('/auth/login/totp', authLimiter, jsonSmall, route(async (req, res) => {
    const adresse = req.ip || 'inconnue';
    const now = Date.now();

    let charge: { id: number; tv: number; rm?: boolean };
    try {
      charge = verifierDefi(String(req.body?.challenge ?? ''));
    } catch {
      res.status(401).json({ error: 'Cette demande de connexion a expiré. Reprenez depuis votre mot de passe.' });
      return;
    }

    const user = getUserById(charge.id);
    // Le mot de passe a changé entre les deux temps : le défi ne vaut plus.
    if (!user || user.token_version !== charge.tv || !user.totp_secret) {
      res.status(401).json({ error: 'Cette demande de connexion n’est plus valable. Reprenez depuis votre mot de passe.' });
      return;
    }

    const cible = user.email;
    const attente = Math.max(parCompte.attente(cible, now), parAdresse.attente(adresse, now));
    if (attente > 0) {
      log.attention(`Second facteur refusé (temporisation, ${Math.ceil(attente / 1000)} s) pour ${cible} depuis ${adresse}.`);
      res.status(429).set('Retry-After', String(Math.ceil(attente / 1000))).json({ error: messageAttente(attente) });
      return;
    }

    const saisi = String(req.body?.code ?? '');
    const pas = verifierCode(user.totp_secret, saisi, now);

    if (pas !== null) {
      // Un code lu par-dessus une épaule reste valable une trentaine de secondes.
      // Le pas déjà consommé ferme cette fenêtre.
      if (pas <= user.totp_last_step) {
        parCompte.echec(cible, now);
        parAdresse.echec(adresse, now);
        log.attention(`Second facteur refusé (code déjà utilisé) pour ${cible} depuis ${adresse}.`);
        res.status(401).json({ error: 'Ce code a déjà servi. Attendez le suivant sur votre téléphone.' });
        return;
      }
      setTotpLastStep(user.id, pas);
    } else {
      // Pas un code du téléphone : peut-être un code de secours.
      const secours = totpRecovery(user);
      const empreinte = empreinteSecours(saisi);
      const i = secours.findIndex((c) => !c.used && c.h === empreinte);
      if (i < 0) {
        parCompte.echec(cible, now);
        parAdresse.echec(adresse, now);
        log.attention(`Second facteur refusé pour ${cible} depuis ${adresse}.`);
        res.status(401).json({ error: 'Code incorrect.' });
        return;
      }
      secours[i].used = true;
      setTotpRecovery(user.id, secours);
      const restants = secours.filter((c) => !c.used).length;
      log.attention(`Connexion par code de secours : ${cible} depuis ${adresse}, ${restants} code(s) restant(s).`);
    }

    parCompte.succes(cible);
    parAdresse.succes(adresse);
    log.info(`Connexion réussie (second facteur) : ${user.email} depuis ${adresse}.`);
    const remember = charge.rm !== false;
    ouvrirSession(req, res, user, remember);
  }));

  /**
   * Efface le cookie de session. Indispensable maintenant qu'il est `HttpOnly` :
   * le JavaScript ne peut plus le retirer lui-même. Aucune authentification n'est
   * exigée, effacer son propre cookie ne compromettant rien ; la révocation
   * serveur, elle, passe toujours par le changement de mot de passe (token_version).
   */
  r.post('/auth/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // ---- Current user ----
  r.get('/me', auth, (req: AuthedRequest, res: Response) => {
    const u = req.user ? getUserById(req.user.id) : undefined;
    if (!u) { res.status(401).json({ error: 'Non authentifié' }); return; }
    // Renouvellement à mi-vie : on repose le cookie avec la même durée que la
    // session, sans rien demander à l'utilisateur. Le jeton reste aussi dans le
    // corps pour les clients en en-tête Bearer.
    const renouvele = aRenouveler(req.user) ? sign(u, req.user?.rm ?? true) : '';
    if (renouvele) setSessionCookie(req, res, renouvele, req.user?.rm ?? true);
    // L'identifiant du membre vient de la fiche telle qu'elle existe, pas de la
    // colonne : un membre retiré du foyer laisse son compte derrière lui, et
    // renvoyer l'identifiant d'une fiche disparue ferait pointer l'application sur
    // un fantôme. Rien plutôt qu'un mensonge, et l'écran sait alors quoi dire.
    const m = currentMember(req);
    const secours = totpRecovery(u).filter((c) => !c.used).length;
    res.json({
      email: u.email, name: u.name, memberId: m?.id ?? null, admin: !!m?.admin, enfant: !!m?.enfant,
      totp: !!u.totp_secret,
      // Combien de codes de secours restent : l'écran doit pouvoir alerter avant
      // qu'il n'en reste zéro, pas après.
      totpRecoveryLeft: u.totp_secret ? secours : null,
      // Un jeton émis vivait sa durée entière sans jamais tourner : volé le
      // premier jour, il servait encore le dernier. Passé la moitié de sa vie, on
      // en rend un neuf (cookie reposé ci-dessus). Rien à faire pour l'utilisateur,
      // et la fenêtre d'un jeton dérobé se referme d'elle-même.
      ...(renouvele ? { token: renouvele } : {}),
    });
  });

  /**
   * Ses propres identifiants, changés par soi-même.
   *
   * Les routes `/members/:id/account` sont réservées à un administrateur : elles
   * servent à ouvrir un accès à quelqu'un d'autre. Ici, chacun change son adresse
   * et son mot de passe sans passer par personne, mais **en redonnant son mot de
   * passe actuel** : sans cela, un téléphone déverrouillé laissé sur la table
   * suffirait à s'approprier le compte.
   *
   * Changer le mot de passe incrémente `token_version`, donc **déconnecte les
   * autres sessions** : c'est le but. La session en cours, elle, reçoit un jeton
   * neuf, sinon on se déconnecterait soi-même en se protégeant.
   */
  r.put('/me/credentials', authLimiter, auth, jsonSmall, route(async (req, res) => {
    const user = req.user ? getUserById(req.user.id) : undefined;
    if (!user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    if (!await motDePasseBon(req, user, 'currentPassword')) {
      res.status(403).json({ error: 'Mot de passe actuel incorrect' });
      return;
    }
    let email: string | undefined;
    let password: string | undefined;
    const rawEmail = req.body?.email;
    if (rawEmail !== undefined && String(rawEmail).trim().toLowerCase() !== user.email) {
      email = String(rawEmail).trim();
      if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'Email invalide' }); return; }
      if (findUserByEmail(email)) { res.status(409).json({ error: 'Cet email est déjà utilisé' }); return; }
    }
    const rawPassword = req.body?.password;
    if (rawPassword !== undefined && String(rawPassword) !== '') {
      password = String(rawPassword);
      if (password.length < pwdMin()) { res.status(400).json({ error: pwdTropCourt() }); return; }
      if (password === String(req.body?.currentPassword ?? '')) {
        res.status(400).json({ error: 'Le nouveau mot de passe est identique à l’ancien' });
        return;
      }
    }
    if (email === undefined && password === undefined) { res.status(400).json({ error: 'Rien à mettre à jour' }); return; }
    updateUserCredentials(user.id, email, password === undefined ? undefined : await hacher(password));
    const frais = getUserById(user.id);
    if (!frais) { res.status(500).json({ error: 'Compte introuvable après modification' }); return; }
    log.info(`Compte : ${user.email} (depuis ${req.ip || 'adresse inconnue'}) a changé ${email && password ? 'son adresse et son mot de passe' : email ? 'son adresse de connexion' : 'son mot de passe'}.`);
    // Changer le mot de passe incrémente token_version et invalide donc le cookie
    // actuel : on repose immédiatement un cookie frais pour ne pas se déconnecter
    // soi-même en se protégeant.
    const rester = req.user as AuthedRequest['user'];
    const token = sign(frais, rester?.rm ?? true);
    setSessionCookie(req, res, token, rester?.rm ?? true);
    res.json({ email: frais.email, token, othersLoggedOut: password !== undefined });
  }));

  // ---- Second facteur (TOTP), géré par chacun pour lui-même ----
  //
  // Comme `/me/credentials`, ces routes restent ouvertes à un compte sans membre :
  // protéger son compte ne doit dépendre de personne, et un compte qui n'accède à
  // rien n'a rien de plus à perdre en le faisant.
  //
  // Chaque geste qui touche au second facteur redemande le **mot de passe**. Sans
  // cela, un téléphone déverrouillé laissé sur la table suffirait à retirer la
  // protection qu'on vient de poser, ou à en poser une que son propriétaire ne
  // connaît pas.

  /**
   * Premier temps de l'enrôlement : un secret est engendré et **mis de côté**.
   *
   * Il ne protège rien tant que la personne n'a pas prouvé, par un code, que son
   * téléphone le lit bien. Sans ce second temps, une saisie de travers dans
   * l'application d'authentification fermerait le compte au prochain démarrage,
   * et il faudrait un administrateur pour le rouvrir.
   */
  r.post('/me/totp/start', authLimiter, auth, jsonSmall, route(async (req, res) => {
    const user = req.user ? getUserById(req.user.id) : undefined;
    if (!user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    if (!await motDePasseBon(req, user)) {
      log.attention(`Second facteur : mot de passe incorrect à l’enrôlement de ${user.email}.`);
      res.status(403).json({ error: 'Mot de passe incorrect.' });
      return;
    }
    if (user.totp_secret) {
      res.status(409).json({ error: 'Le second facteur est déjà actif sur ce compte. Retirez-le d’abord si vous voulez le reconfigurer.' });
      return;
    }
    const secret = genererSecret();
    setTotpPending(user.id, secret);
    res.json({
      secret,
      // Le même secret, présenté à l'oeil : toutes les applications ne savent pas
      // lire un QR code, et il faut alors pouvoir le recopier sans se perdre.
      secretLisible: secretLisible(secret),
      uri: otpauthUri(secret, user.email),
    });
  }));

  /**
   * Second temps : le code prouve que le téléphone lit le bon secret, et le
   * second facteur s'active. Les codes de secours ne sont montrés qu'ici, une
   * seule fois : ils ne sont pas rangés en clair.
   */
  r.post('/me/totp/enable', authLimiter, auth, jsonSmall, route(async (req, res) => {
    const user = req.user ? getUserById(req.user.id) : undefined;
    if (!user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    if (!user.totp_pending) {
      res.status(409).json({ error: 'Aucun enrôlement en cours. Recommencez depuis le début.' });
      return;
    }
    const pas = verifierCode(user.totp_pending, String(req.body?.code ?? ''), Date.now());
    if (pas === null) {
      log.attention(`Second facteur : code invalide à l’activation de ${user.email}.`);
      res.status(400).json({ error: 'Ce code ne correspond pas. Vérifiez l’heure de votre téléphone, puis réessayez avec le code affiché.' });
      return;
    }
    const codes = genererSecours();
    const ranges: SecoursRange[] = codes.map((c) => ({ h: empreinteSecours(c), used: false }));
    activerTotp(user.id, user.totp_pending, ranges, pas);
    log.info(`Second facteur activé pour ${user.email}.`);
    res.json({ enabled: true, recovery: codes });
  }));

  /**
   * Retirer son second facteur : mot de passe **et** code en cours. Le mot de
   * passe seul suffirait à qui l'a volé, ce qui reviendrait à ne pas avoir de
   * second facteur du tout.
   */
  r.post('/me/totp/disable', authLimiter, auth, jsonSmall, route(async (req, res) => {
    const user = req.user ? getUserById(req.user.id) : undefined;
    if (!user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    if (!user.totp_secret) { res.status(409).json({ error: 'Le second facteur n’est pas actif sur ce compte.' }); return; }
    if (!await motDePasseBon(req, user)) {
      res.status(403).json({ error: 'Mot de passe incorrect.' });
      return;
    }
    const saisi = String(req.body?.code ?? '');
    const parCode = verifierCode(user.totp_secret, saisi, Date.now()) !== null;
    const parSecours = totpRecovery(user).some((c) => !c.used && c.h === empreinteSecours(saisi));
    if (!parCode && !parSecours) {
      log.attention(`Second facteur : code invalide au retrait pour ${user.email}.`);
      res.status(403).json({ error: 'Code incorrect. Utilisez le code de votre téléphone, ou l’un de vos codes de secours.' });
      return;
    }
    desactiverTotp(user.id);
    log.attention(`Second facteur retiré par ${user.email} depuis ${req.ip}.`);
    res.json({ enabled: false });
  }));

  /**
   * Refaire ses codes de secours, quand il n'en reste plus assez ou qu'on a perdu
   * le papier. Les anciens cessent immédiatement de valoir.
   */
  r.post('/me/totp/recovery', authLimiter, auth, jsonSmall, route(async (req, res) => {
    const user = req.user ? getUserById(req.user.id) : undefined;
    if (!user) { res.status(401).json({ error: 'Non authentifié' }); return; }
    if (!user.totp_secret) { res.status(409).json({ error: 'Le second facteur n’est pas actif sur ce compte.' }); return; }
    if (!await motDePasseBon(req, user)) {
      res.status(403).json({ error: 'Mot de passe incorrect.' });
      return;
    }
    if (verifierCode(user.totp_secret, String(req.body?.code ?? ''), Date.now()) === null) {
      res.status(403).json({ error: 'Code incorrect.' });
      return;
    }
    const codes = genererSecours();
    setTotpRecovery(user.id, codes.map((c) => ({ h: empreinteSecours(c), used: false })));
    log.info(`Second facteur : codes de secours refaits pour ${user.email}.`);
    res.json({ recovery: codes });
  }));

  // ---- Member login accounts (admin-managed) ----
  // Réservée à un administrateur : cette liste est l'inventaire exact des
  // identifiants à attaquer, et les adresses personnelles de la famille avec.
  // L'écran qui s'en sert est déjà celui de la gestion des accès.
  r.get('/members/accounts', auth, requireAdmin, (_req, res) => {
    // Qui a posé un second facteur : sans cette colonne, un administrateur ne peut
    // pas savoir où en est le foyer, ni à qui le proposer.
    const accounts = listMemberAccounts().map((a) => ({
      ...a,
      totp: !!getUserByMemberId(a.memberId)?.totp_secret,
    }));
    res.json({ accounts });
  });

  r.post('/members/:memberId/account', auth, requireAdmin, jsonSmall, route(async (req, res) => {
    const memberId = req.params.memberId;
    const state = getHousehold().state as HouseholdState;
    const member = state.members.find((m) => m.id === memberId);
    if (!member) { res.status(404).json({ error: 'Membre introuvable (enregistrez-le d’abord)' }); return; }
    if (getUserByMemberId(memberId)) { res.status(409).json({ error: 'Ce membre a déjà un accès' }); return; }
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'Email invalide' }); return; }
    if (password.length < pwdMin()) { res.status(400).json({ error: pwdTropCourt() }); return; }
    if (findUserByEmail(email)) { res.status(409).json({ error: 'Cet email est déjà utilisé' }); return; }
    createUserWithMember(email, await hacher(password), member.name, memberId);
    res.status(201).json({ memberId, email: email.toLowerCase() });
  }));

  r.put('/members/:memberId/account', auth, requireAdmin, jsonSmall, route(async (req, res) => {
    const memberId = req.params.memberId;
    const user = getUserByMemberId(memberId);
    if (!user) { res.status(404).json({ error: 'Ce membre n’a pas d’accès' }); return; }
    const rawEmail = req.body?.email;
    const rawPassword = req.body?.password;
    let email: string | undefined;
    let password: string | undefined;
    if (rawEmail !== undefined && String(rawEmail).trim().toLowerCase() !== user.email) {
      email = String(rawEmail).trim();
      if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'Email invalide' }); return; }
      if (findUserByEmail(email)) { res.status(409).json({ error: 'Cet email est déjà utilisé' }); return; }
    }
    if (rawPassword !== undefined && String(rawPassword) !== '') {
      password = String(rawPassword);
      if (password.length < pwdMin()) { res.status(400).json({ error: pwdTropCourt() }); return; }
    }
    if (email === undefined && password === undefined) { res.status(400).json({ error: 'Rien à mettre à jour' }); return; }
    updateUserCredentials(user.id, email, password === undefined ? undefined : await hacher(password));
    res.json({ memberId, email: (email ?? user.email).toLowerCase() });
  }));

  /**
   * Le téléphone d'un membre est perdu, cassé ou réinitialisé, et ses codes de
   * secours avec : un administrateur retire son second facteur.
   *
   * C'est la sortie de secours de dernier recours, et elle a un prix : elle veut
   * dire qu'un administrateur compromis peut retirer le second facteur de toute la
   * famille. C'est le compromis assumé, faute de quoi un accident de téléphone
   * fermerait un compte définitivement. Le mot de passe de l'administrateur est
   * redemandé, et le geste est journalisé.
   */
  r.post('/members/:memberId/totp/reset', auth, requireAdmin, jsonSmall, route(async (req, res) => {
    const moi = req.user ? getUserById(req.user.id) : undefined;
    if (!moi || !await motDePasseBon(req, moi)) {
      res.status(403).json({ error: 'Mot de passe incorrect. Ce geste retire la protection d’un autre compte : il se confirme par votre mot de passe.' });
      return;
    }
    const user = getUserByMemberId(String(req.params.memberId));
    if (!user) { res.status(404).json({ error: 'Ce membre n’a pas d’accès' }); return; }
    // Un enrôlement commencé et jamais confirmé compte aussi : le laisser traîner
    // ferait échouer une reconfiguration par un « déjà actif » que rien n'explique.
    if (!user.totp_secret && !user.totp_pending) {
      res.status(409).json({ error: 'Ce compte n’a pas de second facteur.' });
      return;
    }
    desactiverTotp(user.id);
    log.attention(`Second facteur de ${user.email} retiré par l’administrateur ${moi.email} depuis ${req.ip}.`);
    res.json({ enabled: false });
  }));

  r.delete('/members/:memberId/account', auth, requireAdmin, (req: AuthedRequest, res: Response) => {
    const memberId = req.params.memberId;
    const user = getUserByMemberId(memberId);
    if (!user) { res.status(404).json({ error: 'Ce membre n’a pas d’accès' }); return; }
    if (req.user && user.id === req.user.id) { res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre accès' }); return; }
    deleteUser(user.id);
    res.json({ ok: true });
  });

  return r;
}
