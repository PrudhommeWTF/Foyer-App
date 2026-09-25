// Le serveur MCP : ce qu'un assistant peut faire par le point /mcp, et surtout
// ce qu'il ne peut pas. Éteint par défaut (404), jeton obligatoire (une session
// est refusée), portée respectée (un jeton `read` ne voit pas les outils
// d'écriture), attribution portée (by + via), séries protégées, finances hors
// de portée, et un compte enfant ne voit que ce qu'il verrait dans l'app.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Contexte, appel, arreter, demarrer } from './securite-helpers';

let ctx: Contexte;
let tokenWrite = '';
let tokenRead = '';
let tokenEnfant = '';
let membreId = '';

/** Un client MCP connecté avec un jeton d'accès en en-tête. */
async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(ctx.base + '/mcp'), {
    requestInit: { headers: { Authorization: 'Bearer ' + token } },
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
const textOf = (r: unknown): string => {
  const c = (r as { content?: { type: string; text?: string }[] }).content || [];
  return c.map((x) => x.text || '').join('\n');
};
async function creerJeton(session: string, name: string, scope: 'read' | 'write', password: string): Promise<string> {
  const r = await appel(ctx.base, 'POST', '/me/tokens', { name, scope, password }, session);
  if (r.status !== 201) throw new Error('création de jeton échouée : ' + JSON.stringify(r.json));
  return r.json.token as string;
}

before(async () => {
  ctx = await demarrer();
  // Le point est fermé par défaut : on l'ouvre pour les tests (réglage foyer, admin).
  const on = await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: true } }, ctx.jetons.admin);
  assert.equal(on.status, 200, 'activation de mcpEnabled : ' + JSON.stringify(on.json));
  membreId = (await appel(ctx.base, 'GET', '/me', undefined, ctx.jetons.membre)).json.memberId;
  tokenWrite = await creerJeton(ctx.jetons.membre, 'Assistant écriture', 'write', 'MotDePasseSolide2');
  tokenRead = await creerJeton(ctx.jetons.membre, 'Assistant lecture', 'read', 'MotDePasseSolide2');
  tokenEnfant = await creerJeton(ctx.jetons.enfant, 'Assistant enfant', 'write', 'MotDePasseSolide7');
});
after(async () => { await arreter(ctx); });

describe('Serveur MCP', () => {
  it('répond 404 quand le réglage est éteint', async () => {
    // Éteindre, vérifier, rallumer (les autres tests en dépendent).
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: false } }, ctx.jetons.admin)).status, 200);
    const off = await appel(ctx.base, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokenWrite);
    assert.equal(off.status, 404);
    assert.equal((await appel(ctx.base, 'PATCH', '/settings', { changes: { mcpEnabled: true } }, ctx.jetons.admin)).status, 200);
  });

  it('exige une authentification (401) et refuse une session de navigateur (403)', async () => {
    assert.equal((await appel(ctx.base, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 401);
    // Un jeton de session (pas un jeton d'accès) est authentifié mais interdit ici.
    assert.equal((await appel(ctx.base, 'POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, ctx.jetons.membre)).status, 403);
  });

  it('tools/list reflète la portée : un jeton read ne voit pas les outils d’écriture', async () => {
    const read = await connect(tokenRead);
    const write = await connect(tokenWrite);
    const readNames = (await read.listTools()).tools.map((t) => t.name);
    const writeNames = (await write.listTools()).tools.map((t) => t.name);
    await read.close(); await write.close();

    assert.ok(readNames.includes('foyer_aujourdhui'), 'les lectures sont là');
    assert.ok(!readNames.includes('courses_ajouter'), 'pas d’écriture pour un jeton read');
    assert.ok(writeNames.includes('courses_ajouter') && writeNames.includes('evenement_creer'), 'les écritures sont là pour un jeton write');
    // Aucun outil n'expose les finances ni les réglages, quelle que soit la portée.
    for (const n of [...readNames, ...writeNames]) assert.ok(!/finance|budget|reglage|setting/i.test(n), 'aucun outil finances/réglages : ' + n);
  });

  it('courses_ajouter crée l’article avec attribution (by + via)', async () => {
    const c = await connect(tokenWrite);
    const out = textOf(await c.callTool({ name: 'courses_ajouter', arguments: { articles: [{ nom: 'Lait' }, { nom: 'Œufs', qte: '6' }] } }));
    await c.close();
    assert.match(out, /Lait/);

    const live = (await appel(ctx.base, 'GET', '/live', undefined, ctx.jetons.membre)).json;
    const lait = (live.shop || []).find((i: { name: string }) => i.name === 'Lait');
    assert.ok(lait, 'l’article est bien dans la liste');
    assert.equal(lait.by, membreId, 'attribué au membre du jeton');
    assert.equal(lait.via, 'Assistant écriture', 'la provenance porte le nom du jeton');
  });

  it('un jeton read ne peut pas appeler un outil d’écriture', async () => {
    const c = await connect(tokenRead);
    const res = await c.callTool({ name: 'courses_ajouter', arguments: { articles: [{ nom: 'Beurre' }] } });
    await c.close();
    assert.equal((res as { isError?: boolean }).isError, true);
    assert.match(textOf(res), /inconnu ou non autorisé/i);
  });

  it('tache_terminer refuse une série et renvoie vers l’app', async () => {
    // Une tâche récurrente, créée par le chemin normal (opérations de tâches).
    const lists = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state.taskLists as { id: string; kind: string }[];
    const listId = (lists.find((l) => l.kind === 'taches') || lists[0]).id;
    await appel(ctx.base, 'POST', '/tasks/ops', { ops: [{ op: 'add', opId: 'serie1', id: 'tserie', listId, text: 'Sortir les poubelles', due: '2026-01-06', rec: { freq: 'weekly', every: 1, base: 'due' } }] }, ctx.jetons.membre);

    const c = await connect(tokenWrite);
    const out = textOf(await c.callTool({ name: 'tache_terminer', arguments: { id: 'tserie' } }));
    await c.close();
    assert.match(out, /revient régulièrement/);
  });

  it('evenement_creer ajoute l’événement, attribué au membre', async () => {
    const c = await connect(tokenWrite);
    const out = textOf(await c.callTool({ name: 'evenement_creer', arguments: { titre: 'Rendez-vous dentiste', date: '2026-02-10', heure: '09:30' } }));
    await c.close();
    const m = out.match(/\[(e[^\]]+)\]/);
    assert.ok(m, 'l’identifiant de l’événement est renvoyé : ' + out);
    const state = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state;
    const ev = (state.events || []).find((e: { id: string }) => e.id === m![1]);
    assert.ok(ev, 'l’événement est dans le document');
    assert.equal(ev.by, membreId, 'attribué au membre du jeton');
  });

  it('un compte enfant ne voit pas la liste privée d’un autre membre', async () => {
    // L'admin se crée une liste de tâches privée, avec une tâche dedans.
    const etat = await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.admin);
    const adminId = (await appel(ctx.base, 'GET', '/me', undefined, ctx.jetons.admin)).json.memberId;
    const lists = [...etat.json.state.taskLists, { id: 'priv1', name: 'Secret admin', color: '#000', icon: 'x', kind: 'taches', scope: adminId, position: 99 }];
    const put = await appel(ctx.base, 'PUT', '/state', { version: etat.json.version, state: { ...etat.json.state, taskLists: lists } }, ctx.jetons.admin);
    assert.equal(put.status, 200);
    await appel(ctx.base, 'POST', '/tasks/ops', { ops: [{ op: 'add', opId: 'priv-op', id: 'tpriv', listId: 'priv1', text: 'Cadeau surprise', due: '2026-01-06' }] }, ctx.jetons.admin);

    const c = await connect(tokenEnfant);
    const out = textOf(await c.callTool({ name: 'taches_liste', arguments: { quand: 'toutes' } }));
    await c.close();
    assert.ok(!/Cadeau surprise/.test(out), 'la tâche d’une liste privée d’autrui reste invisible');
  });

  it('tache_creer en tête, tache_deplacer par intitulé (exact et approché), rang, et échéance inchangée', async () => {
    const c = await connect(tokenWrite);
    await c.callTool({ name: 'tache_creer', arguments: { texte: 'Relevé des compteurs', echeance: '2026-03-20' } });
    await c.callTool({ name: 'tache_creer', arguments: { texte: 'Rendez-vous notaire' } });
    const tete = textOf(await c.callTool({ name: 'tache_creer', arguments: { texte: 'Appeler la banque', position: 'debut' } }));
    assert.match(tete, /en tête de liste/, 'création en tête annoncée');

    // Intitulé approché (à la voix, jamais l'identifiant) : « compteurs » avant « notaire ».
    const dep = textOf(await c.callTool({ name: 'tache_deplacer', arguments: { tache: 'compteurs', avant: 'notaire' } }));
    assert.match(dep, /rangée/);
    assert.match(dep, /échéance inchangée/);

    // Intitulé exact : ranger « Appeler la banque » en fin.
    const fin = textOf(await c.callTool({ name: 'tache_deplacer', arguments: { tache: 'Appeler la banque', position: 'fin' } }));
    assert.match(fin, /rangée/);

    const liste = textOf(await c.callTool({ name: 'taches_liste', arguments: { quand: 'toutes' } }));
    await c.close();
    const iReleve = liste.indexOf('Relevé des compteurs');
    const iNotaire = liste.indexOf('Rendez-vous notaire');
    assert.ok(iReleve > -1 && iNotaire > -1 && iReleve < iNotaire, 'le relevé passe avant le notaire dans la liste');
    assert.match(liste, /\d+\/\d+/, 'un rang « n/total » accompagne chaque tâche');

    // L'échéance du relevé n'a pas bougé d'un pouce.
    const state = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state;
    const releve = (state.tasks as { text: string; due: string }[]).find((t) => t.text === 'Relevé des compteurs');
    assert.equal(releve?.due, '2026-03-20', 'échéance strictement inchangée par le déplacement');
  });

  it('tache_deplacer sur un intitulé ambigu rend les candidats au lieu de deviner', async () => {
    const c = await connect(tokenWrite);
    await c.callTool({ name: 'tache_creer', arguments: { texte: 'Arroser le basilic' } });
    await c.callTool({ name: 'tache_creer', arguments: { texte: 'Arroser les tomates' } });
    const out = textOf(await c.callTool({ name: 'tache_deplacer', arguments: { tache: 'arroser', position: 'debut' } }));
    await c.close();
    assert.match(out, /Plusieurs tâches correspondent/, 'ambiguïté : on ne choisit pas');
    assert.match(out, /Arroser le basilic/);
    assert.match(out, /Arroser les tomates/);
  });

  it('les nouvelles lectures sont ouvertes au jeton read, pas les nouvelles écritures', async () => {
    const read = await connect(tokenRead);
    const names = (await read.listTools()).tools.map((tl) => tl.name);
    await read.close();
    assert.ok(names.includes('rayons') && names.includes('emploi_du_temps') && names.includes('lieux'), 'lectures ajoutées visibles');
    for (const n of ['courses_etat', 'courses_retirer', 'liste_courses_supprimer', 'tache_supprimer', 'repas_definir', 'recette_creer', 'creneau_creer', 'evenement_supprimer', 'lieu_creer', 'lieu_supprimer', 'affaire_ajouter'])
      assert.ok(!names.includes(n), 'pas d’écriture pour un jeton read : ' + n);
  });

  it('événement : créer, modifier, supprimer', async () => {
    const c = await connect(tokenWrite);
    const id = textOf(await c.callTool({ name: 'evenement_creer', arguments: { titre: 'Réunion école', date: '2026-04-01', heure: '18:00' } })).match(/\[(e[^\]]+)\]/)![1];
    assert.match(textOf(await c.callTool({ name: 'evenement_modifier', arguments: { id, lieu: 'Mairie', heure: '18:30' } })), /modifié/);
    const ev = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state.events.find((e: { id: string }) => e.id === id);
    assert.equal(ev.place, 'Mairie'); assert.equal(ev.time, '18:30');
    assert.match(textOf(await c.callTool({ name: 'evenement_supprimer', arguments: { id } })), /supprimé/);
    await c.close();
    assert.ok(!(await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state.events.some((e: { id: string }) => e.id === id));
  });

  it('courses : état, modifier, retirer, et CRUD d’une liste', async () => {
    const c = await connect(tokenWrite);
    assert.match(textOf(await c.callTool({ name: 'liste_courses_creer', arguments: { nom: 'Pique-nique' } })), /créée/);
    await c.callTool({ name: 'courses_ajouter', arguments: { articles: [{ nom: 'Pommes' }, { nom: 'Chips' }], liste: 'Pique-nique' } });
    let liste = textOf(await c.callTool({ name: 'courses_liste', arguments: { liste: 'Pique-nique' } }));
    const pommeId = liste.match(/Pommes[^[]*\[([^\]]+)\]/)![1];
    const chipsId = liste.match(/Chips[^[]*\[([^\]]+)\]/)![1];
    assert.match(textOf(await c.callTool({ name: 'courses_modifier', arguments: { id: pommeId, qte: '2 kg' } })), /modifié/);
    assert.match(textOf(await c.callTool({ name: 'courses_etat', arguments: { ids: [chipsId], etat: 'panier' } })), /panier/);
    liste = textOf(await c.callTool({ name: 'courses_liste', arguments: { liste: 'Pique-nique' } }));
    assert.ok(/Pommes \(2 kg\)/.test(liste), 'quantité modifiée : ' + liste);
    assert.ok(!/Chips/.test(liste), 'les chips au panier ne sont plus « à prendre »');
    assert.match(textOf(await c.callTool({ name: 'courses_retirer', arguments: { ids: [pommeId] } })), /retiré/);
    assert.match(textOf(await c.callTool({ name: 'liste_courses_renommer', arguments: { liste: 'Pique-nique', nom: 'Sortie' } })), /renommée/);
    assert.match(textOf(await c.callTool({ name: 'liste_courses_supprimer', arguments: { liste: 'Sortie' } })), /supprimée/);
    await c.close();
    assert.ok(!((await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state.shopLists || []).some((l: { name: string }) => l.name === 'Sortie'));
  });

  it('tâche : modifier, terminer, retrouver, rouvrir, supprimer', async () => {
    const c = await connect(tokenWrite);
    const tid = textOf(await c.callTool({ name: 'tache_creer', arguments: { texte: 'Laver la voiture' } })).match(/\[(t[^\]]+)\]/)![1];
    assert.match(textOf(await c.callTool({ name: 'tache_modifier', arguments: { tache: 'Laver la voiture', echeance: '2026-05-01', texte: 'Laver la voiture à fond' } })), /modifiée/);
    assert.match(textOf(await c.callTool({ name: 'tache_terminer', arguments: { id: tid } })), /terminée/);
    assert.match(textOf(await c.callTool({ name: 'taches_liste', arguments: { quand: 'terminees' } })), /Laver la voiture/);
    assert.match(textOf(await c.callTool({ name: 'tache_rouvrir', arguments: { tache: 'Laver la voiture' } })), /rouverte/);
    assert.match(textOf(await c.callTool({ name: 'tache_supprimer', arguments: { tache: 'Laver la voiture' } })), /supprimée/);
    await c.close();
    assert.ok(!(await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state.tasks.some((t: { id: string }) => t.id === tid));
  });

  it('liste de tâches : créer, archiver (masquée), restaurer, supprimer', async () => {
    const c = await connect(tokenWrite);
    assert.match(textOf(await c.callTool({ name: 'liste_taches_creer', arguments: { nom: 'Vacances', type: 'checklist' } })), /créée/);
    await c.callTool({ name: 'tache_creer', arguments: { texte: 'Passeports', liste: 'Vacances' } });
    assert.match(textOf(await c.callTool({ name: 'liste_taches_archiver', arguments: { liste: 'Vacances', archivee: true } })), /archivée/);
    assert.ok(!/Passeports/.test(textOf(await c.callTool({ name: 'taches_liste', arguments: {} }))), 'une liste archivée est masquée');
    assert.match(textOf(await c.callTool({ name: 'liste_taches_archiver', arguments: { liste: 'Vacances', archivee: false } })), /restaurée/);
    assert.match(textOf(await c.callTool({ name: 'liste_taches_supprimer', arguments: { liste: 'Vacances' } })), /supprimée/);
    await c.close();
  });

  it('repas : définir avec une recette puis vider', async () => {
    const c = await connect(tokenWrite);
    assert.match(textOf(await c.callTool({ name: 'recette_creer', arguments: { nom: 'Tarte aux pommes', ingredients: ['pommes', 'pâte'], etapes: ['éplucher', 'cuire'] } })), /créée/);
    assert.match(textOf(await c.callTool({ name: 'repas_definir', arguments: { date: '2026-04-15', creneau: 'soir', recettes: ['Tarte aux pommes'], couverts: 4 } })), /Tarte aux pommes/);
    assert.match(textOf(await c.callTool({ name: 'repas_semaine', arguments: { semaine: '2026-04-13' } })), /Tarte aux pommes/);
    assert.match(textOf(await c.callTool({ name: 'repas_vider', arguments: { date: '2026-04-15', creneau: 'soir' } })), /vidé/);
    await c.close();
  });

  it('recette : créer, modifier, détailler, supprimer', async () => {
    const c = await connect(tokenWrite);
    const id = textOf(await c.callTool({ name: 'recette_creer', arguments: { nom: 'Soupe', ingredients: ['carottes'], etapes: ['mixer'], portions: 4 } })).match(/\[(r[^\]]+)\]/)![1];
    assert.match(textOf(await c.callTool({ name: 'recette_modifier', arguments: { id, nom: 'Soupe de légumes', prepMin: 15 } })), /modifiée/);
    assert.match(textOf(await c.callTool({ name: 'recette_detail', arguments: { id } })), /Soupe de légumes/);
    assert.match(textOf(await c.callTool({ name: 'recette_supprimer', arguments: { id } })), /supprimée/);
    await c.close();
    assert.ok(!(await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state.recipes.some((r: { id: string }) => r.id === id));
  });

  it('emploi du temps : créer un créneau publié, le lister, le modifier, le supprimer', async () => {
    const c = await connect(tokenWrite);
    const cr = textOf(await c.callTool({ name: 'creneau_creer', arguments: { label: 'Piscine', pour: ['Camille'], jour: 'mardi', debut: '17:00', fin: '18:00', type: 'sport', publier: true } }));
    const id = cr.match(/\[(s[^\]]+)\]/)![1];
    assert.match(cr, /publié à l’agenda/);
    assert.match(textOf(await c.callTool({ name: 'emploi_du_temps', arguments: { membre: 'Camille' } })), /Piscine/);
    // Publié : ses occurrences apparaissent à l'agenda (mardi 6 janvier 2026 dans la fenêtre).
    assert.match(textOf(await c.callTool({ name: 'agenda', arguments: { du: '2026-01-05', au: '2026-01-11' } })), /Piscine/);
    assert.match(textOf(await c.callTool({ name: 'creneau_modifier', arguments: { id, debut: '17:30' } })), /modifié/);
    assert.match(textOf(await c.callTool({ name: 'creneau_supprimer', arguments: { id } })), /supprimé/);
    await c.close();
  });

  it('lieux de vacances : créer, poser des affaires, changer l’état, déplacer, retirer, supprimer', async () => {
    const c = await connect(tokenWrite);
    const id = textOf(await c.callTool({ name: 'lieu_creer', arguments: { nom: 'Chalet montagne', note: 'Clé sous le pot' } })).match(/\[(pl[^\]]+)\]/)![1];
    await c.callTool({ name: 'affaire_ajouter', arguments: { lieu: 'Chalet montagne', affaires: [{ nom: 'Raquettes' }, { nom: 'Luge', qte: '2' }] } });
    let inv = textOf(await c.callTool({ name: 'lieux', arguments: { lieu: 'Chalet montagne' } }));
    assert.match(inv, /Raquettes/); assert.match(inv, /Sur place/);
    const raqId = inv.match(/Raquettes[^[]*\[([^\]]+)\]/)![1];
    const lugeId = inv.match(/Luge[^[]*\[([^\]]+)\]/)![1];
    assert.match(textOf(await c.callTool({ name: 'affaire_etat', arguments: { ids: [raqId], etat: 'ici' } })), /ramenée/);
    inv = textOf(await c.callTool({ name: 'lieux', arguments: { lieu: 'Chalet montagne' } }));
    assert.match(inv, /Ramenées : Raquettes/);
    assert.match(textOf(await c.callTool({ name: 'affaire_modifier', arguments: { id: lugeId, qte: '3' } })), /modifiée/);
    // Un second lieu, où l'on déplace la luge.
    await c.callTool({ name: 'lieu_creer', arguments: { nom: 'Cave' } });
    assert.match(textOf(await c.callTool({ name: 'affaire_modifier', arguments: { id: lugeId, lieu: 'Cave' } })), /modifiée/);
    assert.match(textOf(await c.callTool({ name: 'affaire_retirer', arguments: { ids: [raqId] } })), /retirée/);
    assert.match(textOf(await c.callTool({ name: 'lieu_supprimer', arguments: { id } })), /supprimé/);
    await c.close();
    const st = (await appel(ctx.base, 'GET', '/state', undefined, ctx.jetons.membre)).json.state;
    assert.ok(!(st.places || []).some((p: { id: string }) => p.id === id), 'lieu supprimé');
    assert.ok((st.placeItems || []).some((i: { id: string }) => i.id === lugeId), 'la luge déplacée survit dans la cave');
  });
});
