#!/bin/bash
# Add a direct-by-IP entry point that bypasses DNS and Cloudflare.
#
# Purpose: when a client network cannot reach Cloudflare's edge (common on
# mainland mobile carriers), the named domain fails but the origin IP still
# answers. This block serves the same app on http://<IP>/ so the site stays
# reachable without any DNS or CDN in the path.
#
# It matches only requests whose Host is the bare IP, so every named vhost on
# this machine keeps its own routing.
#
# Trade-off: plain HTTP. The password gate therefore travels unencrypted, which
# is acceptable for a single-user review tool but should not be treated as
# private on an untrusted network.
#
# Idempotent: rewrites the file and reloads nginx.
set -euo pipefail

CONF=/etc/nginx/conf.d/fupan-ip-direct.conf
IP="${1:-192.3.13.21}"

cat > "$CONF" <<NGINX
# fupan - direct IP entry (no DNS, no Cloudflare).
# Reached as http://$IP/ when Cloudflare's edge is unreachable from the client.
# Only matches Host: $IP, so it cannot shadow any named site.

server {
    listen 80;
    server_name $IP;

    client_max_body_size 16m;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # Content-hashed build output: never changes, so cache it forever.
    location ^~ /assets/ {
        alias /opt/fupan/web/dist/assets/;
        access_log off;
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files \$uri =404;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        # No Cloudflare in front here, so the client address is the peer itself.
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # A full-market snapshot build takes ~90s; allow generous timeouts.
        proxy_read_timeout 300;
        proxy_send_timeout 300;
        proxy_buffering off;
    }
}
NGINX

echo "=== 写入 $CONF（Host: $IP）==="
nginx -t 2>&1 | grep -E 'syntax|test' | sed 's/^/  /'
systemctl reload nginx
sleep 2

echo
echo "=== 验证 ==="
printf '  本机 Host=%s  /            -> ' "$IP"
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' -m 15 http://127.0.0.1/ -H "Host: $IP"
printf '  本机 Host=%s  /api/health  -> ' "$IP"
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' -m 15 http://127.0.0.1/api/health -H "Host: $IP"
printf '  公网 http://%s/            -> ' "$IP"
curl -s -o /dev/null -w '%{http_code}  %{time_total}s\n' -m 15 "http://$IP/"
printf '  未登录 /api/all（应 401）  -> '
curl -s -o /dev/null -w '%{http_code}\n' -m 20 "http://$IP/api/all"

echo
echo "访问地址: http://$IP"
