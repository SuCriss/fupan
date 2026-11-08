#!/bin/bash
echo "=== 正常态 ==="
/opt/fupan/_deploy/uptime_probe.sh
echo "exit=$?"
echo "fails=$(cat /var/tmp/fupan-probe.fails 2>/dev/null)"

echo
echo "=== 模拟故障：指向错误端口 ==="
sed 's#127.0.0.1:8000#127.0.0.1:9#; s#FAIL_THRESHOLD=3#FAIL_THRESHOLD=1#' \
  /opt/fupan/_deploy/uptime_probe.sh > /tmp/probe_fail.sh
chmod +x /tmp/probe_fail.sh
echo 0 > /var/tmp/fupan-probe.fails
/tmp/probe_fail.sh
echo "exit=$?"
echo "fails=$(cat /var/tmp/fupan-probe.fails)"

echo
echo "=== 恢复检测 ==="
echo 3 > /var/tmp/fupan-probe.fails
/opt/fupan/_deploy/uptime_probe.sh
echo "exit=$? fails=$(cat /var/tmp/fupan-probe.fails)"

echo
echo "=== 日志 ==="
cat /var/log/fupan-probe.log 2>/dev/null || echo "(无)"
rm -f /tmp/probe_fail.sh
