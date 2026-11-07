#!/bin/bash
# Local uptime probe for the fupan service.
#
# This catches the cases the process itself cannot report: uvicorn dead, nginx
# down, or /api/health returning 503 because the database is unreadable or the
# snapshot is hours stale. It is deliberately not the only monitor — if the whole
# host dies this probe dies with it — so pair it with an external check pointed at
# https://fupan.chrisite.eu.cc/api/health.
#
# A single failure is treated as a blip (upstream fetch hiccups, brief reload) and
# only logged after FAIL_THRESHOLD consecutive misses, so the log stays signal.
set -uo pipefail

URL="http://127.0.0.1:8000/api/health"
STATE=/var/tmp/fupan-probe.fails
LOG=/var/log/fupan-probe.log
FAIL_THRESHOLD=3
TIMEOUT=15

fails=0
[ -f "$STATE" ] && fails=$(cat "$STATE" 2>/dev/null || echo 0)

body=$(curl -s -m "$TIMEOUT" -w '\n%{http_code}' "$URL" 2>/dev/null)
code=$(printf '%s' "$body" | tail -1)
payload=$(printf '%s' "$body" | sed '$d')

healthy=0
if [ "$code" = "200" ] && printf '%s' "$payload" | grep -q '"ok":true'; then
  healthy=1
fi

logline() { echo "$(date '+%F %T') $*" >> "$LOG"; }

if [ "$healthy" = "1" ]; then
  if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
    logline "RECOVERED after $fails failed checks"
  fi
  echo 0 > "$STATE"
  exit 0
fi

fails=$((fails + 1))
echo "$fails" > "$STATE"

# Build a short reason from the health payload, or from curl itself when the
# endpoint cannot be reached at all.
reason=$(printf '%s' "$payload" | sed -n 's/.*"issues":\[\([^]]*\)\].*/\1/p')
[ -z "$code" ] && code="000"
[ -z "$reason" ] && reason="unreachable"

if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
  logline "FAIL($fails) http=$code reason=$reason"
  if [ "$fails" -eq "$FAIL_THRESHOLD" ]; then
    logline "ALERT: fupan unhealthy for $fails consecutive checks"
  fi
fi
exit 1
