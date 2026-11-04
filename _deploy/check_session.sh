#!/bin/bash
echo "=== 服务器时间 / 北京时间 ==="
date
TZ='Asia/Shanghai' date
echo
echo "=== 抽样确认是否为盘前（涨跌幅全 0）==="
/opt/fupan/server/.venv/bin/python - <<'PYEOF'
import sys, json
sys.path.insert(0, '/opt/fupan/server')
from fupan import fetch
rows = fetch.fetch_snapshot()
print('总行数:', len(rows))
norm = [fetch.normalize(r) for r in rows]
moved = [r for r in norm if abs(r['chg']) > 0.01]
print('涨跌幅非零的股票数:', len(moved))
print('前 5 只:', [(r['code'], r['name'], r['chg'], r['price'], r['pre_close']) for r in norm[:5]])
PYEOF
