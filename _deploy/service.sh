#!/bin/bash
# Bootstrap .env and the systemd unit for fupan.
#
# The API key is NOT stored here: this file is tracked by git, and a credential
# committed once stays in the history forever. Export it before running:
#
#   export FUPAN_LLM_API_KEY=sk-...
#   bash _deploy/service.sh
#
# Without the key the service still starts; AI features report "未配置".
set -e
APP=/opt/fupan

LLM_BASE="${FUPAN_LLM_BASE_URL:-https://agent2api.cozehub.com/v1}"
LLM_MODEL="${FUPAN_LLM_MODEL:-deepseek-v4.1-flash}"
LLM_TIMEOUT="${FUPAN_LLM_TIMEOUT:-60}"
LLM_KEY="${FUPAN_LLM_API_KEY:-}"

if [ -z "$LLM_KEY" ]; then
  echo "警告：未设置 FUPAN_LLM_API_KEY，AI 归因/笔记功能将不可用"
  echo "      如需启用：export FUPAN_LLM_API_KEY=sk-... 后重新运行"
fi

echo "=== 1. 写入 .env（仅服务器本地，权限 600） ==="
umask 077
{
  echo "# AI 归因摘要配置（OpenAI 兼容接口）"
  echo "FUPAN_LLM_BASE_URL=$LLM_BASE"
  echo "FUPAN_LLM_API_KEY=$LLM_KEY"
  echo "FUPAN_LLM_MODEL=$LLM_MODEL"
  echo "FUPAN_LLM_TIMEOUT=$LLM_TIMEOUT"
} > "$APP/server/.env"
chmod 600 "$APP/server/.env"
ls -l "$APP/server/.env"
echo "base: $LLM_BASE  model: $LLM_MODEL  key 长度: ${#LLM_KEY}"

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
