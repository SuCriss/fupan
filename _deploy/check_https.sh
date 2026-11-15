#!/bin/bash
echo "=== 1. cert present? ==="
if [ -d /etc/letsencrypt/live/fupan.chrisite.eu.cc ]; then
  echo "YES"
  openssl x509 -in /etc/letsencrypt/live/fupan.chrisite.eu.cc/cert.pem -noout -subject -dates 2>&1
else
  echo "NO"
fi

echo
echo "=== 2. current nginx conf for fupan ==="
grep -E "listen|server_name|ssl_certificate|proxy_pass" /etc/nginx/conf.d/fupan.chrisite.eu.cc.conf 2>/dev/null

echo
echo "=== 3. nginx status ==="
nginx -t 2>&1 | tail -2
systemctl is-active nginx

echo
echo "=== 4. local https test ==="
curl -s -o /dev/null -w "https local: HTTP %{http_code}\n" -k -m 10 https://127.0.0.1/api/health -H "Host: fupan.chrisite.eu.cc" || echo "https local failed"
