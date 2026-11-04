#!/bin/bash
echo "=== health ==="
curl -s -m 10 http://127.0.0.1:8000/api/health
echo
echo "=== ai status ==="
curl -s -m 10 http://127.0.0.1:8000/api/ai/status
echo
echo "=== SPA ==="
curl -s -o /dev/null -w "HTTP %{http_code}  bytes=%{size_download}\n" -m 10 http://127.0.0.1:8000/
echo
echo "=== 全市场快照（首次较慢）==="
time curl -s -m 300 "http://127.0.0.1:8000/api/all?date=" -o /tmp/all.json
/opt/fupan/server/.venv/bin/python - <<'PYEOF'
import json
d = json.load(open('/tmp/all.json'))
if d.get('error'):
    print('ERROR:', d['error'])
else:
    st = d['stats']
    print('date', st['date'], '| scanned', st['scanned'])
    print('up', st['upCount'], '| lianban', st['lianbanCount'], '| zb', st['zhaCount'], '| dt', st['downCount'])
    print('concept clusters:', [(s['name'], s['n']) for s in st['sectors'][:5]])
    if d['leaders']:
        l = d['leaders'][0]
        print('leader1:', l['name'], l['score']['total'], l['score']['grade'])
        print('concepts:', l.get('concepts', [])[:5])
PYEOF
