// Nettoyage d'un SVG reçu d'un navigateur (le dessin d'un enfant) avant de le
// garder. Un SVG est un document : il peut porter un script, un gestionnaire
// d'événement, un lien vers l'extérieur, du HTML embarqué. Rien de tout cela n'a
// sa place dans un dessin.
//
// Le principe est une liste blanche, et le document rendu est **reconstruit** à
// partir de ce qui a été compris : rien de l'entrée ne passe tel quel. Ce qui
// n'est pas compris fait refuser le fichier plutôt que d'être deviné.
//
// Pur, sans dépendance : pas d'analyseur XML à tenir à jour pour un format dont
// on n'accepte qu'un sous-ensemble.

/** Les éléments d'un dessin. Tout autre élément disparaît, avec son contenu. */
const ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'image',
  'defs', 'clippath', 'lineargradient', 'radialgradient', 'stop', 'title', 'desc',
]);
/** Un lien n'est accepté que vers l'intérieur du document, ou vers une photo embarquée. */
const LINK_OK = /^(#[\w.:-]+|data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+)$/;
const NAME = /^[A-Za-z_][\w.:-]*$/;
const TAG = /^<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/;
const ATTR = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

export type SvgResult = { ok: true; svg: string } | { ok: false; error: string };

const escapeAttr = (v: string): string => v.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);)/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const escapeText = (v: string): string => v.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|apos);)/g, '&amp;').replace(/>/g, '&gt;');

/** Un attribut gardé, ou null. */
function attribute(name: string, value: string): string | null {
  const n = name.toLowerCase();
  if (!NAME.test(name) || n.startsWith('on')) return null;
  // Une feuille de style peut charger une ressource ou, selon le navigateur, plus.
  if (/url\s*\(\s*(?!['"]?#)/i.test(value) || /javascript:|expression\s*\(|@import/i.test(value)) return null;
  if (n === 'href' || n === 'xlink:href') return LINK_OK.test(value.trim()) ? `${name}="${escapeAttr(value.trim())}"` : null;
  // Les espaces de noms sont des identifiants, pas des adresses contactées.
  if (n === 'xmlns' || n.startsWith('xmlns:')) return /^https?:\/\/[\w./#-]+$/.test(value) ? `${name}="${value}"` : null;
  return `${name}="${escapeAttr(value)}"`;
}

/** Rend le SVG nettoyé, ou la raison du refus. */
export function sanitizeSvg(input: string): SvgResult {
  // Prologue, type de document et commentaires : jamais nécessaires à un dessin.
  // Un type de document est le véhicule des entités, donc refusé s'il en déclare.
  if (/<!ENTITY/i.test(input)) return { ok: false, error: 'Dessin refusé : il déclare des entités.' };
  let rest = input.replace(/^﻿/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>[]*(\[[^\]]*\])?\s*>/gi, '');
  if (/<!\[CDATA\[/i.test(rest)) return { ok: false, error: 'Dessin refusé : il contient une section CDATA.' };
  const out: string[] = [];
  const open: string[] = [];
  /** Profondeur à partir de laquelle on est dans un élément retiré : son contenu part avec lui. */
  let dropFrom = -1;
  while (rest.length) {
    const lt = rest.indexOf('<');
    const text = lt < 0 ? rest : rest.slice(0, lt);
    if (text && dropFrom < 0 && open.length) out.push(escapeText(text));
    if (lt < 0) break;
    rest = rest.slice(lt);
    const m = TAG.exec(rest);
    if (!m) return { ok: false, error: 'Dessin refusé : son contenu n’est pas un SVG bien formé.' };
    rest = rest.slice(m[0].length);
    const [, closing, rawName, attrs, selfClosing] = m;
    const name = rawName!.toLowerCase();
    if (closing) {
      if (open.pop() !== rawName) return { ok: false, error: 'Dessin refusé : ses balises ne se referment pas dans l’ordre.' };
      if (dropFrom < 0) out.push(`</${rawName}>`);
      else if (open.length === dropFrom) dropFrom = -1;
      continue;
    }
    const kept = dropFrom < 0 && ELEMENTS.has(name);
    if (kept) {
      const list: string[] = [];
      for (const a of attrs!.matchAll(ATTR)) {
        const one = attribute(a[1]!, a[2] ?? a[3] ?? '');
        if (one) list.push(one);
      }
      out.push(`<${rawName}${list.length ? ' ' + list.join(' ') : ''}${selfClosing ? '/' : ''}>`);
    }
    if (!selfClosing) {
      if (!kept && dropFrom < 0) dropFrom = open.length;
      open.push(rawName!);
    }
  }
  if (open.length) return { ok: false, error: 'Dessin refusé : une balise n’est pas refermée.' };
  const svg = out.join('').trim();
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) return { ok: false, error: 'Dessin refusé : ce n’est pas un SVG.' };
  return { ok: true, svg };
}

/** Largeur et hauteur d'un SVG, d'après ses attributs ou sa viewBox ; null quand il n'en dit rien. */
export function svgSize(svg: string): { width: number; height: number } | null {
  const root = /<svg[^>]*>/i.exec(svg)?.[0] ?? '';
  const num = (a: string): number => parseFloat(new RegExp(`\\s${a}="([\\d.]+)`).exec(root)?.[1] ?? '');
  const box = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(root);
  const width = num('width') || parseFloat(box?.[1] ?? ''), height = num('height') || parseFloat(box?.[2] ?? '');
  return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
}
