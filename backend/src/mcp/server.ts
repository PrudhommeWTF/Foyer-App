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
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

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
    description: 'Les tâches, avec leur identifiant [id] et leur rang dans l’ordre du foyer (« 3/7 »). `quand` : toutes (défaut, ouvertes dans l’ordre manuel), aujourdhui/semaine/retard (ouvertes, dans l’ordre du temps), ou terminees (les plus récentes, pour en rouvrir ou en supprimer une).',
    inputSchema: { type: 'object', properties: { quand: { type: 'string', enum: ['aujourdhui', 'semaine', 'retard', 'toutes', 'terminees'] }, liste: S.string(80) } },
    run: (ctx, a) => t.tachesListe(ctx, (str(a.quand) as 'aujourdhui' | 'semaine' | 'retard' | 'toutes' | 'terminees') || 'toutes', str(a.liste)),
  },
  {
    name: 'rayons',
    description: 'Les rayons du magasin, dans l’ordre, pour ranger un article (les noms acceptés par `rayon`).',
    inputSchema: { type: 'object', properties: {} },
    run: (ctx) => t.rayons(ctx),
  },
  {
    name: 'emploi_du_temps',
    description: 'Les créneaux de l’emploi du temps (semaine type), avec leur [id]. Filtrable par `membre` (prénom) et `jour` (lundi..dimanche). Montre l’horaire, le type, la récurrence et si le créneau est publié à l’agenda.',
    inputSchema: { type: 'object', properties: { membre: S.string(80), jour: S.string(20) } },
    run: (ctx, a) => t.emploiDuTemps(ctx, { membre: str(a.membre), jour: str(a.jour) }),
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
    description: 'Ajoute un événement à l’agenda. Sans heure, c’est une journée entière. `pour` accepte des prénoms. `recurrence` : none (défaut), daily, weekday, weekly, biweekly, monthly.',
    inputSchema: {
      type: 'object',
      properties: { titre: S.string(200), date: S.date, heure: S.time, fin: S.time, lieu: S.string(200), pour: { type: 'array', maxItems: 20, items: S.string(80) }, recurrence: { type: 'string', enum: ['none', 'daily', 'weekday', 'weekly', 'biweekly', 'monthly'] } },
      required: ['titre', 'date'],
    },
    run: (ctx, a) => t.evenementCreer(ctx, { titre: str(a.titre) || '', date: str(a.date) || '', heure: str(a.heure), fin: str(a.fin), lieu: str(a.lieu), pour: strArr(a.pour), recurrence: str(a.recurrence) }),
  },
  {
    name: 'evenement_modifier',
    write: true,
    description: 'Modifie un événement (par son [id]). Ne change que les champs fournis. `heure` vide bascule en journée entière. `pour` remplace les participants (prénoms).',
    inputSchema: {
      type: 'object',
      properties: { id: S.string(80), titre: S.string(200), date: S.date, heure: S.time, fin: S.time, lieu: S.string(200), pour: { type: 'array', maxItems: 20, items: S.string(80) }, recurrence: { type: 'string', enum: ['none', 'daily', 'weekday', 'weekly', 'biweekly', 'monthly'] } },
      required: ['id'],
    },
    run: (ctx, a) => t.evenementModifier(ctx, { id: str(a.id) || '', titre: str(a.titre), date: str(a.date), heure: str(a.heure), fin: str(a.fin), lieu: str(a.lieu), pour: a.pour !== undefined ? strArr(a.pour) : undefined, recurrence: str(a.recurrence) }),
  },
  {
    name: 'evenement_supprimer',
    write: true,
    description: 'Supprime un événement de l’agenda, par son [id].',
    inputSchema: { type: 'object', properties: { id: S.string(80) }, required: ['id'] },
    run: (ctx, a) => t.evenementSupprimer(ctx, str(a.id) || ''),
  },
  {
    name: 'recette_importer',
    write: true,
    description: 'Importe une recette depuis l’adresse d’une page web (si le foyer l’autorise). La photo n’est pas importée par cette voie.',
    inputSchema: { type: 'object', properties: { url: S.string(2000) }, required: ['url'] },
    run: (ctx, a) => t.recetteImporter(ctx, str(a.url) || ''),
  },
  // ---- Courses : état, modification, retrait, listes ----
  {
    name: 'courses_etat',
    write: true,
    description: 'Change l’état d’articles (par [id]) : « a-prendre », « panier » (pris), ou « indisponible » (introuvable en magasin).',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', maxItems: 100, items: S.string(80) }, etat: { type: 'string', enum: ['a-prendre', 'panier', 'indisponible'] } }, required: ['ids', 'etat'] },
    run: (ctx, a) => t.coursesEtat(ctx, strArr(a.ids), str(a.etat) || ''),
  },
  {
    name: 'courses_modifier',
    write: true,
    description: 'Modifie un article de courses (par [id]) : nom, quantité, rayon (nom), ou liste (nom). Ne change que les champs fournis.',
    inputSchema: { type: 'object', properties: { id: S.string(80), nom: S.string(200), qte: S.string(40), rayon: S.string(80), liste: S.string(80) }, required: ['id'] },
    run: (ctx, a) => t.coursesModifier(ctx, { id: str(a.id) || '', nom: str(a.nom), qte: str(a.qte), rayon: str(a.rayon), liste: str(a.liste) }),
  },
  {
    name: 'courses_retirer',
    write: true,
    description: 'Retire des articles d’une liste de courses, par leurs [id].',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', maxItems: 100, items: S.string(80) } }, required: ['ids'] },
    run: (ctx, a) => t.coursesRetirer(ctx, strArr(a.ids)),
  },
  {
    name: 'liste_courses_creer',
    write: true,
    description: 'Crée une liste de courses.',
    inputSchema: { type: 'object', properties: { nom: S.string(80), couleur: S.string(20), icone: S.string(40) }, required: ['nom'] },
    run: (ctx, a) => t.listeCoursesCreer(ctx, { nom: str(a.nom) || '', couleur: str(a.couleur), icone: str(a.icone) }),
  },
  {
    name: 'liste_courses_renommer',
    write: true,
    description: 'Renomme une liste de courses (désignée par son nom actuel).',
    inputSchema: { type: 'object', properties: { liste: S.string(80), nom: S.string(80) }, required: ['liste', 'nom'] },
    run: (ctx, a) => t.listeCoursesRenommer(ctx, { liste: str(a.liste) || '', nom: str(a.nom) || '' }),
  },
  {
    name: 'liste_courses_supprimer',
    write: true,
    description: 'Supprime une liste de courses entière (par son nom), avec les articles qu’elle contient.',
    inputSchema: { type: 'object', properties: { liste: S.string(80) }, required: ['liste'] },
    run: (ctx, a) => t.listeCoursesSupprimer(ctx, str(a.liste) || ''),
  },
  // ---- Tâches : modifier, rouvrir, supprimer, listes ----
  {
    name: 'tache_modifier',
    write: true,
    description: 'Modifie une tâche (désignée par intitulé ou [id]) : texte, échéance (AAAA-MM-JJ, vide pour l’enlever), heure, participants (prénoms), note, ou liste. En cas d’intitulé ambigu, rend les candidats.',
    inputSchema: { type: 'object', properties: { tache: S.string(300), texte: S.string(300), echeance: S.date, heure: S.time, pour: { type: 'array', maxItems: 20, items: S.string(80) }, note: S.string(2000), liste: S.string(80) }, required: ['tache'] },
    run: (ctx, a) => t.tacheModifier(ctx, { tache: str(a.tache) || '', texte: str(a.texte), echeance: str(a.echeance), heure: str(a.heure), pour: a.pour !== undefined ? strArr(a.pour) : undefined, note: str(a.note), liste: str(a.liste) }),
  },
  {
    name: 'tache_rouvrir',
    write: true,
    description: 'Rouvre une tâche terminée (désignée par intitulé ou [id]). Voir taches_liste avec quand=terminees.',
    inputSchema: { type: 'object', properties: { tache: S.string(300) }, required: ['tache'] },
    run: (ctx, a) => t.tacheRouvrir(ctx, str(a.tache) || ''),
  },
  {
    name: 'tache_supprimer',
    write: true,
    description: 'Supprime une tâche (désignée par intitulé ou [id]), avec ses sous-tâches. En cas d’intitulé ambigu, rend les candidats.',
    inputSchema: { type: 'object', properties: { tache: S.string(300) }, required: ['tache'] },
    run: (ctx, a) => t.tacheSupprimer(ctx, str(a.tache) || ''),
  },
  {
    name: 'liste_taches_creer',
    write: true,
    description: 'Crée une liste de tâches. `type` : taches (défaut), corvees, checklist, preparation. `prive` la réserve à ce membre.',
    inputSchema: { type: 'object', properties: { nom: S.string(80), type: { type: 'string', enum: ['taches', 'corvees', 'checklist', 'preparation'] }, couleur: S.string(20), icone: S.string(40), prive: { type: 'boolean' } }, required: ['nom'] },
    run: (ctx, a) => t.listeTachesCreer(ctx, { nom: str(a.nom) || '', type: str(a.type), couleur: str(a.couleur), icone: str(a.icone), prive: bool(a.prive) }),
  },
  {
    name: 'liste_taches_renommer',
    write: true,
    description: 'Renomme une liste de tâches (désignée par son nom actuel).',
    inputSchema: { type: 'object', properties: { liste: S.string(80), nom: S.string(80) }, required: ['liste', 'nom'] },
    run: (ctx, a) => t.listeTachesRenommer(ctx, { liste: str(a.liste) || '', nom: str(a.nom) || '' }),
  },
  {
    name: 'liste_taches_archiver',
    write: true,
    description: 'Archive (ou restaure) une liste de tâches, par son nom. `archivee` : true pour archiver, false pour restaurer.',
    inputSchema: { type: 'object', properties: { liste: S.string(80), archivee: { type: 'boolean' } }, required: ['liste', 'archivee'] },
    run: (ctx, a) => t.listeTachesArchiver(ctx, { liste: str(a.liste) || '', archivee: bool(a.archivee) ?? true }),
  },
  {
    name: 'liste_taches_supprimer',
    write: true,
    description: 'Supprime une liste de tâches entière (par son nom), avec les tâches qu’elle contient.',
    inputSchema: { type: 'object', properties: { liste: S.string(80) }, required: ['liste'] },
    run: (ctx, a) => t.listeTachesSupprimer(ctx, str(a.liste) || ''),
  },
  // ---- Repas ----
  {
    name: 'repas_definir',
    write: true,
    description: 'Pose un repas sur un créneau (matin, midi ou soir) d’une date : des recettes (par nom ou [id]) et/ou des plats en texte libre. `couverts` fixe le nombre à table, `absents` retire des membres (prénoms). Remplace le contenu du créneau.',
    inputSchema: { type: 'object', properties: { date: S.date, creneau: S.string(20), recettes: { type: 'array', maxItems: 20, items: S.string(120) }, texte: { type: 'array', maxItems: 20, items: S.string(200) }, couverts: { type: 'number' }, absents: { type: 'array', maxItems: 20, items: S.string(80) } }, required: ['date', 'creneau'] },
    run: (ctx, a) => t.repasDefinir(ctx, { date: str(a.date) || '', creneau: str(a.creneau) || '', recettes: strArr(a.recettes), texte: strArr(a.texte), couverts: num(a.couverts), absents: strArr(a.absents) }),
  },
  {
    name: 'repas_vider',
    write: true,
    description: 'Vide un créneau de repas (matin, midi ou soir) d’une date.',
    inputSchema: { type: 'object', properties: { date: S.date, creneau: S.string(20) }, required: ['date', 'creneau'] },
    run: (ctx, a) => t.repasVider(ctx, { date: str(a.date) || '', creneau: str(a.creneau) || '' }),
  },
  // ---- Recettes ----
  {
    name: 'recette_creer',
    write: true,
    description: 'Crée une recette dans le carnet : nom, ingrédients (une ligne chacun), étapes, et si connus portions, temps de préparation et de cuisson.',
    inputSchema: { type: 'object', properties: { nom: S.string(200), ingredients: { type: 'array', maxItems: 100, items: S.string(300) }, etapes: { type: 'array', maxItems: 100, items: S.string(1000) }, portions: { type: 'number' }, prepMin: { type: 'number' }, cookMin: { type: 'number' }, source: S.string(2000) }, required: ['nom'] },
    run: (ctx, a) => t.recetteCreer(ctx, { nom: str(a.nom) || '', ingredients: strArr(a.ingredients), etapes: strArr(a.etapes), portions: num(a.portions), prepMin: num(a.prepMin), cookMin: num(a.cookMin), source: str(a.source) }),
  },
  {
    name: 'recette_modifier',
    write: true,
    description: 'Modifie une recette (par [id] ou nom). Un tableau fourni remplace entièrement l’ancien (ingrédients, étapes). Ne change que les champs fournis.',
    inputSchema: { type: 'object', properties: { id: S.string(200), nom: S.string(200), ingredients: { type: 'array', maxItems: 100, items: S.string(300) }, etapes: { type: 'array', maxItems: 100, items: S.string(1000) }, portions: { type: 'number' }, prepMin: { type: 'number' }, cookMin: { type: 'number' }, source: S.string(2000) }, required: ['id'] },
    run: (ctx, a) => t.recetteModifier(ctx, { id: str(a.id) || '', nom: str(a.nom), ingredients: a.ingredients !== undefined ? strArr(a.ingredients) : undefined, etapes: a.etapes !== undefined ? strArr(a.etapes) : undefined, portions: num(a.portions), prepMin: num(a.prepMin), cookMin: num(a.cookMin), source: str(a.source) }),
  },
  {
    name: 'recette_supprimer',
    write: true,
    description: 'Supprime une recette du carnet (par [id] ou nom).',
    inputSchema: { type: 'object', properties: { id: S.string(200) }, required: ['id'] },
    run: (ctx, a) => t.recetteSupprimer(ctx, str(a.id) || ''),
  },
  // ---- Emploi du temps ----
  {
    name: 'creneau_creer',
    write: true,
    description: 'Ajoute un créneau à l’emploi du temps. `pour` (prénoms) et `debut` (HH:MM) sont requis. Par défaut hebdomadaire : donnez `jour` (lundi..dimanche). Pour un créneau ponctuel, `recurrence`=once et `date`. Options : `fin`, `type` (ecole/travail/sport/loisir/sante/repas/autre), `unesur` (2 = une semaine sur deux), période `du`/`au`, `quand` (always/school/holidays), `hors_foyer`, `publier` (à l’agenda).',
    inputSchema: { type: 'object', properties: { label: S.string(120), pour: { type: 'array', maxItems: 20, items: S.string(80) }, jour: S.string(20), debut: S.time, fin: S.time, type: { type: 'string', enum: ['ecole', 'travail', 'sport', 'loisir', 'sante', 'repas', 'autre'] }, recurrence: { type: 'string', enum: ['weekly', 'once'] }, date: S.date, unesur: { type: 'number' }, du: S.date, au: S.date, quand: { type: 'string', enum: ['always', 'school', 'holidays'] }, hors_foyer: { type: 'boolean' }, publier: { type: 'boolean' } }, required: ['label', 'pour', 'debut'] },
    run: (ctx, a) => t.creneauCreer(ctx, { label: str(a.label) || '', pour: strArr(a.pour), jour: str(a.jour), debut: str(a.debut) || '', fin: str(a.fin), type: str(a.type), recurrence: str(a.recurrence), date: str(a.date), unesur: num(a.unesur), du: str(a.du), au: str(a.au), quand: str(a.quand), hors_foyer: bool(a.hors_foyer), publier: bool(a.publier) }),
  },
  {
    name: 'creneau_modifier',
    write: true,
    description: 'Modifie un créneau de l’emploi du temps (par [id]). Ne change que les champs fournis. Fournir `date` bascule le créneau en ponctuel.',
    inputSchema: { type: 'object', properties: { id: S.string(80), label: S.string(120), pour: { type: 'array', maxItems: 20, items: S.string(80) }, jour: S.string(20), debut: S.time, fin: S.time, type: { type: 'string', enum: ['ecole', 'travail', 'sport', 'loisir', 'sante', 'repas', 'autre'] }, date: S.date, unesur: { type: 'number' }, du: S.date, au: S.date, quand: { type: 'string', enum: ['always', 'school', 'holidays'] }, hors_foyer: { type: 'boolean' }, publier: { type: 'boolean' } }, required: ['id'] },
    run: (ctx, a) => t.creneauModifier(ctx, { id: str(a.id) || '', label: str(a.label), pour: a.pour !== undefined ? strArr(a.pour) : undefined, jour: str(a.jour), debut: str(a.debut), fin: str(a.fin), type: str(a.type), date: str(a.date), unesur: num(a.unesur), du: str(a.du), au: str(a.au), quand: str(a.quand), hors_foyer: bool(a.hors_foyer), publier: bool(a.publier) }),
  },
  {
    name: 'creneau_supprimer',
    write: true,
    description: 'Supprime un créneau de l’emploi du temps, par son [id].',
    inputSchema: { type: 'object', properties: { id: S.string(80) }, required: ['id'] },
    run: (ctx, a) => t.creneauSupprimer(ctx, str(a.id) || ''),
  },
  // ---- Lieux de vacances (inventaires) ----
  {
    name: 'lieux',
    description: 'Les lieux de vacances et leur inventaire, avec les [id]. Chaque affaire est « sur place » (là-bas) ou « ramenée » (ici). Filtrable par `lieu` (nom ou id).',
    inputSchema: { type: 'object', properties: { lieu: S.string(80) } },
    run: (ctx, a) => t.lieux(ctx, { lieu: str(a.lieu) }),
  },
  {
    name: 'lieu_creer',
    write: true,
    description: 'Crée un lieu de vacances (un inventaire qui ne se remet jamais à zéro).',
    inputSchema: { type: 'object', properties: { nom: S.string(80), couleur: S.string(20), icone: S.string(40), note: S.string(500) }, required: ['nom'] },
    run: (ctx, a) => t.lieuCreer(ctx, { nom: str(a.nom) || '', couleur: str(a.couleur), icone: str(a.icone), note: str(a.note) }),
  },
  {
    name: 'lieu_modifier',
    write: true,
    description: 'Modifie un lieu de vacances (par [id] ou nom) : nom, couleur, icône, note. Ne change que les champs fournis.',
    inputSchema: { type: 'object', properties: { id: S.string(80), nom: S.string(80), couleur: S.string(20), icone: S.string(40), note: S.string(500) }, required: ['id'] },
    run: (ctx, a) => t.lieuModifier(ctx, { id: str(a.id) || '', nom: str(a.nom), couleur: str(a.couleur), icone: str(a.icone), note: str(a.note) }),
  },
  {
    name: 'lieu_supprimer',
    write: true,
    description: 'Supprime un lieu de vacances entier (par [id] ou nom), avec les affaires de son inventaire.',
    inputSchema: { type: 'object', properties: { id: S.string(80) }, required: ['id'] },
    run: (ctx, a) => t.lieuSupprimer(ctx, str(a.id) || ''),
  },
  {
    name: 'affaire_ajouter',
    write: true,
    description: 'Ajoute des affaires à l’inventaire d’un lieu (nom ou [id]). `etat` : « la-bas » (sur place, défaut) ou « ici » (ramenée).',
    inputSchema: { type: 'object', properties: { lieu: S.string(80), affaires: { type: 'array', maxItems: 50, items: { type: 'object', properties: { nom: S.string(200), qte: S.string(40) }, required: ['nom'] } }, etat: { type: 'string', enum: ['la-bas', 'ici'] } }, required: ['lieu', 'affaires'] },
    run: (ctx, a) => {
      const affaires = Array.isArray(a.affaires) ? a.affaires.map((x) => { const o = (x ?? {}) as Args; return { nom: str(o.nom) || '', qte: str(o.qte) }; }) : [];
      return t.affaireAjouter(ctx, { lieu: str(a.lieu) || '', affaires, etat: str(a.etat) });
    },
  },
  {
    name: 'affaire_etat',
    write: true,
    description: 'Change l’état d’affaires (par [id]) : « la-bas » (laissée sur place) ou « ici » (ramenée à la maison).',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', maxItems: 100, items: S.string(80) }, etat: { type: 'string', enum: ['la-bas', 'ici'] } }, required: ['ids', 'etat'] },
    run: (ctx, a) => t.affaireEtat(ctx, strArr(a.ids), str(a.etat) || ''),
  },
  {
    name: 'affaire_modifier',
    write: true,
    description: 'Modifie une affaire (par [id]) : nom, quantité, ou lieu (déplacement vers un autre inventaire, par nom ou id). Ne change que les champs fournis.',
    inputSchema: { type: 'object', properties: { id: S.string(80), nom: S.string(200), qte: S.string(40), lieu: S.string(80) }, required: ['id'] },
    run: (ctx, a) => t.affaireModifier(ctx, { id: str(a.id) || '', nom: str(a.nom), qte: str(a.qte), lieu: str(a.lieu) }),
  },
  {
    name: 'affaire_retirer',
    write: true,
    description: 'Retire des affaires d’un inventaire, par leurs [id].',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', maxItems: 100, items: S.string(80) } }, required: ['ids'] },
    run: (ctx, a) => t.affaireRetirer(ctx, strArr(a.ids)),
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
