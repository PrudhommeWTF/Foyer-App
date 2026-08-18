// Garde-fou : `tsx --test test/*.test.ts` sort en code 0 quand le motif ne
// correspond à aucun fichier. Sans ce contrôle, un dossier de tests renommé ou
// déplacé laisserait la CI au vert en n'exécutant rien du tout.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'test');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.test.ts')) : [];

if (!files.length) {
  console.error(
    `[foyer] ERREUR : aucun fichier *.test.ts dans ${dir}.\n` +
    "        La suite de tests est vide : la CI serait verte sans rien vérifier.\n" +
    '        Restaurez les tests, ou corrigez le motif du script « test » dans package.json.',
  );
  process.exit(1);
}
console.log(`[foyer] ${files.length} fichier(s) de test : ${files.join(', ')}`);
