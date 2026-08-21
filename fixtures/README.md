# fixtures

Jeux de données réels, figés, utilisés par les tests.

- `cuisine-reelle.json` : extrait du foyer de production (18 recettes importées
  depuis Marmiton, 10 créneaux planifiés, 65 articles de liste, 4 rayons).
  Aucune donnée personnelle : ni membres, ni messages, ni finances. C'est le
  corpus sur lequel l'analyse des lignes d'ingrédients est mesurée, parce
  qu'un corpus inventé mesurerait surtout l'imagination de son auteur.

  Extrait avec, sur le conteneur :

  ```sh
  node -e '…' /var/lib/foyer/foyer.db   # voir docs/cuisine-architecture.md
  ```

Ces fichiers sont **versionnés** : ne rien y ajouter qui ne puisse être lu par
n'importe qui ayant accès au dépôt.
