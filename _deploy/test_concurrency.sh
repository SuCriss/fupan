#!/bin/bash
echo "=== cgroup 内存 ==="
cur=$(systemctl show fupan.service -p MemoryCurrent --value)
max=$(systemctl show fupan.service -p MemoryMax --value)
high=$(systemctl show fupan.service -p MemoryHigh --value)
awk -v c="$cur" -v m="$max" -v h="$high" 'BEGIN{
  printf "  当前 %.0f MB / 软限 %.0f MB / 硬限 %.0f MB\n", c/1048576, h/1048576, m/1048576
}'

echo
echo "=== 并发压测（本地直连，绕开 CDN） ==="
echo "-- 20 并发 /api/market（有 20s 缓存） --"
start=$(date +%s%N)
for i in $(seq 20); do
  curl -s -o /dev/null -m 30 http://127.0.0.1:8000/api/market &
done
wait
end=$(date +%s%N)
echo "  耗时 $(( (end-start)/1000000 )) ms"

echo "-- 5 并发 /api/stock（每个约 4s，最重的接口） --"
start=$(date +%s%N)
for c in 600519 002578 601599 600537 603381; do
  curl -s -o /dev/null -m 60 "http://127.0.0.1:8000/api/stock/$c" &
done
wait
end=$(date +%s%N)
echo "  耗时 $(( (end-start)/1000000 )) ms"

echo "-- 30 并发混合 --"
start=$(date +%s%N)
for i in $(seq 10); do
  curl -s -o /dev/null -m 30 http://127.0.0.1:8000/api/health &
  curl -s -o /dev/null -m 30 "http://127.0.0.1:8000/api/sectors?limit=10" &
  curl -s -o /dev/null -m 30 "http://127.0.0.1:8000/api/sentiment?days=30" &
done
wait
end=$(date +%s%N)
echo "  耗时 $(( (end-start)/1000000 )) ms"

echo
echo "=== 压测后健康 ==="
curl -s -m 20 -w '\n  HTTP %{http_code}\n' http://127.0.0.1:8000/api/health | head -2
PID=$(systemctl show fupan.service -p MainPID --value)
awk '/VmRSS|Threads/{printf "  %s %s %s\n", $1, $2, $3}' /proc/$PID/status
