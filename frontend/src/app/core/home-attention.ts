// « À régler » et la phrase de synthèse de l'accueil bureau.
//
// Ce qui demande d'agir, toutes sources confondues, en cartes rangées par
// priorité. L'écran digère chaque source (le store, les finances, l'école…) en
// données simples et les passe ici ; une source à `null` est un module éteint,
// qui ne produit rien. Une carte disparaît d'elle-même dès que son action est
// faite : le geste coché avance son échéance, le repas planifié remplit le
// créneau, l'article rejoint les courses.

export type AttentionTone = 'crit' | 'warn' | 'info';

/** Ce que fait le bouton de la carte ; l'écran l'exécute avec `ref`. */
export type AttentionAction =
  | 'geste-done' | 'finances' | 'prep' | 'repas' | 'devoir' | 'ecole'
  | 'contrat' | 'releve' | 'stock' | 'equipement' | 'cesu';

export interface AttentionItem {
  id: string;
  module: string;
  icon: string;
  color: string;
  title: string;
  sub: string;
  tone: AttentionTone;
  action: { label: string; kind: AttentionAction; ref: string };
  rank: number;
  /** Échéance (AAAA-MM-JJ) pour départager deux cartes de même rang ; vide en dernier. */
  due: string;
  /** L'action est déjà faite aujourd'hui (un geste coché) : la carte le dit au lieu du bouton. */
  done?: boolean;
}

export interface AttentionInput {
  today: string;
  /** Formate une date pour un titre : « 12 nov. ». */
  fmt: (iso: string) => string;
  /** Les gestes en retard (`late`, au sens de la tolérance du geste) ou dus bientôt. */
  gestes: { id: string; text: string; due: string; late: boolean; doneToday: boolean }[] | null;
  finances: { remaining: number; fixedDue: number } | null;
  preps: { listId: string; name: string; forMember: boolean; days: number; remaining: number }[] | null;
  /** Les créneaux actifs d'aujourd'hui et des deux jours suivants. */
  repas: { date: string; key: string; planned: boolean }[] | null;
  ecole: { tests: { id: string; student: string; subject: string; day: string; due: string; count: number }[]; syncKo: string | null } | null;
  contrats: { contractId: number; name: string; date: string; daysAway: number }[] | null;
  releves: { contractId: number; name: string; daysSince: number | null }[] | null;
  stocks: { id: string; article: string; onList: boolean }[] | null;
  equipements: { id: number; name: string; panne: boolean; until: string | null }[] | null;
  /** Les mois CESU encore ouverts, avec le jour de rappel où ils deviennent à déclarer. */
  cesu: { month: string; who: string; due: string }[] | null;
}

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Jours entre deux dates ISO (b - a), en UTC : insensible aux changements d'heure. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}
export function addDaysIso(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
}
/** « lundi » pour une date ISO. */
export function weekdayOf(iso: string): string { return WEEKDAYS[new Date(iso + 'T12:00:00Z').getUTCDay()]; }

/** « 157 € » : l'accueil arrondit à l'euro, le détail est dans le module. */
export function euros(n: number): string {
  return Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ') + ' €';
}

/** « de maths », « d'anglais » : l'élision devant une voyelle ou un h muet. */
function de(word: string): string { return /^[aeiouyhàâéèêîôû]/i.test(word) ? 'd’' + word : 'de ' + word; }

/** « Interro de mathématiques lundi » : la matière telle qu'ÉcoleDirecte la nomme, et le jour. */
export function interroLabel(subject: string, day: string): string { return `Interro ${de(subject.toLowerCase())} ${day}`; }

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const MOD = {
  entretien: { module: 'Entretien', icon: 'outils', color: '#E56B4E' },
  finances: { module: 'Finances', icon: 'budget', color: '#7A9B76' },
  taches: { module: 'Tâches', icon: 'suitcase', color: '#9B6FA8' },
  repas: { module: 'Repas', icon: 'repas', color: '#D99A2B' },
  ecole: { module: 'École', icon: 'ecole', color: '#3D6FA8' },
  contrats: { module: 'Contrats', icon: 'budget', color: '#7A9B76' },
  equipements: { module: 'Équipements', icon: 'home', color: '#7A9B76' },
  employe: { module: 'Employé à domicile', icon: 'users', color: '#9B6FA8' },
};

/** Les cartes « À régler », toutes, triées par rang puis par échéance. L'écran en montre 4. */
export function homeAttention(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  const t = i.today;

  // 1. Gestes d'entretien en retard, ou dus d'ici deux jours.
  for (const g of i.gestes ?? []) {
    const d = daysBetween(t, g.due);
    if (d > 2) continue;
    const sub = g.doneToday ? 'Fait aujourd’hui' : g.late ? `En retard de ${Math.max(1, -d)} j` : d <= 0 ? 'À faire aujourd’hui' : d === 1 ? 'À faire d’ici demain' : 'À faire d’ici 2 jours';
    out.push({ id: 'geste-' + g.id, ...MOD.entretien, title: g.text, sub, tone: g.doneToday ? 'info' : g.late ? 'crit' : 'warn',
      action: { label: 'Fait', kind: 'geste-done', ref: g.id }, rank: 1, due: g.due, done: g.doneToday || undefined });
  }

  // 2. Le mois ne se finira pas : le reste à vivre est négatif.
  const f = i.finances;
  if (f && f.remaining < 0) {
    out.push({ id: 'finances', ...MOD.finances, title: `Il manque ${euros(-f.remaining)} pour finir le mois`,
      sub: f.fixedDue > 0 ? `Charges fixes à venir : ${euros(f.fixedDue)}` : 'Les dépenses dépassent les revenus du mois', tone: 'crit',
      action: { label: 'Voir', kind: 'finances', ref: '' }, rank: 2, due: t });
  }

  // 3. Un départ proche, avec des affaires à préparer.
  for (const p of i.preps ?? []) {
    if (p.remaining <= 0 || p.days < 0) continue;
    const quand = p.days === 0 ? 'aujourd’hui' : p.days === 1 ? 'demain' : `dans ${p.days} jours`;
    out.push({ id: 'prep-' + p.listId, ...MOD.taches, title: `${p.forMember ? 'Départ de' : 'Départ pour'} ${p.name} ${quand}`,
      sub: `${plural(p.remaining, 'affaire', 'affaires')} à préparer`, tone: p.days <= 1 ? 'warn' : 'info',
      action: { label: 'Ouvrir', kind: 'prep', ref: p.listId }, rank: 3, due: addDaysIso(t, p.days) });
  }

  // 4. Repas : rien ce soir, ou plus de la moitié des repas des trois jours à prévoir.
  if (i.repas?.length) {
    const missing = i.repas.filter((m) => !m.planned);
    const tonight = i.repas.some((m) => m.date === t && m.key === 'soir' && !m.planned);
    if (tonight || missing.length * 2 > i.repas.length) {
      const last = addDaysIso(t, 2);
      const title = missing.length === i.repas.length
        ? (weekdayOf(t) === 'vendredi' ? 'Aucun repas prévu ce week-end' : `Aucun repas prévu d’ici ${weekdayOf(last)}`)
        : tonight ? 'Rien de prévu ce soir' : `Des repas à prévoir d’ici ${weekdayOf(last)}`;
      out.push({ id: 'repas', ...MOD.repas, title, sub: `${plural(missing.length, 'repas', 'repas')} à planifier${tonight ? ', dont ce soir' : ''}`,
        tone: 'info', action: { label: 'Planifier', kind: 'repas', ref: '' }, rank: 4, due: t });
    }
  }

  // 5. École : une interro au prochain jour de classe, ou la synchronisation en échec.
  if (i.ecole) {
    if (i.ecole.syncKo) {
      out.push({ id: 'ecole-sync', ...MOD.ecole, title: 'ÉcoleDirecte ne répond plus', sub: i.ecole.syncKo, tone: 'crit',
        action: { label: 'Ouvrir', kind: 'ecole', ref: '' }, rank: 5, due: t });
    }
    for (const x of i.ecole.tests) {
      out.push({ id: 'interro-' + x.id, ...MOD.ecole, title: `${interroLabel(x.subject, x.day)} · ${x.student}`,
        sub: x.count > 1 ? `${x.count} devoirs en tout pour ${x.day}` : `Pour ${x.day}`, tone: 'warn',
        action: { label: 'Ouvrir', kind: 'devoir', ref: x.id }, rank: 5, due: x.due });
    }
  }

  // 6. Préavis de résiliation dans le mois : passé, le contrat est reconduit.
  for (const c of i.contrats ?? []) {
    if (c.daysAway < 0 || c.daysAway > 30) continue;
    out.push({ id: 'preavis-' + c.contractId + '-' + c.date, ...MOD.contrats, title: `Préavis ${c.name} avant le ${i.fmt(c.date)}`,
      sub: c.daysAway === 0 ? 'Dernier jour aujourd’hui' : `Encore ${plural(c.daysAway, 'jour', 'jours')} pour résilier`, tone: c.daysAway <= 7 ? 'warn' : 'info',
      action: { label: 'Voir', kind: 'contrat', ref: String(c.contractId) }, rank: 6, due: c.date });
  }

  // 7. Relevés de compteur en retard.
  for (const r of i.releves ?? []) {
    out.push({ id: 'releve-' + r.contractId, ...MOD.contrats, title: `Relevé du compteur ${r.name}`,
      sub: r.daysSince === null ? 'Aucun relevé enregistré' : `Dernier relevé il y a ${r.daysSince} j`, tone: 'info',
      action: { label: 'Saisir', kind: 'releve', ref: String(r.contractId) }, rank: 7, due: '' });
  }

  // 8. Stock bas d'un geste, quand l'article n'est pas déjà dans les courses.
  for (const s of i.stocks ?? []) {
    if (s.onList) continue;
    out.push({ id: 'stock-' + s.id, ...MOD.entretien, title: `${s.article.charAt(0).toUpperCase()}${s.article.slice(1)} à racheter`, sub: 'Stock presque épuisé', tone: 'info',
      action: { label: 'Ajouter aux courses', kind: 'stock', ref: s.id }, rank: 8, due: '' });
  }

  // 9. Équipements : une panne, ou une garantie qui expire.
  for (const e of i.equipements ?? []) {
    if (!e.panne && !e.until) continue;
    out.push({ id: 'eqp-' + e.id, ...MOD.equipements, title: e.panne ? `${e.name} en panne` : `Garantie de ${e.name}`,
      sub: e.panne ? 'Signalé en panne' : `Fin de garantie le ${i.fmt(e.until!)}`, tone: e.panne ? 'warn' : 'info',
      action: { label: 'Ouvrir', kind: 'equipement', ref: String(e.id) }, rank: 9, due: e.panne ? '' : e.until! });
  }

  // 10. Déclaration CESU, à partir du jour de rappel.
  for (const c of i.cesu ?? []) {
    if (c.due > t) continue;
    out.push({ id: 'cesu-' + c.month + '-' + c.who, ...MOD.employe, title: `Déclaration CESU ${de(MONTHS[Number(c.month.slice(5, 7)) - 1])}`, sub: c.who, tone: 'warn',
      action: { label: 'Déclarer', kind: 'cesu', ref: c.month }, rank: 10, due: c.due });
  }

  return out.sort((a, b) => a.rank - b.rank || (a.due || '9999').localeCompare(b.due || '9999'));
}

/** Un morceau de la phrase de synthèse ; `b` le met en gras. */
export interface BriefPart { text: string; b?: boolean; }

/**
 * « Aujourd'hui : 2 rendez-vous, 4 choses à régler et aucun repas prévu ce soir. »
 * Les rendez-vous sont les éléments à heure du jour ; la clause repas ne vient
 * que si rien n'est prévu ce soir.
 */
export function homeBrief(rdv: number, attention: number, noDinner: boolean): BriefPart[] {
  if (!rdv && !attention && !noDinner) return [{ text: 'Journée calme : rien de prévu, rien à régler.' }];
  const clauses: BriefPart[] = [
    rdv ? { text: plural(rdv, 'rendez-vous', 'rendez-vous'), b: true } : { text: 'aucun rendez-vous' },
    attention ? { text: plural(attention, 'chose à régler', 'choses à régler'), b: true } : { text: 'rien à régler' },
  ];
  if (noDinner) clauses.push({ text: 'aucun repas prévu ce soir' });
  const out: BriefPart[] = [{ text: 'Aujourd’hui : ' }];
  clauses.forEach((c, k) => {
    if (k) out.push({ text: k === clauses.length - 1 ? ' et ' : ', ' });
    out.push(c);
  });
  out.push({ text: '.' });
  return out;
}
