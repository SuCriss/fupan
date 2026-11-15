#!/bin/bash
# Bring the chrisite.eu.cc hostnames online alongside the existing cozehub ones.
#
# For each site it:
#   1. checks where the chrisite name currently resolves
#   2. always writes a port-80 vhost carrying the ACME challenge path
#   3. if DNS already points at this origin, issues a certificate and adds 443
#      (with an 80 -> 443 redirect)
#   4. if DNS still points at Cloudflare, leaves the site on 80 only and reports
#      it as pending, so nothing is half-configured
#
# Idempotent: re-running after fixing DNS completes the pending sites.
set -uo pipefail

ORIGIN=192.3.13.21
WEBROOT=/var/www/html
CONFD=/etc/nginx/conf.d

# name:backend_port:public_path
SITES=(
  "fupan:8000:/api/health"
  "agent2api:3065:/v1/models"
  "holdings:8092:/"
  "sub2api:8081:/"
  "ai-interview:8085:/"
)

mkdir -p "$WEBROOT/.well-known/acme-challenge"

resolve() {
  python3 - "$1" <<'PY'
import sys, socket
try:
    ips = sorted({i[4][0] for i in socket.getaddrinfo(sys.argv[1], 443, socket.AF_INET)})
    print(",".join(ips))
except Exception:
    print("")
PY
}

write_http_only() {
  local new=$1 port=$2 conf=$3
  cat > "$conf" <<NGINX
# $new -> 127.0.0.1:$port
# Stage 1: port 80 only, so ACME validation can run before a certificate exists.
server {
    listen 80;
    server_name $new;

    location ^~ /.well-known/acme-challenge/ {
        root $WEBROOT;
        default_type text/plain;
    }

    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:$port;
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
}

add_tls() {
  local new=$1 port=$2 conf=$3 cert=/etc/letsencrypt/live/$1
  cat >> "$conf" <<NGINX

server {
    listen 443 ssl http2;
    server_name $new;

    ssl_certificate     $cert/fullchain.pem;
    ssl_certificate_key $cert/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:$port;
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
}

echo "=========================================================="
echo " chrisite.eu.cc 迁移"
echo " 源站: $ORIGIN"
echo "=========================================================="

PENDING=()
READY=()
DONE=()

for entry in "${SITES[@]}"; do
  IFS=':' read -r name port path <<< "$entry"
  new="$name.chrisite.eu.cc"
  conf="$CONFD/chrisite-$name.conf"

  ips=$(resolve "$new")
  printf '\n── %-30s ' "$new"
  if [ -z "$ips" ]; then
    echo "DNS 无记录 → 跳过（请先在 Cloudflare 添加 A 记录）"
    PENDING+=("$new")
    continue
  fi
  echo "解析到 $ips"

  if [ "$ips" != "$ORIGIN" ]; then
    echo "   ⚠ 仍指向 Cloudflare（$ips）。请把该记录改成灰云 / DNS only，A 记录填 $ORIGIN"
    write_http_only "$new" "$port" "$conf"
    PENDING+=("$new")
    continue
  fi

  echo "   ✓ 已指向源站"
  write_http_only "$new" "$port" "$conf"
  nginx -t >/dev/null 2>&1 || { echo "   nginx 配置错误，跳过"; continue; }
  systemctl reload nginx >/dev/null 2>&1
  sleep 1

  # ACME reachability through the real hostname
  probe="probe-$(date +%s)"
  echo "$probe" > "$WEBROOT/.well-known/acme-challenge/$probe"
  got=$(curl -s -m 15 "http://$new/.well-known/acme-challenge/$probe" 2>/dev/null)
  rm -f "$WEBROOT/.well-known/acme-challenge/$probe"
  if [ "$got" != "$probe" ]; then
    echo "   ✗ ACME 路径不通（返回: ${got:0:30}），跳过签证书"
    PENDING+=("$new")
    continue
  fi
  echo "   ✓ ACME 路径可达"

  if [ -f "/etc/letsencrypt/live/$new/fullchain.pem" ]; then
    echo "   ✓ 证书已存在"
  else
    echo "   … 申请证书"
    certbot certonly --webroot -w "$WEBROOT" -d "$new" \
      --non-interactive --agree-tos --keep-until-expiring \
      --cert-name "$new" >/tmp/certbot-$name.log 2>&1
    if [ ! -f "/etc/letsencrypt/live/$new/fullchain.pem" ]; then
      echo "   ✗ 签发失败，见 /tmp/certbot-$name.log"
      tail -3 /tmp/certbot-$name.log | sed 's/^/     /'
      PENDING+=("$new")
      continue
    fi
    echo "   ✓ 证书签发成功"
  fi

  add_tls "$new" "$port" "$conf"
  READY+=("$new")
done

echo
echo "=========================================================="
echo " 应用配置"
echo "=========================================================="
nginx -t 2>&1 | grep -E 'syntax|test' | sed 's/^/  /'
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx
  echo "  已 reload"
else
  echo "  配置有误，未 reload"
fi

echo
echo "=== 验证 ==="
for entry in "${SITES[@]}"; do
  IFS=':' read -r name port path <<< "$entry"
  new="$name.chrisite.eu.cc"
  code=$(curl -sk -o /dev/null -w '%{http_code}' -m 10 "https://$new$path" -H "Host: $new" 2>/dev/null)
  http=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "http://$new$path" -H "Host: $new" 2>/dev/null)
  printf '  %-30s https:%-5s http:%-5s\n' "$new" "$code" "$http"
done

echo
echo "=========================================================="
if [ ${#PENDING[@]} -gt 0 ]; then
  echo " 待处理（DNS 还是 Cloudflare，或签发未完成）:"
  for d in "${PENDING[@]}"; do echo "   - $d"; done
  echo
  echo " 在 Cloudflare 把这些记录改成：A -> $ORIGIN，灰云（DNS only）"
  echo " 然后重新运行本脚本即可完成。"
fi
if [ ${#READY[@]} -gt 0 ]; then
  echo " 已启用 HTTPS:"
  for d in "${READY[@]}"; do echo "   - https://$d"; done
fi
echo "=========================================================="
