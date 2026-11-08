#!/bin/bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
q() {
  label="$1"; url="$2"
  out=$(curl -s -m 20 -A "$UA" -H 'Referer: https://data.eastmoney.com/' "$url" 2>/dev/null)
  printf '=== %s ===\nbytes=%s\n' "$label" "${#out}"
  printf '%s' "$out" | head -c 700
  echo; echo
}
q "kamt.kline 日度" "https://push2his.eastmoney.com/api/qt/kamt.kline/get?fields1=f1,f3,f5&fields2=f51,f52&klt=101&lmt=10"
q "kamt 实时" "https://push2.eastmoney.com/api/qt/kamt/get?fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54"
q "沪深港通资金流向报表" "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_DEAL_HISTORY&columns=ALL&pageNumber=1&pageSize=3&sortColumns=TRADE_DATE&sortTypes=-1&filter=(MUTUAL_TYPE%3D%22001%22)"
