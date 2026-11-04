#!/bin/bash
echo "=== DNS 解析 ==="
getent hosts a-stock.chrisite.eu.cc || echo "resolve failed"
echo
echo "=== 是否有 a-stock 相关站点文件 ==="
grep -rl "a-stock" /etc/nginx/sites-available/ /etc/nginx/conf.d/ 2>/dev/null || echo "无站点配置引用 a-stock"
ls -d /var/www/a-stock* /opt/a-stock* 2>/dev/null || echo "无 a-stock 目录"
echo
echo "=== 8000 端口占用 ==="
ss -lntp | grep ":8000 " || echo "8000 空闲"
echo
echo "=== 证书到期 ==="
for d in /etc/letsencrypt/live/*/; do
  n=$(basename "$d")
  e=$(openssl x509 -in "$d/cert.pem" -noout -enddate 2>/dev/null | cut -d= -f2)
  echo "$n -> $e"
done | head -20
