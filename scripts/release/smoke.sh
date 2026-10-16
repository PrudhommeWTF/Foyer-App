#!/usr/bin/env bash
# Essai de fumée d'une archive de release, lancée comme en production.
#
# Usage : scripts/release/smoke.sh <archive.tar.gz> <version attendue> <arch>
#
# Vérifie, dans l'ordre : l'empreinte (sha256sum -c), l'architecture du module
# SQLite natif, le démarrage en NODE_ENV=production, /api/health, la page
# d'accueil, une écriture réelle en base (onboarding), puis la version que l'API
# annonce. Le serveur est arrêté par SIGTERM puis attendu, quoi qu'il arrive.
set -euo pipefail

ARCHIVE="${1:?usage: smoke.sh <archive> <version> <arch>}"
VERSION="${2:?usage: smoke.sh <archive> <version> <arch>}"
ARCH="${3:?usage: smoke.sh <archive> <version> <arch>}"
PORT="${SMOKE_PORT:-18099}"
BASE="http://127.0.0.1:${PORT}"

ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
WORK="$(mktemp -d)"
PID=""
stop() {
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  PID=""
}
cleanup() { stop; rm -rf "$WORK"; }
trap cleanup EXIT
fail() {
  echo "::error::Essai de fumée : $*" >&2
  [[ -f "$WORK/server.log" ]] && { echo "--- journal du serveur ---" >&2; tail -n 50 "$WORK/server.log" >&2; }
  exit 1
}

echo "1. Empreinte"
(cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256") || fail "empreinte invalide"

echo "2. Contenu et architecture"
tar -xzf "$ARCHIVE" -C "$WORK"
APP="$WORK/foyer-app"
for f in dist/server.js public/index.html package.json LICENSE foyer.env.example; do
  [[ -e "$APP/$f" ]] || fail "$f absent de l'archive"
done
NATIVE="$APP/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
[[ -f "$NATIVE" ]] || fail "module SQLite natif absent"
DESC="$(file -b "$NATIVE")"
echo "   $DESC"
# On teste la machine visée, pas le mode d'édition des liens : « file » dit
# « dynamically linked » ou autre selon l'outillage, l'architecture est stable.
case "$ARCH" in
  x86_64) [[ "$DESC" == *ELF*x86-64* ]] || fail "module natif pas x86-64 : $DESC" ;;
  arm64)  [[ "$DESC" == *ELF*aarch64* ]] || fail "module natif pas aarch64 : $DESC" ;;
  *) fail "architecture inconnue : $ARCH" ;;
esac
GLIBC="$(grep -ao 'GLIBC_[0-9.]*' "$NATIVE" | sort -uV | tail -n1 || true)"
echo "   glibc minimale du module natif : ${GLIBC:-inconnue}"

echo "3. Démarrage en production"
mkdir -p "$WORK/data"
(
  cd "$APP"
  # Rien de l'environnement du runner : seulement ce qu'une installation pose.
  exec env -i PATH="$PATH" HOME="$WORK" NODE_ENV=production PORT="$PORT" FOYER_BIND=127.0.0.1 \
    FOYER_TRUST_PROXY=false FOYER_DATA_DIR="$WORK/data" \
    FOYER_JWT_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
    FOYER_SECRET_KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')" \
    node dist/server.js
) > "$WORK/server.log" 2>&1 &
PID=$!

for _ in $(seq 1 60); do
  kill -0 "$PID" 2>/dev/null || fail "le serveur s'est arrêté au démarrage"
  curl -fsS "$BASE/api/health" > "$WORK/health.json" 2>/dev/null && break
  sleep 1
done
grep -q '"ok":true' "$WORK/health.json" 2>/dev/null || fail "/api/health ne répond pas"
echo "   /api/health : $(cat "$WORK/health.json")"

echo "4. Page d'accueil"
curl -fsS "$BASE/" > "$WORK/index.html" || fail "page d'accueil injoignable"
grep -q '<base href="./">' "$WORK/index.html" || fail "la page d'accueil n'est pas l'app compilée"

echo "5. Écriture en base (onboarding)"
CODE="$(curl -sS -o "$WORK/setup.json" -w '%{http_code}' -c "$WORK/cookies" \
  -H 'Content-Type: application/json' \
  -d '{"household":{"name":"Essai"},"admin":{"name":"Essai","email":"essai@example.invalid","password":"essai-de-fumee-1234"}}' \
  "$BASE/api/setup")"
[[ "$CODE" == 201 ]] || fail "onboarding : HTTP $CODE $(cat "$WORK/setup.json")"

echo "6. Version annoncée"
curl -fsS -b "$WORK/cookies" "$BASE/api/system/version" > "$WORK/version.json" || fail "/api/system/version injoignable"
GOT="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).current))' "$WORK/version.json")"
[[ "$GOT" == "$VERSION" ]] || fail "version annoncée « $GOT », attendue « $VERSION »"
echo "   version : $GOT"

echo "7. Arrêt"
stop
echo "Essai de fumée réussi ($ARCH, $VERSION)."
