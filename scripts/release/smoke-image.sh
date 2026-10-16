#!/usr/bin/env bash
# Essai de fumée d'une image Docker de release, lancée comme docker-compose.yml
# la lance (système de fichiers en lecture seule, aucune capacité, port sur la
# boucle locale).
#
# Usage : scripts/release/smoke-image.sh <image> <version attendue> [plateforme]
#
# Vérifie, dans l'ordre : la plateforme et les étiquettes OCI de l'image, le
# démarrage, puis les contrôles HTTP communs avec l'archive (smoke-api.sh :
# /api/health, page d'accueil, onboarding, version annoncée). Le conteneur est
# supprimé quoi qu'il arrive.
set -euo pipefail

IMAGE="${1:?usage: smoke-image.sh <image> <version> [platform]}"
VERSION="${2:?usage: smoke-image.sh <image> <version> [platform]}"
PLATFORM="${3:-linux/amd64}"
PORT="${SMOKE_PORT:-18099}"
BASE="http://127.0.0.1:${PORT}"
NAME="foyer-smoke-$$"

WORK="$(mktemp -d)"
cleanup() { docker rm -f -v "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
fail() {
  echo "::error::Essai de fumée de l'image : $*" >&2
  echo "--- journal du conteneur ---" >&2
  docker logs --tail 50 "$NAME" >&2 2>&1 || true
  exit 1
}

echo "1. Plateforme et étiquettes"
GOT_PLATFORM="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$IMAGE")" || fail "image $IMAGE introuvable"
[[ "$GOT_PLATFORM" == "$PLATFORM" ]] || fail "plateforme « $GOT_PLATFORM », attendue « $PLATFORM »"
label() { docker image inspect --format "{{index .Config.Labels \"$1\"}}" "$IMAGE"; }
for l in source version licenses description; do
  [[ -n "$(label "org.opencontainers.image.$l")" ]] || fail "étiquette org.opencontainers.image.$l absente"
done
[[ "$(label org.opencontainers.image.version)" == "$VERSION" ]] || fail "étiquette version « $(label org.opencontainers.image.version) », attendue « $VERSION »"
echo "   $GOT_PLATFORM, source $(label org.opencontainers.image.source), licence $(label org.opencontainers.image.licenses)"

echo "2. Variable FOYER_VERSION"
ENV_VERSION="$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" | sed -n 's/^FOYER_VERSION=//p')"
[[ "$ENV_VERSION" == "$VERSION" ]] || fail "FOYER_VERSION « $ENV_VERSION », attendue « $VERSION »"

echo "3. Démarrage en production"
docker run -d --name "$NAME" --platform "$PLATFORM" \
  -p "127.0.0.1:${PORT}:8099" \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  -e FOYER_TRUST_PROXY=false \
  -e FOYER_JWT_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
  -e FOYER_SECRET_KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')" \
  "$IMAGE" >/dev/null || fail "le conteneur ne démarre pas"
sleep 1
[[ "$(docker inspect --format '{{.State.Running}}' "$NAME")" == true ]] || fail "le conteneur s'est arrêté au démarrage"

"$(dirname "${BASH_SOURCE[0]}")/smoke-api.sh" "$BASE" "$VERSION" "$WORK" || fail "contrôles HTTP"

echo "7. Arrêt"
docker stop -t 10 "$NAME" >/dev/null || fail "arrêt du conteneur"
echo "Essai de fumée de l'image réussi ($PLATFORM, $VERSION)."
