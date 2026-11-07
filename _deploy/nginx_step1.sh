#!/bin/bash
set -e
DOMAIN=fupan.chrisite.eu.cc
CONF=/etc/nginx/conf.d/${DOMAIN}.conf

echo "=== 1. 先写 HTTP-only 配置（供 ACME 验证） ==="
cat > "$CONF" <<'NGXEOF'
# A股涨停复盘 · fupan.chrisite.eu.cc -> 127.0.0.1:8000 (FastAPI/uvicorn)
# 证书由 certbot 申请并自动续期（certbot.timer）。
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

nginx -t && systemctl reload nginx && echo "nginx reloaded (http only)"

echo
echo "=== 2. 申请证书 ==="
if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  echo "证书已存在，跳过申请"
else
  certbot certonly --webroot -w /var/www/html -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --keep-until-expiring 2>&1 | tail -8
fi
