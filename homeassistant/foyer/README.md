# Add-on Home Assistant — Foyer

Auto-héberge **Foyer** (gestion familiale) directement dans Home Assistant, avec
**ingress** : l'application apparaît dans la barre latérale de HA, sans exposer de port.

## Installation

1. Dans Home Assistant : **Paramètres → Modules complémentaires → Boutique des modules complémentaires**.
2. Menu ⋮ (en haut à droite) → **Dépôts** → ajoutez :
   ```
   https://github.com/PrudhommeWTF/Foyer-App
   ```
3. Le module **Foyer** apparaît dans la liste. Cliquez dessus → **Installer**.
4. Onglet **Configuration** : définissez au minimum `jwt_secret` (chaîne aléatoire longue),
   `admin_email` et `admin_password`.
5. **Démarrer** le module, activez *« Afficher dans la barre latérale »*.

## Options

| Option | Description | Défaut |
|---|---|---|
| `jwt_secret` | Secret de signature des jetons de session. **À personnaliser.** | *(généré au vol si vide)* |
| `admin_email` | Email du compte administrateur initial. | `camille.martin@email.fr` |
| `admin_password` | Mot de passe du compte initial (à changer). | `foyer` |
| `allow_signup` | Autoriser la création de comptes. Passez à `false` une fois le foyer créé. | `true` |

Les données (base SQLite) sont stockées dans `/data` et **persistent** entre les redémarrages
et les mises à jour du module.

## Build local (optionnel)

Le module utilise par défaut l'image multi-arch publiée (`ghcr.io/prudhommewtf/foyer-app`).
Pour compiler localement à la place, retirez la ligne `image:` de `config.yaml` : le module
sera alors construit depuis `Dockerfile`.
