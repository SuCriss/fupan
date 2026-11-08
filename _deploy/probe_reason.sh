#!/bin/bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
t() {
  name="$1"; url="$2"
  rm -f /tmp/g.out
  code=$(curl -s -o /tmp/g.out -w '%{http_code}' -m 15 -A "$UA" -H 'Referer: https://data.eastmoney.com/' "$url" 2>/dev/null)
  size=$(wc -c < /tmp/g.out 2>/dev/null || echo 0)
  printf '%-24s http=%-4s bytes=%-7s\n' "$name" "$code" "$size"
  head -c 400 /tmp/g.out
  echo
}

echo "=== 涨停原因报表 ==="
t RPT_LIMIT_UP "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LIMIT_UP&columns=ALL&pageNumber=1&pageSize=2&sortColumns=TRADE_DATE&sortTypes=-1"
echo
t RPT_LIMIT_UP_REASON "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LIMIT_UP_REASON&columns=ALL&pageNumber=1&pageSize=2"

echo
echo "=== 机构席位 ==="
t RPT_ORGANIZATION "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ORGANIZATION_TRADE_DETAILS&columns=ALL&pageNumber=1&pageSize=2&sortColumns=TRADE_DATE&sortTypes=-1"
