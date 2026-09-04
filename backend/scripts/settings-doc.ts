// Engendre docs/parametres.md depuis le registre.
//
// Le document que tu reliras dans six mois ne doit pas être écrit à la main :
// il serait faux dans trois mois. Il est produit ici, et la CI échoue si le
// fichier commité ne correspond plus au registre
// (voir backend/test/settings-registry.test.ts).
//
//   cd backend && npm run docs:settings
import { SECTIONS, SettingDecl, sectionSettings } from '../src/settings/registry';

const SCOPE_LABELS: Record<string, string> = {
  deploiement: 'Déploiement',
  foyer: 'Foyer',
  personnel: 'Personnel',
};

const TYPE_LABELS: Record<string, string> = {
  bool: 'oui / non', int: 'entier', enum: 'liste', text: 'texte', time: 'heure',
};

/** La valeur par défaut, telle qu'on la lit dans un tableau. */
function defaultLabel(d: SettingDecl): string {
  if (typeof d.default === 'boolean') return d.default ? 'activé' : 'désactivé';
  if (d.default === '') return '_(vide)_';
  return '`' + String(d.default) + '`';
}

/** Les bornes ou les valeurs admises, quand il y en a. */
function domainLabel(d: SettingDecl): string {
  if (d.type === 'enum') return (d.options || []).map((o) => (o.value === '' ? '_(vide)_' : '`' + o.value + '`')).join(', ');
  if (d.type === 'int') return `de ${d.min ?? '-∞'} à ${d.max ?? '+∞'}`;
  if (d.type === 'text') return `${d.maxLength ?? 200} caractères au maximum`;
  if (d.type === 'time') return 'HH:MM';
  return '';
}

export function render(): string {
  const L: string[] = [];
  L.push('<!-- Fichier engendré par `cd backend && npm run docs:settings`. Ne pas modifier à la main : la CI compare. -->');
  L.push('');
  L.push('# Paramètres de Foyer');
  L.push('');
  L.push('Tous les réglages de l’application, leur portée, leur valeur par défaut et le module qui les');
  L.push('consomme. Cette page est **engendrée depuis le registre** (`backend/src/settings/registry.ts`,');
  L.push('copie identique dans `frontend/src/app/core/settings/registry.ts`), donc elle ne peut pas mentir.');
  L.push('');
  L.push('## Les trois portées');
  L.push('');
  L.push('| Portée | Où c’est écrit | Qui peut le changer |');
  L.push('|---|---|---|');
  L.push('| **Déploiement** | variables d’environnement (`/etc/foyer/foyer.env` en LXC, `docker-compose.yml` en Docker) | l’administrateur du serveur, suivi d’un redémarrage du service |');
  L.push('| **Foyer** | document du foyer, clé `settings` | un administrateur du foyer, depuis l’application |');
  L.push('| **Personnel** | document du foyer, par membre | le membre lui-même, depuis l’application |');
  L.push('');
  L.push('Un réglage appartient à **une seule** portée. Quand une variable d’environnement');
  L.push('l’emporte sur un réglage du foyer, la colonne « Variable prioritaire » la nomme, et');
  L.push('l’interface grise le champ en l’expliquant.');
  L.push('');

  for (const section of SECTIONS) {
    const items = sectionSettings(section.id);
    if (!items.length) continue;
    L.push(`## ${section.label}`);
    L.push('');
    L.push(section.desc);
    L.push('');
    L.push('| Clé | Libellé | Portée | Type | Défaut | Valeurs admises | Module | Variable prioritaire |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const d of items) {
      L.push(`| \`${d.key}\` | ${d.label} | ${SCOPE_LABELS[d.scope]} | ${TYPE_LABELS[d.type]} | ${defaultLabel(d)} | ${domainLabel(d) || '—'} | ${d.module} | ${d.envOverride ? '`' + d.envOverride + '`' : '—'} |`);
    }
    L.push('');
    for (const d of items) {
      L.push(`- **${d.label}** (\`${d.key}\`) : ${d.desc}`);
    }
    L.push('');
  }

  L.push('## Ajouter un réglage');
  L.push('');
  L.push('1. Déclarer une entrée dans `backend/src/settings/registry.ts`.');
  L.push('2. Recopier le fichier à l’identique dans `frontend/src/app/core/settings/registry.ts`.');
  L.push('3. Le lire dans le code avec `setting(\'maCle\', doc)` (côté serveur) ou `store.setting(\'maCle\')` (côté application).');
  L.push('4. Régénérer cette page : `cd backend && npm run docs:settings`.');
  L.push('');
  L.push('La page Paramètres n’est pas à modifier : elle est engendrée depuis le registre.');
  L.push('Un réglage déclaré que personne ne lit, ou une clé lue qui n’est pas déclarée, **fait échouer la CI**.');
  L.push('');
  return L.join('\n');
}

if (require.main === module) process.stdout.write(render());
