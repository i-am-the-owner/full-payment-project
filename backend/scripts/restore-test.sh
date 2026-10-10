#!/bin/sh
# Proves a backup can be restored, and that what comes back is sane. Run it on a schedule.
#
#   RESTORE_DATABASE_URL=postgres://.../scratch_db ./scripts/restore-test.sh backups/almapay-<stamp>.dump
#
# RESTORE_DATABASE_URL must point at an EMPTY scratch database, never production:
# the script restores into it and refuses if it already has tables.
set -eu
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to an empty scratch database}"
file="${1:?Usage: restore-test.sh <backup.dump>}"
if [ -f "$file.sha256" ] && command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256")
fi
existing="$(psql "$RESTORE_DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [ "$existing" != "0" ]; then
  echo "Refusing: the scratch database already has $existing tables." >&2
  exit 1
fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$file"

q() { psql "$RESTORE_DATABASE_URL" -Atc "$1"; }
migrations="$(q "SELECT count(*) FROM schema_migrations")"
users="$(q "SELECT count(*) FROM users")"
transfers="$(q "SELECT count(*) FROM transfers")"
audit="$(q "SELECT count(*) FROM audit_events")"
bad_totals="$(q "SELECT count(*) FROM transfers WHERE total_to_pay_minor <> source_amount_minor + fee_amount_minor")"
orphans="$(q "SELECT count(*) FROM transfers t LEFT JOIN users u ON u.id = t.user_id WHERE u.id IS NULL")"
echo "Restored: $migrations migrations, $users users, $transfers transfers, $audit audit events."
if [ "$bad_totals" != "0" ] || [ "$orphans" != "0" ]; then
  echo "FAILED: $bad_totals transfers with inconsistent totals, $orphans transfers without a user." >&2
  exit 1
fi
echo "OK: the backup restores and its money totals are consistent."
