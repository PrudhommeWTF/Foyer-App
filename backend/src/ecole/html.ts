// L'énoncé d'un devoir arrive en HTML (rédigé par l'enseignant dans
// l'éditeur d'ÉcoleDirecte). Deux sorties, pures et testées :
//
//   - `cleanHtml` : un HTML réduit à ce qui sert à lire un énoncé (paragraphes,
//     listes, gras, italique, liens http(s) et mailto). Tout le reste est retiré,
//     scripts et styles compris avec leur contenu. L'écran le repasse en plus
//     au nettoyeur d'Angular : deux barrières plutôt qu'une ;
//   - `htmlToText` : le même énoncé en texte brut, liens écrits en clair, pour
//     la note de la tâche, l'assistant et les notifications.

const KEEP = new Set(['p', 'br', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'a', 'span', 'div', 'sup', 'sub']);
const BLOCK_DROP = /<(script|style|iframe|object|embed|head|title|noscript)\b[\s\S]*?<\/\1\s*>/gi;

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—', deg: '°', euro: '€', oelig: 'œ', OElig: 'Œ',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', auml: 'ä', ccedil: 'ç', Ccedil: 'Ç',
  icirc: 'î', iuml: 'ï', ocirc: 'ô', ouml: 'ö', ugrave: 'ù', ucirc: 'û', uuml: 'ü', Eacute: 'É', Egrave: 'È', Agrave: 'À',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Seuls http(s) et mailto : jamais javascript:, data:, ni un lien relatif qui pointerait chez nous. */
const safeHref = (raw: string): string | null => {
  const href = decodeEntities(raw).trim();
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
};

export function cleanHtml(html: string): string {
  return html
    .replace(BLOCK_DROP, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (_m, close: string, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!KEEP.has(t)) return '';
      if (close) return `</${t}>`;
      if (t === 'a') {
        const m = /\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
        const href = m ? safeHref(m[2] ?? m[3] ?? m[4] ?? '') : null;
        return href ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">` : '<a>';
      }
      return t === 'br' ? '<br>' : `<${t}>`;
    })
    // Un « < » orphelin (texte mal échappé par l'éditeur) ne doit rien ouvrir.
    .replace(/<(?!\/?(p|br|ul|ol|li|b|strong|i|em|u|a|span|div|sup|sub)\b)/g, '&lt;')
    .trim();
}

export function htmlToText(html: string): string {
  const withLinks = html
    .replace(BLOCK_DROP, '')
    .replace(/<a\b[^>]*\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, d, s1, u, label: string) => {
      const href = safeHref(d ?? s1 ?? u ?? '');
      const txt = label.replace(/<[^>]*>/g, '').trim();
      if (!href) return txt;
      return txt && decodeEntities(txt) !== href ? `${txt} (${href})` : href;
    });
  return decodeEntities(withLinks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|ul|ol|h\d)>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** « MATHEMATIQUES » → « Mathematiques » ; « histoire-géo » reste lisible. Le serveur crie souvent en capitales. */
export function subjectLabel(s: string): string {
  const t = s.trim();
  if (!t) return 'Devoir';
  const lower = t === t.toUpperCase() ? t.toLowerCase() : t;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Le début d'un énoncé, coupé sur un mot, pour un titre de tâche. */
export function firstWords(text: string, max = 80): string {
  const line = text.split('\n').map((l) => l.replace(/^- /, '').trim()).find(Boolean) || '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,;:.]+$/, '') + '…';
}

/** Le titre de la tâche projetée : « Maths : exercices 12 et 13 p. 45 », ou « Interro d'anglais : … ». */
export function homeworkTitle(subject: string, text: string, isTest: boolean): string {
  const s = subjectLabel(subject);
  const debut = firstWords(text);
  if (isTest) {
    const m = s.toLowerCase();
    const head = (/^[aeiouyéèêàâîôûh]/i.test(m) ? 'Interro d’' : 'Interro de ') + m;
    return debut ? `${head} : ${debut}` : head;
  }
  return debut ? `${s} : ${debut}` : s;
}
