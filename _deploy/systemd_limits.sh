#!/bin/bash
# Resource limits for the fupan service.
#
# Measured footprint: ~80 MB RSS idle and during a full-market build (the build
# streams pages rather than holding the whole market at once), so 512 MB leaves
# roughly 6x headroom. MemoryHigh throttles first and MemoryMax is the hard stop,
# which keeps one runaway build from taking the whole host down with it.
#
# NOTE: --workers is deliberately left at 1. The snapshot cache, the background
# build thread, the refresh state and the AI queue are all module-level state in
# this process; a second worker would run its own build and could answer
# /api/refresh/status from a different process than the one handling the POST,
# which is exactly the "stuck on refreshing" failure this service was fixed for.
set -euo pipefail

DIR=/etc/systemd/system/fupan.service.d
CONF="$DIR/limits.conf"
mkdir -p "$DIR"

if [ -f "$CONF" ]; then
  cp "$CONF" "$CONF.bak-$(date +%Y%m%d-%H%M%S)"
fi

cat > "$CONF" <<'EOF'
[Service]
# Soft limit: the kernel reclaims aggressively past this point.
MemoryHigh=384M
# Hard limit: OOM-kill rather than let the host swap itself to death.
MemoryMax=512M
# Leave room for an in-flight request to finish on restart.
TimeoutStopSec=30
EOF

systemctl daemon-reload
systemctl restart fupan.service
sleep 8

echo "=== 生效值 ==="
systemctl show fupan.service -p MemoryHigh -p MemoryMax -p TimeoutStopUSec --value | sed 's/^/  /'
echo "=== 服务 ==="
systemctl is-active fupan.service
PID=$(systemctl show fupan.service -p MainPID --value)
awk '/VmRSS/{printf "  当前内存 %.0f MB\n", $2/1024}' /proc/$PID/status
