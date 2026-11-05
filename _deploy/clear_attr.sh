#!/bin/bash
set -e
DB=/opt/fupan/data/fupan.db
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB" "DELETE FROM attributions WHERE code='600519';"
  echo "deleted via sqlite3"
else
  cd /opt/fupan/server
  ./.venv/bin/python - <<'PY'
import sqlite3
from fupan import config as cfg
c = sqlite3.connect(cfg.DB_PATH)
n = c.execute("DELETE FROM attributions WHERE code='600519'").rowcount
c.commit()
print("deleted rows:", n)
PY
fi
sqlite3 "$DB" "SELECT code, trade_date FROM attributions WHERE code='600519';" 2>/dev/null || true
echo "done"
