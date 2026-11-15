#!/bin/bash
# Issue a Let's Encrypt certificate for the legacy hostname and enable TLS.
#
# Prerequisite: an A record for fupan.chrisite.eu.cc -> 192.3.13.21 exists in
# Cloudflare. HTTP-01 validation works with the proxy on, because Cloudflare
# forwards /.well-known/acme-challenge/ to this origin.
#
# Run after DNS resolves:
#   bash _deploy/issue_cert_chrisite.sh
set -euo pipefail

OLD=fupan.chrisite.eu.cc
CONF=/etc/nginx/conf.d/fupan-chrisite.conf
WEBROOT=/var/www/html

echo "=== 1. 检查 DNS 是否已指向本机 ==="
RESOLVED=$(python3 - <<PY
import socket
try:
    print(",".join(sorted({i[4][0] for i in socket.getaddrinfo("$OLD", 80, socket.AF_INET)})))
except Exception:
    print("")
PY
)
if [ -z "$RESOLVED" ]; then
  echo "  $OLD 仍无 A 记录。请先在 Cloudflare 添加："
  echo "    $OLD  ->  192.3.13.21   (Proxied / 橙色云)"
  exit 1
fi
echo "  解析到: $RESOLVED"
echo "  （Cloudflare 代理下会是 CF 的 IP，属正常）"

echo
echo "=== 2. 确认 ACME 路径可达 ==="
mkdir -p "$WEBROOT/.well-known/acme-challenge"
PROBE="probe-$(date +%s)"
echo "$PROBE" > "$WEBROOT/.well-known/acme-challenge/$PROBE"
LOCAL=$(curl -s --noproxy '*' -m 10 "http://127.0.0.1/.well-known/acme-challenge/$PROBE" -H "Host: $OLD")
PUBLIC=$(curl -s -m 20 "http://$OLD/.well-known/acme-challenge/$PROBE" 2>/dev/null || true)
rm -f "$WEBROOT/.well-known/acme-challenge/$PROBE"

[ "$LOCAL" = "$PROBE" ] && echo "  本机路径 OK" || { echo "  本机路径失败"; exit 1; }
if [ "$PUBLIC" = "$PROBE" ]; then
  echo "  公网路径 OK（经 Cloudflare）"
else
  echo "  公网路径未通（返回: ${PUBLIC:0:40}）—— 继续尝试签发，certbot 会自行判定"
fi

echo
echo "=== 3. 申请证书 ==="
certbot certonly --webroot -w "$WEBROOT" -d "$OLD" \
  --non-interactive --agree-tos --keep-until-expiring \
  --cert-name "$OLD" 2>&1 | tail -12 | sed 's/^/  /'

CERT=/etc/letsencrypt/live/$OLD/fullchain.pem
[ -f "$CERT" ] || { echo "  证书未生成，终止"; exit 1; }

echo
echo "=== 4. 启用 443（追加到同一 vhost）==="
if grep -q 'listen 443' "$CONF"; then
  echo "  已有 443 段，跳过"
else
  cat >> "$CONF" <<NGINX

server {
    listen 443 ssl http2;
    server_name $OLD;

    ssl_certificate     /etc/letsencrypt/live/$OLD/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$OLD/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

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
fi

echo
echo "=== 5. 让 80 的普通请求跳到 https（保留 acme 路径）==="
python3 - "$CONF" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
# Only the first server block (the port-80 one) gets the redirect.
if "return 301 https://" not in s.split("listen 443")[0]:
    s = s.replace(
        """    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $http_cf_connecting_ip;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header CF-Connecting-IP  $http_cf_connecting_ip;

        proxy_read_timeout 300;
        proxy_send_timeout 300;
        proxy_buffering off;
    }""",
        """    location / {
        return 301 https://$host$request_uri;
    }""",
        1,
    )
    open(p, "w").write(s)
    print("  已加 301")
else:
    print("  已有 301，跳过")
PY

nginx -t 2>&1 | grep -E 'syntax|test' | sed 's/^/  /'
systemctl reload nginx
sleep 2

echo
echo "=== 6. 验证 ==="
printf '  Host %s / (http)  -> ' "$OLD"
curl -s --noproxy '*' -o /dev/null -w '%{http_code}\n' -m 10 http://127.0.0.1/ -H "Host: $OLD"
printf '  Host %s / (https) -> ' "$OLD"
curl -sk --noproxy '*' -o /dev/null -w '%{http_code}\n' -m 10 https://127.0.0.1/ -H "Host: $OLD"
printf '  公网 https://%s/ -> ' "$OLD"
curl -s -o /dev/null -w '%{http_code}\n' -m 20 "https://$OLD/"

echo
echo "证书信息:"
openssl x509 -in "$CERT" -noout -subject -dates 2>/dev/null | sed 's/^/  /'
