#!/bin/bash
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
D=2026-11-06
q() {
  label="$1"; url="$2"
  out=$(curl -s -m 20 -A "$UA" -H 'Referer: https://data.eastmoney.com/' "$url" 2>/dev/null)
  cnt=$(printf '%s' "$out" | grep -o '"SECURITY_CODE"' | wc -l)
  printf '%-30s 条数=%-4s bytes=%s\n' "$label" "$cnt" "${#out}"
  printf '%s' "$out" | head -c 320
  echo
}
F="filter=(TRADE_DATE%3D%27${D}%27)"
q "龙虎榜 按日过滤+净买入降序" "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,EXPLANATION,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,CHANGE_RATE,TURNOVERRATE,ACCUM_AMOUNT&${F}&pageNumber=1&pageSize=5&sortColumns=BILLBOARD_NET_AMT&sortTypes=-1"
echo
q "机构席位 按日过滤" "https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ORGANIZATION_TRADE_DETAILS&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_DATE,BUY_TIMES,SELL_TIMES,BUY_AMT,SELL_AMT,NET_BUY_AMT,CHANGE_RATE&${F}&pageNumber=1&pageSize=5&sortColumns=NET_BUY_AMT&sortTypes=-1"
