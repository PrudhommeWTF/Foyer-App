// Ce que la connexion et le retour d'une session d'enfant partagent : le
// garde-fou de débit, les deux compteurs de temporisation et la vérification du
// second facteur.
//
// Partager les **instances** est le but, pas une commodité : le retour depuis
// la session d'un enfant se vérifie contre le mot de passe d'un parent, et un
// enfant qui s'acharne sur l'iPad doit buter sur le même compteur que
// quelqu'un qui s'acharnerait sur l'écran de connexion. Deux compteurs séparés
// doubleraient le nombre d'essais permis.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { UserRow, setTotpLastStep, setTotpRecovery, totpRecovery } from '../db';
import { empreinteSecours, verifierCode } from './totp';
import { SEUILS_ADRESSE, SEUILS_COMPTE, Throttle, messageAttente } from './throttle';
import { log } from '../log';

export const jsonSmall = express.json({ limit: '256kb' });

/**
 * Le garde-fou grossier des routes d'identifiants : il borne le débit brut, pas
 * les tentatives. La vraie temporisation est dans auth/throttle.ts, par compte
 * visé et par adresse, et c'est elle qui distingue un attaquant d'une famille.
 *
 * Les requêtes **réussies ne comptent plus** : sans cela, trente connexions
 * légitimes dans le quart d'heure fermaient la porte à la trente-et-unième, et
 * un foyer de cinq personnes sur quatre appareils y arrive.
 */
export const authLimiter = rateLimit({
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
export const parCompte = new Throttle(SEUILS_COMPTE);
export const parAdresse = new Throttle(SEUILS_ADRESSE);

/** Un refus prêt à renvoyer : statut, message, et l'attente à annoncer pour un 429. */
export interface Refus { status: number; error: string; retryAfter?: number }

/** L'attente imposée à ce compte ou à cette adresse, en refus 429, ou null quand on peut essayer. */
export function temporisation(cible: string, adresse: string, now: number, quoi: string): Refus | null {
  const attente = Math.max(parCompte.attente(cible, now), parAdresse.attente(adresse, now));
  if (attente <= 0) return null;
  log.attention(`${quoi} refusé (temporisation, ${Math.ceil(attente / 1000)} s) pour ${cible} depuis ${adresse}.`);
  return { status: 429, error: messageAttente(attente), retryAfter: Math.ceil(attente / 1000) };
}

/** Un échec de plus, sur les deux compteurs. */
export function echec(cible: string, adresse: string, now: number): void {
  parCompte.echec(cible, now);
  parAdresse.echec(adresse, now);
}

/** Une réussite : les deux ardoises sont effacées. */
export function succes(cible: string, adresse: string): void {
  parCompte.succes(cible);
  parAdresse.succes(adresse);
}

/**
 * Le code du téléphone, ou un code de secours, pour un compte qui a posé un
 * second facteur. Rend null quand il est bon (et efface les ardoises), sinon le
 * refus à renvoyer. La temporisation continue de courir sur le compte visé : un
 * code fait six chiffres, et sans elle qui détient le mot de passe les
 * essaierait tous en une soirée.
 */
export function verifierSecondFacteur(user: UserRow, saisi: string, adresse: string, now: number): Refus | null {
  const cible = user.email;
  const attendre = temporisation(cible, adresse, now, 'Second facteur');
  if (attendre) return attendre;
  const pas = user.totp_secret ? verifierCode(user.totp_secret, saisi, now) : null;
  if (pas !== null) {
    // Un code lu par-dessus une épaule reste valable une trentaine de secondes.
    // Le pas déjà consommé ferme cette fenêtre.
    if (pas <= user.totp_last_step) {
      echec(cible, adresse, now);
      log.attention(`Second facteur refusé (code déjà utilisé) pour ${cible} depuis ${adresse}.`);
      return { status: 401, error: 'Ce code a déjà servi. Attendez le suivant sur votre téléphone.' };
    }
    setTotpLastStep(user.id, pas);
  } else {
    // Pas un code du téléphone : peut-être un code de secours.
    const secours = totpRecovery(user);
    const empreinte = empreinteSecours(saisi);
    const i = secours.findIndex((c) => !c.used && c.h === empreinte);
    if (i < 0) {
      echec(cible, adresse, now);
      log.attention(`Second facteur refusé pour ${cible} depuis ${adresse}.`);
      return { status: 401, error: 'Code incorrect.' };
    }
    secours[i].used = true;
    setTotpRecovery(user.id, secours);
    const restants = secours.filter((c) => !c.used).length;
    log.attention(`Connexion par code de secours : ${cible} depuis ${adresse}, ${restants} code(s) restant(s).`);
  }
  succes(cible, adresse);
  return null;
}
