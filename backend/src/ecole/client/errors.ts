// Ce qu'ÉcoleDirecte peut répondre de travers, rangé par ce qu'il faut en faire.
//
// Le serveur répond presque toujours HTTP 200, et le vrai résultat est le champ
// `code` du JSON. Les codes viennent de la bibliothèque Python `ecoledirecte`
// (hacf-fr/ecoledirecte_api, `client.py`, fonction `check_response`, v0.4.0)
// et de la documentation communautaire EduWireApps/ecoledirecte-api-docs.
//
// Ce fichier, comme tout le dossier `client/`, ne dépend de rien d'autre dans
// Foyer : quand l'API change, c'est le seul dossier à corriger.

/**
 * La famille d'une erreur décide de la conduite à tenir, pas son code :
 *
 *   - `identifiants` (505) : ne jamais retenter avec les mêmes, c'est ce qui
 *     fait bloquer le compte ;
 *   - `version` (517) : la version d'API configurée est refusée, retenter ne
 *     changera rien tant qu'on ne l'a pas mise à jour ;
 *   - `jeton` (520, 525) : la session a expiré, une reconnexion suffit ;
 *   - `qcm` (250 hors connexion) : le serveur exige la question de sécurité ;
 *   - `indisponible` : réseau, délai dépassé, HTTP 5xx, réponse qui n'est pas du
 *     JSON, établissement fermé (535) : passager, on retentera plus tard ;
 *   - `gtk` : le serveur n'a pas posé le cookie GTK, exigé depuis mars 2025 ;
 *   - `inattendu` : tout autre code, conservé brut pour pouvoir le chercher.
 */
export type EdErrorKind = 'identifiants' | 'version' | 'jeton' | 'qcm' | 'indisponible' | 'gtk' | 'inattendu';

export class EdError extends Error {
  constructor(
    readonly kind: EdErrorKind,
    message: string,
    /** Le champ `code` de la réponse ÉcoleDirecte, quand il y en a un. */
    readonly code: number | null = null,
    /** Le statut HTTP, quand la réponse est arrivée. */
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'EdError';
  }
}

/** La traduction d'un code ÉcoleDirecte en erreur. `version` sert au message du 517. */
export function errorOfCode(code: number, serverMessage: string, httpStatus: number, version: string): EdError {
  const brut = serverMessage ? ` : « ${serverMessage} »` : '';
  switch (code) {
    case 505: return new EdError('identifiants', 'ÉcoleDirecte refuse l’identifiant ou le mot de passe (505).', code, httpStatus);
    case 517: return new EdError('version', `ÉcoleDirecte refuse la version d’API ${version} (517) : mettez à jour FOYER_ED_API_VERSION ou l’application.`, code, httpStatus);
    case 520: return new EdError('jeton', 'Session ÉcoleDirecte invalide (520).', code, httpStatus);
    case 525: return new EdError('jeton', 'Session ÉcoleDirecte expirée (525).', code, httpStatus);
    case 250: return new EdError('qcm', 'ÉcoleDirecte demande de répondre à la question de sécurité (250).', code, httpStatus);
    case 535: return new EdError('indisponible', `Établissement momentanément indisponible côté ÉcoleDirecte (535)${brut}.`, code, httpStatus);
    default: return new EdError('inattendu', `ÉcoleDirecte a répondu le code ${code}${brut}.`, code, httpStatus);
  }
}
