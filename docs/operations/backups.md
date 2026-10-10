# Database backups and restore

The database is the only state that matters (customers, transfers, the audit log). Provider tokens inside it are
encrypted with `ENCRYPTION_KEY`, so **a backup is useless without that key, and the key must never be stored next to
the backup.**

## What to run in production

1. **Managed automated backups with point-in-time recovery** (RDS, Cloud SQL, Neon, ...): daily snapshots, 14 to 35
   days of PITR, encryption at rest, and a replica or snapshot copy in a second region. This is the primary backup.
2. **An independent logical backup** with `backend/scripts/backup-db.sh`, daily, copied to encrypted storage in a
   different account. It protects against a mistake or compromise of the primary.
3. **A restore test** with `backend/scripts/restore-test.sh`, at least monthly and after every migration that rewrites
   data, into an empty scratch database. It restores, then checks the migration count, that every transfer's total
   equals amount plus fee, and that no transfer is orphaned.
4. **Keep the keys**: `ENCRYPTION_KEY` (all versions in use) and `JWT_SECRET` in the secret manager with its own
   backup and access log.

Targets to agree (placeholders): RPO (data you can afford to lose) 15 minutes with PITR; RTO (time to restore) 2 hours.

## Commands

```bash
DATABASE_URL=postgres://... backend/scripts/backup-db.sh ./backups                 # custom-format dump + sha256, mode 0600
psql "$ADMIN_URL" -c "CREATE DATABASE restore_check"
RESTORE_DATABASE_URL=postgres://.../restore_check backend/scripts/restore-test.sh backups/almapay-<stamp>.dump
```

`restore-test.sh` refuses a database that already has tables, so it cannot overwrite a live one by mistake.
A real disaster restore is the same `pg_restore` into a new instance, then point `DATABASE_URL` at it, then start
the workers last.

## Retention

Financial records are kept five years (UK rule); the privacy script (`scripts/user-data.ts`) erases personal data but
keeps transfer records. Backups of an erased person age out with the backup rotation: keep the rotation short enough
to match your privacy notice (compliance decision, GO_LIVE "retention").

## Tested

Run against the local stack on 2026-10-03: backup of 21 migrations, 3 users, 10 transfers, restore into an empty
database, consistency checks passed, and a second restore into the now non-empty database was refused. **Not yet
tested against the production database** (none exists): GO_LIVE item "backups tested" stays OPEN until it is.
