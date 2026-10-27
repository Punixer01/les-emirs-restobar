#!/usr/bin/env bash
# Les Émirs — deploy.
#
#   ./scripts/deploy.sh staging    → private preview URL, NOT the live site
#   ./scripts/deploy.sh prod       → lesemirs.com (asks first)
#
# Staging and production run the same code against the SAME database, so a
# preview is for checking layout and flow — never for test bookings.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-staging}"
WRANGLER="env -u CLOUDFLARE_API_TOKEN ./node_modules/.bin/wrangler"

# reception, gérant and watcher are byte-for-byte copies of the owner dashboard
# (each page decides what it shows from its own URL); never let them drift
# — except the install file: each installed app must open its OWN address
for page in reception gerant watcher; do
  cp public/admin.html "public/$page.html"
  sed -i "s#/admin.webmanifest#/$page.webmanifest#" "public/$page.html"
done

# refuse to ship a file with a syntax error in it
for f in netlify/functions/*.mjs netlify/functions/_lib/*.mjs "functions/api/[[path]].js"; do
  node --check "$f" >/dev/null || { echo "SYNTAX ERROR in $f — not deploying." >&2; exit 1; }
done
node scripts/check-inline.mjs public/admin.html || { echo "not deploying." >&2; exit 1; }
# the server rules (permissions, places, notifications) must still hold
node tests/run.mjs >/dev/null || { node tests/run.mjs; echo "TESTS FAILED — not deploying." >&2; exit 1; }
echo "syntax OK (functions + dashboard script) · reception synced"

if [ "$TARGET" = "prod" ]; then
  read -r -p "Deploy to the LIVE site (lesemirs.com)? [y/N] " ok
  [ "${ok:-n}" = "y" ] || { echo "cancelled"; exit 1; }
  $WRANGLER pages deploy public --project-name les-emirs --branch master --commit-dirty=true
else
  echo "Deploying to the staging preview…"
  $WRANGLER pages deploy public --project-name les-emirs --branch staging --commit-dirty=true
  echo
  echo "Preview only — the live site is unchanged."
fi
