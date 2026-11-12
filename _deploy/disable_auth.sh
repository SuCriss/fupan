#!/bin/bash
# Temporarily disable the access gate.
#
# The password is commented out rather than deleted, so re-enabling is one edit.
# auth.enabled() returns False when FUPAN_PASSWORD is absent, which makes the
# middleware a pass-through; no application code changes.
set -euo pipefail

ENV=/opt/fupan/server/.env
[ -f "$ENV" ] || { echo "没有 .env，门本来就是关的"; exit 0; }

cp "$ENV" "$ENV.bak-$(date +%Y%m%d-%H%M%S)"

# Comment out an active line only; re-running must not stack '#' characters.
if grep -q '^FUPAN_PASSWORD=' "$ENV"; then
  sed -i 's|^FUPAN_PASSWORD=|#FUPAN_PASSWORD=|' "$ENV"
  echo "已注释 FUPAN_PASSWORD"
else
  echo "FUPAN_PASSWORD 未处于启用状态"
fi

systemctl restart fupan.service
sleep 6

echo "=== 服务 ==="
systemctl is-active fupan.service
echo "=== 门状态 ==="
curl -s -m 10 http://127.0.0.1:8000/api/auth/status | sed 's/^/  /'
echo
echo "=== 未登录访问业务接口 ==="
curl -s -o /dev/null -w '  /api/all -> %{http_code}\n' -m 20 http://127.0.0.1:8000/api/all
