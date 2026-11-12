#!/bin/bash
# Rewrite only server/.env, keeping the API key out of version control.
#
#   export FUPAN_LLM_API_KEY=sk-...
#   bash _deploy/fix_env.sh
#
# Runs with umask 077 so the file is never world-readable, even briefly.
set -e
APP=/opt/fupan

LLM_BASE="${FUPAN_LLM_BASE_URL:-https://agent2api.cozehub.com/v1}"
LLM_MODEL="${FUPAN_LLM_MODEL:-deepseek-v4.1-flash}"
LLM_TIMEOUT="${FUPAN_LLM_TIMEOUT:-60}"
LLM_KEY="${FUPAN_LLM_API_KEY:-}"

if [ -z "$LLM_KEY" ]; then
  echo "错误：未设置 FUPAN_LLM_API_KEY"
  echo "      export FUPAN_LLM_API_KEY=sk-... 后重试"
  exit 1
fi

umask 077
{
  echo "FUPAN_LLM_BASE_URL=$LLM_BASE"
  echo "FUPAN_LLM_API_KEY=$LLM_KEY"
  echo "FUPAN_LLM_MODEL=$LLM_MODEL"
  echo "FUPAN_LLM_TIMEOUT=$LLM_TIMEOUT"
} > "$APP/server/.env"
chmod 600 "$APP/server/.env"

echo "--- 行数与内容校验（key 已打码）---"
wc -l < "$APP/server/.env"
sed 's/=sk-.*/=sk-***REDACTED***/' "$APP/server/.env"
echo "--- 首行是否为变量 ---"
head -1 "$APP/server/.env" | grep -q '^FUPAN_LLM_BASE_URL=' && echo "OK: 首行即变量" || echo "FAIL: 首行不是变量"

echo
echo "--- 重启服务 ---"
systemctl restart fupan.service
sleep 6
systemctl is-active fupan.service
curl -s -m 10 http://127.0.0.1:8000/api/ai/status
echo
