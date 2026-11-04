#!/bin/bash
CONF=/etc/nginx/conf.d/fupan.chrisite.eu.cc.conf
echo "=== 当前文件内容 ==="
cat -A "$CONF" | head -20
echo
echo "=== 对比：已有 a-stock 配置首几行 ==="
head -12 /etc/nginx/conf.d/a-stock.chrisite.eu.cc.conf
echo
echo "=== nginx.conf 是否 include conf.d ==="
grep -n "include" /etc/nginx/nginx.conf | head -6
