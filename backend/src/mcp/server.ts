// Le serveur MCP (Model Context Protocol) du foyer : transport Streamable HTTP
// monté sur POST /mcp, sans état (une requête = un appel), authentifié par un
// jeton d'accès porté en `Authorization: Bearer foyer_…`. Une session de
// navigateur (cookie) est refusée : ce point d'entrée n'est pas pilotable depuis
// un onglet. L'activation est gouvernée par le réglage `mcpEnabled` (géré au
// montage, dans server.ts : éteint, /mcp répond 404).
//
// On utilise l'API bas niveau du SDK (Server + gestionnaires de requêtes) plutôt
// que McpServer.registerTool : l'inférence générique de ce dernier, croisée avec
// une douzaine de schémas, fait exploser le temps de compilation (plusieurs
// minutes). Ici les schémas des outils sont du JSON Schema simple, annoncés tels
// quels, et la validation fine vit dans tools.ts, qui borne et nettoie déjà
// chaque champ.
//
// Un outil d'écriture n'est annoncé que pour un jeton `write` : `tools/list`
// reflète donc la portée. Aucun outil n'expose les finances ni les réglages.
import express, { Router, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AuthedRequest, currentMember } from '../auth/session';
import { log } from '../log';
import * as t from './tools';

/** Un objet d'arguments reçu d'un client MCP, lu défensivement. */
type Args = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Un type JSON Schema minimal, réutilisé dans les déclarations d'outils. */
const S = {
  string: (max?: number) => ({ type: 'string' as const, ...(max ? { maxLength: max } : {}) }),
  date: { type: 'string' as const, description: 'AAAA-MM-JJ' },
  time: { type: 'string' as const, description: 'HH:MM' },
};

interface ToolDef {
  name: string;
  description: string;
  /** Outil d'écriture : annoncé uniquement pour un jeton `write`. */
  write?: boolean;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  run: (ctx: t.McpCtx, a: Args) => string | Promise<string>;
}

const TOOLS: ToolDef[] = [
  {
    name: 'foyer_aujourdhui',
    description: 'Le résumé du jour pour ce membre : date, événements du jour et de demain, tâches dues aujourd’hui, repas du jour, nombre de courses à prendre. À appeler en premier.',
    inputSchema: { type: 'object', properties: {} },
    run: (ctx) => t.aujourdhui(ctx),
  },
  {
    name: 'courses_liste',
    description: 'Les articles « à prendre » d’une liste, groupés par rayon, avec leur identifiant [id]. Par défaut la liste principale.',
    inputSchema: { type: 'object', properties: { liste: S.string(80) } },
    run: (ctx, a) => t.coursesListe(ctx, str(a.liste)),
  },
  {
    name: 'taches_liste',
    description: 'Les tâches ouvertes, avec leur identifiant [id] et leur rang dans l’ordre du foyer (« 3/7 »), pour situer une tâche et raisonner sur un déplacement. `quand` : toutes (défaut, dans l’ordre manuel), ou aujourdhui/semaine/retard (dans l’ordre du temps).',
    inputSchema: { type: 'object', properties: { quand: { type: 'string', enum: ['aujourdhui', 'semaine', 'retard', 'toutes'] }, liste: S.string(80) } },
    run: (ctx, a) => t.tachesListe(ctx, (str(a.quand) as 'aujourdhui' | 'semaine' | 'retard' | 'toutes') || 'toutes', str(a.liste)),
  },
  {
    name: 'agenda',
    description: 'Les événements entre deux dates (AAAA-MM-JJ). Par défaut les 7 prochains jours. Inclut les occurrences des séries et les créneaux d’emploi du temps publiés.',
    inputSchema: { type: 'object', properties: { du: S.date, au: S.date } },
    run: (ctx, a) => t.agenda(ctx, str(a.du), str(a.au)),
  },
  {
    name: 'repas_semaine',
    description: 'Le planning des repas (matin, midi, soir) sur 7 jours à partir d’une date (AAAA-MM-JJ, défaut aujourd’hui).',
    inputSchema: { type: 'object', properties: { semaine: S.date } },
    run: (ctx, a) => t.repasSemaine(ctx, str(a.semaine)),
  },
  {
    name: 'recettes_chercher',
    description: 'Les recettes du carnet dont le nom ou les ingrédients correspondent, avec leur [id].',
    inputSchema: { type: 'object', properties: { q: S.string(120) }, required: ['q'] },
    run: (ctx, a) => t.recettesChercher(ctx, str(a.q) || ''),
  },
  {
    name: 'recette_detail',
    description: 'Les ingrédients et les étapes d’une recette, par son identifiant.',
    inputSchema: { type: 'object', properties: { id: S.string(80) }, required: ['id'] },
    run: (ctx, a) => t.recetteDetail(ctx, str(a.id) || ''),
  },
  {
    name: 'membres',
    description: 'Les prénoms, identifiants et rôles des membres (pour affecter une tâche). Jamais les emails.',
    inputSchema: { type: 'object', properties: {} },
    run: (ctx) => t.membres(ctx),
  },
  // ---- Écriture ----
  {
    name: 'courses_ajouter',
    write: true,
    description: 'Ajoute des articles à une liste de courses (défaut : la principale). Ne crée pas de doublon d’un article déjà « à prendre ».',
    inputSchema: {
      type: 'object',
      properties: {
        articles: { type: 'array', maxItems: 50, items: { type: 'object', properties: { nom: S.string(200), qte: S.string(40), rayon: S.string(80) }, required: ['nom'] } },
        liste: S.string(80),
      },
      required: ['articles'],
    },
    run: (ctx, a) => {
      const arts = Array.isArray(a.articles)
        ? a.articles.map((x) => { const o = (x ?? {}) as Args; return { nom: str(o.nom) || '', qte: str(o.qte), rayon: str(o.rayon) }; })
        : [];
      return t.coursesAjouter(ctx, arts, str(a.liste));
    },
  },
  {
    name: 'courses_cocher',
    write: true,
    description: 'Marque des articles comme mis au panier, par leurs identifiants.',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', maxItems: 100, items: S.string(80) } }, required: ['ids'] },
    run: (ctx, a) => t.coursesCocher(ctx, strArr(a.ids)),
  },
  {
    name: 'tache_creer',
    write: true,
    description: 'Crée une tâche (sans récurrence : les séries se créent dans l’app). `pour` accepte des prénoms. `position` : « debut » pour la mettre en tête de liste, sinon elle va en fin.',
    inputSchema: {
      type: 'object',
      properties: { texte: S.string(300), liste: S.string(80), echeance: S.date, heure: S.time, pour: { type: 'array', maxItems: 20, items: S.string(80) }, note: S.string(2000), position: { type: 'string', enum: ['debut', 'fin'] } },
      required: ['texte'],
    },
    run: (ctx, a) => t.tacheCreer(ctx, { texte: str(a.texte) || '', liste: str(a.liste), echeance: str(a.echeance), heure: str(a.heure), pour: strArr(a.pour), note: str(a.note), position: str(a.position) === 'debut' ? 'debut' : str(a.position) === 'fin' ? 'fin' : undefined }),
  },
  {
    name: 'tache_terminer',
    write: true,
    description: 'Marque une tâche terminée (uniquement une tâche sans série).',
    inputSchema: { type: 'object', properties: { id: S.string(80) }, required: ['id'] },
    run: (ctx, a) => t.tacheTerminer(ctx, str(a.id) || ''),
  },
  {
    name: 'tache_deplacer',
    write: true,
    description: 'Range une tâche dans l’ordre du foyer, sans toucher à son échéance. `tache` désigne la tâche à déplacer par son intitulé (ou son identifiant). Où la ranger : « avant » ou « apres » une autre tâche (par intitulé ou identifiant), ou `position` « debut »/« fin ». Exemple à la voix : déplacer « le relevé des compteurs » avant « le rendez-vous notaire ». En cas d’intitulé ambigu, l’outil rend les candidats au lieu de choisir.',
    inputSchema: {
      type: 'object',
      properties: { tache: S.string(300), avant: S.string(300), apres: S.string(300), position: { type: 'string', enum: ['debut', 'fin'] } },
      required: ['tache'],
    },
    run: (ctx, a) => t.tacheDeplacer(ctx, { tache: str(a.tache) || '', avant: str(a.avant), apres: str(a.apres), position: str(a.position) === 'debut' ? 'debut' : str(a.position) === 'fin' ? 'fin' : undefined }),
  },
  {
    name: 'evenement_creer',
    write: true,
    description: 'Ajoute un événement à l’agenda. Sans heure, c’est une journée entière. `pour` accepte des prénoms.',
    inputSchema: {
      type: 'object',
      properties: { titre: S.string(200), date: S.date, heure: S.time, fin: S.time, lieu: S.string(200), pour: { type: 'array', maxItems: 20, items: S.string(80) } },
      required: ['titre', 'date'],
    },
    run: (ctx, a) => t.evenementCreer(ctx, { titre: str(a.titre) || '', date: str(a.date) || '', heure: str(a.heure), fin: str(a.fin), lieu: str(a.lieu), pour: strArr(a.pour) }),
  },
  {
    name: 'recette_importer',
    write: true,
    description: 'Importe une recette depuis l’adresse d’une page web (si le foyer l’autorise). La photo n’est pas importée par cette voie.',
    inputSchema: { type: 'object', properties: { url: S.string(2000) }, required: ['url'] },
    run: (ctx, a) => t.recetteImporter(ctx, str(a.url) || ''),
  },
];

/** Construit un serveur MCP lié à un membre et à une portée. Reconstruit à chaque requête (transport sans état). */
function buildServer(ctx: t.McpCtx): Server {
  const server = new Server({ name: 'foyer', version: '1.0.0' }, { capabilities: { tools: {} } });
  const visible = (): ToolDef[] => TOOLS.filter((tool) => ctx.scope === 'write' || !tool.write);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visible().map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = visible().find((x) => x.name === req.params.name);
    if (!tool) {
      // Un outil d'écriture demandé par un jeton `read` est « inconnu » de ce jeton.
      return { isError: true, content: [{ type: 'text' as const, text: `Outil inconnu ou non autorisé pour ce jeton : ${req.params.name}` }] };
    }
    const out = await tool.run(ctx, (req.params.arguments ?? {}) as Args);
    return { content: [{ type: 'text' as const, text: out }] };
  });

  return server;
}

/** Le routeur MCP. Le montage (réglage mcpEnabled, auth, jeton, limiteur) est fait par server.ts. */
export function mcpRouter(): Router {
  const r = express.Router();
  // Corps borné : un appel MCP est petit, jamais un document.
  r.use(express.json({ limit: '64kb' }));

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const token = req.apiToken;
    // Jeton obligatoire. `auth` a déjà refusé l'absence totale d'authentification
    // (401). Arriver ici sans jeton, c'est une session de navigateur : elle est
    // authentifiée mais interdite sur ce point d'entrée (403).
    if (!token) { res.status(403).json({ error: 'Le point MCP exige un jeton d’accès (Authorization: Bearer foyer_…), pas une session de navigateur.' }); return; }
    const m = currentMember(req);
    if (!m) { res.status(403).json({ error: 'Ce jeton n’est rattaché à aucun membre du foyer.' }); return; }

    const ctx: t.McpCtx = { memberId: m.id, enfant: !!m.enfant, scope: token.scope, via: token.name };
    const server = buildServer(ctx);
    // Sans état : un transport par requête, refermé avec la connexion.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      log.erreur('MCP : erreur en traitant une requête', e);
      if (!res.headersSent) res.status(500).json({ error: 'Erreur interne du serveur MCP.' });
    }
  });

  // Sans état : pas de flux d'événements à ouvrir par GET.
  r.get('/', (_req, res) => { res.status(405).json({ error: 'Utilisez POST pour le protocole MCP.' }); });

  return r;
}
