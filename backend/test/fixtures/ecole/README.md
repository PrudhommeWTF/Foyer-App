# Fixtures ÉcoleDirecte

Réponses de l'API ÉcoleDirecte servies par le faux serveur des tests
(`test/ecole-*.test.ts`). Aucun test ne contacte ÉcoleDirecte.

**Origine.** Les premières versions ont été écrites d'après le code de la
bibliothèque `ecoledirecte` 0.4.0 (hacf-fr/ecoledirecte_api) et la
documentation EduWireApps/ecoledirecte-api-docs, pas captées sur un vrai
compte. Elles se remplacent par des réponses réelles anonymisées avec la
sonde :

```sh
npm run ecole:sonde -- --compte 1 --fixtures /tmp/ed-fixtures
```

puis relecture **à la main** avant de les copier ici : la sonde remplace les
noms, prénoms, identifiants, adresses, jetons et le couple cn / cv, mais un
champ libre inattendu peut encore porter une donnée personnelle.

| Fichier | Réponse |
|---|---|
| `login-famille.json` | connexion réussie, compte famille, deux élèves dans deux établissements |
| `login-eleve.json` | connexion réussie, compte élève |
| `login-250.json` | connexion qui exige la question de sécurité |
| `doubleauth-get.json` | la question et ses propositions, en base64 |
| `doubleauth-post.json` | réponse acceptée : l'appareil de confiance (cn, cv) |
| `code-505.json`, `code-517.json`, `code-535.json` | identifiants refusés, version refusée, établissement fermé |
