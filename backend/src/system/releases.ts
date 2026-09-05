// Quelle version GitHub propose-t-il, et laquelle est « la dernière » ?
//
// Deux canaux, parce que le dépôt publie les deux : les versions stables, et
// les préversions (« pre-release ») qui les préparent. Le réglage `updateChannel`
// décide de ce que le foyer regarde. Il y a une contrainte d'API derrière ce
// choix : `/releases/latest` **exclut** les préversions par construction, il
// n'existe aucun paramètre pour les inclure. Les voir impose de lister les
// releases et de choisir soi-même la plus haute.
//
// La comparaison de versions porte donc, elle aussi, sur les préversions : sans
// cela, une machine en 1.3.0-rc1 ne verrait jamais arriver 1.3.0-rc2, et
// « à jour » serait faux.

/** Le canal consulté, tel qu'il est stocké dans le réglage `updateChannel`. */
export type Canal = 'latest' | 'prerelease';

export interface Release {
  tag: string;
  name: string;
  body: string;
  url: string;
  publishedAt: string;
  /** Vrai pour une préversion. L'écran le dit : on n'installe pas une rc sans le savoir. */
  prerelease: boolean;
}

interface GhRelease {
  tag_name?: string; name?: string; body?: string; html_url?: string;
  published_at?: string; prerelease?: boolean; draft?: boolean;
}

/** Un tag qui porte un suffixe de préversion, au sens semver : `v1.3.0-rc1`. */
export const estPrerelease = (tag: string): boolean => /^v?\d+(\.\d+)*-/.test(tag.trim());

/** `1.3.0-rc.2` → { num: [1,3,0], pre: ['rc','2'] }. Les métadonnées de build ne comptent pas. */
function decouper(v: string): { num: number[]; pre: string[] } {
  const s = String(v || '').trim().replace(/^v/, '').split('+')[0];
  const tiret = s.indexOf('-');
  const coeur = tiret < 0 ? s : s.slice(0, tiret);
  const pre = tiret < 0 ? [] : s.slice(tiret + 1).split('.').filter(Boolean);
  const num = coeur.split('.').map((n) => parseInt(n, 10) || 0);
  return { num: [num[0] || 0, num[1] || 0, num[2] || 0], pre };
}

/**
 * Comparaison de deux versions, suffixe de préversion compris (semver 11).
 *
 * Négatif si `a` précède `b`. Deux règles qu'on ne devine pas : une préversion
 * est **antérieure** à la version qu'elle prépare (1.3.0-rc1 < 1.3.0), et un
 * identifiant numérique passe avant un identifiant alphanumérique (rc.1 < rc.beta).
 */
export function semverCmp(a: string, b: string): number {
  const pa = decouper(a);
  const pb = decouper(b);
  for (let i = 0; i < 3; i++) if (pa.num[i] !== pb.num[i]) return pa.num[i] - pb.num[i];
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;
  if (!pb.pre.length) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) { const d = Number(x) - Number(y); if (d) return d; continue; }
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const depuisJson = (j: GhRelease): Release => ({
  tag: String(j.tag_name),
  name: j.name || String(j.tag_name),
  body: j.body || '',
  url: j.html_url || '',
  publishedAt: j.published_at || '',
  prerelease: !!j.prerelease,
});

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Le plus haut tag du dépôt, quand aucune release ne convient.
 *
 * Repli hérité : un dépôt qui pose des tags sans publier de release reste
 * consultable. Le canal s'y applique aussi, sinon choisir « stables uniquement »
 * n'empêcherait pas une `-rc` de remonter par cette porte.
 */
async function plusHautTag(repo: string, canal: Canal, get: Fetcher): Promise<Release> {
  const res = await get(`https://api.github.com/repos/${repo}/tags?per_page=100`);
  if (!res.ok) throw new Error(res.status === 404 ? 'aucune release ni tag' : 'GitHub HTTP ' + res.status);
  const tags = (await res.json()) as { name?: string }[];
  const noms = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t?.name || ''))
    .filter((n) => /^v?\d+\.\d+/.test(n))
    .filter((n) => canal === 'prerelease' || !estPrerelease(n))
    .sort(semverCmp);
  const haut = noms[noms.length - 1];
  if (!haut) throw new Error(canal === 'prerelease' ? 'aucune release ni tag de version' : 'aucune version stable publiée');
  return { tag: haut, name: haut, body: '', url: `https://github.com/${repo}/releases/tag/${haut}`, publishedAt: '', prerelease: estPrerelease(haut) };
}

/**
 * La version proposée par le canal demandé.
 *
 * `doFetch` est injectable pour que les tests éprouvent le choix du canal sans
 * appeler GitHub : ce qui doit être prouvé ici, c'est quelle URL est consultée
 * et quelle release est retenue, pas que le réseau fonctionne.
 */
export async function fetchRelease(
  repo: string,
  canal: Canal,
  headers: Record<string, string>,
  doFetch: typeof fetch = fetch,
): Promise<Release> {
  const get: Fetcher = (url) => doFetch(url, { headers, signal: AbortSignal.timeout(8000) });
  if (canal === 'latest') {
    const rel = await get(`https://api.github.com/repos/${repo}/releases/latest`);
    if (rel.ok) return depuisJson((await rel.json()) as GhRelease);
    if (rel.status !== 404) throw new Error('GitHub HTTP ' + rel.status);
  } else {
    const list = await get(`https://api.github.com/repos/${repo}/releases?per_page=30`);
    if (list.ok) {
      const brut = (await list.json()) as GhRelease[];
      // Un brouillon n'est publié pour personne : le proposer ferait échouer le
      // téléchargement, sans que rien n'explique pourquoi.
      const publiees = (Array.isArray(brut) ? brut : []).filter((r) => r && !r.draft && r.tag_name);
      let haute: GhRelease | null = null;
      for (const r of publiees) if (!haute || semverCmp(String(r.tag_name), String(haute.tag_name)) > 0) haute = r;
      if (haute) return depuisJson(haute);
    } else if (list.status !== 404) throw new Error('GitHub HTTP ' + list.status);
  }
  return plusHautTag(repo, canal, get);
}
