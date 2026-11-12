#!/bin/bash
# Check the new LLM endpoint before switching the service to it.
ENV=/opt/fupan/server/.env
KEY=$(grep '^FUPAN_LLM_API_KEY=' "$ENV" | cut -d= -f2-)
MODEL=$(grep '^FUPAN_LLM_MODEL=' "$ENV" | cut -d= -f2-)
OLD=$(grep '^FUPAN_LLM_BASE_URL=' "$ENV" | cut -d= -f2-)
echo "现有 base: $OLD"
echo "模型:      $MODEL"
echo "key 长度:  ${#KEY}"

NEW="https://agent2api.cozehub.com/v1"

echo
echo "=== 1. 新端点连通性（/models）==="
curl -s -o /tmp/m.json -w '  http=%{http_code} time=%{time_total}s\n' -m 20 \
  -H "Authorization: Bearer $KEY" "$NEW/models"
head -c 200 /tmp/m.json; echo

echo
echo "=== 2. 新端点 chat/completions 实测 ==="
cat > /tmp/req.json <<EOF
{"model":"$MODEL","messages":[{"role":"user","content":"只回复两个字：可用"}],"max_tokens":600}
EOF
curl -s -o /tmp/r.json -w '  http=%{http_code} time=%{time_total}s\n' -m 60 \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d @/tmp/req.json "$NEW/chat/completions"
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/r.json'))
    ch = (d.get('choices') or [{}])[0]
    msg = (ch.get('message') or {})
    print("  content:", (msg.get('content') or '(空)')[:60])
    print("  finish:", ch.get('finish_reason'))
    if d.get('error'):
        print("  error:", str(d['error'])[:160])
except Exception as e:
    print("  解析失败:", e)
    print("  原始:", open('/tmp/r.json').read()[:200])
PY

rm -f /tmp/m.json /tmp/r.json /tmp/req.json
