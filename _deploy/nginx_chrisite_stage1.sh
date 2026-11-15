#!/bin/bash
# Prepare (but do not enable TLS for) the legacy fupan.chrisite.eu.cc vhost.
# Safe to run repeatedly; only port 80 is configured until DNS resolves.
# Run _deploy/issue_cert_chrisite.sh afterwards to add TLS.
# Restore the legacy hostname fupan.chrisite.eu.cc alongside fupan.cozehub.com.
#
# The domain itself is still registered (its NS records point at Cloudflare) but
# every A record in that zone has been removed, so nothing resolves. Once the
# owner re-adds an A record pointing at this server, this vhost is ready:
#
#   stage 1 (now):  port 80 only, serving the ACME challenge path, so certbot
#                   can issue a certificate as soon as DNS resolves.
#   stage 2 (after DNS): _deploy/issue_cert_chrisite.sh adds TLS.
#
# Keeping port 80 alone until then avoids nginx failing to start over a
# certificate file that does not exist yet.
set -euo pipefail

CONF=/etc/nginx/conf.d/fupan-chrisite.conf
OLD=fupan.chrisite.eu.cc

cat > "$CONF" <<NGINX
# Legacy hostname: fupan.chrisite.eu.cc
# The zone still exists on Cloudflare but has no A record; this vhost is ready
# for the moment one is added. TLS is issued separately once DNS resolves.

server {
    listen 80;
    server_name $OLD;

    # Let's Encrypt HTTP-01 validation (works through Cloudflare's proxy too).
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    client_max_body_size 16m;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

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

        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$http_cf_connecting_ip;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header CF-Connecting-IP  \$http_cf_connecting_ip;

        proxy_read_timeout 300;
        proxy_send_timeout 300;
        proxy_buffering off;
    }
}
NGINX

echo "=== 写入 $CONF ==="
nginx -t 2>&1 | grep -E 'syntax|test' | sed 's/^/  /'
systemctl reload nginx
sleep 2

echo
echo "=== 本机用旧 Host 验证（绕过 DNS）==="
printf '  Host: %s  /            -> ' "$OLD"
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' -m 15 http://127.0.0.1/ -H "Host: $OLD"
printf '  Host: %s  /api/health  -> ' "$OLD"
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' -m 15 http://127.0.0.1/api/health -H "Host: $OLD"

echo
echo "=== ACME 验证路径就绪检查 ==="
echo "test-$(date +%s)" > /var/www/html/.well-known/acme-challenge/_probe
printf '  /.well-known/acme-challenge/_probe -> '
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' -m 10 \
  http://127.0.0.1/.well-known/acme-challenge/_probe -H "Host: $OLD"
rm -f /var/www/html/.well-known/acme-challenge/_probe

echo
echo "就绪。下一步需要先在 Cloudflare 添加 A 记录："
echo "  fupan.chrisite.eu.cc  ->  192.3.13.21  (橙色云 / Proxied)"
