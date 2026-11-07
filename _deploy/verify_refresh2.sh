#!/bin/bash
echo "=== 等待预热构建结束 (TTL=300s, 构建~110s) ==="
for i in $(seq 1 30); do
  s=$(curl -s -m 10 http://127.0.0.1:8000/api/refresh/status)
  running=$(echo "$s" | grep -o '"running":[a-z]*' | cut -d: -f2)
  if [ "$running" = "false" ]; then echo "IDLE after ~$((i*10))s"; break; fi
  sleep 10
done

echo
echo "=== 连续打 /api/all 3次，TTL=300s 内不应重新触发构建 ==="
for k in 1 2 3; do
  a=$(curl -s -m 15 "http://127.0.0.1:8000/api/all?date=")
  rf=$(echo "$a" | grep -o '"refreshing":[a-z]*' | cut -d: -f2)
  echo "all#$k refreshing=$rf"
  sleep 6
done
s=$(curl -s -m 10 http://127.0.0.1:8000/api/refresh/status)
echo "status running=$(echo "$s" | grep -o '"running":[a-z]*' | cut -d: -f2)"

echo
echo "=== 模拟点刷新 POST -> 应 started=true -> 一轮后回 idle ==="
curl -s -m 15 -X POST http://127.0.0.1:8000/api/refresh
echo
for i in $(seq 1 25); do
  sleep 10
  s=$(curl -s -m 10 http://127.0.0.1:8000/api/refresh/status)
  running=$(echo "$s" | grep -o '"running":[a-z]*' | cut -d: -f2)
  if [ "$running" = "false" ]; then echo "post-refresh IDLE after ~$((i*10))s: $s"; break; fi
done
echo "verify complete"