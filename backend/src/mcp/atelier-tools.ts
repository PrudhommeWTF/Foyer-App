// L'outil d'assistant du module Atelier code, en lecture seule : la liste des
// projets d'un enfant. Rien de leur contenu ne sort (ni scripts, ni dessins, ni
// sons) : un nom, une date, un niveau, et de quoi juger de la taille d'un projet.
// Même règle que les routes : un enfant ne voit que les siens.
import { getHousehold } from '../db';
import { HouseholdState, Member } from '../models';
import { ProjectRow, getProject, projectsOf } from '../atelier/repo';
import type { McpCtx } from './tools';

const members = (): Member[] => (getHousehold().state as HouseholdState).members;
const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const LEVEL: Record<string, string> = { petits: 'Petits codeurs', grands: 'Grands codeurs' };

/** Les membres visés : `enfant` par son prénom, sinon soi pour un enfant et les enfants du foyer pour un adulte. */
function pick(ctx: McpCtx, enfant?: string): Member[] | string {
  const me = members().find((m) => m.id === ctx.memberId);
  if (!enfant?.trim()) {
    if (ctx.enfant) return me ? [me] : 'Membre introuvable.';
    const kids = members().filter((m) => m.enfant);
    return kids.length ? kids : 'Aucun enfant dans le foyer. Précisez `enfant` pour voir les projets d’un adulte.';
  }
  const q = norm(enfant);
  const hits = members().filter((m) => norm(m.name) === q || norm(m.name).startsWith(q));
  if (!hits.length) return `Personne ne s’appelle « ${enfant} » dans le foyer. Membres : ${members().map((m) => m.name).join(', ')}.`;
  if (ctx.enfant && !hits.some((m) => m.id === ctx.memberId)) return 'Refusé : ce compte ne donne accès qu’à ce qui vous concerne.';
  return ctx.enfant ? hits.filter((m) => m.id === ctx.memberId) : hits;
}

/**
 * Ce qu'un projet contient, compté sans le comprendre plus que nécessaire : des
 * pages et des personnages chez les petits, des personnages et des décors chez
 * les grands. Un projet jamais enregistré, ou illisible, ne compte rien.
 */
export function projectSize(level: string, json: string | null): { pages?: number; personnages: number; decors?: number } | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json) as Record<string, unknown>;
    if (level === 'grands') {
      const targets = (Array.isArray(p['targets']) ? p['targets'] : []) as { isStage?: boolean; costumes?: unknown[] }[];
      return { personnages: targets.filter((t) => !t.isStage).length, decors: targets.find((t) => t.isStage)?.costumes?.length ?? 0 };
    }
    const pages = (Array.isArray(p['pages']) ? p['pages'] : []) as string[];
    return { pages: pages.length, personnages: pages.reduce((n, name) => n + (((p[name] as { sprites?: unknown[] } | undefined)?.sprites ?? []).length), 0) };
  } catch { return null; }
}

function line(row: ProjectRow): string {
  const size = projectSize(row.level, getProject(row.id)?.json ?? null);
  const what = !size ? 'pas encore enregistré'
    : row.level === 'grands' ? `${size.personnages} personnage(s), ${size.decors} décor(s)`
      : `${size.pages} page(s), ${size.personnages} personnage(s)`;
  return `- « ${row.name} » (${LEVEL[row.level] ?? row.level}), modifié le ${row.updated_at.slice(0, 10)} : ${what}${row.shared_at ? ', partagé avec la famille' : ''}`;
}

export function atelierProjets(ctx: McpCtx, a: { enfant?: string }): string {
  const who = pick(ctx, a.enfant);
  if (typeof who === 'string') return who;
  return who.map((m) => {
    const rows = projectsOf(m.id);
    return rows.length ? `${m.name} : ${rows.length} projet(s) dans l’Atelier code.\n${rows.map(line).join('\n')}` : `${m.name} : aucun projet dans l’Atelier code.`;
  }).join('\n\n');
}
