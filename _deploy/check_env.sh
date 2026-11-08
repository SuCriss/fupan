#!/bin/bash
ENV=/opt/fupan/server/.env
echo "=== 现有键名（仅键，不含值）==="
grep -vE '^\s*(#|$)' "$ENV" 2>/dev/null | cut -d= -f1 | sed 's/^/  /'
echo
echo "=== 是否已有 FUPAN_PASSWORD ==="
grep -q '^FUPAN_PASSWORD=' "$ENV" 2>/dev/null && echo "  已存在" || echo "  未设置"
