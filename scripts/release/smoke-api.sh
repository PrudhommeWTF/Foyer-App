#!/usr/bin/env bash
# Contrôles HTTP d'un Foyer fraîchement démarré, quelle que soit sa forme
# (archive lancée par smoke.sh, image lancée par smoke-image.sh).
#
# Usage : scripts/release/smoke-api.sh <url de base> <version attendue> <dossier de travail>
#
# Attend /api/health (60 s), puis vérifie la page d'accueil, une écriture réelle
# en base (onboarding) et la version que l'API annonce. Code de sortie non nul au
# premier échec ; le journal du serveur est à la charge de l'appelant.
set -euo pipefail

BASE="${1:?usage: smoke-api.sh <base> <version> <workdir>}"
VERSION="${2:?usage: smoke-api.sh <base> <version> <workdir>}"
WORK="${3:?usage: smoke-api.sh <base> <version> <workdir>}"

fail() { echo "::error::Essai de fumée : $*" >&2; exit 1; }

echo "   attente de /api/health"
for _ in $(seq 1 60); do
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
# Lu sans Node : l'hôte qui essaie une image n'a pas à en avoir.
GOT="$(sed -n 's/.*"current":"\([^"]*\)".*/\1/p' "$WORK/version.json")"
[[ "$GOT" == "$VERSION" ]] || fail "version annoncée « $GOT », attendue « $VERSION »"
echo "   version : $GOT"
