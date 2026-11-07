#!/bin/bash
set -e
APP=/opt/fupan
cd "$APP"
echo "=== 1. pull ==="
# Local server edits to .env must survive; it is gitignored so pull is safe.
git pull --ff-only 2>&1 | tail -4
git log --oneline -1

echo
echo "=== 2. restart ==="
systemctl restart fupan.service
sleep 5
echo "service: $(systemctl is-active fupan.service)"

echo
echo "=== 3. kline host check (from the service venv) ==="
cd "$APP/server" && .venv/bin/python - <<'PYEOF'
import sys
sys.path.insert(0, '.')
from fupan import config, fetch
print('hosts:', len(config.KLINE_HOSTS))
for code in ('600000', '000001'):
    bars = fetch.fetch_kline(code, 10)
    print(f'  {code}: {len(bars)} bars, host hint={config.kline_host_hint()}')
PYEOF
