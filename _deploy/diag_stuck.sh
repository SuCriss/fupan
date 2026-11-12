#!/bin/bash
echo "=== 构建日志（去除 kline 噪声）==="
journalctl -u fupan.service --no-pager -n 300 \
  | grep -vE 'served by sina' \
  | grep -iE 'snapshot built|fetch:|concepts:|history:|refresh failed|Traceback|ERROR' \
  | tail -12

echo
echo "=== 数据库快照（最近 5 天）==="
sqlite3 /opt/fupan/data/fupan.db \
  "SELECT date, datetime(ts/1000,'unixepoch','+8 hours') AS built FROM snapshots ORDER BY date DESC LIMIT 5;"

echo
echo "=== 进程 ==="
PID=$(systemctl show fupan.service -p MainPID --value)
awk '/VmRSS|Threads/{printf "  %s %s %s\n", $1, $2, $3}' /proc/$PID/status
echo "  运行时间: $(ps -o etime= -p $PID | tr -d ' ')"

echo
echo "=== 健康 ==="
curl -s -m 10 http://127.0.0.1:8000/api/health

echo
echo "=== 源站首页 ==="
curl -s -o /dev/null -w '  / -> %{http_code}  %{time_total}s\n' -m 15 http://127.0.0.1:8000/

echo
echo "=== 构建线程是否卡在某一步（取样 3 次 10s 间隔）==="
for i in 1 2 3; do
  journalctl -u fupan.service --no-pager -n 5 | grep -vE 'served by sina' | tail -2 | sed 's/^/  /'
  sleep 10
done
