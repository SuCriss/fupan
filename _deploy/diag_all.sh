#!/bin/bash
echo "=== origin direct timing (bypass Cloudflare) ==="
START=$(date +%s)
curl -s -m 600 -o /tmp/all.json -w "origin: HTTP %{http_code}  %{size_download}b  %{time_total}s\n" "http://127.0.0.1:8000/api/all?date="
echo "wall: $(( $(date +%s) - START ))s"
echo
echo "=== service log ==="
journalctl -u fupan.service -n 14 --no-pager | grep -E "fupan\.|GET /api/all" | tail -8
echo
echo "=== cached snapshot present? ==="
/opt/fupan/server/.venv/bin/python - <<'PYEOF'
import json, sqlite3
c = sqlite3.connect('/opt/fupan/data/fupan.db')
rows = c.execute('SELECT date, ts, length(payload) FROM snapshots ORDER BY date DESC LIMIT 3').fetchall()
print('snapshots:', rows)
PYEOF
