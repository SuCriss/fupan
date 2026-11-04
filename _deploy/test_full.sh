#!/bin/bash
echo "=== 触发全市场快照（后台计时）==="
START=$(date +%s)
curl -s -m 600 "http://127.0.0.1:8000/api/all?date=" -o /tmp/all.json
RC=$?
END=$(date +%s)
echo "elapsed: $((END-START))s  curl_rc=$RC  bytes=$(stat -c%s /tmp/all.json 2>/dev/null || echo 0)"
echo
if [ -s /tmp/all.json ]; then
  /opt/fupan/server/.venv/bin/python - <<'PYEOF'
import json
try:
    d = json.load(open('/tmp/all.json'))
except Exception as e:
    print('parse error:', e); raise SystemExit
if d.get('error'):
    print('ERROR:', d['error'])
else:
    st = d['stats']
    print('date     ', st['date'])
    print('scanned  ', st['scanned'])
    print('up/zb/dt ', st['upCount'], '/', st['zhaCount'], '/', st['downCount'])
    print('lianban  ', st['lianbanCount'], ' maxBoard', st['maxBoard'])
    print('concepts ', [(s['name'], s['n']) for s in st['sectors'][:5]])
    if d['leaders']:
        l = d['leaders'][0]
        print('leader1  ', l['name'], l['score']['total'], l['score']['grade'])
        print('  tags   ', l.get('concepts', [])[:5])
PYEOF
fi
echo
echo "=== 服务日志尾部 ==="
journalctl -u fupan.service -n 8 --no-pager | grep -E 'fupan\.' | tail -5
