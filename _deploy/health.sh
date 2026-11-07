#!/bin/bash
echo "=== 服务 ==="
systemctl is-active fupan.service
PID=$(systemctl show fupan.service -p MainPID --value)
awk "/VmRSS/{printf \"  内存 %.0f MB\n\", \$2/1024}" /proc/$PID/status
echo "=== 磁盘 ==="
df -h / | tail -1 | awk '{print "  已用 "$3" / "$2" ("$5")"}'
echo "=== journal ==="
journalctl --disk-usage | sed 's/^/  /'
echo "=== 备份 ==="
ls -1 /opt/fupan/backup/ | tail -3 | sed 's/^/  /'
echo "  数量: $(ls -1 /opt/fupan/backup/*.db 2>/dev/null | wc -l)"
echo "=== 数据库 ==="
sqlite3 /opt/fupan/data/fupan.db "SELECT '  快照天数=' || COUNT(*) FROM snapshots;"
sqlite3 /opt/fupan/data/fupan.db "SELECT '  归因条数=' || COUNT(*) FROM attributions;"
echo "=== git ==="
cd /opt/fupan && git log --oneline -1 | sed 's/^/  /'
git status --short | sed 's/^/  未跟踪: /'
echo "  (无输出即干净)"
