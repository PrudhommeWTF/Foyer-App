// Garde-fou : `tsx --test <motif>` sort en code 0 quand le motif ne correspond à
// aucun fichier. Sans ce contrôle, un moteur d'analyse déplacé ou renommé
// laisserait la CI au vert en n'exécutant plus une seule assertion.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'app', 'core');

function collect(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(d, e.name);
    return e.isDirectory() ? collect(full) : e.name.endsWith('.test.ts') ? [full] : [];
  });
}

const files = fs.existsSync(dir) ? collect(dir) : [];

if (!files.length) {
  console.error(
    `[foyer] ERREUR : aucun fichier *.test.ts sous ${dir}.\n` +
    "        La suite de tests est vide : la CI serait verte sans rien vérifier.\n" +
    '        Restaurez les tests, ou corrigez le motif du script « test » dans package.json.',
  );
  process.exit(1);
}
console.log(`[foyer] ${files.length} fichier(s) de test : ${files.map((f) => path.basename(f)).join(', ')}`);
