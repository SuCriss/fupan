#!/bin/bash
# One-command deploy for fupan: pull, build, restart, verify.
#
# Replaces the previous manual sequence (ssh, git pull, npm run build, systemctl
# restart, then remember to check health), which repeatedly drifted:
#   - the server's older npm rewrites web/package-lock.json on every build,
#     dirtying the tree and blocking the next `git pull`
#   - a build could succeed while the service still ran the old bundle
#
# Usage:  _deploy/deploy.sh [--no-build]
#   --no-build   restart only (backend-only changes)
set -euo pipefail

REPO=/opt/fupan
WEB="$REPO/web"
SERVICE=fupan.service
HEALTH=http://127.0.0.1:8000/api/health

step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
fail() { printf '\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

DO_BUILD=1
for arg in "$@"; do
  [ "$arg" = "--no-build" ] && DO_BUILD=0
done

cd "$REPO"

step "同步代码"
before=$(git rev-parse --short HEAD)
# The build rewrites package-lock with the server's npm; discard that noise so
# the pull cannot be blocked by a locally-modified lockfile.
git checkout -- web/package-lock.json 2>/dev/null || true
git pull --ff-only
after=$(git rev-parse --short HEAD)
if [ "$before" = "$after" ]; then
  echo "已是最新 ($after)"
else
  echo "$before -> $after"
fi

if [ "$DO_BUILD" = "1" ]; then
  step "构建前端"
  cd "$WEB"
  npm run build
  # Restore the lockfile again: the build just rewrote it.
  cd "$REPO"
  git checkout -- web/package-lock.json 2>/dev/null || true
  echo "产物: $(ls -1t "$WEB/dist/assets"/index-*.js | head -1 | xargs -n1 basename)"
fi

step "重启服务"
systemctl restart "$SERVICE"

step "等待就绪"
for i in $(seq 1 90); do
  sleep 2
  body=$(curl -s -m 8 "$HEALTH" 2>/dev/null || true)
  if printf '%s' "$body" | grep -q '"ok":true'; then
    if ! printf '%s' "$body" | grep -q '"buildRunning":true'; then
      echo "就绪 (${i}0s 内): $body"
      printf '\n\033[32m部署完成: %s\033[0m\n' "$after"
      exit 0
    fi
  fi
  [ $((i % 15)) -eq 0 ] && echo "  …预热构建中 (${i}0s)"
done

fail "服务未在 180s 内就绪；查看: journalctl -u $SERVICE -n 50"
