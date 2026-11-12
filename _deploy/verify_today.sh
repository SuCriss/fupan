#!/bin/bash
PW='sukm123.'
echo "=== 登录 ==="
curl -s -c /tmp/ck.txt -m 15 -X POST -H 'Content-Type: application/json' \
  -d "{\"password\":\"$PW\"}" http://127.0.0.1:8000/api/login
echo

echo "=== /api/all ==="
curl -s -b /tmp/ck.txt -m 40 http://127.0.0.1:8000/api/all -o /tmp/all.json
python3 - <<'PY'
import json
d = json.load(open('/tmp/all.json'))
s = d.get('stats') or {}
print(f"  date={s.get('date')} up={s.get('upCount')} down={s.get('downCount')}")
print(f"  sentiment={((d.get('sentiment') or {}).get('score'))} label={((d.get('sentiment') or {}).get('label'))}")
print(f"  fallback={d.get('fallback')} refreshing={d.get('refreshing')} stale={d.get('stale')}")
print(f"  leaders={len(d.get('leaders') or [])} pools.up={len((d.get('pools') or {}).get('up') or [])}")
PY

echo
echo "=== 健康 ==="
curl -s -m 10 http://127.0.0.1:8000/api/health
echo
echo "=== 源冷却记录 ==="
journalctl -u fupan.service --no-pager -n 600 | grep 'cooling down' | tail -5
rm -f /tmp/ck.txt /tmp/all.json
