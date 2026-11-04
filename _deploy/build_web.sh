#!/bin/bash
set -e
APP=/opt/fupan
cd "$APP/web"

echo "=== 1. npm install ==="
npm install --no-audit --no-fund 2>&1 | tail -5

echo
echo "=== 2. build ==="
npm run build 2>&1 | tail -10

echo
echo "=== 3. dist 检查 ==="
ls -la dist dist/assets 2>/dev/null | head -12
