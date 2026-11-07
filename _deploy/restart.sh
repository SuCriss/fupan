#!/bin/bash
head -1 /opt/fupan/server/.env | grep -q '^FUPAN_LLM_BASE_URL=' && echo "OK: first line is a variable" || echo "FAIL"
systemctl restart fupan.service
sleep 7
echo "service: $(systemctl is-active fupan.service)"
echo "ai status: $(curl -s -m 10 http://127.0.0.1:8000/api/ai/status)"
echo "health: $(curl -s -m 10 http://127.0.0.1:8000/api/health)"
