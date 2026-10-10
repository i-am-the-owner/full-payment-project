#!/bin/sh
# Backs up the AlmaPay database to a compressed, checksummed file.
#
#   DATABASE_URL=postgres://... ./scripts/backup-db.sh [output-dir]
#
# Uses pg_dump's custom format (restorable with pg_restore, selectively if needed).
# The file holds customer data: it is created owner-only (0600). Copy it somewhere
# encrypted and OFF the database server; this script does not upload anywhere.
# On a managed database (RDS, Cloud SQL, ...) prefer the provider's automated backups
# and point-in-time recovery, and use this script for an extra, independent copy.
set -eu
: "${DATABASE_URL:?Set DATABASE_URL}"
dir="${1:-./backups}"
mkdir -p "$dir"
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$dir/almapay-$stamp.dump"
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$file"
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$dir" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
fi
echo "Backup written: $file ($(wc -c < "$file") bytes)"
