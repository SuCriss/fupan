#!/bin/bash
# Put TLS on the direct-IP entry point.
#
# Why this exists: Cloudflare is unusable from mainland client networks. Measured
# through the only reachable edge IP: 23s for the page and 25s per API call,
# while the origin IP answers in 0.03s. So the IP is the real serving path, and
# serving it over plain HTTP would put the access password on the wire in clear.
#
# The certificate is self-signed with an IP SAN and lives only on this host.
# Browsers show a warning once per device; after "Advanced -> Proceed" the page
# is a secure context (password encrypted, httpOnly cookies honoured). Service
# Worker registration still fails because the CA is untrusted, so PWA/offline is
# unavailable on this entry — the app itself is fully functional.
#
# Both 80 and 443 are kept so an existing bookmark keeps working.
#
# Idempotent: reuses an existing certificate, and does not append a second 443
# block.
set -euo pipefail

IP="${1:-192.3.13.21}"
DIR=/etc/nginx/ssl/fupan-ip
CONF=/etc/nginx/conf.d/fupan-ip-direct.conf

if [ ! -f "$CONF" ]; then
  echo "缺少 $CONF —— 先运行 _deploy/nginx_ip_direct.sh"
  exit 1
fi

mkdir -p "$DIR"
chmod 700 "$DIR"

if [ ! -f "$DIR/fullchain.pem" ]; then
  echo "=== 生成自签证书（CN=$IP，IP SAN，10 年）==="
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$DIR/privkey.pem" \
    -out "$DIR/fullchain.pem" \
    -days 3650 \
    -subj "/C=CN/O=fupan/CN=$IP" \
    -addext "subjectAltName=IP:$IP" 2>/dev/null
  chmod 600 "$DIR/privkey.pem"
  chmod 644 "$DIR/fullchain.pem"
else
  echo "=== 复用已有证书 ==="
fi

openssl x509 -in "$DIR/fullchain.pem" -noout -subject -dates -ext subjectAltName 2>/dev/null | sed 's/^/  /'

if grep -q 'listen 443' "$CONF"; then
  echo "  已有 443 段，跳过追加"
else
  echo "=== 追加 443 段 ==="
  cat >> "$CONF" <<NGINX

# TLS on the same direct-IP entry. Self-signed (IP SAN): browsers warn once and
# remember. Plain 80 is kept so an old bookmark still works.
server {
    listen 443 ssl;
    server_name $IP;

    ssl_certificate     $DIR/fullchain.pem;
    ssl_certificate_key $DIR/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:4m;
    ssl_session_timeout 1h;

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
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_read_timeout 300;
        proxy_send_timeout 300;
        proxy_buffering off;
    }
}
NGINX
fi

nginx -t 2>&1 | grep -E 'syntax|test' | sed 's/^/  /'
systemctl reload nginx
sleep 2

echo
echo "=== 验证 ==="
printf '  https://%s/            ' "$IP"
curl -sk -o /dev/null -w '%{http_code} %{time_total}s\n' -m 15 "https://$IP/"
printf '  https://%s/api/health  ' "$IP"
curl -sk -o /dev/null -w '%{http_code} %{time_total}s\n' -m 15 "https://$IP/api/health"
printf '  http://%s/  (保留)     ' "$IP"
curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' -m 15 "http://$IP/"

echo
echo "=== 证书 SHA256（浏览器里可比对）==="
openssl x509 -in "$DIR/fullchain.pem" -noout -fingerprint -sha256 2>/dev/null | sed 's/^/  /'
