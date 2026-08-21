// Ce qu'on a le droit de mettre dans une valeur d'en-tête HTTP, et comment y
// mettre quand même un nom français.
//
// Un en-tête ne transporte que des octets. Deux pièges s'ensuivent, et Foyer est
// tombé dans les deux :
//
//   1. **Au-delà de U+00FF, Node refuse.** L'apostrophe typographique « ’ »
//      (U+2019) vaut 8217 et ressemble trait pour trait à « ' ». Elle s'était
//      glissée dans le User-Agent de l'import : « fetch » levait
//      « Cannot convert argument to a ByteString », aucune requête ne partait, et
//      l'erreur remontait déguisée en panne réseau. En réponse, le même caractère
//      fait lever ERR_INVALID_CHAR à `res.setHeader`.
//
//   2. **Même en dessous de 255, l'accent ne survit pas.** « à » part en octet
//      0xE0 et revient décodé en UTF-8 : le navigateur affiche « Tarte ï¿½
//      l'oignon ». Transporter un accent dans un en-tête demande la RFC 6266.
//
// D'où la règle tenue ici : la valeur brute d'un en-tête est **repliée en ASCII**,
// et le nom accentué voyage à côté, encodé, dans le paramètre prévu pour cela.

/** Signes typographiques que la ponctuation française amène, et leur équivalent. */
const TYPOGRAPHIE: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, ''],
  [/[\u2010-\u2015\u2212]/g, '-'],
  [/\u2026/g, '...'],
  [/[\u00A0\u202F\u2007\u2009]/g, ' '],
  [/[\u2022\u00B7]/g, '-'],
];

/** Ligatures et lettres que la décomposition Unicode ne sait pas défaire seule. */
const LIGATURES: [RegExp, string][] = [
  [/œ/g, 'oe'], [/Œ/g, 'OE'], [/æ/g, 'ae'], [/Æ/g, 'AE'],
  [/ß/g, 'ss'], [/ø/g, 'o'], [/Ø/g, 'O'], [/đ/g, 'd'], [/Đ/g, 'D'],
];

/**
 * Replie une chaîne en ASCII : accents retirés par décomposition, ligatures
 * défaites, typographie translittérée. « Crème brûlée » devient « Creme brulee »,
 * ce qui reste parfaitement lisible et passe partout.
 */
export function asciiFold(value: unknown): string {
  let s = String(value ?? '');
  for (const [re, to] of TYPOGRAPHIE) s = s.replace(re, to);
  for (const [re, to] of LIGATURES) s = s.replace(re, to);
  // NFD sépare la lettre de son accent, la plage 0300-036F retire les accents.
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Valeur transportable dans un en-tête : ASCII imprimable seulement, sans
 * caractère de contrôle (qui permettrait d'injecter un en-tête), sans guillemet
 * ni contre-oblique (qui casseraient une valeur entre guillemets).
 *
 * Rien n'est deviné : ce qui ne passe pas est retiré, et la valeur reste lisible.
 */
export function headerSafe(value: unknown, max = 200): string {
  return asciiFold(value)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Vrai quand la valeur peut être émise telle quelle. Sert aux gardes et aux tests. */
export function isHeaderSafe(value: string): boolean {
  return !/[^\x20-\x7E]/.test(value);
}

/**
 * En-tête Content-Disposition portant un nom de fichier français.
 *
 * Deux formes côte à côte, comme le prévoit la RFC 6266 : `filename` replié en
 * ASCII pour ce qui ne saurait pas mieux faire, et `filename*` en UTF-8 encodé,
 * que tous les navigateurs actuels préfèrent. « Tarte à l’oignon » s'enregistre
 * donc sous son vrai nom, accent compris.
 */
export function contentDisposition(disposition: 'inline' | 'attachment', name: string, fallback: string): string {
  const ascii = headerSafe(name, 120) || fallback;
  // encodeURIComponent laisse passer ' ( ) * , que la RFC 5987 n'autorise pas.
  const utf8 = encodeURIComponent(String(name ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200))
    .replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
