#!/bin/bash
echo "=== universe table ==="
/opt/fupan/server/.venv/bin/python - <<'PYEOF'
import sqlite3
c = sqlite3.connect('/opt/fupan/data/fupan.db')
try:
    n = c.execute("SELECT COUNT(*) FROM universe").fetchone()[0]
    print('universe rows:', n)
    for r in c.execute("SELECT code,name FROM universe LIMIT 5"):
        print('  ', r)
except Exception as e:
    print('universe query failed:', e)
print('tables:', [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")])
PYEOF

echo
echo "=== deployed code has save_universe? ==="
grep -c "save_universe" /opt/fupan/server/fupan/store.py
grep -n "save_universe(rows)" /opt/fupan/server/fupan/store.py

echo
echo "=== build timings from log ==="
journalctl -u fupan.service --since "-40 min" --no-pager | grep -E "snapshot built|snapshot:|universe" | tail -12