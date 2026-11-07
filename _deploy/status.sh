#!/bin/bash
echo "=== service ==="
systemctl is-active fupan.service
systemctl is-enabled fupan.service
echo
echo "=== endpoints ==="
echo -n "health   : "; curl -s -m 8 http://127.0.0.1:8000/api/health
echo
echo -n "ai/status: "; curl -s -m 8 http://127.0.0.1:8000/api/ai/status
echo
echo -n "SPA      : "; curl -s -o /dev/null -w "HTTP %{http_code} %{size_download}b\n" -m 8 http://127.0.0.1:8000/
echo -n "assets   : "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -m 8 http://127.0.0.1:8000/assets/$(ls /opt/fupan/web/dist/assets | grep '\.js$' | head -1)
echo
echo "=== nginx site ==="
nginx -T 2>/dev/null | grep -A2 "server_name fupan" | head -5
echo
echo "=== resources ==="
free -m | head -2
df -h / | tail -1
echo
echo "=== db size ==="
du -sh /opt/fupan/data 2>/dev/null
