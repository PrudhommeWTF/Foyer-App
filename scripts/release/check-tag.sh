#!/usr/bin/env bash
# Contrôle d'un tag de release, avant tout build.
#
# Usage : scripts/release/check-tag.sh vX.Y.Z[-pre]
#
# Trois refus, chacun fatal :
#   1. un format hors « vX.Y.Z » ou « vX.Y.Z-pre » (semver strict, sans métadonnées
#      de build : la page des mises à jour les ignorerait) ;
#   2. un tag qui ne dépasse pas la plus haute version déjà taguée. Le dépôt ne
#      déclare aucune version (package.json reste à 0.0.0, la version vient du
#      tag) : la cohérence se vérifie donc par l'ordre, avec la comparaison même
#      que l'app utilise pour proposer une mise à jour (semverCmp). Un tag
#      inférieur ne serait jamais proposé à aucun foyer ;
#   3. un commit tagué absent de main : une release doit être ce que main a reçu.
#
# Écrit version= et prerelease= dans $GITHUB_OUTPUT quand il existe.
set -euo pipefail

TAG="${1:?usage: check-tag.sh <tag>}"
ROOT="$(git rev-parse --show-toplevel)"
MAIN_REF="${MAIN_REF:-origin/main}"

fail() { echo "::error::$*" >&2; exit 1; }

SEMVER='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
[[ "$TAG" =~ $SEMVER ]] || fail "Tag « $TAG » invalide : attendu vX.Y.Z ou vX.Y.Z-rc.N."
VERSION="${TAG#v}"
PRERELEASE=false
[[ "$VERSION" == *-* ]] && PRERELEASE=true

git rev-parse -q --verify "refs/tags/${TAG}^{commit}" >/dev/null || fail "Tag « $TAG » absent du dépôt local."

# Toutes les versions taguées sauf celle-ci (préfixe « v » ou non : les anciennes
# releases n'en portaient pas).
mapfile -t OTHERS < <(git tag -l | grep -E '^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' | grep -vxF "$TAG" || true)
# La comparaison de l'app, chargée telle quelle : copiée en .mts, le fichier se lit
# sans ambiguïté comme un module ES dont Node retire les types.
CMPDIR="$(mktemp -d)"; trap 'rm -rf "$CMPDIR"' EXIT
cp "$ROOT/backend/src/system/releases.ts" "$CMPDIR/releases.mts"
# Sortie : « <plus haute version existante> <signe de tag - plus haute> ».
read -r HIGHEST CMP < <(node --experimental-strip-types --no-warnings --input-type=module -e '
  const { semverCmp } = await import(process.argv[1]);
  const [tag, ...others] = process.argv.slice(2);
  const high = others.reduce((h, t) => (h === "" || semverCmp(t, h) > 0 ? t : h), "");
  console.log(high || "-", high ? Math.sign(semverCmp(tag, high)) : 1);
' "$CMPDIR/releases.mts" "$TAG" "${OTHERS[@]}")
[[ "$HIGHEST" == - ]] && HIGHEST=""
[[ "$CMP" == 1 ]] || fail "Tag « $TAG » non supérieur à la plus haute version existante (« $HIGHEST »)."

git rev-parse -q --verify "$MAIN_REF" >/dev/null || fail "Branche « $MAIN_REF » introuvable (historique complet requis)."
git merge-base --is-ancestor "${TAG}^{commit}" "$MAIN_REF" || fail "Le commit de « $TAG » n'est pas dans $MAIN_REF."

echo "Tag $TAG valide : version $VERSION, préversion $PRERELEASE, précédente ${HIGHEST:-aucune}."
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  { echo "version=$VERSION"; echo "prerelease=$PRERELEASE"; } >> "$GITHUB_OUTPUT"
fi
