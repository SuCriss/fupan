#!/bin/bash
set -e
APP=/opt/fupan

# 逐行写入，避免 heredoc/编码把注释与变量合并
printf '%s\n' \
  'FUPAN_LLM_BASE_URL=https://agent2api.chrisite.eu.cc/v1' \
  'FUPAN_LLM_API_KEY=sk-a2a-039e1586431fb18463418aface027cfb' \
  'FUPAN_LLM_MODEL=deepseek-v4.1-flash' \
  'FUPAN_LLM_TIMEOUT=60' \
  > "$APP/server/.env"

chmod 600 "$APP/server/.env"
echo "--- 行数与内容校验 ---"
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
