#!/usr/bin/env bash
# Backs up the database and the uploaded files, keeps the last 14 days, and
# optionally copies them off the server with rclone.
#
# Daily at 02:30 (crontab -e as the tdm user):
#   30 2 * * * /opt/tender-manager/deploy/scripts/backup.sh >> /var/log/tender-manager/backup.log 2>&1
#
# Needs /etc/tender-manager/mysql-backup.cnf (deploy/README.md, step 10):
#   [client]
#   user=tdm
#   password=...
set -euo pipefail

DB_NAME=${DB_NAME:-tender_manager}
STORAGE_DIR=${STORAGE_DIR:-/var/lib/tender-manager/storage}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/tender-manager}
KEEP_DAYS=${KEEP_DAYS:-14}
MYSQL_CNF=${MYSQL_CNF:-/etc/tender-manager/mysql-backup.cnf}
# Off-site copy, e.g. RCLONE_REMOTE=r2:tender-manager-backups (empty: keep on this server only).
RCLONE_REMOTE=${RCLONE_REMOTE:-}

stamp=$(date +%Y-%m-%d_%H%M)
mkdir -p "$BACKUP_DIR"
umask 077

db_file="$BACKUP_DIR/db_${stamp}.sql.gz"
files_file="$BACKUP_DIR/files_${stamp}.tar.gz"

echo "[$(date -Is)] Backing up database $DB_NAME"
# --single-transaction: a consistent copy without locking the app.
mysqldump --defaults-extra-file="$MYSQL_CNF" --single-transaction --no-tablespaces --routines --triggers \
  --default-character-set=utf8mb4 "$DB_NAME" | gzip -9 > "$db_file.part"
mv "$db_file.part" "$db_file"

if [ -d "$STORAGE_DIR" ]; then
  echo "[$(date -Is)] Backing up files in $STORAGE_DIR"
  tar -czf "$files_file.part" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
  mv "$files_file.part" "$files_file"
fi

# Quick check that the archives are readable.
gzip -t "$db_file"
[ -f "$files_file" ] && gzip -t "$files_file"

echo "[$(date -Is)] Removing backups older than $KEEP_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db_*.sql.gz' -o -name 'files_*.tar.gz' \) \
  -mtime +"$KEEP_DAYS" -delete

if [ -n "$RCLONE_REMOTE" ]; then
  echo "[$(date -Is)] Copying to $RCLONE_REMOTE"
  rclone copy "$BACKUP_DIR" "$RCLONE_REMOTE" --max-age 2d
fi

echo "[$(date -Is)] Done: $(du -h "$db_file" | cut -f1) database, $([ -f "$files_file" ] && du -h "$files_file" | cut -f1 || echo 'no') files"
