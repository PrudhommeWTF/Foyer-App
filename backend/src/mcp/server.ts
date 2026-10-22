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
import { effectiveSetting } from '../settings/repo';
import * as t from './tools';
import * as ed from './ecole-tools';
import * as en from './entretien-tools';
import * as eq from './equipements-tools';
import * as rv from './revisions-tools';

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
  /** Réservé aux adultes : jamais annoncé ni exécuté pour un jeton d'enfant (comme les modules Finances et Employé à domicile). */
  adultes?: boolean;
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
    description: 'Les articles « à prendre » d’une liste, groupés par rayon, avec leur identifiant [id]. Par défaut la liste principale. `coches: true` ajoute les articles déjà cochés (pour les relire ou en décocher un).',
    inputSchema: { type: 'object', properties: { liste: S.string(80), coches: { type: 'boolean' } } },
    run: (ctx, a) => t.coursesListe(ctx, str(a.liste), a.coches === true),
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
    description: 'Ajoute des articles à une liste de courses (défaut : la principale). Ne crée pas de doublon d’un article déjà « à prendre ». Le `rayon` se donne par son nom, sans emoji et sans tenir compte des accents ni de la casse (« frais », « fruits & légumes ») ; voir l’outil `rayons` pour la liste. Un rayon non reconnu ne bloque pas : l’article est ajouté au rayon de repli et la réponse le signale.',
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
    description: 'Coche des articles (déjà pris), par leurs identifiants.',
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
    description: 'Marque une tâche terminée. Pour une tâche qui revient (sortir les poubelles chaque mardi), solde l’occurrence en cours et passe à la suivante, calculée comme dans l’application ; la réponse donne la prochaine échéance.',
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
    // Un enfant lit le calendrier sans le modifier (comme à l'écran, et PUT /state fige ses événements).
    adultes: true,
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
    adultes: true,
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
    adultes: true,
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
    description: 'Change l’état d’articles (par [id]) : « a-prendre », « panier » (coché, déjà pris), ou « indisponible » (introuvable en magasin).',
    inputSchema: { type: 'object', properties: { ids: { type: 'array', maxItems: 100, items: S.string(80) }, etat: { type: 'string', enum: ['a-prendre', 'panier', 'indisponible'] } }, required: ['ids', 'etat'] },
    run: (ctx, a) => t.coursesEtat(ctx, strArr(a.ids), str(a.etat) || ''),
  },
  {
    name: 'courses_modifier',
    write: true,
    description: 'Modifie un article de courses (par [id]) : nom, quantité, rayon (nom), ou liste (nom). Ne change que les champs fournis. Le `rayon` se donne par son nom, sans emoji et sans tenir compte des accents ni de la casse (« frais », « fruits & légumes ») ; voir l’outil `rayons`. Un rayon non reconnu range l’article au rayon de repli et la réponse le signale.',
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
  // ---- Employé à domicile (« Ménage ») — réservé aux adultes ----
  {
    name: 'menage_mois',
    adultes: true,
    description: 'Le récapitulatif d’un mois pour l’employé à domicile : état, présences avec [id], total d’heures, salaire net par taux applicable, et le bloc « À saisir sur le CESU » prêt à recopier. `mois` au format AAAA-MM (défaut : mois courant). Sans présence, le dit explicitement.',
    inputSchema: { type: 'object', properties: { mois: S.string(7), employe: S.string(80) } },
    run: (ctx, a) => t.menageMois(ctx, { mois: str(a.mois), employe: str(a.employe) }),
  },
  {
    name: 'menage_presences',
    adultes: true,
    description: 'Les présences de l’employé sur une période (défaut : 31 derniers jours), avec leur [id]. Pour « quand est-elle venue la dernière fois ? ».',
    inputSchema: { type: 'object', properties: { du: S.date, au: S.date, employe: S.string(80) } },
    run: (ctx, a) => t.menagePresences(ctx, { du: str(a.du), au: str(a.au), employe: str(a.employe) }),
  },
  {
    name: 'menage_employes',
    adultes: true,
    description: 'Les employés à domicile déclarés, leur rôle, le taux net courant et sa date d’effet.',
    inputSchema: { type: 'object', properties: {} },
    run: (ctx) => t.menageEmployes(ctx),
  },
  {
    name: 'menage_presence_ajouter',
    adultes: true, write: true,
    description: 'Note une présence. Défauts : aujourd’hui, la durée habituelle réglée, l’unique employé actif. `heures` en décimal (3 = 3 h, 3.5 = 3 h 30, arrondi au quart d’heure). Si une présence existe déjà ce jour-là, ne l’ajoute pas : le signale et propose de la modifier. Refusé sur un mois déclaré ou payé.',
    inputSchema: { type: 'object', properties: { jour: S.date, heures: { type: 'number' }, note: S.string(500), employe: S.string(80) } },
    run: (ctx, a) => t.menagePresenceAjouter(ctx, { jour: str(a.jour), heures: num(a.heures), note: str(a.note), employe: str(a.employe) }),
  },
  {
    name: 'menage_presence_modifier',
    adultes: true, write: true,
    description: 'Modifie une présence (par [id]) : jour, heures (décimal), note. Refusé sur un mois figé.',
    inputSchema: { type: 'object', properties: { id: S.string(20), jour: S.date, heures: { type: 'number' }, note: S.string(500) }, required: ['id'] },
    run: (ctx, a) => t.menagePresenceModifier(ctx, { id: str(a.id) || '', jour: str(a.jour), heures: num(a.heures), note: str(a.note) }),
  },
  {
    name: 'menage_presence_retirer',
    adultes: true, write: true,
    description: 'Retire une présence (par [id]) : elle est archivée, jamais supprimée. Refusé sur un mois figé.',
    inputSchema: { type: 'object', properties: { id: S.string(20) }, required: ['id'] },
    run: (ctx, a) => t.menagePresenceRetirer(ctx, str(a.id) || ''),
  },
  {
    name: 'menage_mois_declarer',
    adultes: true, write: true,
    description: 'Fige un mois (AAAA-MM) en « déclaré » avec les totaux du moment, et renvoie le bloc CESU tel qu’il a été figé. Refusé si des présences n’ont pas de taux.',
    inputSchema: { type: 'object', properties: { mois: S.string(7), date: S.date, note: S.string(500) }, required: ['mois'] },
    run: (ctx, a) => t.menageMoisDeclarer(ctx, { mois: str(a.mois) || '', date: str(a.date), note: str(a.note) }),
  },
  {
    name: 'menage_mois_payer',
    adultes: true, write: true,
    description: 'Marque un mois déclaré comme payé. `montant_urssaf` (euros) enregistre le total calculé par le CESU, si connu.',
    inputSchema: { type: 'object', properties: { mois: S.string(7), date: S.date, montant_urssaf: { type: 'number' } }, required: ['mois'] },
    run: (ctx, a) => t.menageMoisPayer(ctx, { mois: str(a.mois) || '', date: str(a.date), montant_urssaf: num(a.montant_urssaf) }),
  },
  {
    name: 'menage_mois_rouvrir',
    adultes: true, write: true,
    description: 'Rouvre un mois déclaré ou payé : ses présences redeviennent modifiables. Journalisé avec le membre.',
    inputSchema: { type: 'object', properties: { mois: S.string(7) }, required: ['mois'] },
    run: (ctx, a) => t.menageMoisRouvrir(ctx, str(a.mois) || ''),
  },
  {
    name: 'menage_mois_sans_presence',
    adultes: true, write: true,
    description: 'Marque un mois « sans présence » (aucune venue), pour faire taire le rappel de déclaration.',
    inputSchema: { type: 'object', properties: { mois: S.string(7) }, required: ['mois'] },
    run: (ctx, a) => t.menageMoisSansPresence(ctx, str(a.mois) || ''),
  },
  // ---- Entretien de la maison : des tâches de la liste Entretien, mêmes opérations que l'écran ----
  {
    name: 'entretien_liste',
    description: 'Les gestes d’entretien de la maison (cartouche de la carafe, détecteurs de fumée, chaudière…), avec leur [id], la pièce, la fréquence, la dernière fois et par qui, la prochaine date (en retard ou non) et le stock. `quand` : semaine (défaut : d’ici 7 jours, retards compris), retard, ou tous. Filtres : `piece`, `equipement` (noms). Un geste jamais noté n’a pas de date et n’est jamais en retard.',
    inputSchema: { type: 'object', properties: { quand: { type: 'string', enum: ['semaine', 'retard', 'tous'] }, piece: S.string(60), equipement: S.string(120) } },
    run: (ctx, a) => en.entretienListe(ctx, { quand: str(a.quand), piece: str(a.piece), equipement: str(a.equipement) }),
  },
  {
    name: 'entretien_fait',
    write: true,
    description: 'Note un geste d’entretien fait (« j’ai testé l’alarme ce matin »). `id` : [id] ou intitulé du geste. `date` AAAA-MM-JJ (défaut aujourd’hui). `par` : prénom d’un membre, ou « le foyer » (défaut : le membre du jeton). La prochaine date part du jour du geste ; le stock éventuel baisse ; une seule réalisation par jour.',
    inputSchema: { type: 'object', properties: { id: S.string(300), date: S.date, par: S.string(80) }, required: ['id'] },
    run: (ctx, a) => en.entretienFait(ctx, { id: str(a.id) || '', date: str(a.date), par: str(a.par) }),
  },
  {
    name: 'entretien_creer',
    write: true,
    description: 'Crée un geste d’entretien qui revient à partir du jour où il est fait. `frequence` en français : « toutes les 4 semaines », « tous les 6 mois », « 1 fois par an », « tous les 5 ans ». `piece` : nom (créée si elle n’existe pas). `equipement` : nom d’un appareil du module Équipements. `stock` : { article, qte, unite, seuil } pour un consommable. `saison` facultative : « de mai à septembre » (le geste ne revient pas hors saison, la piscine) ; avec « 1 fois par an », c’est une fenêtre (« ramonage, 1 fois par an, de septembre à octobre » : à faire entre ces dates, en retard après). Sans saison, le geste reste « pas encore noté » jusqu’à entretien_fait.',
    inputSchema: {
      type: 'object',
      properties: {
        titre: S.string(300), frequence: S.string(60), saison: S.string(60), piece: S.string(60), equipement: S.string(120),
        stock: { type: 'object', properties: { article: S.string(120), qte: { type: 'integer', minimum: 0 }, unite: S.string(30), seuil: { type: 'integer', minimum: 0 } } },
      },
      required: ['titre', 'frequence'],
    },
    run: (ctx, a) => en.entretienCreer(ctx, { titre: str(a.titre) || '', frequence: str(a.frequence) || '', saison: str(a.saison), piece: str(a.piece), equipement: str(a.equipement), stock: (a.stock && typeof a.stock === 'object' ? a.stock : undefined) as never }),
  },
  {
    name: 'entretien_stock',
    write: true,
    description: 'Corrige le stock d’un geste : `mode` « ajout » (défaut, « j’en ai racheté 6 » : qte 6) ou « compte » (« il en reste 4 » : qte 4). `date` du comptage, AAAA-MM-JJ (défaut aujourd’hui).',
    inputSchema: { type: 'object', properties: { id: S.string(300), qte: { type: 'integer' }, mode: { type: 'string', enum: ['ajout', 'compte'] }, date: S.date }, required: ['id', 'qte'] },
    run: (ctx, a) => en.entretienStock(ctx, { id: str(a.id) || '', qte: num(a.qte) as number, mode: str(a.mode), date: str(a.date) }),
  },
  {
    name: 'entretien_pause',
    write: true,
    description: 'Met un geste en pause jusqu’à une date (absence, appareil en panne ; pour une saison qui revient chaque année, créez plutôt le geste avec une `saison`) : il disparaît des échéances et revient seul ce jour-là. `jusqu_au` AAAA-MM-JJ.',
    inputSchema: { type: 'object', properties: { id: S.string(300), jusqu_au: S.date }, required: ['id', 'jusqu_au'] },
    run: (ctx, a) => en.entretienPause(ctx, { id: str(a.id) || '', jusqu_au: str(a.jusqu_au) || '' }),
  },
  // ---- École (ÉcoleDirecte) : un enfant ne voit que lui, filtre fait dans chaque outil ----
  {
    name: 'ecole_devoirs',
    description: 'Les devoirs ÉcoleDirecte d’un enfant (ou de tous ceux que ce compte peut voir), avec leur [id], la matière, l’énoncé, « interrogation » le cas échéant, et fait ou à faire. `quand` : demain (défaut), semaine (7 jours), ou date (avec `date` AAAA-MM-JJ). `enfant` : prénom.',
    inputSchema: { type: 'object', properties: { enfant: S.string(80), quand: { type: 'string', enum: ['demain', 'semaine', 'date'] }, date: S.date } },
    run: (ctx, a) => ed.ecoleDevoirs(ctx, { enfant: str(a.enfant), quand: str(a.quand), date: str(a.date) }),
  },
  {
    name: 'ecole_devoir_fait',
    write: true,
    description: 'Marque un devoir (par [id], voir ecole_devoirs) fait, ou à faire avec `fait: false`. Coche aussi sa tâche dans « Devoirs de … » ; ÉcoleDirecte l’apprend à la synchronisation suivante.',
    inputSchema: { type: 'object', properties: { id: S.string(20), fait: { type: 'boolean' } }, required: ['id'] },
    run: (ctx, a) => ed.ecoleDevoirFait(ctx, { id: str(a.id) || String(num(a.id) ?? ''), fait: bool(a.fait) }),
  },
  {
    name: 'ecole_emploi_du_temps',
    description: 'Les cours importés d’ÉcoleDirecte pour un jour (défaut : aujourd’hui), cours annulés signalés, et l’heure de sortie. `enfant` : prénom ; `date` : AAAA-MM-JJ.',
    inputSchema: { type: 'object', properties: { enfant: S.string(80), date: S.date } },
    run: (ctx, a) => ed.ecoleEmploiDuTemps(ctx, { enfant: str(a.enfant), date: str(a.date) }),
  },
  {
    name: 'ecole_notes',
    description: 'Les dernières notes d’un enfant et les moyennes de la période, telles que calculées par l’établissement (jamais recalculées). Filtres : `matiere`, `depuis` (AAAA-MM-JJ). Un compte enfant ne lit que les siennes.',
    inputSchema: { type: 'object', properties: { enfant: S.string(80), matiere: S.string(80), depuis: S.date } },
    run: (ctx, a) => ed.ecoleNotes(ctx, { enfant: str(a.enfant), matiere: str(a.matiere), depuis: str(a.depuis) }),
  },
  {
    name: 'ecole_vie_scolaire',
    description: 'Absences, retards (justifiés ou non), sanctions et encouragements d’un enfant depuis le début de l’année scolaire, ou depuis `depuis` (AAAA-MM-JJ). Un compte enfant ne lit que les siens.',
    inputSchema: { type: 'object', properties: { enfant: S.string(80), depuis: S.date } },
    run: (ctx, a) => ed.ecoleVieScolaire(ctx, { enfant: str(a.enfant), depuis: str(a.depuis) }),
  },
  {
    name: 'ecole_etat',
    description: 'L’état de la synchronisation ÉcoleDirecte : par compte (connecté, question de sécurité, identifiants refusés, pause…), dernière réussite, dernière erreur, et par enfant la fraîcheur des données.',
    inputSchema: { type: 'object', properties: {} },
    run: (ctx) => ed.ecoleEtat(ctx),
  },
  // ---- Équipements : lecture pour tous (filtre enfant), écriture adultes ----
  {
    name: 'equipements_liste',
    description: 'Les appareils de la maison avec leur [id], marque et modèle, pièce et état de la garantie à la date du jour (« Sous garantie jusqu’au … », « Hors garantie depuis le … », « Garantie inconnue »). Filtres : `piece` (nom), `garantie` (sous_garantie, expire_bientot, hors_garantie, inconnue), `categorie`, `recherche` (désignation, marque, modèle, numéro de série).',
    inputSchema: { type: 'object', properties: { piece: S.string(60), garantie: { type: 'string', enum: ['sous_garantie', 'expire_bientot', 'hors_garantie', 'inconnue'] }, categorie: { type: 'string', enum: ['electromenager', 'multimedia', 'chauffage_clim', 'securite', 'jardin_piscine', 'informatique', 'mobilier', 'autre'] }, recherche: S.string(120) } },
    run: (ctx, a) => eq.equipementsListe(ctx, { piece: str(a.piece), garantie: str(a.garantie), categorie: str(a.categorie), recherche: str(a.recherche) }),
  },
  {
    name: 'equipement_detail',
    description: 'La fiche complète d’un appareil (par `id`, ou `nom` s’il est unique) : garantie expliquée, numéro de série, achat, pièces jointes présentes, historique des pannes et réparations. Pour un compte enfant, ni numéro de série ni montant. Les fichiers ne se téléchargent pas par ici.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, nom: S.string(120) } },
    run: (ctx, a) => eq.equipementDetail(ctx, { id: num(a.id), nom: str(a.nom) }),
  },
  {
    name: 'equipement_pieces',
    description: 'Les pièces de la maison (liste partagée avec Entretien) et le nombre d’appareils dans chacune : les noms acceptés par `piece`.',
    inputSchema: { type: 'object', properties: {} },
    run: () => eq.equipementPieces(),
  },
  {
    name: 'equipement_creer',
    adultes: true, write: true,
    description: 'Crée la fiche d’un appareil. Seul `nom` est requis ; `piece` est le nom d’une pièce existante (voir equipement_pieces). `achete_le` AAAA-MM-JJ, `prix` en euros, `garantie_mois` la durée constructeur (sinon la règle du foyer : 24 mois pour du neuf). La photo et la facture se joignent depuis l’application.',
    inputSchema: { type: 'object', properties: { nom: S.string(120), piece: S.string(60), marque: S.string(80), modele: S.string(80), serie: S.string(80), achete_le: S.date, prix: { type: 'number' }, garantie_mois: { type: 'number' } }, required: ['nom'] },
    run: (ctx, a) => eq.equipementCreer(ctx, { nom: str(a.nom), piece: str(a.piece), marque: str(a.marque), modele: str(a.modele), serie: str(a.serie), achete_le: str(a.achete_le), prix: num(a.prix), garantie_mois: num(a.garantie_mois) }),
  },
  {
    name: 'equipement_modifier',
    adultes: true, write: true,
    description: 'Modifie une fiche (par `id`, ou `nom` s’il est unique). Seuls les champs donnés changent ; une chaîne vide efface une date ou une pièce. `garantie_fin` : date de fin d’une extension (AAAA-MM-JJ). `statut` : en_service, en_panne, remplace, donne_vendu, jete.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, nom: S.string(120), piece: S.string(60), marque: S.string(80), modele: S.string(80), serie: S.string(80), achete_le: S.date, prix: { type: 'number' }, garantie_mois: { type: 'number' }, garantie_fin: S.date, statut: { type: 'string', enum: ['en_service', 'en_panne', 'remplace', 'donne_vendu', 'jete'] }, notes: S.string(2000) } },
    run: (ctx, a) => eq.equipementModifier(ctx, { id: num(a.id), nom: str(a.nom), piece: str(a.piece), marque: str(a.marque), modele: str(a.modele), serie: str(a.serie), achete_le: str(a.achete_le), prix: num(a.prix), garantie_mois: num(a.garantie_mois), garantie_fin: str(a.garantie_fin), statut: str(a.statut), notes: str(a.notes) }),
  },
  {
    name: 'equipement_evenement',
    adultes: true, write: true,
    description: 'Note un événement dans l’historique d’un appareil (par `id`, ou `nom` s’il est unique) : `type` panne, sav, reparation, remplacement, achat ou note ; `texte` ce qui s’est passé ; `cout` en euros ; `date` (défaut : aujourd’hui). Une panne passe la fiche « en panne », une réparation la remet « en service ». Pour « le lave-vaisselle fuit depuis ce matin ».',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, nom: S.string(120), type: { type: 'string', enum: ['panne', 'sav', 'reparation', 'remplacement', 'achat', 'note'] }, texte: S.string(1000), cout: { type: 'number' }, date: S.date }, required: ['type'] },
    run: (ctx, a) => eq.equipementEvenement(ctx, { id: num(a.id), nom: str(a.nom), type: str(a.type), texte: str(a.texte), cout: num(a.cout), date: str(a.date) }),
  },
  {
    name: 'revisions_exercices',
    description: 'Les exercices du module Révisions (les tables, les soustractions, les compléments, les doubles et moitiés, la comparaison des nombres, les nombres en lettres, la monnaie, la lecture de l’heure, la dictée de mots, la conjugaison, l’orthographe, le féminin et le pluriel, la lecture d’un petit texte), leur matière, et les paramètres qu’un programme peut régler, avec leurs bornes et leurs valeurs par défaut. À lire avant revisions_programme_definir.',
    inputSchema: { type: 'object', properties: {} },
    run: () => rv.revisionsExercices(),
  },
  {
    name: 'revisions_progression',
    description: 'Où en est un enfant (ou chaque enfant, sans `enfant`) dans ses révisions : programme, temps par réponse, items acquis, en cours ou pas encore vus, ce qui reste fragile (« 7 × 8 »), réussite par groupe sur 4 semaines. `exercice` : identifiant (voir revisions_exercices). Un compte enfant ne lit que lui.',
    inputSchema: { type: 'object', properties: { enfant: S.string(80), exercice: S.string(40) } },
    run: (ctx, a) => rv.revisionsProgression(ctx, { enfant: str(a.enfant), exercice: str(a.exercice) }),
  },
  {
    name: 'revisions_sessions',
    description: 'Les sessions de révisions d’un enfant depuis `depuis` (AAAA-MM-JJ, défaut : 7 derniers jours) : date, exercice, mode, réglages, bonnes, lentes, fausses. Un compte enfant ne lit que les siennes.',
    inputSchema: { type: 'object', properties: { enfant: S.string(80), depuis: S.date } },
    run: (ctx, a) => rv.revisionsSessions(ctx, { enfant: str(a.enfant), depuis: str(a.depuis) }),
  },
  {
    name: 'revisions_bilan',
    adultes: true,
    description: 'Le bilan des révisions d’un enfant (ou de chaque enfant) sur une période : `periode` semaine (défaut, du lundi à aujourd’hui), semaine-derniere, mois ou mois-dernier. Par matière puis par exercice : sessions, part de réponses justes comparée à la période précédente, réussite par groupe, ce qui reste fragile.',
    inputSchema: { type: 'object', properties: { enfant: S.string(80), periode: { type: 'string', enum: ['semaine', 'semaine-derniere', 'mois', 'mois-dernier'] } } },
    run: (ctx, a) => rv.revisionsBilan(ctx, { enfant: str(a.enfant), periode: str(a.periode) }),
  },
  {
    name: 'revisions_listes',
    description: 'Les listes d’un exercice à contenu (la dictée de mots) : livrées et du foyer, archivées signalées, leurs premiers mots, et quels enfants les travaillent. `exercice` : facultatif tant qu’un seul exercice a des listes.',
    inputSchema: { type: 'object', properties: { exercice: S.string(40) } },
    run: (_ctx, a) => rv.revisionsListes({ exercice: str(a.exercice) }),
  },
  {
    name: 'revisions_liste_creer',
    adultes: true, write: true,
    description: 'Crée une liste du foyer pour un exercice à contenu (« la dictée de la semaine ») : `nom` (1 à 60 caractères), `mots` (une liste, ou un texte séparé par des virgules ou des retours à la ligne ; 1 à 200 mots de 40 caractères au plus, doublons retirés ; accents gardés tels quels). Pour la conjugaison, un élément par forme : « être (présent) : nous sommes » ; pour l’orthographe, une phrase par élément, le trou entre accolades, le bon mot d’abord : « Il {a/à} un chat. » ; pour le féminin et le pluriel, le mot de départ, « > », puis le mot attendu avec son déterminant : « un cheval > des chevaux » ; pour la lecture, une question par élément (jusqu’à 240 caractères, virgules permises, une par ligne si `mots` est un texte) : le texte, la question puis les réponses séparés par « | », la bonne d’abord, les pièges après des « / » : « Léo mange une pomme. | Que mange Léo ? | une pomme / une poire ». Pour qu’un enfant la travaille, ensuite : revisions_programme_definir avec `params` { liste: l’identifiant rendu }.',
    inputSchema: { type: 'object', properties: { exercice: S.string(40), nom: S.string(60), mots: { type: ['array', 'string'], items: S.string(40) } }, required: ['nom', 'mots'] },
    run: (ctx, a) => rv.revisionsListeCreer(ctx, { exercice: str(a.exercice), nom: str(a.nom), mots: a.mots }),
  },
  {
    name: 'revisions_liste_modifier',
    adultes: true, write: true,
    description: 'Modifie une liste du foyer (par `id`, « foyer-<n> », voir revisions_listes) : `nom`, `mots` (remplace toute la liste), ou `archiver` (true la retire des choix, false la ressort). Une liste n’est jamais effacée ; une liste livrée ne se modifie pas ici.',
    inputSchema: { type: 'object', properties: { exercice: S.string(40), id: S.string(40), nom: S.string(60), mots: { type: ['array', 'string'], items: S.string(40) }, archiver: { type: 'boolean' } }, required: ['id'] },
    run: (ctx, a) => rv.revisionsListeModifier(ctx, { exercice: str(a.exercice), id: str(a.id), nom: a.nom === undefined ? undefined : str(a.nom) ?? '', mots: a.mots, archiver: bool(a.archiver) }),
  },
  {
    name: 'revisions_programme_definir',
    adultes: true, write: true,
    description: 'Règle le programme d’un enfant pour un exercice : `params` (les paramètres de l’exercice, voir revisions_exercices ; ceux qui manquent gardent la valeur du programme en cours), `questions` (5 à 100), `objectif_jour` (sessions par jour, 0 à 10), `secondes` (temps par réponse, null pour le barème selon l’âge). `retirer: true` retire le programme sans rien effacer. Pour « la maîtresse veut les tables de 2 à 5 pour Gaëtan ».',
    inputSchema: { type: 'object', properties: { enfant: S.string(80), exercice: S.string(40), params: { type: 'object' }, questions: { type: 'number' }, objectif_jour: { type: 'number' }, secondes: { type: ['number', 'null'] }, retirer: { type: 'boolean' } }, required: ['enfant'] },
    run: (ctx, a) => rv.revisionsProgrammeDefinir(ctx, {
      enfant: str(a.enfant), exercice: str(a.exercice), questions: num(a.questions), objectif_jour: num(a.objectif_jour), retirer: bool(a.retirer),
      params: a.params && typeof a.params === 'object' && !Array.isArray(a.params) ? a.params as Record<string, unknown> : undefined,
      secondes: a.secondes === null ? null : num(a.secondes),
    }),
  },
];

/** Construit un serveur MCP lié à un membre et à une portée. Reconstruit à chaque requête (transport sans état). */
function buildServer(ctx: t.McpCtx): Server {
  const server = new Server({ name: 'foyer', version: '1.0.0' }, { capabilities: { tools: {} } });
  // Un jeton d'enfant ne voit pas les outils réservés aux adultes, ni un jeton
  // `read` les outils d'écriture. Le même filtre sert à la liste et à l'appel :
  // un outil masqué est donc aussi « inconnu » à l'appel direct.
  // Un module désactivé retire ses outils, comme un jeton enfant retire les
  // outils adultes : recette_*/repas_* relèvent de « Repas et cuisine »,
  // menage_* de « Employé à domicile », ecole_* de « École » (éteint par
  // défaut), entretien_* d'« Entretien de la maison », equipement* d'« Équipements »,
  // revisions_* de « Révisions ».
  // Les autres domaines n'ont pas d'outils.
  const toolModuleOff = (name: string): boolean =>
    (effectiveSetting('modRepas') === false && (name.startsWith('recette') || name.startsWith('repas')))
    || (effectiveSetting('modEmploye') === false && name.startsWith('menage'))
    || (effectiveSetting('modEcole') !== true && name.startsWith('ecole'))
    || (effectiveSetting('modEntretien') === false && name.startsWith('entretien'))
    || (effectiveSetting('modEquipements') === false && name.startsWith('equipement'))
    || (effectiveSetting('modRevisions') === false && name.startsWith('revisions'));
  const visible = (): ToolDef[] => TOOLS.filter((tool) =>
    (ctx.scope === 'write' || !tool.write) && (!tool.adultes || !ctx.enfant) && !toolModuleOff(tool.name));

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
