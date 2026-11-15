#!/bin/bash
echo "=== 登录 ==="
curl -s -c /tmp/vc.txt -m 10 -X POST -H 'Content-Type: application/json' \
  -d '{"password":"sukm123."}' http://127.0.0.1:8000/api/login
echo

echo "=== 接口可用性 ==="
for p in "/api/all" "/api/sectors?limit=5" "/api/lhb" "/api/sentiment?days=10" "/api/dates" "/api/health"; do
  code=$(curl -s -b /tmp/vc.txt -o /dev/null -w '%{http_code}' -m 30 "http://127.0.0.1:8000$p")
  printf '  %-30s %s\n' "$p" "$code"
done

echo
echo "=== /api/all 摘要 ==="
curl -s -b /tmp/vc.txt -m 30 http://127.0.0.1:8000/api/all -o /tmp/va.json
python3 - <<'PY'
import json
d = json.load(open('/tmp/va.json'))
s = d.get('stats') or {}
sent = d.get('sentiment') or {}
print(f"  日期        {s.get('date')}")
print(f"  涨停/跌停   {s.get('upCount')} / {s.get('downCount')}")
print(f"  情绪        {sent.get('score')} {sent.get('label')}")
print(f"  fallback    {d.get('fallback')}   refreshing {d.get('refreshing')}")
print(f"  龙头/涨停池 {len(d.get('leaders') or [])} / {len((d.get('pools') or {}).get('up') or [])}")
PY

echo
echo "=== 市场状态 ==="
curl -s -b /tmp/vc.txt -m 10 http://127.0.0.1:8000/api/market | python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"  {d['status']} 指数{len(d['indices'])}个\")"

rm -f /tmp/vc.txt /tmp/va.json
