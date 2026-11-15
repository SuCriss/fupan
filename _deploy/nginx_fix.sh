#!/bin/bash
set -e
DOMAIN=fupan.chrisite.eu.cc
CONF=/etc/nginx/conf.d/${DOMAIN}.conf

# ASCII-only comments: a prior upload collapsed a CJK comment line into the
# following "server {" line and nginx rejected the whole config.
cat > "$CONF" <<'NGXEOF'
# fupan - A-share limit-up review
# fupan.chrisite.eu.cc -> 127.0.0.1:8000 (FastAPI/uvicorn)
# Stage 1: HTTP only, serves the ACME challenge path for certbot.
server {
    listen 80;
    server_name fupan.chrisite.eu.cc;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
NGXEOF

echo "=== head of file ==="
head -7 "$CONF"
echo
echo "=== nginx -t ==="
nginx -t 2>&1 | tail -3
