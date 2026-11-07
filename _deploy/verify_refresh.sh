#!/bin/bash
echo "=== 等预热构建彻底结束 ==="
for i in $(seq 1 30); do
  s=$(curl -s -m 10 http://127.0.0.1:8000/api/refresh/status)
  running=$(echo "$s" | grep -o '"running":[a-z]*' | cut -d: -f2)
  if [ "$running" = "false" ]; then echo "IDLE after ~$((i*10))s: $s"; break; fi
  sleep 10
done

echo
echo "=== 连续打 /api/all 5 次(间隔5s)，不应再触发新 build ==="
before=$(curl -s -m 15 "http://127.0.0.1:8000/api/all?date=")
bts=$(echo "$before" | grep -o '"ts":[0-9]*' | head -1)
echo "首次 all ts=$bts  refreshing=$(echo "$before" | grep -o '\"refreshing\":[a-z]*' | cut -d: -f2)"
for k in 1 2 3 4 5; do
  sleep 5
  s=$(curl -s -m 15 "http://127.0.0.1:8000/api/refresh/status")
  echo "poll$k running=$(echo "$s" | grep -o '\"running\":[a-z]*' | cut -d: -f2)"
done

echo
echo "=== 模拟点一次刷新(POST)，应 started=true，结束回到 idle ==="
curl -s -m 15 -X POST http://127.0.0.1:8000/api/refresh
echo
for i in $(seq 1 25); do
  sleep 10
  s=$(curl -s -m 10 http://127.0.0.1:8000/api/refresh/status)
  running=$(echo "$s" | grep -o '"running":[a-z]*' | cut -d: -f2)
  if [ "$running" = "false" ]; then echo "post-refresh IDLE after ~$((i*10))s: $s"; break; fi
done
echo "done"