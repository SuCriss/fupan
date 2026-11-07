#!/bin/bash
set -e
DOMAIN=fupan.chrisite.eu.cc
CONF=/etc/nginx/conf.d/${DOMAIN}.conf
LIVE=/etc/letsencrypt/live/${DOMAIN}

if [ ! -f "$LIVE/fullchain.pem" ]; then
  echo "ERROR: certificate missing, abort"
  exit 1
fi

cp "$CONF" "${CONF}.http.bak" 2>/dev/null || true

cat > "$CONF" <<'NGXEOF'
# fupan - A-share limit-up review
# fupan.chrisite.eu.cc -> nginx :443 -> 127.0.0.1:8000 (FastAPI/uvicorn)
# TLS via Let's Encrypt; renewal handled by certbot.timer.

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

        # A full-market snapshot build takes ~90s; allow generous timeouts.
        proxy_read_timeout 300;
        proxy_send_timeout 300;
        proxy_buffering off;
    }
}
NGXEOF

nginx -t 2>&1 | tail -2
systemctl reload nginx
echo "reloaded"

echo
echo "=== verify ==="
curl -s -o /dev/null -w "origin https: HTTP %{http_code}\n" -k -m 10 https://127.0.0.1/api/health -H "Host: $DOMAIN"
