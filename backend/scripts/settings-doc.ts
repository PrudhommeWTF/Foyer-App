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

  L.push('## Où c’est stocké, et comment le sauvegarder');
  L.push('');
  L.push('Les réglages du foyer vivent dans le document JSON (table `household`), et le journal');
  L.push('des modifications dans la table `hh_settings_log` de la même base. Une archive du');
  L.push('dossier de données emporte donc les deux : il n’y a pas de sauvegarde séparée à penser.');
  L.push('');
  L.push('**Avant toute migration**, service arrêté (la base est en WAL : copier `foyer.db` pendant');
  L.push('que le service tourne donne une archive corrompue) :');
  L.push('');
  L.push('```bash');
  L.push('# LXC natif');
  L.push('systemctl stop foyer');
  L.push('install -d -m 750 /var/backups/foyer');
  L.push('tar czf "/var/backups/foyer/foyer-$(date +%F-%H%M).tar.gz" -C /var/lib foyer');
  L.push('cp /etc/foyer/foyer.env "/var/backups/foyer/foyer.env-$(date +%F-%H%M)"');
  L.push('systemctl start foyer && curl -fsS http://127.0.0.1:8099/api/health');
  L.push('');
  L.push('# Docker');
  L.push('docker compose stop foyer');
  L.push('docker run --rm -v foyer_data:/data -v "$PWD":/sauvegarde alpine \\');
  L.push('  tar czf "/sauvegarde/foyer-$(date +%F-%H%M).tar.gz" -C /data .');
  L.push('docker compose start foyer');
  L.push('```');
  L.push('');
  L.push('Restauration et vérification : voir [README, « Sauvegarde et restauration »](../README.md#-sauvegarde-et-restauration).');
  L.push('');
  L.push('Les migrations du document sont **rejouables** (chacune ne réagit qu’à l’ancienne forme)');
  L.push('et **réversibles** : le document d’origine est écrit sur le disque avant la première');
  L.push('migration en attente. Un réglage nouvellement déclaré n’a besoin d’aucune migration : il');
  L.push('prend sa valeur par défaut, et le document n’est réécrit que le jour où on le change.');
  L.push('');
  L.push('## Emporter et remettre la configuration');
  L.push('');
  L.push('Vos réglages seuls, dans un fichier JSON lisible. Ce n’est **pas** une sauvegarde des');
  L.push('données : c’est le filet de sécurité avant de toucher aux réglages, et ce qui évite de');
  L.push('tout reparamétrer de mémoire après une réinstallation.');
  L.push('');
  L.push('Depuis l’application : Paramètres → Exploitation → Configuration. En ligne de commande :');
  L.push('');
  L.push('```bash');
  L.push('# Exporter (compte administrateur)');
  L.push('TOKEN=$(curl -sS -X POST http://127.0.0.1:8099/api/auth/login \\');
  L.push('  -H \'Content-Type: application/json\' \\');
  L.push('  -d \'{"email":"vous@exemple.fr","password":"..."}\' | jq -r .token)');
  L.push('curl -sS http://127.0.0.1:8099/api/settings/export \\');
  L.push('  -H "Authorization: Bearer $TOKEN" -o foyer-reglages.json');
  L.push('');
  L.push('# Réimporter');
  L.push('jq \'{config: .}\' foyer-reglages.json | curl -sS -X POST \\');
  L.push('  http://127.0.0.1:8099/api/settings/import \\');
  L.push('  -H "Authorization: Bearer $TOKEN" -H \'Content-Type: application/json\' -d @-');
  L.push('```');
  L.push('');
  L.push('Le fichier porte **toutes** les clés, valeurs par défaut comprises : sans cela, réimporter');
  L.push('ne ramènerait pas l’état d’avant. L’import est rejouable, et n’échoue jamais en bloc : une');
  L.push('clé disparue, une valeur hors domaine, un membre qui n’existe plus ou un réglage imposé par');
  L.push('l’environnement sont écartés **en le disant**, le reste passe.');
  L.push('');
  L.push('## Qui peut changer quoi');
  L.push('');
  L.push('Le contrôle est **côté serveur**, pas dans l’écran :');
  L.push('');
  L.push('- `GET /api/settings` : tout membre connecté. Un adulte a le droit de savoir comment le foyer est réglé.');
  L.push('- `PATCH /api/settings` : **administrateur uniquement**, sinon `403`. Les réglages s’écrivent clé par clé, jamais par enregistrement du document entier, pour que deux administrateurs simultanés ne s’écrasent pas.');
  L.push('- `PUT /api/state` ignore le bloc `settings` et refuse (`403`) l’enregistrement d’un non-administrateur qui tenterait de le modifier par là.');
  L.push('');
  L.push('Chaque écriture est journalisée : qui, quand, quelle clé, de quelle valeur vers quelle valeur.');
  L.push('Le journal se lit dans la page Paramètres, et en ligne de commande :');
  L.push('');
  L.push('```bash');
  L.push('sqlite3 /var/lib/foyer/foyer.db \\');
  L.push('  "SELECT at, member_id, key, before_json, after_json FROM hh_settings_log ORDER BY id DESC LIMIT 20;"');
  L.push('```');
  L.push('');
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
