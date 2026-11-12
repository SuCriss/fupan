#!/bin/bash
echo "=== /api/ai/status ==="
curl -s -m 10 http://127.0.0.1:8000/api/ai/status
echo

echo "=== 实际调用一次 AI 笔记生成（验证新端点在生产可用）==="
PW='sukm123.'
curl -s -c /tmp/ac.txt -m 10 -X POST -H 'Content-Type: application/json' \
  -d "{\"password\":\"$PW\"}" http://127.0.0.1:8000/api/login > /dev/null

START=$(date +%s)
curl -s -b /tmp/ac.txt -m 120 -X POST -H 'Content-Type: application/json' \
  -d '{"date":"2026-11-11"}' http://127.0.0.1:8000/api/note/draft -o /tmp/nd.json
END=$(date +%s)
echo "  耗时 $((END-START))s"

python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/nd.json'))
    c = d.get('content') or ''
    if c:
        print(f"  生成成功 {len(c)} 字")
        print("  前 80 字:", c[:80].replace('\n', ' '))
    else:
        print("  失败:", str(d)[:200])
except Exception as e:
    print("  解析失败:", e, open('/tmp/nd.json').read()[:200])
PY

rm -f /tmp/ac.txt /tmp/nd.json
