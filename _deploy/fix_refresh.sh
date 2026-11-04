#!/bin/bash
set -e
cd /opt/fupan
echo "=== pull ==="
git pull --ff-only 2>&1 | tail -3
echo "=== build web ==="
cd web && npm run build 2>&1 | tail -5
echo "=== restart backend ==="
cd /opt/fupan
systemctl restart fupan.service
sleep 5
systemctl is-active fupan.service
echo "=== refresh status after restart ==="
curl -s -m 10 http://127.0.0.1:8000/api/refresh/status
echo