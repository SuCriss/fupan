#!/bin/bash
set -e
APP=/opt/fupan

echo "=== 1. 写入 .env（含 AI key，仅服务器本地） ==="
cat > "$APP/server/.env" <<'ENVEOF'
# AI 归因摘要配置（OpenAI 兼容接口）
FUPAN_LLM_BASE_URL=https://agent2api.chrisite.eu.cc/v1
FUPAN_LLM_API_KEY=sk-a2a-039e1586431fb18463418aface027cfb
FUPAN_LLM_MODEL=deepseek-v4.1-flash
FUPAN_LLM_TIMEOUT=60
ENVEOF
chmod 600 "$APP/server/.env"
ls -l "$APP/server/.env"
echo "key 行数: $(grep -c FUPAN_LLM_API_KEY "$APP/server/.env")"

echo
echo "=== 2. systemd 服务 ==="
cat > /etc/systemd/system/fupan.service <<'UNITEOF'
[Unit]
Description=fupan - A股涨停复盘 (FastAPI/uvicorn)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/fupan/server
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONIOENCODING=utf-8
ExecStart=/opt/fupan/server/.venv/bin/uvicorn fupan.app:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 加固：仅需写入 data 目录
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable fupan.service
systemctl restart fupan.service
sleep 6
systemctl is-active fupan.service
echo "--- 最近日志 ---"
journalctl -u fupan.service -n 12 --no-pager
