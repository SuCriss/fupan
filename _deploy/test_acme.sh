#!/bin/bash
# Verify the ACME challenge path is reachable through Cloudflare before
# asking Let's Encrypt for a certificate.
echo "=== create test file ==="
mkdir -p /var/www/html/.well-known/acme-challenge
echo "acme-test-ok-12345" > /var/www/html/.well-known/acme-challenge/fupantest
chmod -R 755 /var/www/html/.well-known

echo "=== nginx conf (acme location) ==="
grep -A4 "acme-challenge" /etc/nginx/conf.d/fupan.chrisite.eu.cc.conf

echo
echo "=== fetch through public domain (HTTP) ==="
curl -s -m 15 -L "http://fupan.chrisite.eu.cc/.well-known/acme-challenge/fupantest" -w "\nHTTP %{http_code}\n" | tail -3

echo
echo "=== fetch direct to origin via Host header ==="
curl -s -m 10 -H "Host: fupan.chrisite.eu.cc" "http://127.0.0.1/.well-known/acme-challenge/fupantest" -w "\nHTTP %{http_code}\n" | tail -3
