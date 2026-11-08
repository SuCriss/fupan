#!/bin/bash
# Verify the login throttle: 5 failures lock the client for 15 minutes.
echo "=== 连续 6 次错误密码（服务器本地，IP=127.0.0.1）==="
for i in $(seq 1 6); do
  code=$(curl -s -o /tmp/l.out -w '%{http_code}' -m 10 \
    -X POST -H 'Content-Type: application/json' \
    -d '{"password":"wrong"}' \
    http://127.0.0.1:8000/api/login)
  msg=$(head -c 80 /tmp/l.out)
  printf '  第%s次 -> %s  %s\n' "$i" "$code" "$msg"
done

echo
echo "=== 锁定期内用正确密码也应被拒 ==="
PW=$(grep '^FUPAN_PASSWORD=' /opt/fupan/server/.env | cut -d= -f2)
code=$(curl -s -o /tmp/l2.out -w '%{http_code}' -m 10 \
  -X POST -H 'Content-Type: application/json' \
  -d "{\"password\":\"$PW\"}" \
  http://127.0.0.1:8000/api/login)
printf '  正确密码 -> %s  %s\n' "$code" "$(head -c 80 /tmp/l2.out)"

echo
echo "=== 重启清空限流状态（内存实现）==="
systemctl restart fupan.service
sleep 6
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 \
  -X POST -H 'Content-Type: application/json' \
  -d "{\"password\":\"$PW\"}" \
  http://127.0.0.1:8000/api/login)
printf '  重启后正确密码 -> %s\n' "$code"
rm -f /tmp/l.out /tmp/l2.out
