#!/usr/bin/env bash
# Restores a backup made by backup.sh.
#
#   restore.sh <db_YYYY-MM-DD_HHMM.sql.gz> [files_YYYY-MM-DD_HHMM.tar.gz] [target database]
#
# By default it restores into a NEW database (tender_manager_restore) so you
# can check a backup without touching the live data: the monthly restore test.
# To really replace the live data, stop the API first and pass tender_manager
# as the target (deploy/README.md, "Restoring").
set -euo pipefail

DB_BACKUP=${1:?Give the db_….sql.gz file}
FILES_BACKUP=${2:-}
TARGET_DB=${3:-tender_manager_restore}
MYSQL_CNF=${MYSQL_CNF:-/etc/tender-manager/mysql-backup.cnf}
STORAGE_DIR=${STORAGE_DIR:-/var/lib/tender-manager/storage}

if [ "$TARGET_DB" = "tender_manager" ]; then
  if systemctl is-active --quiet tender-manager-api; then
    echo "Stop the API first: sudo systemctl stop tender-manager-api" >&2
    exit 1
  fi
  read -r -p "This REPLACES the live database and files. Type RESTORE to continue: " answer
  [ "$answer" = "RESTORE" ] || exit 1
fi

echo "==> Restoring database into $TARGET_DB"
mysql --defaults-extra-file="$MYSQL_CNF" -e \
  "CREATE DATABASE IF NOT EXISTS \`$TARGET_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
gunzip -c "$DB_BACKUP" | mysql --defaults-extra-file="$MYSQL_CNF" "$TARGET_DB"

echo "==> Row counts"
mysql --defaults-extra-file="$MYSQL_CNF" "$TARGET_DB" -e "
  SELECT (SELECT COUNT(*) FROM organizations) AS clients,
         (SELECT COUNT(*) FROM users)         AS users,
         (SELECT COUNT(*) FROM tenders)       AS tenders,
         (SELECT COUNT(*) FROM files)         AS files;"

if [ -n "$FILES_BACKUP" ]; then
  if [ "$TARGET_DB" = "tender_manager" ]; then
    dest=$(dirname "$STORAGE_DIR")
    echo "==> Restoring files into $STORAGE_DIR"
    [ -d "$STORAGE_DIR" ] && mv "$STORAGE_DIR" "${STORAGE_DIR}.before-restore-$(date +%s)"
  else
    dest=/tmp/tender-manager-restore-check
    rm -rf "$dest" && mkdir -p "$dest"
    echo "==> Unpacking files into $dest to check them"
  fi
  tar -xzf "$FILES_BACKUP" -C "$dest"
  echo "Files: $(find "$dest" -type f | wc -l)"
fi
echo "Done."
