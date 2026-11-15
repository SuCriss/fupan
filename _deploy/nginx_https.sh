#!/bin/bash
set -e
DOMAIN=fupan.chrisite.eu.cc
CONF=/etc/nginx/conf.d/${DOMAIN}.conf
LIVE=/etc/letsencrypt/live/${DOMAIN}

echo "=== 1. DNS check ==="
if ! getent hosts "$DOMAIN" >/dev/null 2>&1; then
  echo "DNS_NOT_READY: $DOMAIN has no A record yet"
  exit 2
fi
getent hosts "$DOMAIN"

echo
echo "=== 2. certbot ==="
if [ -d "$LIVE" ]; then
  echo "cert already present"
else
  certbot certonly --webroot -w /var/www/html -d "$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email 2>&1 | tail -6
fi

echo
echo "=== 3. full HTTPS config ==="
cat > "$CONF" <<'NGXEOF'
# fupan - A-share limit-up review
# fupan.chrisite.eu.cc -> nginx :443 -> 127.0.0.1:8000 (FastAPI/uvicorn)

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

server {
    listen 443 ssl http2;
    server_name fupan.chrisite.eu.cc;

    ssl_certificate     /etc/letsencrypt/live/fupan.chrisite.eu.cc/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fupan.chrisite.eu.cc/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    client_max_body_size 16m;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $http_cf_connecting_ip;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header CF-Connecting-IP  $http_cf_connecting_ip;

        # /api/refresh runs a full-market scan; allow a generous timeout.
        proxy_read_timeout 300;
        proxy_send_timeout 300;
        proxy_buffering off;
    }
}
NGXEOF

nginx -t 2>&1 | tail -2
systemctl reload nginx && echo "nginx reloaded with HTTPS"
