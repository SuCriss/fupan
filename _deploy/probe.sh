#!/bin/bash
echo "=== a-stock 证书 ==="
openssl x509 -in /etc/letsencrypt/live/a-stock.chrisite.eu.cc/cert.pem -noout -subject -dates 2>&1
echo
echo "=== cpa 站点配置 ==="
grep -E "server_name|listen|proxy_pass|root" /etc/nginx/sites-available/cpa 2>/dev/null | head -14
echo
echo "=== panel 站点配置 ==="
grep -E "server_name|listen|proxy_pass|root" /etc/nginx/sites-available/panel 2>/dev/null | head -14
echo
echo "=== 非 80/443/22 监听端口 ==="
ss -lntp | awk '$4 !~ /:80$|:443$|:22$/' | head -14
