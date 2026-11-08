#!/bin/bash
# Enable the access password.
#
# Idempotent: re-running replaces the existing FUPAN_PASSWORD line instead of
# appending a second one. Changing it also invalidates every issued session,
# because the signing key is derived from the password.
set -euo pipefail

ENV=/opt/fupan/server/.env
[ -f "$ENV" ] || touch "$ENV"
chmod 600 "$ENV"

PW="${1:-}"
if [ -z "$PW" ]; then
  # 16 chars from an alphabet without look-alikes (0/O, 1/l/I).
  PW=$(python3 -c "import secrets;a='abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';print(''.join(secrets.choice(a) for _ in range(16)))")
fi

cp "$ENV" "$ENV.bak-$(date +%Y%m%d-%H%M%S)"

# Drop every previous password line, including one left commented out by
# disable_auth.sh, so the file never carries two conflicting entries.
grep -vE '^#?FUPAN_PASSWORD=' "$ENV" > "$ENV.tmp" || true
printf 'FUPAN_PASSWORD=%s\n' "$PW" >> "$ENV.tmp"
mv "$ENV.tmp" "$ENV"
chmod 600 "$ENV"

systemctl restart fupan.service
sleep 6

echo "=== 服务 ==="
systemctl is-active fupan.service
echo "=== 门是否生效（未带 cookie 访问业务接口）==="
curl -s -o /dev/null -w '  /api/all  -> %{http_code}\n' -m 10 http://127.0.0.1:8000/api/all
curl -s -o /dev/null -w '  /api/health -> %{http_code}\n' -m 10 http://127.0.0.1:8000/api/health
curl -s -m 10 http://127.0.0.1:8000/api/auth/status | sed 's/^/  status: /'
echo
echo "=== 访问密码 ==="
echo "$PW"
