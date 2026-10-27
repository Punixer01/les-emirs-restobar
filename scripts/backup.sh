#!/usr/bin/env bash
# Les Émirs — full database backup.
#
#   ./scripts/backup.sh
#
# Exports the live D1 database to backup/ as a timestamped .sql dump and keeps
# the last KEEP files. The backup/ folder is gitignored: these dumps contain
# customer data (names, phones, emails, ticket photos) and must NEVER be
# committed — the repository is public.
#
# Cloudflare's own Time Travel only reaches back 30 days and only inside the
# account; this is the off-platform copy.
set -euo pipefail

DB="les-emirs-db"
KEEP=30
cd "$(dirname "$0")/.."
mkdir -p backup

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backup/les-emirs-${STAMP}.sql"

echo "Exporting ${DB} → ${OUT}"
# CLOUDFLARE_API_TOKEN is unset so wrangler uses the interactive login profile
env -u CLOUDFLARE_API_TOKEN ./node_modules/.bin/wrangler d1 export "$DB" --remote --output "$OUT"

if [ ! -s "$OUT" ]; then
  echo "FAILED: export is empty — backup not kept." >&2
  rm -f "$OUT"
  exit 1
fi

# sanity: a real dump must contain the reservations table
if ! grep -qi "CREATE TABLE.*reservations" "$OUT"; then
  echo "FAILED: dump has no reservations table — backup not kept." >&2
  rm -f "$OUT"
  exit 1
fi

SIZE=$(wc -c < "$OUT")
ROWS=$(grep -ci "^INSERT INTO" "$OUT" || true)
echo "OK — ${SIZE} bytes, ${ROWS} INSERT statements."

# keep only the most recent $KEEP dumps
ls -1t backup/les-emirs-*.sql 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "pruning $old"; rm -f "$old"
done

echo "Done. Latest: $OUT"
