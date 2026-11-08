#!/bin/bash
echo "=== 源站（直连 127.0.0.1:8000）==="
for p in sw.js manifest.webmanifest icon-192.png; do
  echo "--- /$p ---"
  curl -s -D - -o /dev/null -m 10 "http://127.0.0.1:8000/$p" \
    | grep -iE '^HTTP/|^content-type:|^cache-control:' | sed 's/^/  /'
done

echo
echo "=== 经 Cloudflare ==="
for p in sw.js manifest.webmanifest; do
  echo "--- /$p ---"
  curl -s -D - -o /dev/null -m 15 "https://fupan.chrisite.eu.cc/$p" \
    | grep -iE '^HTTP/|^content-type:|^cache-control:|^cf-cache-status:|^age:' | sed 's/^/  /'
done
