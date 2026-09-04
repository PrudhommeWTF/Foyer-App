// La temporisation des tentatives de connexion.
//
// La limitation par adresse IP seule ne tient aucune des deux promesses qu'on
// lui demande. Trente essais par quart d'heure et par adresse, sur un parc de
// mille adresses, font trente mille essais : c'est un bourrage d'identifiants
// confortable. Et dans l'autre sens, elle coupe la maison : mesuré, après trente
// échecs depuis une sortie partagée, le bon mot de passe recevait un 429.
//
// D'où deux compteurs plutôt qu'un, avec des seuils opposés :
//
//   - **par compte visé**, strict, parce qu'un attaquant qui vise une adresse
//     précise change d'IP mais pas de cible ;
//   - **par adresse**, généreux, parce que toute la famille peut sortir par la
//     même, et qu'on préfère laisser passer que verrouiller les gens dehors.
//
// Le verrou est **progressif** : les premiers essais ne coûtent rien (on se
// trompe de mot de passe, c'est la vie), puis l'attente double à chaque échec.
// Une réussite efface l'ardoise, et seuls les échecs comptent.
//
// Module pur, en mémoire : un redémarrage remet les compteurs à zéro, ce qui est
// acceptable pour un foyer et évite d'écrire en base à chaque tentative.

export interface Seuils {
  /** Échecs tolérés avant que l'attente commence. */
  franchise: number;
  /** Attente après le premier échec au-delà de la franchise. */
  premierDelaiMs: number;
  /** Plafond de l'attente, quel que soit le nombre d'échecs. */
  delaiMaxMs: number;
  /** Au-delà de cette durée sans échec, l'ardoise est oubliée. */
  oubliMs: number;
}

/** Un compte visé : on serre, parce que la cible ne change pas. */
export const SEUILS_COMPTE: Seuils = {
  franchise: 5,
  premierDelaiMs: 30_000,
  delaiMaxMs: 15 * 60_000,
  oubliMs: 60 * 60_000,
};

/**
 * Une adresse : on desserre. Toute la famille peut sortir par la même, et
 * verrouiller la maison dehors est un dégât, pas une protection.
 */
export const SEUILS_ADRESSE: Seuils = {
  franchise: 30,
  premierDelaiMs: 10_000,
  delaiMaxMs: 5 * 60_000,
  oubliMs: 60 * 60_000,
};

interface Ardoise { echecs: number; dernier: number; jusqua: number }

export class Throttle {
  private readonly ardoises = new Map<string, Ardoise>();

  constructor(private readonly seuils: Seuils, private readonly maxCles = 10_000) {}

  /**
   * Combien de millisecondes cette clé doit encore attendre. Zéro quand elle
   * peut essayer.
   */
  attente(cle: string, now: number): number {
    const a = this.ardoises.get(cle);
    if (!a) return 0;
    if (now - a.dernier > this.seuils.oubliMs) { this.ardoises.delete(cle); return 0; }
    return Math.max(0, a.jusqua - now);
  }

  /** Un échec de plus. Rend l'attente désormais imposée, en millisecondes. */
  echec(cle: string, now: number): number {
    this.oublier(now);
    const a = this.ardoises.get(cle);
    const echecs = (a && now - a.dernier <= this.seuils.oubliMs ? a.echecs : 0) + 1;
    const surplus = echecs - this.seuils.franchise;
    // Le délai double à chaque échec au-delà de la franchise, jusqu'au plafond.
    const delai = surplus <= 0 ? 0
      : Math.min(this.seuils.premierDelaiMs * 2 ** (surplus - 1), this.seuils.delaiMaxMs);
    this.ardoises.set(cle, { echecs, dernier: now, jusqua: now + delai });
    return delai;
  }

  /** Connexion réussie : l'ardoise est effacée, elle n'a plus rien à dire. */
  succes(cle: string): void {
    this.ardoises.delete(cle);
  }

  /**
   * Retire ce que le temps a effacé. Appelé à chaque échec, ce qui suffit : sans
   * échec, la table ne grossit pas. Le plafond de clés est une ceinture contre
   * une rafale sur des milliers d'adresses inventées.
   */
  private oublier(now: number): void {
    if (this.ardoises.size < this.maxCles) {
      for (const [k, a] of this.ardoises) {
        if (now - a.dernier > this.seuils.oubliMs) this.ardoises.delete(k);
      }
      return;
    }
    // Table pleine : on garde les plus récentes, les seules utiles.
    const parAge = [...this.ardoises].sort((x, y) => y[1].dernier - x[1].dernier);
    this.ardoises.clear();
    for (const [k, a] of parAge.slice(0, Math.floor(this.maxCles / 2))) this.ardoises.set(k, a);
  }

  /** Nombre d'ardoises tenues. Sert aux tests et au diagnostic. */
  get taille(): number { return this.ardoises.size; }
}

/** Le message d'attente, arrondi à la seconde ou à la minute selon la durée. */
export function messageAttente(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const duree = s < 60 ? `${s} seconde${s > 1 ? 's' : ''}` : `${Math.ceil(s / 60)} minute${s > 60 ? 's' : ''}`;
  return `Trop de tentatives de connexion. Réessayez dans ${duree}.`;
}
