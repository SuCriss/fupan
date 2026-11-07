#!/bin/bash
echo "--- .env 内容(key 已隐去) ---"
sed 's/=sk-.*/=sk-***REDACTED***/' /opt/fupan/server/.env
echo
echo "--- 路径推导 ---"
/opt/fupan/server/.venv/bin/python - <<'PYEOF'
from pathlib import Path
cfg = Path('/opt/fupan/server/fupan/config.py').resolve()
base = cfg.parent.parent            # -> /opt/fupan/server
root = base.parent                  # -> /opt/fupan
print('BASE_DIR =', base)
print('ROOT_DIR =', root)
print('server/.env exists:', (base / '.env').exists())
PYEOF
echo
echo "--- 服务进程环境 ---"
tr '\0' '\n' < /proc/$(systemctl show -p MainPID --value fupan.service)/environ | grep -i fupan || echo "(无 FUPAN_* 环境变量，走 .env 文件)"
