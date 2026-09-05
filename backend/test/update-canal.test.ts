// Le canal de mise à jour, et la comparaison de versions qu'il impose.
//
// Deux choses se jouent ici, et aucune n'est visible depuis l'écran :
//
//   1. `/releases/latest` **exclut** les préversions par construction. Proposer
//      le canal « préversions » sans changer d'URL donnerait un réglage sans
//      effet : la liste des releases est la seule façon de les voir.
//   2. Une version 1.3.0-rc1 et une version 1.3.0 étaient comparées égales par
//      l'ancienne comparaison, qui ne lisait que les trois nombres. Une machine
//      en rc1 n'aurait donc jamais vu arriver rc2, et « à jour » aurait menti.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Canal, estPrerelease, fetchRelease, semverCmp } from '../src/system/releases';

/** Un faux GitHub : chaque URL rend son corps, et on retient ce qui a été demandé. */
function faussaire(routes: Record<string, unknown>, statuts: Record<string, number> = {}) {
  const vues: string[] = [];
  const doFetch = (async (url: string) => {
    const u = String(url);
    vues.push(u);
    const cle = Object.keys(routes).find((k) => u.includes(k));
    if (cle === undefined) return { ok: false, status: statuts[u] ?? 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => routes[cle] };
  }) as unknown as typeof fetch;
  return { doFetch, vues };
}

const rel = (tag: string, pre = false, draft = false) => ({
  tag_name: tag, name: 'Foyer ' + tag, body: 'notes', html_url: 'https://x/' + tag,
  published_at: '2026-09-01T10:00:00Z', prerelease: pre, draft,
});

const chercher = (canal: Canal, routes: Record<string, unknown>) => {
  const f = faussaire(routes);
  return fetchRelease('Compte/Depot', canal, {}, f.doFetch).then((r) => ({ r, vues: f.vues }));
};

describe('semverCmp : les préversions comptent', () => {
  it('classe une préversion avant la version qu’elle prépare', () => {
    assert.ok(semverCmp('1.3.0-rc1', '1.3.0') < 0);
    assert.ok(semverCmp('1.3.0', '1.3.0-rc1') > 0);
  });

  it('classe deux préversions entre elles', () => {
    assert.ok(semverCmp('1.3.0-rc1', '1.3.0-rc2') < 0);
    assert.ok(semverCmp('v1.3.0-rc.2', 'v1.3.0-rc.10') < 0, 'rc.10 vient après rc.2, pas avant');
    assert.ok(semverCmp('1.3.0-rc.1', '1.3.0-rc.beta') < 0, 'un identifiant numérique passe avant un alphanumérique');
  });

  it('garde le classement des versions ordinaires', () => {
    assert.ok(semverCmp('1.2.0', '1.10.0') < 0);
    assert.ok(semverCmp('v2.0.0', '1.9.9') > 0);
    assert.equal(semverCmp('1.2', '1.2.0'), 0);
    assert.equal(semverCmp('1.2.0+build7', '1.2.0'), 0, 'les métadonnées de build ne classent rien');
  });

  it('reconnaît un tag de préversion', () => {
    assert.equal(estPrerelease('v1.3.0-rc1'), true);
    assert.equal(estPrerelease('1.3.0'), false);
  });
});

describe('fetchRelease : le canal décide de ce qu’on regarde', () => {
  it('canal stable : consulte /releases/latest et rien d’autre', async () => {
    const { r, vues } = await chercher('latest', { '/releases/latest': rel('v1.2.0') });
    assert.equal(r.tag, 'v1.2.0');
    assert.equal(r.prerelease, false);
    assert.equal(vues.length, 1);
    assert.match(vues[0], /\/releases\/latest$/);
  });

  it('canal préversions : liste les releases, parce que /releases/latest les cache', async () => {
    const { r, vues } = await chercher('prerelease', {
      '/releases?': [rel('v1.2.0'), rel('v1.3.0-rc1', true)],
    });
    assert.equal(r.tag, 'v1.3.0-rc1', 'la préversion est plus récente que la stable, elle l’emporte');
    assert.equal(r.prerelease, true);
    assert.ok(vues.every((u) => !/\/releases\/latest/.test(u)), '/releases/latest ne dirait jamais rc1');
  });

  it('canal préversions : retient quand même la stable si elle est la plus haute', async () => {
    const { r } = await chercher('prerelease', {
      '/releases?': [rel('v1.3.0-rc1', true), rel('v1.3.0')],
    });
    assert.equal(r.tag, 'v1.3.0');
    assert.equal(r.prerelease, false);
  });

  it('canal préversions : ignore un brouillon, qui n’est téléchargeable par personne', async () => {
    const { r } = await chercher('prerelease', {
      '/releases?': [rel('v1.2.0'), rel('v9.9.9', true, true)],
    });
    assert.equal(r.tag, 'v1.2.0');
  });

  it('canal stable : le repli par tags écarte les préversions', async () => {
    // Aucune release publiée : on retombe sur les tags, et une rc ne doit pas
    // entrer par cette porte alors que le foyer a demandé le contraire.
    const { r } = await chercher('latest', {
      '/tags?': [{ name: 'v1.2.0' }, { name: 'v1.3.0-rc1' }, { name: 'brouillon' }],
    });
    assert.equal(r.tag, 'v1.2.0');
  });

  it('canal préversions : le repli par tags les garde', async () => {
    const { r } = await chercher('prerelease', {
      '/tags?': [{ name: 'v1.2.0' }, { name: 'v1.3.0-rc1' }],
    });
    assert.equal(r.tag, 'v1.3.0-rc1');
    assert.equal(r.prerelease, true);
  });

  it('dit ce qui manque quand il n’y a rien à proposer', async () => {
    await assert.rejects(chercher('latest', { '/tags?': [{ name: 'v1.3.0-rc1' }] }), /stable/);
    await assert.rejects(chercher('prerelease', { '/tags?': [] }), /aucune release ni tag/);
  });

  it('remonte une panne GitHub au lieu de la prendre pour « aucune version »', async () => {
    const f = faussaire({}, { 'https://api.github.com/repos/Compte/Depot/releases/latest': 500 });
    await assert.rejects(fetchRelease('Compte/Depot', 'latest', {}, f.doFetch), /HTTP 500/);
  });
});
