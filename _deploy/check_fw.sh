#!/bin/bash
echo "=== ufw ==="
ufw status 2>/dev/null | head -8 || echo "ufw not enabled"
echo "--- iptables INPUT ---"
iptables -L INPUT -n 2>/dev/null | head -4
echo
echo "=== cloudflared ==="
which cloudflared 2>/dev/null || echo "cloudflared not installed"
echo
echo "=== port 8000 listener ==="
ss -lntp | grep ":8000 "
echo
echo "=== self reachability via public IP ==="
timeout 8 curl -s -o /dev/null -w "public IP:8000 -> HTTP %{http_code}\n" http://192.3.13.21:8000/api/health || echo "public 8000 unreachable"
