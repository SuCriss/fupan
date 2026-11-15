#!/bin/bash
# Serve the built SPA's immutable assets directly from nginx.
#
# Until now every 190 KB bundle went through uvicorn, which occupies a Python
# worker thread for a pure file send. nginx can do it with sendfile and keep the
# interpreter free for API work. The Cache-Control matches what FastAPI emitted,
# so browser behaviour is unchanged.
set -euo pipefail

CONF=/etc/nginx/conf.d/fupan.chrisite.eu.cc.conf
STAMP=$(date +%Y%m%d-%H%M%S)
cp "$CONF" "$CONF.bak-$STAMP"

python3 - "$CONF" <<'PY'
import re
import sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()

if "location ^~ /assets/" in src:
    print("already configured, nothing to do")
    raise SystemExit(0)

block = """    # Content-hashed build output: never changes, so cache it forever.
    location ^~ /assets/ {
        alias /opt/fupan/web/dist/assets/;
        access_log off;
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

"""

# Insert just before the catch-all proxy block inside the 443 server.
marker = "    location / {\n        proxy_pass http://127.0.0.1:8000;"
if marker not in src:
    print("ERROR: anchor not found", file=sys.stderr)
    raise SystemExit(1)

src = src.replace(marker, block + marker, 1)
open(path, "w", encoding="utf-8").write(src)
print("inserted /assets/ block")
PY

nginx -t
systemctl reload nginx
echo "nginx reloaded (backup: $CONF.bak-$STAMP)"
