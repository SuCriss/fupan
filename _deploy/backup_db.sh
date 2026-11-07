#!/bin/bash
# Hot backup of the fupan SQLite database.
#
# `sqlite3 .backup` is safe while the service runs (unlike copying the file,
# which can capture a torn WAL snapshot). Snapshots, K-line cache and the
# attribution cache all live in this one file, so losing it means losing every
# archived review day.
set -euo pipefail

DB=/opt/fupan/data/fupan.db
DEST=/opt/fupan/backup
KEEP_DAYS=14
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$DEST"

# Verify the database is readable and not corrupt before trusting the output.
if ! sqlite3 "$DB" "PRAGMA quick_check;" | head -1 | grep -q '^ok$'; then
  echo "$(date '+%F %T') ERROR: quick_check failed, backup aborted" >&2
  exit 1
fi

OUT="$DEST/fupan-$STAMP.db"
sqlite3 "$DB" ".backup '$OUT'"

# Verify the copy itself opens and has the expected table set.
if ! sqlite3 "$OUT" "SELECT COUNT(*) FROM snapshots;" >/dev/null 2>&1; then
  echo "$(date '+%F %T') ERROR: backup verification failed: $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

SIZE=$(du -h "$OUT" | cut -f1)
DAYS=$(sqlite3 "$OUT" "SELECT COUNT(*) FROM snapshots;")

# Rotate: keep the newest KEEP_DAYS files.
find "$DEST" -name 'fupan-*.db' -type f -mtime "+$KEEP_DAYS" -delete

echo "$(date '+%F %T') OK $OUT size=$SIZE snapshot_days=$DAYS"
